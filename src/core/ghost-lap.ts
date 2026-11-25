import { CAR_STRIDE, F, H, HEADER, carBase } from '../simulation/protocol.ts';
import {
  recordIncompatibility,
  SIMULATION_VERSION,
  type RecordCategory,
} from './session-identity.ts';

/** One recorded lap of the player car, replayed as a Time Trial ghost. Poses
 * come from the worker snapshots the player actually drove; nothing is
 * resimulated or smoothed. Each sample is [lapTime, s, x, y, z, qx, qy, qz, qw,
 * steer, speed]. */
export const GHOST_VERSION = 1;
export const GHOST_FIELDS = 11;
/** Sample at 30 Hz using the worker's Float32 lap clock. */
export const GHOST_SAMPLE_SECONDS = 1 / 30;
const GHOST_SAMPLE_INTERVAL = GHOST_SAMPLE_SECONDS - 1e-6;
export const GHOST_MIN_LAP_SECONDS = 10;
export const GHOST_MAX_LAP_SECONDS = 600;
export const GHOST_MIN_SAMPLES = 20;
/** Enough for every accepted interval below the duration limit, including
 * Float32 clock tolerance and the final sample at the crossing. */
export const GHOST_MAX_SAMPLES = Math.ceil(GHOST_MAX_LAP_SECONDS / GHOST_SAMPLE_INTERVAL) + 1;
const GHOST_POSE_FIELDS = [F.X, F.Y, F.Z, F.QX, F.QY, F.QZ, F.QW, F.STEER, F.SPEED];

function validLapTime(time: number) {
  return time > GHOST_MIN_LAP_SECONDS && time < GHOST_MAX_LAP_SECONDS;
}

export interface GhostLap {
  version: typeof GHOST_VERSION;
  circuit: string;
  trackLength: number;
  lapTime: number;
  sectors: [number, number, number];
  assist: string;
  compound: string;
  weather: string;
  recordedAt: string;
  samples: Float32Array;
  /** Record identity (WP12); absent on ghosts saved before it existed. */
  vehicle?: string;
  physics?: number;
}

/** The Formula APX-01 keeps its original key; other vehicles get their own. */
export function ghostKey(circuit: string, vehicle = 'apx01') {
  return `ghost:v${GHOST_VERSION}:${circuit}${vehicle === 'apx01' ? '' : `:${vehicle}`}`;
}

/** Reject anything that is not a complete, time-ordered, finite recording. */
export function validateGhost(
  value: unknown,
  circuit: string,
  trackLength: number,
  category: RecordCategory = { circuit, vehicle: 'apx01', physics: SIMULATION_VERSION },
): GhostLap | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Partial<GhostLap>;
  if (recordIncompatibility(g, category)) return null;
  if (
    g.version !== GHOST_VERSION ||
    g.circuit !== circuit ||
    typeof g.trackLength !== 'number' ||
    !Number.isFinite(g.trackLength) ||
    !Number.isFinite(trackLength) ||
    Math.abs(g.trackLength - trackLength) > 0.01 ||
    typeof g.lapTime !== 'number' ||
    !validLapTime(g.lapTime) ||
    !Array.isArray(g.sectors) ||
    g.sectors.length !== 3 ||
    !g.sectors.every((t) => typeof t === 'number' && Number.isFinite(t) && t > 0) ||
    !(g.samples instanceof Float32Array) ||
    g.samples.length < GHOST_FIELDS * GHOST_MIN_SAMPLES ||
    g.samples.length > GHOST_FIELDS * GHOST_MAX_SAMPLES ||
    g.samples.length % GHOST_FIELDS !== 0
  )
    return null;
  let previous = -Infinity;
  for (let i = 0; i < g.samples.length; i += GHOST_FIELDS) {
    for (let k = 0; k < GHOST_FIELDS; k++) if (!Number.isFinite(g.samples[i + k])) return null;
    if (g.samples[i] <= previous) return null;
    previous = g.samples[i];
  }
  if (g.samples[0] > 0.5 || previous < g.lapTime - 0.5) return null;
  return {
    version: GHOST_VERSION,
    circuit,
    trackLength: g.trackLength,
    lapTime: g.lapTime,
    sectors: [g.sectors[0], g.sectors[1], g.sectors[2]],
    assist: String(g.assist ?? ''),
    compound: String(g.compound ?? ''),
    weather: String(g.weather ?? ''),
    recordedAt: String(g.recordedAt ?? ''),
    samples: g.samples,
    vehicle: category.vehicle,
    physics: category.physics,
  };
}

export interface GhostContext {
  circuit: string;
  trackLength: number;
  assist: string;
  compound: string;
  weather: string;
  vehicle?: string;
}

/** Records the player's current lap from accepted snapshots. When a lap
 * completes it returns a ghost only if that lap was valid, penalty-free and
 * driven by the player (no AI demonstration, pit request or pit stop). */
export class GhostRecorder {
  private samples: number[] = [];
  private laps = -1;
  private lastSample = -Infinity;
  private eligible = true;
  constructor(private readonly context: GhostContext) {}
  reset() {
    this.samples = [];
    this.laps = -1;
    this.lastSample = -Infinity;
    this.eligible = true;
  }
  /** `driverControlled` is false while automation drives the car. */
  observe(frame: Float32Array, driverControlled: boolean): GhostLap | null {
    if (frame.length < HEADER + CAR_STRIDE) {
      this.discardLap();
      return null;
    }
    const o = carBase(0),
      laps = Math.round(frame[o + F.LAPS]),
      lapTime = frame[o + F.LAP_TIME];
    if (!Number.isSafeInteger(laps) || laps < 0) {
      this.discardLap();
      return null;
    }
    let completed: GhostLap | null = null;
    if (this.laps >= 0 && laps === this.laps + 1) {
      const lapTimeTotal = frame[o + F.LAST_LAP];
      if (
        this.eligible &&
        frame[o + F.LAST_LAP_VALID] === 1 &&
        frame[o + F.LAST_LAP_ASSISTED] === 0 &&
        validLapTime(lapTimeTotal) &&
        lapTimeTotal >= this.lastSample &&
        Number.isFinite(frame[o + F.SECTOR_1]) &&
        Number.isFinite(frame[o + F.SECTOR_2]) &&
        Number.isFinite(frame[o + F.SECTOR_3]) &&
        this.samples.length >= GHOST_FIELDS * GHOST_MIN_SAMPLES &&
        this.samples[0] < 0.5 &&
        // Close the lap exactly at the crossing, so playback spans the lap time.
        this.pushSample(frame, lapTimeTotal, this.context.trackLength)
      ) {
        const candidate: GhostLap = {
          version: GHOST_VERSION,
          circuit: this.context.circuit,
          trackLength: this.context.trackLength,
          lapTime: lapTimeTotal,
          sectors: [
            frame[o + F.SECTOR_1] || lapTimeTotal / 3,
            frame[o + F.SECTOR_2] || lapTimeTotal / 3,
            frame[o + F.SECTOR_3] || lapTimeTotal / 3,
          ],
          assist: this.context.assist,
          compound: this.context.compound,
          weather: this.context.weather,
          recordedAt: new Date().toISOString(),
          samples: Float32Array.from(this.samples),
          vehicle: this.context.vehicle ?? 'apx01',
          physics: SIMULATION_VERSION,
        };
        completed = validateGhost(candidate, this.context.circuit, this.context.trackLength, {
          circuit: this.context.circuit,
          vehicle: this.context.vehicle ?? 'apx01',
          physics: SIMULATION_VERSION,
        });
      }
    }
    if (laps !== this.laps) {
      this.laps = laps;
      this.samples = [];
      this.lastSample = -Infinity;
      this.eligible = true;
    }
    if (!this.eligible) return completed;
    if (
      !Number.isFinite(lapTime) ||
      !Number.isFinite(this.context.trackLength) ||
      lapTime < 0 ||
      lapTime >= GHOST_MAX_LAP_SECONDS ||
      lapTime < this.lastSample ||
      !driverControlled ||
      frame[o + F.IN_PIT] !== 0 ||
      frame[o + F.PIT_PHASE] !== 0 ||
      (lapTime > 0 && frame[o + F.LAP_VALID] !== 1) ||
      (lapTime > 0 && this.samples.length === 0 && lapTime >= 0.5)
    ) {
      this.discardLap();
      return completed;
    }
    if (lapTime > 0 && lapTime - this.lastSample >= GHOST_SAMPLE_INTERVAL)
      this.pushSample(frame, lapTime, frame[o + F.S]);
    return completed;
  }
  /** Ineligibility lasts until the next lap or an explicit reset. Retain no
   * unusable recording while waiting, including during a prolonged stop. */
  private discardLap() {
    if (this.samples.length) this.samples = [];
    this.lastSample = -Infinity;
    this.eligible = false;
  }
  private pushSample(frame: Float32Array, lapTime: number, s: number) {
    const o = carBase(0);
    if (lapTime <= this.lastSample) return lapTime === this.lastSample;
    if (
      this.samples.length >= GHOST_FIELDS * GHOST_MAX_SAMPLES ||
      !Number.isFinite(lapTime) ||
      !Number.isFinite(s) ||
      GHOST_POSE_FIELDS.some((field) => !Number.isFinite(frame[o + field]))
    ) {
      this.discardLap();
      return false;
    }
    this.lastSample = lapTime;
    this.samples.push(
      lapTime,
      s,
      frame[o + F.X],
      frame[o + F.Y],
      frame[o + F.Z],
      frame[o + F.QX],
      frame[o + F.QY],
      frame[o + F.QZ],
      frame[o + F.QW],
      frame[o + F.STEER],
      frame[o + F.SPEED],
    );
    return true;
  }
}

export interface GhostPose {
  /** Recorded vehicle id (the ghost lap's record category); Formula when absent. */
  vehicle?: string;
  s: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  steer: number;
  speed: number;
}
export function ghostPose(): GhostPose {
  return { s: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0 };
}

/** Interpolated playback and the live delta against a validated saved lap.
 * The recording remains unchanged while this player uses it. */
export class GhostPlayer {
  readonly count: number;
  private readonly distanceMaxima: Float32Array | null;
  constructor(readonly lap: GhostLap) {
    this.count = lap.samples.length / GHOST_FIELDS;
    let increasing = true;
    for (let i = 1; i < this.count; i++) {
      if (lap.samples[i * GHOST_FIELDS + 1] <= lap.samples[(i - 1) * GHOST_FIELDS + 1]) {
        increasing = false;
        break;
      }
    }
    if (increasing) {
      this.distanceMaxima = null;
      return;
    }
    // One entry per validated sample, bounded by GHOST_MAX_SAMPLES. Keep the
    // original sample offsets: a new maximum after reversing must interpolate
    // from its adjacent pose, not from the previous record-high distance.
    this.distanceMaxima = new Float32Array(this.count);
    let maximum = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const distance = lap.samples[i * GHOST_FIELDS + 1];
      this.distanceMaxima[i] = maximum = Math.max(maximum, distance);
    }
  }
  private index(field: number, value: number) {
    const d = this.lap.samples;
    let lo = 0,
      hi = this.count - 1;
    if (value <= d[field]) return 0;
    if (value >= d[hi * GHOST_FIELDS + field]) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid * GHOST_FIELDS + field] <= value) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  /** Pose at a time into the lap; false outside the recorded lap. */
  poseAt(lapTime: number, out: GhostPose) {
    const d = this.lap.samples;
    if (!(lapTime >= d[0]) || lapTime > this.lap.lapTime) return false;
    const i = this.index(0, lapTime),
      a = i * GHOST_FIELDS,
      b = a + GHOST_FIELDS;
    const t = Math.min(1, Math.max(0, (lapTime - d[a]) / Math.max(1e-6, d[b] - d[a])));
    out.s = d[a + 1] + (d[b + 1] - d[a + 1]) * t;
    out.x = d[a + 2] + (d[b + 2] - d[a + 2]) * t;
    out.y = d[a + 3] + (d[b + 3] - d[a + 3]) * t;
    out.z = d[a + 4] + (d[b + 4] - d[a + 4]) * t;
    // Normalised lerp on the short arc; samples are 33 ms apart.
    const sign =
      d[a + 5] * d[b + 5] + d[a + 6] * d[b + 6] + d[a + 7] * d[b + 7] + d[a + 8] * d[b + 8] < 0
        ? -1
        : 1;
    let qx = d[a + 5] + (sign * d[b + 5] - d[a + 5]) * t,
      qy = d[a + 6] + (sign * d[b + 6] - d[a + 6]) * t,
      qz = d[a + 7] + (sign * d[b + 7] - d[a + 7]) * t,
      qw = d[a + 8] + (sign * d[b + 8] - d[a + 8]) * t;
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= n;
    qy /= n;
    qz /= n;
    qw /= n;
    out.qx = qx;
    out.qy = qy;
    out.qz = qz;
    out.qw = qw;
    out.steer = d[a + 9] + (d[b + 9] - d[a + 9]) * t;
    out.speed = d[a + 10] + (d[b + 10] - d[a + 10]) * t;
    return true;
  }
  /** Original segment ending at the first recorded forward crossing. */
  private firstPassageIndex(s: number, maxima: Float32Array) {
    let lo = 1,
      hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (maxima[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
  /** Ghost's first time at a lap distance, for the live delta (positive = slower). */
  timeAt(s: number) {
    const d = this.lap.samples;
    if (!(s >= d[1])) return d[0];
    const maxima = this.distanceMaxima;
    if (maxima && s > maxima[this.count - 1]) return d[(this.count - 1) * GHOST_FIELDS];
    // Preserve the existing arithmetic at exact knots on strictly increasing
    // laps, including the denominator floor for sub-micrometre intervals.
    const i = maxima ? this.firstPassageIndex(s, maxima) : this.index(1, s),
      a = i * GHOST_FIELDS,
      b = a + GHOST_FIELDS;
    // The indexed path selects the segment ending at the first crossing.
    // An exact endpoint keeps its recorded time even below the distance floor;
    // a repeated initial station still belongs to the first sample.
    if (maxima && s > d[1] && s === d[b + 1]) return d[b];
    const t = Math.min(1, Math.max(0, (s - d[a + 1]) / Math.max(1e-6, d[b + 1] - d[a + 1])));
    return d[a] + (d[b] - d[a]) * t;
  }
  delta(s: number, lapTime: number) {
    return lapTime - this.timeAt(s);
  }
}

/** Write a ghost pose into a one-car frame for the shared car renderer. */
export function writeGhostFrame(frame: Float32Array, pose: GhostPose, time: number) {
  const o = carBase(0);
  frame[H.TIME] = time;
  frame[H.CARS] = 1;
  frame[o + F.X] = pose.x;
  frame[o + F.Y] = pose.y;
  frame[o + F.Z] = pose.z;
  frame[o + F.QX] = pose.qx;
  frame[o + F.QY] = pose.qy;
  frame[o + F.QZ] = pose.qz;
  frame[o + F.QW] = pose.qw;
  frame[o + F.STEER] = pose.steer;
  frame[o + F.SPEED] = pose.speed;
  frame[o + F.FRONT_HEALTH] = frame[o + F.FLOOR_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
  frame[o + F.SIDEPOD_HEALTH] = 1;
}
