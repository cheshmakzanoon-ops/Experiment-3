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

/** Road-adapter roll control. Lean uses the existing 72% grip target;
 * transient recovery may use the remaining contact capacity. The stopping
 * bound slows a roll before its remaining tyre moment becomes insufficient. */
const ROAD_ASSIST = Object.freeze({
  recovery: 0.96,
  rollGain: 4.5,
  rateGain: 9,
  stopShare: 0.75,
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
  /** Seconds a tyre may stay past its friction circle before the rider is
   * down. Loose soil lets a pushed front or a stepped-out rear slide and bite
   * again, so a patch of sand or one unweighted bump is not an instant fall;
   * a gross overload still spends this allowance several times faster. Set by
   * the player's motocross adapter only: every other motorcycle keeps the
   * immediate rule (undefined). */
  gripFallGrace?: number;
  /** Feet-up balance between walking pace and 5 m/s. The shared assist
   * counter-steers toward a lean that its own low-speed support spring holds
   * upright, so between roughly 2.5 and 4.5 m/s a held stick turns the bike
   * the wrong way and never leans it. With this set, the bars take the steady
   * steer of the lean the rider intends (bounded by what the lock can balance
   * at that speed) and the support spring tips the bike to that lean instead
   * of to vertical. Enabled by the ordinary road-bike and motocross adapters
   * for player lean-intent control. GP's own controller, calibrated AI and
   * unassisted direct-steer research mode retain their existing behavior. */
  lowSpeedBalance?: boolean;
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
  /** Seconds of the `gripFallGrace` allowance already spent (0 without it). */
  gripOver = 0;
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
  /** Optional unilateral loads from the road adapter's heave/pitch solver.
   * Undefined keeps the standalone research and MX load-transfer model.
   * These contacts already contain dynamic transfer; do not add it twice. */
  contactLoads?: { front: number; rear: number; rearLiftForce?: number };
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
    if (this.contactLoads && !this.motoGP) {
      // Ordinary road bikes retain the reduced steering model, but a
      // geometric bar angle cannot demand lateral force from an unloaded
      // tyre. Bound the realised curvature by both actual contact circles,
      // as the GP patch solver does, including the current brake/drive use.
      const front = Math.sqrt(
          Math.max(
            0,
            (p.mu * (this.frontGrip ?? this.grip) * this.frontLoad) ** 2 -
              this.frontBrakeForce ** 2,
          ),
        ),
        rear = Math.sqrt(
          Math.max(
            0,
            (p.mu * (this.rearGrip ?? this.grip) * this.rearLoad) ** 2 -
              (this.driveForce - this.rearBrakeForce) ** 2,
          ),
        ),
        lateral = Math.min(
          (front * p.wheelbase) / (this.mass * p.cgToRear),
          (rear * p.wheelbase) / (this.mass * p.cgToFront),
        );
      return clamp(
        geometric,
        -lateral / Math.max(0.01, this.speed ** 2),
        lateral / Math.max(0.01, this.speed ** 2),
      );
    }
    if (!p.frontContactSteering && !this.contactLoads) return geometric;
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
      (this.contactLoads ? 1 : gpFrontSteeringContact(this.pitch, p.wheelbase))
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
    return this.roadLeanLimit(1);
  }
  /** The intent scale stays independent of instantaneous load. Apply the
   * contact bound to the physical target after decoding that intent, so a
   * suspension transient cannot turn a modest requested lean into full stick. */
  private get supportedRoadLeanLimit() {
    if (!this.contactLoads) return this.roadLeanLimit(1);
    const p = this.p,
      reaction = (this.frontLoad + this.rearLoad) / this.mass;
    if (reaction <= 1e-6) return 0;
    // The nominal 72% lean intent already includes its conservative margin.
    // Physical clipping instead leaves the documented 10% headroom inside
    // the CURRENT recovery budget, including the weaker contact and camber.
    // Applying the nominal margin again to every axle-load change needlessly
    // reduced an already arrestable request during a steady powered corner.
    const capacity = this.roadLateralCapacity(
        p.mu * (this.frontGrip ?? this.grip),
        p.mu * (this.rearGrip ?? this.grip),
      ),
      lateralRatio = (0.9 * ROAD_ASSIST.recovery * capacity) / reaction,
      gain = (p.riderOffsetMax * 0.25) / p.cgHeight;
    // Invert the actual road roll equilibrium with full rider hang-off:
    // sin(phi) + gain = lateralRatio * cos(phi). This also lets the bound
    // approach zero continuously when a contact loses lateral capacity.
    return Math.min(
      p.maxLean,
      Math.max(
        0,
        Math.atan(lateralRatio) - Math.asin(Math.min(1, gain / Math.hypot(1, lateralRatio))),
      ),
    );
  }
  private roadLeanLimit(support: number) {
    const p = this.p,
      gain = (p.riderOffsetMax * 0.25) / p.cgHeight;
    return Math.min(p.maxLean, Math.atan(Math.max(0.2, 0.72 * p.mu * this.grip * support - gain)));
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
      reaction = this.contactLoads ? (this.frontLoad + this.rearLoad) / m : G,
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
    const requestedTarget = clamp(stick, -1, 1) * this.leanLimit;
    // A sprung contact can unload before the road changes the requested
    // corner. Keep the target inside the lateral capacity already computed
    // for this exact front/rear load pair; otherwise the rider asks for a
    // lean the saturated tyres cannot arrest. The standalone model retains
    // its original nominal-weight target.
    const supportCapacity = this.contactLoads
      ? Math.min(
          (frontMu * this.frontLoad * p.wheelbase) / (m * p.cgToRear),
          (rearMu * this.rearLoad * p.wheelbase) / (m * p.cgToFront),
        ) * gpCamberFriction(this.lean)
      : Infinity;
    const supportedLimit = this.contactLoads
      ? Math.atan2(GP_ASSIST.leanMargin * supportCapacity, reaction)
      : this.leanLimit;
    const target = (gp.leanTarget = clamp(requestedTarget, -supportedLimit, supportedLimit));
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
      rolling = (m * h * (reaction * Math.sin(psi) - measured * Math.cos(psi)) - gyro) / inertia,
      rateAhead = this.leanRate + lag * rolling,
      ahead = psi + lag * this.leanRate + 0.5 * lag * lag * rolling,
      error = target - ahead,
      direction = Math.sign(error);
    // Roll energy left to stop at the target with the recovery acceleration:
    // ∫ k(a_rec·cos s − dir·g·sin s) ds from ψ to the target.
    const stopping =
      k *
      (recovery * direction * (Math.sin(target) - Math.sin(ahead)) +
        reaction * (Math.cos(target) - Math.cos(ahead)));
    const effort =
      direction *
      Math.min(gpRollRateLimit(this.speed, gp.geometry), GP_ASSIST.rollGain * Math.abs(error));
    const rate =
      direction *
      Math.min(Math.abs(effort), Math.sqrt(2 * GP_ASSIST.stopShare * Math.max(0, stopping)));
    // Inverse roll balance: I·ψ'' = m h (g sinψ − a cosψ) − H·r·cosφ.
    const balance = (accel: number) =>
      (m * h * reaction * Math.sin(psi) - gyro - inertia * accel) /
      (m * h * Math.max(0.3, Math.cos(psi)));
    const demand = balance(GP_ASSIST.rateGain * (rate - rateAhead));
    // Traction and wheelie control give way to the roll the rider asks for:
    // the reserve is the lateral acceleration of the effort-limited roll,
    // not of the slower roll today's (drive-reduced) capacity permits, or a
    // light front under full throttle could never regain steering.
    // The actual roll target above is bounded by today's contact support.
    // Reserve for the original request, however: using that already clipped
    // target here traps a powered-up bike on a light front, because the drive
    // limiter never sees the extra support needed to complete its lane change.
    const requestedError = requestedTarget - ahead,
      reserveEffort =
        Math.sign(requestedError) *
        Math.min(
          gpRollRateLimit(this.speed, gp.geometry),
          GP_ASSIST.rollGain * Math.abs(requestedError),
        );
    gp.lateralDemand = Math.min(
      Math.max(
        Math.abs(demand),
        Math.abs(balance(GP_ASSIST.rateGain * (reserveEffort - rateAhead))),
      ),
      2 * G,
    );
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
    // The current suspension can unload/reload a tyre before the rider runs.
    // Never cancel yesterday's rear force after it has ceased to exist. The
    // longitudinal controls are resolved below, so this preview uses the
    // preceding applied rear force, just as the front inverse does for Fx.
    const rearForce = this.contactLoads
        ? gp.rearForceFor(
            this.rearLoad,
            rearMu,
            this.lean,
            this.speed,
            this.driveForce - this.rearBrakeForce,
            dt,
          )
        : gp.rearFy,
      yawError = gp.yawRate - lateral / v,
      frontForce =
        m * lateral -
        rearForce -
        (GP_ASSIST.yawDamping * gp.geometry.yawInertia * yawError) / gp.geometry.frontArm,
      staticFront =
        (m * G * p.cgToRear) / p.wheelbase +
        (p.downforce ?? 0) * this.speed * this.speed * (p.downforceFront ?? 0.6),
      contact =
        clamp(this.frontLoad / Math.max(1, 0.05 * staticFront), 0, 1) *
        (this.contactLoads ? 1 : gpFrontSteeringContact(this.pitch, p.wheelbase)),
      inverse = gp.frontSteerFor(
        frontForce,
        this.lean,
        this.speed,
        -this.frontBrakeForce,
        this.frontLoad * contact,
        frontMu,
      );
    const ground =
      (inverse ??
        Math.atan((p.wheelbase * lateral) / (v * v)) +
          clamp((GP_ASSIST.feedback * m * (lateral - measured)) / cornering, -0.06, 0.06)) +
      gp.steerTrim;
    return gpBarSteer(ground, this.lean);
  }
  private roadLateralDemand = 0;
  private roadLateralCapacity(frontMu: number, rearMu: number) {
    const p = this.p,
      camber = 1 - 0.18 * Math.max(0, Math.abs(this.lean) - 0.8);
    return (
      Math.min(
        (frontMu * this.frontLoad * p.wheelbase) / (this.mass * p.cgToRear),
        (rearMu * this.rearLoad * p.wheelbase) / (this.mass * p.cgToFront),
      ) * camber
    );
  }
  private roadSteer(stick: number, frontMu: number, rearMu: number) {
    const p = this.p,
      reaction = (this.frontLoad + this.rearLoad) / this.mass,
      cosine = Math.max(0.2, Math.cos(this.lean)),
      capacity = this.roadLateralCapacity(frontMu, rearMu),
      budget = ROAD_ASSIST.recovery * capacity,
      limit = this.supportedRoadLeanLimit,
      target = clamp(clamp(stick, -1, 1) * this.leanLimit, -limit, limit),
      // The rate tracker takes 1/rateGain seconds to answer a new command.
      // Reserve the roll distance travelled during that existing response;
      // otherwise a soft-damped bike can reach a feasible target too fast.
      ahead = this.lean + this.leanRate / ROAD_ASSIST.rateGain,
      error = target - ahead,
      equilibrium = reaction * (Math.tan(this.lean) + this.riderGain()),
      // Integrate the opposing roll moment to the target. Its strength
      // shrinks as the bike leans, so multiplying today's acceleration by
      // the angle left overstates stopping energy under weak support.
      // The rider-offset torque is part of the same road roll plant.
      stoppingEnergy = Math.max(
        0,
        (budget * Math.sign(error) * (Math.sin(target) - Math.sin(ahead)) +
          reaction * (Math.cos(target) - Math.cos(ahead)) -
          reaction * ((this.riderOffset * 0.25) / p.cgHeight) * error) /
          p.cgHeight,
      ),
      rate =
        Math.sign(error) *
        Math.min(
          ROAD_ASSIST.rollGain * Math.abs(error),
          Math.sqrt(2 * stoppingEnergy * ROAD_ASSIST.stopShare),
        ),
      acceleration = ROAD_ASSIST.rateGain * (rate - this.leanRate),
      demand = equilibrium - (p.cgHeight * acceleration) / cosine,
      lateral = clamp(demand, -budget, budget);
    // Keep the uncapped roll-arrest demand for TC/ABS. The tyre's current
    // lack of support must not erase the load needed to arrest that roll.
    this.roadLateralDemand = Math.abs(demand);
    return Math.atan((lateral * p.wheelbase) / (this.speed * this.speed * cosine));
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
    const contacts = this.contactLoads;
    if (contacts) {
      this.frontLoad = Math.max(0, contacts.front);
      this.rearLoad = Math.max(0, contacts.rear);
    }
    const airborne = !!contacts && this.frontLoad + this.rearLoad <= 1e-6;
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
    // The GP roll assist runs above 3 m/s only. Below that the rider steers the
    // bars directly and gpSteer leaves its lean target and roll demand at the
    // last values it computed, which traction control must not treat as live.
    const gpAssistLive = !!(a.lean && this.motoGP && this.speed > 3 && !airborne);
    if (gpAssistLive) steerTarget = this.gpSteer(input.lean, frontMu, rearMu, dt);
    else if (a.lean) {
      // Stable intention: the requested lean is capped by what grip allows.
      // The assist commands the lateral acceleration that makes the lean
      // converge (less than g·tanφ to fall in, more to stand up): this is
      // counter-steering expressed as curvature, then converted to steer.
      const requested = clamp(input.lean, -1, 1) * this.leanLimit,
        limit = this.motoGP ? this.leanLimit : this.supportedRoadLeanLimit,
        target = clamp(requested, -limit, limit);
      // The inverse balance must use the same vertical contact reaction as
      // the roll plant. A landing can support more than mg and a crest less;
      // neither should be mistaken for an unexplained lean disturbance.
      const reaction = contacts && !this.motoGP ? (this.frontLoad + this.rearLoad) / m : G;
      // Never ask the tyres for more than 80% of the friction circle.
      const budget = 0.8 * mu * reaction;
      const lateral = clamp(
        reaction * Math.tan(this.lean) +
          reaction * this.riderGain() -
          G * 2 * (target - this.lean) +
          G * 0.7 * this.leanRate,
        -budget,
        budget,
      );
      const kappa = lateral / (v * v);
      steerTarget = Math.atan((kappa * p.wheelbase) / Math.max(0.2, Math.cos(this.lean)));
      if (contacts && !this.motoGP && this.speed > 5)
        // Enter the sprung high-speed controller continuously above walking
        // pace; its counter-steer must not step when player balance hands off.
        steerTarget = lerp(
          steerTarget,
          this.roadSteer(input.lean, frontMu, rearMu),
          clamp((this.speed - 5) / 3, 0, 1),
        );
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
    // Lean the rider's intended slow turn balances at (0 without the opt-in).
    let balanceLean = 0;
    if (authority < 1 && p.lowSpeedBalance && a.lean && !this.motoGP) {
      const lock = Math.tan(p.maxSteer * 0.9) / p.wheelbase;
      balanceLean =
        clamp(input.lean, -1, 1) * Math.min(this.leanLimit, Math.atan((v * v * lock) / G));
      steerTarget = lerp(
        Math.atan((G * Math.tan(balanceLean) * p.wheelbase) / (v * v)),
        steerTarget,
        authority,
      );
    } else if (authority < 1)
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
    const lateralNow = Math.abs(
        this.motoGP?.lateralAcceleration ?? this.speed * this.speed * this.curvature,
      ),
      // GP traction control keeps the rear's share of the lean assist's
      // recovery reserve, not just today's cornering force: drive that
      // spends the margin leaves nothing to stand the bike up with.
      // The lean itself sets that need (it changes slowly), so the reserve
      // cannot collapse and re-arm the drive within one roll correction.
      // The assist's own target and demand count only while it is running:
      // frozen at their hand-over values they cut the drive of a bike that is
      // slow on low grip, which then never regains the speed that refreshes them.
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
                    gpAssistLive ? Math.abs(this.motoGP.leanTarget) : 0,
                  ),
                ),
              ),
            gpAssistLive ? this.motoGP.lateralDemand : 0,
          ) *
          (GP_ASSIST.recovery / GP_ASSIST.leanMargin)
        : 0,
      // With a sprung road bike, realised curvature can be zero because a
      // tyre just unloaded. Reserving only that force lets the accelerator
      // or front brake keep the contact unloaded, even while a roll needs
      // it back. Keep the intended lean and the uncapped bar correction in
      // the assist budget; only the real contact circles apply tyre force.
      roadReserve =
        contacts && !this.motoGP && this.speed > 5
          ? m *
            Math.max(
              lateralNow,
              a.lean ? this.roadLateralDemand : 0,
              Math.abs((v * v * Math.tan(steerTarget) * Math.cos(this.lean)) / p.wheelbase),
              G *
                (Math.tan(
                  Math.min(
                    1.3,
                    Math.max(
                      Math.abs(this.lean),
                      a.lean ? Math.abs(clamp(input.lean, -1, 1)) * this.roadLeanLimit(1) : 0,
                    ),
                  ),
                ) +
                  Math.abs(this.riderGain())),
            )
          : m * lateralNow,
      rearLatReserve = (this.motoGP ? gpReserve : roadReserve) * (p.cgToFront / p.wheelbase),
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
    if (a.wheelie) {
      const frontNeed = this.motoGP
        ? (gpReserve * (p.cgToRear / p.wheelbase)) / (frontMu * gpCamberFriction(this.lean))
        : (roadReserve * (p.cgToRear / p.wheelbase)) / (0.8 * frontMu);
      const keep = Math.min(staticFront, Math.max((p.wheelieKeep ?? 0.2) * staticFront, frontNeed));
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
    // The sprung adapter supplies the rear-lift threshold from its current
    // pitch geometry. Standalone and MX retain their original upright model.
    // Rear service AND engine braking spend this same total force budget.
    const geometricBrakeLimit =
      a.wheelie && contacts?.rearLiftForce !== undefined
        ? (p.stoppieMargin ?? 0.92) * contacts.rearLiftForce
        : undefined;
    const liftLimit = a.wheelie
      ? Math.max(
          0,
          (geometricBrakeLimit ??
            ((p.stoppieMargin ?? 0.92) * staticRear * p.wheelbase) / p.cgHeight) - rearHeld,
        )
      : Infinity;
    let brakeF = Math.min(liftLimit, p.frontBrake * front) * (v > 0.2 ? 1 : 0);
    // GP cornering ABS keeps each tyre the lateral force of the roll the
    // rider is asking for (trail braking trades stopping for turning), not
    // only the cornering force of the lean it happens to have reached.
    const frontLatAbs = (this.motoGP ? gpReserve : roadReserve) * (p.cgToRear / p.wheelbase),
      rearLatAbs = rearLatReserve;
    if (a.abs) {
      // Cornering ABS: the front stays inside its friction circle, and the
      // weight it takes off the rear leaves the rear its cornering load.
      const rearLatKeep = rearLatAbs / (0.85 * rearMu);
      brakeF = Math.min(
        brakeF,
        0.95 * Math.sqrt(Math.max(0, (frontMu * this.frontLoad) ** 2 - frontLatAbs ** 2)),
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
      // With a sprung chassis this is also an anticipatory ABS bound: do
      // not spend grip that the current brake stroke is about to unload.
      // The initial force clamps above still enforce the actual contact
      // loads, and these bounds only reduce force; they do not replace the
      // suspension's measured normal support.
      const transferRatio = p.cgHeight / p.wheelbase;
      if (rearApplied < 0) {
        const capacity = rearBrakeGrip * Math.max(0, staticRear + frontApplied * transferRatio);
        const coupling = rearBrakeGrip * transferRatio;
        // q² + Fy² = (capacity - coupling*q)². This rationalized
        // positive root remains well conditioned even when coupling ≈ 1.
        const remaining = capacity * capacity - rearLatAbs * rearLatAbs;
        const limit =
          remaining > 0
            ? remaining /
              (capacity * coupling + Math.sqrt(remaining + (coupling * rearLatAbs) ** 2))
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
        const discriminant = capacity * capacity - (1 - coupling * coupling) * frontLatAbs ** 2;
        const limit =
          discriminant > 0
            ? (capacity * coupling + Math.sqrt(discriminant)) / (1 - coupling * coupling)
            : 0;
        frontApplied = Math.max(frontApplied, -limit);
      }
    }
    // A rear-only stroke can itself exceed the geometric bound, especially
    // after a nose-down landing. Clamp the final braking pair as well as the
    // front request; all contact/ABS reductions above remain authoritative.
    if (geometricBrakeLimit !== undefined) {
      const totalBraking = -frontApplied + Math.max(0, -rearApplied);
      if (totalBraking > geometricBrakeLimit) {
        const scale = geometricBrakeLimit / totalBraking;
        frontApplied *= scale;
        if (rearApplied < 0) rearApplied *= scale;
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
      rolling = this.speed > 0.05 && !airborne ? (p.rolling ?? 0) * m * G : 0;
    const ax =
      (rearApplied + frontApplied - dragForce - rolling) / m - (airborne ? 0 : G * this.slope);
    this.longitudinal = ax;
    // Load transfer from the tyres' longitudinal forces (they act at the road,
    // h below the CG; drag and reaction act near the CG): ΔF = Fx·h/L, with
    // loads clamped so they never become negative.
    const transfer = ((rearApplied + frontApplied) * p.cgHeight) / p.wheelbase;
    if (!contacts) {
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
    }
    // The road adapter integrates actual pitch and detects a supported
    // loop-over itself. A flight attitude relative to falling terrain is
    // not an algebraic wheelie/stoppie instability.
    if (!contacts && (this.pitch > 0.75 || this.pitch < -0.4)) return this.fall('highside');
    this.speed = Math.max(0, this.speed + ax * dt);
    // GP prototypes integrate a physically separate contact-patch/yaw state.
    // The shared car and off-road solvers never enter this code path.
    const flightYaw = this.motoGP?.yawRate ?? 0,
      flightSideSpeed = this.motoGP?.lateralSpeed ?? 0;
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
        (contacts ? 1 : gpFrontSteeringContact(this.pitch, p.wheelbase)),
      frontBrakeExcess: a.abs ? 0 : Math.max(0, p.frontBrake * front - this.frontBrakeForce),
      rearDriveExcess: a.traction || a.wheelie ? 0 : Math.max(0, requested - drive),
      rearBrakeExcess: a.abs ? 0 : Math.max(0, brakeR - this.rearBrakeForce),
      inertialContacts: !!contacts,
    });
    if (gp && airborne) {
      // The GP single-wheel controller clears these when its front contact
      // disappears. With BOTH contacts absent, yaw and lateral momentum
      // instead persist; wheel rotation still advances in its contact solve.
      gp.yawRate = flightYaw;
      const turn = flightYaw * dt,
        forward = this.speed;
      this.speed = forward * Math.cos(turn) + flightSideSpeed * Math.sin(turn);
      gp.lateralSpeed = flightSideSpeed * Math.cos(turn) - forward * Math.sin(turn);
    } else if (gp && contacts) {
      this.speed = gp.forwardSpeed;
      this.longitudinal += gp.longitudinalCorrection;
    }
    // --- Roll balance: reaction vs tyre-generated lateral acceleration.
    const kappa = this.curvature;
    const lateralAccel = gp ? gp.lateralAcceleration : this.speed * this.speed * kappa;
    const h = p.cgHeight;
    // Low-speed balance assist (explicit, §8.3): below walking pace the rider
    // supports the bike, so lean is held near upright instead of toppling.
    const support = a.lean && !airborne ? 1 - clamp((this.speed - 1) / 4, 0, 1) : 0;
    // Gravity acts through the CG. The contact's vertical reaction, applied
    // below and to the side of that CG, supplies the overturning moment.
    // N = mg only in steady support: retaining mg through a crest while
    // lateral force falls with N created a roll impulse just before lift.
    // The sprung model must approach zero moment continuously; the isolated
    // research/MX cores retain their original steady-support approximation.
    const contactGravity = contacts ? (this.frontLoad + this.rearLoad) / m : G;
    if (airborne) {
      // Gravity acts through the free CG. The supported roll controller and
      // its wheel/contact-line gyroscopic balance have no road pivot here;
      // conserve roll motion until touchdown, including the rider's internal
      // hang-off displacement, instead of manufacturing an airborne lean.
      this.lean += this.leanRate * dt;
      if (gp) this.lean += gpHangOffAngle(offsetBefore, h) - gpHangOffAngle(this.riderOffset, h);
    } else if (gp) {
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
        (m * h * (contactGravity * Math.sin(psi) - lateralAccel * Math.cos(psi)) -
          spin * gp.yawRate * Math.cos(this.lean) -
          frontSpin * steerRate * Math.cos(GP_RAKE)) /
        inertia;
      this.leanRate += (rollAccel - support * (psi * 40 + this.leanRate * 10)) * dt;
      this.leanRate *= Math.exp(-(p.rollDamping ?? 1.2) * dt);
      this.lean = psi + this.leanRate * dt - gpHangOffAngle(this.riderOffset, h);
    } else {
      const rollAccel =
        (contactGravity * Math.sin(this.lean) - lateralAccel * Math.cos(this.lean)) / h +
        ((contactGravity * this.riderOffset) / (h * h)) * 0.25;
      this.leanRate +=
        (rollAccel - support * ((this.lean - balanceLean) * 40 + this.leanRate * 10)) * dt;
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
    // Canonicalize only floating-point roundoff at the exact friction-circle
    // boundary (hypot/sqrt can return 1 + 2e-16 for an exactly limited pair).
    // Genuine overloads remain unbounded for the failure/telemetry model.
    this.frontUse = Math.abs(frontUse - 1) < 1e-12 ? 1 : frontUse;
    this.rearUse = Math.abs(rearUse - 1) < 1e-12 ? 1 : rearUse;
    this.lateralUse = Math.max(this.frontUse, this.rearUse);
    const grace = p.gripFallGrace ?? 0;
    if (grace > 0) {
      // Sustained overload only: the allowance is spent in proportion to how
      // far past the circle the worse tyre is, and recovers once both hold.
      const excess =
        this.speed > 3
          ? Math.max(
              frontUse - 1.08,
              rearApplied <= 0 ? rearCorneringUse - 1.45 : Number.NEGATIVE_INFINITY,
            )
          : Number.NEGATIVE_INFINITY;
      if (excess > 0) {
        this.gripOver += dt * (1 + 4 * excess);
        if (this.gripOver > grace) return this.fall('lowside');
      } else this.gripOver = Math.max(0, this.gripOver - 2 * dt);
    } else if (frontUse > 1.08 && this.speed > 3) return this.fall('lowside');
    if (rearCorneringUse > 1.15 && this.speed > 3) {
      this.rearSlip += rearCorneringUse - 1;
      // Under power a sliding rear that bites throws the rider (highside);
      // a rear sliding on the brakes steps out, and only a gross slide falls.
      if (rearApplied > 0 && this.rearSlip > 0.6) return this.fall('highside');
      if (grace <= 0 && rearApplied <= 0 && rearCorneringUse > 1.45) return this.fall('lowside');
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
    this.gripOver = 0;
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
