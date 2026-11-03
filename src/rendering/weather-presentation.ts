import * as T from 'three';
import { H } from '../simulation/protocol.ts';
import { liquidRain } from '../simulation/weather.ts';
import { clamp } from '../core/math.ts';

export type WeatherSurface =
  | 'stone'
  | 'paving'
  | 'concrete'
  | 'timber'
  | 'metal'
  | 'paint'
  | 'kerb'
  | 'grass'
  | 'gravel'
  | 'fabric'
  | 'foliage'
  | 'rubber'
  | 'leather';
/** Art response, not a second water simulation. Porous surfaces darken but retain
 * broad highlights; cloth/vegetation never acquire a glass-like coat. */
export const WEATHER_SURFACES: Readonly<Record<WeatherSurface, readonly [number, number]>> = {
  stone: [0.25, 0.48],
  paving: [0.31, 0.38],
  concrete: [0.25, 0.48],
  timber: [0.22, 0.43],
  metal: [0.035, 0.25],
  paint: [0.1, 0.32],
  kerb: [0.12, 0.34],
  grass: [0.16, 0.78],
  gravel: [0.25, 0.62],
  fabric: [0.15, 0.78],
  foliage: [0.1, 0.56],
  rubber: [0.1, 0.48],
  leather: [0.08, 0.44],
};
/** Share of the snow a surface role holds on its upward faces (a roof or the
 * ground collects it all; a car body, rubber and leather none; foliage a
 * little). Art response, scaled by the scenery cover uniform. */
export const SNOW_CATCH: Readonly<Record<WeatherSurface, number>> = {
  stone: 0.85,
  paving: 0.9,
  concrete: 0.9,
  timber: 0.8,
  metal: 0.35,
  paint: 0.15,
  kerb: 0.6,
  grass: 1,
  gravel: 1,
  fabric: 0.5,
  foliage: 0.55,
  rubber: 0.05,
  leather: 0,
};
/** Road-state texture alpha maps 0..255 to 0..this many millimetres of snow /
 * ice cover (water equivalent). Shared by the uploader and the road shader. */
export const ROAD_COVER_FULL_SCALE_MM = 8;
/** Scenery snow cover 0..1, shared by every tagged outdoor material: set each
 * frame from the mean cover of the last recorded road-surface keyframe (so a
 * replay shows the cover its session had). Zero outside the snow preset. */
export const sceneryCoverUniform = { value: 0 };
/** Mean road cover (mm water equivalent) to the scenery's white coat: a trace
 * is nothing, about a millimetre (1 cm of snow) is a full white landscape. */
export function sceneryCover(meanFrozenMm: number) {
  return Number.isFinite(meanFrozenMm) ? smooth(0.05, 1, meanFrozenMm) : 0;
}
const roads = new WeakMap<T.Material, { value: T.Vector4 }>();
/** Share (0..1) of the road's settled marble coverage that is dust rather than
 * tyre rubber: set each frame from the snapshot's dust share and obscuration
 * (WeatherPresentation.update), read by every wet-road shader. One shared
 * uniform; zero everywhere outside a dust storm. */
export const roadDustUniform = { value: 0 };
/** Each road material owns a small uniform; its spatial water still comes from
 * the original track-state texture, including deposit-free pit cells. */
export function roadWeatherUniform(material: T.Material) {
  let uniform = roads.get(material);
  if (!uniform) {
    uniform = { value: new T.Vector4(0, 0, 0, 0) };
    roads.set(material, uniform);
  }
  return uniform;
}
function smooth(a: number, b: number, value: number) {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Replay-safe approximation for exposed non-road assets. Mean recorded track
 * water supplies a retained-wetness cue after rain stops; it is NOT local roof,
 * fabric saturation or off-track puddle simulation. */
export function surfaceDampness(rain: number, meanWater: number) {
  if (![rain, meanWater].every(Number.isFinite)) throw new Error('Invalid surface weather');
  return Math.max(smooth(0, 18, rain), smooth(0, 0.6, meanWater));
}
export function weatherSurface(material: T.Material): WeatherSurface | null {
  if (roads.has(material)) return null;
  const role: unknown = material.userData.weatherSurface ?? material.userData.venueFinish;
  return typeof role === 'string' && Object.hasOwn(WEATHER_SURFACES, role)
    ? (role as WeatherSurface)
    : null;
}

export type WeatherMask = 'uniform' | 'spectator' | 'impostor';
/** Assign explicit exposure and coverage before shader installation. Shelter is
 * an authored approximation, never a claim of simulated fabric saturation. */
export function tagWeatherSurface<M extends T.Material>(
  material: M,
  role: WeatherSurface,
  exposure = 1,
  mask: WeatherMask = 'uniform',
): M {
  if (
    !Object.hasOwn(WEATHER_SURFACES, role) ||
    !Number.isFinite(exposure) ||
    exposure < 0 ||
    exposure > 1 ||
    !['uniform', 'spectator', 'impostor'].includes(mask)
  )
    throw new Error('Invalid weather surface coverage');
  material.userData.weatherSurface = role;
  material.userData.weatherExposure = exposure;
  material.userData.weatherMask = mask;
  return material;
}

/** One snapshot observation shared by explicit outdoor material roles. No
 * geometry, textures, lights, render passes, allocations per frame or writes
 * back to simulation. Previous material hooks and instance/skin normals survive. */
export class WeatherPresentation {
  readonly surface = { value: new T.Vector4(0, 0, 0, 0) };
  private installed = new WeakSet<T.Material>();
  private roadUniforms = new Set<{ value: T.Vector4 }>();
  private counts: Partial<Record<WeatherSurface, number>> = {};
  install(root: T.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const m of Array.isArray(object.material) ? object.material : [object.material])
        this.installMaterial(m);
    });
  }
  installMaterial(material: T.Material) {
    const road = roads.get(material);
    if (road) this.roadUniforms.add(road);
    const role = weatherSurface(material);
    if (!role || this.installed.has(material) || !(material instanceof T.MeshStandardMaterial))
      return;
    const exposure: unknown = material.userData.weatherExposure ?? 1;
    const mask: unknown = material.userData.weatherMask ?? 'uniform';
    if (
      typeof exposure !== 'number' ||
      !Number.isFinite(exposure) ||
      exposure < 0 ||
      exposure > 1 ||
      typeof mask !== 'string' ||
      !['uniform', 'spectator', 'impostor'].includes(mask)
    )
      throw new Error('Invalid installed weather surface coverage');
    this.installed.add(material);
    this.counts[role] = (this.counts[role] ?? 0) + 1;
    const previous = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    const [darkening, wetRoughness] = WEATHER_SURFACES[role];
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.aurelSurfaceWeather = this.surface;
      if (mask !== 'uniform') {
        // The preceding crowd hook owns these masks. In the far impostor the
        // head mask is defined AFTER color_fragment, so weather must run only
        // after the entire color/roughness chain, before physical lighting.
        const coverage = mask === 'spectator' ? 'vCrowdCloth' : '(1.-headMask)';
        if (
          !shader.fragmentShader.includes(
            mask === 'spectator' ? 'varying float vCrowdCloth;' : 'float headMask =',
          )
        )
          throw new Error('Missing authored crowd weather mask');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec4 aurelSurfaceWeather;')
          .replace(
            '#include <lights_physical_fragment>',
            `
            float surfaceWet = aurelSurfaceWeather.x * ${(0.55 * exposure).toFixed(6)} * clamp(${coverage},0.,1.);
            diffuseColor.rgb *= 1.-surfaceWet*${darkening.toFixed(3)};
            roughnessFactor = mix(roughnessFactor, min(roughnessFactor, ${wetRoughness.toFixed(3)}), surfaceWet);
            #include <lights_physical_fragment>`,
          );
        return;
      }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vWeatherUp; varying vec3 vWeatherWorld;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vWeatherUp = inverseTransformDirection(transformedNormal, viewMatrix).y;
          vec4 weatherPosition = vec4(transformed, 1.);
          #ifdef USE_BATCHING
            weatherPosition = batchingMatrix * weatherPosition;
          #endif
          #ifdef USE_INSTANCING
            weatherPosition = instanceMatrix * weatherPosition;
          #endif
          vWeatherWorld = (modelMatrix * weatherPosition).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec4 aurelSurfaceWeather;
          uniform float aurelSnowCover;
          varying float vWeatherUp;
          varying vec3 vWeatherWorld;`,
        )
        .replace(
          '#include <lights_physical_fragment>',
          `// Apply weather after the complete dry finish and scanned maps.
          // Inserting at roughnessmap_fragment put this before previously
          // chained kerb/tyre assignments, which silently restored dry roughness.
          // Up-facing surfaces collect a film; verticals retain a subdued damp
          // response and downward-facing undersides remain dry. No roof-ray claim.
          float weatherUp = vWeatherUp;
          #ifdef DOUBLE_SIDED
            weatherUp *= gl_FrontFacing ? 1. : -1.;
          #endif
          float weatherExposure = smoothstep(-.15,.08,weatherUp) *
            mix(.22,1.,smoothstep(.08,.8,weatherUp));
          float weatherBroad = sin(vWeatherWorld.x*.73 + sin(vWeatherWorld.z*.37)) *
            sin(vWeatherWorld.z*.51 + vWeatherWorld.y*.23);
          float weatherResolved = 1.-smoothstep(.5,2.,length(fwidth(vWeatherWorld)));
          float surfaceWet = aurelSurfaceWeather.x * weatherExposure * ${exposure.toFixed(6)} *
            (.94 + .06*weatherBroad*weatherResolved);
          diffuseColor.rgb *= 1.-surfaceWet*${darkening.toFixed(3)};
          roughnessFactor = mix(roughnessFactor, min(roughnessFactor, ${wetRoughness.toFixed(3)}), surfaceWet);
          // Settled snow: upward faces whiten in proportion to the role's catch.
          // aurelSnowCover is exactly 0 outside the snow preset, so the mix is
          // an identity there.
          float surfaceSnow = aurelSnowCover * ${SNOW_CATCH[role].toFixed(3)} * smoothstep(.3,.85,weatherUp) *
            (.92 + .08*weatherBroad*weatherResolved);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.78,.82,.88), surfaceSnow);
          roughnessFactor = mix(roughnessFactor, .9, surfaceSnow);
          #include <lights_physical_fragment>`,
        );
      shader.uniforms.aurelSnowCover = sceneryCoverUniform;
    };
    material.customProgramCacheKey = () =>
      `${key}|aurel-snapshot-dampness-v4:${role}:${exposure}:${mask}`;
    material.needsUpdate = true;
  }
  update(frame: Float32Array, enabled = true, meanFrozenMm = 0) {
    const time = frame[H.TIME],
      // Below freezing the precipitation channel is snow: it wets nothing.
      rain = liquidRain(frame[H.RAIN], Number.isFinite(frame[H.AMBIENT]) ? frame[H.AMBIENT] : 20),
      water = frame[H.WATER];
    sceneryCoverUniform.value = enabled ? sceneryCover(meanFrozenMm) : 0;
    const windX = frame[H.WIND_X],
      windZ = frame[H.WIND_Z];
    if (![time, rain, water, windX, windZ].every(Number.isFinite) || time < 0)
      throw new Error('Invalid weather presentation snapshot');
    this.surface.value.set(enabled ? surfaceDampness(rain, water) : 0, time, rain, water);
    // Dust share of the air, scaled up from nothing as the bank thickens
    // (the same onset the renderer's dust look uses: 0.4 to 14 per km).
    const dust = frame[H.DUST],
      extinction = frame[H.EXTINCTION];
    roadDustUniform.value =
      enabled && Number.isFinite(dust) && Number.isFinite(extinction)
        ? clamp(dust, 0, 1) * smooth(0.4, 14, extinction)
        : 0;
    for (const uniform of this.roadUniforms)
      uniform.value.set(
        enabled ? clamp(rain, 0, 60) : 0,
        time,
        clamp(windX, -80, 80),
        clamp(windZ, -80, 80),
      );
  }
  diagnostics() {
    return {
      source: 'presented-snapshot' as const,
      dampness: this.surface.value.x,
      time: this.surface.value.y,
      rain: this.surface.value.z,
      meanWater: this.surface.value.w,
      materialRoles: { ...this.counts },
      roadMaterials: this.roadUniforms.size,
      offTrackWetness: 'mean-track-water-and-rain approximation' as const,
      extraTextures: 0,
      extraDraws: 0,
    };
  }
  dispose() {
    this.roadUniforms.clear();
  }
}
