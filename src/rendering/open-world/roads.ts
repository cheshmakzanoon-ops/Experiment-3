import { paintStations } from './paint-tessellation.ts';
import { AirfieldLights } from './airfield-lights.ts';
import * as T from 'three';
import type { StreetLightSocket } from './street-light-pools.ts';
import {
  installScannedDetail,
  installScannedMaps,
  libraryAlbedo,
} from '../ground/scanned-ground.ts';
import { buildTownLamps } from './town-lamps.ts';
import {
  ROAD_FLAG,
  roadCandidates,
  type RoadEdge,
  type RoadNetwork,
} from '../../simulation/open-world/road-network.ts';
import type { TrackPoint } from '../../simulation/track.ts';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import {
  FESTIVAL_CIRCUIT_PAINT,
  forEachPaintSpan,
  festivalMarkings,
} from '../../simulation/open-world/festival-markings.ts';
import { materials } from '../materials/index.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';
import {
  FestivalRoadFrame,
  festivalRoadProfile,
  festivalSurfaceContext,
  installFestivalRoadSurface,
} from './festival-road-surface.ts';
import { townFootways, footwayHeight } from '../../simulation/open-world/town-footways.ts';
import {
  addTownFootway,
  addCrossingLanding,
  addStreetTreeGrate,
  footwayStations,
  pavingMaterial,
} from './festival-footway.ts';
import { festivalBridgePier, festivalBridgeSection } from './festival-bridges.ts';
import { streetTrees } from '../../simulation/open-world/street-trees.ts';
import { buildFestivalGuardrails } from './festival-guardrails.ts';
import { buildFestivalCircuitCues } from './festival-circuit-cues.ts';

/** Chunk edge (m) for culling road geometry. */
const CHUNK = 512;
type SurfaceHeight = (point: TrackPoint, lateral: number) => number;
const roadPoint = (): TrackPoint => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 0,
  bank: 0,
  gradient: 0,
});

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  roadData: number[] = [];
  surfaceData: number[] = [];
  indices: number[] = [];
  get count() {
    return this.positions.length / 3;
  }
  vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    nx = 0,
    ny = 1,
    nz = 0,
    road?: readonly [number, number, number, number],
    surface?: readonly [number, number],
  ) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    if (road) this.roadData.push(...road);
    if (surface) this.surfaceData.push(...surface);
    return this.count - 1;
  }
  triangle(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, c, b, b, c, d);
  }
  geometry() {
    if (!this.indices.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normals, 3));
    // The colour and ambient-occlusion maps use the same road-metre coordinates.
    const uv = new T.Float32BufferAttribute(this.uvs, 2);
    g.setAttribute('uv', uv);
    g.setAttribute('uv1', uv);
    if (this.roadData.length) {
      if (this.roadData.length !== this.count * 4)
        throw new Error('Festival road metadata must cover every vertex of its material batch');
      g.setAttribute('festivalRoadData', new T.Float32BufferAttribute(this.roadData, 4));
    }
    if (this.surfaceData.length) {
      if (this.surfaceData.length !== this.count * 2)
        throw new Error('Festival surface metadata must cover every vertex of its material batch');
      g.setAttribute('festivalSurfaceData', new T.Float32BufferAttribute(this.surfaceData, 2));
    }
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
type Layer =
  | 'asphaltMajor'
  | 'asphalt'
  | 'town'
  | 'dirt'
  | 'gravel'
  | 'verge'
  | 'paving'
  | 'paint'
  | 'yellow'
  | 'apron'
  | 'rail'
  | 'concrete'
  | 'post';

/** Cross-section metadata lives on the existing batches, independently of
 * the road-metre UVs. Paint and shoulders therefore keep metre-scale wear
 * even when a ribbon changes width or direction. */
function surfaceCoordinates(shader: T.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute vec2 festivalSurfaceData;\nvarying vec2 vFestivalSurfaceData;',
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFestivalSurfaceData = festivalSurfaceData;',
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec2 vFestivalSurfaceData;',
  );
}

const PAINT_WEAR = /* glsl */ `
float festivalPaintWearAt(vec2 metres, vec2 crossSection) {
  float pixel = max(length(fwidth(metres)), 0.0005);
  float fine = 1.0 - smoothstep(0.025, 0.15, pixel);
  float width = max(crossSection.y, 0.001);
  float edgeDistance = min(crossSection.x, width - crossSection.x);
  float grain = owNoise(metres * vec2(31.0, 24.0));
  float flake = smoothstep(0.66, 0.86, grain) * fine;
  float notches = owNoise(vec2(metres.y * 7.3, metres.x * 1.4));
  float notchWidth = min(width * 0.12, 0.003 + notches * 0.012);
  float edge = 1.0 - smoothstep(notchWidth, notchWidth + max(fwidth(crossSection.x), 0.0005), edgeDistance);
  return max(flake, edge * smoothstep(0.35, 0.78, notches) * fine);
}
`;

/** Paint has scuffed edges and sparse worn aggregate, filtered by pixel
 * footprint. Markings remain solid enough to read at speed and at night. */
function wornPaint(material: T.MeshStandardMaterial, wet: { value: number }) {
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    surfaceCoordinates(shader);
    shader.uniforms.festivalPaintWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float festivalPaintWet;\n${OW_NOISE_GLSL}\n${PAINT_WEAR}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float festivalPaintWear = festivalPaintWearAt(vUv, vFestivalSurfaceData);
{
  float pigment = 0.90 + 0.10 * owNoise(vUv * vec2(2.8, 0.17));
  diffuseColor.rgb = mix(diffuseColor.rgb * pigment, vec3(0.075), festivalPaintWear * 0.72);
  diffuseColor.rgb *= 1.0 - festivalPaintWet * 0.18;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.55 + festivalPaintWear * 0.12, 0.32 + festivalPaintWear * 0.07, festivalPaintWet);',
      );
  };
  material.customProgramCacheKey = () => 'solvane-road-paint-v2';
  return material;
}

/** Original circuit corner paint lies on the last half metre of asphalt.
 * It reads as an apex reference without suggesting a raised kerb or a paved
 * run-off over the simulation's gravel shoulder. Stripes and wear are
 * filtered in road metres and retain the existing weather response. */
function apronMaterial(wet: { value: number }) {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.64 });
  material.name = 'Saltmarsh flush corner paint';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -6;
  material.onBeforeCompile = (shader) => {
    surfaceCoordinates(shader);
    shader.uniforms.festivalApronWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float festivalApronWet;\n${OW_NOISE_GLSL}\n${PAINT_WEAR}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float festivalApronWear = festivalPaintWearAt(vUv, vFestivalSurfaceData);
{
  float wave = sin(vUv.y * 1.9634954);
  float aa = max(fwidth(wave), 0.001);
  float stripe = smoothstep(-aa, aa, wave);
  vec3 paint = mix(vec3(0.61, 0.59, 0.53), vec3(0.43, 0.034, 0.023), stripe);
  float pigment = 0.90 + 0.10 * owNoise(vUv * vec2(2.8, 0.17));
  diffuseColor.rgb = mix(paint * pigment, vec3(0.066, 0.068, 0.07), festivalApronWear * 0.72) * (1.0 - festivalApronWet * 0.21);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.64 + festivalApronWear * 0.1, 0.35 + festivalApronWear * 0.06, festivalApronWet);',
      );
  };
  material.customProgramCacheKey = () => 'festival-flush-corner-paint-v2';
  return material;
}

/** Road-metre wheel paths over either soil or a rolled mineral wearing course. */
function dirtMaterial(compacted: boolean, wet: { value: number }) {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.name = compacted ? 'Festival rolled quarry gravel' : 'Festival dirt track';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.festivalRolledGravel = { value: compacted ? 1 : 0 };
    shader.uniforms.festivalGravelWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float festivalRolledGravel;\nuniform float festivalGravelWet;\n${OW_NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float festivalGravelPolish = 0.0;
{
  vec2 q = vUv;
  float lane = abs(q.x);
  float rut = 1.0 - smoothstep(0.0, 0.35, abs(lane - 0.85));
  float grain = owFbm(vec2(q.x * 3.1, q.y * 0.9), 1.0);
  vec3 dirt = mix(vec3(0.20, 0.155, 0.105), vec3(0.30, 0.25, 0.18), grain);
  dirt = mix(dirt, vec3(0.13, 0.10, 0.07), rut * 0.55);
  // Grass creeping in at the crown and the edges.
  float grassy = smoothstep(0.55, 0.85, owFbm(q * vec2(0.6, 0.25), 1.0)) * (1.0 - smoothstep(0.0, 0.4, lane) + smoothstep(2.2, 2.9, lane));
  diffuseColor.rgb = mix(dirt, vec3(0.07, 0.11, 0.035), grassy * 0.8);
  if (festivalRolledGravel > 0.5) {
    float wander = 0.20 * (owNoise(vec2(q.y * 0.047, 1.8)) - 0.5);
    float path = 1.0 - smoothstep(0.14, 0.53, abs(abs(q.x + wander) - 0.86));
    vec2 chips = q * 24.0;
    vec2 pixel = fwidth(chips);
    float resolveChips = 1.0 - smoothstep(0.32, 1.15, max(pixel.x, pixel.y));
    float aggregate = (owNoise(chips) - 0.5) * resolveChips;
    vec3 gravel = mix(vec3(0.128, 0.123, 0.108), vec3(0.283, 0.262, 0.217), grain);
    gravel += vec3(aggregate * 0.12 * (1.0 - path * 0.62));
    festivalGravelPolish = (0.38 + 0.62 * path) * festivalGravelWet;
    diffuseColor.rgb = gravel * (1.0 - 0.14 * path - 0.29 * festivalGravelPolish);
  }
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor *= 1.0 - 0.34 * festivalGravelPolish;',
      );
  };
  material.customProgramCacheKey = () => 'festival-dirt-v2';
  return material;
}
/** Gravel verge strip beside the asphalt. */
function vergeMaterial(wet: { value: number }) {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 });
  material.name = 'Festival verge';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.onBeforeCompile = (shader) => {
    surfaceCoordinates(shader);
    shader.uniforms.festivalVergeWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float festivalVergeWet;\n${OW_NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float festivalShoulderGrowth = 0.0;
{
  float width = max(vFestivalSurfaceData.y, 0.001);
  float across = clamp(vFestivalSurfaceData.x / width, 0.0, 1.0);
  float shoulderPatch = owNoise(vUv * vec2(0.75, 0.21));
  float g = owFbm(vUv * vec2(4.0, 1.3), 1.0);
  vec3 gravel = mix(vec3(0.16, 0.145, 0.12), vec3(0.27, 0.25, 0.21), g);
  float compacted = 1.0 - smoothstep(0.1, 0.55, across);
  gravel *= 1.0 - compacted * (0.035 + 0.06 * shoulderPatch);
  festivalShoulderGrowth = smoothstep(0.38, 0.95, across + (shoulderPatch - 0.5) * 0.4);
  festivalShoulderGrowth *= smoothstep(0.4, 0.75, owFbm(vUv * vec2(1.3, 0.4), 1.0));
  // Multiply the finished colour so the preceding scanned-detail ratio
  // continues contributing its chroma as well as normal/roughness detail.
  diffuseColor.rgb *= mix(gravel, vec3(0.08, 0.11, 0.04), festivalShoulderGrowth * 0.8);
  diffuseColor.rgb *= 1.0 - festivalVergeWet * mix(0.24, 0.15, festivalShoulderGrowth);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor *= mix(0.97, 0.61, festivalVergeWet) + festivalShoulderGrowth * 0.03;',
      );
  };
  material.customProgramCacheKey = () => 'festival-verge-v2';
  return material;
}

/** Forest soil and quarry aggregate have separate photographed surfaces on Medium and above. */
export function festivalUnsealedMaterial(compacted: boolean, wet: { value: number }) {
  const material = dirtMaterial(compacted, wet);
  installScannedDetail(material, compacted ? 'gravel' : 'forest', {
    strength: 1,
    chroma: 0.5,
    relief: 1.2,
  });
  return material;
}
function installScannedVerge(material: T.MeshStandardMaterial) {
  installScannedDetail(material, 'meadow', { strength: 0.9, chroma: 0.5, relief: 1 });
  return material;
}

/**
 * Road presentation of the network: asphalt ribbons (fresh on highways and
 * the runway, worn on country and mountain roads, patched in town) from the
 * library's GPU-detailed asphalt with its wet response, gravel verges, dirt
 * tracks, painted lines by class (motorway lanes, centre lines, runway
 * centreline and thresholds; no lines through junction mouths), bridge decks
 * with beams, piers and parapets, W-beam guardrails with posts where the
 * network marks drops, and lamp posts along town streets (lit at night).
 * Every height comes from the same road surface function the physics reads.
 */
export class RoadMeshes {
  readonly root = new T.Group();
  readonly airfieldLights: AirfieldLights;
  readonly lampSockets: StreetLightSocket[] = [];
  readonly materials: Record<Layer, T.Material>;
  readonly lampMaterial: T.MeshStandardMaterial;
  readonly reflectorMaterial = new T.MeshStandardMaterial({
    color: 0xffdf9a,
    emissive: 0xffd071,
    emissiveIntensity: 0.02,
    roughness: 0.27,
  });
  /** Flexible verge boards share one ordinary, vertex-colour material. */
  readonly circuitCueMaterial = new T.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.64,
    vertexColors: true,
  });
  private readonly pavingWet = { value: 0 };
  stats = {
    chunks: 0,
    triangles: 0,
    lamps: 0,
    posts: 0,
    barrierRuns: 0,
    reflectors: 0,
    railEndCaps: 0,
    circuitGrids: 0,
    circuitBoards: 0,
    circuitChevrons: 0,
    circuitCueChunks: 0,
    airfieldLamps: 0,
  };
  constructor(
    readonly network: RoadNetwork,
    readonly field: TerrainField,
  ) {
    this.root.name = 'Festival roads';
    // The Low fallback must still read as fine aggregate. The old patched
    // tile repeated large bright islands across every street like cobbles.
    // Photographed maps retain their own measured scale on Medium and above.
    const asphaltMajor = materials.asphalt({ variant: 'fresh', color: 0x3c3d3e, tile: 0.3 });
    const asphalt = materials.asphalt({ variant: 'worn', tile: 0.3 });
    const town = materials.asphalt({
      variant: 'fresh',
      color: 0x424446,
      tile: 0.24,
      puddles: 0.45,
    });
    // Photographed asphalt on Medium and above (ground/scanned-ground.ts).
    for (const m of [asphaltMajor, asphalt, town])
      installScannedMaps(m, 'asphalt', libraryAlbedo(m));
    installFestivalRoadSurface(asphaltMajor, 0.32);
    installFestivalRoadSurface(asphalt, 0.9);
    installFestivalRoadSurface(town, 1);
    for (const [m, units] of [
      [asphaltMajor, -4],
      [asphalt, -3],
      [town, -3],
    ] as const) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = units;
    }
    const paint = wornPaint(
      new T.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.55, metalness: 0 }),
      this.pavingWet,
    );
    const yellow = wornPaint(
      new T.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.55, metalness: 0 }),
      this.pavingWet,
    );
    for (const m of [paint, yellow]) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -6;
    }
    this.lampMaterial = new T.MeshStandardMaterial({
      color: 0xfff1d6,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.05,
      roughness: 0.4,
    });
    this.materials = {
      asphaltMajor,
      asphalt,
      town,
      dirt: festivalUnsealedMaterial(false, this.pavingWet),
      gravel: festivalUnsealedMaterial(true, this.pavingWet),
      verge: installScannedVerge(vergeMaterial(this.pavingWet)),
      paving: pavingMaterial(this.pavingWet),
      paint,
      yellow,
      apron: apronMaterial(this.pavingWet),
      rail: Object.assign(materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.42 }), {
        side: T.DoubleSide,
      }),
      concrete: Object.assign(materials.concrete({ variant: 'rough', horizontal: 0 }), {
        side: T.DoubleSide,
      }),
      post: new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.52, roughness: 0.48 }),
    };
    this.airfieldLights = new AirfieldLights(network, festivalMarkings(network));
    this.root.add(this.airfieldLights.root);
    this.build();
  }
  private layerOf(e: RoadEdge): Layer {
    if (e.spec.surface === 'dirt')
      return e.road.surfacing === 'compacted-gravel' ? 'gravel' : 'dirt';
    if (e.roadClass === 'town') return 'town';
    if (e.roadClass === 'highway' || e.roadClass === 'runway' || e.roadClass === 'circuit')
      return 'asphaltMajor';
    return 'asphalt';
  }
  private build() {
    const net = this.network,
      chunks = new Map<string, Map<Layer, Builder>>();
    const builder = (x: number, z: number, layer: Layer) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, (chunk = new Map()));
      let b = chunk.get(layer);
      if (!b) chunk.set(layer, (b = new Builder()));
      return b;
    };
    const p = roadPoint(),
      q = roadPoint();
    const footways = townFootways(net);
    for (const site of streetTrees(net).sites)
      addStreetTreeGrate(builder(site.x, site.z, 'paving'), site);
    const lamps: T.Matrix4[] = [];
    for (const e of net.edges) {
      const spec = e.spec,
        hw = spec.halfWidth,
        crown = spec.crown,
        layer = this.layerOf(e),
        height: SurfaceHeight = (pt, l) => net.surfaceHeight(pt, l, hw, crown);
      const frame = new FestivalRoadFrame(net, e);
      const runway = festivalMarkings(net).airfield[e.index]?.strip;
      const surfaceContext = (pt: TrackPoint, station: number) => festivalSurfaceContext(e,
        pt.curvature, runway ? Math.min(station - runway.from, runway.to - station) : undefined,
      );
      const across = [-hw, -hw * 0.5, 0, hw * 0.5, hw];
      let previousBuilder: Builder | undefined;
      let previousEndRow: number[] = [];
      let previousShoulder: Builder | undefined;
      const shoulderEnds: number[][] = [[], []];
      // Running surface and verges, segment by segment.
      for (let i = e.first; i < e.last; i++) {
        net.pointOnSegment(i, 0, p);
        net.pointOnSegment(i, 1, q);
        const mx = (p.x + q.x) / 2,
          mz = (p.z + q.z) / 2,
          v0 = p.s - e.offset,
          v1 = q.s - e.offset;
        const b = builder(mx, mz, layer);
        const row = (pt: TrackPoint, v: number) => {
          const profile = spec.surface === 'asphalt' ? festivalRoadProfile(net, e, v) : undefined;
          const context = profile ? surfaceContext(pt, v) : undefined;
          return across.map((l) => {
            const n = frame.normal(pt, l);
            return b.vertex(
              pt.x + pt.nx * l,
              height(pt, l),
              pt.z + pt.nz * l,
              l,
              v,
              n.x,
              n.y,
              n.z,
              profile,
              context,
            );
          });
        };
        // Connected spans meet at the same authored station. Share that
        // cross-section inside a batch and start a fresh one at culling seams.
        const r0 = previousBuilder === b ? previousEndRow : row(p, v0),
          r1 = row(q, v1);
        for (let k = 0; k < across.length - 1; k++) b.quad(r0[k], r0[k + 1], r1[k], r1[k + 1]);
        previousBuilder = b;
        previousEndRow = r1;
        // Carry the supported shoulder through bridge spans to the parapet face.
        const bridge =
          (net.flags[i] & ROAD_FLAG.BRIDGE) !== 0 && (net.flags[i + 1] & ROAD_FLAG.BRIDGE) !== 0;
        if (spec.shoulder > 0.2 && e.roadClass !== 'town') {
          const shoulderLayer =
            e.roadClass === 'highway' || e.roadClass === 'runway' ? layer : 'verge';
          const vb = builder(mx, mz, shoulderLayer);
          for (const side of [-1, 1]) {
            const edge = (pt: TrackPoint, v: number) => {
              const profile =
                shoulderLayer === layer && spec.surface === 'asphalt'
                  ? festivalRoadProfile(net, e, v)
                  : undefined;
              const n = frame.normal(pt, side * hw, true);
              const inner = vb.vertex(
                pt.x + pt.nx * side * hw,
                height(pt, side * hw) - 0.005,
                pt.z + pt.nz * side * hw,
                side * hw,
                v,
                n.x,
                n.y,
                n.z,
                profile,
                profile
                  ? surfaceContext(pt, v)
                  : shoulderLayer === 'verge'
                    ? [0, spec.shoulder]
                    : undefined,
              );
              const w = hw + spec.shoulder;
              frame.normal(pt, side * w, true);
              const outer = vb.vertex(
                pt.x + pt.nx * side * w,
                height(pt, side * hw) - 0.06 - spec.shoulder * 0.03,
                pt.z + pt.nz * side * w,
                side * w,
                v,
                n.x,
                n.y,
                n.z,
                profile,
                profile
                  ? surfaceContext(pt, v)
                  : shoulderLayer === 'verge'
                    ? [spec.shoulder, spec.shoulder]
                    : undefined,
              );
              return [inner, outer];
            };
            const sideIndex = side < 0 ? 0 : 1;
            const [a0, a1] = previousShoulder === vb ? shoulderEnds[sideIndex] : edge(p, v0);
            const next = edge(q, v1);
            const [c0, c1] = next;
            if (side > 0) vb.quad(a0, a1, c0, c1);
            else vb.quad(a1, a0, c1, c0);
            shoulderEnds[sideIndex] = next;
          }
          previousShoulder = vb;
        }
        if (bridge) {
          const rails = net.flags[i] & net.flags[i + 1];
          const adjacent = (j: number) =>
            j >= e.first && j < e.last && net.flags[j] & net.flags[j + 1] & ROAD_FLAG.BRIDGE
              ? net.flags[j] & net.flags[j + 1]
              : 0;
          festivalBridgeSection(
            builder(mx, mz, 'concrete'),
            e,
            p,
            q,
            height,
            rails,
            rails & ~adjacent(i - 1),
            rails & ~adjacent(i + 1),
          );
        }
      }
      this.markings(e, builder, frame);
      if (e.roadClass === 'town') {
        for (const side of [-1, 1]) {
          const stations = footwayStations(net, e, side, CHUNK);
          for (let k = 1; k < stations.length; k++) {
            const start = stations[k - 1],
              end = stations[k];
            net.pointOnSegment(start, 0, p);
            net.pointOnSegment(end - 1, 1, q);
            addTownFootway(
              builder((p.x + q.x) * 0.5, (p.z + q.z) * 0.5, 'paving'),
              e,
              p,
              q,
              side,
              height(p, side * hw),
              height(q, side * hw),
              footways.strength(e, start, 0, side),
              footways.strength(e, end - 1, 1, side),
            );
          }
        }
        for (const site of festivalMarkings(net).crossings[e.index]) {
          const mid = net.pointOnSegment(site.first, 0.5, p);
          const paving = builder(mid.x, mid.z, 'paving');
          for (const side of [-1, 1]) addCrossingLanding(paving, net, e, site, side);
        }
        this.townLamps(e, lamps);
      }
      this.piers(e, builder);
    }
    const guardrails = buildFestivalGuardrails(
      net,
      this.field,
      this.materials.rail,
      this.reflectorMaterial,
    );
    this.root.add(guardrails.root);
    // Merge per chunk and layer.
    const triangles = { n: 0 };
    for (const [key, chunk] of chunks) {
      const group = new T.Group();
      group.name = `Roads ${key}`;
      for (const [layer, b] of chunk) {
        const g = b.geometry();
        if (!g) continue;
        triangles.n += b.indices.length / 3;
        const mesh = new T.Mesh(g, this.materials[layer]);
        mesh.name = `${layer} ${key}`;
        mesh.receiveShadow = true;
        mesh.castShadow = layer === 'rail' || layer === 'concrete';
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
      this.root.add(group);
    }
    const townLamps = buildTownLamps(lamps, this.materials.post, this.lampMaterial);
    this.root.add(townLamps.root);
    this.lampSockets.push(...townLamps.sockets);
    const grids = this.circuitStartGrids();
    const cues = buildFestivalCircuitCues(net, this.field, this.circuitCueMaterial);
    this.root.add(cues.root);
    this.stats = {
      chunks: chunks.size,
      triangles: triangles.n + guardrails.stats.triangles + grids.triangles + cues.stats.triangles,
      lamps: lamps.length,
      posts: guardrails.stats.posts,
      barrierRuns: guardrails.stats.runs,
      reflectors: guardrails.stats.reflectors,
      railEndCaps: guardrails.stats.endCaps,
      circuitGrids: grids.count,
      circuitBoards: cues.stats.boards,
      circuitChevrons: cues.stats.chevrons,
      circuitCueChunks: cues.stats.chunks,
      airfieldLamps: this.airfieldLights.count,
    };
  }
  /** Permanent track paint, independent of event-marker visibility. Resolve
   * only the first leg of an eligible race, using the same planner as the
   * session; do not rebuild FestivalEvents or add a second practice grid. */
  private circuitStartGrids() {
    const net = this.network;
    const grids = festivalMarkings(net).grids;
    let triangles = 0;
    for (const grid of grids) {
      const edge = net.edges[grid.edge];
      const { station, direction } = grid;
      const frame = new FestivalRoadFrame(net, edge);
      const paint = new Builder();
      const p = roadPoint(),
        q = roadPoint();
      const rectangle = (d0: number, d1: number, l0: number, l1: number) => {
        const steps = Math.max(1, Math.ceil((d1 - d0) / 1.5));
        const vertex = (point: TrackPoint, lateral: number) => {
          const l = direction * lateral;
          const normal = frame.normal(point, l);
          return paint.vertex(
            point.x + point.nx * l,
            net.surfaceHeight(point, l, edge.spec.halfWidth, edge.spec.crown) + 0.012,
            point.z + point.nz * l,
            l,
            point.s - edge.offset,
            normal.x,
            normal.y,
            normal.z,
            undefined,
            [lateral - l0, l1 - l0],
          );
        };
        for (let i = 0; i < steps; i++) {
          net.at(station + direction * (d0 + ((d1 - d0) * i) / steps), p);
          net.at(station + direction * (d0 + ((d1 - d0) * (i + 1)) / steps), q);
          paint.quad(vertex(p, l0), vertex(p, l1), vertex(q, l0), vertex(q, l1));
        }
      };
      // Tyre contact and drawing consume the same white checker cells and
      // grid-box outlines; the unpainted cells remain ordinary asphalt.
      for (const { d0, d1, l0, l1 } of grid.rectangles) rectangle(d0, d1, l0, l1);
      const geometry = paint.geometry();
      if (!geometry) continue;
      const mesh = new T.Mesh(geometry, this.materials.paint);
      mesh.name = `Circuit start paint ${grid.event}`;
      mesh.userData.festivalCircuitGrid = {
        event: grid.event,
        edge: edge.index,
        station,
        direction,
        centres: grid.centres,
      };
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      triangles += paint.indices.length / 3;
    }
    return { count: grids.length, triangles };
  }
  /** Painted lines: edge lines, centre lines and runway markings. */
  private markings(
    e: RoadEdge,
    builder: (x: number, z: number, layer: Layer) => Builder,
    frame: FestivalRoadFrame,
  ) {
    const net = this.network,
      spec = e.spec,
      hw = spec.halfWidth;
    if (spec.markings === 'none') return;
    let a = roadPoint(),
      b = roadPoint();
    const step = FESTIVAL_CIRCUIT_PAINT.lineStep;
    const layout = festivalMarkings(net);
    const lines = [...layout.lines[e.index], ...layout.crossings[e.index].flatMap((site) => site.lines)];
    for (const line of lines) {
      forEachPaintSpan(line, (from, to) => {
        // Each dash or continuous line owns its ends. A new span can have
        // a different width, material or a visible gap before it.
        let previousPaint: Builder | undefined;
        let endLeft = -1,
          endRight = -1;
        const w = line.width / 2;
        const stations = paintStations(net, e, from, to, line.lateral - w, line.lateral + w);
        net.at(e.offset + from, a);
        for (let i = 1; i < stations.length; i++) {
          const s = stations[i - 1], end = stations[i];
          net.at(e.offset + end, b);
          const builderAt = builder((a.x + b.x) / 2, (a.z + b.z) / 2, line.layer);
          const corner = (pt: TrackPoint, l: number, v: number) => {
            const n = frame.normal(pt, l);
            return builderAt.vertex(
              pt.x + pt.nx * l,
              net.surfaceHeight(pt, l, hw, spec.crown) + 0.012,
              pt.z + pt.nz * l,
              l,
              v,
              n.x,
              n.y,
              n.z,
              undefined,
              [l - line.lateral + line.width / 2, line.width],
            );
          };
          const a0 = previousPaint === builderAt ? endLeft : corner(a, line.lateral - w, s),
            a1 = previousPaint === builderAt ? endRight : corner(a, line.lateral + w, s);
          endLeft = corner(b, line.lateral - w, end);
          endRight = corner(b, line.lateral + w, end);
          builderAt.quad(a0, a1, endLeft, endRight);
          previousPaint = builderAt;
          const swap = a;
          a = b;
          b = swap;
        }
      });
    }
    for (const band of layout.airfield[e.index]?.glyphs ?? []) {
      for (let s = band.from; s < band.to; s += step) {
        const end = Math.min(band.to, s + step);
        net.at(e.offset + s, a);
        net.at(e.offset + end, b);
        const batch = builder((a.x + b.x) / 2, (a.z + b.z) / 2, 'paint');
        const row = (point: TrackPoint, station: number) => {
          const t = (station - band.from) / (band.to - band.from);
          const left = band.left0 + (band.left1 - band.left0) * t;
          const right = band.right0 + (band.right1 - band.right0) * t;
          return [left, right].map((l) => {
            const normal = frame.normal(point, l);
            return batch.vertex(
              point.x + point.nx * l, net.surfaceHeight(point, l, hw, spec.crown) + 0.012,
              point.z + point.nz * l, l, station, normal.x, normal.y, normal.z,
              undefined, [l - left, right - left],
            );
          });
        };
        const [a0, a1] = row(a, s), [b0, b1] = row(b, end);
        batch.quad(a0, a1, b0, b1);
      }
    }
    if (e.roadClass === 'circuit') this.cornerAprons(e, builder, frame);
  }
  private inJunction(e: RoadEdge, s: number) {
    const net = this.network;
    for (const node of [net.nodes[e.from], net.nodes[e.to]]) {
      if (node.edges.length < 3) continue;
      const along = node === net.nodes[e.from] ? s : e.length - s;
      if (along < e.spec.halfWidth + 9) return true;
    }
    return false;
  }
  private cornerAprons(
    edge: RoadEdge,
    builder: (x: number, z: number, layer: Layer) => Builder,
    frame: FestivalRoadFrame,
  ) {
    const net = this.network,
      spec = edge.spec,
      p = roadPoint(),
      q = roadPoint();
    for (const { segment, side, width0, width1 } of festivalMarkings(net).aprons(edge.index)) {
      net.pointOnSegment(segment, 0, p);
      net.pointOnSegment(segment, 1, q);
      const batch = builder((p.x + q.x) / 2, (p.z + q.z) / 2, 'apron');
      const row = (pt: TrackPoint, w: number) =>
        [spec.halfWidth - w, spec.halfWidth].map((absolute) => {
          const lateral = side * absolute,
            normal = frame.normal(pt, lateral);
          return batch.vertex(
            pt.x + pt.nx * lateral,
            net.surfaceHeight(pt, lateral, spec.halfWidth, spec.crown) + 0.011,
            pt.z + pt.nz * lateral,
            lateral,
            pt.s - edge.offset,
            normal.x,
            normal.y,
            normal.z,
            undefined,
            [absolute - (spec.halfWidth - w), w],
          );
        });
      const a = row(p, width0),
        b = row(q, width1);
      if (side > 0) batch.quad(a[0], a[1], b[0], b[1]);
      else batch.quad(a[1], a[0], b[1], b[0]);
    }
  }
  /** Bridge piers down to the natural ground every ~32 m of span. */
  private piers(e: RoadEdge, builder: (x: number, z: number, layer: Layer) => Builder) {
    const net = this.network,
      p = roadPoint();
    const lower = roadCandidates();
    let run = -1;
    for (let i = e.first; i <= e.last; i++) {
      const bridge = (net.flags[i] & ROAD_FLAG.BRIDGE) !== 0;
      if (!bridge) {
        run = -1;
        continue;
      }
      const s = net.s[i] - e.offset;
      if (run < 0) run = s;
      if (
        s - run < 16 ||
        Math.floor((s - run) / 32) ===
          Math.floor((net.s[Math.max(e.first, i - 1)] - e.offset - run) / 32)
      )
        continue;
      net.at(net.s[i], p);
      const ground = this.field.height(p.x, p.z);
      if (p.y - ground < 4) continue;
      // Leave the travelled width of every lower road open. The footprint
      // includes both column footings even at a skew crossing.
      const reach = (e.spec.halfWidth + e.spec.shoulder) * 0.32 + 1.25;
      if (net.covering(p.x, p.z, ground, reach, lower) > 0) continue;
      festivalBridgePier(
        builder(p.x, p.z, 'concrete'),
        e,
        p,
        (at, lateral) => net.surfaceHeight(at, lateral, e.spec.halfWidth, e.spec.crown),
        (x, z) => this.field.height(x, z),
      );
    }
  }
  private townLamps(e: RoadEdge, lamps: T.Matrix4[]) {
    const net = this.network,
      p = roadPoint();
    const footways = townFootways(net);
    let segment = e.first;
    for (let s = 12; s < e.length - 12; s += 32) {
      if (this.inJunction(e, s)) continue;
      net.at(e.offset + s, p);
      const side = Math.floor(s / 32) % 2 === 0 ? 1 : -1,
        l = side * (e.spec.halfWidth + e.spec.shoulder - 0.4);
      while (segment < e.last - 1 && net.s[segment + 1] <= p.s) segment++;
      const t = (p.s - net.s[segment]) / (net.s[segment + 1] - net.s[segment]);
      const m = new T.Matrix4().compose(
        new T.Vector3(
          p.x + p.nx * l,
          net.surfaceHeight(p, side * e.spec.halfWidth, e.spec.halfWidth, e.spec.crown) +
            footwayHeight(e.spec.shoulder - 0.4, footways.strength(e, segment, t, side)) -
            0.012,
          p.z + p.nz * l,
        ),
        // The arm reaches over the road (local +x toward the centreline).
        new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 1, 0),
          Math.atan2(side * p.nz, -side * p.nx),
        ),
        new T.Vector3(1, 1, 1),
      );
      lamps.push(m);
    }
  }
  /** Night: street lamps glow (bloom carries them). */
  setNight(night: number, eye?: T.Vector3) {
    this.airfieldLights.setNight(night, eye);
    this.lampMaterial.emissiveIntensity = 0.05 + night * 9;
    this.reflectorMaterial.emissiveIntensity = 0.02 + night * 0.72;
  }
  setWet(wet: number) {
    this.pavingWet.value = T.MathUtils.clamp(wet, 0, 1);
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>();
    this.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh || o instanceof T.Points) geometries.add(o.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.lampMaterial.dispose();
    this.reflectorMaterial.dispose();
    this.circuitCueMaterial.dispose();
    this.airfieldLights.dispose();
  }
}
