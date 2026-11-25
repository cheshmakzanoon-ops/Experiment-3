import { clamp } from '../../core/math.ts';

/** Preserve the established manual authority outside a small neutral join. */
const POSE_BLEND_RANGE = 0.15;

/** Independent fore/aft rider stroke. The critically damped response has
 * finite travel (-1 back .. +1 forward), an analytic step and a bounded rate
 * even when the control reverses every tick. At omega=6 its worst full-range
 * reversal is 12/e units/s; a centred full throw reaches 90% in ~0.65 s.
 * These are game control calibrations, not measurements from photographs. */
export class RiderWeight {
  position = 0;
  velocity = 0;
  /** Exact normalised distance travelled in the latest step. */
  displacement = 0;
  reset() {
    this.position = this.velocity = this.displacement = 0;
  }
  step(input: number | undefined, dt: number) {
    this.displacement = 0;
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const target = Number.isFinite(input) ? clamp(input!, -1, 1) : 0;
    if (target === this.position && this.velocity === 0) return;
    const previous = this.position,
      omega = 6,
      error = previous - target,
      c = this.velocity + omega * error,
      decay = Math.exp(-omega * dt);
    this.position = clamp(target + (error + c * dt) * decay, -1, 1);
    this.velocity = (this.velocity - omega * c * dt) * decay;
    // Finish only below a sub-micrometre physical stroke so a released key
    // cannot leave an indefinitely stale, almost-zero body command.
    if (Math.abs(this.position - target) < 1e-7 && Math.abs(this.velocity) < 1e-7) {
      this.position = target;
      this.velocity = 0;
    }
    this.displacement = this.position - previous;
  }
  /** A full throw owns the body pose; neutral retains the calibrated rider
   * posture. A local Hermite join gives both sides the same neutral slope
   * (1 - automatic²), avoiding a rate jump when a moving stroke crosses zero.
   * Outside the join the established manual authority is unchanged. */
  pose(automatic: number) {
    if (this.position === 0) return automatic;
    const magnitude = Math.abs(this.position),
      share = 1 - Math.sign(this.position) * automatic,
      linear = automatic + this.position * share,
      u = magnitude / POSE_BLEND_RANGE;
    if (u >= 1) return linear;
    const remaining = 1 - u;
    return linear + automatic * share * magnitude * remaining * remaining;
  }
  /** Exact pose tangent, including movement of the automatic posture. This
   * only observes the stroke: its finite physical displacement and momentum
   * remain owned by step(), independently of the presentation blend. */
  poseRate(automatic: number, automaticRate = 0) {
    if (this.position === 0)
      return automaticRate + (1 - automatic * automatic) * this.velocity;
    const magnitude = Math.abs(this.position),
      sideAutomatic = Math.sign(this.position) * automatic,
      u = magnitude / POSE_BLEND_RANGE;
    let manualSlope = 1 - sideAutomatic,
      automaticSlope = 1 - magnitude;
    if (u < 1) {
      const remaining = 1 - u;
      // (1-u)(1-3u) lies in [-1/3, 1], keeping the manual slope
      // nonnegative throughout the join for every automatic pose in [-1,1].
      manualSlope *= 1 + sideAutomatic * remaining * (1 - 3 * u);
      automaticSlope += (1 - 2 * sideAutomatic) * magnitude * remaining * remaining;
    }
    return manualSlope * this.velocity + automaticSlope * automaticRate;
  }
}
