import { clamp, lerp, smooth } from '../../core/math.ts';

/** Response frequencies in radians/second, not measured human physiology.
 * A held command reaches 95% in about 0.28 s standing, 0.17 s dabbing and
 * 0.26 s bracing. These preserve the scale of the former constant-rate
 * movements while allowing an athlete to accelerate and decelerate. */
export const MX_POSTURE_RESPONSE = Object.freeze({ standing: 17, dab: 28, body: 18 });

const finite = (value: number) => Number.isFinite(value) ? value : 0;

/** The existing course look-ahead still decides whether rough ground or a
 * jump is approaching. Small speed/lean changes near its old thresholds
 * should change the requested stance slightly, not reverse a full stroke. */
export function motocrossStandingTarget(
  speed: number, lean: number, rough: boolean, climb: number, airborne: boolean,
) {
  if (airborne) return 1;
  const rolling = rough
    ? smooth(6.4, 7.6, finite(speed)) * (1 - smooth(0.34, 0.5, Math.abs(finite(lean))))
    : 0;
  return Math.max(rolling, smooth(0.35, 0.65, finite(climb)));
}

/** A dab withdraws progressively near the feet-up speed and returns through
 * neutral when the bike changes sides. A nearly upright bike uses steering
 * to choose its supporting foot; established lean retains that ownership. */
export function motocrossDabTarget(
  speed: number, lean: number, steer: number, dabSpeed: number, dabLean: number, airborne: boolean,
) {
  if (airborne || !(dabSpeed > 0) || !(dabLean > 0) || !Number.isFinite(dabSpeed + dabLean)) return 0;
  lean = finite(lean);
  steer = finite(steer);
  const speedWeight = 1 - smooth(dabSpeed - 0.6, dabSpeed + 0.3, finite(speed));
  const leanWeight = smooth(dabLean * 0.6 - 0.06, dabLean * 0.6 + 0.06, Math.abs(lean));
  const steerWeight = smooth(0.26, 0.38, Math.abs(steer));
  const side = lerp(steer, lean, smooth(0.02, 0.08, Math.abs(lean)));
  const direction = 2 * smooth(-0.04, 0.04, side) - 1;
  return direction * speedWeight * Math.max(leanWeight, steerWeight);
}

/** Exact critically damped response to a held target. Starting from rest,
 * its nonnegative impulse response keeps every bounded command history
 * bounded without a speed clamp or a discontinuous endpoint snap. */
class PostureAxis {
  position = 0;
  velocity = 0;

  constructor(
    private readonly omega: number,
    private readonly minimum: number,
    private readonly maximum: number,
  ) {}

  reset(position: number) {
    this.position = clamp(finite(position), this.minimum, this.maximum);
    this.velocity = 0;
  }

  step(target: number, dt: number) {
    target = clamp(finite(target), this.minimum, this.maximum);
    // Avoid an overflowing polynomial multiplied by an underflowed decay
    // after a discontinuously long caller interval. Ordinary fixed ticks
    // always use the analytic position and derivative below.
    if (this.omega * dt > 50) {
      this.position = target;
      this.velocity = 0;
      return;
    }
    const error = this.position - target;
    const coefficient = this.velocity + this.omega * error;
    const decay = Math.exp(-this.omega * dt);
    this.position = clamp(target + (error + coefficient * dt) * decay, this.minimum, this.maximum);
    this.velocity = (this.velocity - this.omega * coefficient * dt) * decay;
  }
}

/** Fixed-tick automatic posture for motocross only. The caller still owns
 * course anticipation, rider state, and the finite manual RiderWeight
 * stroke. Presentation reads the existing standing/dab/body snapshot
 * channels; no render-time spring or wall clock is involved. */
export class MxRiderPosture {
  private readonly stance = new PostureAxis(MX_POSTURE_RESPONSE.standing, 0, 1);
  private readonly foot = new PostureAxis(MX_POSTURE_RESPONSE.dab, -1, 1);
  private readonly body = new PostureAxis(MX_POSTURE_RESPONSE.body, -1, 1);

  get standing() { return this.stance.position; }
  get standingRate() { return this.stance.velocity; }
  get dab() { return this.foot.position; }
  get dabRate() { return this.foot.velocity; }
  get automaticBody() { return this.body.position; }
  get bodyRate() { return this.body.velocity; }

  /** Placement/recovery starts from the actual observed pose, at rest. */
  reset(standing = 0, dab = 0, automaticBody = 0) {
    this.stance.reset(standing);
    this.foot.reset(dab);
    this.body.reset(automaticBody);
  }

  /** Omit automaticBody while airborne: the automatic aid holds its launch
   * posture and stops its rate. Only the independent, finite manual stroke
   * may then move the body. Ground contact resumes smoothly from that hold.
   * Nonpositive/nonfinite time holds every channel, including its velocity. */
  step(dt: number, standing: number, dab: number, automaticBody?: number) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.stepStance(dt, standing, dab);
    if (automaticBody === undefined) this.body.velocity = 0;
    else this.stepBody(dt, automaticBody);
  }

  /** Flight computes its body aid after posture anticipation. Advance each
   * axis exactly once on that path without resetting the body's momentum. */
  stepStance(dt: number, standing: number, dab: number) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.stance.step(standing, dt);
    this.foot.step(dab, dt);
  }

  stepBody(dt: number, automaticBody: number) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.body.step(automaticBody, dt);
  }
}
