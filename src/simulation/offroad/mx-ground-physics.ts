import { clamp, G, smooth } from '../../core/math.ts';
import { motorcycleRotorBrakeWork } from '../motorcycle-thermal.ts';

/** Same chassis and rider in the tyre solver and at either suspension stop. */
export function motocrossYawInertia(mass: number, frontArm: number, rearArm: number) {
  return Math.max(12, 0.42 * mass * (frontArm ** 2 + rearArm ** 2));
}

/** Horizontal downhill acceleration for the adapter's current support.
 * Normals are unit, upward world-space terrain normals. Suspension loads
 * are the existing vertical support channels: multiplying by n.y projects
 * that supported acceleration into the normal, then n·left into the plane.
 * At static support this is G*n.y*(n·left); during unloading it fades with
 * the actual load and vanishes with both free contacts. Tyre circles retain
 * their existing load convention; this does not introduce a full 3D metric. */
export function motocrossLateralGravity(
  heading: number, mass: number,
  frontLoad: number, frontNormal: Readonly<{ x: number; y: number; z: number }>,
  rearLoad: number, rearNormal: Readonly<{ x: number; y: number; z: number }>,
) {
  const cs = Math.cos(heading), sn = Math.sin(heading);
  return (
    Math.max(0, frontLoad) * frontNormal.y * (frontNormal.x * cs - frontNormal.z * sn) +
    Math.max(0, rearLoad) * rearNormal.y * (rearNormal.x * cs - rearNormal.z * sn)
  ) / mass;
}

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
  /** The caller already applied its traction/front-support budget to this
   * gross engine command. Keep that single aid result; applying another
   * slip-ratio controller can prevent the brush reaching its allowed force.
   * Soil grip and finite wheel inertia still limit all contact forces. */
  driveTorqueLimited?: boolean;
  frontBrakeTorque: number;
  rearBrakeTorque: number;
  /** Independent gross-actuator ceilings from cornering/lift aids (Nm).
   * Take the tighter of this ceiling and live slip ABS; never multiply
   * those two controller reductions. A chassis-force limit does not apply
   * to a free rotor, which can still slow and dissipate its stored energy. */
  frontBrakeTorqueLimit?: number;
  rearBrakeTorqueLimit?: number;
  /** Part of rearBrakeTorque dissipated by the engine, not the rotor. */
  rearEngineBrakeTorque?: number;
  /** Quadratic drag + soil rolling resistance (N) and uphill gravity (m/s²). */
  drag: number;
  slope: number;
  /** Horizontal projection of along-ground forward speed (cos road pitch).
   * Lateral speed already uses horizontal metres/second. This changes only
   * displacement; omitted/one preserves the original planar solve exactly. */
  forwardProjection?: number;
  /** Optional supported cross-slope gravity, positive left (m/s²), in the
   * entry heading's planar frame. The adapter supplies the horizontal
   * projection of downhill gravity; it is a world-fixed vector over dt.
   * Omitted/zero preserves the original planar contact path exactly. */
  lateralGravity?: number;
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
  /** Work/dt from lateralGravity, including its forward component as the
   * heading turns (W). Present only while that optional force is active. */
  lateralGravityPower?: number;
  /** The same world-fixed external acceleration projected left in the
   * returned endpoint heading. Add to tyre-only endLateralAcceleration
   * when a controller needs total inertial acceleration rather than grip. */
  endLateralGravity?: number;
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

/** Preload the existing brush with the shear needed to oppose supported
 * gravity. Two contacts share translation and yaw; a lone contact can
 * constrain its own patch, but cannot hold the whole chassis against yaw.
 * The preload stays inside the same Fx/Fy circle and cannot supply positive
 * finite contact work. This is static support, not a second cornering force. */
function crossSlopeShear(
  front: MxContactForce, rear: MxContactForce,
  state: Readonly<MxGroundState>, p: Readonly<MxGroundParameters>,
  h: number, iz: number, cs: number, sn: number,
  gravityForward: number, gravitySide: number,
  drive: number, frontBrake: number, rearBrake: number,
) {
  const frontPeak = Math.max(0, p.frontLoad) * Math.max(0, p.frontMu),
    rearPeak = Math.max(0, p.rearLoad) * Math.max(0, p.rearMu),
    ff = 1 / p.mass + (p.frontArm * cs) ** 2 / iz,
    rr = 1 / p.mass + p.rearArm ** 2 / iz,
    fr = cs * (1 / p.mass - p.frontArm * p.rearArm / iz),
    frontGravity = -sn * gravityForward + cs * gravitySide;
  let frontBias = 0, rearBias = 0;
  if (frontPeak > 0 && rearPeak > 0) {
    const determinant = ff * rr - fr * fr;
    if (determinant > 0) {
      frontBias = (fr * gravitySide - rr * frontGravity) / determinant;
      rearBias = (fr * frontGravity - ff * gravitySide) / determinant;
    }
  } else if (frontPeak > 0) frontBias = -frontGravity / ff;
  else if (rearPeak > 0) rearBias = -gravitySide / rr;
  let originalFront = front.fy, originalRear = rear.fy;
  const frontLimit = Math.sqrt(Math.max(0, frontPeak ** 2 - front.fx ** 2)),
    rearLimit = Math.sqrt(Math.max(0, rearPeak ** 2 - rear.fx ** 2));
  let addedFront = clamp(originalFront + frontBias, -frontLimit, frontLimit) - originalFront,
    addedRear = clamp(originalRear + rearBias, -rearLimit, rearLimit) - originalRear;
  // Work uses the actual finite chassis impulse and positive rotor travel,
  // including a rotor stopping before h. In particular, a held bank has
  // zero patch displacement and zero soil heat despite its nonzero force.
  const work = () => {
    const forwardFront = front.fx * cs - front.fy * sn,
      sideFront = front.fx * sn + front.fy * cs,
      rawForward = state.speed + h * (
        (forwardFront + rear.fx - p.drag) / p.mass - p.slope + gravityForward),
      nextForward = Math.max(0, rawForward),
      nextSide = state.lateralSpeed + h * ((sideFront + rear.fy) / p.mass + gravitySide),
      rawYaw = state.yawRate + h * (
        (p.frontArm * sideFront - p.rearArm * rear.fy) / iz - 0.18 * state.yawRate),
      nextYaw = clamp(rawYaw, -5, 5),
      forward = 0.5 * (state.speed + nextForward),
      side = 0.5 * (state.lateralSpeed + nextSide),
      yaw = 0.5 * (state.yawRate + nextYaw),
      frontAcceleration = (-frontBrake - front.fx * p.frontRadius) / p.frontInertia,
      rearAcceleration = (drive - rearBrake - rear.fx * p.rearRadius) / p.rearInertia,
      frontTravel = motorcycleRotorBrakeWork(state.frontOmega,
        frontAcceleration, 1, h),
      rearTravel = motorcycleRotorBrakeWork(state.rearOmega,
        rearAcceleration, 1, h),
      bodyUnclamped = rawForward >= 0 && Math.abs(rawYaw) <= 5;
    return {
      front: h * (forwardFront * forward + sideFront * (side + p.frontArm * yaw)) -
        front.fx * p.frontRadius * frontTravel,
      rear: h * (rear.fx * forward + rear.fy * (side - p.rearArm * yaw)) -
        rear.fx * p.rearRadius * rearTravel,
      gravity: p.mass * h * (gravityForward * forward + gravitySide * side),
      frontUnclamped: bodyUnclamped && state.frontOmega + h * frontAcceleration >= 0,
      rearUnclamped: bodyUnclamped && state.rearOmega + h * rearAcceleration >= 0,
    };
  };
  const setBias = (fraction: number) => {
    front.fy = originalFront + fraction * addedFront;
    rear.fy = originalRear + fraction * addedRear;
  };
  const passive = (value: ReturnType<typeof work>) => value.front <= 1e-12 && value.rear <= 1e-12;
  setBias(1);
  if (!passive(work())) {
    setBias(0);
    if (passive(work())) {
      // A body already moving uphill cannot be pushed farther uphill by
      // the static preload. Retain as much of it as the work bound permits.
      let lower = 0, upper = 1;
      for (let i = 0; i < 28; i++) {
        const middle = 0.5 * (lower + upper);
        setBias(middle);
        if (passive(work())) lower = middle;
        else upper = middle;
      }
      setBias(lower);
    } else {
      // A shared chassis impulse can carry one nearly rolling contact
      // through zero slip while the other is strongly dissipative. Limit
      // only the contact adding work; a rolling rear must not divide the
      // locked front's independently available pickup/braking impulse.
      const limit = (key: 'front' | 'rear') => {
        const contact = key === 'front' ? front : rear,
          fx = contact.fx, fy = contact.fy,
          before = work(), unclamped = key === 'front' ? 'frontUnclamped' : 'rearUnclamped';
        const scale = (fraction: number) => {
          contact.fx = fx * fraction;
          contact.fy = fy * fraction;
        };
        scale(0);
        const zero = work();
        let upper = 1;
        if (before[unclamped] && zero[unclamped]) {
          // With no endpoint clamp, finite work is exactly L*s + Q*s².
          // Both endpoint checks prove that the affine velocities remain
          // unclamped throughout this scale interval. Verify the root so
          // cancellation in small work values cannot accept positive work.
          scale(0.5);
          const quadratic = 2 * before[key] - 4 * work()[key],
            linear = before[key] - quadratic;
          upper = quadratic > 0 ? clamp(-linear / quadratic, 0, 1) : 0;
          scale(upper);
          if (work()[key] <= 1e-12) return;
        }
        // A stopped rotor or active speed/yaw bound is piecewise smooth.
        // Bracket a verified admissible scale instead of assuming a root
        // from the unclamped kinetic formula remains valid across it.
        let lower = 0;
        for (let i = 0; i < 28; i++) {
          const middle = 0.5 * (lower + upper);
          scale(middle);
          if (work()[key] <= 1e-12) lower = middle;
          else upper = middle;
        }
        scale(lower);
      };
      // Each correction changes the shared chassis velocity, so recheck
      // both ports. Every scale stays inside its original force circle.
      for (let pass = 0; pass < 4 && !passive(work()); pass++) {
        if (work().front > 1e-12) limit('front');
        if (work().rear > 1e-12) limit('rear');
      }
      // A bounded conservative fallback removes only a still-infeasible
      // port. Two passes suffice: a removed vector has exactly zero work.
      for (let pass = 0; pass < 2 && !passive(work()); pass++) {
        if (work().front > 1e-12) front.fx = front.fy = 0;
        if (work().rear > 1e-12) rear.fx = rear.fy = 0;
      }
      // The corrected longitudinal pair may now admit the original bank
      // support. Re-evaluate its circle and work instead of dropping all
      // static lateral resistance for a rotor's rolling-speed correction.
      originalFront = front.fy;
      originalRear = rear.fy;
      const remainingFront = Math.sqrt(Math.max(0, frontPeak ** 2 - front.fx ** 2)),
        remainingRear = Math.sqrt(Math.max(0, rearPeak ** 2 - rear.fx ** 2));
      addedFront = clamp(originalFront + frontBias, -remainingFront, remainingFront) - originalFront;
      addedRear = clamp(originalRear + rearBias, -remainingRear, remainingRear) - originalRear;
      setBias(1);
      if (!passive(work())) {
        let lower = 0, upper = 1;
        for (let i = 0; i < 28; i++) {
          const middle = 0.5 * (lower + upper);
          setBias(middle);
          if (passive(work())) lower = middle;
          else upper = middle;
        }
        setBias(lower);
      }
    }
  }
  const finiteWork = work();
  front.slipPower = finiteWork.front < -1e-12 ? -finiteWork.front / h : 0;
  rear.slipPower = finiteWork.rear < -1e-12 ? -finiteWork.rear / h : 0;
  front.use = frontPeak > 0 ? Math.hypot(front.fx, front.fy) / frontPeak : 0;
  rear.use = rearPeak > 0 ? Math.hypot(rear.fx, rear.fy) / rearPeak : 0;
  return finiteWork.gravity;
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
  if (p.lateralGravity !== undefined && !Number.isFinite(p.lateralGravity))
    throw new RangeError('Invalid MX lateral gravity');
  if (!(p.frontBrakeTorqueLimit === undefined || p.frontBrakeTorqueLimit >= 0) ||
      !(p.rearBrakeTorqueLimit === undefined || p.rearBrakeTorqueLimit >= 0))
    throw new RangeError('Invalid MX brake torque limit');
  const n = Math.ceil(dt * 720);
  const h = dt / n;
  // Yaw inertia estimate for sprung rider + bike; the road/GP core never
  // reads this parameter. Wheelbase geometry gives the scale in kg m².
  const iz = motocrossYawInertia(p.mass, p.frontArm, p.rearArm);
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
  let lateralGravityWork = 0;
  // Horizontal downhill acceleration belongs to supported terrain motion.
  // An unloaded machine follows the separate ballistic/heave path instead.
  const lateralGravity = p.frontLoad > 0 || p.rearLoad > 0 ? p.lateralGravity ?? 0 : 0;
  const steer = clamp(p.steer, -0.75, 0.75),
    cs = Math.cos(steer),
    sn = Math.sin(steer),
    hasLean = p.lean !== undefined,
    lean = p.lean ?? 0,
    wheelbase = Math.max(0.5, p.frontArm + p.rearArm),
    totalLoad = Math.max(1, p.frontLoad + p.rearLoad),
    // Bar input needs a supported front contact. Fade only the rolling-path
    // demand over the first 10% of static front load, then retain the full
    // two-contact calibration. Rear slip/yaw and longitudinal forces remain
    // independent: a lifted front cannot steer through the loaded rear.
    staticFrontLoad = Math.max(1, p.mass * G * p.rearArm / wheelbase),
    frontSteeringAuthority = smooth(0, 0.1 * staticFrontLoad, p.frontLoad),
    curvature = Math.tan(steer) / wheelbase * frontSteeringAuthority,
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
    // Standalone callers retain slip TC. The ridden adapter supplies the
    // core's current-load budget already: at low speed the brush needs slip
    // to build that shear, so a second slip cut would spend the margin twice.
    // Raw brakes can lock a wheel; ABS acts before the finite-work check.
    const drive = p.tractionControl && !p.driveTorqueLimited
      ? p.driveTorque * clamp((0.36 - rear.slip) / 0.23, 0, 1)
      : p.driveTorque;
    const frontAbs = p.abs
      ? p.frontBrakeTorque * clamp((front.slip + 0.32) / 0.22, 0, 1)
      : p.frontBrakeTorque;
    const rearAbs = p.abs
      ? p.rearBrakeTorque * clamp((rear.slip + 0.32) / 0.22, 0, 1)
      : p.rearBrakeTorque;
    const fBrake = Math.min(frontAbs, p.frontLoad > 0 ? p.frontBrakeTorqueLimit ?? Infinity : Infinity);
    const rBrake = Math.min(rearAbs, p.rearLoad > 0 ? p.rearBrakeTorqueLimit ?? Infinity : Infinity);
    // A terrain direction is fixed in the world, not attached to the bars.
    // Both components change when the body frame yaws during this tick.
    const gravityTurn = heading - state.heading,
      gravityForward = lateralGravity !== 0 ? lateralGravity * Math.sin(gravityTurn) : 0,
      gravitySide = lateralGravity !== 0 ? lateralGravity * Math.cos(gravityTurn) : 0;
    if (lateralGravity !== 0) {
      lateralGravityWork += crossSlopeShear(
        front, rear, { speed, lateralSpeed, yawRate, heading, frontOmega, rearOmega }, p,
        h, iz, hasLean ? 1 : cs, hasLean ? 0 : sn, gravityForward, gravitySide,
        drive, fBrake, rBrake,
      );
    }
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
    const ax = netForward / p.mass - p.drag / p.mass - p.slope + gravityForward;
    let ay = slipNetSide / p.mass + gravitySide;
    let yawMoment = p.frontArm * slipFSide - p.rearArm * slipRSide;
    if (lateralGravity !== 0) {
      // Canonicalize a balanced support sum at machine precision before
      // tiny yaw roundoff can rotate a held bank's gravity into forward
      // motion. The scale uses only the participating terms, with no fixed
      // speed/force dead band: a genuinely tiny unmatched impulse survives.
      const sideScale = (Math.abs(slipFSide) + Math.abs(slipRSide)) / p.mass + Math.abs(gravitySide);
      const yawScale = Math.abs(p.frontArm * slipFSide) + Math.abs(p.rearArm * slipRSide);
      if (Math.abs(ay) <= 8 * Number.EPSILON * sideScale) ay = 0;
      if (Math.abs(yawMoment) <= 8 * Number.EPSILON * yawScale) yawMoment = 0;
    }
    const yawAcceleration = yawMoment / iz - 0.18 * yawRate;
    const camberYawRate = hasLean ? camberNetSide / (p.mass * Math.max(2, speed)) : 0;
    endLateralAcceleration = (slipNetSide + camberNetSide) / p.mass;
    const forward = Math.max(0, speed + ax * h);
    const across = lateralSpeed + ay * h;
    yawRate = clamp(yawRate + yawAcceleration * h, -5, 5);
    // Body-frame Coriolis terms only change coordinates. An explicit Euler
    // update of (+yaw*side, -yaw*forward) adds kinetic energy every substep,
    // even with both tyres unloaded. Apply the same exact rotation used by
    // heading so a freely yawing chassis cannot bend its world momentum.
    // Camber steering remains separate: its supported rolling path really
    // turns the velocity, rather than merely re-expressing its coordinates.
    const turn = yawRate * h, cosine = Math.cos(turn), sine = Math.sin(turn);
    speed = Math.max(0, forward * cosine + across * sine);
    lateralSpeed = across * cosine - forward * sine;
    heading += turn + camberYawRate * h;
    const planarSpeed = speed * (p.forwardProjection ?? 1);
    dx += (Math.sin(heading) * planarSpeed + Math.cos(heading) * lateralSpeed) * h;
    dz += (Math.cos(heading) * planarSpeed - Math.sin(heading) * lateralSpeed) * h;
  }
  front.fx = ffx / dt;
  front.fy = ffy / dt;
  front.slipPower = fPower / dt;
  front.use = fUse / dt;
  rear.fx = rfx / dt;
  rear.fy = rfy / dt;
  rear.slipPower = rPower / dt;
  rear.use = rUse / dt;
  const endLateralGravity = lateralGravity * Math.cos(heading - state.heading);
  if (lateralGravity !== 0 && Math.abs(endLateralAcceleration + endLateralGravity) <=
      8 * Number.EPSILON * Math.max(1, Math.abs(endLateralAcceleration), Math.abs(endLateralGravity))) {
    // Preserve the exactly held fixed point for downstream sign-based
    // controllers: roundoff in F/m + g must not select a berm direction.
    // This only canonicalizes cancellation at floating-point precision.
    endLateralAcceleration = -endLateralGravity;
  }
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
    ...(lateralGravity !== 0 ? {
      lateralGravityPower: lateralGravityWork / dt,
      endLateralGravity,
    } : {}),
    front, rear,
  };
}
