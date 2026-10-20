import { clamp } from '../core/math.ts';

/** Existing electrical recovery efficiency; mechanical braking and battery
 * charge are separate power ports. The remainder is converter/motor loss. */
export const REGEN_EFFICIENCY = 0.78;
/** Retain a friction-brake reserve at every motor-connected wheel. */
const MAX_REGENERATIVE_SHARE = 0.65;
/** Below this carrier speed (rad/s), blend generation smoothly out rather
 * than divide a finite requested power by a nearly stationary rotor. */
const LOW_SPEED = 5;

/** Brake-by-wire allocation for a single motor and its connected driveline.
 * `frontShare` is 1 for a separate front motor / FWD, 0 for RWD, or the
 * planetary centre split for AWD. The scalar generator torque is distributed
 * through those same weights; it cannot independently brake four rotors.
 *
 * Total wheel demand already includes rotor fade. ABS scales that demand,
 * then regeneration replaces part of it exactly. Battery state therefore
 * changes disc heat without changing the requested wheel brake balance.
 * This remains an operator-split reduction, not an electrical machine or
 * simultaneous engine/clutch/differential constraint solver. */
export class RegenerativeBrakes {
  readonly total = new Float64Array(4);
  readonly friction = new Float64Array(4);
  readonly regenerative = new Float64Array(4);
  readonly weights: Float64Array;
  /** Mechanical power ceiling held for this wheel-solve interval (W). */
  maximumPower = 0;
  private direction = 0;

  constructor(frontShare: number) {
    if (!Number.isFinite(frontShare) || frontShare < 0 || frontShare > 1)
      throw new Error('Invalid regenerative axle split');
    this.weights = new Float64Array([
      frontShare * 0.5,
      frontShare * 0.5,
      (1 - frontShare) * 0.5,
      (1 - frontShare) * 0.5,
    ]);
  }

  prepare(
    demand: ArrayLike<number>,
    release: ArrayLike<number>,
    wheels: readonly { omega: number }[],
    requestedPower: number,
    headroomJ: number,
    dt: number,
    coupling = 1,
    carrierTorqueLimit = Infinity,
  ) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid regenerative brake timestep');
    this.maximumPower = 0;
    this.direction = 0;
    this.regenerative.fill(0);
    let carrier = 0,
      releaseLimit = 1,
      capacity = Math.max(0, carrierTorqueLimit);
    for (let i = 0; i < 4; i++) {
      const fraction = clamp(release[i], 0, 1),
        weight = this.weights[i];
      this.total[i] = this.friction[i] = Math.max(0, demand[i]) * fraction;
      if (weight === 0) continue;
      carrier += weight * wheels[i].omega;
      releaseLimit = Math.min(releaseLimit, fraction);
      capacity = Math.min(capacity, (this.total[i] * MAX_REGENERATIVE_SHARE) / weight);
    }
    if (requestedPower <= 0 || headroomJ <= 0 || coupling <= 0 || capacity <= 0) return;
    const speed = Math.abs(carrier),
      direction = Math.sign(carrier);
    // A counter-rotating output cannot receive a dissipative unsigned brake
    // torque from the same carrier as its partner. Leave such a differential
    // event (or a stopped output) to the friction brakes until it recovers.
    for (let i = 0; i < 4; i++) if (this.weights[i] > 0 && wheels[i].omega * direction <= 0) return;
    this.direction = direction;

    this.maximumPower = Math.min(
      Math.max(0, requestedPower) * clamp(coupling, 0, 1) * releaseLimit,
      Math.max(0, headroomJ) / (REGEN_EFFICIENCY * dt),
    );
    const torque = Math.min(
      capacity * Math.min(1, speed / LOW_SPEED),
      this.maximumPower / Math.max(LOW_SPEED, speed),
    );
    for (let i = 0; i < 4; i++) {
      const recoveredTorque = torque * this.weights[i];
      this.regenerative[i] = recoveredTorque;
      this.friction[i] = this.total[i] - recoveredTorque;
    }
  }

  /** Only completed wheel work may charge the battery. A locked wheel has
   * zero generator work, even if a finite torque was requested at its hub. */
  recoveredEnergy(wheels: readonly { omega: number }[], dt: number, headroomJ: number) {
    let workRate = 0;
    for (let i = 0; i < 4; i++) {
      if (this.regenerative[i] > 0 && wheels[i].omega * this.direction < 0) return 0;
      workRate += this.regenerative[i] * Math.abs(wheels[i].omega);
    }
    return Math.max(
      0,
      Math.min(headroomJ, Math.min(this.maximumPower, workRate) * REGEN_EFFICIENCY * dt),
    );
  }
}
