import { TICKS_PER_SNAPSHOT, TICK_MS } from './constants.ts';
import type { Pose } from './prediction.ts';
import type { CarNetState } from './snapshot.ts';

const DT = TICK_MS / 1000;

/** Server-tick clock as observed by a client. Each snapshot gives one
 * sample of (tick − local arrival time); the least-delayed sample in a
 * sliding window anchors the estimate, and the spread of the others is the
 * arrival jitter (RFC 3550-style smoothed deviation). */
export class ServerClock {
  private window: number[] = [];
  private offset = -Infinity;
  jitterTicks = 0;
  samples = 0;
  constructor(private readonly size = 40) {}
  observe(tick: number, localMs: number) {
    const sample = tick - localMs / TICK_MS;
    this.window.push(sample);
    if (this.window.length > this.size) this.window.shift();
    this.offset = Math.max(...this.window);
    const deviation = this.offset - sample;
    this.jitterTicks += (deviation - this.jitterTicks) / 16;
    this.samples++;
  }
  get synced() {
    return this.samples > 0;
  }
  /** Newest server tick a snapshot could have reached us with by `localMs`. */
  arrivalTick(localMs: number) {
    return localMs / TICK_MS + this.offset;
  }
}

/** Remote presentation follows the arrival clock minus its jitter-buffer delay.
 * That target can step in either direction when a clock anchor expires or a
 * faster snapshot arrives. Correct at most a quarter tick per elapsed tick:
 * playback stays between 0.75x and 1.25x, so it cannot rewind or freeze, and a
 * fixed target offset is recovered in at most four times its duration.
 * This is deliberately separate from the raw clock used to schedule inputs. */
export class PresentationClock {
  private localMs: number | null = null;
  private tick = 0;
  reset() {
    this.localMs = null;
    this.tick = 0;
  }
  sample(localMs: number, targetTick: number) {
    // A view before the first snapshot must not seed the clock with -Infinity.
    if (!Number.isFinite(targetTick)) return targetTick;
    if (this.localMs === null) {
      this.localMs = localMs;
      this.tick = targetTick;
      return this.tick;
    }
    const elapsed = Math.max(0, localMs - this.localMs) / TICK_MS,
      predicted = this.tick + elapsed,
      budget = elapsed * 0.25;
    // Repeated reads at one instant cannot spend more correction budget.
    this.localMs = Math.max(this.localMs, localMs);
    this.tick = predicted + Math.max(-budget, Math.min(budget, targetTick - predicted));
    return this.tick;
  }
}

/** Copy the scalar wire-state contract, including accessor-backed callers,
 * without retaining unrelated caller-owned properties. */
function copyRemoteState(state: CarNetState): CarNetState {
  return {
    id: state.id,
    flags: state.flags,
    x: state.x,
    y: state.y,
    z: state.z,
    qx: state.qx,
    qy: state.qy,
    qz: state.qz,
    qw: state.qw,
    vx: state.vx,
    vy: state.vy,
    vz: state.vz,
    wx: state.wx,
    wy: state.wy,
    wz: state.wz,
    ax: state.ax,
    ay: state.ay,
    az: state.az,
    steer: state.steer,
    throttle: state.throttle,
    brake: state.brake,
    gear: state.gear,
    rpm: state.rpm,
    s: state.s,
    laps: state.laps,
    rank: state.rank,
  };
}

/** Snapshot history of one remote car with Hermite interpolation. Accepted
 * states are owned by the history; caller reuse cannot change past samples. */
export class RemoteCarTrack {
  private ticks: number[] = [];
  private states: CarNetState[] = [];
  push(tick: number, state: CarNetState) {
    let i = this.ticks.length;
    while (i > 0 && this.ticks[i - 1] > tick) i--;
    if (i > 0 && this.ticks[i - 1] === tick) return false;
    // Finish reading the caller before changing either parallel history array.
    const owned = copyRemoteState(state);
    this.ticks.splice(i, 0, tick);
    this.states.splice(i, 0, owned);
    const newest = this.ticks[this.ticks.length - 1];
    while (this.ticks.length > 2 && this.ticks[0] < newest - 240) {
      this.ticks.shift();
      this.states.shift();
    }
    return true;
  }
  get newest() {
    return this.ticks.length ? this.ticks[this.ticks.length - 1] : -1;
  }
  /** Detached newest state for HUD/integration consumers, or no state yet. */
  latest(): CarNetState | undefined {
    const state = this.states[this.states.length - 1];
    return state ? copyRemoteState(state) : undefined;
  }
  /** Pose at fractional server tick `t`. Extrapolates up to `maxExtrapolate`
   * ticks past the newest snapshot, then holds; null while the buffer does
   * not reach back to `t` yet (just joined: nothing truthful to draw). */
  sample(
    t: number,
    maxExtrapolate = 15,
  ): { pose: Pose; kind: 'interpolated' | 'extrapolated' | 'held' } | null {
    const n = this.ticks.length;
    if (!n) return null;
    if (t >= this.ticks[n - 1]) {
      const s = this.states[n - 1],
        ahead = Math.min(t - this.ticks[n - 1], maxExtrapolate) * DT;
      return {
        pose: {
          x: s.x + s.vx * ahead,
          y: s.y + s.vy * ahead,
          z: s.z + s.vz * ahead,
          qx: s.qx,
          qy: s.qy,
          qz: s.qz,
          qw: s.qw,
        },
        kind:
          t - this.ticks[n - 1] > maxExtrapolate
            ? 'held'
            : t > this.ticks[n - 1]
              ? 'extrapolated'
              : 'interpolated',
      };
    }
    if (t < this.ticks[0]) return null;
    let i = n - 1;
    while (i > 0 && this.ticks[i - 1] > t) i--;
    const a = this.states[i - 1],
      b = this.states[i],
      span = (this.ticks[i] - this.ticks[i - 1]) * DT,
      u = (t - this.ticks[i - 1]) / (this.ticks[i] - this.ticks[i - 1]);
    // Cubic Hermite with the snapshot velocities as tangents.
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1,
      h10 = u ** 3 - 2 * u ** 2 + u,
      h01 = -2 * u ** 3 + 3 * u ** 2,
      h11 = u ** 3 - u ** 2;
    const hermite = (p0: number, v0: number, p1: number, v1: number) =>
      h00 * p0 + h10 * span * v0 + h01 * p1 + h11 * span * v1;
    return {
      pose: {
        x: hermite(a.x, a.vx, b.x, b.vx),
        y: hermite(a.y, a.vy, b.y, b.vy),
        z: hermite(a.z, a.vz, b.z, b.vz),
        ...slerp(a, b, u),
      },
      kind: 'interpolated',
    };
  }
}
function slerp(a: Pose, b: Pose, u: number) {
  let bx = b.qx,
    by = b.qy,
    bz = b.qz,
    bw = b.qw,
    dot = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  let ka = 1 - u,
    kb = u;
  if (dot < 0.9995) {
    const theta = Math.acos(Math.min(1, dot)),
      s = Math.sin(theta);
    ka = Math.sin((1 - u) * theta) / s;
    kb = Math.sin(u * theta) / s;
  }
  const x = a.qx * ka + bx * kb,
    y = a.qy * ka + by * kb,
    z = a.qz * ka + bz * kb,
    w = a.qw * ka + bw * kb,
    n = Math.hypot(x, y, z, w);
  return { qx: x / n, qy: y / n, qz: z / n, qw: w / n };
}

/** Adaptive interpolation delay (jitter buffer): two snapshot intervals, so
 * one lost snapshot is bridged by interpolation, plus twice the measured
 * arrival jitter. Its target delay moves by at most half a tick per update;
 * PresentationClock separately bounds the resulting remote playback rate. */
export class JitterBuffer {
  delayTicks = 2 * TICKS_PER_SNAPSHOT;
  update(clock: ServerClock) {
    const target = Math.min(36, 2 * TICKS_PER_SNAPSHOT + 2 * clock.jitterTicks);
    this.delayTicks += Math.max(-0.5, Math.min(0.5, target - this.delayTicks));
  }
}
