import { B, BIKE_BASE, F, H } from '../simulation/protocol.ts';
import type { RiderPose } from './rider.ts';
import { gpBodyTargets, type GpRiderBodyState } from './gp-rider-posture.ts';

/** Second-order response of each body channel: natural frequency (rad/s)
 * and damping ratio. Sitting up is quick with a slight overshoot; the
 * upper body lunges and rebounds under a braking step; the hips cross the
 * seat with mass; boots plant smoothly. Authored values, not measurements. */
export const GP_RIDER_BODY_SPRINGS = Object.freeze({
  sitUp: [10, 0.72],
  surge: [8, 0.38],
  sway: [9, 0.62],
  plant: [7, 1],
} as const);
const CHANNELS = ['sitUp', 'surge', 'sway', 'plant'] as const;
type Channel = (typeof CHANNELS)[number];
/** Integration step bound and the longest gap treated as continuous motion. */
const MAX_STEP = 1 / 240;
export const GP_RIDER_BODY_MAX_GAP = 0.5;

const scratchPose: RiderPose = { lean: 0, offset: 0, tuck: 0, braking: 0, steer: 0 };
function targetsAt(frame: Float32Array, car: number, out: GpRiderBodyState) {
  scratchPose.braking = frame[car + F.BRAKE];
  scratchPose.speed = frame[car + F.SPEED];
  scratchPose.gLong = frame[car + F.G_LONG];
  scratchPose.offset = frame[car + BIKE_BASE + B.RIDER_OFFSET];
  scratchPose.leanRate = frame[car + BIKE_BASE + B.LEAN_RATE];
  return gpBodyTargets(scratchPose, out);
}
const blank = (): GpRiderBodyState => ({ sitUp: 0, surge: 0, sway: 0, plant: 0 });

/** Spring-damped rider mass for one GP entrant, shared by all of its LODs.
 *
 * Determinism: the state advances only when the newer snapshot's simulation
 * time advances, integrating in equal sub-steps of at most 1/240 s toward
 * targets interpolated between the two snapshots it has seen. The presented
 * value between snapshots is interpolated, never integrated, so render rate,
 * held/paused frames and repeated draws cannot change it. Wall-clock time is
 * never read. A seek, rewind, gap over 0.5 s or a non-riding state restarts
 * at equilibrium (the pose `gpBodyTargets` gives for that snapshot), exactly
 * like the particle playback's discontinuity rule. */
export class GpRiderBody {
  private readonly position = blank();
  private readonly velocity = blank();
  private readonly previous = blank();
  private readonly target = blank();
  private readonly next = blank();
  private readonly presented = blank();
  private time = NaN;
  private previousTime = NaN;
  resets = 0;

  /** Smoothed state for the presented time between snapshots `a` and `b`. */
  sample(a: Float32Array, b: Float32Array, alpha: number, car: number, riding = true) {
    const tb = b[H.TIME],
      ta = a[H.TIME];
    if (!riding || !Number.isFinite(tb)) {
      this.time = NaN;
      return targetsAt(alpha < 1 ? a : b, car, this.presented);
    }
    const elapsed = tb - this.time;
    if (!(elapsed >= 0) || elapsed > GP_RIDER_BODY_MAX_GAP) this.reset(a, b, car);
    else if (elapsed > 0) this.advance(b, car, elapsed);
    // Interpolate within the last integrated interval at the presented time.
    const span = this.time - this.previousTime,
      at = Number.isFinite(ta) && tb > ta ? ta + (tb - ta) * alpha : tb,
      s = span > 0 ? Math.min(1, Math.max(0, (at - this.previousTime) / span)) : 1;
    for (const channel of CHANNELS)
      this.presented[channel] =
        this.previous[channel] + (this.position[channel] - this.previous[channel]) * s;
    return this.presented;
  }

  private reset(a: Float32Array, b: Float32Array, car: number) {
    void a;
    targetsAt(b, car, this.position);
    targetsAt(b, car, this.target);
    for (const channel of CHANNELS) this.velocity[channel] = 0;
    // An equilibrium restart has no integrated history to interpolate across.
    Object.assign(this.previous, this.position);
    this.time = b[H.TIME];
    this.previousTime = this.time;
    this.resets++;
  }

  private advance(b: Float32Array, car: number, elapsed: number) {
    Object.assign(this.previous, this.position);
    targetsAt(b, car, this.next);
    const steps = Math.ceil(elapsed / MAX_STEP - 1e-9),
      dt = elapsed / steps;
    for (let step = 1; step <= steps; step++) {
      const f = step / steps;
      for (const channel of CHANNELS) {
        const [omega, zeta] = GP_RIDER_BODY_SPRINGS[channel as Channel],
          goal = this.target[channel] + (this.next[channel] - this.target[channel]) * f;
        this.velocity[channel] +=
          (omega * omega * (goal - this.position[channel]) -
            2 * zeta * omega * this.velocity[channel]) *
          dt;
        this.position[channel] += this.velocity[channel] * dt;
      }
    }
    // Physical bounds of each channel (a rebound never overshoots a limit).
    this.position.sitUp = Math.min(1.1, Math.max(0, this.position.sitUp));
    this.position.plant = Math.min(1, Math.max(0, this.position.plant));
    Object.assign(this.target, this.next);
    this.previousTime = this.time;
    this.time = b[H.TIME];
  }
}
