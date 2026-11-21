import * as T from 'three';
import type { StreetTree } from '../../simulation/open-world/street-trees.ts';
import type { RoadEdge, RoadNetwork } from '../../simulation/open-world/road-network.ts';
import {
  FOOTWAY_OFFSETS,
  footwayHeight,
  footwayVertex,
  townFootways,
} from '../../simulation/open-world/town-footways.ts';
import type { TownCrossing } from '../../simulation/open-world/town-crossings.ts';
import { trackPoint, type TrackPoint } from '../../simulation/track.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';

/** Retain every joint or bend that moves a section by over 2 mm. The plan
 * varies linearly between its inner and outer edges. In elevation, every
 * stone band is the same base height plus a constant times kerb admission.
 * Bounding both quantities therefore bounds every point across the section. */
export function footwayStations(net: RoadNetwork, edge: RoadEdge, side: number, chunkSize: number) {
  const p = trackPoint(),
    profile = townFootways(net),
    count = edge.last - edge.first + 1;
  const width = edge.spec.halfWidth;
  const channels = 6,
    values = new Float64Array(count * channels);
  const stations = [edge.first];
  for (let j = 0; j < count; j++) {
    const row = edge.first + j,
      i = Math.min(row, edge.last - 1),
      t = row - i;
    net.pointOnSegment(i, t, p);
    const at = j * channels;
    values[at] = p.x + p.nx * side * width;
    values[at + 1] = p.z + p.nz * side * width;
    values[at + 2] = p.x + p.nx * side * (width + edge.spec.shoulder);
    values[at + 3] = p.z + p.nz * side * (width + edge.spec.shoulder);
    values[at + 4] = net.surfaceHeight(p, side * width, width, edge.spec.crown);
    // 0.2 m bounds the maximum rise of the kerb above the dropped shoulder.
    values[at + 5] = 0.2 * profile.strength(edge, i, t, side);
  }
  const simplify = (a: number, b: number) => {
    let selected = 0,
      largest = 0.002;
    const span = net.s[edge.first + b] - net.s[edge.first + a];
    for (let j = a + 1; j < b; j++) {
      const t = (net.s[edge.first + j] - net.s[edge.first + a]) / span;
      const error = (k: number) =>
        values[j * channels + k] -
        (values[a * channels + k] + t * (values[b * channels + k] - values[a * channels + k]));
      const distance = Math.max(
        Math.hypot(error(0), error(1)),
        Math.hypot(error(2), error(3)),
        Math.abs(error(4)) + Math.abs(error(5)),
      );
      if (distance > largest) {
        largest = distance;
        selected = j;
      }
    }
    if (selected) {
      simplify(a, selected);
      simplify(selected, b);
    } else stations.push(edge.first + b);
  };
  let start = 0,
    cellX = 0,
    cellZ = 0;
  for (let j = 0; j < count - 1; j++) {
    const i = edge.first + j,
      x = Math.floor((net.x[i] + net.x[i + 1]) / (2 * chunkSize)),
      z = Math.floor((net.z[i] + net.z[i + 1]) / (2 * chunkSize));
    if (
      j > start &&
      (x !== cellX || z !== cellZ || net.s[i + 1] - net.s[edge.first + start] > 48)
    ) {
      simplify(start, j);
      start = j;
    }
    cellX = x;
    cellZ = z;
  }
  simplify(start, count - 1);
  return stations;
}

interface PavingBatch {
  vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    nx: number,
    ny: number,
    nz: number,
  ): number;
  quad(a: number, b: number, c: number, d: number): void;
}

/** The paving, bevel and gutter share a draw. Each face has its own normal
 * across the kerb and follows the longitudinal grade of both end stations. */
export function addTownFootway(
  batch: PavingBatch,
  edge: RoadEdge,
  p: TrackPoint,
  q: TrackPoint,
  side: number,
  y0: number,
  y1: number,
  strength0: number,
  strength1: number,
) {
  const rows = strength0 || strength1 ? FOOTWAY_OFFSETS : [0, edge.spec.shoulder];
  const pt = (s: TrackPoint, y: number, d: number, strength: number) =>
    footwayVertex(s, edge.spec.halfWidth, side, y, d, strength, new T.Vector3());
  const a = new T.Vector3(),
    b = new T.Vector3(),
    normal = new T.Vector3();
  let left0 = pt(p, y0, 0, strength0),
    left1 = pt(q, y1, 0, strength1);
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i],
      right0 = pt(p, y0, d, strength0),
      right1 = pt(q, y1, d, strength1);
    // Average the two triangle planes of this very slightly twisted road quad.
    a.subVectors(right1, left0);
    b.subVectors(right0, left1);
    normal.crossVectors(a, b).normalize();
    if (normal.y < 0) normal.negate();
    const vertex = (point: T.Vector3, out: number, station: number) =>
      batch.vertex(
        point.x,
        point.y,
        point.z,
        out,
        station - edge.offset,
        normal.x,
        normal.y,
        normal.z,
      );
    const v0 = vertex(left0, rows[i - 1], p.s),
      v1 = vertex(right0, d, p.s);
    const w0 = vertex(left1, rows[i - 1], q.s),
      w1 = vertex(right1, d, q.s);
    if (side > 0) batch.quad(v0, v1, w0, w1);
    else batch.quad(v1, v0, w1, w0);
    left0 = right0;
    left1 = right1;
  }
}

/** Ochre warning tiles sit flush with the two lowered pavement landings.
 * Their UV chart is in metres, independent of city coordinates and chunk origin. */
export function addCrossingLanding(
  batch: PavingBatch, net: RoadNetwork, edge: RoadEdge, site: TownCrossing, side: number,
) {
  const length = site.to - site.from;
  const inset = Math.max(0.12, (length - 3.2) * 0.5);
  const a = net.pointOnSegment(site.first, inset / length, trackPoint());
  const b = net.pointOnSegment(site.first, 1 - inset / length, trackPoint());
  const at = (p: TrackPoint, across: number) => {
    const l = side * (edge.spec.halfWidth + across);
    return new T.Vector3(p.x + p.nx * l,
      net.surfaceHeight(p, side * edge.spec.halfWidth, edge.spec.halfWidth, edge.spec.crown)
        + footwayHeight(across, 0) + 0.004, p.z + p.nz * l);
  };
  const a0 = at(a, 0.48), a1 = at(a, 1.28), b0 = at(b, 0.48), b1 = at(b, 1.28);
  const normal = new T.Vector3().subVectors(b0, a0).cross(new T.Vector3().subVectors(a1, a0)).normalize();
  if (normal.y < 0) normal.negate();
  const vertex = (p: T.Vector3, u: number, v: number) =>
    batch.vertex(p.x, p.y, p.z, u - 8, v, normal.x, normal.y, normal.z);
  const near0 = vertex(a0, 0, 0), near1 = vertex(a1, 0.8, 0);
  const far0 = vertex(b0, 0, length - 2 * inset), far1 = vertex(b1, 0.8, length - 2 * inset);
  if (side > 0) batch.quad(near0, near1, far0, far1);
  else batch.quad(near1, near0, far1, far0);
}

/** Flush cast-iron surrounds occupy the flat flagstone band. Their UVs are
 * metres from the trunk in a reserved chart of the same paving draw. */
export function addStreetTreeGrate(batch: PavingBatch, site: StreetTree) {
  const nx = site.tz,
    nz = -site.tx;
  const normal = new T.Vector3(
    -site.grade * site.tx - site.crossfall * nx,
    1,
    -site.grade * site.tz - site.crossfall * nz,
  ).normalize();
  const vertex = (across: number, along: number) =>
    batch.vertex(
      site.x + across * nx + along * site.tx,
      site.y + across * site.crossfall + along * site.grade + 0.006,
      site.z + across * nz + along * site.tz,
      across - 4,
      along,
      normal.x,
      normal.y,
      normal.z,
    );
  batch.quad(vertex(-0.47, -0.66), vertex(0.47, -0.66), vertex(-0.47, 0.66), vertex(0.47, 0.66));
}

export function pavingMaterial(wet: { value: number }) {
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.87 });
  material.name = 'Port Ilse cut-stone footways';
  (material as T.MeshStandardMaterial & { defines: Record<string, string> }).defines = {
    USE_UV: '',
  };
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owPavingWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float owPavingWet;
${OW_NOISE_GLSL}
float owPavingJoint;
float owDrainMetal;
float owKerbStone;
float owStudRelief = 0.0;
// Coverage falls to the area average once a pixel spans an entire period.
float owStoneJoint(float cell, float halfWidth) {
  float footprint = max(fwidth(cell), 0.0001);
  float d = abs(fract(cell+0.5)-0.5);
  float edge = 1.0 - smoothstep(max(0.0,halfWidth-footprint*0.45),halfWidth+footprint*0.45,d);
  return mix(edge,2.0*halfWidth,smoothstep(0.25,0.85,footprint));
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p=vUv; // Metres out from the road and metres along it.
  if (p.x < -6.0) {
    vec2 local = p + vec2(8.0, 0.0);
    float px = max(max(fwidth(local.x), fwidth(local.y)), 0.0001);
    vec2 stud = (fract(local / 0.05) - 0.5) * 0.05;
    float r = length(stud);
    float resolve = 1.0 - smoothstep(0.012, 0.05, px);
    float cap = 1.0 - smoothstep(max(0.0,0.010-px*0.5),0.014+px*0.5,r);
    owStudRelief = 0.004 * cap * resolve;
    float joint = max(owStoneJoint(local.x / 0.4, 0.006),owStoneJoint(local.y / 0.4, 0.006));
    vec3 aggregate = vec3(0.43,0.264,0.083) * (0.94 + 0.1 * owNoise(local * 18.0));
    diffuseColor.rgb = mix(aggregate * (0.98 + 0.08 * cap * resolve),vec3(0.12,0.107,0.082),joint)
      * (1.0 - 0.25 * owPavingWet);
    owPavingJoint = joint;
    owDrainMetal = owKerbStone = 0.0;
  } else if (p.x < -2.0) {
    vec2 local = p + vec2(4.0, 0.0);
    vec2 aa = max(fwidth(local), vec2(0.0002));
    float r = length(local), pixel = max(aa.x, aa.y);
    float rim = 1.0 - smoothstep(-pixel, pixel, min(0.445-abs(local.x), 0.635-abs(local.y)));
    float rings = owStoneJoint(r/0.07, 0.2);
    // Four radial cross braces support the casting. The central opening
    // exposes soil and leaves room for the independently streamed trunk.
    float brace = min(min(abs(local.x), abs(local.y)),
      min(abs(local.x+local.y), abs(local.x-local.y)) * 0.7071);
    float ribs = max(rings, 1.0-smoothstep(0.009-pixel, 0.009+pixel, brace));
    float hole = smoothstep(0.19-pixel, 0.19+pixel, r);
    owDrainMetal = max(rim, ribs) * hole;
    owPavingJoint = 0.0;
    owKerbStone = 0.0;
    vec3 soil = vec3(0.053,0.040,0.028) * (0.88+0.24*owNoise(local*29.0));
    diffuseColor.rgb = mix(soil*(1.0-0.4*hole), vec3(0.125,0.115,0.094), owDrainMetal)
      * (1.0-owPavingWet*0.30);
  } else {
  float along=p.y/0.82, across=p.x/0.49+mod(floor(along),2.0)*0.5;
  float stone=owHash(vec2(floor(across),floor(along)));
  float grain=owNoise(p*12.0)-0.5;
  float flags=max(owStoneJoint(across,0.011),owStoneJoint(along,0.008));
  vec3 slab=mix(vec3(0.23,0.231,0.218),vec3(0.36,0.349,0.319),stone);
  float px=clamp(fwidth(p.x),0.0005,0.12);
  float toe=smoothstep(0.185-px,0.185+px,p.x);
  owKerbStone=toe*(1.0-smoothstep(0.455-px,0.455+px,p.x));
  float kerbJoint=owStoneJoint(p.y/0.97,0.006);
  vec3 kerb=mix(vec3(0.33,0.314,0.283),vec3(0.46,0.443,0.398),owHash(vec2(floor(p.y/0.97),7.0)));
  vec3 stoneColor=mix(slab,kerb,owKerbStone);
  owPavingJoint=mix(flags,kerbJoint,owKerbStone);
  vec3 color=mix(stoneColor*(1.0+grain*0.12),vec3(0.075,0.08,0.075),owPavingJoint*0.7);
  // An inlet in the gutter, with a cast lip and transverse bearing bars.
  float inletZ=abs(mod(p.y+3.6,19.4)-9.7);
  vec2 aa=max(fwidth(p),vec2(0.001));
  float inlet=(1.0-smoothstep(0.069-aa.x,0.069+aa.x,abs(p.x-0.095)))*
      (1.0-smoothstep(0.31-aa.y,0.31+aa.y,inletZ));
  float open=(1.0-smoothstep(0.053-aa.x,0.053+aa.x,abs(p.x-0.095)))*
      (1.0-smoothstep(0.288-aa.y,0.288+aa.y,inletZ));
  float bars=owStoneJoint(p.y/0.047,0.16);
  owDrainMetal=inlet*(1.0-open*(1.0-bars));
  vec3 gutter=mix(vec3(0.15,0.148,0.14),vec3(0.088,0.093,0.091),owPavingWet)*(1.0+grain*0.21);
  color=mix(gutter,color,toe);
  color=mix(color,vec3(0.025,0.027,0.025),inlet);
  color=mix(color,vec3(0.155,0.17,0.165),owDrainMetal);
  diffuseColor.rgb=color*(1.0-owPavingWet*0.26);
  }
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor=mix(mix(0.87,0.38,owPavingWet)+owPavingJoint*0.08-owKerbStone*0.04,
    mix(0.59,0.31,owPavingWet),owDrainMetal);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (vUv.x < -6.0) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1.0e-12)
    normal = normalize(normal - (dFdx(owStudRelief)*rx + dFdy(owStudRelief)*ry) / det);
}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = 0.67*owDrainMetal;',
      );
  };
  material.customProgramCacheKey = () => 'festival-port-footway-crossings-v3';
  return material;
}
