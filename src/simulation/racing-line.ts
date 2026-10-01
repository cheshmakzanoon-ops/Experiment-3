import { clamp, mod } from '../core/math.ts';
import { trackPoint, type Track } from './track.ts';

/** Racing line solver settings. */
export const RACING_LINE = Object.freeze({
  /** Metres between line samples. */
  step: 4,
  /** Clearance from the track edge to the car's centre (as the traffic
   * planner's lane limit), so the wheels stay on the asphalt. */
  edgeMargin: 2.4,
  /** Neighbour spacings (in samples), coarse to fine. */
  scales: [16, 8, 4, 2, 1] as const,
  /** Relaxation sweeps at each spacing. */
  sweeps: 260,
});

/** Solutions shared by tracks built from the same circuit geometry. */
const solved = new Map<string, { offsets: Float32Array; curvature: Float32Array }>();
function geometryKey(track: Track) {
  const circuit = (track as { circuit?: { id?: string } }).circuit;
  return circuit?.id ? `${circuit.id}:${track.flat}:${track.length}` : null;
}
const lines = new WeakMap<Track, RacingLine>();
/** The racing line of a track, solved once per circuit geometry. */
export function racingLineFor(track: Track) {
  let line = lines.get(track);
  if (!line) lines.set(track, (line = new RacingLine(track)));
  return line;
}

/** A minimum-curvature racing line: the lateral offset from the centreline
 * that spreads each corner's turning over the widest arc the track allows
 * (outside on entry, inside at the apex, outside on exit), so corners carry
 * more speed. Solved by relaxing the discrete second-difference (curvature)
 * energy of the path, with every point clamped inside the track. Shortest
 * path smoothing (neighbour averaging) is not used: it hugs the inside of a
 * whole corner and tightens it. Deterministic and computed once per track. */
export class RacingLine {
  readonly count: number;
  readonly step: number;
  /** Lateral offset (m, along the track normal) at each sample. */
  readonly offsets: Float32Array;
  /** Signed curvature (1/m) of the line, in the centreline's convention. */
  readonly curvature: Float32Array;
  constructor(readonly track: Track) {
    const key = geometryKey(track);
    const cached = key ? solved.get(key) : undefined;
    if (cached) {
      this.count = cached.offsets.length;
      this.step = track.length / this.count;
      this.offsets = cached.offsets;
      this.curvature = cached.curvature;
      return;
    }
    const n = Math.max(16, Math.round(track.length / RACING_LINE.step));
    this.count = n;
    this.step = track.length / n;
    const cx = new Float64Array(n),
      cz = new Float64Array(n),
      nx = new Float64Array(n),
      nz = new Float64Array(n),
      limit = new Float64Array(n),
      l = new Float64Array(n),
      px = new Float64Array(n),
      pz = new Float64Array(n);
    const p = trackPoint();
    for (let i = 0; i < n; i++) {
      track.at(i * this.step, p);
      cx[i] = p.x;
      cz[i] = p.z;
      nx[i] = p.nx;
      nz[i] = p.nz;
      limit[i] = Math.max(0, p.width - RACING_LINE.edgeMargin);
      px[i] = p.x;
      pz[i] = p.z;
    }
    for (const k of RACING_LINE.scales)
      for (let sweep = 0; sweep < RACING_LINE.sweeps; sweep++)
        for (let i = 0; i < n; i++) {
          const a = (i - k + n) % n,
            b = (i + k) % n,
            a2 = (i - 2 * k + 2 * n) % n,
            b2 = (i + 2 * k) % n;
          // Position that zeroes the second-difference energy around i.
          const tx = (4 * (px[a] + px[b]) - (px[a2] + px[b2])) / 6,
            tz = (4 * (pz[a] + pz[b]) - (pz[a2] + pz[b2])) / 6;
          const move = 0.5 * ((tx - px[i]) * nx[i] + (tz - pz[i]) * nz[i]);
          l[i] = clamp(l[i] + move, -limit[i], limit[i]);
          px[i] = cx[i] + nx[i] * l[i];
          pz[i] = cz[i] + nz[i] * l[i];
        }
    this.offsets = Float32Array.from(l);
    this.curvature = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Heading change between the incoming and outgoing chords, as the
      // centreline's curvature is defined.
      const a = (i - 1 + n) % n,
        b = (i + 1) % n;
      const ax = px[i] - px[a],
        az = pz[i] - pz[a],
        bx = px[b] - px[i],
        bz = pz[b] - pz[i];
      const turn = Math.atan2(az * bx - ax * bz, ax * bx + az * bz);
      this.curvature[i] = turn / ((Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2);
    }
    if (key) solved.set(key, { offsets: this.offsets, curvature: this.curvature });
  }
  private interpolate(values: Float32Array, s: number) {
    const u = mod(s, this.track.length) / this.step;
    const i = Math.floor(u) % this.count,
      f = u - Math.floor(u);
    return values[i] + (values[(i + 1) % this.count] - values[i]) * f;
  }
  /** Lateral offset of the line at distance `s`. */
  offsetAt(s: number) {
    return this.interpolate(this.offsets, s);
  }
  /** Signed line curvature at distance `s`. */
  curvatureAt(s: number) {
    return this.interpolate(this.curvature, s);
  }
}
