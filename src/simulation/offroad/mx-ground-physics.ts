import { clamp } from '../../core/math.ts';

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
  driveTorque: number;
  frontBrakeTorque: number;
  rearBrakeTorque: number;
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
  /** Acceleration in chassis coordinates (m/s²). */
  longitudinal: number;
  lateralAcceleration: number;
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
): MxContactForce {
  if (load <= 0 || mu <= 0) return { ...EMPTY_FORCE };
  const peak = load * mu;
  const sx = longitudinalSlip / Math.max(0.9, 0.075 * Math.abs(groundSpeed));
  const sy = slipAngle / 0.15;
  const magnitude = Math.hypot(sx, sy);
  const gain = magnitude > 1e-8 ? Math.tanh(magnitude) / magnitude : 1;
  const fx = peak * sx * gain;
  const fy = peak * sy * gain;
  return {
    fx,
    fy,
    slip: longitudinalSlip / Math.max(3, Math.abs(groundSpeed)),
    use: Math.hypot(fx, fy) / peak,
    slipPower: Math.max(0, fx * longitudinalSlip + fy * Math.tan(slipAngle) * Math.max(1, Math.abs(groundSpeed))),
  };
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
  let speed = Math.max(0, state.speed),
    lateralSpeed = state.lateralSpeed,
    yawRate = state.yawRate,
    heading = state.heading,
    frontOmega = Math.max(0, state.frontOmega),
    rearOmega = Math.max(0, state.rearOmega),
    dx = 0,
    dz = 0,
    ax = 0,
    ay = 0;
  let front: MxContactForce = { ...EMPTY_FORCE };
  let rear: MxContactForce = { ...EMPTY_FORCE };
  // Return forces averaged over the same microsteps that advanced momentum:
  // F̄ = (Σ F_k Δt_k)/Δt. Sampling only the final brush state makes the
  // chassis' finite impulse disagree with suspension, replay and tyre heat.
  let ffx = 0, ffy = 0, rfx = 0, rfy = 0;
  let fPower = 0, rPower = 0, fUse = 0, rUse = 0;
  const steer = clamp(p.steer, -0.75, 0.75),
    cs = Math.cos(steer),
    sn = Math.sin(steer);
  for (let i = 0; i < n; i++) {
    // Tyre-frame velocity includes yaw sweep at each contact patch.
    const frontSide = lateralSpeed + p.frontArm * yawRate,
      rearSide = lateralSpeed - p.rearArm * yawRate,
      frontForward = speed * cs + frontSide * sn,
      frontAcross = frontSide * cs - speed * sn;
    front = motocrossTyreShear(
      frontOmega * p.frontRadius - frontForward,
      Math.atan2(-frontAcross, Math.max(1, Math.abs(frontForward))),
      p.frontLoad,
      p.frontMu,
      frontForward,
    );
    rear = motocrossTyreShear(
      rearOmega * p.rearRadius - speed,
      Math.atan2(-rearSide, Math.max(1, speed)),
      p.rearLoad,
      p.rearMu,
      speed,
    );
    ffx += front.fx * h;
    ffy += front.fy * h;
    rfx += rear.fx * h;
    rfy += rear.fy * h;
    fPower += front.slipPower * h;
    rPower += rear.slipPower * h;
    fUse += front.use * h;
    rUse += rear.use * h;
    const fSide = front.fy * cs + front.fx * sn,
      fForward = front.fx * cs - front.fy * sn,
      netForward = fForward + rear.fx,
      netSide = fSide + rear.fy;
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
    frontOmega = Math.max(0, frontOmega + (-fBrake - front.fx * p.frontRadius) * h / p.frontInertia);
    rearOmega = Math.max(
      0,
      rearOmega + (drive - rBrake - rear.fx * p.rearRadius) * h / p.rearInertia,
    );
    ax = netForward / p.mass - p.drag / p.mass - p.slope + yawRate * lateralSpeed;
    ay = netSide / p.mass - yawRate * speed;
    const yawAcceleration = (p.frontArm * fSide - p.rearArm * rear.fy) / iz - 0.18 * yawRate;
    speed = Math.max(0, speed + ax * h);
    lateralSpeed += ay * h;
    yawRate = clamp(yawRate + yawAcceleration * h, -5, 5);
    heading += yawRate * h;
    dx += (Math.sin(heading) * speed + Math.cos(heading) * lateralSpeed) * h;
    dz += (Math.cos(heading) * speed - Math.sin(heading) * lateralSpeed) * h;
  }
  return {
    speed, lateralSpeed, yawRate, heading, frontOmega, rearOmega,
    dx, dz, longitudinal: ax, lateralAcceleration: ay + yawRate * speed,
    front: {
      ...front,
      fx: ffx / dt,
      fy: ffy / dt,
      slipPower: fPower / dt,
      use: fUse / dt,
    },
    rear: {
      ...rear,
      fx: rfx / dt,
      fy: rfy / dt,
      slipPower: rPower / dt,
      use: rUse / dt,
    },
  };
}
