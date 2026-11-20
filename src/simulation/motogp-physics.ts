import { clamp, Vec3, type Quat } from '../core/math.ts';
import { motorcycleWheelSlipPower } from './motorcycle-thermal.ts';
import {
  FORMULA_SLICK,
  camberShift,
  combinedForces,
  prepareSlip,
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
  /** Road suspension opt-in: preserve planar inertia on contact loss,
   * resolve the steered front force, and rotate both body-frame velocity
   * components. The adapter consumes forwardSpeed as well as lateralSpeed. */
  inertialContacts?: boolean;
  /** Front wheel plane measured against the current road normal. */
  steeringPlane?: GpSteeringPlane;
  /** Horizontal rolling direction of the unsteered rear wheel on its own road plane. */
  rearGroundAngle?: number;
  /** Rolling radii at the road support points, including camber and bank. */
  frontRadius?: number;
  rearRadius?: number;
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

const RAKE_SIN = Math.sin(GP_RAKE),
  RAKE_COS = Math.cos(GP_RAKE);

/** Horizontal heading of an unsteered wheel relative to chassis yaw. Its axle
 * and the surface normal determine a tangent even when its frame pitches. */
export function fixedWheelGroundAngle(
  axle: Vec3,
  normal: Vec3,
  sinHeading: number,
  cosHeading: number,
) {
  const x = axle.y * normal.z - axle.z * normal.y;
  const z = axle.x * normal.y - axle.y * normal.x;
  const forward = z * cosHeading + x * sinHeading;
  return forward > 0.08 ? Math.atan2(x * cosHeading - z * sinHeading, forward) : 0;
}

/** The tyre rolls along the intersection of its wheel plane and the road.
 * In yaw coordinates the horizontal direction is A cos(delta) + B sin(delta).
 * Keeping these two basis vectors gives the rider controller the exact inverse
 * used by the tyre, also on a cambered road or with a pitching chassis. */
export class GpSteeringPlane {
  private lateral0 = 0;
  private forward0 = 1;
  private lateral90 = RAKE_COS;
  private forward90 = 0;
  private normal0 = 0;
  private normal90 = -RAKE_SIN;
  private readonly axis = new Vec3();
  private readonly tangent = new Vec3();
  private readonly local = new Vec3();
  valid = true;

  measure(chassis: Quat, normal: Vec3, sinHeading: number, cosHeading: number) {
    const { axis, tangent, local } = this;
    chassis.rotate(local.set(1, 0, 0), axis);
    tangent.cross(axis, normal);
    this.lateral0 = tangent.x * cosHeading - tangent.z * sinHeading;
    this.forward0 = tangent.z * cosHeading + tangent.x * sinHeading;
    this.normal0 = axis.dot(normal);
    chassis.rotate(local.set(0, -RAKE_SIN, -RAKE_COS), axis);
    tangent.cross(axis, normal);
    this.lateral90 = tangent.x * cosHeading - tangent.z * sinHeading;
    this.forward90 = tangent.z * cosHeading + tangent.x * sinHeading;
    this.normal90 = axis.dot(normal);
    // A wheel laid flat against the surface has no unique rolling heading.
    this.valid =
      this.forward0 > 0.08 &&
      this.forward0 * this.lateral90 - this.lateral0 * this.forward90 > 0.035;
  }

  axleNormal(delta: number) {
    return this.normal0 * Math.cos(delta) + this.normal90 * Math.sin(delta);
  }

  groundAngle(bar: number) {
    const c = Math.cos(bar),
      s = Math.sin(bar);
    return Math.atan2(
      this.lateral0 * c + this.lateral90 * s,
      this.forward0 * c + this.forward90 * s,
    );
  }

  barAngle(ground: number) {
    const c = Math.cos(ground),
      s = Math.sin(ground);
    return Math.atan2(
      this.forward0 * s - this.lateral0 * c,
      this.lateral90 * c - this.forward90 * s,
    );
  }
}

/** Standalone chassis uses a level road. The same raked-wheel projection can
 * be written directly in terms of lean where a contact plane is unavailable. */
export function gpGroundSteer(steer: number, lean: number, plane?: GpSteeringPlane) {
  if (plane?.valid) return plane.groundAngle(steer);
  const s = Math.sin(steer);
  return Math.atan2(RAKE_COS * s, Math.cos(lean) * Math.cos(steer) - Math.sin(lean) * RAKE_SIN * s);
}
export function gpBarSteer(ground: number, lean: number, plane?: GpSteeringPlane) {
  if (plane?.valid) return plane.barAngle(ground);
  const s = Math.sin(ground);
  return Math.atan2(
    Math.cos(lean) * s,
    RAKE_COS * Math.cos(ground) + Math.sin(lean) * RAKE_SIN * s,
  );
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
  /** Forward component after opt-in coupled body-frame integration. The
   * adapter has already applied its longitudinal tyre/drag/gravity impulse. */
  forwardSpeed = 0;
  /** Additional longitudinal acceleration from resolving the steered front
   * tyre force into the body frame; the adapter's straight Fx is already applied. */
  longitudinalCorrection = 0;
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
  private frontMuUsed = 0;
  private frontLimit = 0;
  private rearLimit = 0;
  /** Preparation belonging to the stored relaxed force. Fy / C_alpha is
   * the reduced carcass's elastic strain; a load change must not retain the
   * same absolute newtons while silently changing that strain. */
  private frontElasticStiffness = 0;
  private rearElasticStiffness = 0;
  private sideLimit = 0;
  private lastSpeed = 0;
  private readonly front = slipState();
  private readonly rear = slipState();
  private readonly force = { fx: 0, fy: 0 };
  /** Independent inverse scratch: trial steering must not rewrite the
   * actual contact's slip/force/thermal reporting state. */
  private readonly inverseFront = slipState();
  private readonly previewRear = slipState();
  private readonly inverseForces = new Float64Array(17);

  constructor(readonly geometry: MotoGPGeometry) {
    if (!(geometry.yawInertia > 0 && geometry.frontRadius > 0 && geometry.rearRadius > 0))
      throw new Error('Invalid GP bike geometry');
  }

  reset(speed = 0) {
    this.forwardSpeed = speed;
    this.longitudinalCorrection = 0;
    this.lateralSpeed = this.yawRate = this.lateralAcceleration = 0;
    this.frontFy = this.rearFy = this.frontSlipAngle = this.rearSlipAngle = 0;
    this.frontLoadUsed = this.frontMuUsed = 0;
    this.frontElasticStiffness = this.rearElasticStiffness = 0;
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
    this.forwardSpeed = v;
    this.longitudinalCorrection = 0;
    if (!(dt > 0 && dt <= 0.05)) throw new Error('Invalid GP bike timestep');
    // Grid placement, teleportation and tests that set speed explicitly are
    // not dual-wheel lockups: reinitialize the contact rotations.
    if (Math.abs(v - this.lastSpeed) > 5) {
      this.frontOmega = v / g.frontRadius;
      this.rearOmega = v / g.rearRadius;
      this.lateralSpeed = this.yawRate = this.steerTrim = 0;
    }
    this.lastSpeed = v;
    const contact = clamp(q.frontContact, 0, 1);
    const steer = (this.groundSteer = gpGroundSteer(q.steer, q.lean, q.steeringPlane));
    const rearAngle = q.rearGroundAngle ?? 0;
    if ((contact <= 1e-6 && !q.inertialContacts) || v < 2.5) {
      // No fictitious front road steering while raised. Below walking speed
      // retain the geometric pit-box steering model instead of freezing turn.
      this.yawRate =
        contact > 1e-6 && v < 2.5
          ? (v * (Math.tan(steer) - Math.tan(rearAngle)) * contact) / (g.frontArm + g.rearArm)
          : 0;
      this.lateralSpeed = 0;
      this.frontFy = this.rearFy = this.lateralAcceleration = 0;
      this.frontSlipAngle = this.rearSlipAngle = this.frontLoadUsed = this.frontMuUsed = 0;
      this.frontElasticStiffness = this.rearElasticStiffness = 0;
      this.stepWheels(q);
      return this;
    }

    // The tyre sees the ground-plane steer of the raked, leaned fork.
    const frontFy = this.sideForce(
      this.front,
      q.frontLoad * contact,
      q.frontMu,
      q.lean,
      steer,
      this.lateralSpeed + g.frontArm * this.yawRate,
      v,
      q.frontFx,
    );
    this.frontLimit = this.sideLimit;
    // Carry the same elastic state into the new contact preparation once.
    // Keeping absolute newtons on reload, but immediately clipping them on
    // unload, rectified oscillating normal load into lost cornering force.
    // Constant preparation and standalone callers keep the original arithmetic.
    const frontStiffness =
      q.frontLoad * contact > 1 && q.frontMu > 0 ? this.front.corneringStiffness : 0;
    const oldFront =
      q.inertialContacts &&
      this.frontElasticStiffness > 0 &&
      frontStiffness !== this.frontElasticStiffness
        ? (this.frontFy * frontStiffness) / this.frontElasticStiffness
        : this.frontFy;
    this.frontElasticStiffness = frontStiffness;
    this.frontSlipAngle = this.front.alpha;
    this.frontStiffness = q.frontLoad * contact > 1 ? this.front.corneringStiffness : 0;
    this.frontLoadUsed = q.frontLoad * contact;
    this.frontMuUsed = q.frontMu;
    const rearFy = this.sideForce(
      this.rear,
      q.rearLoad,
      q.rearMu,
      q.lean,
      rearAngle,
      this.lateralSpeed - g.rearArm * this.yawRate,
      v,
      q.rearFx,
    );
    this.rearLimit = this.sideLimit;
    const rearStiffness = q.rearLoad > 1 && q.rearMu > 0 ? this.rear.corneringStiffness : 0;
    const oldRear =
      q.inertialContacts &&
      this.rearElasticStiffness > 0 &&
      rearStiffness !== this.rearElasticStiffness
        ? (this.rearFy * rearStiffness) / this.rearElasticStiffness
        : this.rearFy;
    this.rearElasticStiffness = rearStiffness;
    this.rearSlipAngle = this.rear.alpha;
    // Transient lateral contact forces relax over distance travelled.
    const mix = 1 - Math.exp((-dt * Math.max(v, 3)) / MOTOGP_SLICK.relaxationLength);
    // Relaxation delays the build-up of carcass deflection, never the friction
    // limit: a contact whose load or grip falls cannot keep its old force.
    this.frontFy = clamp(oldFront + (frontFy - oldFront) * mix, -this.frontLimit, this.frontLimit);
    this.rearFy = clamp(oldRear + (rearFy - oldRear) * mix, -this.rearLimit, this.rearLimit);
    const frontSide = this.frontFy * Math.cos(steer) + q.frontFx * Math.sin(steer);
    const rearSin = Math.sin(rearAngle),
      rearCos = Math.cos(rearAngle);
    const rearSide = this.rearFy * rearCos + q.rearFx * rearSin;
    const lateral = frontSide + rearSide;
    const yawMoment = g.frontArm * frontSide - g.rearArm * rearSide;
    this.lateralAcceleration = lateral / Math.max(1, q.mass);
    this.yawRate += (yawMoment / g.yawInertia) * dt;
    if (q.inertialContacts) {
      // Both longitudinal tyre forces are already in q.speed. Add only
      // the projection difference and scrub from the two wheel frames.
      this.longitudinalCorrection =
        (q.frontFx * (Math.cos(steer) - 1) -
          this.frontFy * Math.sin(steer) +
          q.rearFx * (rearCos - 1) -
          this.rearFy * rearSin) /
        Math.max(1, q.mass);
      const forward = v + this.longitudinalCorrection * dt,
        side = this.lateralSpeed + this.lateralAcceleration * dt;
      // A yawing body rotates BOTH velocity components. Advancing only
      // side' = ay - v*r manufactures kinetic energy during a slide. Clip
      // yaw before using the same rotation that the adapter gives its pose.
      this.yawRate = clamp(this.yawRate, -2.5, 2.5);
      const turn = this.yawRate * dt,
        cos = Math.cos(turn),
        sin = Math.sin(turn);
      this.forwardSpeed = Math.max(0, forward * cos + side * sin);
      this.lateralSpeed = side * cos - forward * sin;
    } else {
      this.lateralSpeed += (this.lateralAcceleration - v * this.yawRate) * dt;
      this.yawRate = clamp(this.yawRate, -2.5, 2.5);
    }
    // Dissipative numerical limits only, for the incident transition.
    this.lateralSpeed = clamp(this.lateralSpeed, -0.8 * Math.max(v, 1), 0.8 * Math.max(v, 1));
    this.stepWheels(q);
    return this;
  }

  /** Ground-plane steer producing `force` N in the CHASSIS lateral frame.
   * Invert the same combined-slip law and signed front-force projection as
   * the plant, using current load/friction when the suspension provides it.
   * The nearest pre-peak root avoids steering through the tyre-force peak;
   * the existing 3% inverse reserve remains inside the achievable range.
   * Returns null without a loaded, rolling front contact. */
  frontSteerFor(
    force: number,
    lean: number,
    speed: number,
    longitudinal: number,
    load = this.frontLoadUsed,
    mu = this.frontMuUsed,
  ) {
    if (!(load > 1 && mu > 0 && speed >= 2.5)) return null;
    const state = this.inverseFront;
    prepareSlip(MOTOGP_SLICK, load, Math.max(0.05, mu) * gpCamberFriction(lean), 1, 1, 1, state);
    const limit = Math.sqrt(Math.max(0, state.dy ** 2 - longitudinal ** 2)),
      geometric = Math.atan2(
        this.lateralSpeed + this.geometry.frontArm * this.yawRate,
        Math.max(1, speed),
      ),
      neutral = geometric - camberShift(MOTOGP_SLICK, load, state, lean, speed),
      radius = 0.9 * state.alphaRef,
      start = neutral - radius,
      step = (2 * radius) / (this.inverseForces.length - 1),
      at = (steer: number) => {
        state.alpha = neutral - steer;
        const lateral = this.preparedSideForce(state, longitudinal, limit);
        return lateral * Math.cos(steer) + longitudinal * Math.sin(steer);
      };
    // Projection and combined slip can move the peak within the pure-slip
    // bracket. Locate a physical root before bisecting, rather than assuming
    // that a pure-slip inverse remains monotone under signed braking.
    let minimum = Infinity,
      maximum = -Infinity;
    for (let i = 0; i < this.inverseForces.length; i++) {
      const value = (this.inverseForces[i] = at(start + i * step));
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const zero = this.inverseForces[8],
      target = clamp(force, zero + 0.97 * (minimum - zero), zero + 0.97 * (maximum - zero));
    let index = -1,
      nearest = Infinity;
    for (let i = 0; i < this.inverseForces.length - 1; i++) {
      const a = this.inverseForces[i],
        b = this.inverseForces[i + 1],
        distance = Math.abs(i + 0.5 - 8);
      if (target >= Math.min(a, b) && target <= Math.max(a, b) && distance < nearest) {
        index = i;
        nearest = distance;
      }
    }
    if (index < 0) return neutral;
    let lo = start + index * step,
      hi = lo + step;
    const increasing = this.inverseForces[index + 1] > this.inverseForces[index];
    for (let i = 0; i < 20; i++) {
      const mid = 0.5 * (lo + hi);
      if (at(mid) < target === increasing) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Predict the rear force the next contact evaluation will actually apply,
   * including current support, combined slip, carcass relaxation and the
   * immediate friction clamp. This does not advance any physical state. */
  rearForceFor(
    load: number,
    mu: number,
    lean: number,
    speed: number,
    longitudinal: number,
    dt: number,
    groundAngle = 0,
  ) {
    if (!(load > 1 && mu > 0)) return 0;
    const state = this.previewRear,
      friction = Math.max(0.05, mu) * gpCamberFriction(lean);
    prepareSlip(MOTOGP_SLICK, load, friction, 1, 1, 1, state);
    state.alpha =
      Math.atan2(this.lateralSpeed - this.geometry.rearArm * this.yawRate, Math.max(1, speed)) -
      groundAngle -
      camberShift(MOTOGP_SLICK, load, state, lean, speed);
    const limit = Math.sqrt(Math.max(0, state.dy ** 2 - longitudinal ** 2)),
      raw = this.preparedSideForce(state, longitudinal, limit),
      mix = 1 - Math.exp((-dt * Math.max(speed, 3)) / MOTOGP_SLICK.relaxationLength);
    // Preview the same strain interpretation without advancing the stored
    // preparation or force: repeated controller queries must be read-only.
    const oldRear =
      this.rearElasticStiffness > 0 && state.corneringStiffness !== this.rearElasticStiffness
        ? (this.rearFy * state.corneringStiffness) / this.rearElasticStiffness
        : this.rearFy;
    const force = clamp(oldRear + (raw - oldRear) * mix, -limit, limit);
    return force * Math.cos(groundAngle) + longitudinal * Math.sin(groundAngle);
  }

  private sideForce(
    state: ReturnType<typeof slipState>,
    load: number,
    mu: number,
    lean: number,
    steer: number,
    lateralVelocity: number,
    speed: number,
    longitudinal: number,
  ) {
    this.sideLimit = 0;
    if (load <= 1 || mu <= 0) return 0;
    const friction = Math.max(0.05, mu) * gpCamberFriction(lean);
    prepareSlip(MOTOGP_SLICK, load, friction, 1, 1, 1, state);
    const alpha = Math.atan2(lateralVelocity, Math.max(1, speed)) - steer;
    state.alpha = alpha - camberShift(MOTOGP_SLICK, load, state, lean, speed);
    this.sideLimit = Math.sqrt(Math.max(0, state.dy ** 2 - longitudinal ** 2));
    return this.preparedSideForce(state, longitudinal, this.sideLimit);
  }

  /** Shared by the forward contact and steering inverse. */
  private preparedSideForce(
    state: ReturnType<typeof slipState>,
    longitudinal: number,
    limit: number,
  ) {
    // Longitudinal force demand spends part of the same tyre friction budget.
    const ratio = clamp(longitudinal / Math.max(1, state.dx), -1, 1);
    const kappa = Math.sign(ratio) * Math.min(0.95, Math.abs(ratio)) * state.kappaRef;
    combinedForces(state, kappa, this.force);
    return clamp(this.force.fy, -limit, limit);
  }

  private stepWheels(q: MotoGPContactStep) {
    const g = this.geometry;
    const v = Math.max(0, q.speed);
    const frontRadius = q.frontRadius ?? g.frontRadius;
    const rearRadius = q.rearRadius ?? g.rearRadius;
    const forward = q.inertialContacts ? this.forwardSpeed : v;
    const frontSide = this.lateralSpeed + g.frontArm * this.yawRate;
    const cs = Math.cos(this.groundSteer),
      sn = Math.sin(this.groundSteer);
    const frontAlong = forward * cs + frontSide * sn;
    const frontAcross = frontSide * cs - forward * sn;
    const rearAngle = q.rearGroundAngle ?? 0;
    const rearSin = Math.sin(rearAngle),
      rearCos = Math.cos(rearAngle);
    const rearSide = this.lateralSpeed - g.rearArm * this.yawRate;
    const rearAlong = forward * rearCos + rearSide * rearSin;
    const rearAcross = rearSide * rearCos - forward * rearSin;
    const frontScale = Math.max(2, Math.abs(frontAlong)),
      rearScale = Math.max(2, Math.abs(rearAlong));
    const frontPeak = Math.max(1, q.frontLoad * q.frontMu);
    const rearPeak = Math.max(1, q.rearLoad * q.rearMu);
    const targetFrontSlip = clamp(q.frontFx / frontPeak, -0.98, 0.98) * 0.065;
    const targetRearSlip = clamp(q.rearFx / rearPeak, -0.98, 0.98) * 0.065;
    const targetFront = (frontAlong + targetFrontSlip * frontScale) / frontRadius;
    const targetRear = (rearAlong + targetRearSlip * rearScale) / rearRadius;
    const frontTau = clamp(
      (g.frontWheelInertia * Math.max(frontScale, 4)) / (4000 * frontRadius ** 2),
      0.012,
      0.09,
    );
    const rearTau = clamp(
      (g.rearWheelInertia * Math.max(rearScale, 4)) / (4000 * rearRadius ** 2),
      0.012,
      0.09,
    );
    if (!q.inertialContacts || q.frontLoad * q.frontContact > 1e-6)
      this.frontOmega += (targetFront - this.frontOmega) * (1 - Math.exp(-q.dt / frontTau));
    if (!q.inertialContacts || q.rearLoad > 1e-6)
      this.rearOmega += (targetRear - this.rearOmega) * (1 - Math.exp(-q.dt / rearTau));
    this.frontOmega = Math.max(
      0,
      this.frontOmega - (q.frontBrakeExcess * g.frontRadius * q.dt) / g.frontWheelInertia,
    );
    this.rearOmega = Math.max(
      0,
      this.rearOmega +
        ((q.rearDriveExcess - q.rearBrakeExcess) * g.rearRadius * q.dt) / g.rearWheelInertia,
    );
    this.frontOmega = Math.min(500, this.frontOmega);
    this.rearOmega = Math.min(500, this.rearOmega);
    const frontRim = this.frontOmega * frontRadius,
      rearRim = this.rearOmega * rearRadius;
    this.frontSlip = clamp((frontRim - frontAlong) / frontScale, -1, 6);
    this.rearSlip = clamp((rearRim - rearAlong) / rearScale, -1, 6);
    // Force, rim velocity and slip work must all refer to the same patch.
    this.frontSlidingPower =
      q.frontLoad * q.frontContact > 1e-6
        ? motorcycleWheelSlipPower(q.frontFx, this.frontFy, frontAlong, frontAcross, frontRim)
        : 0;
    this.rearSlidingPower =
      q.rearLoad > 1e-6
        ? motorcycleWheelSlipPower(q.rearFx, this.rearFy, rearAlong, rearAcross, rearRim)
        : 0;
  }
}
