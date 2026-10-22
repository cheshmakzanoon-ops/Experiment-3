import { clamp, G, lerp } from '../core/math.ts';
import { GP_FRONT_SETTLE_RATE, gpFrontSteeringContact } from './gp-front-contact.ts';
import {
  GP_RAKE,
  MotoGPChassis,
  gpBarSteer,
  gpCamberFriction,
  gpHangOffAngle,
  gpRollInertia,
  gpRollRateLimit,
  gpSpinPerSpeed,
  type MotoGPGeometry,
} from './motogp-physics.ts';

/** GP lean-intent assist calibration (docs/motogp-physics-model.md). The
 * assisted rider leans the combined CG to at most `leanMargin` of the tyres'
 * present lateral capacity and may spend up to `recovery` of it to arrest a
 * roll; the margin between the two is what makes every target recoverable.
 * `rollGain` (1/s) and `rateGain` (1/s) shape the roll-rate reference and
 * its tracking; `trimRate`/`trimLimit` bound the integral steer trim. */
export const GP_ASSIST = Object.freeze({
  leanMargin: 0.9,
  recovery: 0.985,
  rollGain: 4.5,
  rateGain: 9,
  stopShare: 0.75,
  lead: 0.06,
  trimRate: 4,
  trimLimit: 0.035,
  feedback: 1.2,
  yawDamping: 4,
});

/** Reduced-order road-racing motorcycle model (WP33, masterplan §8). It began
 * as an isolated research model that settled the control contract and the
 * failure states; it is now the dynamics core of the session adapter
 * (`bike-vehicle.ts`, WP34), parameterized per definition (`BikeParameters`).
 * The defaults below (`BIKE`) are the original research bike and its tests.
 *
 * Explicit approximations (calibrated by scripts/vehicle-calibration.ts):
 * - planar chassis; lean φ is a single roll degree of freedom driven by
 *   gravity and centripetal torques about the contact line; the road surface
 *   enters through a friction multiplier and a gradient set each step;
 * - kinematic steering: path curvature κ = tan(δ)/wheelbase · cos(φ) is
 *   produced by the steer angle δ; the visual lean is never decorative, it is
 *   this state;
 * - front/rear normal loads from longitudinal load transfer (plus wing
 *   downforce), with wheelie and stoppie pitch bounded by those loads
 *   reaching zero;
 * - each tyre has a friction circle μ·Fz scaled by a camber term; exceeding
 *   the front circle is a lowside, a rear slide that suddenly regains grip
 *   is a highside;
 * - the rider is a lateral mass offset that reduces the lean needed for a
 *   corner (hang-off), entering the roll balance with its own height.
 *
 * Control contract (§8.2): the stick expresses an intended lean, not a raw
 * steer angle. The assist computes counter-steer within a steer-rate limit,
 * so riders state intent while the physics still decides whether it is
 * achievable. Expert mode passes the stick to the steer directly. Below
 * walking pace the stick steers the bars directly in both modes. */
export interface BikeParameters {
  /** Bike plus rider (kg). */
  mass: number;
  wheelbase: number;
  cgHeight: number;
  /** CG distance behind the front contact / ahead of the rear contact (m). */
  cgToFront: number;
  cgToRear: number;
  maxSteer: number;
  steerRate: number;
  /** Chassis lean limit (rad). */
  maxLean: number;
  /** Peak tyre friction on dry asphalt. */
  mu: number;
  /** Constant-power drive used when the adapter does not supply a drive force (W). */
  power: number;
  maxDrive: number;
  /** Full-lever brake forces at the contact (N). */
  frontBrake: number;
  rearBrake: number;
  /** ½ρCdA (N per (m/s)²). */
  drag: number;
  riderOffsetMax: number;
  /** Wing downforce (N per (m/s)²) and the share carried by the front tyre. */
  downforce?: number;
  downforceFront?: number;
  /** Rolling-resistance coefficient. */
  rolling?: number;
  /** Wheelie-control pitch threshold (rad). */
  wheelieLimit?: number;
  /** Stoppie assist: fraction of the rear-lift deceleration it permits. */
  stoppieMargin?: number;
  /** Setup (bikeSetupParameters; absent: the calibrated values). Traction
   * control's share of the rear friction circle left for drive (0.92), the
   * share of static front load wheelie control keeps (0.2) and the chassis
   * roll damping rate (1.2 /s). */
  tractionMargin?: number;
  wheelieKeep?: number;
  rollDamping?: number;
  /** Largest throttle fraction at which the adapter may request drivetrain
   * braking. The GP adapter blends torque through a small coast/power overlap;
   * other machines retain their original closed-throttle threshold (0.02). */
  engineBrakeReleaseThrottle?: number;
  /** Combined-brake assistance may proportion the front lever across both
   * tyres, but the rear pedal never asks for front pressure. Enabled by the
   * GP adapter; other motorcycles retain their existing linked controls. */
  independentRearBrake?: boolean;
  /** GP traction control also checks drive against this step's brake load
   * transfer. The previous normal load can overstate rear grip while the
   * front lever and throttle overlap on different contact surfaces. */
  currentDriveTraction?: boolean;
  /** GP bar steering loses authority when the front contact unloads or is
   * still descending. The gate uses existing load and pitch; it is not a
   * complete single-wheel balance or rear-tyre camber-thrust model. */
  frontContactSteering?: boolean;
}
export const BIKE: BikeParameters = Object.freeze({
  mass: 157 + 72,
  wheelbase: 1.45,
  cgHeight: 0.62,
  cgToFront: 0.73,
  cgToRear: 0.72,
  maxSteer: 0.6,
  steerRate: 2.2,
  maxLean: 1.0,
  mu: 1.55,
  power: 180000,
  maxDrive: 4200,
  frontBrake: 9500,
  rearBrake: 2400,
  drag: 0.38,
  riderOffsetMax: 0.28,
});
export type BikeState = 'riding' | 'lowside' | 'highside' | 'separated' | 'remount';
/** Snapshot code of each state (protocol B.STATE). */
export const BIKE_STATES: readonly BikeState[] = Object.freeze([
  'riding',
  'lowside',
  'highside',
  'separated',
  'remount',
]);
export interface BikeInput {
  /** Stick: intended lean (assist) or steer demand (expert), -1..1, left +. */
  lean: number;
  throttle: number;
  frontBrake: number;
  rearBrake: number;
  /** Rider hang-off, -1..1 (left +). */
  rider: number;
  /** Drive force at the rear contact before traction limits (N). When absent
   * the constant-power research drive is used. */
  drive?: number;
  /** Drivetrain braking at the rear contact, newtons, already blended by the
   * adapter's throttle map. It consumes the SAME rear friction circle as the
   * pedal, drive force and lateral load. */
  engineBrake?: number;
}
export interface BikeAssists {
  lean: boolean;
  wheelie: boolean;
  traction: boolean;
  combinedBrakes: boolean;
  /** Cornering ABS: brake forces kept inside both tyres' friction circles. */
  abs: boolean;
}
export const NOVICE: BikeAssists = Object.freeze({
  lean: true,
  wheelie: true,
  traction: true,
  combinedBrakes: true,
  abs: true,
});
export const EXPERT: BikeAssists = Object.freeze({
  lean: false,
  wheelie: false,
  traction: false,
  combinedBrakes: false,
  abs: false,
});
/** Steering blend: 0 at walking pace (direct bars), 1 from 5 m/s (lean intent). */
export function leanAuthority(speed: number) {
  return clamp((speed - 2) / 3, 0, 1);
}
export class Bike {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  lean = 0;
  leanRate = 0;
  steer = 0;
  /** Nose-up pitch from wheelie (+) / stoppie (-), radians. */
  pitch = 0;
  /** Current bike + rider mass (fuel burn is applied by the adapter). */
  mass: number;
  frontLoad: number;
  rearLoad: number;
  riderOffset = 0;
  rearSlip = 0;
  /** GP-R1/R2 only: independently integrated cambered tyre / yaw / lateral state. */
  motoGP: MotoGPChassis | null = null;
  state: BikeState = 'riding';
  /** Seconds in the current crash/recovery state. */
  stateClock = 0;
  crashes = 0;
  /** Accumulated recovery time loss, for classification. */
  penaltySeconds = 0;
  /** Last decelerations, for diagnostics (m/s²). */
  longitudinal = 0;
  lateralUse = 0;
  /** Front/rear friction-circle use of the last step. */
  frontUse = 0;
  rearUse = 0;
  /** Environment set by the session adapter before each step: road friction
   * multiplier, sine of the uphill gradient along the heading, drag scale
   * (rider tuck) and whether the separated rider is back at the bike. */
  grip = 1;
  /** Optional per-contact grip for GP prototypes and player motocross. The adapter keeps `grip`
   * at the lower value for conservative lean intent, but an intact rear
   * contact must not lose its drive grip because the front crosses a kerb or mud
   * (or vice versa under braking). Other motorcycles retain shared grip.
   * These are sampled environment inputs, not integrated/replay state. */
  frontGrip?: number;
  rearGrip?: number;
  slope = 0;
  dragScale = 1;
  riderReady = true;
  /** Forces actually applied last step (N), and assist interventions 0..1. */
  driveForce = 0;
  frontBrakeForce = 0;
  rearBrakeForce = 0;
  /** Share of rearBrakeForce dissipated by the drivetrain, not the brake disc. */
  engineBrakeForce = 0;
  intervention = 0;
  constructor(
    public assists: BikeAssists = NOVICE,
    readonly p: BikeParameters = BIKE,
  ) {
    this.mass = p.mass;
    this.frontLoad = (p.mass * G * p.cgToRear) / p.wheelbase;
    this.rearLoad = (p.mass * G * p.cgToFront) / p.wheelbase;
  }
  /** GP adapter opt-in. Research/road/MX bikes keep their previous dynamics. */
  enableMotoGPPhysics(geometry: MotoGPGeometry) {
    this.motoGP = new MotoGPChassis(geometry);
    this.motoGP.reset(this.speed);
  }
  get curvature() {
    const p = this.p,
      geometric = (Math.tan(this.steer) / p.wheelbase) * Math.cos(this.lean);
    if (!p.frontContactSteering) return geometric;
    // A turned handlebar cannot transmit road steering through an unloaded
    // front tyre. Fade only in the lowest 5% of its static normal load, below
    // the 8% retained by the least intrusive GP wheelie-control map. Ordinary
    // two-contact riding therefore keeps its existing curvature exactly.
    // Normal load may return before the wheel descends; the existing wheelie
    // pitch keeps road steering off until its final contact transition. The
    // same getter feeds roll, lateral force budgets, yaw, tyre heat and body
    // angular velocity, so the loss is physical rather than a visual pose.
    const staticFront =
      (this.mass * G * p.cgToRear) / p.wheelbase +
      (p.downforce ?? 0) * this.speed * this.speed * (p.downforceFront ?? 0.6);
    return (
      geometric *
      clamp(this.frontLoad / (0.05 * staticFront), 0, 1) *
      gpFrontSteeringContact(this.pitch, p.wheelbase)
    );
  }
  /** Lateral acceleration the rider's hang-off adds at a lean, in units of g.
   * GP prototypes use the exact combined-CG geometry (gpHangOffAngle). */
  riderGain(offset = this.riderOffset, lean = this.lean) {
    if (this.motoGP) {
      const theta = gpHangOffAngle(offset, this.p.cgHeight);
      return Math.tan(clamp(lean + theta, -1.45, 1.45)) - Math.tan(lean);
    }
    return (offset * 0.25) / (this.p.cgHeight * Math.max(0.2, Math.cos(lean)));
  }
  /** Lean the assist will request at full stick on the current surface (rad):
   * the lean whose cornering force, with full hang-off, stays inside 90% of
   * the assist's friction budget, so a held target is always recoverable.
   * GP prototypes: the lean of the COMBINED bike + rider CG (tan ψ = a_y/g),
   * bounded by the tyres' lateral friction and by the chassis's own ground
   * clearance with the rider fully off; the bike's lean is ψ minus hang-off. */
  get leanLimit() {
    const p = this.p;
    if (this.motoGP) {
      const clearance = p.maxLean + gpHangOffAngle(p.riderOffsetMax, p.cgHeight);
      return Math.min(clearance, Math.atan(GP_ASSIST.leanMargin * this.gpFriction(clearance)));
    }
    const gain = (p.riderOffsetMax * 0.25) / p.cgHeight;
    return Math.min(p.maxLean, Math.atan(Math.max(0.2, 0.72 * p.mu * this.grip - gain)));
  }
  /** Steady lateral friction (in g) of both GP slicks at a combined lean,
   * including wing load, the shoulder's camber factor and the gyroscopic
   * moment of the spinning wheels (which asks ~3% more lean per g). */
  private gpFriction(lean: number) {
    const p = this.p,
      gp = this.motoGP!,
      m = this.mass,
      wing = 1 + ((p.downforce ?? 0) * this.speed * this.speed) / (m * G),
      gyro = 1 + (gpSpinPerSpeed(gp.geometry) * Math.cos(lean)) / (m * p.cgHeight);
    return (p.mu * this.grip * gpCamberFriction(lean) * wing) / gyro;
  }
  /** Lateral acceleration (m/s²) both GP tyres can supply now: each contact's
   * friction circle less the longitudinal force it already carries, bounded
   * by whichever end limits the static front/rear share of cornering force. */
  private gpLateralCapacity(frontMu: number, rearMu: number) {
    const p = this.p,
      m = this.mass,
      shoulder = gpCamberFriction(this.lean),
      front = Math.sqrt(
        Math.max(0, (frontMu * shoulder * this.frontLoad) ** 2 - this.frontBrakeForce ** 2),
      ),
      rearFx = this.driveForce - this.rearBrakeForce,
      rear = Math.sqrt(Math.max(0, (rearMu * shoulder * this.rearLoad) ** 2 - rearFx ** 2));
    return Math.max(
      0.5,
      Math.min(front / ((m * p.cgToRear) / p.wheelbase), rear / ((m * p.cgToFront) / p.wheelbase)),
    );
  }
  /** GP lean-intent assist: handlebar angle that brings the combined CG lean
   * ψ to the rider's target. A roll-rate reference stays inside both the
   * rider's steering effort (gpRollRateLimit) and the energy the tyres can
   * still spend to stop the roll at the target; inverting the roll balance
   * gives the lateral acceleration to ask for, and the kinematic ground steer
   * for that acceleration plus a bounded integral trim on the measured
   * acceleration gives the bars. The tyres, not this law, decide the motion. */
  private gpSteer(stick: number, frontMu: number, rearMu: number, dt: number) {
    const p = this.p,
      gp = this.motoGP!,
      v = Math.max(this.speed, 3),
      m = this.mass,
      h = p.cgHeight,
      inertia = gpRollInertia(gp.geometry, m, h),
      k = (m * h) / inertia,
      capacity = this.gpLateralCapacity(frontMu, rearMu),
      recovery = GP_ASSIST.recovery * capacity,
      psi = this.lean + gpHangOffAngle(this.riderOffset, h),
      gyro = gpSpinPerSpeed(gp.geometry) * this.speed * gp.yawRate * Math.cos(this.lean);
    // Target: the stick's share of the steady lean limit (surface grip, wing
    // load). Cornering ABS, traction and wheelie control keep the margin
    // between it and the tyres' present capacity, which bounds recovery.
    const target = (gp.leanTarget = clamp(stick, -1, 1) * this.leanLimit);
    // The lateral force answers a steer change within a fraction of a second
    // (sideslip and yaw modes); plan from where the roll will be by then.
    // The present roll acceleration (from the measured tyre force) carries
    // the roll rate on for that lag too.
    const measured = gp.lateralAcceleration,
      cornering = Math.max(4000, gp.frontStiffness),
      // The front-force steering answers within a relaxation length, so the
      // look-ahead is short; rateGain·lead < 1 keeps the measured-force
      // prediction from feeding a step-to-step oscillation.
      lag = GP_ASSIST.lead,
      rolling = (m * h * (G * Math.sin(psi) - measured * Math.cos(psi)) - gyro) / inertia,
      rateAhead = this.leanRate + lag * rolling,
      ahead = psi + lag * this.leanRate + 0.5 * lag * lag * rolling,
      error = target - ahead,
      direction = Math.sign(error);
    // Roll energy left to stop at the target with the recovery acceleration:
    // ∫ k(a_rec·cos s − dir·g·sin s) ds from ψ to the target.
    const stopping =
      k *
      (recovery * direction * (Math.sin(target) - Math.sin(ahead)) +
        G * (Math.cos(target) - Math.cos(ahead)));
    const rate =
      direction *
      Math.min(
        gpRollRateLimit(this.speed, gp.geometry),
        GP_ASSIST.rollGain * Math.abs(error),
        Math.sqrt(2 * GP_ASSIST.stopShare * Math.max(0, stopping)),
      );
    const rollAccel = GP_ASSIST.rateGain * (rate - rateAhead);
    // Inverse roll balance: I·ψ'' = m h (g sinψ − a cosψ) − H·r·cosφ.
    const demand =
      (m * h * G * Math.sin(psi) - gyro - inertia * rollAccel) /
      (m * h * Math.max(0.3, Math.cos(psi)));
    // Traction and wheelie control give way to the roll control asked for.
    gp.lateralDemand = Math.min(Math.abs(demand), 2 * G);
    const lateral = clamp(demand, -recovery, recovery);
    const saturated = Math.abs(lateral) >= recovery * 0.999;
    // Integral trim on the measured acceleration: relaxation and the slip
    // the inverse below does not model (combined-slip weighting).
    if (!saturated || Math.sign(lateral - measured) !== Math.sign(gp.steerTrim))
      gp.steerTrim = clamp(
        gp.steerTrim + (GP_ASSIST.trimRate * p.wheelbase * (lateral - measured) * dt) / (v * v),
        -GP_ASSIST.trimLimit,
        GP_ASSIST.trimLimit,
      );
    // The front tyre supplies what the rear presently does not, less a yaw
    // correction toward the path's own yaw rate (a/v): with the rear light
    // under braking, nothing else damps the yaw. Steering the front for a
    // force, through the inverse of its own curve at its present slip,
    // camber and sideslip, answers within one relaxation length.
    const yawError = gp.yawRate - lateral / v,
      frontForce =
        m * lateral -
        gp.rearFy -
        (GP_ASSIST.yawDamping * gp.geometry.yawInertia * yawError) / gp.geometry.frontArm,
      inverse = gp.frontSteerFor(frontForce, this.lean, this.speed, this.frontBrakeForce);
    const ground =
      (inverse ??
        Math.atan((p.wheelbase * lateral) / (v * v)) +
          clamp((GP_ASSIST.feedback * m * (lateral - measured)) / cornering, -0.06, 0.06)) +
      gp.steerTrim;
    (gp as unknown as { debug: number[] }).debug = [target, psi, rate, lateral, measured, capacity, frontForce, gp.frontFy, gp.rearFy, inverse ?? NaN, ground, gp.steerTrim];
    return gpBarSteer(ground, this.lean);
  }
  step(input: BikeInput, dt: number) {
    if (!(dt > 0) || dt > 0.05) throw new Error('Invalid bike timestep');
    if (this.state !== 'riding') return this.recover(dt);
    const a = this.assists,
      p = this.p,
      m = this.mass,
      mu = p.mu * this.grip,
      frontMu = p.mu * (this.frontGrip ?? this.grip),
      rearMu = p.mu * (this.rearGrip ?? this.grip);
    // Rider hang-off moves toward its command at a bounded rate. On a GP
    // prototype the combined lean is conserved while the rider moves: the
    // bike rolls the other way by the hang-off angle (an internal force).
    const offsetBefore = this.riderOffset,
      steerBefore = this.steer;
    this.riderOffset += clamp(
      clamp(input.rider, -1, 1) * p.riderOffsetMax - this.riderOffset,
      -0.6 * dt,
      0.6 * dt,
    );
    // --- Steering: assisted intention or direct steer.
    const v = Math.max(this.speed, 0.1);
    let steerTarget: number;
    if (a.lean && this.motoGP && this.speed > 3)
      steerTarget = this.gpSteer(input.lean, frontMu, rearMu, dt);
    else if (a.lean) {
      // Stable intention: the requested lean is capped by what grip allows.
      // The assist commands the lateral acceleration that makes the lean
      // converge (less than g·tanφ to fall in, more to stand up): this is
      // counter-steering expressed as curvature, then converted to steer.
      const target = clamp(input.lean, -1, 1) * this.leanLimit;
      // Never ask the tyres for more than 80% of the friction circle.
      const budget = 0.8 * mu * G;
      const lateral = clamp(
        G * Math.tan(this.lean) +
          G * this.riderGain() -
          G * 2 * (target - this.lean) +
          G * 0.7 * this.leanRate,
        -budget,
        budget,
      );
      const kappa = lateral / (v * v);
      steerTarget = Math.atan((kappa * p.wheelbase) / Math.max(0.2, Math.cos(this.lean)));
      if (this.motoGP && this.speed > 3) {
        // Feedback on physical yaw and drift, not the bars' geometric path.
        // Rider intent remains a lean target; rear slip must not induce a
        // self-reinforcing steering correction at high corner-entry speed.
        steerTarget +=
          clamp(0.02 * (lateral - this.motoGP.lateralAcceleration), -0.12, 0.12) +
          clamp(
            0.08 * (lateral / v - this.motoGP.yawRate) +
              0.2 * Math.atan2(this.motoGP.lateralSpeed, v),
            -0.08,
            0.08,
          );
      }
    } else {
      // Expert: the stick is a steer demand over the range usable at speed.
      const usable = Math.atan((p.wheelbase * 1.4 * G) / (v * v));
      steerTarget = clamp(input.lean, -1, 1) * Math.min(p.maxSteer, usable);
    }
    // At walking pace the rider steers the bars directly (pit box, remount).
    const authority = leanAuthority(this.speed);
    if (authority < 1)
      steerTarget = lerp(clamp(input.lean, -1, 1) * p.maxSteer * 0.5, steerTarget, authority);
    steerTarget = clamp(steerTarget, -p.maxSteer, p.maxSteer);
    this.steer += clamp(steerTarget - this.steer, -p.steerRate * dt, p.steerRate * dt);
    // --- Longitudinal forces and load transfer.
    let front = clamp(input.frontBrake, 0, 1),
      rear = clamp(input.rearBrake, 0, 1);
    if (a.combinedBrakes) {
      // On a GP machine the rear pedal trims the rear tyre alone. Taking
      // max(front, rear) here made that pedal pull the front brake too, so
      // a small rear correction could unexpectedly load the fork. Preserve
      // Sport's existing front-lever proportioning and its ABS force budget.
      const total = p.independentRearBrake ? front : Math.max(front, rear);
      front = total * 0.78;
      rear = Math.max(rear, total * 0.3);
    }
    const throttle = clamp(input.throttle, 0, 1);
    const downforce = (p.downforce ?? 0) * this.speed * this.speed,
      downFront = downforce * (p.downforceFront ?? 0.6),
      downRear = downforce - downFront;
    const staticFront = (m * G * p.cgToRear) / p.wheelbase + downFront,
      staticRear = (m * G * p.cgToFront) / p.wheelbase + downRear;
    let drive =
      input.drive !== undefined
        ? Math.max(0, input.drive)
        : Math.min(p.maxDrive, (p.power * throttle) / Math.max(v, 3));
    const requested = drive;
    const rearCapacity = rearMu * this.rearLoad;
    // Lean-sensitive traction control: drive is kept inside what the rear
    // friction circle leaves after the cornering force it carries.
    const lateralNow = Math.abs(this.motoGP?.lateralAcceleration ?? this.speed * this.speed * this.curvature),
      rearLatNow = m * lateralNow * (p.cgToFront / p.wheelbase),
      // GP traction control keeps the rear's share of the lean assist's
      // recovery reserve, not just today's cornering force: drive that
      // spends the margin leaves nothing to stand the bike up with.
      // The lean itself sets that need (it changes slowly), so the reserve
      // cannot collapse and re-arm the drive within one roll correction.
      gpReserve = this.motoGP
        ? m *
          Math.max(
            lateralNow,
            G *
              Math.tan(
                Math.min(
                  1.3,
                  Math.max(
                    Math.abs(this.lean + gpHangOffAngle(this.riderOffset, p.cgHeight)),
                    a.lean ? Math.abs(this.motoGP.leanTarget) : 0,
                  ),
                ),
              ),
            a.lean ? this.motoGP.lateralDemand : 0,
          ) *
          (GP_ASSIST.recovery / GP_ASSIST.leanMargin)
        : 0,
      rearLatReserve = this.motoGP ? gpReserve * (p.cgToFront / p.wheelbase) : rearLatNow,
      rearDriveCapacity = this.motoGP ? rearCapacity * gpCamberFriction(this.lean) : rearCapacity;
    if (a.traction)
      drive = Math.min(
        drive,
        Math.sqrt(Math.max(0, rearDriveCapacity ** 2 - rearLatReserve ** 2)) *
          (p.tractionMargin ?? 0.92),
      );
    // Wheelie control cuts drive before the acceleration that unloads the
    // front: it keeps a fifth of the static load, and in a corner the load
    // the front tyre needs for its share of the cornering force.
    // GP: the front keeps the load its share of the assist's reserve needs;
    // drive that unloads it below that pushes the front wide on the exit.
    const frontLatNow = m * lateralNow * (p.cgToRear / p.wheelbase);
    if (a.wheelie) {
      const frontNeed = this.motoGP
        ? (gpReserve * (p.cgToRear / p.wheelbase)) / (frontMu * gpCamberFriction(this.lean))
        : frontLatNow / (0.8 * frontMu);
      const keep = Math.min(
        staticFront,
        Math.max((p.wheelieKeep ?? 0.2) * staticFront, frontNeed),
      );
      drive = Math.min(drive, ((staticFront - keep) * p.wheelbase) / p.cgHeight);
    }
    this.intervention = requested > 1 ? clamp(1 - drive / requested, 0, 1) : 0;
    // Stoppie assist (with the wheelie assist): like lift-mitigating ABS, cap
    // front force at the deceleration where the rear would leave the road.
    const engineRequest =
      Number.isFinite(input.engineBrake) &&
      throttle <= (p.engineBrakeReleaseThrottle ?? 0.02) &&
      this.speed > 3
        ? Math.max(0, input.engineBrake ?? 0)
        : 0;
    const rearServiceRequest = p.rearBrake * rear * (v > 0.2 ? 1 : 0);
    const brakeR = rearServiceRequest + engineRequest;
    // What the rear can actually take (a light rear locks and slides).
    const rearHeld = Math.min(brakeR, rearMu * this.rearLoad);
    const liftLimit = a.wheelie
      ? Math.max(0, ((p.stoppieMargin ?? 0.92) * staticRear * p.wheelbase) / p.cgHeight - rearHeld)
      : Infinity;
    let brakeF = Math.min(liftLimit, p.frontBrake * front) * (v > 0.2 ? 1 : 0);
    if (a.abs) {
      // Cornering ABS: the front stays inside its friction circle, and the
      // weight it takes off the rear leaves the rear its cornering load.
      const rearLatKeep = rearLatNow / (0.85 * rearMu);
      brakeF = Math.min(
        brakeF,
        0.95 * Math.sqrt(Math.max(0, (frontMu * this.frontLoad) ** 2 - frontLatNow ** 2)),
        Math.max(0, ((staticRear - rearLatKeep) * p.wheelbase) / p.cgHeight - rearHeld),
      );
    }
    let rearForce = drive - brakeR;
    let rearApplied = clamp(rearForce, -rearCapacity, rearCapacity);
    let frontApplied = -Math.min(brakeF, frontMu * this.frontLoad);
    if (a.abs) {
      // The current brake stroke unloads the rear immediately. Using last
      // step's rear load lets even combined-brake assistance lock the rear,
      // especially when trail braking on a wet surface. Solve its remaining
      // friction circle with this step's load transfer, not the old load.
      const camberNow = 1 - 0.18 * Math.max(0, Math.abs(this.lean) - 0.8);
      const rearBrakeGrip = 0.95 * rearMu * camberNow;
      const frontBrakeGrip = 0.95 * frontMu * camberNow;
      const transferRatio = p.cgHeight / p.wheelbase;
      if (rearApplied < 0) {
        const capacity = rearBrakeGrip * Math.max(0, staticRear + frontApplied * transferRatio);
        const coupling = rearBrakeGrip * transferRatio;
        // q² + Fy² = (capacity - coupling*q)². This rationalized
        // positive root remains well conditioned even when coupling ≈ 1.
        const remaining = capacity * capacity - rearLatNow * rearLatNow;
        const limit =
          remaining > 0
            ? remaining /
              (capacity * coupling + Math.sqrt(remaining + (coupling * rearLatNow) ** 2))
            : 0;
        rearApplied = Math.max(rearApplied, -limit);
      }
      // Reducing rear braking also reduces front load. Bound the front
      // against the same final force pair, including simultaneous throttle.
      // Front load increases with its own brake force; lift control above
      // remains the bound when that friction equation has no upper root.
      const coupling = frontBrakeGrip * transferRatio;
      if (frontApplied < 0 && coupling < 1) {
        const capacity = frontBrakeGrip * Math.max(0, staticFront - rearApplied * transferRatio);
        const discriminant = capacity * capacity - (1 - coupling * coupling) * frontLatNow ** 2;
        const limit =
          discriminant > 0
            ? (capacity * coupling + Math.sqrt(discriminant)) / (1 - coupling * coupling)
            : 0;
        frontApplied = Math.max(frontApplied, -limit);
      }
    }
    if (p.currentDriveTraction && a.traction && rearApplied > 0) {
      // TC's first pass uses the preceding contact load. A simultaneous front
      // brake stroke can now unload the rear, especially with clean front
      // asphalt and a wet/kerbed rear tyre. Limit the requested engine force
      // using the CURRENT force pair before committing load/heat/telemetry.
      // With q = net rear drive, N = N0 + (frontApplied + q)*h/L and map k,
      // q² + (k*Fy)² <= (k*mu*camber*N)². Use its positive upper root; the
      // drive contributes its own rear load, so merely clipping to N(q_old)
      // would still over-ask grip after reducing q.
      const camberNow = 1 - 0.18 * Math.max(0, Math.abs(this.lean) - 0.8);
      const margin = p.tractionMargin ?? 0.92;
      const tractionGrip = margin * rearMu * camberNow;
      const transferRatio = p.cgHeight / p.wheelbase;
      const capacity = tractionGrip * Math.max(0, staticRear + frontApplied * transferRatio);
      const coupling = tractionGrip * transferRatio;
      if (coupling < 1) {
        const lateral = margin * rearLatReserve;
        const discriminant = capacity * capacity - (1 - coupling * coupling) * lateral * lateral;
        const limit =
          discriminant > 0
            ? (capacity * coupling + Math.sqrt(discriminant)) / (1 - coupling * coupling)
            : 0;
        if (rearApplied > limit) {
          drive = Math.min(drive, brakeR + limit);
          rearForce = drive - brakeR;
          rearApplied = Math.min(rearApplied, rearForce);
          this.intervention = requested > 1 ? clamp(1 - drive / requested, 0, 1) : 0;
        }
      }
    }
    this.rearSlip =
      a.abs && rearForce < 0 ? 0 : Math.max(0, Math.abs(rearForce) / Math.max(1, rearCapacity) - 1);
    this.driveForce = Math.max(0, rearApplied);
    this.frontBrakeForce = -frontApplied;
    this.rearBrakeForce = Math.max(0, -rearApplied);
    this.engineBrakeForce = brakeR > 0 ? this.rearBrakeForce * (engineRequest / brakeR) : 0;
    const dragForce = p.drag * this.dragScale * this.speed * this.speed,
      rolling = this.speed > 0.05 ? (p.rolling ?? 0) * m * G : 0;
    const ax = (rearApplied + frontApplied - dragForce - rolling) / m - G * this.slope;
    this.longitudinal = ax;
    // Load transfer from the tyres' longitudinal forces (they act at the road,
    // h below the CG; drag and gravity act near the CG): ΔF = Fx·h/L, with
    // loads clamped so they never become negative.
    const transfer = ((rearApplied + frontApplied) * p.cgHeight) / p.wheelbase;
    this.frontLoad = Math.max(0, staticFront - transfer);
    this.rearLoad = Math.max(0, staticRear + transfer);
    // Wheelie/stoppie: pitch grows only while a wheel load would be negative.
    const excess =
      staticFront - transfer < 0
        ? transfer - staticFront
        : staticRear + transfer < 0
          ? transfer + staticRear
          : 0;
    const settlingFront = p.frontContactSteering && excess === 0 && this.pitch > 0;
    let pitchRate = excess !== 0 ? (excess / (m * G)) * 3 : -this.pitch * 4;
    if (settlingFront) pitchRate = Math.min(pitchRate, -GP_FRONT_SETTLE_RATE);
    if (a.wheelie && this.pitch > (p.wheelieLimit ?? 0.12) && pitchRate > 0) pitchRate = -1.5;
    this.pitch = clamp(this.pitch + pitchRate * dt, -0.5, 0.9);
    // Contact ends the GP descent; closing the final gap cannot itself
    // overshoot into a stoppie. Real braking-induced negative pitch still
    // follows the existing excess-load branch above.
    if (settlingFront) this.pitch = Math.max(0, this.pitch);
    if (this.pitch > 0.75 || this.pitch < -0.4) return this.fall('highside');
    this.speed = Math.max(0, this.speed + ax * dt);
    // GP prototypes integrate a physically separate contact-patch/yaw state.
    // The shared car and off-road solvers never enter this code path.
    const gp = this.motoGP?.step({
      dt,
      speed: this.speed,
      mass: m,
      lean: this.lean,
      steer: this.steer,
      frontLoad: this.frontLoad,
      rearLoad: this.rearLoad,
      frontMu,
      rearMu,
      frontFx: frontApplied,
      rearFx: rearApplied,
      frontContact:
        clamp(this.frontLoad / Math.max(1, 0.05 * staticFront), 0, 1) *
        gpFrontSteeringContact(this.pitch, p.wheelbase),
      frontBrakeExcess: a.abs ? 0 : Math.max(0, p.frontBrake * front - this.frontBrakeForce),
      rearDriveExcess: a.traction || a.wheelie ? 0 : Math.max(0, requested - drive),
      rearBrakeExcess: a.abs ? 0 : Math.max(0, brakeR - this.rearBrakeForce),
    });
    // --- Roll balance: gravity vs tyre-generated lateral acceleration.
    const kappa = this.curvature;
    const lateralAccel = gp ? gp.lateralAcceleration : this.speed * this.speed * kappa;
    const h = p.cgHeight;
    // Low-speed balance assist (explicit, §8.3): below walking pace the rider
    // supports the bike, so lean is held near upright instead of toppling.
    const support = a.lean ? 1 - clamp((this.speed - 1) / 4, 0, 1) : 0;
    if (gp) {
      // GP: roll of the COMBINED CG ψ = φ + θ(hang-off) about the contact
      // line with the full roll inertia, I·ψ'' = m h (g sinψ − a_y cosψ)
      // − H·r·cosφ − H_f·δ'·cosε. H is the wheels' measured spin momentum:
      // yawing it stands the bike up (more lean per g at any speed), and
      // turning the bars precesses the front wheel (counter-steer helps the
      // roll begin). The rider's own movement conserves ψ, so hang-off rolls
      // the bike φ = ψ − θ less far over for the same corner.
      const geometry = gp.geometry,
        inertia = gpRollInertia(geometry, m, h),
        psi = this.lean + gpHangOffAngle(offsetBefore, h),
        frontSpin = geometry.frontWheelInertia * gp.frontOmega,
        spin = frontSpin + geometry.rearWheelInertia * gp.rearOmega,
        steerRate = (this.steer - steerBefore) / dt;
      const rollAccel =
        (m * h * (G * Math.sin(psi) - lateralAccel * Math.cos(psi)) -
          spin * gp.yawRate * Math.cos(this.lean) -
          frontSpin * steerRate * Math.cos(GP_RAKE)) /
        inertia;
      this.leanRate += (rollAccel - support * (psi * 40 + this.leanRate * 10)) * dt;
      this.leanRate *= Math.exp(-(p.rollDamping ?? 1.2) * dt);
      this.lean = psi + this.leanRate * dt - gpHangOffAngle(this.riderOffset, h);
    } else {
      const rollAccel =
        (G * Math.sin(this.lean) - lateralAccel * Math.cos(this.lean)) / h +
        ((G * this.riderOffset) / (h * h)) * 0.25;
      this.leanRate += (rollAccel - support * (this.lean * 40 + this.leanRate * 10)) * dt;
      this.leanRate *= Math.exp(-(p.rollDamping ?? 1.2) * dt);
      this.lean += this.leanRate * dt;
    }
    // --- Grip limits: lateral demand against each friction circle.
    const camber = 1 - 0.18 * Math.max(0, Math.abs(this.lean) - 0.8);
    const lateralForce = m * Math.abs(lateralAccel);
    const frontLat = gp ? Math.abs(gp.frontFy) : lateralForce * (p.cgToRear / p.wheelbase),
      rearLat = gp ? Math.abs(gp.rearFy) : lateralForce * (p.cgToFront / p.wheelbase);
    // A front skimming the road in a wheelie steers nothing; it is not a lowside.
    const frontUse =
      this.frontLoad < 0.05 * m * G
        ? 0
        : Math.hypot(frontLat, -frontApplied) / Math.max(1, frontMu * camber * this.frontLoad);
    // A lightly loaded rear under braking locks and slides; it is not a crash.
    const rearCorneringUse =
      this.rearLoad < 0.05 * m * G
        ? 0
        : Math.hypot(rearLat, Math.max(0, rearApplied)) / (rearMu * camber * this.rearLoad);
    // Report the full force circle under braking too. The crash model still
    // distinguishes a recoverable rear brake slide from a powered highside.
    const rearUse = Math.hypot(rearLat, rearApplied) / Math.max(1, rearMu * camber * this.rearLoad);
    this.frontUse = frontUse;
    this.rearUse = rearUse;
    this.lateralUse = Math.max(frontUse, rearUse);
    if (frontUse > 1.08 && this.speed > 3) return this.fall('lowside');
    if (rearCorneringUse > 1.15 && this.speed > 3) {
      this.rearSlip += rearCorneringUse - 1;
      // Under power a sliding rear that bites throws the rider (highside);
      // a rear sliding on the brakes steps out, and only a gross slide falls.
      if (rearApplied > 0 && this.rearSlip > 0.6) return this.fall('highside');
      if (rearApplied <= 0 && rearCorneringUse > 1.45) return this.fall('lowside');
    }
    if (Math.abs(this.lean) > 1.25) return this.fall('lowside');
    this.heading += (gp ? gp.yawRate : this.speed * kappa) * dt;
    const sideSpeed = gp?.lateralSpeed ?? 0;
    this.x += (Math.sin(this.heading) * this.speed + Math.cos(this.heading) * sideSpeed) * dt;
    this.z += (Math.cos(this.heading) * this.speed - Math.sin(this.heading) * sideSpeed) * dt;
    return this.state;
  }
  /** Start a crash (grip exceeded here, or a contact reported by the adapter). */
  fall(kind: 'lowside' | 'highside') {
    if (this.state !== 'riding') return this.state;
    this.state = kind;
    this.stateClock = 0;
    this.crashes++;
    this.motoGP?.reset(this.speed);
    this.driveForce =
      this.frontBrakeForce =
      this.rearBrakeForce =
      this.engineBrakeForce =
      this.intervention =
        0;
    return this.state;
  }
  /** Crash → rider separation → remount: a single rider identity throughout,
   * a fixed time cost, and control returns only after the remount ends. */
  private recover(dt: number) {
    this.stateClock += dt;
    this.penaltySeconds += dt;
    if ((this.state === 'lowside' || this.state === 'highside') && this.stateClock > 0.6) {
      this.state = 'separated';
      this.stateClock = 0;
    }
    // The bike slides to rest on its side while the rider is separated;
    // loose surfaces stop it sooner.
    const decel = (this.state === 'lowside' ? 6 : 9) * (this.grip < 0.6 ? 1.4 : 1);
    this.speed = Math.max(0, this.speed - decel * dt);
    if (this.state !== 'remount') {
      const side = this.lean < 0 ? -1 : 1;
      this.lean += clamp(side * 1.45 - this.lean, -4 * dt, 4 * dt);
    } else this.lean += clamp(-this.lean, -1.5 * dt, 1.5 * dt);
    this.leanRate = 0;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    if (this.state === 'separated' && this.speed === 0 && this.stateClock > 2 && this.riderReady) {
      this.state = 'remount';
      this.stateClock = 0;
    }
    if (this.state === 'remount' && this.stateClock > 1.5 && this.riderReady) {
      this.state = 'riding';
      this.lean = this.leanRate = this.steer = this.pitch = this.rearSlip = 0;
      this.riderOffset = 0;
      this.motoGP?.reset(this.speed);
      this.stateClock = 0;
    }
    return this.state;
  }
}
