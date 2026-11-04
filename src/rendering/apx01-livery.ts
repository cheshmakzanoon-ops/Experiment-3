import * as T from 'three';
import { canvasTexture } from './geometry.ts';
import {
  BRAND_ART,
  drawMark,
  drawWordmark,
  fitHeight,
  type Brand,
  type MarkArt,
} from './studio/brand-atlas.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/**
 * The player's APX-01 hero livery layer (vehicle art 3). The base livery
 * (`car-livery.ts`) is shared by all twelve team schemes and leaves the aero in
 * loud accent colour: on the VOLTEX car the volt-green front endplates were the
 * largest, flattest shape in every screenshot and the rear endplates carried a
 * dark gradient with nothing on it. This layer is the player car's own and rides
 * the same paint material (so wetness, damage and the flake all still apply):
 *
 *  - front endplates: indigo (the secondary) with a volt top rail and, on the
 *    outer face, the title sponsor along the plate;
 *  - rear endplates: indigo with a volt top rail, the title sponsor and a partner mark;
 *  - rear wing upper element: both partners on the top surface, in volt ink;
 *  - nothing else changes: the nose, the flank skins and the airbox keep the base scheme.
 *
 * Marks are the fictional brand atlas (`brand-atlas.ts`), drawn into one RGBA
 * atlas sampled by planar projection in car space (the plates are flat and face
 * the camera sideways; the wing element is nearly flat and is seen from above).
 * Everything is object space: no UV, no extra draw call, no light.
 */
export const HERO_DECAL_ATLAS = Object.freeze({ width: 1024, height: 512 });
/** Atlas rectangles (px, top-left origin): front endplate title, rear endplate title and partner, wing strip. */
export const HERO_DECAL_RECTS = Object.freeze({
  front: Object.freeze({ x: 0, y: 0, w: 512, h: 128 }),
  rear: Object.freeze({ x: 512, y: 0, w: 512, h: 256 }),
  wing: Object.freeze({ x: 0, y: 256, w: 1024, h: 128 }),
});
/** Car-space frame of each planar projection (m): where the plate or strip is. */
export const HERO_DECAL_FRAMES = Object.freeze({
  /** Front endplate outer face: z along the plate, y up. */
  front: Object.freeze({ z0: 2.26, z1: 2.71, y0: -0.325, y1: -0.15, xOuter: 0.965 }),
  /** Rear endplate outer face. */
  rear: Object.freeze({ z0: -2.3, z1: -1.78, y0: 0.2, y1: 0.43, xOuter: 0.835 }),
  /** Rear wing upper element, seen from above: x across, z along (reads from behind). */
  wing: Object.freeze({ x0: -0.78, x1: 0.78, z0: -2.265, z1: -2.05, y0: 0.55, y1: 0.66 }),
});
export const HERO_LIVERY_KEY = 'apx01-hero-livery-v1';

export interface HeroLiveryColours {
  secondary: string;
  accent: string;
  title: Brand | string;
  partners: readonly [Brand, Brand];
}
const inked = (art: MarkArt, ink: string, accent?: string): MarkArt => ({
  ...art,
  ink,
  accent: accent ?? (art.kind === 'wordmark' ? art.accent : ink),
});
function drawAtlas(context: CanvasRenderingContext2D, colours: HeroLiveryColours) {
  const { width, height } = HERO_DECAL_ATLAS;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const title = (box: { x: number; y: number; w: number; h: number }) => {
    const known = (BRAND_ART as Record<string, MarkArt | undefined>)[colours.title];
    if (known) drawMark(context, inked(known, '#ffffff'), box.x, box.y, box.w, box.h);
    else {
      // A player's own sponsor text: the stroke font, fitted to the box.
      context.strokeStyle = '#ffffff';
      const h = fitHeight(colours.title, box.w * 0.86, box.h * 0.5, {
        weight: 0.19,
        width: 1.04,
        slant: 0.14,
      });
      drawWordmark(context, colours.title, box.x + box.w / 2, box.y + box.h / 2, h, {
        weight: 0.19,
        width: 1.04,
        slant: 0.14,
      });
    }
  };
  const { front, rear, wing } = HERO_DECAL_RECTS;
  title(front);
  // Rear endplate: title in the upper half, the first partner under it.
  title({ x: rear.x, y: rear.y, w: rear.w, h: rear.h * 0.56 });
  drawMark(
    context,
    inked(BRAND_ART[colours.partners[0]], '#ffffff'),
    rear.x + rear.w * 0.08,
    rear.y + rear.h * 0.6,
    rear.w * 0.84,
    rear.h * 0.34,
  );
  // Wing strip: both partners, volt ink, side by side.
  drawMark(
    context,
    inked(BRAND_ART[colours.partners[1]], colours.accent),
    wing.x + wing.w * 0.04,
    wing.y + wing.h * 0.1,
    wing.w * 0.42,
    wing.h * 0.8,
  );
  drawMark(
    context,
    inked(BRAND_ART[colours.partners[0]], colours.accent),
    wing.x + wing.w * 0.54,
    wing.y + wing.h * 0.1,
    wing.w * 0.42,
    wing.h * 0.8,
  );
  context.restore();
}

const rectUv = (r: { x: number; y: number; w: number; h: number }) =>
  `vec4(${(r.x / HERO_DECAL_ATLAS.width).toFixed(5)}, ${(1 - (r.y + r.h) / HERO_DECAL_ATLAS.height).toFixed(5)}, ${(r.w / HERO_DECAL_ATLAS.width).toFixed(5)}, ${(r.h / HERO_DECAL_ATLAS.height).toFixed(5)})`;
const F = HERO_DECAL_FRAMES;
export const HERO_LIVERY_GLSL = `{
  vec3 hp = vPaintPosition;
  vec3 hpw = fwidth(hp) + 1e-5;
  float hx = abs(hp.x);
  float hFlip = hp.x >= 0.0 ? -1.0 : 1.0;
  vec3 heroPaint = diffuseColor.rgb;
  float heroTouched = 0.0;
  // Front endplates (both faces and the edge): indigo with a volt top rail.
  float fPlate = step(2.2, hp.z) * step(0.93, hx);
  float fRail = fPlate * smoothstep(-0.135 - hpw.y, -0.135 + hpw.y, hp.y);
  heroPaint = mix(heroPaint, heroSecondary, fPlate);
  heroPaint = mix(heroPaint, heroAccent, fRail);
  // Rear endplates: the same, with the rail on the plate's upper third.
  float rPlate = step(hp.z, -1.74) * step(0.78, hx) * step(hp.y, 0.7);
  float rRail = rPlate * (1.0 - smoothstep(0.012, 0.012 + hpw.y, abs(hp.y - 0.445)));
  heroPaint = mix(heroPaint, heroSecondary, rPlate);
  heroPaint = mix(heroPaint, heroAccent, rRail);
  heroTouched = max(fPlate, rPlate);
  vec4 decal = vec4(0.0);
  // Front endplate title on the outer face; text reads forward on the car's left, reversed side kept legible.
  vec2 fUv = vec2((hp.z - ${F.front.z0.toFixed(3)}) / ${(F.front.z1 - F.front.z0).toFixed(3)}, (hp.y - ${F.front.y0.toFixed(3)}) / ${(F.front.y1 - F.front.y0).toFixed(3)});
  fUv.x = hFlip > 0.0 ? fUv.x : 1.0 - fUv.x;
  float outward = step(0.7, vHeroN.x * (hp.x >= 0.0 ? 1.0 : -1.0));
  float fIn = outward * step(2.2, hp.z) * step(${F.front.xOuter.toFixed(3)}, hx) * step(0.0, fUv.x) * step(fUv.x, 1.0) * step(0.0, fUv.y) * step(fUv.y, 1.0);
  vec4 fRect = ${rectUv(HERO_DECAL_RECTS.front)};
  vec4 fTex = texture2D(heroDecals, fRect.xy + fUv * fRect.zw);
  decal = mix(decal, fTex, fIn);
  vec2 rUv = vec2((hp.z - ${F.rear.z0.toFixed(3)}) / ${(F.rear.z1 - F.rear.z0).toFixed(3)}, (hp.y - ${F.rear.y0.toFixed(3)}) / ${(F.rear.y1 - F.rear.y0).toFixed(3)});
  rUv.x = hFlip > 0.0 ? rUv.x : 1.0 - rUv.x;
  float rIn = outward * step(hp.z, -1.74) * step(${F.rear.xOuter.toFixed(3)}, hx) * step(0.0, rUv.x) * step(rUv.x, 1.0) * step(0.0, rUv.y) * step(rUv.y, 1.0);
  vec4 rRect = ${rectUv(HERO_DECAL_RECTS.rear)};
  vec4 rTex = texture2D(heroDecals, rRect.xy + rUv * rRect.zw);
  decal = mix(decal, rTex, rIn);
  // Rear wing upper element, from above: x across, text reads from behind the car.
  vec2 wUv = vec2((${F.wing.x1.toFixed(3)} - hp.x) / ${(F.wing.x1 - F.wing.x0).toFixed(3)}, (hp.z - ${F.wing.z0.toFixed(3)}) / ${(F.wing.z1 - F.wing.z0).toFixed(3)});
  float wIn = step(0.5, vHeroN.y) * step(${F.wing.y0.toFixed(3)}, hp.y) * step(hp.y, ${F.wing.y1.toFixed(3)}) * step(hx, ${F.wing.x1.toFixed(3)}) * step(0.0, wUv.x) * step(wUv.x, 1.0) * step(0.0, wUv.y) * step(wUv.y, 1.0);
  vec4 wRect = ${rectUv(HERO_DECAL_RECTS.wing)};
  vec4 wTex = texture2D(heroDecals, wRect.xy + wUv * wRect.zw);
  decal = mix(decal, wTex, wIn);
  heroPaint = mix(heroPaint, decal.rgb, decal.a);
  diffuseColor.rgb = heroPaint;
}`;

/** The decal atlas and colour uniforms of one player car. */
export class HeroLivery {
  readonly texture: T.CanvasTexture;
  readonly uniforms = {
    heroSecondary: { value: new T.Color() },
    heroAccent: { value: new T.Color() },
    heroDecals: { value: null as T.Texture | null },
  };
  private canvas: HTMLCanvasElement;
  constructor(private colours: HeroLiveryColours) {
    this.texture = canvasTexture(HERO_DECAL_ATLAS.width, HERO_DECAL_ATLAS.height, (c) =>
      drawAtlas(c, colours),
    );
    this.texture.name = 'APX-01 hero livery decal atlas';
    this.texture.userData.dynamic = true;
    this.canvas = this.texture.image as HTMLCanvasElement;
    this.uniforms.heroDecals.value = this.texture;
    this.uniforms.heroSecondary.value.set(colours.secondary);
    this.uniforms.heroAccent.value.set(colours.accent);
  }
  /** A livery edit: new colours and sponsor text, same texture object. */
  repaint(colours: HeroLiveryColours) {
    this.colours = colours;
    this.uniforms.heroSecondary.value.set(colours.secondary);
    this.uniforms.heroAccent.value.set(colours.accent);
    const context = this.canvas.getContext('2d');
    if (!context) return;
    drawAtlas(context, colours);
    this.texture.needsUpdate = true;
  }
  /** Chain the layer on a car paint material (after its base livery pattern). */
  install(material: T.Material) {
    const own = this.uniforms;
    return chainShaderHook(material, HERO_LIVERY_KEY, (shader) => {
      Object.assign(shader.uniforms, own);
      // The object-space normal tells an outer face (decal) from the inner face of the same plate.
      injectDeclarations(shader, 'common', 'varying vec3 vHeroN;', 'vertex');
      injectAfter(shader, 'begin_vertex', 'vHeroN = normal;', 'vertex');
      injectDeclarations(
        shader,
        'common',
        'varying vec3 vHeroN;\nuniform vec3 heroSecondary;\nuniform vec3 heroAccent;\nuniform sampler2D heroDecals;',
        'fragment',
      );
      injectAfter(shader, 'color_fragment', HERO_LIVERY_GLSL, 'fragment');
    });
  }
  dispose() {
    this.texture.dispose();
  }
}
