import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackPoint, type TrackPoint } from '../../simulation/track.ts';
import {
  ROAD_FLAG,
  type RoadEdge,
  type RoadNetwork,
} from '../../simulation/open-world/road-network.ts';
import type { TerrainField } from '../../simulation/open-world/terrain-field.ts';
import { TerrainCarver } from '../../simulation/open-world/terrain-tiles.ts';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';

/** Original construction dimensions in metres. The collision-backed face
 * remains halfWidth + shoulder + 0.35; rolled crests and bolt heads intrude
 * by at most 6 cm, leaving at least 29 cm beyond the physical shoulder.
 * Reference 098 supports separate rolled shoulders, panel joints, posts
 * and raised round reflectors; these dimensions are authored, not measured
 * engineering or a claim of a certified roadside restraint system. */
export const FESTIVAL_GUARDRAIL = Object.freeze({
  chunk: 512,
  faceOffset: 0.35,
  postPitch: 4,
  reflectorPitch: 16,
  endInset: 0.65,
});

// Outboard offset, height above the banked road edge. Folded top/bottom
// returns catch narrow highlights; two deeper lobes retain an open shadow
// channel. A surface is shared only within each fold, never across a crease.
const PROFILE = [
  [0.024, 0.585],
  [-0.012, 0.603],
  [-0.046, 0.632],
  [-0.055, 0.67],
  [-0.025, 0.708],
  [0.013, 0.755],
  [-0.025, 0.802],
  [-0.055, 0.84],
  [-0.046, 0.878],
  [-0.012, 0.907],
  [0.024, 0.925],
] as const;
const UP = new T.Vector3(0, 1, 0);

export interface FestivalGuardrailRun {
  edge: number;
  side: -1 | 1;
  /** Inclusive network sample endpoints; no geometry outside this run. */
  first: number;
  last: number;
}

/** Segment ownership is identical to the existing collision presentation:
 * both samples need the side flag; full bridge segments use their parapet.
 * A run never continues over an edge gap or through a junction mouth. */
export function festivalGuardrailRuns(network: RoadNetwork): FestivalGuardrailRun[] {
  const runs: FestivalGuardrailRun[] = [];
  for (const edge of network.edges) {
    for (const [bit, side] of [
      [ROAD_FLAG.BARRIER_LEFT, -1],
      [ROAD_FLAG.BARRIER_RIGHT, 1],
    ] as const) {
      let first = -1;
      for (let i = edge.first; i <= edge.last; i++) {
        const active =
          i < edge.last &&
          (network.flags[i] & bit) !== 0 &&
          (network.flags[i + 1] & bit) !== 0 &&
          !(
            (network.flags[i] & ROAD_FLAG.BRIDGE) !== 0 &&
            (network.flags[i + 1] & ROAD_FLAG.BRIDGE) !== 0
          );
        if (active && first < 0) first = i;
        if (!active && first >= 0) {
          runs.push({ edge: edge.index, side, first, last: i });
          first = -1;
        }
      }
    }
  }
  return runs;
}

class Batch {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly index: number[] = [];
  private readonly point = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly normalMatrix = new T.Matrix3();

  add(geometry: T.BufferGeometry, transform: T.Matrix4) {
    const offset = this.position.length / 3;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    this.normalMatrix.getNormalMatrix(transform);
    for (let i = 0; i < position.count; i++) {
      this.point.fromBufferAttribute(position, i).applyMatrix4(transform);
      this.direction.fromBufferAttribute(normal, i).applyMatrix3(this.normalMatrix).normalize();
      this.position.push(this.point.x, this.point.y, this.point.z);
      this.normal.push(this.direction.x, this.direction.y, this.direction.z);
      this.uv.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0);
    }
    if (geometry.index)
      for (let i = 0; i < geometry.index.count; i++)
        this.index.push(offset + geometry.index.getX(i));
    else for (let i = 0; i < position.count; i++) this.index.push(offset + i);
  }

  quad(
    points: readonly T.Vector3[],
    aNormal: T.Vector3,
    bNormal: T.Vector3,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    side: number,
  ) {
    const offset = this.position.length / 3;
    points.forEach((p, i) => {
      const n = i < 2 ? aNormal : bNormal;
      this.position.push(p.x, p.y, p.z);
      this.normal.push(n.x, n.y, n.z);
    });
    this.uv.push(u0, v0, u0, v1, u1, v0, u1, v1);
    const order = side > 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
    this.index.push(...order.map((i) => offset + i));
  }

  finish() {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    const uv = new T.Float32BufferAttribute(this.uv, 2);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute('uv1', uv);
    geometry.setIndex(this.index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

interface RailFrame {
  base: T.Vector3;
  outward: T.Vector3;
  along: T.Vector3;
  turn: T.Vector3;
  station: number;
}

/** A rail frame uses finite differences of its own offset, bank-following
 * path. The road centre's grade alone misses the changing bank in a bend. */
class RailFrames {
  private readonly point = trackPoint();
  private readonly before = trackPoint();
  private readonly after = trackPoint();
  constructor(
    private readonly network: RoadNetwork,
    private readonly edge: RoadEdge,
    private readonly side: number,
  ) {}
  private pointAt(station: number, out: TrackPoint) {
    if (station <= this.edge.offset) this.network.pointOnSegment(this.edge.first, 0, out);
    else if (station >= this.edge.offset + this.edge.length)
      this.network.pointOnSegment(this.edge.last - 1, 1, out);
    else this.network.at(station, out);
  }
  private base(point: TrackPoint) {
    const spec = this.edge.spec;
    const lateral = this.side * (spec.halfWidth + spec.shoulder + FESTIVAL_GUARDRAIL.faceOffset);
    return new T.Vector3(
      point.x + point.nx * lateral,
      this.network.surfaceHeight(point, this.side * spec.halfWidth, spec.halfWidth, spec.crown),
      point.z + point.nz * lateral,
    );
  }
  at(station: number): RailFrame {
    this.pointAt(station, this.point);
    this.pointAt(station - 0.5, this.before);
    this.pointAt(station + 0.5, this.after);
    return {
      base: this.base(this.point),
      outward: new T.Vector3(this.point.nx * this.side, 0, this.point.nz * this.side).normalize(),
      along: this.base(this.after).sub(this.base(this.before)),
      turn: new T.Vector3(
        (this.after.nx - this.before.nx) * this.side,
        0,
        (this.after.nz - this.before.nz) * this.side,
      ),
      station,
    };
  }
}

function railBand(batch: Batch, a: RailFrame, b: RailFrame, side: number, overlap = 0) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [x0, y0] = PROFILE[i];
    const [x1, y1] = PROFILE[i + 1];
    const vertex = (f: RailFrame, x: number, y: number) =>
      f.base
        .clone()
        .addScaledVector(f.outward, x - overlap)
        .addScaledVector(UP, y);
    const normal = (f: RailFrame) => {
      const across = f.outward
        .clone()
        .multiplyScalar(x1 - x0)
        .addScaledVector(UP, y1 - y0);
      const n = f.along
        .clone()
        .addScaledVector(f.turn, (x0 + x1) * 0.5 - overlap)
        .cross(across);
      if (n.dot(f.outward) > 0) n.negate();
      return n.normalize();
    };
    batch.quad(
      [vertex(a, x0, y0), vertex(a, x1, y1), vertex(b, x0, y0), vertex(b, x1, y1)],
      normal(a),
      normal(b),
      a.station,
      b.station,
      y0,
      y1,
      side,
    );
  }
}

function merged(parts: T.BufferGeometry[]) {
  const joined = mergeGeometries(parts, false)!;
  // Cylinder caps duplicate their centre and rim per triangle. Weld only
  // identical position/normal/UV tuples once, before repeating a template;
  // this preserves creases while reducing every post/joint's buffer cost.
  const result = mergeVertices(joined, 1e-6);
  joined.dispose();
  for (const part of parts) part.dispose();
  return result;
}

/** A real open channel rather than a solid box: web and two folded flanges.
 * Y is scaled at placement so each post actually enters the carved ground. */
function postGeometry() {
  return merged([
    new T.BoxGeometry(0.014, 1, 0.15).translate(0.17, 0.5, 0),
    ...[-1, 1].map((side) => new T.BoxGeometry(0.09, 1, 0.012).translate(0.208, 0.5, side * 0.069)),
  ]);
}

function jointGeometry() {
  const parts: T.BufferGeometry[] = [
    new T.BoxGeometry(0.156, 0.16, 0.13).translate(0.09, 0.755, 0),
  ];
  for (const height of [0.67, 0.84])
    for (const along of [-0.053, 0.053])
      parts.push(
        new T.CylinderGeometry(0.012, 0.012, 0.008, 6, 1)
          .rotateZ(Math.PI / 2)
          .translate(-0.056, height, along),
      );
  return merged(parts);
}

function endGeometry() {
  const shape = new T.Shape();
  const left = -0.052,
    right = 0.065,
    bottom = 0.587,
    top = 0.923,
    r = 0.035;
  shape.moveTo(left + r, bottom);
  shape.lineTo(right - r, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + r);
  shape.lineTo(right, top - r);
  shape.quadraticCurveTo(right, top, right - r, top);
  shape.lineTo(left + r, top);
  shape.quadraticCurveTo(left, top, left, top - r);
  shape.lineTo(left, bottom + r);
  shape.quadraticCurveTo(left, bottom, left + r, bottom);
  return new T.ExtrudeGeometry(shape, {
    depth: 0.13,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.005,
    bevelThickness: 0.005,
    curveSegments: 3,
  }).translate(0, 0, -0.065);
}

function reflectorGeometry() {
  const metal: T.BufferGeometry[] = [
    new T.CylinderGeometry(0.012, 0.012, 0.235, 5).translate(0.05, 1.025, 0),
  ];
  const faces: T.BufferGeometry[] = [];
  for (const direction of [-1, 1]) {
    const normal = new T.Vector3(-Math.SQRT1_2, 0, direction * Math.SQRT1_2);
    const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    const centre = new T.Vector3(0.05, 1.11, direction * 0.035);
    metal.push(
      new T.CylinderGeometry(0.072, 0.072, 0.028, 10)
        .rotateX(Math.PI / 2)
        .applyQuaternion(rotation)
        .translate(centre.x, centre.y, centre.z),
    );
    const front = centre.addScaledVector(normal, 0.015);
    faces.push(
      new T.CircleGeometry(0.054, 10)
        .applyQuaternion(rotation)
        .translate(front.x, front.y, front.z),
    );
  }
  return { metal: merged(metal), faces: merged(faces) };
}

/** Static steel and reflectors each merge into their own spatial batch.
 * All temporary templates are disposed after construction; RoadMeshes owns
 * the resulting geometry and the two supplied, shared materials. */
export function buildFestivalGuardrails(
  network: RoadNetwork,
  field: TerrainField,
  steel: T.Material,
  reflector: T.Material,
) {
  const root = new T.Group();
  root.name = 'Festival roadside barrier assemblies';
  const runs = festivalGuardrailRuns(network);
  const chunks = new Map<string, { steel: Batch; reflectors?: Batch }>();
  const chunkAt = (point: T.Vector3) => {
    const key = `${Math.floor(point.x / FESTIVAL_GUARDRAIL.chunk)},${Math.floor(point.z / FESTIVAL_GUARDRAIL.chunk)}`;
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = { steel: new Batch() }));
    return chunk;
  };
  const carver = new TerrainCarver(field, network);
  const post = postGeometry();
  const joint = jointGeometry();
  const end = endGeometry();
  const marker = reflectorGeometry();
  const transform = (frame: RailFrame) =>
    new T.Matrix4()
      .makeBasis(frame.outward, UP, new T.Vector3(-frame.outward.z, 0, frame.outward.x))
      .setPosition(frame.base);
  const stats = { runs: runs.length, posts: 0, reflectors: 0, endCaps: 0, chunks: 0, triangles: 0 };
  try {
    for (const run of runs) {
      const edge = network.edges[run.edge];
      const frames = new RailFrames(network, edge, run.side);
      const from = network.s[run.first];
      const to = network.s[run.last];
      let previous = frames.at(from);
      for (let i = run.first; i < run.last; i++) {
        const next = frames.at(network.s[i + 1]);
        railBand(
          chunkAt(previous.base.clone().add(next.base).multiplyScalar(0.5)).steel,
          previous,
          next,
          run.side,
        );
        previous = next;
      }
      // Closed, rounded plates finish the exposed sheet without extending
      // an uncollidable terminal into a junction or narrowing the shoulder.
      for (const station of [from + 0.09, to - 0.09]) {
        const frame = frames.at(station);
        chunkAt(frame.base).steel.add(end, transform(frame));
        stats.endCaps++;
      }
      const stations: number[] = [];
      for (
        let station = from + FESTIVAL_GUARDRAIL.endInset;
        station <= to - FESTIVAL_GUARDRAIL.endInset;
        station += FESTIVAL_GUARDRAIL.postPitch
      )
        stations.push(station);
      const finalPost = to - FESTIVAL_GUARDRAIL.endInset;
      if (
        stations.length &&
        finalPost - stations[stations.length - 1] > FESTIVAL_GUARDRAIL.postPitch * 0.65
      )
        stations.push(finalPost);
      let nextReflector = from + FESTIVAL_GUARDRAIL.endInset;
      for (const station of stations) {
        const frame = frames.at(station);
        const chunk = chunkAt(frame.base);
        const matrix = transform(frame);
        const groundPoint = frame.base.clone().addScaledVector(frame.outward, 0.2);
        const base = carvedGroundHeight(carver, groundPoint.x, groundPoint.z) - 0.12;
        const height = Math.max(0.12, frame.base.y + 0.905 - base);
        const postMatrix = matrix.clone().scale(new T.Vector3(1, height, 1));
        postMatrix.elements[13] = base;
        chunk.steel.add(post, postMatrix);
        chunk.steel.add(joint, matrix);
        railBand(
          chunk.steel,
          frames.at(station - 0.09),
          frames.at(station + 0.09),
          run.side,
          0.003,
        );
        stats.posts++;
        if (station + 0.001 < nextReflector) continue;
        chunk.steel.add(marker.metal, matrix);
        (chunk.reflectors ??= new Batch()).add(marker.faces, matrix);
        nextReflector = station + FESTIVAL_GUARDRAIL.reflectorPitch;
        stats.reflectors++;
      }
    }
  } finally {
    for (const geometry of [post, joint, end, marker.metal, marker.faces]) geometry.dispose();
  }
  for (const [key, batches] of chunks) {
    for (const [name, batch, material] of [
      ['Guardrail assembly', batches.steel, steel],
      ['Guardrail marker faces', batches.reflectors, reflector],
    ] as const) {
      if (!batch) continue;
      const geometry = batch.finish();
      stats.triangles += geometry.index!.count / 3;
      const mesh = new T.Mesh(geometry, material);
      mesh.name = `${name} ${key}`;
      mesh.userData.guardrailChunk = key;
      mesh.castShadow = name === 'Guardrail assembly';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
  }
  stats.chunks = chunks.size;
  return { root, stats, runs };
}
