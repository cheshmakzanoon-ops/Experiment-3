import { clamp, G, lerp, mod, Quat, Vec3 } from '../core/math.ts';
import {
  AIDriver,
  ENVELOPE_SAMPLES,
  ENVELOPE_STEP,
  envelopeCornerSpeed,
  envelopeProfile,
} from './ai.ts';
import { leanAuthority } from './bike.ts';
import { BikeVehicle } from './bike-vehicle.ts';
import type { RaceDirector } from './race.ts';
import { pitPreparationDistance } from './pit-safety.ts';
import { racingLineFor } from './racing-line.ts';
import { trackPoint, type Track } from './track.ts';
import type { PassPace } from './traffic.ts';
import type { Vehicle } from './vehicle.ts';

/** Bounded GP preview work: at most 1,524 m at the shared 12 m spacing. */
export const GP_APPROACH_SAMPLES = 128;

/** A departing GP rider merges from its stopped bay over distance. Cubic
 * easing has peak slope 1.5 * displacement / length, so these bounds leave
 * the low-speed balance controller time to straighten before the fast lane.
 * These are planner limits, not measured motorcycle coefficients. */
export const GP_PIT_DEPARTURE = Object.freeze({ minimumDistance: 20, maxSlope: 0.2 });

/** Bike rider AI (WP35). The shared race-craft layers (strategy, traffic,
 * racing line, pit approach, flags, capability-envelope speed targets) are
 * the AIDriver's; the bike's own `VehicleDefinition.ai` envelope makes those
 * targets lean-limited. Only the steering contract differs: the path
 * curvature the line follower wants is converted into the lean intent the
 * rider aid tracks (tan φ = v²κ/g), with direct bar steering at walking pace.
 * While the rider is down the bike receives no commands. */
export class BikeAIDriver extends AIDriver {
  private readonly savedOrientation = new Quat();
  private readonly savedPosition = new Vec3();
  private readonly preview = trackPoint();
  private readonly ahead = trackPoint();
  private pitCorridor = false;
  private passingScale = 1;
  private pitDeparture = false;
  private pitDepartureS = 0;
  private pitDepartureLateral = 0;
  private readonly approachCurvatures = new Float64Array(GP_APPROACH_SAMPLES);
  private readonly approachCorners = new Float64Array(GP_APPROACH_SAMPLES);
  private readonly approachProfile = new Float64Array(GP_APPROACH_SAMPLES);
  /** Planned speed one sample ahead and the stoppie-limited deceleration, set by
   * the GP approach plan on the step it ran (NaN otherwise). */
  protected planNext = NaN;
  /** The GP approach plan's speed limit on the step it ran (Infinity otherwise). */
  private planLimit = Infinity;
  /** Distance (m) along the approach plan to where it first asks the rider to brake
   * (Infinity: not within the plan's horizon, or no plan on this step). */
  private planRunway = Infinity;
  private readonly pace: PassPace = { topSpeed: 0, freeSpeed: 0, runway: 0, laneRate: 0 };
  private planBrake = 0;
  protected override readonly reverseRecovery = false;
  constructor(
    readonly bike: BikeVehicle,
    skill = 0.96,
    seed = 73021,
  ) {
    super(bike, skill, seed);
  }
  private get isGp() {
    return this.bike.definition.id === 'gpr1' || this.bike.definition.id === 'gpr2';
  }
  override update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    // A rider-down update can return before the shared planner runs.
    this.trafficRefreshed = false;
    const c = this.bike,
      d = c.dynamics,
      command = c.input;
    if (c.definition.id === 'gpr1' || c.definition.id === 'gpr2') {
      // Keep the actual settled position, including a legal stop before the
      // box centre. Missing the box never arms a service-bay departure.
      if (c.inPit && c.pitPhase >= 2 && c.pitPhase <= 5 && c.riding) {
        this.pitDeparture = true;
        this.pitDepartureS = c.s;
        this.pitDepartureLateral = c.lateral;
      } else if (!c.inPit || c.pitPhase !== 6 || !c.riding) this.pitDeparture = false;
    }
    if (!c.riding) {
      command.throttle = 0;
      command.brake = 0;
      command.steer = 0;
      command.clutch = 0;
      command.reverse = false;
      c.aiTarget = 0;
      this.decision = d.state === 'remount' ? 'REMOUNTING' : 'RIDER DOWN';
      return;
    }
    this.passingScale = gpPassingLateralScale(c, track, cars);
    // The line follower measures the path in the ground frame at the tyres'
    // contact line: a lean must not rotate its target, nor the CG's inward
    // offset bias it toward the apex.
    const body = c.body;
    this.savedOrientation.x = body.orientation.x;
    this.savedOrientation.y = body.orientation.y;
    this.savedOrientation.z = body.orientation.z;
    this.savedOrientation.w = body.orientation.w;
    this.savedPosition.copy(body.position);
    body.orientation.yaw(d.heading);
    body.position.set(d.x, body.position.y, d.z);
    try {
      super.update(dt, track, cars, race);
    } finally {
      body.orientation.x = this.savedOrientation.x;
      body.orientation.y = this.savedOrientation.y;
      body.orientation.z = this.savedOrientation.z;
      body.orientation.w = this.savedOrientation.w;
      body.position.copy(this.savedPosition);
    }
    command.reverse = false;
    command.clutch = 0;
    command.steer = this.steerIntent(track, command.steer);
    if (this.isGp) {
      // A GP lever's travel past the stoppie point adds no stopping force, only
      // a locking, near-weightless rear wheel that fishtails under the smallest
      // steering correction; even short of it a rear carrying a quarter of its
      // static load cannot follow a lean change. The rider stays inside that.
      if (d.speed > 5)
        command.brake = Math.min(command.brake, GP_AI_HANDS.leverShare * this.leverAtLimit());
      this.gpPedals(dt);
    }
    c.aiControlled();
  }
  private lastThrottle = 0;
  private lastBrake = 0;
  /** A GP rider's hands, not a car's pedals: the lever is squeezed on over
   * ~0.12 s and eased off over ~0.25 s, the throttle rolls open over ~0.4 s,
   * and never while the bike is sliding sideways (sideslip above ~2°): a
   * light, sliding rear that is suddenly loaded snaps the bike's yaw. These
   * are authored rider-skill rates; the physics alone decides what happens. */
  private gpPedals(dt: number) {
    const c = this.bike,
      command = c.input,
      gp = c.dynamics.motoGP,
      slip = gp ? Math.abs(Math.atan2(gp.lateralSpeed, Math.max(5, c.dynamics.speed))) : 0;
    // Off the line the rider is committed: the front is up and the traction control
    // is the limit, not the hands (a 4 s start was 10 m behind a superbike's).
    const launch = c.dynamics.speed < GP_AI_HANDS.launchSpeed;
    const brake = clamp(
      command.brake,
      this.lastBrake - (launch ? GP_AI_HANDS.launchRate : GP_AI_HANDS.brakeRelease) * dt,
      this.lastBrake + GP_AI_HANDS.brakeApply * dt,
    );
    let throttle = Math.min(
      command.throttle,
      this.lastThrottle + (launch ? GP_AI_HANDS.launchRate : GP_AI_HANDS.throttleOpen) * dt,
    );
    throttle = Math.min(throttle, 1 - clamp((slip - 0.035) / 0.05, 0, 0.85));
    // Still on the lever: the throttle stays shut until it is released.
    if (brake > 0.05) throttle = Math.min(throttle, 0.05);
    command.brake = this.lastBrake = brake;
    command.throttle = this.lastThrottle = throttle;
  }
  protected override pitLine(track: Track, s: number) {
    const lane = super.pitLine(track, s);
    if (!this.pitDeparture || !this.bike.inPit || this.bike.pitPhase !== 6) return lane;
    const displacement = this.pitDepartureLateral - super.pitLine(track, this.pitDepartureS);
    const length = Math.max(
      GP_PIT_DEPARTURE.minimumDistance,
      (1.5 * Math.abs(displacement)) / GP_PIT_DEPARTURE.maxSlope,
    );
    const distance =
      mod(s - this.pitDepartureS + track.length / 2, track.length) - track.length / 2;
    const progress = clamp(distance / length, 0, 1);
    // The same curve supplies pursuit, queue clearance, and the recorded
    // AI target. It does not move the bike or override a traffic speed cap.
    return lane + displacement * (1 - progress * progress * (3 - 2 * progress));
  }
  /** Path tracking for a leaning vehicle (WP35): a car's pure pursuit cuts
   * corners and over-corrects when the lean must change before the path can.
   * The bike follows the lane the line follower chose (same tactical offset
   * from the racing line) with the path's own curvature, previewed by the lean
   * response time, plus a critically damped correction of lateral and heading
   * error. The pit approach and the pit lane are absolute corridors (as for
   * cars); at walking pace the car-style command is converted directly. */
  private steerIntent(track: Track, steer: number) {
    const c = this.bike,
      d = c.dynamics;
    if (d.speed < 6) return leanIntent(c, steer);
    // Mirror the line follower's pit-approach latch (same inputs, same rule).
    const entryGap = mod(track.pitEntryS() - c.s, track.length);
    if (!c.pitRequested || c.inPit || entryGap > track.length - 20) this.pitCorridor = false;
    else if (entryGap < pitPreparationDistance(c.speed, c.lateral, track.pit.side * 6))
      this.pitCorridor = true;
    const v = d.speed,
      near = clamp(6 + c.speed * 0.48, 8, 46),
      absolute = c.inPit || this.pitCorridor;
    const tactical = absolute ? 0 : c.aiOffset - this.steeringLineOffset(track, c.s + near);
    const p = track.at(c.s, this.preview);
    const reach = Math.max(1, p.width - 1.4);
    const target = absolute
      ? c.aiOffset
      : clamp(this.steeringLineOffset(track, c.s) + tactical, -reach, reach);
    const pathSlope = absolute
      ? c.inPit
        ? (track.pitOffset(c.s + 3) - track.pitOffset(c.s - 3)) / 6
        : 0
      : (this.steeringLineOffset(track, c.s + 3) - this.steeringLineOffset(track, c.s - 3)) / 6;
    const slope = pathSlope / Math.max(0.5, 1 - p.curvature * target);
    // GP chassis: the path follows the velocity, which slips a degree or two
    // from the chassis heading in a corner; track the course, not the nose.
    const course = d.heading + (d.motoGP ? Math.atan2(d.motoGP.lateralSpeed, Math.max(v, 1)) : 0);
    const heading = mod(course - Math.atan2(p.tx, p.tz) + Math.PI, Math.PI * 2) - Math.PI;
    const error = target - c.lateral,
      headingError = Math.atan(slope) - heading;
    // Feed-forward: the lane's curvature where the bike will be once it has leaned.
    const ahead = c.s + v * BIKE_AI.preview;
    const k = absolute
      ? track.at(ahead, this.ahead).curvature
      : this.steeringLineCurvature(track, ahead);
    const feedForward = k / Math.max(0.5, 1 - k * (absolute ? target : tactical));
    const w = BIKE_AI.bandwidth;
    // Corrections are gentle: their lateral acceleration is bounded, so a
    // lane error never asks for a full-lean swerve on a straight.
    // Wet contact needs gentler recovery than the calibrated dry line follower:
    // a dry-sized correction consumes the slick's remaining lateral grip and
    // sends the next correction to the opposite steering stop.
    const wetContact = Math.max(c.contacts[0].water, c.contacts[2].water) > 0.01;
    const correctionG =
      d.motoGP && wetContact ? BIKE_AI.correctionG * clamp(d.grip, 0.15, 1) : BIKE_AI.correctionG;
    const correction = clamp(
      (w * w * error) / (v * v) + (2 * BIKE_AI.damping * w * headingError) / v,
      (-correctionG * G) / (v * v),
      (correctionG * G) / (v * v),
    );
    return leanFromCurvature(c, feedForward + correction, steer);
  }
  /** The lane used by the lean tracker. Venue riders can choose a different
   * path; its slope and feed-forward must agree with the path planner. The
   * default preserves the road-bike racing line and its solved curvature. */
  protected steeringLineOffset(track: Track, s: number) {
    return racingLineFor(track).offsetAt(s);
  }
  protected steeringLineCurvature(track: Track, s: number) {
    return racingLineFor(track).curvatureAt(s);
  }
  /** A GP straight can require far more than the shared 240 m brake preview.
   * At 300+ km/h, waiting until a hairpin enters that fixed window leaves the
   * rider over-speed at turn-in, where ABS must give cornering priority. Solve
   * the same normal-pedal profile over the current conservative stop distance
   * plus the rider's lean response. The shared traffic/flag/pit target can only
   * be lowered. Per-wheel grip and physical crash limits remain authoritative. */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    void race;
    const c = this.bike,
      d = c.dynamics;
    this.planNext = NaN;
    this.planLimit = Infinity;
    this.planRunway = Infinity;
    if (
      (c.definition.id !== 'gpr1' && c.definition.id !== 'gpr2') ||
      c.inPit ||
      this.pitCorridor ||
      !c.riding ||
      !Number.isFinite(d.speed + d.grip + c.lateral + d.heading) ||
      Math.abs(c.lateral) > c.trackPosition.width ||
      Math.sin(d.heading) * c.trackPosition.tx + Math.cos(d.heading) * c.trackPosition.tz < 0.5
    )
      return desired;
    const env = c.definition.ai,
      near = clamp(6 + c.speed * 0.48, 8, 46),
      tactical = c.aiOffset - this.steeringLineOffset(track, c.s + near),
      wetness = clamp(Math.max(c.contacts[0].water, c.contacts[2].water) / 0.8, 0, 1),
      // The less capable contact constrains approach planning even when the
      // intact wheel can still provide useful drive or brake force.
      grip =
        clamp(Math.min(d.grip, d.frontGrip ?? d.grip, d.rearGrip ?? d.grip), 0.1, 1) *
        (1 - 0.15 * wetness) *
        clamp(1 - (0.25 * Math.max(0, Math.abs(tactical) - 1.5)) / 6, 0.8, 1),
      aero =
        ((0.45 + 0.55 * Math.min(c.frontHealth, c.floorHealth)) *
          env.downforceReference *
          (1 - 0.3 * c.wake)) /
        (c.spec.dryMass + c.fuel),
      count = gpApproachSampleCount(
        d.speed,
        env.brakingBase * grip * env.brakingMargin,
        track.length,
      );
    // The GP lever ramps to full pressure rather than applying instantly.
    // Reserve the mean half-rise travel before the solved braking profile.
    // Otherwise the planner promises deceleration the rider cannot yet supply.
    const leverResponseDistance = d.speed / (2 * GP_AI_HANDS.brakeApply);
    for (let i = 0; i < count; i++) {
      const k = this.steeringLineCurvature(track, c.s + leverResponseDistance + i * ENVELOPE_STEP),
        curvature = k / Math.max(0.5, 1 - k * tactical);
      this.approachCurvatures[i] = Math.abs(curvature);
      this.approachCorners[i] = envelopeCornerSpeed(curvature, grip, aero, env) * this.skill;
    }
    const planned = envelopeProfile(
      this.approachCurvatures,
      this.approachCorners,
      grip,
      aero,
      env,
      count,
      this.approachProfile,
    );
    this.planNext = count > 1 ? this.approachProfile[1] : planned;
    this.planLimit = planned;
    for (let i = 1; i < count; i++)
      if (this.approachProfile[i] < d.speed - 1) {
        this.planRunway = i * ENVELOPE_STEP;
        break;
      }
    this.planBrake = Math.max(
      0.5,
      env.brakingBase * grip + env.brakingAero * aero * d.speed * d.speed,
    );
    return Math.min(desired, planned);
  }
  protected override brakeDemand(error: number) {
    let proportional = super.brakeDemand(error);
    // After the flag the slow-down is a cool-down, not a stop to a plan.
    if (this.bike.finishTime > 0 && this.isGp)
      proportional = Math.min(proportional, GP_AI_HANDS.cooldownBrake);
    const v = this.bike.dynamics.speed;
    if (!(v > this.planNext)) return proportional;
    // The deceleration the plan asks for, as a share of the stoppie-limited
    // stop, is the same share of the lever travel that reaches that limit.
    const required = (v * v - this.planNext * this.planNext) / (2 * ENVELOPE_STEP);
    return clamp(Math.max(proportional, (required / this.planBrake) * this.leverAtLimit()), 0, 1);
  }
  /** Lever travel at which the front brake reaches the stoppie limit (more
   * travel adds no force, only the rear's unloading). */
  private leverAtLimit() {
    const d = this.bike.dynamics,
      p = d.p,
      v = d.speed,
      rearDown = (p.downforce ?? 0) * v * v * (1 - (p.downforceFront ?? 0.6)),
      staticRear = (d.mass * G * p.cgToFront) / p.wheelbase + rearDown,
      liftForce = ((p.stoppieMargin ?? 0.92) * staticRear * p.wheelbase) / p.cgHeight;
    // Combined brakes send 78% of the lever to the front caliper.
    return clamp(liftForce / (p.frontBrake * 0.78), 0.05, 1);
  }
  /** Upright GP machines can use a motorcycle-sized passing lane. The
   * footprint expands before a corner and for a leaning nearby rider;
   * stopping distance, yellow flags and the swept collision tests stay in
   * the shared planner. Off-road riders retain their own override. */
  protected override trafficScale() {
    return this.passingScale;
  }
  /** A GP rider moves across quickly only to get past a slower rider on a straight. */
  protected override laneRate() {
    return this.isGp && this.planner.blocker >= 0 ? GP_AI_HANDS.laneRate : super.laneRate();
  }
  /** A GP rider is quicker than the other classes only where it can accelerate: its
   * free speed, held down by its own braking plan, and how far the racing line
   * stays straight ahead (traffic.ts PASS_PACE). */
  protected override passPace(track: Track) {
    // No passing on the cool-down lap after the flag.
    if (!this.isGp || this.bike.finishTime > 0) return null;
    const line = racingLineFor(track),
      pace = this.pace;
    let runway = 0;
    while (
      runway < GP_AI_HANDS.runwayMax &&
      Math.abs(line.curvatureAt(this.bike.s + runway)) < GP_AI_HANDS.straightCurvature
    )
      runway += GP_AI_HANDS.runwayStep;
    pace.topSpeed = this.bike.definition.ai.topSpeed;
    pace.freeSpeed = Math.min(this.freeSpeed, this.planLimit);
    // The straight, and the plan's own braking point if that comes first.
    pace.runway = Math.min(runway, this.planRunway);
    pace.laneRate = GP_AI_HANDS.laneRate;
    return pace;
  }
  protected override trafficTrackingMargin() {
    // A narrow upright GP lane left only ~0.35 m beyond the follow corridor.
    // Finite lean response kept the rider inside it, matching the slower
    // target forever. Ask for more lateral room, not less stopping distance.
    // Mixed-class and full-lean corridors retain their established behavior.
    return this.passingScale < 1 ? 1 : 0;
  }
}

/** GP racecraft tuning, expressed in the shared planner's car-width units.
 * The upright floor reserves 1.93 m lateral separation (2.75 × 0.7), rather
 * than asking a 0.74 m wide GP machine for a 3.5 m lane change. Full cornering
 * lean restores the original corridor for the chassis and hanging-off rider.
 * This only narrows lateral room; it never cuts longitudinal safety margins. */
export function gpPassingLateralScale(c: BikeVehicle, track: Track, cars: readonly Vehicle[]) {
  if (c.definition.id !== 'gpr1' && c.definition.id !== 'gpr2') return 1;
  // Mixed-class grids have different widths, braking points and approach
  // speeds. Keep their established shared corridor instead of giving just
  // the GP riders a more permissive plan than the bikes beside them.
  if (cars.some((other) => other.definition.id !== 'gpr1' && other.definition.id !== 'gpr2'))
    return 1;
  const d = c.dynamics,
    line = racingLineFor(track);
  let lean = Math.max(Math.abs(d.lean), Math.abs(c.input.steer) * d.leanLimit);
  // A passing commitment lasts three seconds. Reserve the wider corridor
  // before the braking/turn-in sequence, not after the rider is already down
  // on one knee. Current speed is conservative when a braking zone is ahead.
  for (let t = 1; t <= 3; t++) {
    const k = Math.abs(line.curvatureAt(c.s + d.speed * t));
    lean = Math.max(lean, Math.min(d.leanLimit, Math.atan((d.speed * d.speed * k) / G)));
  }
  for (const other of cars) {
    if (other === c || other.inPit !== c.inPit || !(other instanceof BikeVehicle)) continue;
    const gap = mod(other.s - c.s + track.length / 2, track.length) - track.length / 2;
    if (Math.abs(gap) < 180) lean = Math.max(lean, Math.abs(other.dynamics.lean));
  }
  const turning = clamp((lean - 0.15) / 0.6, 0, 1);
  return lerp(0.7, 1, turning * turning * (3 - 2 * turning));
}
/** GP AI input rates (per second): lever apply/release, throttle opening. */
export const GP_AI_HANDS = Object.freeze({
  brakeApply: 8,
  brakeRelease: 4,
  throttleOpen: 2.5,
  /** Lever release and throttle opening rates (per second) below `launchSpeed` (m/s). */
  launchRate: 8,
  launchSpeed: 12,
  /** Lever ceiling once the flag has fallen: a cool-down, not a stop to a plan. */
  cooldownBrake: 0.2,
  /** Share of the stoppie-point lever travel a rider will use (keeps rear load). */
  leverShare: 0.75,
  /** Lateral speed (m/s) of a GP rider's lane change (a car's is 1.6). */
  laneRate: 2,
  /** The racing line is a straight while its curvature (1/m) is below this: a GP
   * corner speed at that radius is already under 0.8 of its top speed. */
  straightCurvature: 0.0028,
  /** Straight-measuring step and ceiling (m). */
  runwayStep: 24,
  runwayMax: 720,
});
/** Bike path-tracking gains: preview (s), bandwidth (rad/s), damping ratio. */
export const BIKE_AI = Object.freeze({
  preview: 0.3,
  bandwidth: 1.2,
  damping: 0.9,
  /** Lateral acceleration a lane correction may use (g). */
  correctionG: 0.6,
});
/** Number of existing 12 m envelope samples needed to see a conservative
 * full stop, ignoring helpful aero drag, plus the lean response distance.
 * Cap at one circuit and fixed scratch capacity, including for invalid or
 * vanishing grip estimates; no time-dependent cache or view allocations. */
export function gpApproachSampleCount(speed: number, deceleration: number, trackLength: number) {
  const v = Number.isFinite(speed) ? clamp(speed, 0, 120) : 0;
  const braking = Number.isFinite(deceleration) ? Math.max(0.5, deceleration) : 0.5;
  const distance = (v * v) / (2 * braking) + v * BIKE_AI.preview;
  const circuitSamples = Number.isFinite(trackLength)
    ? Math.max(2, Math.floor(Math.max(0, trackLength) / ENVELOPE_STEP) + 1)
    : GP_APPROACH_SAMPLES;
  return Math.min(
    GP_APPROACH_SAMPLES,
    circuitSamples,
    Math.max(ENVELOPE_SAMPLES, Math.ceil(distance / ENVELOPE_STEP) + 1),
  );
}
/** Lean intent for a path curvature (tan φ = v²κ/g, less the hang-off share). */
export function leanFromCurvature(c: BikeVehicle, kappa: number, steer: number) {
  const d = c.dynamics,
    lean = Math.atan((d.speed * d.speed * kappa) / G);
  const fast = clamp(lean / Math.max(0.1, d.leanLimit), -1, 1);
  return lerp(slowIntent(c, steer), fast, leanAuthority(d.speed));
}
function slowIntent(c: BikeVehicle, steer: number) {
  const speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
  return clamp((steer * c.spec.maxSteer * speedSteer) / (c.dynamics.p.maxSteer * 0.5), -1, 1);
}
/** Convert a car-style steering command (pure-pursuit fraction of the speed-
 * scaled lock) into the bike's lean intent. */
export function leanIntent(c: BikeVehicle, steer: number) {
  const d = c.dynamics,
    speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1,
    delta = steer * c.spec.maxSteer * speedSteer,
    kappa = Math.tan(delta) / c.spec.wheelbase,
    lean = Math.atan((d.speed * d.speed * kappa) / G);
  const fast = clamp(lean / Math.max(0.1, d.leanLimit), -1, 1),
    slow = clamp(delta / (d.p.maxSteer * 0.5), -1, 1);
  return lerp(slow, fast, leanAuthority(d.speed));
}
/** The AI driver for an entrant's family. */
export function createDriver(car: Vehicle, skill: number, seed: number): AIDriver {
  return car instanceof BikeVehicle
    ? new BikeAIDriver(car, skill, seed)
    : new AIDriver(car, skill, seed);
}
