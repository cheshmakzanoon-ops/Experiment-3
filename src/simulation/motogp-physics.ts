import { clamp } from '../core/math.ts';
import {
  FORMULA_SLICK,
  camberShift,
  combinedForces,
  prepareSlip,
  slipState,
  type TyreConstruction,
} from './tyre-force.ts';

/** Original road-racing tyre calibration; not OEM or proprietary MotoGP data. */
export const MOTOGP_SLICK: TyreConstruction = Object.freeze({
  ...FORMULA_SLICK,
  nominalLoad: 1200,
  camberStiffness: 1.12,
  camberOptimum: 0.6,
  camberSensitivity: 0.5,
  relaxationLength: 0.23,
  longitudinalRelaxationLength: 0.2,
  width: 0.18,
});

export interface MotoGPContactStep {
  dt: number;
  speed: number;
  mass: number;
  lean: number;
  steer: number;
  frontLoad: number;
  rearLoad: number;
  frontMu: number;
  rearMu: number;
  frontFx: number;
  rearFx: number;
  frontContact: number;
  /** Untransmitted torque as an equivalent contact force (N). */
  frontBrakeExcess: number;
  rearDriveExcess: number;
  rearBrakeExcess: number;
}

export interface MotoGPGeometry {
  frontArm: number;
  rearArm: number;
  yawInertia: number;
  frontRadius: number;
  rearRadius: number;
  frontWheelInertia: number;
  rearWheelInertia: number;
}

/** MotoGP-only single-track contact and chassis dynamics, independent of
 * the car's four-wheel solver and motocross suspension/soil model.
 *
 * +x is rider-left, +z is forward. Independent front/rear camber and slip
 * forces create real yaw moment; the body-frame lateral velocity obeys
 * dv_y/dt = (Fy_f + Fy_r)/m - v_x * yawRate. A steer input cannot rotate the
 * direction of travel instantly.
 *
 * Longitudinal tyre commands and pitch/load transfer remain in Bike for
 * compatibility. Wheel angular speeds respond to the force-required slip
 * and any untransmitted torque. This is a reduced-order model, not a fully
 * coupled six-DOF simulation or fitted manufacturer tyre dataset. */
export class MotoGPChassis {
  lateralSpeed = 0;
  yawRate = 0;
  lateralAcceleration = 0;
  frontFy = 0;
  rearFy = 0;
  frontSlipAngle = 0;
  rearSlipAngle = 0;
  frontSlip = 0;
  rearSlip = 0;
  frontOmega = 0;
  rearOmega = 0;
  frontSlidingPower = 0;
  rearSlidingPower = 0;
  private lastSpeed = 0;
  private readonly front = slipState();
  private readonly rear = slipState();
  private readonly force = { fx: 0, fy: 0 };

  constructor(readonly geometry: MotoGPGeometry) {
    if (!(geometry.yawInertia > 0 && geometry.frontRadius > 0 && geometry.rearRadius > 0))
      throw new Error('Invalid MotoGP geometry');
  }

  reset(speed = 0) {
    this.lateralSpeed = this.yawRate = this.lateralAcceleration = 0;
    this.frontFy = this.rearFy = this.frontSlipAngle = this.rearSlipAngle = 0;
    this.frontSlip = this.rearSlip = 0;
    this.frontSlidingPower = this.rearSlidingPower = 0;
    this.frontOmega = speed / this.geometry.frontRadius;
    this.rearOmega = speed / this.geometry.rearRadius;
    this.lastSpeed = speed;
  }

  step(q: MotoGPContactStep) {
    const g = this.geometry;
    const v = Math.max(0, q.speed);
    const dt = q.dt;
    if (!(dt > 0 && dt <= 0.05)) throw new Error('Invalid MotoGP timestep');
    // Grid placement, teleportation and tests that set speed explicitly are
    // not dual-wheel lockups: reinitialize the contact rotations.
    if (Math.abs(v - this.lastSpeed) > 5) {
      this.frontOmega = v / g.frontRadius;
      this.rearOmega = v / g.rearRadius;
      this.lateralSpeed = this.yawRate = 0;
    }
    this.lastSpeed = v;
    const contact = clamp(q.frontContact, 0, 1);
    if (contact <= 1e-6 || v < 2.5) {
      // No fictitious front road steering while raised. Below walking speed
      // retain the geometric pit-box steering model instead of freezing turn.
      this.yawRate = contact > 1e-6 && v < 2.5
        ? (v * Math.tan(q.steer) * Math.cos(q.lean) * contact) / (g.frontArm + g.rearArm)
        : 0;
      this.lateralSpeed = 0;
      this.frontFy = this.rearFy = this.lateralAcceleration = 0;
      this.frontSlipAngle = this.rearSlipAngle = 0;
      this.stepWheels(q);
      return this;
    }

    const frontFy = this.sideForce(
      this.front, q.frontLoad * contact, q.frontMu, q.lean, q.steer,
      this.lateralSpeed + g.frontArm * this.yawRate, v, q.frontFx,
    );
    this.frontSlipAngle = this.front.alpha;
    const rearFy = this.sideForce(
      this.rear, q.rearLoad, q.rearMu, q.lean, 0,
      this.lateralSpeed - g.rearArm * this.yawRate, v, q.rearFx,
    );
    this.rearSlipAngle = this.rear.alpha;
    // Transient lateral contact forces relax over distance travelled.
    const mix = 1 - Math.exp((-dt * Math.max(v, 3)) / MOTOGP_SLICK.relaxationLength);
    this.frontFy += (frontFy - this.frontFy) * mix;
    this.rearFy += (rearFy - this.rearFy) * mix;
    const frontSide = this.frontFy * Math.cos(q.steer) + q.frontFx * Math.sin(q.steer);
    const lateral = frontSide + this.rearFy;
    const yawMoment = g.frontArm * frontSide - g.rearArm * this.rearFy;
    this.lateralAcceleration = lateral / Math.max(1, q.mass);
    this.yawRate += (yawMoment / g.yawInertia) * dt;
    this.lateralSpeed += (this.lateralAcceleration - v * this.yawRate) * dt;
    // Dissipative numerical limits only, for the incident transition.
    this.yawRate = clamp(this.yawRate, -2.5, 2.5);
    this.lateralSpeed = clamp(this.lateralSpeed, -0.8 * Math.max(v, 1), 0.8 * Math.max(v, 1));
    this.stepWheels(q);
    return this;
  }

  private sideForce(
    state: ReturnType<typeof slipState>, load: number, mu: number, lean: number,
    steer: number, lateralVelocity: number, speed: number, longitudinal: number,
  ) {
    if (load <= 1 || mu <= 0) return 0;
    const friction = Math.max(0.05, mu) * (1 - 0.08 * Math.max(0, Math.abs(lean) - 0.7));
    prepareSlip(MOTOGP_SLICK, load, friction, 1, 1, 1, state);
    const alpha = Math.atan2(lateralVelocity, Math.max(1, speed)) - steer;
    state.alpha = alpha - camberShift(MOTOGP_SLICK, load, state, lean, speed);
    // Longitudinal force demand spends part of the same tyre friction budget.
    const ratio = clamp(longitudinal / Math.max(1, state.dx), -1, 1);
    const kappa = Math.sign(ratio) * Math.min(0.95, Math.abs(ratio)) * state.kappaRef;
    combinedForces(state, kappa, this.force);
    const sideLimit = Math.sqrt(Math.max(0, state.dy ** 2 - longitudinal ** 2));
    return clamp(this.force.fy, -sideLimit, sideLimit);
  }

  private stepWheels(q: MotoGPContactStep) {
    const g = this.geometry;
    const v = Math.max(0, q.speed);
    const frontPeak = Math.max(1, q.frontLoad * q.frontMu);
    const rearPeak = Math.max(1, q.rearLoad * q.rearMu);
    const targetFrontSlip = clamp(q.frontFx / frontPeak, -0.98, 0.98) * 0.065;
    const targetRearSlip = clamp(q.rearFx / rearPeak, -0.98, 0.98) * 0.065;
    const targetFront = (v + targetFrontSlip * Math.max(2, v)) / g.frontRadius;
    const targetRear = (v + targetRearSlip * Math.max(2, v)) / g.rearRadius;
    const frontTau = clamp(g.frontWheelInertia * Math.max(v, 4) / (4000 * g.frontRadius ** 2), 0.012, 0.09);
    const rearTau = clamp(g.rearWheelInertia * Math.max(v, 4) / (4000 * g.rearRadius ** 2), 0.012, 0.09);
    this.frontOmega += (targetFront - this.frontOmega) * (1 - Math.exp(-q.dt / frontTau));
    this.rearOmega += (targetRear - this.rearOmega) * (1 - Math.exp(-q.dt / rearTau));
    this.frontOmega = Math.max(
      0, this.frontOmega - (q.frontBrakeExcess * g.frontRadius * q.dt) / g.frontWheelInertia,
    );
    this.rearOmega = Math.max(
      0, this.rearOmega + ((q.rearDriveExcess - q.rearBrakeExcess) * g.rearRadius * q.dt) / g.rearWheelInertia,
    );
    this.frontOmega = Math.min(500, this.frontOmega);
    this.rearOmega = Math.min(500, this.rearOmega);
    this.frontSlip = clamp((this.frontOmega * g.frontRadius - v) / Math.max(2, v), -1, 6);
    this.rearSlip = clamp((this.rearOmega * g.rearRadius - v) / Math.max(2, v), -1, 6);
    // Only contact sliding dissipates power; pure rolling creates none.
    this.frontSlidingPower =
      Math.abs(q.frontFx * (this.frontOmega * g.frontRadius - v)) +
      Math.abs(this.frontFy * (this.lateralSpeed + g.frontArm * this.yawRate));
    this.rearSlidingPower =
      Math.abs(q.rearFx * (this.rearOmega * g.rearRadius - v)) +
      Math.abs(this.rearFy * (this.lateralSpeed - g.rearArm * this.yawRate));
  }
}
