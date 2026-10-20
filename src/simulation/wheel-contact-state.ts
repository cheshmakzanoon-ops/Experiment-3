import { Vec3 } from '../core/math.ts';
import { C, WHEEL_CONTACT_BASE, WHEEL_CONTACT_SIZE, wheelContactBase } from './protocol.ts';
import type { Vehicle } from './vehicle.ts';

const local = new Vec3();

/** Record the force solver's contact geometry. The rim follows hub travel;
 * radial tire compression is the force solver's road-normal deformation.
 * This prevents rendering the spring and tire travel
 * twice. No normal, strain or suspension state is inferred from force. */
export function writeWheelContact(out: Float32Array, car: number, vehicle: Vehicle) {
  const block = car + WHEEL_CONTACT_BASE;
  out.fill(0, block, block + WHEEL_CONTACT_SIZE);
  // GP and MX have separate contact models. Their inherited car hub fields
  // are not measured motorcycle suspension or carcass displacement.
  if (vehicle.definition.bike) return;
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
