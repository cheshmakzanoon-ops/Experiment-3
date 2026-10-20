import type { Setup } from './config.ts';

/** Per-corner suspension (docs/production/PHYSICS_MODEL.md §2).
 *
 * Each corner is a massless hub between the chassis and the tyre: the
 * suspension (progressive spring, bump stop, bump/rebound damper with a
 * low/high-speed knee, anti-roll bar) acts on hub travel x, the tyre's radial
 * stiffness and damping on the normal deflection c_n·(X − x), where X is
 * geometric compression along the suspension axis and c_n = up·roadNormal.
 * Holding that contact normal over a substep, the axis force balance is
 *     c_n²·[k_t·(X − x) + c_t·(Ẋ − ẋ)] = F_spring(x) + F_bump(x) + F_damper(ẋ) + k_arb·(x − x_other) + Q
 * is solved with backward Euler and a coupled two-corner Newton solve for
 * each axle. Tyres push only, and mechanical droop stops carry an extension
 * reaction. A convex-work line search resolves the changing contact, damper
 * and stop branches without an ordered left/right force imbalance.
 *
 * Setup springs, bars and the definition's damper values are RIDE values at
 * the contact patch (wheel and tyre in series, as a seven-post rig measures
 * them); hub hardware rates are derived at the tyre's nominal stiffness, so
 * quasi-static ride heights, roll and pitch reproduce the former model. The
 * tyre's pressure-dependent stiffness then changes them physically.
 *
 * Geometry: camber gain and bump steer per metre of hub travel. Load
 * transfer: tread forces enter the chassis at the vehicle's link-centre
 * height above the patch (VehicleSpec.linkCentreHeight), the calibrated
 * correction between the rigid body's reference point and the effective
 * roll/pitch mass centre that keeps total load transfer at its calibrated
 * value. Roll-centre height and side-view anti geometry then split that
 * transfer into an elastic share (springs/bars: body roll and pitch) and a
 * geometric share that the links put straight into the tyre loads. The
 * chassis-up generalized load Q = −(h_rc/y)·Fy − tanθ·Fx·sign(z) pushes down
 * on the hub and participates in this same radial force balance. This divides
 * the modeled transfer between
 * elastic and link paths; unequal outer/inner forces also jack the body.
 * Zero heights reproduce the former, purely elastic transfer. */
export interface DamperCurve {
  /** Low-speed ride damping at the contact patch (N s/m), bump and rebound. */
  readonly bump: number;
  readonly rebound: number;
  /** Knee speeds (m/s at the contact patch) and high-speed slope ratios
   * (below 1 is digressive: kerbs are absorbed rather than transmitted). */
  readonly bumpKnee: number;
  readonly reboundKnee: number;
  readonly bumpHighRatio: number;
  readonly reboundHighRatio: number;
}
export interface AxleSuspension {
  /** Spring rate rises by this fraction of its base over the axle's travel. */
  readonly progression: number;
  /** Bump rubber engages at this total compression (m), quadratic rate N/m². */
  readonly bumpStopGap: number;
  readonly bumpStopRate: number;
  /** Extension limit below the static rest length (m). */
  readonly droop: number;
  readonly damper: DamperCurve;
  /** Negative camber gained per metre of hub bump travel (rad/m). */
  readonly camberGain: number;
  /** Toe-in gained per metre of hub bump travel (rad/m). */
  readonly bumpSteer: number;
  /** Roll-centre height (m) at static ride, and its change per metre of mean
   * axle travel (negative: the roll centre drops as the car squats). */
  readonly rollCentreHeight: number;
  readonly rollCentreGain: number;
  /** Side-view force-line slopes tanθ for braking and driving forces. */
  readonly antiBrake: number;
  readonly antiDrive: number;
}
export interface SuspensionDefinition {
  readonly front: AxleSuspension;
  readonly rear: AxleSuspension;
}
/** Ride damping and stops of the former model (4800 bump / 6200 rebound,
 * 1.8e6 N/m² stop at 0.13 m), now with a digressive high-speed knee. */
const RIDE_DAMPER: DamperCurve = Object.freeze({
  bump: 4800,
  rebound: 6200,
  bumpKnee: 0.2,
  reboundKnee: 0.25,
  bumpHighRatio: 0.55,
  reboundHighRatio: 0.7,
});
/** Default axles reproduce the former model (no camber gain, purely elastic
 * load transfer, linear springs) apart from the damper knee; overrides add
 * a vehicle's geometry. */
export function defaultSuspension(
  overrides: { front?: Partial<AxleSuspension>; rear?: Partial<AxleSuspension> } = {},
): SuspensionDefinition {
  const axle = (camberGain: number): AxleSuspension => ({
    progression: 0,
    bumpStopGap: 0.13,
    bumpStopRate: 1.8e6,
    droop: 0.05,
    damper: RIDE_DAMPER,
    camberGain,
    bumpSteer: 0,
    rollCentreHeight: 0,
    rollCentreGain: 0,
    antiBrake: 0,
    antiDrive: 0,
  });
  return Object.freeze({
    front: Object.freeze({ ...axle(0), ...overrides.front }),
    rear: Object.freeze({ ...axle(0), ...overrides.rear }),
  });
}
/** Hub hardware for one corner, derived from ride values and the tyre. */
export interface CornerHardware {
  wheelRate: number;
  barRate: number;
  progression: number;
  travel: number;
  stopGap: number;
  stopRate: number;
  droop: number;
  bump: number;
  rebound: number;
  bumpKnee: number;
  reboundKnee: number;
  bumpHigh: number;
  reboundHigh: number;
  tyreRate: number;
  tyreDamping: number;
  camberGain: number;
  bumpSteer: number;
}
/** Series inversion: hub rate that, in series with the tyre, gives `ride`. */
export function hubRate(ride: number, tyre: number) {
  return (ride * tyre) / Math.max(tyre - ride, 0.2 * tyre);
}
export function resolveCorner(
  axle: AxleSuspension,
  spring: number,
  bar: number,
  tyreRate: number,
  tyreDamping: number,
  travel: number,
): CornerHardware {
  const wheelRate = hubRate(spring, tyreRate),
    // Roll rate per wheel (spring + two bar halves) is matched the same way.
    rollRate = hubRate(spring + 2 * bar, tyreRate),
    barRate = Math.max(0, (rollRate - wheelRate) / 2),
    // Low-frequency share of contact motion taken by the hub.
    share = tyreRate / (tyreRate + wheelRate),
    damping = 1 / (share * share);
  return {
    wheelRate,
    barRate,
    progression: axle.progression,
    travel,
    stopGap: axle.bumpStopGap * share,
    stopRate: axle.bumpStopRate * damping,
    droop: axle.droop,
    bump: axle.damper.bump * damping,
    rebound: axle.damper.rebound * damping,
    bumpKnee: axle.damper.bumpKnee * share,
    reboundKnee: axle.damper.reboundKnee * share,
    bumpHigh: axle.damper.bump * damping * axle.damper.bumpHighRatio,
    reboundHigh: axle.damper.rebound * damping * axle.damper.reboundHighRatio,
    tyreRate,
    tyreDamping,
    camberGain: axle.camberGain,
    bumpSteer: axle.bumpSteer,
  };
}
/** Hardware for the four corners (FR, FL, RR, RL) from a setup. */
export function resolveSuspension(
  def: SuspensionDefinition,
  setup: Setup,
  tyreRate: number,
  tyreDamping: number,
  travel: number,
): CornerHardware[] {
  const front = resolveCorner(
      def.front,
      setup.frontSpring,
      setup.frontARB,
      tyreRate,
      tyreDamping,
      travel,
    ),
    rear = resolveCorner(def.rear, setup.rearSpring, setup.rearARB, tyreRate, tyreDamping, travel);
  return [front, { ...front }, rear, { ...rear }];
}
/** Damper force (N, + resisting bump) at hub velocity v (+ bump). */
export function damperForce(h: CornerHardware, v: number) {
  if (v >= 0)
    return v <= h.bumpKnee ? h.bump * v : h.bump * h.bumpKnee + h.bumpHigh * (v - h.bumpKnee);
  const u = -v;
  return -(u <= h.reboundKnee
    ? h.rebound * u
    : h.rebound * h.reboundKnee + h.reboundHigh * (u - h.reboundKnee));
}
function damperSlope(h: CornerHardware, v: number) {
  return v >= 0
    ? v <= h.bumpKnee
      ? h.bump
      : h.bumpHigh
    : -v <= h.reboundKnee
      ? h.rebound
      : h.reboundHigh;
}
/** Spring + bump-stop force (N) and its slope at hub travel x. */
export function springForce(h: CornerHardware, x: number) {
  const stop = Math.max(0, x - h.stopGap);
  return (
    h.wheelRate * x * (1 + (0.5 * h.progression * Math.max(0, x)) / h.travel) +
    h.stopRate * stop * stop
  );
}
function springSlope(h: CornerHardware, x: number) {
  return (
    h.wheelRate * (1 + (h.progression * Math.max(0, x)) / h.travel) +
    2 * h.stopRate * Math.max(0, x - h.stopGap)
  );
}
/** Integral of spring force with respect to hub travel (J). */
function springWork(h: CornerHardware, x: number) {
  return (
    0.5 * h.wheelRate * x * x +
    (h.wheelRate * h.progression * Math.max(0, x) ** 3) / (6 * h.travel) +
    (h.stopRate * Math.max(0, x - h.stopGap) ** 3) / 3
  );
}
/** Convex time-discrete damper work potential. Its travel derivative is
 * damperForce(h, (x - previous) / dt), including the digressive knees. */
function damperWork(h: CornerHardware, v: number, dt: number) {
  const speed = Math.abs(v),
    knee = v >= 0 ? h.bumpKnee : h.reboundKnee,
    low = v >= 0 ? h.bump : h.rebound,
    high = v >= 0 ? h.bumpHigh : h.reboundHigh,
    below = Math.min(speed, knee),
    above = Math.max(0, speed - knee);
  return dt * (0.5 * low * below * below + low * knee * above + 0.5 * high * above * above);
}
/** Inputs and outputs of one hub solve (allocation-free, per vehicle). */
export class HubSolver {
  /** Hub travel (m, + bump) per corner: the integrated state. */
  readonly travel = new Float64Array(4);
  /** Tyre road-normal force (N) per corner after the solve; its suspension-axis
   * generalized force is tyreForce * normalCosine. */
  readonly tyreForce = new Float64Array(4);
  /** Total compression X (m) and its rate Ẋ (m/s), along the suspension axis. */
  readonly compression = new Float64Array(4);
  readonly rate = new Float64Array(4);
  readonly contact = new Uint8Array(4);
  /** Positive cosine between chassis up and road normal, held for this step.
   * Unity preserves the aligned-road hardware and standalone solver API. */
  readonly normalCosine = new Float64Array(4).fill(1);
  /** Link load along the suspension axis (N), positive pushing the hub down.
   * Held over a substep like the contact normal. Unlike an extra road force,
   * it changes the hub/tyre deformation; its work on hub travel is −Q·Δx. */
  readonly linkLoad = new Float64Array(4);
  /** Per-corner tyre radial stiffness this step (pressure dependent). */
  readonly tyreRate = new Float64Array(4);
  private readonly previous = new Float64Array(4);
  constructor(readonly hardware: CornerHardware[]) {}
  reset() {
    this.travel.fill(0);
    this.tyreForce.fill(0);
    // Placement/recovery starts without a measured road contact. Snapshot
    // presentation can run before the next gather/solve; it must not publish
    // a previous road's compression or normal as a new grounded tire pose.
    this.compression.fill(0);
    this.rate.fill(0);
    this.contact.fill(0);
    this.normalCosine.fill(1);
    this.linkLoad.fill(0);
  }
  private r = 0;
  private slope = 0;
  /** Hub force residual (tyre − suspension), and the positive restoring
   * stiffness. The bar contributes the off-diagonal term in the axle solve. */
  private residual(i: number, x: number, dt: number, other: number) {
    const h = this.hardware[i],
      v = (x - this.previous[i]) / dt,
      suspension = springForce(h, x) + damperForce(h, v) + h.barRate * (x - other),
      stiffness = springSlope(h, x) + damperSlope(h, v) / dt + h.barRate;
    const projection = this.normalCosine[i] ** 2,
      kt = this.tyreRate[i] * projection,
      ct = h.tyreDamping * projection,
      tyre = this.contact[i]
        ? Math.max(0, kt * (this.compression[i] - x) + ct * (this.rate[i] - v))
        : 0;
    this.r = tyre - suspension - this.linkLoad[i];
    this.slope = stiffness + (tyre > 0 ? kt + ct / dt : 0);
  }
  /** Scalar work potential whose negative derivative is the corner residual
   * before the bar. Taking the positive part of the tyre force gives a convex
   * unilateral contact potential; a detached tyre contributes no force. */
  private cornerWork(i: number, x: number, dt: number) {
    const h = this.hardware[i],
      v = (x - this.previous[i]) / dt,
      projection = this.normalCosine[i] ** 2,
      kt = this.tyreRate[i] * projection,
      ct = h.tyreDamping * projection,
      tyre = this.contact[i]
        ? Math.max(0, kt * (this.compression[i] - x) + ct * (this.rate[i] - v))
        : 0;
    return (
      springWork(h, x) +
      this.linkLoad[i] * x +
      damperWork(h, v, dt) +
      (tyre > 0 ? (0.5 * tyre * tyre) / (kt + ct / dt) : 0)
    );
  }
  private axleWork(i: number, x: number, y: number, dt: number) {
    return (
      this.cornerWork(i, x, dt) +
      this.cornerWork(i + 1, y, dt) +
      0.5 * this.hardware[i].barRate * (x - y) ** 2
    );
  }
  /** A simultaneous 2×2 Newton solve: both bar ends use the same iterate.
   * A corner at its droop stop is held only while its unconstrained force
   * points into that stop. This also frees it again as its partner moves. */
  private solveAxle(i: number, dt: number) {
    const first = this.hardware[i],
      second = this.hardware[i + 1],
      lowerX = -first.droop,
      lowerY = -second.droop;
    let x = Math.max(lowerX, this.travel[i]),
      y = Math.max(lowerY, this.travel[i + 1]);
    for (let iteration = 0; iteration <= 24; iteration++) {
      this.residual(i, x, dt, y);
      const rx = this.r,
        kx = this.slope;
      this.residual(i + 1, y, dt, x);
      const ry = this.r,
        ky = this.slope,
        boundX = x === lowerX && rx <= 0,
        boundY = y === lowerY && ry <= 0;
      if (Math.max(boundX ? 0 : Math.abs(rx), boundY ? 0 : Math.abs(ry)) < 1e-6) {
        this.travel[i] = x;
        this.travel[i + 1] = y;
        return;
      }
      if (iteration === 24) throw new Error('Suspension axle solve did not converge');
      const determinant = kx * ky - first.barRate * second.barRate;
      let dx = boundX ? 0 : boundY ? rx / kx : (ky * rx + first.barRate * ry) / determinant,
        dy = boundY ? 0 : boundX ? ry / ky : (kx * ry + second.barRate * rx) / determinant;
      // Projection can cut off one component of a Newton step at a stop.
      // Use a diagonal descent direction if the projected step points uphill.
      if (rx * (Math.max(lowerX, x + dx) - x) + ry * (Math.max(lowerY, y + dy) - y) <= 0) {
        dx = boundX ? 0 : rx / kx;
        dy = boundY ? 0 : ry / ky;
      }
      const work = this.axleWork(i, x, y, dt),
        roundoff = 16 * Number.EPSILON * Math.max(1, Math.abs(work));
      let scale = 1;
      for (let line = 0; line < 20; line++) {
        const nextX = Math.max(lowerX, x + scale * dx),
          nextY = Math.max(lowerY, y + scale * dy),
          decrease = rx * (nextX - x) + ry * (nextY - y);
        if (this.axleWork(i, nextX, nextY, dt) <= work - 1e-4 * decrease + roundoff) {
          x = nextX;
          y = nextY;
          break;
        }
        if (line === 19) throw new Error('Suspension axle line search did not converge');
        scale *= 0.5;
      }
    }
  }
  /** Backward-Euler axis travel and non-negative road-normal tyre force. */
  solve(dt: number) {
    if (!Number.isFinite(dt) || !(dt > 0)) throw new Error('Invalid suspension timestep');
    for (let i = 0; i < 4; i++) {
      const cosine = this.normalCosine[i];
      if (!Number.isFinite(cosine) || cosine <= 0 || cosine > 1)
        throw new Error('Invalid suspension contact cosine');
    }
    this.previous.set(this.travel);
    this.solveAxle(0, dt);
    this.solveAxle(2, dt);
    for (let i = 0; i < 4; i++) {
      const h = this.hardware[i],
        v = (this.travel[i] - this.previous[i]) / dt;
      this.tyreForce[i] = this.contact[i]
        ? this.normalCosine[i] *
          Math.max(
            0,
            this.tyreRate[i] * (this.compression[i] - this.travel[i]) +
              h.tyreDamping * (this.rate[i] - v),
          )
        : 0;
      if (this.tyreForce[i] === 0) this.contact[i] = 0;
    }
  }
}
/** Kinematic camber (rad, signed toward +lateral) relative to the chassis:
 * static camber plus negative-camber gain in bump. `side` is -1 right, +1 left. */
export function kinematicCamber(staticCamber: number, gain: number, travel: number, side: number) {
  return (staticCamber - gain * travel) * side;
}
/** Geometric (link) load transfer at one contact (N along chassis up):
 * lateral jacking through the roll centre at `y` (car-local lateral position
 * of the patch) and side-view anti geometry at `z` for force Fx. Pass this
 * generalized load to HubSolver so the same compliant tyre supplies its
 * projected road-normal reaction. */
export function geometricLoad(
  axle: AxleSuspension,
  y: number,
  z: number,
  fx: number,
  fy: number,
  meanTravel: number,
) {
  const rc = Math.max(-0.2, axle.rollCentreHeight + axle.rollCentreGain * meanTravel),
    slope = fx < 0 ? axle.antiBrake : axle.antiDrive;
  return (
    -(rc / (Math.abs(y) < 0.05 ? 0.05 * Math.sign(y || 1) : y)) * fy - slope * fx * Math.sign(z)
  );
}
