import * as T from 'three';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { factoryBikeSag } from '../../simulation/offroad/suspension-geometry.ts';

export const MX_RAKE = 0.47,
  MX_AXLE_OFFSET = 0.022;
const FORK_LENGTH = 0.92,
  SIN_RAKE = Math.sin(MX_RAKE),
  COS_RAKE = Math.cos(MX_RAKE);
const designs = new WeakMap<VehicleDefinition, MotocrossAxles>();

/** The display rig, ground shadows and flying soil all use the same two axle
 * paths. The worker records vertical suspension stroke in metres. Steering
 * takes place about the inclined head, and the rear arm has a fixed length. */
export class MotocrossAxles {
  readonly sag: { fork: number; shock: number };
  readonly head: T.Vector3;
  readonly pivot = new T.Vector3(0, -0.36, -0.15);
  readonly rearRest: T.Vector3;
  readonly armLength: number;
  readonly frontWidth: number;
  readonly rearWidth: number;

  private constructor(private readonly def: VehicleDefinition) {
    const b = def.bike!;
    this.sag = factoryBikeSag(def);
    this.head = new T.Vector3(
      0,
      b.frontWheelRadius - b.cgHeight + COS_RAKE * FORK_LENGTH - SIN_RAKE * MX_AXLE_OFFSET,
      b.cgToFront - SIN_RAKE * FORK_LENGTH - COS_RAKE * MX_AXLE_OFFSET,
    );
    this.rearRest = new T.Vector3(0, b.rearWheelRadius - b.cgHeight, -b.cgToRear);
    this.armLength = this.rearRest.distanceTo(this.pivot);
    this.frontWidth = def.tireFamily === 'supermoto' ? 0.06 : 0.042;
    this.rearWidth = def.tireFamily === 'supermoto' ? 0.085 : 0.06;
  }
  static of(definition: VehicleDefinition) {
    let axles = designs.get(definition);
    if (!axles) designs.set(definition, (axles = new MotocrossAxles(definition)));
    return axles;
  }
  lowerY(fork: number) {
    const travel = T.MathUtils.clamp(fork, 0, this.def.bike!.forkTravel);
    return -FORK_LENGTH + (travel - this.sag.fork) / COS_RAKE;
  }
  rearHub(shock: number, target: T.Vector3) {
    const travel = T.MathUtils.clamp(shock, 0, this.def.bike!.shockTravel);
    const y = this.rearRest.y + travel - this.sag.shock;
    const dz = -Math.sqrt(Math.max(0, this.armLength ** 2 - (y - this.pivot.y) ** 2));
    return target.set(this.pivot.x, y, this.pivot.z + dz);
  }
  hub(front: boolean, travel: number, steer: number, position: T.Vector3, axle: T.Vector3) {
    if (!front) {
      axle.set(1, 0, 0);
      return this.rearHub(travel, position);
    }
    const sin = Math.sin(steer),
      cos = Math.cos(steer),
      lower = this.lowerY(travel);
    axle.set(cos, -SIN_RAKE * sin, -COS_RAKE * sin);
    return position.set(
      MX_AXLE_OFFSET * sin,
      this.head.y + COS_RAKE * lower + SIN_RAKE * MX_AXLE_OFFSET * cos,
      this.head.z - SIN_RAKE * lower + COS_RAKE * MX_AXLE_OFFSET * cos,
    );
  }

  /** Support point of the rounded tread in a bank's normal direction. At
   * large camber it reaches the shoulder. It cannot slide out past the tyre.
   * The returned forward vector is tangent to both ground and wheel plane. */
  groundPoint(
    front: boolean,
    hub: T.Vector3,
    axle: T.Vector3,
    normal: T.Vector3,
    position: T.Vector3,
    forward: T.Vector3,
  ) {
    const width = front ? this.frontWidth : this.rearWidth;
    const radius = front ? this.def.bike!.frontWheelRadius : this.def.bike!.rearWheelRadius;
    const crown = width * 1.15;
    const lateral = T.MathUtils.clamp(normal.dot(axle), -1, 1);
    const side = T.MathUtils.clamp(lateral, -width / crown, width / crown);
    const inward = radius - crown + crown * Math.sqrt(1 - side ** 2);
    forward.crossVectors(axle, normal);
    if (forward.lengthSq() < 1e-9) {
      // A fallen wheel can be parallel to the ground. Its contact is broad
      // and has no unique rolling tangent; keep a deterministic ground basis.
      forward.set(Math.abs(normal.z) < 0.9 ? 0 : 1, 0, Math.abs(normal.z) < 0.9 ? 1 : 0);
      forward.addScaledVector(normal, -forward.dot(normal));
    }
    forward.normalize();
    position
      .crossVectors(forward, axle)
      .multiplyScalar(-inward)
      .addScaledVector(axle, -crown * side)
      .add(hub);
    return position;
  }
}
