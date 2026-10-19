import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  F,
  H,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import type { ClosedSheet } from '../vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../vehicle-bodies/frame.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Original Festival finish study: refs 003/022 inform localized deposits;
 * refs 019/023 require clean upper paint and intact reflective/transmissive
 * glass. This projects recorded contact/weather observations, not another
 * fluid or dirt simulation. There is no accumulated render-time state. */
export const FESTIVAL_CAR_FINISH = Object.freeze({
  maxMaterials: 3,
  /** Rain is mm/hour; wheel-contact water is mm (protocol producers). */
  fullRainMmHr: 14,
  loadedWheelN: 30,
  /** Individual beads disappear once their millimetre relief is unresolved. */
  detailFadeStartM: 12,
  detailFadeEndM: 30,
});

export interface FestivalFinishObservation {
  rain: number;
  spray: number;
  wetness: number;
  dirt: number;
  soilWetness: number;
  airflow: number;
}
const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const unit = (value: number) => clamp(finite(value), 0, 1);

/** Rainfall and loaded contact water can wet the car. Global mean water is
 * deliberately not used: a dry car above/beside a wet road must remain dry.
 * W.DIRT is recorded tread coverage (0..1), not kilograms. Festival snapshots
 * currently leave O.MUD/MOISTURE zero; those optional carried-soil channels
 * can contribute when a producer actually supplies them. */
export function festivalFinishObservation(frame: Float32Array, id = 0): FestivalFinishObservation {
  const o = carBase(id);
  let contactWater = 0,
    treadDirt = 0;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    treadDirt += unit(frame[w + W.DIRT]) / 4;
    if (finite(frame[w + W.LOAD]) > FESTIVAL_CAR_FINISH.loadedWheelN)
      contactWater += clamp(finite(frame[w + W.WATER]), 0, 4) / 4;
  }
  const speed = Math.abs(finite(frame[o + F.SPEED]));
  const rain = unit(frame[H.RAIN] / FESTIVAL_CAR_FINISH.fullRainMmHr);
  const spray = unit((contactWater * speed) / 25);
  const carriedMud = unit(frame[o + OFFROAD_BASE + O.MUD]);
  const soilWetness = unit(frame[o + OFFROAD_BASE + O.MOISTURE]) * carriedMud;
  // Project velocity onto the chassis's +Z axis. Reverse runoff must not
  // follow the absolute speedometer or flip when the car changes world yaw.
  let airflow = 0;
  const x = frame[o + F.QX],
    y = frame[o + F.QY],
    z = frame[o + F.QZ],
    w = frame[o + F.QW];
  const norm = x * x + y * y + z * z + w * w;
  if ([x, y, z, w, norm].every(Number.isFinite) && norm > 1e-8) {
    const forwardX = (2 * (x * z + w * y)) / norm,
      forwardY = (2 * (y * z - w * x)) / norm,
      forwardZ = 1 - (2 * (x * x + y * y)) / norm;
    airflow = clamp(
      (finite(frame[o + F.VX]) * forwardX +
        finite(frame[o + F.VY]) * forwardY +
        finite(frame[o + F.VZ]) * forwardZ) /
        40,
      -1,
      1,
    );
  }
  return {
    rain,
    spray,
    wetness: Math.max(rain, spray),
    dirt: Math.max(treadDirt, carriedMud),
    soilWetness,
    airflow,
  };
}

interface FinishUniforms {
  /** Rain, contact spray, recorded dirt, carried-soil moisture. */
  festivalCarWeather: T.IUniform<T.Vector4>;
  /** Signed airflow and selected detail amount. */
  festivalCarMotion: T.IUniform<T.Vector2>;
  /** Road height, front/rear axle stations, half body width, all car-local m. */
  festivalCarShape: T.IUniform<T.Vector4>;
  festivalWorldToCar: T.IUniform<T.Matrix4>;
}
type FinishRole = 'paint' | 'glass';

const DECLARATIONS = /* glsl */ `
varying vec3 vFestivalCarPosition;
uniform vec4 festivalCarWeather;
uniform vec2 festivalCarMotion;
uniform vec4 festivalCarShape;
float festivalCarWater = 0.0;
float festivalCarGrime = 0.0;
float festivalCarRelief = 0.0;
float festivalFinishHash(vec2 p) {
  vec3 a = fract(vec3(p.xyx) * 0.1031);
  a += dot(a, a.yzx + 33.33);
  return fract((a.x + a.y) * a.z);
}
float festivalFinishNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(festivalFinishHash(i), festivalFinishHash(i + vec2(1.0, 0.0)), u.x),
    mix(festivalFinishHash(i + vec2(0.0, 1.0)), festivalFinishHash(i + vec2(1.0)), u.x), u.y);
  float pixel = max(length(dFdx(p)), length(dFdy(p)));
  return mix(n, 0.5, smoothstep(0.4, 1.2, pixel));
}
`;

/** Metre-space masks, not a UV texture over the entire car. Clean upper
 * panels retain their exact pigment/flake pipeline. Dirt is a sparse lower
 * film and tyre wake; wet beading never becomes bright painted polka dots. */
function surfaceGlsl(glass: boolean) {
  return /* glsl */ `{
  // Uniform branch: the clean/dry car keeps its original finish cheaply.
  if (max(festivalCarWeather.x, max(festivalCarWeather.y, festivalCarWeather.z)) > 0.001) {
  vec3 p = vFestivalCarPosition;
  vec3 px = dFdx(p), py = dFdy(p);
  float pixel = max(length(px), length(py));
  vec3 axis = abs(normalize(cross(px, py) + vec3(1.e-15)));
  float h = p.y - festivalCarShape.x;
  float flank = smoothstep(festivalCarShape.w * 0.42, festivalCarShape.w * 0.88, abs(p.x));
  float breakup = festivalFinishNoise(p.zy * vec2(9.0, 14.0));
  float low = 1.0 - smoothstep(0.16, 0.72, h + (breakup - 0.5) * 0.15);
  float aft = festivalCarShape.y - p.z;
  float frontWake = smoothstep(0.04, 0.25, aft) * (1.0 - smoothstep(1.25, 2.5, aft));
  float rearWake = 1.0 - smoothstep(festivalCarShape.z - 0.35, festivalCarShape.z + 0.18, p.z);
  float wake = flank * max(frontWake, rearWake) *
    (1.0 - smoothstep(0.34, 1.0, h + (breakup - 0.5) * 0.24));
  float contactReach = max(low, wake * 0.82);
  festivalCarWater = max(festivalCarWeather.x, festivalCarWeather.y * contactReach);
  float grain = festivalFinishNoise(p.zy * vec2(36.0, 53.0));
  float deposit = low * (0.065 + 0.09 * breakup) + wake * (0.045 + 0.1 * grain);
  festivalCarGrime = min(0.26, festivalCarWeather.z * deposit);
  ${glass ? 'festivalCarGrime *= 0.15; // glazing remains translucent, including when wet' : ''}
  float dampDirt = max(festivalCarWater, festivalCarWeather.w);
  vec3 soil = mix(vec3(0.17, 0.139, 0.10), vec3(0.048, 0.041, 0.032), dampDirt);
  diffuseColor.rgb *= 1.0 - festivalCarWater * ${glass ? '0.015' : '0.055'};
  diffuseColor.rgb = mix(diffuseColor.rgb, soil, festivalCarGrime);

  // Fixed droplet sites on the clear coat: ~2-4 mm beads with stretched
  // runoff on upright panels. Signed airflow angles the streaks. The near
  // relief fades before it becomes a sparkling subpixel pattern.
  float resolved = (1.0 - smoothstep(0.0014, 0.006, pixel)) * festivalCarMotion.y;
  resolved *= 1.0 - smoothstep(${FESTIVAL_CAR_FINISH.detailFadeStartM.toFixed(1)}, ${FESTIVAL_CAR_FINISH.detailFadeEndM.toFixed(1)}, length(vViewPosition));
  if (festivalCarWater > 0.001 && festivalCarMotion.y > 0.0) {
    vec2 sideUv = mix(p.xy, p.zy, smoothstep(0.3, 0.72, axis.x));
    sideUv.x += p.y * festivalCarMotion.x * 0.45;
    vec2 uv = mix(sideUv, p.xz, smoothstep(0.4, 0.85, axis.y));
    vec2 q = uv / vec2(0.026, mix(0.06, 0.026, axis.y));
    vec2 cell = floor(q);
    float seed = festivalFinishHash(cell);
    vec2 centre = vec2(0.28 + 0.44 * seed, 0.25 + 0.5 * festivalFinishHash(cell + 47.0));
    vec2 delta = fract(q) - centre;
    delta.y *= mix(0.46, 1.0, axis.y);
    float radius = 0.085 + seed * 0.085;
    float d = length(delta);
    float aa = max(fwidth(d), 0.002);
    float bead = (1.0 - smoothstep(radius - aa, radius + aa, d)) *
      smoothstep(0.26, 0.62, seed) * festivalCarWater;
    // Water has a curved raised profile; only normals/roughness change.
    float dome = max(0.0, 1.0 - d * d / max(radius * radius, 1.e-5));
    festivalCarRelief = bead * dome * 0.00014 * resolved;
  }
  }
}`;
}

function reliefNormal(name: 'normal' | 'clearcoatNormal') {
  return /* glsl */ `{
  if (festivalCarMotion.y > 0.0 && max(festivalCarWeather.x, festivalCarWeather.y) > 0.001) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 a = cross(dy, ${name}), b = cross(${name}, dx);
  float det = dot(dx, a);
  vec3 gradient = sign(det) *
    (dFdx(festivalCarRelief) * a + dFdy(festivalCarRelief) * b);
  ${name} = normalize(max(abs(det), 1.e-10) * ${name} - gradient);
  }
}`;
}

function installFinish(
  material: T.MeshPhysicalMaterial,
  uniforms: FinishUniforms,
  role: FinishRole,
) {
  const glass = role === 'glass';
  chainShaderHook(material, `festival-car-weather-${role}-v1`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectDeclarations(
      shader,
      'common',
      'varying vec3 vFestivalCarPosition;\nuniform mat4 festivalWorldToCar;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vFestivalCarPosition = (festivalWorldToCar * modelMatrix * vec4(transformed, 1.0)).xyz;',
      'vertex',
    );
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectAfter(shader, 'color_fragment', surfaceGlsl(glass), 'fragment');
    injectAfter(
      shader,
      'roughnessmap_fragment',
      glass
        ? 'roughnessFactor = min(1.0, roughnessFactor + festivalCarGrime * 0.25);'
        : `roughnessFactor = clamp(mix(roughnessFactor, max(0.15, roughnessFactor * 0.82),
          festivalCarWater * 0.7) + festivalCarGrime * 0.55, 0.03, 1.0);`,
      'fragment',
    );
    injectAfter(shader, 'normal_fragment_maps', reliefNormal('normal'), 'fragment');
    if (!glass) {
      injectAfter(
        shader,
        'metalnessmap_fragment',
        'metalnessFactor *= 1.0 - festivalCarGrime * 0.75;',
        'fragment',
      );
      injectAfter(
        shader,
        'clearcoat_normal_fragment_maps',
        `#ifdef USE_CLEARCOAT\n${reliefNormal('clearcoatNormal')}\n#endif`,
        'fragment',
      );
      injectAfter(
        shader,
        'lights_physical_fragment',
        `#ifdef USE_CLEARCOAT
          material.clearcoatRoughness = mix(material.clearcoatRoughness,
            0.022 + geometryRoughness, festivalCarWater * 0.7);
          material.clearcoat *= 1.0 - festivalCarGrime * 0.6;
        #endif`,
        'fragment',
      );
    }
  });
}

interface Replacement {
  mesh: T.Mesh;
  original: T.Material | T.Material[];
}

/** One followed closed road car only. Catalogue materials remain untouched:
 * owned clones retain the existing shader hooks and borrow all textures.
 * A garage body allocates at most three materials and no geometry/textures,
 * draws or render targets. Clear restores the exact material slots before
 * VehicleBodies releases its own original resources. */
export class FestivalCarFinish {
  private root: T.Object3D | null = null;
  private readonly clones = new Map<T.Material, T.MeshPhysicalMaterial>();
  private readonly replacements: Replacement[] = [];
  private readonly uniforms: FinishUniforms = {
    festivalCarWeather: { value: new T.Vector4() },
    festivalCarMotion: { value: new T.Vector2() },
    festivalCarShape: { value: new T.Vector4() },
    festivalWorldToCar: { value: new T.Matrix4() },
  };
  private observation = festivalFinishObservation(new Float32Array());
  private paintCount = 0;
  private glassCount = 0;
  private active = false;

  /** Return true only when the renderer's material registry needs a refresh. */
  bind(root: T.Object3D, definition: VehicleDefinition, sheet: ClosedSheet) {
    if (root === this.root) return false;
    this.clear();
    this.root = root;
    const shape = bodyFrame(definition);
    this.uniforms.festivalCarShape.value.set(
      shape.ground,
      shape.frontAxle,
      shape.rearAxle,
      sheet.width / 2,
    );
    const roles = new Map<T.MeshPhysicalMaterial, FinishRole>();
    root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      // These exact slots are per-car paint and accent in ClosedBodyModel.
      // Helmet, driver, lenses, chrome, carbon and cached wheel finishes stay
      // with their original materials and existing weather implementations.
      if (node.name === 'Body (lofted)' && Array.isArray(node.material))
        for (const i of [0, 3]) {
          const material = node.material[i];
          if (material instanceof T.MeshPhysicalMaterial && material.userData.paintFinish)
            roles.set(material, 'paint');
        }
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (material instanceof T.MeshPhysicalMaterial && material.userData.vehicleGlass)
          roles.set(material, 'glass');
    });
    for (const [source, role] of roles) {
      if (this.clones.size >= FESTIVAL_CAR_FINISH.maxMaterials) break;
      const clone = source.clone();
      // Material.copy intentionally omits callbacks. Keep the original
      // Fresnel/paint/IBL chain explicitly; the house chain tracks keys on
      // the hook function, so appending our hook does not modify the source.
      clone.onBeforeCompile = source.onBeforeCompile;
      clone.customProgramCacheKey = source.customProgramCacheKey;
      clone.name = `${source.name || role} · Festival contact finish`;
      installFinish(clone, this.uniforms, role);
      this.clones.set(source, clone);
      if (role === 'paint') this.paintCount++;
      else this.glassCount++;
    }
    root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const original = node.material;
      const materials = Array.isArray(original) ? original : [original];
      if (!materials.some((m) => this.clones.has(m))) return;
      this.replacements.push({ mesh: node, original });
      const next = materials.map((m) => this.clones.get(m) ?? m);
      node.material = Array.isArray(original) ? next : next[0];
    });
    return this.clones.size > 0;
  }

  update(frame: Float32Array, detail: boolean, active = true) {
    this.active = active && !!this.root;
    const observation = festivalFinishObservation(frame);
    this.observation = observation;
    const { rain, spray, dirt, soilWetness, airflow } = observation;
    this.uniforms.festivalCarWeather.value.set(rain, spray, dirt, soilWetness);
    this.uniforms.festivalCarMotion.value.set(airflow, detail && this.active ? 1 : 0);
    if (this.root) {
      this.root.updateWorldMatrix(true, false);
      this.uniforms.festivalWorldToCar.value.copy(this.root.matrixWorld).invert();
    }
  }

  get stats() {
    return {
      active: this.active,
      materials: this.clones.size,
      paintMaterials: this.paintCount,
      glassMaterials: this.glassCount,
      detail: this.uniforms.festivalCarMotion.value.y,
      ...this.observation,
      addedDraws: 0,
      addedTriangles: 0,
      addedTextures: 0,
    };
  }

  clear() {
    for (const { mesh, original } of this.replacements) mesh.material = original;
    this.replacements.length = 0;
    for (const clone of this.clones.values()) clone.dispose();
    this.clones.clear();
    this.root = null;
    this.paintCount = this.glassCount = 0;
    this.active = false;
    this.uniforms.festivalCarWeather.value.set(0, 0, 0, 0);
    this.uniforms.festivalCarMotion.value.set(0, 0);
    this.observation = festivalFinishObservation(new Float32Array());
  }

  dispose() {
    this.clear();
  }
}
