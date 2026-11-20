import {
  ROAD_TYRE_HALF_WIDTH,
  tyreShoulderSine,
  tyreRollingRadius,
} from '../simulation/bike-tyre-profile.ts';
import * as T from 'three';
import {
  BC,
  ROAD_BIKE_CONTACT,
  WHEEL_CONTACT_BASE,
  hasRoadBikeContact,
  wheelContactBase,
} from '../simulation/protocol.ts';
import type { VehicleDefinition } from '../simulation/vehicles.ts';
import { presentationAlpha, sampleValue, snapshotSource } from './snapshot-interpolation.ts';

export const ROAD_BIKE_RAKE = 0.42,
  ROAD_FORK_OFFSET = 0.03,
  ROAD_FORK_LENGTH = 0.7;
/** Swingarm pivot in the sprung chassis frame (metres). */
export const ROAD_SWINGARM_PIVOT = [0, -0.13, -0.2] as const;

/** Two measured world planes and vertical free-wheel gaps. No simulation,
 * render clock, force-derived displacement or retained animation history. */
export class RoadBikeContactPose {
  valid = false;
  readonly points = [new T.Vector3(), new T.Vector3()];
  readonly normals = [new T.Vector3(0, 1, 0), new T.Vector3(0, 1, 0)];
  readonly gaps = [0, 0];
  readonly loads = [0, 0];
  sample(a: Float32Array, b: Float32Array, car: number, alpha: number) {
    let t = presentationAlpha(a, b, car, alpha);
    this.valid = hasRoadBikeContact(snapshotSource(a, b, t), car);
    if (!this.valid) return this;
    if (t < 1 && !hasRoadBikeContact(b, car)) t = 0;
    for (let i = 0; i < 2; i++) {
      const p = wheelContactBase(car, i * 2);
      this.points[i].set(
        sampleValue(a, b, p + BC.X, t),
        sampleValue(a, b, p + BC.Y, t),
        sampleValue(a, b, p + BC.Z, t),
      );
      this.normals[i]
        .set(
          sampleValue(a, b, p + BC.NORMAL_X, t),
          sampleValue(a, b, p + BC.NORMAL_Y, t),
          sampleValue(a, b, p + BC.NORMAL_Z, t),
        )
        .normalize();
      this.gaps[i] = sampleValue(a, b, p + BC.GAP, t);
      this.loads[i] = sampleValue(a, b, p + BC.LOAD, t);
    }
    return this;
  }
  write(frame: Float32Array, car: number) {
    if (!this.valid) return;
    frame[car + WHEEL_CONTACT_BASE] = ROAD_BIKE_CONTACT;
    for (let i = 0; i < 2; i++) {
      const p = wheelContactBase(car, i * 2);
      this.points[i].toArray(frame, p + BC.X);
      frame[p + BC.GAP] = this.gaps[i];
      this.normals[i].toArray(frame, p + BC.NORMAL_X);
      frame[p + BC.LOAD] = this.loads[i];
    }
  }
}

/** The tyre's lowest crown/shoulder point relative to its rigid hub. Same
 * profile limits as tyreGeometry. Wheel spin cannot change this support. */
function tyreSupport(
  normal: T.Vector3,
  axle: T.Vector3,
  radius: number,
  crown: number,
  halfWidth: number,
  out: T.Vector3,
) {
  const axial = axle.dot(normal),
    radial = Math.sqrt(Math.max(1e-12, 1 - axial * axial)),
    reach = tyreShoulderSine(halfWidth, crown),
    sine = T.MathUtils.clamp(axial, -reach, reach),
    height = tyreRollingRadius(radius, crown, reach, axial) / radial;
  return out
    .copy(normal)
    .addScaledVector(axle, -axial)
    .multiplyScalar(-height)
    .addScaledVector(axle, -crown * sine);
}

/** Drawn road hubs in the true sprung CG frame. A telescopic fork moves along
 * its steering axis; the GP rear axle follows the circle about its pivot.
 * Only their road-normal support is constrained, so the
 * tyre retains its authored crown, steer, rake and rolling silhouette. The
 * recorded gap preserves wheelies and flight instead of pinning wheels down.
 * Shared by BikeModel and grounding: mesh and contact shadow use one geometry. */
export class RoadBikeWheelPose {
  forkY = -ROAD_FORK_LENGTH;
  rearY = 0;
  rearZ = 0;
  readonly hubs = [new T.Vector3(), new T.Vector3()];
  readonly patches = [new T.Vector3(), new T.Vector3()];
  readonly localGround = new T.Plane();
  private readonly axis = new T.Vector3();
  private readonly axle = new T.Vector3();
  private readonly support = new T.Vector3();
  private readonly local = new T.Vector3();
  private readonly head = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly inverse = new T.Quaternion();
  private readonly localNormal = new T.Vector3();
  private readonly rake = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(1, 0, 0),
    -ROAD_BIKE_RAKE,
  );
  private readonly steer = new T.Quaternion();
  private readonly y = new T.Vector3(0, 1, 0);

  solve(
    definition: VehicleDefinition,
    steer: number,
    position: T.Vector3,
    orientation: T.Quaternion,
    contact: RoadBikeContactPose,
  ) {
    const b = definition.bike!,
      c = Math.cos(ROAD_BIKE_RAKE),
      s = Math.sin(ROAD_BIKE_RAKE);
    this.head.set(
      0,
      b.frontWheelRadius - b.cgHeight + c * ROAD_FORK_LENGTH - s * ROAD_FORK_OFFSET,
      b.cgToFront - s * ROAD_FORK_LENGTH - c * ROAD_FORK_OFFSET,
    );
    this.steer.setFromAxisAngle(this.y, steer);
    this.rotation.copy(this.rake).multiply(this.steer);
    this.inverse.copy(orientation).invert();
    for (let i = 0; i < 2; i++) {
      const normal = contact.normals[i],
        hub = this.hubs[i],
        patch = this.patches[i];
      if (i === 0) {
        // Start at the static fork; solve its extension directly from the
        // physical plane. Applying compression to a sprung body again is wrong.
        this.local
          .set(0, -ROAD_FORK_LENGTH, ROAD_FORK_OFFSET)
          .applyQuaternion(this.rotation)
          .add(this.head);
        this.axis.set(0, c, -s).applyQuaternion(orientation);
        this.axle.set(1, 0, 0).applyQuaternion(this.rotation).applyQuaternion(orientation);
      } else {
        this.local.set(0, b.rearWheelRadius - b.cgHeight, -b.cgToRear);
        this.axis.set(0, 1, 0).applyQuaternion(orientation);
        this.axle.set(1, 0, 0).applyQuaternion(orientation);
      }
      hub.copy(this.local).applyQuaternion(orientation).add(position);
      tyreSupport(
        normal,
        this.axle,
        i === 0 ? b.frontWheelRadius : b.rearWheelRadius,
        i === 0 ? b.crownRadius : Math.max(b.crownRadius, 0.11),
        i === 0 ? ROAD_TYRE_HALF_WIDTH.front : ROAD_TYRE_HALF_WIDTH.rear,
        this.support,
      );
      const distance = normal.dot(hub) + normal.dot(this.support) - normal.dot(contact.points[i]),
        correction = contact.gaps[i] * normal.y - distance;
      if (i === 1 && definition.classId === 'gp-bike') {
        // Intersect the axle's circle in the chassis YZ plane with the road
        // plane offset by the tyre support and recorded free-wheel gap. The
        // rearward intersection is continuous from droop through bump.
        const n = this.localNormal.copy(normal).applyQuaternion(this.inverse),
          [, py, pz] = ROAD_SWINGARM_PIVOT,
          dy = this.local.y - py,
          dz = this.local.z - pz,
          radius = Math.hypot(dy, dz),
          length = Math.hypot(n.y, n.z);
        if (length > 1e-6) {
          const ny = n.y / length,
            nz = n.z / length,
            along = T.MathUtils.clamp((dy * n.y + dz * n.z + correction) / length, -radius, radius),
            back = Math.sqrt(Math.max(0, radius * radius - along * along));
          this.local.set(0, py + ny * along + nz * back, pz + nz * along - ny * back);
        }
        this.rearY = this.local.y;
        this.rearZ = this.local.z;
        hub.copy(this.local).applyQuaternion(orientation).add(position);
      } else {
        const cosine = normal.dot(this.axis),
          adjustment = Math.abs(cosine) > 0.1 ? correction / cosine : 0;
        hub.addScaledVector(this.axis, adjustment);
        if (i === 0) this.forkY = -ROAD_FORK_LENGTH + adjustment;
        else {
          this.rearY = b.rearWheelRadius - b.cgHeight + adjustment;
          this.rearZ = -b.cgToRear;
        }
      }
      patch.copy(hub).add(this.support);
    }
    // The rider uses the mean sampled road plane in the same physical CG
    // frame. The full normal includes both road slope and chassis pitch/roll.
    this.localGround.normal.copy(contact.normals[0]).add(contact.normals[1]).normalize();
    this.local.copy(contact.points[0]).add(contact.points[1]).multiplyScalar(0.5).sub(position);
    this.localGround.constant = -this.localGround.normal.dot(this.local);
    this.localGround.normal.applyQuaternion(this.inverse);
    return this;
  }
}
