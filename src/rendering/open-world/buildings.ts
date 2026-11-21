import * as T from 'three';
import { trackPoint } from '../../simulation/track.ts';
import type { RoadNetwork } from '../../simulation/open-world/road-network.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';
import {
  facadeLayout,
  facadeFinish,
  addRecessedFacade,
  FACADE_RECESS,
  type FacadePlacement,
} from './facade-layout.ts';
import { FACADE_ATLAS_GLSL, FacadeAtlas } from './facade-atlas.ts';
import { FacadeJoinery } from './facade-joinery.ts';
import { addFarmGable } from './farm-gable.ts';
import { HeadlandLantern } from './headland-lantern.ts';
import type { QualityPreset } from '../options.ts';
import { FACADE_INTERIORS_GLSL } from './facade-interiors.ts';

// A 512 m district could submit the whole port while looking past one shop.
// Short blocks bound the same original meshes tightly enough for frustum culling.
const BUILDING_BLOCK = 128;
const KIND_CODE: Record<Structure['kind'], number> = {
  house: 0,
  shop: 1,
  block: 2,
  farm: 3,
  chapel: 4,
  hangar: 5,
  terminal: 6,
  tower: 7,
  lighthouse: 8,
  warehouse: 9,
  granary: 10,
};
/** Linear-ish wall albedos: limewash, ochre, pale blue, terracotta, brick,
 * concrete, stone; corrugated metal for sheds. */
const WALLS = [0xd8d2c4, 0xc9a66b, 0xa9b7bf, 0xb86a4b, 0x8c4f3a, 0x9a9690, 0xb3a891, 0xe6dfcf];
const METAL = [0x8e9590, 0x6f7f74, 0xa7aaa8];
const ROOFS = [0x8a3f2a, 0x6d3426, 0x45484c, 0x5b5d5f, 0x7a5a3e];

class Mesher {
  position: number[] = [];
  normal: number[] = [];
  uv: number[] = [];
  color: number[] = [];
  facade: number[] = [];
  index: number[] = [];
  readonly recessed: number[] = [];
  readonly piers: number[] = [];
  readonly cards: number[] = [];
  readonly trim: number[] = [];
  readonly projected: number[] = [];
  private c = new T.Color();
  quad(
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    uvs: readonly (readonly [number, number])[],
    color: number,
    facade: readonly [number, number, number, number],
    target = facade[2] === -4 || facade[2] === -5 || facade[2] === -6
      ? this.recessed
      : facade[2] === -3
        ? this.piers
        : this.index,
  ) {
    const base = this.faceVertices(corners, n, uvs, color, facade);
    target.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  projectedPane(
    ...args: Parameters<NonNullable<import('./facade-layout.ts').FacadeSink['projectedPane']>>
  ) {
    this.quad(...args, this.projected);
  }
  tri(
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    color: number,
    facade: readonly [number, number, number, number],
  ) {
    const base = this.faceVertices(corners, n, undefined, color, facade);
    this.index.push(base, base + 1, base + 2);
  }
  private faceVertices(
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    uvs: readonly (readonly [number, number])[] | undefined,
    color: number,
    facade: readonly [number, number, number, number],
  ) {
    const base = this.position.length / 3;
    this.c.setHex(color);
    const r = Math.round(this.c.r * 65535),
      g = Math.round(this.c.g * 65535),
      b = Math.round(this.c.b * 65535);
    const nx = Math.round(n[0] * 32767),
      ny = Math.round(n[1] * 32767),
      nz = Math.round(n[2] * 32767);
    corners.forEach((p, k) => {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(nx, ny, nz);
      this.uv.push(uvs ? uvs[k][0] : p[0], uvs ? uvs[k][1] : p[2]);
      this.color.push(r, g, b);
      this.facade.push(...facade);
    });
    return base;
  }
  geometry() {
    if (!this.index.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    // A normalized 16-bit normal and linear albedo retain well below a display step
    // of error while saving 12 bytes per vertex across every regional building.
    g.setAttribute('normal', new T.Int16BufferAttribute(this.normal, 3, true));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Uint16BufferAttribute(this.color, 3, true));
    g.setAttribute('facade', new T.Float32BufferAttribute(this.facade, 4));
    // Near and intermediate share piers, roof and trim. The skyline
    // range references the same structural vertices plus one face per
    // authored wall. No second mesh or draw is needed at a transition.
    const Index = this.position.length / 3 > 65535 ? Uint32Array : Uint16Array;
    const ranges = [this.recessed, this.piers, this.trim, this.index, this.projected];
    if (this.cards.length) ranges.push(this.index, this.cards);
    const index = new Index(ranges.reduce((sum, list) => sum + list.length, 0));
    let offset = 0;
    for (const list of ranges) {
      index.set(list, offset);
      offset += list.length;
    }
    g.setIndex(new T.BufferAttribute(index, 1));
    g.setDrawRange(
      0,
      this.recessed.length + this.piers.length + this.trim.length + this.index.length,
    );
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Facade material: plaster/brick/metal walls with a window grid per floor
 * and bay (dark glazing with low roughness, deep reveals), shopfronts on
 * town ground floors, ribbed cladding on sheds, weathering stains, and
 * individually lit windows at night. */
/** Glazing: the largest per-pane tilt (radians, about 0.9 degrees), the
 * slope of the tempered-glass roller wave (period about 0.31 m) and the
 * air-glass interfaces of a double-glazed unit. */
export const GLAZING = Object.freeze({ tilt: 0.016, roller: 0.0045, interfaces: 4 });
function facadeMaterial(
  night: { value: number },
  interiorDepth: { value: number },
  atlas: { value: T.DataTexture | null },
) {
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  material.name = 'Festival building facades';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owNight = night;
    shader.uniforms.owFacadeAtlas = atlas;
    shader.uniforms.owInteriorDepth = interiorDepth;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float owNight;
uniform float owInteriorDepth;
varying vec4 vFacade;
${OW_NOISE_GLSL}
${FACADE_INTERIORS_GLSL}
${FACADE_ATLAS_GLSL}
float owGlass;
float owLit;
float owRib;
float owWallRelief;
float owWallRoughness;
vec3 owLamp;
vec2 owPaneTilt;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec4 facade=vFacade;
  vec2 q=vUv;
  vec2 footprint=fwidth(q);
  float paneCoverage=1.0;
  vec3 wallAlbedo=diffuseColor.rgb;
  if(facade.z<=-8.0)owResolveFacade(facade,q,footprint,paneCoverage);
  float style = facade.x, kind = facade.y, height = facade.w;
  vec3 interiorColor = vec3(0.0);
  float interiorVisibility = 0.0;
  owGlass = 0.0; owLit = 0.0; owRib = 0.0; owWallRelief = 0.0; owWallRoughness = -1.0; owLamp = vec3(1.0, 0.7, 0.42);
  owPaneTilt = vec2(0.0);
  bool shed = kind > 4.5 && kind < 5.5 || kind > 8.5;
  bool roof = facade.z < -0.5 && facade.z > -1.5;
  bool trim = facade.z < -1.5;
  bool physicalPane = abs(facade.z + 4.0) < 0.1;
  bool physicalWall = abs(facade.z + 3.0) < 0.1;
  // Weathering: rain streaks down from sills, grime near the ground.
  float streak = owNoise(vec2(q.x * 1.7, q.y * 0.08 + style * 13.0));
  float grime = 1.0 - smoothstep(0.0, 1.6, q.y);
  if (!physicalPane) diffuseColor.rgb *= physicalWall
    ? (0.945 + 0.055 * streak) * (1.0 - 0.14 * grime)
    : (0.86 + 0.18 * streak) * (1.0 - 0.25 * grime);
  if (physicalPane) {
    // Geometry supplies the actual reveal depth. This inset pane adds a
    // bounded interior illustration, not a ray-traced or enterable room.
    float room = facade.x;
    vec2 aa = max(footprint, vec2(0.001));
    bool entrance=facade.w>2.0;
    float upright = entrance ? abs(abs(q.x-0.5)-(facade.w-2.0)*0.5) : facade.w > 0.5 ? min(abs(q.x-0.3333),abs(q.x-0.6667)) : abs(q.x-0.5);
    float transom = abs(q.y - (entrance ? 0.84 : facade.w > 0.5 ? 0.78 : 0.63));
    float perimeter = min(min(q.x,1.0-q.x),min(q.y,1.0-q.y));
    float frame = max(1.0-smoothstep(0.012,0.012+aa.x,upright),
                      1.0-smoothstep(0.012,0.012+aa.y,transom));
    frame = max(frame,1.0-smoothstep(0.028,0.028+max(aa.x,aa.y),perimeter));
    owGlass = 1.0-frame;
    owPaneTilt = vec2(fract(room * 37.13 + style * 0.71), fract(room * 91.71 + 0.37)) - 0.5;
    diffuseColor.rgb = vec3(0.043,0.050,0.047);
    float ceiling = 1.0 - smoothstep(0.77,1.0,q.y)*0.52;
    float curtain = smoothstep(0.06,0.16,q.x)*smoothstep(0.06,0.16,1.0-q.x);
    float furniture = 1.0-(1.0-smoothstep(0.19,0.32,q.y)) *
      (1.0-smoothstep(0.09,0.23,abs(q.x-(0.30+room*0.35))))*0.68;
    owLamp = mix(vec3(1.0,0.69,0.42),vec3(0.78,0.87,1.0),step(0.86,room));
    owLit = step(0.57,room)*(0.34+room*0.45)*owGlass*ceiling*curtain*furniture;
    if (owInteriorDepth > 0.0 && dot(vViewPosition,vViewPosition) < 16900.0) {
      float facing, roomLamp;
      bool shopRoom = facade.w > 0.5;
      vec3 roomColor = owFacadeRoom(q,room,shopRoom,vViewPosition,facing,roomLamp);
      // Keep a minority of shop bays frosted and some residential blinds
      // closed. Room lighting never illuminates the frame or the wall.
      float clearPane = shopRoom ? 1.0-step(0.91,room) : 1.0-step(0.79,room);
      float distanceFade = 1.0-smoothstep(80.0,130.0,length(vViewPosition));
      interiorVisibility = owInteriorDepth*clearPane*distanceFade
        *smoothstep(0.08,0.38,facing)*(0.46+0.22*facing);
      interiorColor = roomColor*0.33;
      float occupied = shopRoom ? step(0.26,room) : step(0.57,room);
      vec3 tint = shopRoom ? vec3(0.91,0.97,1.0) : mix(vec3(1.0,0.76,0.50),vec3(0.83,0.91,1.0),step(0.73,room));
      owLamp = mix(owLamp,roomColor*tint,interiorVisibility);
      owLit = mix(owLit,(1.65+roomLamp*0.8)*occupied*owGlass,interiorVisibility);
    }
  } else if (kind > 2.5 && kind < 3.5 && (physicalWall || abs(facade.z + 7.0) < 0.1)) {
    // Vertical board joints remain in wall metres on the gable and on distant facade cards.
    float plank = (q.x + 0.14 * style) / 0.21;
    float phase = fract(plank);
    float seam = min(phase, 1.0-phase) * 0.21;
    float aa = max(footprint.x, 0.001);
    float resolved = 1.0 - smoothstep(0.045, 0.16, aa);
    float joint = (1.0 - smoothstep(0.004, 0.004+aa, seam)) * resolved;
    float grain = owNoise(vec2(q.x*17.0, q.y*0.57) + style);
    float variation = owHash(vec2(floor(plank), style*47.0)) - 0.5;
    diffuseColor.rgb *= 0.96 + resolved*(variation*0.135 + (grain-0.5)*0.08 - joint*0.30);
    owWallRelief = 0.0015*resolved*(grain-0.5) - 0.004*joint;
    owWallRoughness = 0.82 + 0.07*(1.0-grain);
  } else if (physicalWall) {
    // Metre-scaled surface detail. Derivative fades remove sub-pixel grit
    // and mortar instead of adding sparkling high-frequency noise at speed.
    vec2 aa = max(fwidth(q), vec2(0.00001));
    float gritFade = 1.0-smoothstep(0.002,0.016,max(aa.x,aa.y));
    float grit = owNoise(q*67.0 + vec2(style*27.0,style*31.0));
    diffuseColor.rgb *= 1.0 + (grit-0.5)*0.055*gritFade;
    owWallRelief = (grit-0.5)*0.0012*gritFade;
    owWallRoughness = 0.87 + (grit-0.5)*0.08*gritFade;
    if (facade.w > 0.5) {
      bool stone = facade.w > 1.5;
      vec2 course = stone ? vec2(0.61,0.285) : vec2(0.245,0.078);
      vec2 tile = q/course;
      tile.x += mod(floor(tile.y),2.0)*0.5;
      vec2 f = fract(tile), edge = min(f,1.0-f)*course;
      float joint = stone ? 0.0045 : 0.003;
      vec2 mask = smoothstep(vec2(joint),vec2(joint)+aa,edge);
      float face = mask.x*mask.y;
      float resolve = 1.0-smoothstep(0.3,0.9,max(aa.x/course.x,aa.y/course.y));
      float variation = owHash(floor(tile)+vec2(style*37.0,style*19.0));
      vec3 unitColor = diffuseColor.rgb*(0.88+0.22*variation);
      vec3 mortar = vec3(0.22,0.215,0.195)*(0.97+0.06*streak);
      vec3 detailed = mix(mortar,unitColor,face);
      // The unresolved average stays close to the resolved material value.
      diffuseColor.rgb = mix(mix(diffuseColor.rgb,mortar,stone ? 0.055 : 0.11),detailed,resolve);
      owWallRelief += (face-1.0)*(stone ? 0.0035 : 0.0025)*resolve;
      owWallRoughness = stone ? 0.93 : 0.9;
    }
  } else if (trim) {
    // Physical cornices, pilasters, sills and roof equipment carry their
    // own vertex colour and must not inherit the facade's window grid.
    diffuseColor.rgb *= 0.92 + 0.1 * owNoise(q * 2.5 + style);
  } else if (roof && kind > 2.5 && kind < 3.5) {
    float spacing = 0.52;
    float sheet = q.x / spacing;
    float foldDistance = min(fract(sheet), 1.0-fract(sheet))*spacing;
    float aa = max(footprint.x, 0.001);
    float resolved = 1.0-smoothstep(0.08, 0.34, aa);
    float fold = (1.0-smoothstep(0.014, 0.014+aa, foldDistance))*resolved;
    float patina = owNoise(q*vec2(0.76,0.23)+style*13.0);
    diffuseColor.rgb *= 0.91 + 0.12*patina + 0.08*fold;
    owWallRelief = 0.018*fold;
    owWallRoughness = 0.53 + 0.16*patina;
  } else if (roof) {
    vec2 tile = vec2(q.x * 2.0, q.y * 3.3);
    tile.x += mod(floor(tile.y), 2.0) * 0.5;
    vec2 f = fract(tile), aa = max(fwidth(tile), vec2(0.002));
    vec2 seam = smoothstep(vec2(0.025), vec2(0.025) + aa, min(f, 1.0 - f));
    diffuseColor.rgb *= (0.8 + 0.27 * owHash(floor(tile))) * (0.78 + 0.22 * seam.x * seam.y);
    // Each course laps over the one below: a gently rising tile face that
    // drops at its butt edge, per-tile roughness, and lichen colonising
    // patches of the older roofs. Relief fades once a tile spans few pixels.
    float roofResolve = 1.0 - smoothstep(0.18, 0.6, max(aa.x, aa.y));
    float lichen = smoothstep(0.58, 0.86, owNoise(q * 0.45 + style * 17.0) * 0.7 + owNoise(q * 2.3 + style * 5.0) * 0.3);
    lichen *= step(0.35, fract(style * 7.31));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.11, 0.068) * (0.8 + 0.4 * owNoise(q * 9.0)), lichen * 0.42);
    owWallRelief = smoothstep(0.0, 0.88, f.y) * (1.0 - smoothstep(0.9, 1.0, f.y)) * 0.009 * roofResolve;
    owWallRoughness = 0.76 + 0.12 * owHash(floor(tile) + 3.1) + 0.08 * lichen;
  } else if (kind > 7.5 && kind < 8.5) {
    // Weathered lime render, a daymark band and water-darkened lower courses.
    float verticalAA = max(0.025, fwidth(q.y));
    float stripe = smoothstep(height * 0.48 - verticalAA, height * 0.48 + verticalAA, q.y)
                 - smoothstep(height * 0.65 - verticalAA, height * 0.65 + verticalAA, q.y);
    vec2 brick = vec2(q.x * 2.1, q.y * 3.65);
    brick.x += 0.5 * mod(floor(brick.y), 2.0);
    vec2 joint = min(fract(brick), 1.0 - fract(brick));
    vec2 aa = max(fwidth(brick), vec2(0.008));
    vec2 mortar = 1.0 - smoothstep(vec2(0.008), vec2(0.032) + aa, joint);
    float close = 1.0 - smoothstep(0.08, 0.7, max(aa.x, aa.y));
    float grain = owNoise(q * vec2(1.4, 0.58) + style);
    float toe = 1.0 - smoothstep(0.45, 3.3 + grain, q.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.47, 0.074, 0.047), stripe);
    diffuseColor.rgb *= (0.91 + 0.1 * grain) * (1.0 - 0.16 * toe) * (1.0 - 0.085 * max(mortar.x, mortar.y) * close);
    owWallRoughness = 0.88 + 0.07 * grain;
  } else if (kind > 9.5) {
    // Broad vertical sheets, raised fastener laps and dirt under the eaves.
    float ribPhase = q.x * 6.2832 / 0.185;
    float ridgeResolve = 1.0 - smoothstep(0.85, 3.0, fwidth(ribPhase));
    float rib = sin(ribPhase) * ridgeResolve;
    vec2 sheet = q / vec2(1.12, 3.2);
    vec2 seam = min(fract(sheet), 1.0-fract(sheet));
    vec2 seamAA = max(fwidth(sheet),vec2(0.001));
    vec2 lap = (1.0-smoothstep(vec2(0.004),vec2(0.018)+seamAA,seam)) *
      (1.0-smoothstep(vec2(0.05),vec2(0.66),seamAA));
    float stain = owNoise(q*vec2(0.92,0.17) + style * 13.0);
    diffuseColor.rgb *= 0.92 + 0.08 * stain + 0.037 * rib - max(lap.x,lap.y) * 0.13;
    owWallRelief = 0.009 * rib + 0.003 * max(lap.x,lap.y);
    owWallRoughness = 0.59 + 0.17 * stain;
  } else if (shed) {
    owRib = sin(q.x * 6.2832 / 0.6);
    diffuseColor.rgb *= 0.92 + 0.08 * owRib;
    // A band of clerestory glazing.
    float band = step(height - 2.6, q.y) * step(q.y, height - 1.2);
    owPaneTilt = vec2(owHash(vec2(floor(q.x / 3.0), style * 5.0 + 1.0)), owHash(vec2(style * 3.0, floor(q.x / 3.0) + 9.0))) - 0.5;
    owGlass = band * step(0.1, fract(q.x / 3.0)) * step(fract(q.x / 3.0), 0.9) * (kind > 8.5 && kind < 9.5 ? 0.0 : 1.0);
  } else {
    float bay = kind < 0.5 ? 2.7 : kind > 6.5 ? 2.2 : 3.3;
    float floorH = kind > 6.5 ? 3.0 : 3.2;
    vec2 cell = vec2(q.x / bay, q.y / floorH);
    vec2 f = fract(cell), id = floor(cell);
    float shopfront = (kind > 0.5 && kind < 2.5 && id.y < 0.5) ? 1.0 : 0.0;
    vec2 lo = shopfront > 0.5 ? vec2(0.06, 0.05) : vec2(0.24, 0.3);
    vec2 hi = shopfront > 0.5 ? vec2(0.94, 0.8) : vec2(0.76, 0.82);
    float inside = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
    float underRoof = step(q.y, height - 0.6) * step(0.4, q.y);
    // Some bays are blind on houses and the chapel has tall lancets.
    float blind = kind < 0.5 ? step(0.82, owHash(id + style * 31.0)) : 0.0;
    owGlass = inside * underRoof * (1.0 - blind);
    owPaneTilt = vec2(owHash(id + vec2(style * 13.0, 71.0)), owHash(id + vec2(29.0, style * 7.0))) - 0.5;
    // Divide the wide shop panes and room windows into real-looking glazing
    // bays. Keep the frames dark when the room lights switch on; otherwise a
    // three-metre shopfront becomes one broad luminous rectangle at night.
    vec2 pane = clamp((f - lo) / (hi - lo), 0.0, 1.0);
    vec2 paneAA = max(fwidth(f) / (hi - lo), vec2(0.001));
    float upright = shopfront > 0.5
      ? min(abs(pane.x - 0.33), abs(pane.x - 0.67))
      : abs(pane.x - 0.5);
    float transom = abs(pane.y - (shopfront > 0.5 ? 0.79 : 0.64));
    float frame = max(1.0 - smoothstep(0.012, 0.012 + paneAA.x, upright),
                      1.0 - smoothstep(0.013, 0.013 + paneAA.y, transom));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.036, 0.044, 0.049), owGlass * frame);
    owGlass *= 1.0 - frame;
    float reveal = (1.0 - inside) * step(lo.x - 0.05, f.x) * step(f.x, hi.x + 0.05) * step(lo.y - 0.05, f.y) * step(f.y, hi.y + 0.05);
    diffuseColor.rgb *= 1.0 - 0.35 * reveal * underRoof;
    // About a third of the rooms are lit, each at its own brightness and
    // lamp colour (warm tungsten to cool fluorescent), dimmer deeper in.
    float room = owHash(id + vec2(style * 97.0, 3.0));
    owLit = step(0.64, room) * owGlass * (0.3 + 0.7 * owHash(id + vec2(5.0, style * 11.0)));
    owLamp = mix(vec3(1.0, 0.66, 0.36), vec3(0.86, 0.9, 1.0), step(0.85, owHash(id + vec2(17.0, style))));
    owLit *= 0.65 + 0.35 * smoothstep(0.0, 0.5, min(f.x - lo.x, hi.x - f.x) / (hi.x - lo.x));
    float ceiling = 1.0 - 0.42 * smoothstep(0.67, 1.0, pane.y);
    float furnishing = 1.0 - 0.52 * (1.0 - smoothstep(0.21, 0.37, pane.y))
      * (1.0 - smoothstep(0.09, 0.19, abs(pane.x - (0.25 + room * 0.43))));
    owLit *= ceiling * furnishing;
  }
  // Unequal room depth, sill shadow and a few closed blinds make each bay
  // read as a recess instead of a flat repeated black rectangle. These are
  // authored facade cues; the material does not claim to ray trace rooms.
  float roomId = physicalPane ? facade.x : owHash(floor(q / vec2(3.3, 3.2)) + style * 43.0);
  vec2 roomUv = physicalPane ? q : fract(q / vec2(3.3, 3.2));
  float blind = step(0.77, roomId) * (0.65 + 0.35 * sin(q.y * 56.0)
    * (1.0 - smoothstep(0.6, 3.2, fwidth(q.y * 56.0))));
  float reflectionBand = pow(clamp(1.0 - abs(roomUv.y - 0.67) * 2.0, 0.0, 1.0), 3.0);
  vec3 glass = mix(vec3(0.032, 0.047, 0.052), vec3(0.075, 0.115, 0.13), reflectionBand);
  glass *= 0.68 + 0.45 * roomId;
  glass = mix(glass, vec3(0.17, 0.155, 0.125), blind * 0.72);
  glass = mix(glass,interiorColor,interiorVisibility);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, owGlass);
  owLit *= (1.0 - blind * 0.72)*paneCoverage;
  diffuseColor.rgb=mix(wallAlbedo,diffuseColor.rgb,paneCoverage);
  owGlass*=paneCoverage;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (owWallRoughness >= 0.0) roughnessFactor = owWallRoughness;
roughnessFactor = mix(roughnessFactor, mix(0.1, 0.18, owNight), owGlass);
roughnessFactor = mix(roughnessFactor, 0.5, step(0.001, abs(owRib)));`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
if (abs(vFacade.z+6.0)<0.1 && vFacade.w>0.5) {metalnessFactor=0.76; roughnessFactor=0.36;}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (owWallRoughness >= 0.0) {
  // Surface-gradient bump in view space; stays correct on every rotated wall.
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy,normal), r2 = cross(normal,sx);
  float determinant = dot(sx,r1);
  if (abs(determinant) > 0.0000000001) {
    vec3 gradient = sign(determinant)*(dFdx(owWallRelief)*r1+dFdy(owWallRelief)*r2);
    normal = normalize(abs(determinant)*normal-gradient);
  }
}
if (abs(owRib) > 0.001) normal = normalize(normal + (viewMatrix * vec4(0.0, 0.0, 0.0, 0.0)).xyz + cross(normal, vec3(0.0, 1.0, 0.0)) * owRib * 0.12);
{
  // Glazing is never one mirror: each pane sits a fraction of a degree off
  // its neighbours, and tempered glass carries a faint roller wave, so the
  // reflected sky and street break up pane by pane. Filtered by footprint.
  float rollerFade = 1.0 - smoothstep(0.04, 0.16, fwidth(vUv.y));
  if (owGlass > 0.001) {
    vec3 wallUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vec3 across = cross(wallUp, normal);
    if (dot(across, across) > 0.01) {
      across = normalize(across);
      vec3 rise = cross(normal, across);
      float roller = sin(vUv.y * 20.27 + owPaneTilt.x * 31.0) * ${GLAZING.roller.toFixed(4)} * rollerFade;
      normal = normalize(normal + (across * owPaneTilt.x + rise * (owPaneTilt.y + roller / ${(2 * GLAZING.tilt).toFixed(4)})) * ${(2 * GLAZING.tilt).toFixed(4)} * owGlass);
    }
  }
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += owLamp * owLit * owNight * 0.2;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
if (owGlass > 0.001) {
  // Insulated glazing: ${GLAZING.interfaces} air-glass interfaces, not one. Single-surface
  // Schlick F becomes 1-(1-F)^n (about 15% at normal incidence, unity at
  // grazing), so windows mirror the sky and street as real ones do while
  // the lit or furnished room still shows through the remaining share.
  float owF = 0.04 + 0.96 * pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), 5.0);
  float owGain = (1.0 - pow(1.0 - owF, ${GLAZING.interfaces.toFixed(1)})) / owF;
  float owSpecular = mix(1.0, owGain, owGlass);
  reflectedLight.indirectSpecular *= owSpecular;
  reflectedLight.directSpecular *= owSpecular;
  reflectedLight.indirectDiffuse *= 1.0 - owGlass * (owGain - 1.0) * owF;
  reflectedLight.directDiffuse *= 1.0 - owGlass * (owGain - 1.0) * owF;
}`,
      );
  };
  material.customProgramCacheKey = () => 'festival-facades-v13-working-farms';
  return material;
}

/**
 * Procedural buildings from the region's structures: town houses, shops and
 * blocks with window grids and shopfronts, farmsteads, the chapel, hangars
 * and warehouses with ribbed cladding and barrel or pitched roofs, the
 * airfield terminal and control tower, and the lighthouse whose lantern
 * shines at night. One merged mesh per street block (walls and roofs share
 * the facade material through per-vertex style data).
 */
export class Buildings {
  readonly root = new T.Group();
  readonly night = { value: 0 };
  /** Isolated render review can compare identical geometry with depth off. */
  readonly interiorDepth = { value: 1 };
  readonly material: T.MeshStandardMaterial;
  readonly lantern: T.MeshStandardMaterial;
  readonly joinery: FacadeJoinery;
  private readonly openings: FacadePlacement[] = [];
  private readonly headlands: HeadlandLantern[] = [];
  private readonly atlas = new FacadeAtlas();
  private readonly atlasMap: { value: T.DataTexture | null } = { value: null };
  private readonly blocks: {
    geometry: T.BufferGeometry;
    bounds: T.Box3;
    common: number;
    near: number;
    far: number;
    distant: number;
    colorStart: number;
    colorCount: number;
    level: 0 | 1 | 2;
  }[] = [];
  private readonly cameraPosition = new T.Vector3();
  private readonly shadowViewport = new T.Vector4();
  stats = { buildings: 0, triangles: 0, openings: 0 };
  private readonly nearestRoad = trackPoint();
  constructor(
    structures: readonly Structure[],
    private readonly roads?: RoadNetwork,
  ) {
    this.root.name = 'Festival buildings';
    this.material = facadeMaterial(this.night, this.interiorDepth, this.atlasMap);
    this.lantern = new T.MeshStandardMaterial({
      color: 0xfff6d8,
      emissive: 0xfff0c0,
      emissiveIntensity: 0.2,
      roughness: 0.2,
    });
    // Bucket compact structure references first. Finalise one block at a time
    // so city-wide JS vertex arrays never coexist with all the GPU buffers.
    const chunks = new Map<string, Structure[]>();
    for (const s of structures) {
      const key = `${Math.floor(s.x / BUILDING_BLOCK)},${Math.floor(s.z / BUILDING_BLOCK)}`;
      let block = chunks.get(key);
      if (!block) chunks.set(key, (block = []));
      block.push(s);
      if (s.kind === 'lighthouse')
        this.headlands.push(
          new HeadlandLantern(s, this.headlands.length ? this.lantern.clone() : this.lantern),
        );
    }
    let triangles = 0;
    for (const [key, block] of chunks) {
      const m = new Mesher();
      for (const s of block) this.add(m, s);
      const g = m.geometry();
      if (!g) continue;
      triangles += (m.piers.length + m.trim.length + m.index.length + m.recessed.length) / 3;
      const mesh = new T.Mesh(g, this.material);
      if (m.projected.length) {
        const common = m.piers.length + m.trim.length + m.index.length;
        const distant = m.index.length + m.cards.length;
        const distantStart = m.recessed.length + common + m.projected.length;
        const ranges: (typeof this.blocks)[number] = {
          geometry: g,
          bounds: g.boundingBox!,
          common,
          near: m.recessed.length,
          far: m.projected.length,
          distant,
          level: 0,
          colorStart: 0,
          colorCount: g.drawRange.count,
        };
        this.blocks.push(ranges);
        let changed = false;
        const restore = () => {
          if (!changed) return;
          g.setDrawRange(ranges.colorStart, ranges.colorCount);
          changed = false;
        };
        mesh.onBeforeShadow = (renderer, _mesh, _camera, lightCamera) => {
          restore();
          if (!(lightCamera instanceof T.OrthographicCamera)) return;
          const pixels = renderer.getCurrentViewport(this.shadowViewport).w;
          if (
            pixels <= 0 ||
            (lightCamera.top - lightCamera.bottom) / (lightCamera.zoom * pixels) < FACADE_RECESS
          )
            return;
          changed = true;
          g.setDrawRange(distantStart, distant);
        };
        // Three brackets each light draw individually. The colour hook also
        // recovers an interrupted draw before the building returns on screen.
        mesh.onAfterShadow = restore;
        mesh.onBeforeRender = restore;
      }
      mesh.name = `Buildings ${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    for (const headland of this.headlands) this.root.add(headland.group);
    this.atlasMap.value = this.atlas.texture();
    this.joinery = new FacadeJoinery(this.openings);
    this.root.add(this.joinery.root);
    this.stats.buildings = structures.length;
    this.stats.triangles = triangles;
  }
  private add(m: Mesher, s: Structure) {
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading),
      base = s.base,
      top = s.base + s.height,
      kind = KIND_CODE[s.kind],
      style = (s.style % 9973) / 9973;
    const local = (x: number, y: number, z: number) =>
      [s.x + c * x - n * z, y, s.z + n * x + c * z] as const;
    const pick = (list: number[], salt: number) => list[(s.style >>> salt) % list.length];
    const metal = s.kind === 'hangar' || s.kind === 'warehouse';
    const farm = s.kind === 'farm';
    const wall = farm
      ? pick([0x925246, 0x7a4a3e, 0x60716b, 0x818075], 7)
      : metal
        ? pick(METAL, 3)
        : s.kind === 'block'
          ? pick([0x9a9690, 0xb9b2a3, 0x8c4f3a, 0xcfc8b8], 5)
          : pick(WALLS, 7);
    const roof = farm
      ? pick([0x686f6a, 0x645e53, 0x706260], 4)
      : metal
        ? 0x5d6266
        : pick(ROOFS, 11);
    const facade = [style, kind, s.floors, s.height] as const;
    const roofFacade = [style, kind, -1, s.height] as const;
    const detailFacade = [style, kind, -2, s.height] as const;
    // All architectural parts bake into the same per-district mesh. The
    // side faces supply true silhouette and self-shadow without adding a
    // material or a draw call for every sill or rooftop.
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
    ) => {
      const x0 = x - w / 2,
        x1 = x + w / 2,
        y0 = y - h / 2,
        y1 = y + h / 2,
        z0 = z - d / 2,
        z1 = z + d / 2;
      // A thin mounted trim keeps its exterior face at skyline distances;
      // only the hidden back and the subpixel return faces drop out.
      const faceZ = Math.abs(z) >= s.hz - 0.06 && d <= 0.32 && y + h / 2 < top + 0.02;
      const faceX = Math.abs(x) >= s.hx - 0.06 && w <= 0.32 && y + h / 2 < top + 0.02;
      const micro = y > top && h <= 0.12 && d <= 0.08;
      const face = (
        points: readonly (readonly [number, number, number])[],
        normal: readonly [number, number, number],
        u: number,
        v: number,
      ) => {
        m.quad(
          points.map(([lx, ly, lz]) => local(lx, ly, lz)),
          [c * normal[0] - n * normal[2], normal[1], n * normal[0] + c * normal[2]],
          [
            [0, 0],
            [u, 0],
            [u, v],
            [0, v],
          ],
          color,
          detailFacade,
          micro || (faceZ && normal[2] * z <= 0) || (faceX && normal[0] * x <= 0)
            ? m.trim
            : m.index,
        );
      };
      face(
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y0, z0],
        ],
        [0, 0, -1],
        h,
        w,
      );
      face(
        [
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
        [0, 0, 1],
        h,
        w,
      );
      face(
        [
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
          [x0, y0, z0],
        ],
        [-1, 0, 0],
        h,
        d,
      );
      face(
        [
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ],
        [1, 0, 0],
        h,
        d,
      );
      face(
        [
          [x0, y1, z0],
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
        ],
        [0, 1, 0],
        d,
        w,
      );
      face(
        [
          [x0, y0, z1],
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
        ],
        [0, -1, 0],
        d,
        w,
      );
    };
    if (s.kind === 'granary') {
      const { hx, hz } = s,
        eave = top - 0.85,
        concrete = 0xa39b89;
      const cladding = pick([0xabb4ad, 0xa9aba2, 0x929f96], 4),
        iron = 0x515b58;
      const steelFace = [style, kind, 0, s.height] as const;
      const rotateNormal = (x: number, y: number, z: number) =>
        [c * x - n * z, y, n * x + c * z] as const;
      box(0, base + 0.52, 0, 2 * hx + 0.08, 1.04, 2 * hz + 0.08, concrete);
      const lower = base + 0.95;
      for (const [x0, z0, x1, z1, nx, nz] of [
        [-hx, -hz, hx, -hz, 0, -1],
        [hx, -hz, hx, hz, 1, 0],
        [hx, hz, -hx, hz, 0, 1],
        [-hx, hz, -hx, -hz, -1, 0],
      ]) {
        const width = Math.hypot(x1 - x0, z1 - z0);
        m.quad(
          [local(x1, lower, z1), local(x0, lower, z0), local(x0, eave, z0), local(x1, eave, z1)],
          rotateNormal(nx, 0, nz),
          [
            [width, 0],
            [0, 0],
            [0, eave - lower],
            [width, eave - lower],
          ],
          cladding,
          steelFace,
        );
      }
      const slope = Math.atan2(top - eave, hz);
      for (const side of [-1, 1]) {
        const a = local(-hx - 0.16, eave, side * (hz + 0.16));
        const b = local(hx + 0.16, eave, side * (hz + 0.16));
        const r0 = local(-hx - 0.16, top, 0),
          r1 = local(hx + 0.16, top, 0);
        m.quad(
          side > 0 ? [a, b, r1, r0] : [b, a, r0, r1],
          rotateNormal(0, Math.cos(slope), side * Math.sin(slope)),
          [
            [0, 0],
            [hx * 2, 0],
            [hx * 2, hz],
            [0, hz],
          ],
          0x606b68,
          detailFacade,
        );
        const x = side * hx;
        const g0 = local(x, eave, -hz),
          g1 = local(x, eave, hz),
          apex = local(x, top, 0);
        m.tri(
          side > 0 ? [g1, g0, apex] : [g0, g1, apex],
          rotateNormal(side, 0, 0),
          cladding,
          detailFacade,
        );
        box(0, eave - 0.16, side * hz, 2 * hx + 0.18, 0.3, 0.16, iron);
        for (const end of [-1, 1])
          box(
            end * (hx - 0.045),
            (lower + eave) / 2,
            side * (hz - 0.045),
            0.17,
            eave - lower,
            0.17,
            iron,
          );
        // Gravity vents sit above the grain line on both long elevations.
        const vy = eave - 1.35,
          vz = side * (hz + 0.045);
        for (const station of [-0.51, 0.51]) {
          const vx = hx * station;
          box(vx, vy, vz, 1.48, 0.98, 0.085, 0x36403e);
          for (let i = -2; i <= 2; i++)
            box(vx, vy + i * 0.161, vz + side * 0.06, 1.37, 0.054, 0.1, 0x8b938b);
          box(vx, vy + 0.51, vz + side * 0.06, 1.64, 0.1, 0.28, iron);
        }
      }
      box(0, top + 0.01, 0, 2 * hx + 0.36, 0.09, 0.23, iron);
      // The projecting threshold and rails sit on the loading elevation.
      const doorX = -hx * 0.24,
        doorZ = hz + 0.07;
      box(doorX, base + 2.36, doorZ, 3.35, 3.1, 0.12, 0x4d5752);
      for (let k = 0; k < 10; k++)
        box(doorX, base + 1.12 + k * 0.27, doorZ + 0.075, 3.05, 0.075, 0.045, 0x737d74);
      for (const side of [-1, 1])
        box(doorX + 1.7 * side, base + 2.32, doorZ, 0.14, 3.3, 0.24, iron);
      box(doorX, base + 3.99, doorZ + 0.03, 3.68, 0.16, 0.35, iron);
      const ladderX = hx + 0.19,
        ladderZ = -hz * 0.42;
      for (const side of [-1, 1])
        box(
          ladderX,
          (base + 1 + top) / 2,
          ladderZ + side * 0.27,
          0.065,
          top - base - 1,
          0.062,
          iron,
        );
      for (let y = base + 1.35; y < eave + 0.15; y += 0.31)
        box(ladderX, y, ladderZ, 0.056, 0.042, 0.56, 0x88918b);
      return;
    }
    if (s.kind === 'tower' || s.kind === 'lighthouse') {
      // Round shaft (16 sides), lighthouse white with a red band.
      const r = Math.min(s.hx, s.hz),
        sides = 16;
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2,
          a1 = ((k + 1) / sides) * Math.PI * 2,
          taper = s.kind === 'lighthouse' ? 0.72 : 1;
        const p0 = [s.x + Math.cos(a0) * r, s.z + Math.sin(a0) * r],
          p1 = [s.x + Math.cos(a1) * r, s.z + Math.sin(a1) * r],
          t0 = [s.x + Math.cos(a0) * r * taper, s.z + Math.sin(a0) * r * taper],
          t1 = [s.x + Math.cos(a1) * r * taper, s.z + Math.sin(a1) * r * taper];
        const am = (a0 + a1) / 2;
        const coastal = s.kind === 'lighthouse';
        const u0 = coastal ? a0 * r : (k + 1) * 2.5;
        const u1 = coastal ? a1 * r : k * 2.5;
        const color = s.kind === 'lighthouse' ? 0xe8e6e0 : 0xb9b6ae;
        m.quad(
          [
            [p1[0], base, p1[1]],
            [p0[0], base, p0[1]],
            [t0[0], top, t0[1]],
            [t1[0], top, t1[1]],
          ],
          [Math.cos(am), 0, Math.sin(am)],
          [
            [u1, 0],
            [u0, 0],
            [u0, s.height],
            [u1, s.height],
          ],
          color,
          [style, coastal ? 8 : 9, 0, s.height],
        );
        if (s.kind === 'tower') {
          // Glazed control cab on top.
          const g0 = [s.x + Math.cos(a0) * r * 1.5, s.z + Math.sin(a0) * r * 1.5],
            g1 = [s.x + Math.cos(a1) * r * 1.5, s.z + Math.sin(a1) * r * 1.5];
          m.quad(
            [
              [g1[0], top, g1[1]],
              [g0[0], top, g0[1]],
              [g0[0], top + 3.4, g0[1]],
              [g1[0], top + 3.4, g1[1]],
            ],
            [Math.cos(am), 0, Math.sin(am)],
            [
              [0.3, 0.5],
              [2.9, 0.5],
              [2.9, 3],
              [0.3, 3],
            ],
            0x30383c,
            [style, 7, 1, 3.4],
          );
          m.tri(
            [
              [g0[0], top + 3.4, g0[1]],
              [s.x, top + 4.2, s.z],
              [g1[0], top + 3.4, g1[1]],
            ],
            [0, 1, 0],
            0x3a3d40,
            roofFacade,
          );
        }
      }
      if (s.kind === 'tower') {
        box(0, top + 3.5, 0, r * 3.15, 0.25, r * 3.15, 0x484e50);
        box(0, top + 5.6, 0, 0.14, 4.1, 0.14, 0x6f7778);
      }
      return;
    }
    // Walls.
    const hx = s.hx,
      hz = s.hz;
    const sides: [number, number, number, number, number, number][] = [
      // x0, z0, x1, z1 (local), outward normal (local x, z)
      [-hx, -hz, hx, -hz, 0, -1],
      [hx, -hz, hx, hz, 1, 0],
      [hx, hz, -hx, hz, 0, 1],
      [-hx, hz, -hx, -hz, -1, 0],
    ];
    const eave = s.kind === 'hangar' ? top - s.hz * 0.45 : top;
    let streetSide = s.frontSide === -1 ? 0 : 2;
    if (
      !s.frontSide &&
      this.roads &&
      (s.kind === 'shop' || s.kind === 'block' || s.kind === 'terminal')
    ) {
      this.roads.nearest(s.x, s.z, this.nearestRoad);
      streetSide = (this.nearestRoad.x - s.x) * -n + (this.nearestRoad.z - s.z) * c >= 0 ? 2 : 0;
    }
    for (const [sideIndex, [x0, z0, x1, z1, nx, nz]] of sides.entries()) {
      if (farm && nx !== 0) {
        addFarmGable(m, s, nx, local, box, wall, style);
        continue;
      }
      const len = Math.hypot(x1 - x0, z1 - z0);
      const a = local(x0, base, z0),
        b = local(x1, base, z1),
        d = local(x1, eave, z1),
        e = local(x0, eave, z0);
      const layout = facadeLayout(s, len, sideIndex, sideIndex === streetSide);
      if (layout) {
        this.stats.openings += layout.openings.length;
        addRecessedFacade(
          m,
          layout,
          b,
          [(a[0] - b[0]) / len, 0, (a[2] - b[2]) / len],
          [c * nx - n * nz, 0, n * nx + c * nz],
          wall,
          style,
          kind,
          this.openings,
        );
        const wallId = this.atlas.add(layout);
        m.quad(
          [b, a, e, d],
          [c * nx - n * nz, 0, n * nx + c * nz],
          [
            [0, 0],
            [len, 0],
            [len, eave - base],
            [0, eave - base],
          ],
          wall,
          [style, kind, -8 - wallId, facadeFinish(wall)],
          m.cards,
        );
        continue;
      }
      // Counter-clockwise seen from outside.
      m.quad(
        [b, a, e, d],
        [c * nx - n * nz, 0, n * nx + c * nz],
        [
          [0, 0],
          [len, 0],
          [len, eave - base],
          [0, eave - base],
        ],
        wall,
        facade,
      );
    }
    // Roofs.
    const pitched = s.kind === 'house' || s.kind === 'farm' || s.kind === 'chapel';
    if (s.kind === 'hangar') {
      // Barrel vault across the short axis.
      const steps = 8,
        rise = top - eave;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps,
          t1 = (k + 1) / steps;
        const z0 = -hz + 2 * hz * t0,
          z1 = -hz + 2 * hz * t1,
          y0 = eave + rise * Math.sin(t0 * Math.PI),
          y1 = eave + rise * Math.sin(t1 * Math.PI),
          slope = Math.atan2(y1 - y0, z1 - z0);
        // Local normal (0, cos, -sin) rotated into the world.
        const normal: [number, number, number] = [
          n * Math.sin(slope),
          Math.cos(slope),
          -c * Math.sin(slope),
        ];
        m.quad(
          [local(hx, y0, z0), local(-hx, y0, z0), local(-hx, y1, z1), local(hx, y1, z1)],
          normal,
          [
            [0, z0],
            [2 * hx, z0],
            [2 * hx, z1],
            [0, z1],
          ],
          roof,
          roofFacade,
        );
        // Gable infill.
        for (const side of [-1, 1]) {
          const nx = side;
          m.tri(
            side < 0
              ? [local(-hx, eave, z0), local(-hx, y1, z1), local(-hx, y0, z0)]
              : [local(hx, eave, z0), local(hx, y0, z0), local(hx, y1, z1)],
            [c * nx, 0, n * nx],
            wall,
            facade,
          );
          m.tri(
            side < 0
              ? [local(-hx, eave, z0), local(-hx, eave, z1), local(-hx, y1, z1)]
              : [local(hx, eave, z0), local(hx, y1, z1), local(hx, eave, z1)],
            [c * nx, 0, n * nx],
            wall,
            facade,
          );
        }
      }
    } else if (pitched) {
      // Gable roof along local x, ridge rising 0.45 × half depth, eaves overhang.
      const ridge = top + hz * 0.55,
        o = 0.45;
      const ra = local(-hx - o, ridge, 0),
        rb = local(hx + o, ridge, 0);
      for (const side of [-1, 1]) {
        const ea = local(-hx - o, top - 0.15, side * (hz + o)),
          eb = local(hx + o, top - 0.15, side * (hz + o));
        const slope = Math.atan2(ridge - top, hz),
          ny = Math.cos(slope),
          nl = Math.sin(slope) * side;
        const corners = side > 0 ? [ea, eb, rb, ra] : [eb, ea, ra, rb];
        m.quad(
          corners,
          [-n * nl, ny, c * nl],
          [
            [0, 0],
            [2 * hx, 0],
            [2 * hx, hz],
            [0, hz],
          ],
          roof,
          roofFacade,
        );
      }
      for (const side of [-1, 1]) {
        m.tri(
          side < 0
            ? [local(-hx, top, -hz), local(-hx, top, hz), local(-hx, ridge, 0)]
            : [local(hx, top, hz), local(hx, top, -hz), local(hx, ridge, 0)],
          [c * side, 0, n * side],
          wall,
          [style, kind, -3, s.height],
        );
      }
      if (s.kind === 'farm') {
        // Ventilated hay lofts face each gable, clear of the windows below.
        const rise = ridge - top;
        for (const side of [-1, 1]) {
          const x = side * (hx + 0.055),
            y = top + rise * 0.39;
          const width = Math.min(1.84, hz * 0.32),
            height = rise * 0.43;
          box(x, y, 0, 0.13, height, width, 0x40423b);
          for (let k = 0; k < 6; k++)
            box(
              x + side * 0.07,
              y + ((k + 0.5) / 6 - 0.5) * height,
              0,
              0.12,
              height * 0.074,
              width - 0.12,
              0x937b62,
            );
          for (const hand of [-1, 1])
            box(x + side * 0.07, y, (hand * width) / 2, 0.15, height + 0.19, 0.11, 0xb3a18b);
          box(x + side * 0.11, y + height / 2 + 0.07, 0, 0.39, 0.12, width + 0.34, 0x66594c);
        }
        for (const side of [-1, 1])
          box(0, top - 0.18, side * (hz + o - 0.08), 2 * (hx + o), 0.18, 0.14, 0x766758);
      }
      if (s.kind === 'chapel') {
        // Bell tower at the west end.
        const tx = -hx + 2.4;
        const towerTop = ridge + 7;
        for (const [x0, z0, x1, z1, nx, nz] of [
          [tx - 2.2, -2.2, tx + 2.2, -2.2, 0, -1],
          [tx + 2.2, -2.2, tx + 2.2, 2.2, 1, 0],
          [tx + 2.2, 2.2, tx - 2.2, 2.2, 0, 1],
          [tx - 2.2, 2.2, tx - 2.2, -2.2, -1, 0],
        ] as const)
          m.quad(
            [
              local(x1, base, z1),
              local(x0, base, z0),
              local(x0, towerTop, z0),
              local(x1, towerTop, z1),
            ],
            [c * nx - n * nz, 0, n * nx + c * nz],
            [
              [0, 0],
              [4.4, 0],
              [4.4, towerTop - base],
              [0, towerTop - base],
            ],
            0xb3a891,
            [style, 4, 0, towerTop - base],
          );
        for (const [x0, z0, x1, z1] of [
          [tx - 2.3, -2.3, tx + 2.3, -2.3],
          [tx + 2.3, -2.3, tx + 2.3, 2.3],
          [tx + 2.3, 2.3, tx - 2.3, 2.3],
          [tx - 2.3, 2.3, tx - 2.3, -2.3],
        ] as const)
          m.tri(
            [local(x1, towerTop, z1), local(x0, towerTop, z0), local(tx, towerTop + 5, 0)],
            [0, 1, 0],
            0x45484c,
            roofFacade,
          );
      }
    } else {
      // Flat roof with a parapet lip.
      m.quad(
        [local(-hx, top, -hz), local(-hx, top, hz), local(hx, top, hz), local(hx, top, -hz)],
        [0, 1, 0],
        [
          [0, 0],
          [0, 2 * hz],
          [2 * hx, 2 * hz],
          [2 * hx, 0],
        ],
        metal ? roof : 0x6a6763,
        roofFacade,
      );
    }
    if (!metal) {
      const trim = pick([0xddd7c7, 0xc5c0b3, 0x777d7e, 0xb1a797], 4);
      // A stone base course, shallow corner pilasters and a real projecting
      // cornice anchor each building. Maximum frontage projection is 0.30 m,
      // within the existing >=1 m clearance beyond all road shoulders.
      const footing = s.foundationBase ?? base;
      box(
        0,
        (footing + base + 0.5) / 2,
        0,
        hx * 2 + 0.12,
        base + 0.5 - footing,
        hz * 2 + 0.12,
        0x736f66,
      );
      box(0, top - 0.08, 0, hx * 2 + 0.5, 0.25, hz * 2 + 0.5, trim);
      for (const side of [-1, 1]) {
        box(side * (hx - 0.1), base + s.height / 2, -hz - 0.035, 0.32, s.height, 0.13, trim);
        box(side * (hx - 0.1), base + s.height / 2, hz + 0.035, 0.32, s.height, 0.13, trim);
      }
      if (s.kind === 'shop' || s.kind === 'block' || s.kind === 'terminal') {
        for (let floor = 1; floor < s.floors; floor++) {
          const y = base + floor * 3.2 + 0.08;
          const depth = floor === 1 ? 0.23 : 0.1;
          for (const side of [-1, 1]) {
            box(
              0,
              y,
              side * (hz + depth / 2),
              hx * 2 + 0.24,
              floor === 1 ? 0.26 : 0.14,
              depth,
              trim,
            );
            box(side * (hx + depth / 2), y, 0, depth, 0.14, hz * 2, trim);
          }
        }
        // Roof parapets: the upper skyline now has thickness and returns.
        for (const side of [-1, 1]) {
          box(0, top + 0.25, side * (hz - 0.1), hx * 2, 0.5, 0.2, wall);
          box(side * (hx - 0.1), top + 0.25, 0, 0.2, 0.5, hz * 2, wall);
        }
        if (s.kind === 'block' && (s.style & 3) !== 0) {
          // Setback service floor and overhanging metal cap vary the skyline
          // while keeping every addition inside its collision footprint.
          const rx = hx * 0.47,
            rz = hz * 0.43;
          box(
            0,
            top + 1.1,
            hz * 0.12,
            rx * 2,
            2.2,
            rz * 2,
            pick([0x707d7c, 0xb8b4a7, 0x867566], 2),
          );
          box(0, top + 2.23, hz * 0.12, rx * 2 + 0.4, 0.16, rz * 2 + 0.4, 0x3a4548);
        }
        // Roof services make scale readable from taller chase/photo views.
        box(-hx * 0.6, top + 0.5, hz * 0.45, Math.min(2.1, hx * 0.42), 0.9, 1.4, 0x839093);
        for (let rib = 0; rib < 4; rib++)
          box(
            -hx * 0.6,
            top + 0.5,
            hz * 0.45 - 0.69 + rib * 0.22,
            Math.min(2.15, hx * 0.44),
            0.11,
            0.06,
            0x424b4d,
          );
      } else if (farm) {
        const ridge = top + hz * 0.55;
        const length = Math.min(4.4, hx * 0.42);
        for (const end of [-1, 1]) {
          const x = end * hx * 0.47;
          box(x, ridge + 0.12, 0, length, 0.55, 0.73, 0x464e4c);
          for (const height of [0.16, 0.30])
            box(x, ridge + height, 0, length + 0.06, 0.056, 0.81, 0x778078);
          box(x, ridge + 0.44, 0, length + 0.31, 0.12, 1.06, 0x727873);
        }
      } else if (pitched && s.kind !== 'chapel') {
        const chimneyY = top + hz * 0.43;
        box(hx * 0.53, chimneyY, hz * 0.2, 0.85, 2.4, 0.9, 0x81664f);
        box(hx * 0.53, chimneyY + 1.21, hz * 0.2, 1.03, 0.18, 1.08, 0x4b4b48);
      }
    } else {
      // Hangar and warehouse side frames break up large flat sheds without
      // changing their clearance or adding ground-level obstacles.
      for (let x = -hx + 1; x < hx; x += 6)
        for (const side of [-1, 1])
          box(x, base + (eave - base) / 2, side * (hz + 0.05), 0.16, eave - base, 0.12, 0x515d5f);
      box(0, eave - 0.35, 0, hx * 2 + 0.2, 0.25, hz * 2 + 0.2, 0x566367);
    }
  }
  update(camera: T.Camera, quality: QualityPreset, viewportHeight = 720) {
    this.joinery.update(camera, quality);
    camera.getWorldPosition(this.cameraPosition);
    // The projection sets the world distance at which recess parallax becomes
    // subpixel. A nearer corner of a broad block keeps the entire block detailed.
    const pixels = { low: 0.95, medium: 0.8, high: 0.65, ultra: 0.55 }[quality];
    const threshold =
      (FACADE_RECESS * viewportHeight * camera.projectionMatrix.elements[5] * 0.5) / pixels;
    for (const block of this.blocks) {
      const distance = block.bounds.distanceToPoint(this.cameraPosition);
      const skyline = threshold * 3.3;
      const level =
        distance < threshold * (block.level === 0 ? 1.12 : 0.96)
          ? 0
          : distance < skyline * (block.level === 2 ? 0.9 : 1.08)
            ? 1
            : 2;
      if (level === block.level) continue;
      block.level = level;
      const start =
        level === 0 ? 0 : level === 1 ? block.near : block.near + block.common + block.far;
      const count =
        level === 2 ? block.distant : block.common + (level === 0 ? block.near : block.far);
      block.colorStart = start;
      block.colorCount = count;
      block.geometry.setDrawRange(start, count);
    }
  }
  setNight(night: number, time = 0, eye?: T.Vector3) {
    this.night.value = night;
    for (const headland of this.headlands) headland.update(time, night, eye);
  }
  dispose() {
    this.joinery.dispose();
    for (const headland of this.headlands) headland.dispose();
    this.atlasMap.value?.dispose();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    if (!this.headlands.length) this.lantern.dispose();
  }
}
