import * as T from 'three';
import { installPaintFinish } from '../paint-finish.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import type { LiveryLayer } from './colourways.ts';

/** Two-tone and stripe layers for catalogue body paint (D7), in car space.
 *
 * The finish, flakes and panel gaps stay the house clear-coat paint; this hook
 * only decides WHERE the secondary and accent colours replace the primary, from
 * the same object-space position the pigment grain uses (`vPaintPosition`). It
 * reads plain uniforms, so a livery edit (colours, which layers) updates the
 * material in place with no recompile and no rebuilt geometry, and the program
 * is shared by every catalogue body that carries it. Every edge is filtered by
 * `fwidth`, so the two-tone line stays crisp up close and dissolves to its mean
 * at distance instead of shimmering. The festival contact finish clones paint
 * materials and keeps this hook by reference, so the uniforms (held in a
 * closure, not on the clone) stay live there too. */
export interface LayerFrame {
  /** Car-frame heights (m): beltline, top of the lower two-tone band, roof. */
  belt: number;
  low: number;
  roof: number;
  /** Car-frame stations (m): windscreen base, rear-window base, nose, tail. */
  windscreen: number;
  rearGlass: number;
  front: number;
  rear: number;
  /** Body half width (m). */
  half: number;
}
export interface LayerLook {
  secondary: number;
  accent: number;
  layers: readonly LiveryLayer[];
  /** Accent pinstripe along the roof and lower-band edges. */
  pin: boolean;
}
export interface BodyLayers {
  readonly material: T.MeshPhysicalMaterial;
  /** Current look (a copy): what the uniforms hold. */
  readonly look: LayerLook;
  setLook(look: LayerLook): void;
  setFrame(frame: LayerFrame): void;
}
const NONE: LayerLook = Object.freeze({
  secondary: 0x101113,
  accent: 0xf2f2ef,
  layers: Object.freeze([]) as readonly LiveryLayer[],
  pin: false,
});
const handles = new WeakMap<T.Material, BodyLayers>();
export function bodyLayersOf(material: T.Material): BodyLayers | undefined {
  return handles.get(material);
}

const DECLARATIONS = /* glsl */ `
uniform vec4 bodyLayerMask;
uniform vec4 bodyLayerMask2;
uniform vec4 bodyLayerA;
uniform vec4 bodyLayerB;
uniform vec4 bodyLayerC;
uniform vec3 bodyLayerSecondary;
uniform vec3 bodyLayerAccent;
`;
const GLSL = /* glsl */ `{
  if (bodyLayerMask != vec4(0.0) || bodyLayerMask2.xy != vec2(0.0)) {
    vec3 lp = vPaintPosition;
    vec3 lw = fwidth(lp) + vec3(1.0e-4);
    float lax = abs(lp.x);
    float belt = bodyLayerA.x, low = bodyLayerA.y, roofY = bodyLayerA.z;
    float zWs = bodyLayerB.x, zRw = bodyLayerB.y, zFront = bodyLayerB.z, zRear = bodyLayerB.w;
    float hw = bodyLayerC.x;
    // Over the cabin: above the beltline, between the glass stations.
    float cabin = smoothstep(zRw - 0.06 - lw.z, zRw - 0.06 + lw.z, lp.z) *
      (1.0 - smoothstep(zWs + 0.04 - lw.z, zWs + 0.04 + lw.z, lp.z));
    float roofEdge = belt + 0.04;
    // The greenhouse stands inside 0.8 of the half width: the side walls and
    // haunches above the beltline stay body colour.
    float roof = bodyLayerMask.x * cabin * smoothstep(roofEdge - lw.y, roofEdge + lw.y, lp.y) *
      (1.0 - smoothstep(hw * 0.84 - lw.x, hw * 0.9 + lw.x, lax));
    float lower = bodyLayerMask.y * (1.0 - smoothstep(low - lw.y, low + lw.y, lp.y));
    // Bonnet: the centre panel ahead of the screen, above the intake mouths.
    float bonnet = bodyLayerMask.z *
      smoothstep(zWs + 0.1 - lw.z, zWs + 0.1 + lw.z, lp.z) *
      (1.0 - smoothstep(hw * 0.42 - lw.x, hw * 0.42 + lw.x, lax)) *
      smoothstep(low + 0.2 - lw.y, low + 0.2 + lw.y, lp.y);
    // Nose: the bumper face and leading edge, forward of the arch.
    float nose = bodyLayerMask.w *
      smoothstep(zFront - 0.3 - lw.z, zFront - 0.3 + lw.z, lp.z) *
      (1.0 - smoothstep(low - 0.06 - lw.y, low + 0.3 + lw.y, lp.y));
    // Twin racing stripes over the bonnet, roof and deck: two bands either side
    // of a narrow gap, on top surfaces only (above the beltline).
    float band = smoothstep(0.03 - lw.x, 0.03 + lw.x, lax) *
      (1.0 - smoothstep(0.17 - lw.x, 0.17 + lw.x, lax));
    float bandGap = smoothstep(0.03 - lw.x, 0.03 + lw.x, lax);
    float stripes = bodyLayerMask2.x * band * bandGap *
      smoothstep(belt - 0.02 - lw.y, belt - 0.02 + lw.y, lp.y) *
      smoothstep(zRear + 0.12 - lw.z, zRear + 0.12 + lw.z, lp.z) *
      (1.0 - smoothstep(zFront - 0.14 - lw.z, zFront - 0.14 + lw.z, lp.z));
    // Flank flash: a band on the side that rises toward the tail.
    float t = clamp((lp.z - zRear) / max(zFront - zRear, 0.1), 0.0, 1.0);
    float flashY = low + 0.1 + 0.14 * (1.0 - t);
    float flash = bodyLayerMask2.y *
      smoothstep(hw * 0.78 - lw.x, hw * 0.78 + lw.x, lax) *
      (1.0 - smoothstep(0.034 - lw.y, 0.034 + lw.y, abs(lp.y - flashY)));
    // Accent pin where the roof and lower bands end.
    float pin = bodyLayerMask2.z * clamp(
      cabin * (1.0 - smoothstep(0.004, 0.004 + lw.y, abs(lp.y - roofEdge - 0.01))) * bodyLayerMask.x +
      (1.0 - smoothstep(0.004, 0.004 + lw.y, abs(lp.y - low - 0.012))) * bodyLayerMask.y, 0.0, 1.0);
    float second = clamp(roof + lower + bonnet + nose + stripes, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, bodyLayerSecondary, second);
    diffuseColor.rgb = mix(diffuseColor.rgb, bodyLayerAccent, clamp(pin + flash, 0.0, 1.0));
  }
}`;

/** Install the layer hook on a body paint material (before panel gaps, so the
 * shut lines still darken the second colour). Idempotent per material. */
export function installBodyLayers(material: T.MeshPhysicalMaterial, frame: LayerFrame): BodyLayers {
  const existing = handles.get(material);
  if (existing) {
    existing.setFrame(frame);
    return existing;
  }
  installPaintFinish(material);
  const uniforms = {
    bodyLayerMask: { value: new T.Vector4() },
    bodyLayerMask2: { value: new T.Vector4() },
    bodyLayerA: { value: new T.Vector4() },
    bodyLayerB: { value: new T.Vector4() },
    bodyLayerC: { value: new T.Vector4() },
    bodyLayerSecondary: { value: new T.Color() },
    bodyLayerAccent: { value: new T.Color() },
  };
  let look: LayerLook = NONE;
  const handle: BodyLayers = {
    material,
    get look() {
      return { ...look, layers: [...look.layers] };
    },
    setLook(next) {
      look = { ...next, layers: [...next.layers] };
      const has = (layer: LiveryLayer) => (next.layers.includes(layer) ? 1 : 0);
      uniforms.bodyLayerMask.value.set(has('roof'), has('lower'), has('bonnet'), has('nose'));
      uniforms.bodyLayerMask2.value.set(has('stripes'), has('flash'), next.pin ? 1 : 0, 0);
      uniforms.bodyLayerSecondary.value.set(next.secondary);
      uniforms.bodyLayerAccent.value.set(next.accent);
    },
    setFrame(f) {
      uniforms.bodyLayerA.value.set(f.belt, f.low, f.roof, 0);
      uniforms.bodyLayerB.value.set(f.windscreen, f.rearGlass, f.front, f.rear);
      uniforms.bodyLayerC.value.set(f.half, 0, 0, 0);
    },
  };
  handle.setFrame(frame);
  handle.setLook(NONE);
  handles.set(material, handle);
  chainShaderHook(material, 'body-livery-layers-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', GLSL, 'fragment');
  });
  return handle;
}
