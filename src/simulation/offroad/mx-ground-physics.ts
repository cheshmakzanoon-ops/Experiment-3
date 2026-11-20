import { clamp } from '../../core/math.ts';
import { motorcycleRotorBrakeWork } from '../motorcycle-thermal.ts';

/** SI-unit, planar, two-contact motocross model. The separate sprung heave /
 * pitch suspension supplies its *current* axle loads; a free tyre has no
 * lateral or longitudinal force. None of this is used by road/GP bikes.
 *
 * Coordinates: forward +Z, left +X in the chassis frame, yaw/steer +left.
 * Contact shear opposes slip. Equal and opposite forces exchange linear
 * chassis and wheel angular momentum; never manufacture a takeoff impulse.
 */
export interface MxGroundState {
  speed: number;
  lateralSpeed: number;
  yawRate: number;
  heading: number;
  frontOmega: number;
  rearOmega: number;
}
export interface MxGroundParameters {
  mass: number;
  frontArm: number;
  rearArm: number;
  frontRadius: number;
  rearRadius: number;
  frontInertia: number;
  rearInertia: number;
  frontLoad: number;
  rearLoad: number;
  frontMu: number;
  rearMu: number;
  steer: number;
  /** Roll angle (+right, rad) when coupled to a leaned motorcycle chassis. */
  lean?: number;
  driveTorque: number;
  frontBrakeTorque: number;
  rearBrakeTorque: number;
  /** Part of rearBrakeTorque dissipated by the engine, not the rotor. */
  rearEngineBrakeTorque?: number;
  /** Quadratic drag + soil rolling resistance (N) and uphill gravity (m/s²). */
  drag: number;
  slope: number;
  /** Rider electronics. Raw mode leaves locked/spinning wheels to the soil. */
  tractionControl: boolean;
  abs: boolean;
}
export interface MxContactForce {
  /** Contact frame, along and left of that wheel (N). */
  fx: number;
  fy: number;
  /** Tyre longitudinal slip ratio; positive denotes spinning. */
  slip: number;
  /** Combined force-circle utilization, 0..1. */
  use: number;
  /** Irreversible slip work transferred to deforming soil and tyre (W). */
  slipPower: number;
}
export interface MxGroundResult extends MxGroundState {
  /** Chassis centre displacement in world metres over dt. */
  dx: number;
  dz: number;
  /** Mean forward speed change and mean lateral tyre acceleration over dt (m/s²). */
  longitudinal: number;
  lateralAcceleration: number;
  /** Instantaneous patch support at the presented endpoint (m/s²). */
  endLateralAcceleration: number;
  /** Friction brake work / dt, from limited actuator torque and finite
   * rotor rotation. Engine-braking work is excluded (W). */
  frontBrakePower: number;
  rearBrakePower: number;
  front: MxContactForce;
  rear: MxContactForce;
}

const EMPTY_FORCE: MxContactForce = { fx: 0, fy: 0, slip: 0, use: 0, slipPower: 0 };

/** Saturating vector-brush soil shear; the same combined budget pays for
 * braking, driven-wheel spin and cornering. tanh(|s|)/|s| gives a smooth
 * Coulomb limit, including at zero load/slip, without sqrt negative roots.
 * Shear velocity (not just a low-speed slip ratio) prevents launch spikes. */
export function motocrossTyreShear(
  longitudinalSlip: number,
  slipAngle: number,
  load: number,
  mu: number,
  groundSpeed: number,
  out: MxContactForce = { ...EMPTY_FORCE },
  longitudinalStiffness = Infinity,
  lateralStiffness = Infinity,
): MxContactForce {
  if (load <= 0 || mu <= 0) {
    out.fx = out.fy = out.slip = out.use = out.slipPower = 0;
    return out;
  }
  const peak = load * mu;
  const sx = longitudinalSlip / Math.max(0.9, 0.075 * Math.abs(groundSpeed));
  const sy = slipAngle / 0.15;
  const magnitude = Math.hypot(sx, sy);
  const gain = magnitude > 1e-8 ? Math.tanh(magnitude) / magnitude : 1;
  // A finite step can exchange only the impulse needed to close the
  // rolling-speed mismatch. On a loaded landing the unconstrained brush
  // can cross rolling equality and accelerate the wheel away on each step.
  const limit = Number.isFinite(longitudinalStiffness)
    ? Math.abs(longitudinalSlip) * longitudinalStiffness : Infinity;
  const fx = clamp(peak * sx * gain, -limit, limit);
  const lateralSlip = Math.tan(slipAngle) * Math.max(1, Math.abs(groundSpeed));
  const sideLimit = Number.isFinite(lateralStiffness) ? Math.abs(lateralSlip) * lateralStiffness : Infinity;
  const fy = clamp(peak * sy * gain, -sideLimit, sideLimit);
  out.fx = fx;
  out.fy = fy;
  out.slip = longitudinalSlip / Math.max(3, Math.abs(groundSpeed));
  out.use = Math.hypot(fx, fy) / peak;
  out.slipPower = Math.max(0,
    fx * longitudinalSlip + fy * lateralSlip,
  );
  return out;
}

/** Semi-implicit, internally substepped wheel + yaw integration.
 * Fx acts at the contact; torque = -Fx*radius acts on its wheel. The wheel
 * reaction is not applied a second time after landing. The same model
 * covers brake-lock slides, berms, wheelies and airborne wheel pickup.
 */
export function stepMotocrossGround(
  state: Readonly<MxGroundState>,
  p: Readonly<MxGroundParameters>,
  dt: number,
): MxGroundResult {
  if (!(dt > 0) || dt > 0.05 || !Number.isFinite(dt)) throw new RangeError('Invalid MX timestep');
  if (!(p.mass > 0) || !(p.frontInertia > 0) || !(p.rearInertia > 0) ||
      !(p.frontRadius > 0) || !(p.rearRadius > 0))
    throw new RangeError('Invalid MX mass/inertia');
  const n = Math.ceil(dt * 720);
  const h = dt / n;
  // Yaw inertia estimate for sprung rider + bike; the road/GP core never
  // reads this parameter. Wheelbase geometry gives the scale in kg m².
  const iz = Math.max(12, 0.42 * p.mass * (p.frontArm ** 2 + p.rearArm ** 2));
  const initialSpeed = Math.max(0, state.speed);
  let speed = initialSpeed,
    lateralSpeed = state.lateralSpeed,
    yawRate = state.yawRate,
    heading = state.heading,
    frontOmega = Math.max(0, state.frontOmega),
    rearOmega = Math.max(0, state.rearOmega),
    dx = 0,
    dz = 0,
    endLateralAcceleration = 0;
  // Each public result owns both patches. Reuse those same records for the
  // six 720 Hz contact solves within a normal 120 Hz worker tick.
  const front = { ...EMPTY_FORCE }, rear = { ...EMPTY_FORCE };
  // Return forces averaged over the same microsteps that advanced momentum:
  // F̄ = (Σ F_k Δt_k)/Δt. Sampling only the final brush state makes the
  // chassis' finite impulse disagree with suspension, replay and tyre heat.
  let ffx = 0, ffy = 0, rfx = 0, rfy = 0;
  let fPower = 0, rPower = 0, fUse = 0, rUse = 0;
  let frontBrakeWork = 0, rearBrakeWork = 0;
  const steer = clamp(p.steer, -0.75, 0.75),
    cs = Math.cos(steer),
    sn = Math.sin(steer),
    hasLean = p.lean !== undefined,
    lean = p.lean ?? 0,
    wheelbase = Math.max(0.5, p.frontArm + p.rearArm),
    totalLoad = Math.max(1, p.frontLoad + p.rearLoad),
    curvature = Math.tan(steer) / wheelbase,
    bankProjection = Math.cos(lean),
    frontShare = p.frontLoad / totalLoad,
    rearShare = p.rearLoad / totalLoad,
    frontPeak = p.frontLoad * p.frontMu,
    rearPeak = p.rearLoad * p.rearMu,
    // The wheel and chassis receive the same impulse. When both tyres act
    // together, their shared chassis velocity couples their rolling errors.
    // Include the off-diagonal mobility in each bound; a lone loaded tyre
    // uses its exact effective mass. A steered front also acts through yaw.
    chassisMobility = (frontPeak > 0 && rearPeak > 0 ? 1 + (hasLean ? 1 : cs) : 1) / p.mass,
    frontMobility = chassisMobility + p.frontRadius ** 2 / p.frontInertia +
      (hasLean ? 0 : (p.frontArm * sn) ** 2 / iz),
    rearMobility = chassisMobility + p.rearRadius ** 2 / p.rearInertia,
    frontStiffness = 1 / (h * frontMobility),
    rearStiffness = 1 / (h * rearMobility),
    // A sideways impulse changes translation and yaw. At two contacts the
    // yaw arms oppose each other. Include the absolute coupling so both
    // patches can settle together on a loaded, walking-speed landing.
    lateralProjection = hasLean ? 1 : cs,
    sideCoupling = frontPeak > 0 && rearPeak > 0
      ? Math.abs(lateralProjection * (1 / p.mass - p.frontArm * p.rearArm / iz)) : 0,
    frontSideStiffness = 1 / (h * (1 / p.mass + (p.frontArm * lateralProjection) ** 2 / iz + sideCoupling)),
    rearSideStiffness = 1 / (h * (1 / p.mass + p.rearArm ** 2 / iz + sideCoupling)),
    rearFrictionShare = p.rearBrakeTorque > 0
      ? clamp(1 - (p.rearEngineBrakeTorque ?? 0) / p.rearBrakeTorque, 0, 1) : 0;
  for (let i = 0; i < n; i++) {
    // Tyre-frame velocity includes yaw sweep at each contact patch.
    // When coupled to a leaned chassis (hasLean), the kinematic bar angle
    // steer is part of the rolling cone curvature coreLat below, so the
    // brush model measures pure sideslip relative to that rolling path.
    const frontSide = lateralSpeed + p.frontArm * yawRate,
      rearSide = lateralSpeed - p.rearArm * yawRate,
      frontForward = hasLean ? speed : speed * cs + frontSide * sn,
      frontAcross = hasLean ? frontSide : frontSide * cs - speed * sn;
    motocrossTyreShear(
      frontOmega * p.frontRadius - frontForward,
      Math.atan2(-frontAcross, Math.max(1, Math.abs(frontForward))),
      p.frontLoad,
      p.frontMu,
      frontForward,
      front,
      frontStiffness,
      frontSideStiffness,
    );
    motocrossTyreShear(
      rearOmega * p.rearRadius - speed,
      Math.atan2(-rearSide, Math.max(1, speed)),
      p.rearLoad,
      p.rearMu,
      speed,
      rear,
      rearStiffness,
      rearSideStiffness,
    );
    const slipFSide = hasLean ? front.fy : front.fy * cs + front.fx * sn,
      slipFForward = hasLean ? front.fx : front.fx * cs - front.fy * sn,
      slipRSide = rear.fy,
      slipNetSide = slipFSide + slipRSide;
    let camberNetSide = 0;
    if (hasLean) {
      // Leaned motorcycle cone rolling: camber + bar steering demand lateral
      // force along the curved path, bounded by each tyre's remaining
      // combined friction circle √(max(0, (N·μ)² − Fx²)).
      const coreLat = speed * speed * curvature * bankProjection;
      const demandedFy = p.mass * coreLat;
      const fMaxFy = Math.sqrt(Math.max(0, frontPeak * frontPeak - front.fx * front.fx)),
        rMaxFy = Math.sqrt(Math.max(0, rearPeak * rearPeak - rear.fx * rear.fx));
      const fTotalFy = clamp(front.fy + demandedFy * frontShare, -fMaxFy, fMaxFy);
      const rTotalFy = clamp(rear.fy + demandedFy * rearShare, -rMaxFy, rMaxFy);
      camberNetSide = (fTotalFy - front.fy) + (rTotalFy - rear.fy);
      front.fy = fTotalFy;
      rear.fy = rTotalFy;
      front.use = frontPeak > 0 ? Math.hypot(front.fx, front.fy) / frontPeak : 0;
      rear.use = rearPeak > 0 ? Math.hypot(rear.fx, rear.fy) / rearPeak : 0;
    }
    ffx += front.fx * h;
    ffy += front.fy * h;
    rfx += rear.fx * h;
    rfy += rear.fy * h;
    fPower += front.slipPower * h;
    rPower += rear.slipPower * h;
    fUse += front.use * h;
    rUse += rear.use * h;
    const netForward = slipFForward + rear.fx;
    // Separate rider aid *requests* from actual soil forces. Raw brakes can
    // lock a wheel; sport ABS/TC reduces torque before the friction solve.
    const drive = p.tractionControl
      ? p.driveTorque * clamp((0.36 - rear.slip) / 0.23, 0, 1)
      : p.driveTorque;
    const fBrake = p.abs
      ? p.frontBrakeTorque * clamp((front.slip + 0.32) / 0.22, 0, 1)
      : p.frontBrakeTorque;
    const rBrake = p.abs
      ? p.rearBrakeTorque * clamp((rear.slip + 0.32) / 0.22, 0, 1)
      : p.rearBrakeTorque;
    // These are diagnostic heat ports only: preserve the exact original
    // momentum arithmetic below. Wheel lock limits the positive angular
    // distance, and ABS scales friction/engine torque together.
    frontBrakeWork += motorcycleRotorBrakeWork(
      frontOmega, (-fBrake - front.fx * p.frontRadius) / p.frontInertia, fBrake, h,
    );
    rearBrakeWork += motorcycleRotorBrakeWork(
      rearOmega, (drive - rBrake - rear.fx * p.rearRadius) / p.rearInertia,
      rBrake * rearFrictionShare, h,
    );
    frontOmega = Math.max(0, frontOmega + (-fBrake - front.fx * p.frontRadius) * h / p.frontInertia);
    rearOmega = Math.max(
      0,
      rearOmega + (drive - rBrake - rear.fx * p.rearRadius) * h / p.rearInertia,
    );
    const ax = netForward / p.mass - p.drag / p.mass - p.slope + yawRate * lateralSpeed;
    const ay = slipNetSide / p.mass - yawRate * speed;
    const yawAcceleration = (p.frontArm * slipFSide - p.rearArm * slipRSide) / iz - 0.18 * yawRate;
    const camberYawRate = hasLean ? camberNetSide / (p.mass * Math.max(2, speed)) : 0;
    endLateralAcceleration = (slipNetSide + camberNetSide) / p.mass;
    speed = Math.max(0, speed + ax * h);
    lateralSpeed += ay * h;
    yawRate = clamp(yawRate + yawAcceleration * h, -5, 5);
    heading += (yawRate + camberYawRate) * h;
    dx += (Math.sin(heading) * speed + Math.cos(heading) * lateralSpeed) * h;
    dz += (Math.cos(heading) * speed - Math.sin(heading) * lateralSpeed) * h;
  }
  front.fx = ffx / dt;
  front.fy = ffy / dt;
  front.slipPower = fPower / dt;
  front.use = fUse / dt;
  rear.fx = rfx / dt;
  rear.fy = rfy / dt;
  rear.slipPower = rPower / dt;
  rear.use = rUse / dt;
  return {
    speed, lateralSpeed, yawRate, heading, frontOmega, rearOmega,
    dx, dz,
    // The chassis and the lean controller consume an outer tick. Use the
    // same impulse that advanced it, including the forward stop constraint.
    longitudinal: (speed - initialSpeed) / dt,
    lateralAcceleration: ((hasLean ? ffy : ffy * cs + ffx * sn) + rfy) / (p.mass * dt),
    endLateralAcceleration,
    frontBrakePower: frontBrakeWork / dt,
    rearBrakePower: rearBrakeWork / dt,
    front, rear,
  };
}
