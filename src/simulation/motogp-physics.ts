import { clamp } from '../core/math.ts';
import {
  FORMULA_SLICK,
  camberShift,
  combinedForces,
  prepareSlip,
  slipCurve,
  slipState,
  type TyreConstruction,
} from './tyre-force.ts';

/** Original road-racing tyre calibration; not OEM or proprietary MotoGP data.
 * A motorcycle slick corners mostly on camber: with the camber/cornering
 * stiffness ratio of published racing-tyre measurements (≈0.065/rad, e.g.
 * Cossalter, Motorcycle Dynamics, ch. 2), camber alone supplies ~90% of the
 * force a 57° contact lean needs, and the remainder comes from 2-5° of slip.
 * The lateral curve peaks near 8.5° total slip and falls ~15% by 23°, so a
 * front pushed past its peak washes out instead of holding a broad plateau. */
export const MOTOGP_SLICK: TyreConstruction = Object.freeze({
  ...FORMULA_SLICK,
  nominalLoad: 1200,
  lateral: Object.freeze({ C: 1.6, E: -0.3, stiffness: 26.8 }),
  camberStiffness: 1.75,
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
  /** Roll inertia of bike + rider about its own CG (kg m²); absent: 24. */
  rollInertia?: number;
}

/** Share of the combined mass that moves with the hanging-off rider. The
 * same share the reduced core has always used for its hang-off torque. */
export const GP_RIDER_SHARE = 0.25;
/** Steering-head rake (rad), the renderer's fork angle (rendering/bike.ts). */
export const GP_RAKE = 0.42;
const DEFAULT_ROLL_INERTIA = 24;

/** Lean the hanging-off rider adds to the bike's own contact-to-CG lean: the
 * combined CG of a rider displaced `offset` metres across the bike plane at
 * CG height h lies atan(share·offset/h) further into the corner. This is the
 * whole hang-off effect: tan(φ_bike + θ) = a_y/g, so the bike itself needs
 * θ less lean for the same corner (≈7° at full hang-off). */
export function gpHangOffAngle(offset: number, cgHeight: number) {
  return Math.atan((GP_RIDER_SHARE * offset) / Math.max(0.2, cgHeight));
}

/** Roll inertia about the tyre contact line (kg m²): own + m h². */
export function gpRollInertia(geometry: MotoGPGeometry, mass: number, cgHeight: number) {
  return (geometry.rollInertia ?? DEFAULT_ROLL_INERTIA) + mass * cgHeight * cgHeight;
}

/** Spin angular momentum of both road wheels at rolling speed (N m s per m/s).
 * Their sum, times yaw rate, is the gyroscopic moment that stands a turning
 * bike up; the front wheel's share opposes steering rotation. */
export function gpSpinPerSpeed(geometry: MotoGPGeometry) {
  return (
    geometry.frontWheelInertia / geometry.frontRadius +
    geometry.rearWheelInertia / geometry.rearRadius
  );
}

/** Kinematic ground-plane steer of handlebars turned δ about a head raked ε
 * on a bike leaned φ: tan Δ = tan δ · cos ε / cos φ (small-angle form of
 * Cossalter's relation). A leaned bike turns more for the same bar angle. */
export function gpGroundSteer(steer: number, lean: number) {
  return Math.atan((Math.tan(steer) * Math.cos(GP_RAKE)) / Math.max(0.35, Math.cos(lean)));
}
export function gpBarSteer(ground: number, lean: number) {
  return Math.atan((Math.tan(ground) * Math.max(0.35, Math.cos(lean))) / Math.cos(GP_RAKE));
}

/** Peak-friction factor of the slick's shoulder at a lean (rad): full grip
 * through the racing camber range, then the tread edge gives way. */
export function gpCamberFriction(lean: number) {
  return 1 - 0.08 * Math.max(0, Math.abs(lean) - 0.7);
}

/** Roll-rate ceiling of the assisted rider (rad/s). The bar torque a rider
 * can apply is bounded; rolling the bike at rate p asks the front wheel's
 * spin momentum H_f = I_f·v/R_f for a precession torque H_f·p at the bars on
 * top of the chassis's own inertia share. p_max = p0 / (1 + H_f/H_ref), so a
 * flick at 250 km/h is markedly slower than at 100 km/h. p0 = 2.6 rad/s and
 * H_ref = 160 N m s are authored rider-effort values, not measured data. */
export const GP_ROLL_EFFORT = Object.freeze({ lowSpeedRate: 2.6, referenceMomentum: 160 });
export function gpRollRateLimit(speed: number, geometry: MotoGPGeometry) {
  const spin = (geometry.frontWheelInertia * Math.max(0, speed)) / geometry.frontRadius;
  return GP_ROLL_EFFORT.lowSpeedRate / (1 + spin / GP_ROLL_EFFORT.referenceMomentum);
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
  /** Ground-plane steer of the last step (rad), from bar steer and lean. */
  groundSteer = 0;
  /** Front tyre cornering stiffness at the last step's load (N/rad): the
   * instantaneous lateral force a ground-steer change produces. */
  frontStiffness = 0;
  /** Lean-intent assist: integral steer trim on lateral-acceleration error
   * (ground-plane rad). Deterministic controller memory, reset with the
   * contact state. */
  steerTrim = 0;
  /** Lean-intent assist: the combined-CG lean it is steering toward (rad).
   * Traction and wheelie control keep tyre capacity for it. */
  leanTarget = 0;
  /** Lateral acceleration the assist's roll control asked for (m/s², ≥ 0). */
  lateralDemand = 0;
  private frontLoadUsed = 0;
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
    this.groundSteer = this.steerTrim = this.leanTarget = this.lateralDemand = 0;
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
      this.lateralSpeed = this.yawRate = this.steerTrim = 0;
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
      this.frontSlipAngle = this.rearSlipAngle = this.frontLoadUsed = 0;
      this.stepWheels(q);
      return this;
    }

    // The tyre sees the ground-plane steer of the raked, leaned fork.
    const steer = (this.groundSteer = gpGroundSteer(q.steer, q.lean));
    const frontFy = this.sideForce(
      this.front, q.frontLoad * contact, q.frontMu, q.lean, steer,
      this.lateralSpeed + g.frontArm * this.yawRate, v, q.frontFx,
    );
    this.frontSlipAngle = this.front.alpha;
    this.frontStiffness = q.frontLoad * contact > 1 ? this.front.corneringStiffness : 0;
    this.frontLoadUsed = q.frontLoad * contact;
    const rearFy = this.sideForce(
      this.rear, q.rearLoad, q.rearMu, q.lean, 0,
      this.lateralSpeed - g.rearArm * this.yawRate, v, q.rearFx,
    );
    this.rearSlipAngle = this.rear.alpha;
    // Transient lateral contact forces relax over distance travelled.
    const mix = 1 - Math.exp((-dt * Math.max(v, 3)) / MOTOGP_SLICK.relaxationLength);
    this.frontFy += (frontFy - this.frontFy) * mix;
    this.rearFy += (rearFy - this.rearFy) * mix;
    const frontSide = this.frontFy * Math.cos(steer) + q.frontFx * Math.sin(steer);
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

  /** Ground-plane steer at which the front tyre, in its present contact
   * state (load, friction, longitudinal force, camber, yaw and sideslip),
   * produces `force` newtons of lateral force: the exact inverse of the
   * pure-slip curve below its peak, with the friction ellipse reduced by
   * the longitudinal force. Steering for a force rather than a path is what
   * a rider does through the bars; it also steers into a sliding rear.
   * Returns null when the front is not on the road. */
  frontSteerFor(force: number, lean: number, speed: number, longitudinal: number) {
    const state = this.front,
      load = this.frontLoadUsed;
    if (!(load > 1 && state.dy > 1 && speed >= 2.5)) return null;
    const limit = Math.sqrt(Math.max(1, state.dy ** 2 - longitudinal ** 2)),
      fraction = Math.min(0.97, Math.abs(force) / limit);
    // Bisection on σ ∈ [0, 0.9]: the curve rises monotonically to its peak.
    let lo = 0,
      hi = 0.9;
    for (let i = 0; i < 18; i++) {
      const mid = 0.5 * (lo + hi);
      if (slipCurve(mid, state.cy, state.ey, state.x0y) < fraction) lo = mid;
      else hi = mid;
    }
    const slip = -Math.sign(force) * 0.5 * (lo + hi) * state.alphaRef,
      geometric = Math.atan2(
        this.lateralSpeed + this.geometry.frontArm * this.yawRate,
        Math.max(1, speed),
      );
    return geometric - camberShift(MOTOGP_SLICK, load, state, lean, speed) - slip;
  }

  private sideForce(
    state: ReturnType<typeof slipState>, load: number, mu: number, lean: number,
    steer: number, lateralVelocity: number, speed: number, longitudinal: number,
  ) {
    if (load <= 1 || mu <= 0) return 0;
    const friction = Math.max(0.05, mu) * gpCamberFriction(lean);
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
