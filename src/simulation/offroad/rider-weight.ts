import { clamp } from '../../core/math.ts';

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
   * posture. Intermediate input blends smoothly without exceeding its range. */
  pose(automatic: number) {
    if (this.position === 0) return automatic;
    return automatic + this.position * (1 - Math.sign(this.position) * automatic);
  }
}
