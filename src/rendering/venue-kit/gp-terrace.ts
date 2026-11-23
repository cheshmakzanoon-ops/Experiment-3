import * as T from 'three';
import { rod } from '../geometry.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Metres in the existing spectator frame. Eight rows have a 490 mm rise.
 * Each climb is divided into three public stair treads inside the two aisles. */
export const GP_AISLE_HALF_WIDTH = 0.7;
const FRONT = 1.19,
  PITCH = 0.98,
  RISE = 0.49,
  BACK = 10.125;
type Point = readonly [number, number];
function topProfile(stairs: boolean): Point[] {
  const points: Point[] = [
    [-0.95, 0],
    [FRONT, 0],
    [FRONT, 0.2],
  ];
  const cuts = stairs ? 3 : 1;
  for (let step = 1; step <= 7 * cuts; step++) {
    const u = FRONT + (PITCH * step) / cuts;
    points.push([u, 0.2 + (RISE * (step - 1)) / cuts], [u, 0.2 + (RISE * step) / cuts]);
  }
  points.push([BACK, 0.2 + 7 * RISE]);
  return points;
}
const seated = topProfile(false),
  stairs = topProfile(true);
const underside: Point[] = [
  [BACK, 3.4],
  [FRONT + 8 * PITCH, 3.4],
  [FRONT, -0.52],
  [0.85, -0.22],
  [-0.95, -0.22],
  [-0.95, 0],
];

/** A closed folded deck. The underside spans over the open structure;
 * vertical precast faces close every gap between feet and the next row. The
 * two cutouts carry their own steps and cheeks with no overlapping tops. */
export function gpTerraceGeometry(length: number, side: -1 | 1) {
  if (!(length >= 12 && Number.isFinite(length)) || (side !== 1 && side !== -1))
    throw new Error('Invalid GP terrace footprint');
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  function vertex(point: Point, z: number, face: number, along: number) {
    p.push(side * point[0], point[1], z);
    uv.push(z + length / 2, face * 16 + along);
  }
  function quad(a: Point, b: Point, z0: number, z1: number, face: number) {
    const at = p.length / 3,
      extent = Math.hypot(b[0] - a[0], b[1] - a[1]);
    vertex(a, z0, face, 0);
    vertex(a, z1, face, 0);
    vertex(b, z1, face, extent);
    vertex(b, z0, face, extent);
    if (side === 1) indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
    else indices.push(at, at + 2, at + 1, at, at + 3, at + 2);
  }
  function endFace(points: readonly Point[], z: number, normalZ: number) {
    const at = p.length / 3;
    const ring = points.map((point) => {
      vertex(point, z, 5, point[1] + 0.6);
      return new T.Vector2(...point);
    });
    for (const [a, b, c] of T.ShapeUtils.triangulateShape(ring, [])) {
      const A = points[a],
        B = points[b],
        C = points[c];
      const winding = side * ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]));
      if (winding * normalZ > 0) indices.push(at + a, at + b, at + c);
      else indices.push(at + a, at + c, at + b);
    }
  }
  const half = GP_AISLE_HALF_WIDTH,
    a = length / 4;
  const edges = [-length / 2, -a - half, -a + half, a - half, a + half, length / 2];
  for (let span = 0; span < edges.length - 1; span++) {
    const aisle = span % 2 === 1,
      profile = aisle ? stairs : seated;
    for (let i = 1; i < profile.length; i++) {
      const from = profile[i - 1],
        to = profile[i];
      const ascending = to[1] > from[1];
      const face = ascending ? 2 : aisle && i > 2 ? 3 : 1;
      quad(from, to, edges[span], edges[span + 1], face);
    }
  }
  const bottom = [seated[seated.length - 1], ...underside];
  for (let i = 1; i < bottom.length; i++)
    quad(bottom[i - 1], bottom[i], -length / 2, length / 2, 5);
  const outline = [...seated, ...underside.slice(0, -1)];
  endFace(outline, -length / 2, -1);
  endFace(outline, length / 2, 1);
  for (const centre of [-a, a])
    for (const sign of [-1, 1]) {
      const z = centre + sign * half;
      for (let row = 0; row < 7; row++)
        for (let stair = 1; stair < 3; stair++) {
          const u = FRONT + (row + stair / 3) * PITCH,
            v = FRONT + (row + (stair + 1) / 3) * PITCH;
          const lo = 0.2 + RISE * row,
            hi = lo + (RISE * stair) / 3;
          endFace(
            [
              [u, lo],
              [v, lo],
              [v, hi],
              [u, hi],
            ],
            z,
            sign,
          );
        }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'Precast GP spectator terrace and stepped aisles';
  return g;
}

/** Two interrupted handrail flights per aisle. Posts stand on the horizontal
 * treads and rejoin the handrail beyond each landing. */
export function gpAisleRails(root: T.Group, steel: T.Material, length: number, side: -1 | 1) {
  const stairHeight = (u: number) =>
    0.2 + (Math.min(21, Math.floor(((u - FRONT) * 3) / PITCH + 1e-7)) * RISE) / 3;
  for (const z of [-length / 4, length / 4])
    for (const [first, last] of [
      [1, 9],
      [12, 20],
    ]) {
      const location = (step: number) => FRONT + ((step + 0.5) * PITCH) / 3;
      const post = (step: number, lift: number) =>
        new T.Vector3(side * location(step), stairHeight(location(step)) + lift, z);
      rod(root, steel, post(first, 0.9), post(last, 0.9), 0.023);
      for (const step of [first, (first + last) / 2, last])
        rod(root, steel, post(step, 0), post(step, 0.9), 0.019);
      for (const [step, direction] of [
        [first, -1],
        [last, 1],
      ]) {
        const end = post(step, 0.9),
          turn = end.clone();
        turn.x += side * direction * 0.12;
        turn.y += direction * 0.03;
        rod(root, steel, end, turn, 0.023);
        rod(root, steel, turn, new T.Vector3(turn.x, turn.y - 0.13, z), 0.023);
      }
    }
}

/** The same concrete batch carries the risers, aisle nosings and support
 * footings. Ordinary box UVs stay outside the tagged metre coordinates. */
export function installGpTerraceFinish(material: T.MeshStandardMaterial) {
  return chainShaderHook(material, 'gp-precast-terrace-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec2 vGpTerrace;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpTerrace=uv;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vGpTerrace;', 'fragment');
    injectAfter(
      shader,
      'map_fragment',
      `
      vec2 terracePixel=max(fwidth(vGpTerrace),vec2(.0001));
      float face=floor(vGpTerrace.y/16.), depth=mod(vGpTerrace.y,16.);
      if(face>=1.){
        float z=vGpTerrace.x;
        float joint=abs(fract(z/5.2+.5)-.5)*5.2;
        float seal=(1.-smoothstep(.004-terracePixel.x*.5,.009+terracePixel.x*.5,joint))
          *(1.-smoothstep(.06,.25,terracePixel.x));
        float wash=.5+.5*sin(z*.69+sin(z*.31)*2.2);
        diffuseColor.rgb*=1.-.27*seal;
        if(face==2.)diffuseColor.rgb*=.92+.08*wash-.10*exp(-depth*13.);
        if(face==3.){
          float edge=clamp((min(depth+terracePixel.y*.5,.065)-max(depth-terracePixel.y*.5,.016))/terracePixel.y,0.,1.);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.45,.36,.19),edge*(.57+.20*wash));
        }
      }`,
      'fragment',
    );
  });
}
