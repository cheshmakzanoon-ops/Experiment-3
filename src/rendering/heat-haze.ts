import * as T from 'three';
import { F, carBase } from '../simulation/protocol.ts';
import { STUDIO_MAX_CARS } from './studio/studio-frame.ts';

/**
 * Exhaust heat haze (High and Ultra): a refractive shimmer of the air behind a
 * running car's tailpipe.
 *
 * Hot exhaust gas (several hundred degrees at the outlet) has a refractive index
 * measurably below that of the surrounding air, and turbulent mixing makes the
 * boundary between them flicker, so the view of anything seen *through* the
 * plume wobbles by a few pixels. It is rendered in the scene composite as a
 * small uv displacement of the linear scene colour, no extra draw call or pass:
 *
 *  - up to `maxSources` plumes (the nearest running cars); each is a tapering
 *    cone from the outlet along the car's rearward axis, in view space;
 *  - per pixel, the view ray is marched through the cone's bounding sphere
 *    (`steps` jittered samples), but only the part of the path in FRONT of the
 *    pixel's own surface counts (the depth test: the refracting air must lie
 *    between the eye and what is seen, so a foreground car is never smeared);
 *    each sample adds a smooth turbulence vector weighted by the cone density;
 *  - the pattern streams along the axis with presented simulation time
 *    (deterministic: held and paused frames are identical, replays repeat); the
 *    summed displacement is capped, scaled to `pixels` at 1080p (with the frame
 *    height), and weighted by the throttle and the distance to the car;
 *  - a displaced sample that lands on a much nearer surface (a foreground
 *    silhouette) is discarded. Pixels whose ray misses every bounding sphere
 *    cost one sphere test per source.
 */
export const HEAT_HAZE = Object.freeze({
  maxSources: 4,
  /** Tailpipe outlet and flow direction in the car frame (+Z nose). The outlet
   * is the lip of the authored pipe (see EXHAUST_TINT); gas leaves rearward and
   * a little upward (buoyancy). */
  outlet: Object.freeze([0, -0.076, -2.215] as const),
  flow: Object.freeze([0, 0.12, -1] as const),
  /** Plume radius at the outlet and per metre of travel (turbulent spreading), m. */
  radius: 0.14,
  spread: 0.16,
  /** Plume length at rest and extra length per m/s of car speed (capped), m. */
  length: 3,
  lengthPerSpeed: 0.04,
  maxLength: 7,
  /** Peak displacement at 1080p, pixels. */
  pixels: 3.6,
  /** Strength at idle and at full throttle (exhaust gas is hot at any load;
   * a turbocharged hybrid's outlet never runs cool). */
  idle: 0.45,
  full: 1,
  /** Turbulence cycles per metre and the speed the pattern streams away from
   * the outlet (m/s). */
  frequency: 2.4,
  /** Displacement units per metre of ray path through full-density plume. */
  perMetre: 2.2,
  /** Samples along each ray's path through a plume. */
  steps: 6,
  flowSpeed: 7,
  /** Sources beyond this distance fade out, m. */
  fadeNear: 28,
  fadeFar: 55,
  /** A displaced sample nearer than the pixel's own surface by more than this
   * is a foreground edge and is rejected, m. */
  foregroundTolerance: 0.4,
});

export interface HeatHazeUniforms extends Record<string, T.IUniform> {
  hazeCount: T.IUniform<number>;
  /** View-space outlet (xyz) and the radius at the outlet. */
  hazeOrigin: T.IUniform<T.Vector4[]>;
  /** View-space unit axis (xyz) and plume length. */
  hazeAxis: T.IUniform<T.Vector4[]>;
  /** (strength 0..1, spread per metre, seed, 0). */
  hazeParam: T.IUniform<T.Vector4[]>;
  hazeTime: T.IUniform<number>;
  /** Peak displacement in pixels at the current frame height. */
  hazePixels: T.IUniform<number>;
}

export function createHeatHazeUniforms(): HeatHazeUniforms {
  const vectors = () => Array.from({ length: HEAT_HAZE.maxSources }, () => new T.Vector4());
  return {
    hazeCount: { value: 0 },
    hazeOrigin: { value: vectors() },
    hazeAxis: { value: vectors() },
    hazeParam: { value: vectors() },
    hazeTime: { value: 0 },
    hazePixels: { value: HEAT_HAZE.pixels },
  };
}

/** The composite's `heatHazeUv(vec2 uv, float z)`: the uv to read the scene
 * colour at. Needs `viewAtZ`, `viewZAt` and `colorResolution` from the host
 * shader (scene-ambient-pass.ts). */
export const HEAT_HAZE_GLSL = /* glsl */ `
  #define HAZE_MAX ${HEAT_HAZE.maxSources}
  #define HAZE_STEPS ${HEAT_HAZE.steps}
  uniform int hazeCount;
  uniform vec4 hazeOrigin[HAZE_MAX];
  uniform vec4 hazeAxis[HAZE_MAX];
  uniform vec4 hazeParam[HAZE_MAX];
  uniform float hazeTime;
  uniform float hazePixels;
  // Smooth quasi-periodic turbulence: three incommensurate waves per channel.
  vec2 hazeSwirl(vec3 q) {
    return vec2(
      sin(dot(q, vec3(1.7, 2.3, 0.9)) + 0.3) + 0.7 * sin(dot(q, vec3(3.1, -1.9, 2.7)) + 2.1) +
        0.5 * sin(dot(q, vec3(2.3, 4.1, -3.3)) + 4.0),
      sin(dot(q, vec3(-1.3, 2.9, 2.1)) + 1.1) + 0.7 * sin(dot(q, vec3(2.7, 2.2, -2.9)) + 3.3) +
        0.5 * sin(dot(q, vec3(4.3, -2.7, 1.9)) + 5.2)) * 0.46;
  }
  vec2 heatHazeUv(vec2 uv, float z) {
    // z is the pixel's own (negative) view depth.
    vec3 ray = normalize(viewAtZ(uv, -1.0));
    float surface = z / ray.z;
    float jitter = interleavedNoise(floor(uv * colorResolution) + vec2(3.0, 7.0));
    vec2 offset = vec2(0.0);
    for (int i = 0; i < HAZE_MAX; i++) {
      if (i >= hazeCount) break;
      vec3 o = hazeOrigin[i].xyz;
      vec3 axis = hazeAxis[i].xyz;
      float radius0 = hazeOrigin[i].w, plume = hazeAxis[i].w;
      float strength = hazeParam[i].x, spread = hazeParam[i].y, seed = hazeParam[i].z;
      // Bounding sphere of the cone: the part of this ray inside it is the path
      // that can refract; only the part in front of the surface counts.
      vec3 centre = o + axis * (0.5 * plume);
      float bound = length(vec2(0.5 * plume, radius0 + spread * plume));
      float sc = dot(ray, centre);
      float miss2 = dot(centre, centre) - sc * sc;
      if (sc < -bound || miss2 > bound * bound) continue;
      float chord = sqrt(max(bound * bound - miss2, 0.0));
      float s0 = max(sc - chord, 0.05), s1 = min(sc + chord, surface);
      if (s1 <= s0) continue;
      float dl = (s1 - s0) / float(HAZE_STEPS);
      vec3 u = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 v = cross(axis, u);
      vec2 path = vec2(0.0);
      for (int k = 0; k < HAZE_STEPS; k++) {
        float sk = s0 + (float(k) + jitter) * dl;
        vec3 p = ray * sk - o;
        float t = dot(p, axis);
        if (t < 0.0 || t > plume) continue;
        vec3 lateral = p - axis * t;
        float r = radius0 + spread * t;
        float density = (1.0 - smoothstep(0.25 * r, r, length(lateral))) *
          (1.0 - smoothstep(0.3 * plume, plume, t));
        if (density <= 0.0) continue;
        // The pattern streams away from the outlet at flowSpeed.
        vec3 q = vec3(t - hazeTime * ${HEAT_HAZE.flowSpeed.toFixed(2)}, dot(lateral, u), dot(lateral, v)) *
          ${(HEAT_HAZE.frequency * 6.2832).toFixed(2)} + seed;
        path += hazeSwirl(q) * (density * dl);
      }
      offset += path * (${HEAT_HAZE.perMetre.toFixed(2)} * strength);
    }
    float magnitude = length(offset);
    if (magnitude < 1e-4) return uv;
    // Bounded so a ray running the whole plume cannot tear the image.
    offset *= min(magnitude, 1.5) / magnitude;
    vec2 hazed = uv + offset * hazePixels / colorResolution;
    // A much nearer sample is a foreground silhouette: keep the pixel's own colour.
    if (viewZAt(hazed) > z + ${HEAT_HAZE.foregroundTolerance.toFixed(2)}) return uv;
    return hazed;
  }
`;

/** CPU half: places each plume in view space. */
export class HeatHaze {
  readonly uniforms = createHeatHazeUniforms();
  /** Sources written by the last `update`. */
  count = 0;
  private readonly origin = new T.Vector3();
  private readonly axis = new T.Vector3();
  private readonly flow = new T.Vector3(...HEAT_HAZE.flow).normalize();
  private readonly outlet = new T.Vector3(...HEAT_HAZE.outlet);
  private readonly candidates: { id: number; distance: number }[] = [];

  /** No haze this frame (menu, showroom, disabled): the composite skips it. */
  clear() {
    this.count = 0;
    this.uniforms.hazeCount.value = 0;
  }

  /**
   * @param presented presented snapshot (speed, throttle)
   * @param camera main camera with current world matrices
   * @param carNow chassis-to-world matrices by car id (`studioCarNow`)
   * @param cars number of cars in the frame
   * @param height frame height in pixels (amplitude scales with it)
   */
  update(
    presented: Float32Array,
    camera: T.PerspectiveCamera,
    carNow: readonly T.Matrix4[],
    cars: number,
    time: number,
    height: number,
  ) {
    const u = this.uniforms;
    const total = Math.max(0, Math.min(STUDIO_MAX_CARS, Math.floor(cars)));
    this.candidates.length = 0;
    const view = camera.matrixWorldInverse;
    for (let id = 0; id < total; id++) {
      const o = carBase(id);
      if (presented[o + F.RETIRED] > 0.5) continue;
      this.origin.copy(this.outlet).applyMatrix4(carNow[id]).applyMatrix4(view);
      // Behind the camera or too far away: nothing to see.
      const distance = -this.origin.z;
      if (distance < -4 || distance > HEAT_HAZE.fadeFar) continue;
      this.candidates.push({ id, distance: Math.max(0, distance) });
    }
    this.candidates.sort((a, b) => a.distance - b.distance);
    const count = Math.min(HEAT_HAZE.maxSources, this.candidates.length);
    for (let i = 0; i < count; i++) {
      const { id, distance } = this.candidates[i];
      const o = carBase(id);
      const speed = Math.max(0, presented[o + F.SPEED] || 0);
      const throttle = Math.min(1, Math.max(0, presented[o + F.THROTTLE] || 0));
      const fade = 1 - smooth(HEAT_HAZE.fadeNear, HEAT_HAZE.fadeFar, distance);
      const strength = (HEAT_HAZE.idle + (HEAT_HAZE.full - HEAT_HAZE.idle) * throttle) * fade;
      this.origin.copy(this.outlet).applyMatrix4(carNow[id]).applyMatrix4(view);
      this.axis.copy(this.flow).transformDirection(carNow[id]).transformDirection(view);
      const length = Math.min(
        HEAT_HAZE.maxLength,
        HEAT_HAZE.length + HEAT_HAZE.lengthPerSpeed * speed,
      );
      u.hazeOrigin.value[i].set(this.origin.x, this.origin.y, this.origin.z, HEAT_HAZE.radius);
      u.hazeAxis.value[i].set(this.axis.x, this.axis.y, this.axis.z, length);
      u.hazeParam.value[i].set(strength, HEAT_HAZE.spread, id * 13.7, 0);
    }
    this.count = count;
    u.hazeCount.value = count;
    u.hazeTime.value = Number.isFinite(time) ? time : 0;
    u.hazePixels.value = (HEAT_HAZE.pixels * Math.max(1, height)) / 1080;
  }
}

function smooth(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
