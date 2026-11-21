import { clamp } from '../../core/math.ts';
import { trackPoint } from '../track.ts';
import type { RoadEdge, RoadNetwork } from './road-network.ts';

type Direction = -1 | 1;
export function trafficLaneOffset(edge: RoadEdge, lane: number) {
  const laneCount = edge.spec.halfWidth >= 6 ? 2 : 1;
  return -(Math.min(lane, laneCount - 1) + 0.5) * edge.spec.halfWidth / laneCount;
}

function laneFrame(net: RoadNetwork, e: RoadEdge, dir: Direction, s: number, lane: number) {
  const p = net.at(e.offset + (dir > 0 ? s : e.length - s), trackPoint());
  const lateral = dir * trafficLaneOffset(e, lane);
  return {
    x: p.x + p.nx * lateral,
    z: p.z + p.nz * lateral,
    tx: p.tx * dir,
    tz: p.tz * dir,
    ground: net.surfaceHeight(p, lateral, e.spec.halfWidth, e.spec.crown),
    grade: dir * p.gradient,
    cross: dir * (p.bank - Math.max(0, e.spec.crown - Math.abs(p.bank)) * Math.sign(lateral)),
  };
}
type LaneFrame = ReturnType<typeof laneFrame>;
const SAMPLES = 32;

/** Cubic segment between the actual incoming and outgoing lane centres. A
 * one-time arc-length table keeps wheel travel and the collision body's speed
 * in metres. Its tangents are the directions at the two road stations. */
export class TrafficTurn {
  private readonly metres = new Float64Array(SAMPLES + 1);
  readonly length: number;
  readonly speedLimit: number;
  readonly maxCurvature: number;
  travelled = -1;
  x = 0;
  z = 0;
  tx = 0;
  tz = 1;
  ground = 0;
  grade = 0;
  cross = 0;

  private constructor(
    readonly entry: number,
    readonly exit: number,
    private readonly start: LaneFrame,
    private readonly end: LaneFrame,
    private readonly hx0: number,
    private readonly hz0: number,
    private readonly hx1: number,
    private readonly hz1: number,
  ) {
    let px = start.x, pz = start.z, curvature = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const k = this.evaluate(i / SAMPLES);
      if (i) this.metres[i] = this.metres[i - 1] + Math.hypot(this.x - px, this.z - pz);
      curvature = Math.max(curvature, k);
      px = this.x;
      pz = this.z;
    }
    this.length = this.metres[SAMPLES];
    this.maxCurvature = curvature;
    this.speedLimit = clamp(Math.sqrt(3.6 / Math.max(0.001, curvature)), 2.6, 13);
  }

  static between(net: RoadNetwork, edge: RoadEdge, dir: Direction, next: RoadEdge, nextDir: Direction, lane: number, minRadius = 0) {
    const endNode = dir > 0 ? edge.to : edge.from;
    if (net.nodes[endNode].edges.length < 3 || (nextDir > 0 ? next.from : next.to) !== endNode) return null;
    const a = laneFrame(net, edge, dir, edge.length, lane);
    const b = laneFrame(net, next, nextDir, 0, lane);
    const cosine = clamp(a.tx * b.tx + a.tz * b.tz, -1, 1);
    const angle = Math.acos(cosine);
    if (angle < 0.30 || angle > 2.62) return null;
    const left = a.tz * b.tx - a.tx * b.tz > 0;
    // Right-hand traffic: the inside turn must clear the pedestrian landing.
    // The outside turn has room to sweep across both opposing lane centres.
    const width = Math.min(edge.spec.halfWidth, next.spec.halfWidth);
    const longest = Math.min(edge.length * 0.32, next.length * 0.32, 19);
    let setback = Math.min((left ? 2.10 : 1.38) * width + 0.5, longest);
    if (setback < 3) return null;
    // An inner front wheel reaches rack lock before the centre of the axle.
    // Widen the join when this car's wheelbase and steering stops require it.
    for (let attempt = 0; attempt < 3; attempt++) {
      const path = this.fromStations(net, edge, dir, next, nextDir, lane, setback);
      if (!path || path.maxCurvature * minRadius <= 1.004) return path;
      const increase = Math.max(0.18, (minRadius - 1 / path.maxCurvature) * Math.tan(angle / 2) * 1.12);
      if (setback + increase > longest) return null;
      setback += increase;
    }
    return null;
  }

  private static fromStations(net: RoadNetwork, edge: RoadEdge, dir: Direction, next: RoadEdge, nextDir: Direction, lane: number, setback: number) {
    const start = laneFrame(net, edge, dir, edge.length - setback, lane);
    const end = laneFrame(net, next, nextDir, setback, lane);
    const dx = end.x - start.x, dz = end.z - start.z;
    const cross = start.tx * end.tz - start.tz * end.tx;
    if (Math.abs(cross) < 0.1) return null;
    const runIn = (dx * end.tz - dz * end.tx) / cross;
    const runOut = (start.tx * dz - start.tz * dx) / cross;
    if (Math.min(runIn, runOut) < 1 || Math.max(runIn, runOut) > setback * 3) return null;
    const bend = Math.acos(clamp(start.tx * end.tx + start.tz * end.tz, -1, 1));
    const handle = 4 / 3 * Math.tan(bend / 4) / Math.tan(bend / 2);
    return new TrafficTurn(edge.length - setback, setback, start, end,
      start.x + start.tx * runIn * handle, start.z + start.tz * runIn * handle,
      end.x - end.tx * runOut * handle, end.z - end.tz * runOut * handle);
  }

  private evaluate(t: number) {
    const u = 1 - t, a = this.start, b = this.end;
    this.x = u ** 3 * a.x + 3 * u * u * t * this.hx0 + 3 * u * t * t * this.hx1 + t ** 3 * b.x;
    this.z = u ** 3 * a.z + 3 * u * u * t * this.hz0 + 3 * u * t * t * this.hz1 + t ** 3 * b.z;
    const vx = 3 * (u * u * (this.hx0 - a.x) + 2 * u * t * (this.hx1 - this.hx0) + t * t * (b.x - this.hx1));
    const vz = 3 * (u * u * (this.hz0 - a.z) + 2 * u * t * (this.hz1 - this.hz0) + t * t * (b.z - this.hz1));
    const ax = 6 * (u * (this.hx1 - 2 * this.hx0 + a.x) + t * (b.x - 2 * this.hx1 + this.hx0));
    const az = 6 * (u * (this.hz1 - 2 * this.hz0 + a.z) + t * (b.z - 2 * this.hz1 + this.hz0));
    const speed = Math.hypot(vx, vz);
    this.tx = vx / speed;
    this.tz = vz / speed;
    return Math.abs(vx * az - vz * ax) / speed ** 3;
  }

  sample(distance: number) {
    const d = clamp(distance, 0, this.length);
    let low = 0, high = SAMPLES;
    while (high - low > 1) {
      const i = (low + high) >> 1;
      if (this.metres[i] < d) low = i;
      else high = i;
    }
    const t = (low + (d - this.metres[low]) / (this.metres[high] - this.metres[low])) / SAMPLES;
    this.evaluate(t);
    const f = d / this.length, u = 1 - f;
    // Hermite height and its derivative meet both cambered road planes
    // without a normal snap where the nearest centreline changes.
    const a = this.start, b = this.end;
    const height = b.ground - a.ground;
    this.ground = a.ground + height * f * f * (3 - 2 * f) +
      this.length * f * u * (u * a.grade - f * b.grade);
    this.grade = 6 * f * u * height / this.length + u * (1 - 3 * f) * a.grade + f * (3 * f - 2) * b.grade;
    this.cross = a.cross + (b.cross - a.cross) * f * f * (3 - 2 * f);
  }
}
