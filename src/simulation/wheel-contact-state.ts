import { Vec3 } from '../core/math.ts';
import {
  BC,
  C,
  ROAD_BIKE_CONTACT,
  MX_FOOT,
  MX_MOTION,
  MX_PUSH,
  WHEEL_CONTACT_BASE,
  WHEEL_CONTACT_SIZE,
  wheelContactBase,
} from './protocol.ts';
import { BikeVehicle } from './bike-vehicle.ts';
import { DirtBikeVehicle } from './offroad/dirt-bike-vehicle.ts';
import type { Vehicle } from './vehicle.ts';

const local = new Vec3();

/** Record the force solver's contact geometry. The rim follows hub travel;
 * radial tire compression is the force solver's road-normal deformation.
 * This prevents rendering the spring and tire travel
 * twice. No normal, strain or suspension state is inferred from force. */
export function writeWheelContact(out: Float32Array, car: number, vehicle: Vehicle) {
  const block = car + WHEEL_CONTACT_BASE;
  out.fill(0, block, block + WHEEL_CONTACT_SIZE);
  // A road bike publishes its actual sampled planes, never inherited car-hub
  // fields. The explicit tag distinguishes its sprung CG from old wheel-plane
  // snapshots. MX, placement and stands retain their separate pose contracts.
  if (vehicle.definition.bike) {
    if (vehicle instanceof DirtBikeVehicle && vehicle.definition.tireFamily === 'knobby') {
      if (vehicle.riding) {
        const stroke = vehicle.gearStroke.sample(vehicle.clock);
        out[car + MX_FOOT.ANGLE] = stroke.angle;
        out[car + MX_FOOT.COVER] = stroke.cover;
        out[car + MX_FOOT.CLEAR] = stroke.clear;
        const motion = vehicle.machineMotion;
        if (motion?.valid) {
          out[car + MX_MOTION.VALID] = 1;
          out[car + MX_MOTION.FORK_RATE] = motion.forkRate;
          out[car + MX_MOTION.SHOCK_RATE] = motion.shockRate;
          out[car + MX_MOTION.STEER_RATE] = motion.steerRate;
          out[car + MX_MOTION.FRONT_FLEX] = motion.front.position;
          out[car + MX_MOTION.FRONT_FLEX_RATE] = motion.front.rate;
          out[car + MX_MOTION.REAR_FLEX] = motion.rear.position;
          out[car + MX_MOTION.REAR_FLEX_RATE] = motion.rear.rate;
          out[car + MX_MOTION.CHAIN_PULL] = motion.chainPull;
        }
      } else if (vehicle.dynamics.state === 'remount') {
        out[car + MX_PUSH.RECORDED] = 1;
        out[car + MX_PUSH.VX] = vehicle.pushGait.x;
        out[car + MX_PUSH.VZ] = vehicle.pushGait.z;
        out[car + MX_PUSH.PHASE] = vehicle.pushGait.phase;
      }
      return;
    }
    if (!(vehicle instanceof BikeVehicle) || !vehicle.sprungRoadPose) return;
    for (let wheel = 0; wheel < 4; wheel += 2) {
      const point = vehicle.contactPoints[wheel],
        normal = vehicle.contacts[wheel].normal,
        gap = wheel === 0 ? vehicle.roadSuspension.frontGap : vehicle.roadSuspension.rearGap,
        load = wheel === 0 ? vehicle.roadSuspension.frontLoad : vehicle.roadSuspension.rearLoad,
        length = normal.length();
      if (
        !Number.isFinite(point.x + point.y + point.z + length + gap + load) ||
        length < 1e-8 ||
        normal.y / length < 0.2 ||
        gap < 0 ||
        load < 0
      ) {
        out.fill(0, block, block + WHEEL_CONTACT_SIZE);
        return;
      }
      const p = wheelContactBase(car, wheel);
      out[p + BC.X] = point.x;
      out[p + BC.Y] = point.y;
      out[p + BC.Z] = point.z;
      out[p + BC.GAP] = gap;
      out[p + BC.NORMAL_X] = normal.x / length;
      out[p + BC.NORMAL_Y] = normal.y / length;
      out[p + BC.NORMAL_Z] = normal.z / length;
      out[p + BC.LOAD] = load;
    }
    out[block] = ROAD_BIKE_CONTACT;
    return;
  }
  let mask = 0;
  for (let wheel = 0; wheel < 4; wheel++) {
    const tire = vehicle.tires[wheel],
      normal = vehicle.contacts[wheel].normal,
      rest =
        vehicle.spec.restLength +
        (wheel < 2 ? vehicle.setup.frontRide - 0.065 : vehicle.setup.rearRide - 0.075),
      hubLength = rest - vehicle.hub.travel[wheel],
      cosine = Math.max(0, vehicle.up.dot(normal)),
      grounded = vehicle.hub.contact[wheel] !== 0 && tire.load >= 1,
      radial = grounded ? tire.deflection : 0,
      longitudinal = grounded ? tire.longitudinalDeflection : 0,
      lateral = grounded ? tire.lateralDeflection : 0,
      origin = vehicle.origins[wheel],
      point = vehicle.contactPoints[wheel],
      planeDistance = grounded
        ? (origin.x - point.x) * normal.x +
          (origin.y - point.y) * normal.y +
          (origin.z - point.z) * normal.z -
          hubLength * cosine
        : tire.radius;
    // Rwheel = Rbody Ry(steer) Rz(-camber). Inverse rotate the road normal
    // into that non-spinning frame, matching RoadContactFrame's axle.
    if (grounded) vehicle.body.orientation.inverseRotate(normal, local);
    else local.set(0, 1, 0);
    const steer = vehicle.wheelSteering[wheel],
      camber = vehicle.wheelCamber[wheel],
      cs = Math.cos(steer),
      ss = Math.sin(steer),
      cc = Math.cos(camber),
      sc = Math.sin(camber),
      x = cs * local.x - ss * local.z,
      nz = ss * local.x + cs * local.z,
      nx = grounded ? cc * x - sc * local.y : 0,
      ny = grounded ? sc * x + cc * local.y : 1,
      normalZ = grounded ? nz : 0,
      magnitude = Math.hypot(nx, ny, normalZ);
    if (
      !Number.isFinite(longitudinal + lateral + radial + hubLength + magnitude + planeDistance) ||
      magnitude < 1e-8 ||
      Math.hypot(ny, normalZ) < 1e-8 ||
      radial < 0
    )
      continue;
    const p = wheelContactBase(car, wheel);
    out[p + C.LONGITUDINAL] = longitudinal;
    out[p + C.LATERAL] = lateral;
    out[p + C.RADIAL] = radial;
    out[p + C.HUB_LENGTH] = hubLength;
    out[p + C.NORMAL_X] = nx / magnitude;
    out[p + C.NORMAL_Y] = ny / magnitude;
    out[p + C.NORMAL_Z] = normalZ / magnitude;
    out[p + C.PLANE_DISTANCE] = planeDistance;
    mask |= 1 << wheel;
  }
  out[block] = mask;
}
