import * as T from 'three';
import { H } from '../simulation/protocol.ts';
import { Track, trackPoint } from '../simulation/track.ts';

export interface FogPocket {
  x: number;
  z: number;
  radius: number;
  floor: number;
  scaleHeight: number;
}
/** Authored low-lying districts, sampled from the same original road geometry. */
export function fogPockets(track: Track): readonly FogPocket[] {
  const p = trackPoint();
  return [0.18, 0.49, 0.79].map((fraction, i) => {
    track.at(track.length * fraction, p);
    return {
      x: p.x + p.nx * (i === 1 ? -45 : 35),
      z: p.z + p.nz * (i === 1 ? -45 : 35),
      radius: [145, 110, 160][i],
      floor: p.y - 0.5,
      scaleHeight: [5, 3.5, 6][i],
    };
  });
}
export function atmosphereDensity(cloud: number, rain: number) {
  if (![cloud, rain].every(Number.isFinite)) throw new Error('Invalid atmosphere observation');
  return (
    Math.max(0, Math.min(1, (cloud - 0.62) / 0.38)) * 0.00055 +
    (Math.max(0, Math.min(20, rain)) / 20) * 0.0022
  );
}
/** CPU reference for regression checks; density is continuous at every boundary. */
export function pocketDensity(p: FogPocket, x: number, y: number, z: number) {
  if (
    ![p.x, p.z, p.radius, p.floor, p.scaleHeight, x, y, z].every(Number.isFinite) ||
    p.radius <= 0 ||
    p.scaleHeight <= 0
  )
    throw new Error('Invalid fog pocket');
  const r2 = ((x - p.x) ** 2 + (z - p.z) ** 2) / p.radius ** 2;
  return Math.exp(-3 * r2) * Math.exp(-Math.max(0, y - p.floor) / p.scaleHeight);
}

const GAUSS = [
  [0.019855071751, 0.050614268145],
  [0.101666761293, 0.111190517227],
  [0.237233795042, 0.156853322939],
  [0.408282678752, 0.181341891689],
  [0.591717321248, 0.181341891689],
  [0.762766204958, 0.156853322939],
  [0.898333238707, 0.111190517227],
  [0.980144928249, 0.050614268145],
] as const;
/** CPU counterpart of the localized ray integral. Sampling the entire ray at
 * only three positions can miss a narrow pocket behind a long broadcast shot.
 * Restrict quadrature to each pocket's support instead; work remains bounded. */
export function fogSegmentIntegral(pockets: readonly FogPocket[], from: T.Vector3, to: T.Vector3) {
  if (![...from.toArray(), ...to.toArray()].every(Number.isFinite))
    throw new Error('Invalid fog ray');
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const lateral2 = dx * dx + dz * dz,
    length = Math.hypot(dx, dy, dz);
  let integral = 0;
  for (const p of pockets) {
    pocketDensity(p, from.x, from.y, from.z); // Validate even a non-intersecting pocket.
    let begin = 0,
      end = 1;
    if (lateral2 > 1e-10) {
      const centre = ((p.x - from.x) * dx + (p.z - from.z) * dz) / lateral2;
      const span = (2 * p.radius) / Math.sqrt(lateral2);
      begin = Math.max(0, centre - span);
      end = Math.min(1, centre + span);
    }
    if (end <= begin) continue;
    for (const [node, weight] of GAUSS) {
      const t = begin + (end - begin) * node;
      integral +=
        (end - begin) *
        weight *
        pocketDensity(p, from.x + dx * t, from.y + dy * t, from.z + dz * t);
    }
  }
  return length * integral;
}

/** Analytic local height haze evaluated along the visible fragment's sightline.
 * This is depth-aware single-scattering-style attenuation, not a volumetric
 * shadow simulation. It has no meshes, new draw calls or independent weather. */
export class LocalAtmosphere {
  readonly pockets: readonly FogPocket[];
  readonly sigma = { value: 0 };
  private readonly volumes: { value: T.Vector4[] };
  private readonly heights: { value: T.Vector3 };
  private readonly floors: { value: T.Vector3 };
  private installed = new WeakSet<T.Material>();
  materialCount = 0;
  constructor(track: Track) {
    this.pockets = fogPockets(track);
    this.volumes = {
      value: this.pockets.map((p) => new T.Vector4(p.x, p.z, 1 / (p.radius * p.radius), p.floor)),
    };
    this.heights = {
      value: new T.Vector3(
        ...(this.pockets.map((p) => 1 / p.scaleHeight) as [number, number, number]),
      ),
    };
    this.floors = {
      value: new T.Vector3(...(this.pockets.map((p) => p.floor) as [number, number, number])),
    };
  }
  update(frame: Float32Array, enabled: boolean) {
    const density = atmosphereDensity(frame[H.CLOUD], frame[H.RAIN]);
    this.sigma.value = enabled ? density : 0;
  }
  install(root: T.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh || object instanceof T.Points)) return;
      for (const m of Array.isArray(object.material) ? object.material : [object.material])
        this.installMaterial(m);
    });
  }
  installMaterial(material: T.Material) {
    if (
      this.installed.has(material) ||
      !(
        material instanceof T.MeshStandardMaterial ||
        material instanceof T.MeshLambertMaterial ||
        material instanceof T.MeshPhongMaterial ||
        (material instanceof T.ShaderMaterial &&
          ['position', 'center'].includes(material.userData.localWeatherPosition as string))
      )
    )
      return;
    const particle = material instanceof T.ShaderMaterial;
    const position = particle ? (material.userData.localWeatherPosition as string) : 'transformed';
    this.installed.add(material);
    this.materialCount++;
    const previous = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.apexLocalSigma = this.sigma;
      shader.uniforms.apexFogVolumes = this.volumes;
      shader.uniforms.apexFogHeights = this.heights;
      shader.uniforms.apexFogFloors = this.floors;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <fog_pars_vertex>',
          `
        #include <fog_pars_vertex>
        #ifdef USE_FOG
          varying vec3 vApexFogWorld;
        #endif`,
        )
        .replace(
          '#include <fog_vertex>',
          `
          #include <fog_vertex>
          #ifdef USE_FOG
            vec4 apexFogPosition = vec4(${position},1.);
            ${
              particle
                ? ''
                : `#ifdef USE_BATCHING
              apexFogPosition = batchingMatrix * apexFogPosition;
            #endif
            #ifdef USE_INSTANCING
              apexFogPosition = instanceMatrix * apexFogPosition;
            #endif`
            }
            vApexFogWorld = (modelMatrix * apexFogPosition).xyz;
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <fog_pars_fragment>',
          `
        #include <fog_pars_fragment>
        #ifdef USE_FOG
          varying vec3 vApexFogWorld;
          uniform float apexLocalSigma;
          uniform vec4 apexFogVolumes[3];
          uniform vec3 apexFogHeights;
          uniform vec3 apexFogFloors;
          float apexLocalDensity(vec3 p) {
            vec3 dx = vec3(p.x)-vec3(apexFogVolumes[0].x,apexFogVolumes[1].x,apexFogVolumes[2].x);
            vec3 dz = vec3(p.z)-vec3(apexFogVolumes[0].y,apexFogVolumes[1].y,apexFogVolumes[2].y);
            vec3 inverseRadius = vec3(apexFogVolumes[0].z,apexFogVolumes[1].z,apexFogVolumes[2].z);
            vec3 lateral = exp(-3.*(dx*dx+dz*dz)*inverseRadius);
            vec3 vertical = exp(-max(vec3(0.),vec3(p.y)-apexFogFloors)*apexFogHeights);
            return dot(lateral,vertical);
          }
          float apexPocketDensity(vec3 p, vec4 volume, float inverseHeight) {
            vec2 delta=p.xz-volume.xy;
            return exp(-3.*dot(delta,delta)*volume.z) *
              exp(-max(0.,p.y-volume.w)*inverseHeight);
          }
          float apexPocketIntegral(vec3 origin, vec3 ray, vec4 volume, float inverseHeight) {
            float lateral2=dot(ray.xz,ray.xz), begin=0., end=1.;
            if(lateral2>1.e-10) {
              float centre=dot(volume.xy-origin.xz,ray.xz)/lateral2;
              float span=2.*inversesqrt(volume.z*lateral2);
              begin=max(0.,centre-span); end=min(1.,centre+span);
            }
            if(end<=begin) return 0.;
            vec3 start=origin+ray*begin, segment=ray*(end-begin);
            return (end-begin)*(
              apexPocketDensity(start+segment*0.019855071751,volume,inverseHeight)*0.050614268145 +
              apexPocketDensity(start+segment*0.101666761293,volume,inverseHeight)*0.111190517227 +
              apexPocketDensity(start+segment*0.237233795042,volume,inverseHeight)*0.156853322939 +
              apexPocketDensity(start+segment*0.408282678752,volume,inverseHeight)*0.181341891689 +
              apexPocketDensity(start+segment*0.591717321248,volume,inverseHeight)*0.181341891689 +
              apexPocketDensity(start+segment*0.762766204958,volume,inverseHeight)*0.156853322939 +
              apexPocketDensity(start+segment*0.898333238707,volume,inverseHeight)*0.111190517227 +
              apexPocketDensity(start+segment*0.980144928249,volume,inverseHeight)*0.050614268145);
          }
        #endif`,
        )
        .replace(
          '#include <fog_fragment>',
          `
          #include <fog_fragment>
          #ifdef USE_FOG
            if (apexLocalSigma > 0.) {
              vec3 apexRay = vApexFogWorld-cameraPosition;
              float apexLength = length(apexRay);
              // Localized quadrature keeps narrow haze visible from distant cameras.
              float apexIntegral = apexPocketIntegral(cameraPosition,apexRay,apexFogVolumes[0],apexFogHeights.x)
                + apexPocketIntegral(cameraPosition,apexRay,apexFogVolumes[1],apexFogHeights.y)
                + apexPocketIntegral(cameraPosition,apexRay,apexFogVolumes[2],apexFogHeights.z);
              float apexFog = 1.-exp(-min(8.,apexLocalSigma*apexLength*apexIntegral));
              gl_FragColor.rgb = mix(gl_FragColor.rgb,fogColor,apexFog);
            }
          #endif`,
        );
    };
    material.customProgramCacheKey = () => key + '|apex-local-atmosphere-v2-localized-ray';
    material.needsUpdate = true;
  }
  diagnostics() {
    return {
      sigma: this.sigma.value,
      pocketCount: this.pockets.length,
      materialCount: this.materialCount,
    };
  }
}
