import * as T from 'three';
import type { TrackPoint } from '../../simulation/track.ts';
import { trackPoint } from '../../simulation/track.ts';
import type { RoadEdge, RoadNetwork } from '../../simulation/open-world/road-network.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';

/** Metres throughout. These are original maintenance/wear cues, not a
 * generated racing line, tyre marks from an unobserved run, or collision
 * defects. Road repairs do not alter the simulation's running surface. */
export const FESTIVAL_ROAD_SURFACE = Object.freeze({
  repairCell: 58,
  repairChance: 0.34,
  repairLength: Object.freeze([2.2, 7.6] as const),
  repairHalfWidth: Object.freeze([0.62, 1.55] as const),
  sealHalfWidth: 0.025,
  wheelOffset: 0.79,
  wheelHalfWidth: 0.24,
  normalSample: 0.5,
});

/** A differential frame over the same crowned, banked road that physics
 * samples. The two along-road samples stay on this edge, including at its
 * endpoints. Both crossfall and the change of bank along a bend contribute
 * to the normal; normalising just (-gradient, 1, -bank) would miss the latter.
 * One pair of samples is reused across a complete vertex row. */
export class FestivalRoadFrame {
  private station = Number.NaN;
  private readonly before = trackPoint();
  private readonly after = trackPoint();
  private readonly along = new T.Vector3();
  private readonly across = new T.Vector3();
  private readonly result = new T.Vector3();
  constructor(
    private readonly network: RoadNetwork,
    private readonly edge: RoadEdge,
  ) {}

  private at(station: number, out: TrackPoint) {
    if (station <= this.edge.offset) this.network.pointOnSegment(this.edge.first, 0, out);
    else if (station >= this.edge.offset + this.edge.length)
      this.network.pointOnSegment(this.edge.last - 1, 1, out);
    else this.network.at(station, out);
  }

  private height(point: TrackPoint, lateral: number, shoulder: boolean) {
    const { halfWidth, crown, shoulder: width } = this.edge.spec;
    const y = this.network.surfaceHeight(point, lateral, halfWidth, crown);
    // This is the existing rendered shoulder cross-section in roads.ts:
    // inner edge -5 mm, outer edge -60 mm minus 3% of the shoulder width.
    if (!shoulder || width <= 0) return y;
    return y - 0.005 - ((Math.abs(lateral) - halfWidth) / width) * (0.055 + width * 0.03);
  }

  /** Reused result: copy its components before asking for the next normal. */
  normal(point: TrackPoint, lateral: number, shoulder = false): T.Vector3 {
    if (this.station !== point.s) {
      this.station = point.s;
      this.at(point.s - FESTIVAL_ROAD_SURFACE.normalSample, this.before);
      this.at(point.s + FESTIVAL_ROAD_SURFACE.normalSample, this.after);
    }
    const a = this.before,
      b = this.after,
      { halfWidth, crown, shoulder: width } = this.edge.spec;
    this.along.set(
      b.x + b.nx * lateral - a.x - a.nx * lateral,
      this.height(b, lateral, shoulder) - this.height(a, lateral, shoulder),
      b.z + b.nz * lateral - a.z - a.nz * lateral,
    );
    const low = Math.max(-halfWidth, lateral - 0.04),
      high = Math.min(halfWidth, lateral + 0.04);
    const crossfall =
      shoulder && width > 0
        ? -Math.sign(lateral) * (0.055 / width + 0.03)
        : (this.network.surfaceHeight(point, high, halfWidth, crown) -
            this.network.surfaceHeight(point, low, halfWidth, crown)) /
          Math.max(1e-8, high - low);
    this.across.set(point.nx, crossfall, point.nz);
    this.result.crossVectors(this.along, this.across);
    // At a few existing tight junctions the offset ribbon parameterisation
    // turns back. It is still the top running surface, not an underside.
    if (this.result.y < 0) this.result.negate();
    return this.result.lengthSq() > 1e-16 ? this.result.normalize() : this.result.set(0, 1, 0);
  }
}

/** Geometry metadata: road half-width, actual lane pitch (0 on closed
 * circuits and the runway),
 * deterministic edge identity and wear admission around junction mouths.
 * Stored per vertex so differently sized roads retain the same material and
 * existing spatial batches. */
export function festivalRoadProfile(
  network: RoadNetwork,
  edge: RoadEdge,
  station: number,
): readonly [number, number, number, number] {
  const half = edge.spec.halfWidth;
  const lane =
    edge.roadClass === 'runway' || edge.roadClass === 'circuit'
      ? 0
      : half / (edge.roadClass === 'highway' ? 2 : 1);
  const mouth = half + 9;
  let admission = 1;
  for (const [node, distance] of [
    [edge.from, station],
    [edge.to, edge.length - station],
  ] as const) {
    if (network.nodes[node].edges.length < 3) continue;
    const t = T.MathUtils.clamp((distance - mouth) / 6, 0, 1);
    admission = Math.min(admission, t * t * (3 - 2 * t));
  }
  return [half, lane, edge.index + 17, admission];
}

/** Closed courses have no public-road lane pitch. Give their material a
 * separate admission and the signed curvature sampled by the road frame.
 * Public roads and runways retain their existing lane-specific treatment. */
export function festivalSurfaceContext(
  edge: RoadEdge,
  curvature: number,
): readonly [number, number] {
  return edge.roadClass === 'circuit' ? [1, curvature] : [0, 0];
}

/** Preserve the rendering API while contact and drawing share one width. */
export { festivalCircuitApronWidth } from '../../simulation/open-world/festival-markings.ts';

const f = (value: number) => value.toFixed(5);
const S = FESTIVAL_ROAD_SURFACE;

/** Runs after the existing material-library colour/weather hook. The
 * photographic aggregate remains intact underneath metre-scale features;
 * neither reference photographs nor extra textures are needed. */
const SURFACE_COLOR = /* glsl */ `
float festivalPolish = 0.0;
float festivalRepair = 0.0;
float festivalSeal = 0.0;
{
  vec2 q = vFestivalRoadMetres;
  vec2 footprint = max(fwidth(q), vec2(0.0005));
  float pixel = max(footprint.x, footprint.y);
  float fine = 1.0 - smoothstep(0.035, 0.20, pixel);
  float halfRoad = vFestivalRoadData.x;
  float lanePitch = vFestivalRoadData.y;
  float seed = vFestivalRoadData.z;
  float admission = clamp(vFestivalRoadData.w, 0.0, 1.0);
  float roadUse = lanePitch > 0.01 ? 1.0 : 0.0;
  float circuitUse = clamp(vFestivalSurfaceData.x, 0.0, 1.0);
  float wet = clamp(apexSurfaceWetness * apexWetAmount, 0.0, 1.0);
  float age = clamp(festivalSurfaceAge, 0.0, 1.0);
  float wearNoise = owNoise(vec2(q.x * 0.42 + seed, q.y * 0.095));

  // Two wheel paths in each real lane. Broad, slight polish provides a
  // directional cue without painting a racing line through every corner.
  float laneX = mod(q.x + halfRoad, max(lanePitch, 1.0)) - lanePitch * 0.5;
  float wheelDistance = abs(abs(laneX) - ${f(S.wheelOffset)});
  festivalPolish = (1.0 - smoothstep(${f(S.wheelHalfWidth * 0.45)}, ${f(S.wheelHalfWidth)} + footprint.x, wheelDistance));
  festivalPolish *= (0.45 + 0.55 * wearNoise) * roadUse * admission;
  festivalPolish *= 1.0 - smoothstep(0.16, 0.45, footprint.x);
  festivalPolish *= (1.0 - smoothstep(halfRoad - 0.3, halfRoad, abs(q.x)));
  diffuseColor.rgb *= 1.0 - festivalPolish * mix(0.025, 0.075, age);

  // Circuit wear is a broad, broken history of use, with stronger polish
  // through bends. It is independent of the public-road wheel-path mask.
  if (circuitUse > 0.001) {
    float curvature = vFestivalSurfaceData.y;
    float bend = smoothstep(0.0007, 0.006, abs(curvature));
    float inside = clamp(curvature * 110.0, -0.8, 0.8) * halfRoad * 0.45;
    float useBand = 1.0 - smoothstep(halfRoad * 0.18, halfRoad * 0.48 + footprint.x, abs(q.x - inside));
    float brokenUse = smoothstep(0.22, 0.76, owNoise(vec2(q.y * 0.024 + seed, q.x * 0.19)));
    float circuitWear = useBand * brokenUse * mix(0.2, 1.0, bend) * admission * circuitUse;
    circuitWear *= 0.62 + 0.38 * wearNoise;
    diffuseColor.rgb *= 1.0 - circuitWear * mix(0.075, 0.12, age);
    festivalPolish = max(festivalPolish, circuitWear * 0.85);

    // Broad paving passes and a narrow cold joint follow the road frame.
    // Derivative filtering lets the joint fade naturally with distance.
    float pavingPass = floor((q.x + halfRoad) / 3.8);
    float passTone = owHash(vec2(pavingPass, seed + 7.0));
    diffuseColor.rgb *= 1.0 + (passTone - 0.5) * 0.034 * admission;
    float jointX = (owNoise(vec2(q.y * 0.045, seed)) - 0.5) * 0.06;
    float coldJoint = 1.0 - smoothstep(0.007, 0.014 + footprint.x, abs(q.x - jointX));
    coldJoint *= admission * (1.0 - smoothstep(0.09, 0.30, footprint.x));
    diffuseColor.rgb *= 1.0 - coldJoint * 0.32;
  }

  // Settled fines at the edge stay narrow, irregular and subordinate to
  // the road paint. The junction admission prevents a dark border across
  // a joining road. No geometric kerb is introduced here.
  float edgeWidth = 0.16 + wearNoise * 0.30;
  float edgeDust = smoothstep(halfRoad - edgeWidth - footprint.x, halfRoad - 0.025 + footprint.x, abs(q.x));
  edgeDust *= admission * max(roadUse, circuitUse) * (0.55 + 0.45 * age);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.17, 1.105, 0.99), edgeDust * 0.6);

  // Sparse independently sized utility/resurfacing patches. A bounded
  // rectangle has a fine chipped edge and a separate darker bitumen seal.
  float cell = floor(q.y / ${f(S.repairCell)});
  float id = owHash(vec2(cell, seed));
  float repairEnabled = step(id, ${f(S.repairChance)} * age) * admission * roadUse;
  // The choice is coherent over a 58 m cell, so most road pixels skip the
  // expensive boundary detail altogether. Derivatives were evaluated above.
  if (repairEnabled > 0.001) {
  float halfLength = mix(${f(S.repairLength[0] / 2)}, ${f(S.repairLength[1] / 2)}, owHash(vec2(cell + 5.1, seed + 8.7)));
  float halfWidth = mix(${f(S.repairHalfWidth[0])}, ${f(S.repairHalfWidth[1])}, owHash(vec2(cell + 19.3, seed + 2.6)));
  float centreX = (owHash(vec2(cell + 3.7, seed + 29.1)) * 2.0 - 1.0) * max(0.0, halfRoad - halfWidth - 0.38);
  float centreY = ${f(S.repairCell / 2)} + (owHash(vec2(cell + 7.9, seed + 37.3)) - 0.5) * 26.0;
  vec2 repairP = vec2(q.x - centreX, mod(q.y, ${f(S.repairCell)}) - centreY);
  vec2 repairD = abs(repairP) - vec2(halfWidth, halfLength);
  float boundary = max(repairD.x, repairD.y);
  // Chipping fades by pixel footprint; it cannot shimmer as the road recedes.
  boundary += (owNoise(q * 13.0 + vec2(seed, 0.0)) - 0.5) * 0.038 * fine;
  festivalRepair = (1.0 - smoothstep(-pixel, pixel, boundary)) * repairEnabled;
  festivalSeal = (1.0 - smoothstep(${f(S.sealHalfWidth * 0.65)}, ${f(S.sealHalfWidth)} + pixel, abs(boundary))) * fine * repairEnabled;
  float repairTone = mix(0.73, 1.12, step(0.64, owHash(vec2(cell + 31.1, seed + 13.4))));
  diffuseColor.rgb *= mix(1.0, repairTone, festivalRepair);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015, 0.017, 0.018) * (1.0 - wet * 0.25), festivalSeal * 0.82);
  }

  // Standing-water sheen drains off steep/banked surfaces. This only
  // adjusts the existing weather film's appearance; it is not hydrology.
  if (wet > 0.25) {
    vec3 roadWorldNormal = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
    float incline = length(roadWorldNormal.xz) / max(0.1, abs(roadWorldNormal.y));
    apexPuddle *= 1.0 - smoothstep(0.035, 0.12, incline) * 0.88;
  }
}
`;

const SURFACE_ROUGHNESS = /* glsl */ `
{
  float festivalDry = 1.0 - smoothstep(0.05, 0.65, clamp(apexSurfaceWetness * apexWetAmount, 0.0, 1.0));
  roughnessFactor = clamp(roughnessFactor - festivalPolish * 0.032 * festivalDry + festivalRepair * 0.025 * festivalDry, 0.04, 1.0);
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.53), festivalSeal * festivalDry);
}
`;

export function installFestivalRoadSurface(material: T.MeshPhysicalMaterial, age: number) {
  if (!Number.isFinite(age) || age < 0 || age > 1)
    throw new RangeError('Festival road age must be finite and between zero and one');
  if (!material.userData.wetSurface)
    throw new Error('Festival road surfacing needs the existing library wet-surface material');
  const ageUniform = { value: age };
  return chainShaderHook(material, 'festival-road-surface-v2', (shader) => {
    shader.uniforms.festivalSurfaceAge = ageUniform;
    injectDeclarations(
      shader,
      'common',
      `
attribute vec4 festivalRoadData;
attribute vec2 festivalSurfaceData;
varying vec4 vFestivalRoadData;
varying vec2 vFestivalSurfaceData;
varying vec2 vFestivalRoadMetres;`,
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      `
vFestivalRoadData = festivalRoadData;
vFestivalSurfaceData = festivalSurfaceData;
vFestivalRoadMetres = uv;`,
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `
uniform float festivalSurfaceAge;
varying vec4 vFestivalRoadData;
varying vec2 vFestivalSurfaceData;
varying vec2 vFestivalRoadMetres;
${OW_NOISE_GLSL}`,
      'fragment',
    );
    injectAfter(shader, 'color_fragment', SURFACE_COLOR, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', SURFACE_ROUGHNESS, 'fragment');
  });
}
