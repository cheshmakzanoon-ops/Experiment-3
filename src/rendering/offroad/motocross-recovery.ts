import * as T from 'three';
import type { BikeState } from '../../simulation/bike.ts';
import { MX_RECOVERY } from '../../simulation/offroad/rider-recovery.ts';
import type { Rider } from '../rider.ts';
import type { MxDabSurface } from './motocross-dab.ts';

const UP = new T.Vector3(0, 1, 0);
const IDENTITY = new T.Quaternion();

/** The separated rider has a recorded world pelvis and a ground surface of
 * their own. The fallen motorcycle can be on the opposite side of a jump. */
export class MxRecoveryPose {
  private readonly floor = new T.Plane();
  private readonly tilt = new T.Quaternion();
  private readonly local = new T.Matrix4();
  private readonly offset = new T.Vector3();

  place(
    rider: Rider,
    point: T.Vector3,
    heading: number,
    state: BikeState,
    clock: number,
    standing: number,
    tumble: number,
    time: number,
    surface?: MxDabSurface,
  ) {
    const floor = surface?.planeAtWorld(point, this.floor) ? this.floor : undefined;
    const clearance = floor ? floor.distanceToPoint(point) / floor.normal.y : Infinity;
    const remount = state === 'remount';
    let rise = remount
      ? 1
      : state === 'separated' && clock >= MX_RECOVERY.restSeconds
        ? T.MathUtils.clamp(standing, 0, 1)
        : 0;
    if (floor && !remount) {
      // Older frames carried the preceding peg posture into a crash. Bound
      // that value by the recorded pelvis above the dirt under the rider.
      const expected = T.MathUtils.lerp(MX_RECOVERY.slideHeight, MX_RECOVERY.uprightHeight, rise);
      if (Math.abs(clearance - expected) > 0.14) {
        const supported =
          (clearance - MX_RECOVERY.slideHeight) /
          (MX_RECOVERY.uprightHeight - MX_RECOVERY.slideHeight);
        rise =
          clearance > MX_RECOVERY.uprightHeight + 0.14
            ? 0
            : Math.min(rise, T.MathUtils.clamp(supported, 0, 1));
      }
    }
    rider.root.quaternion.setFromAxisAngle(UP, heading);
    if (floor) {
      const support = (1 - rise) * (1 - T.MathUtils.smoothstep(clearance, 0.17, 0.49));
      this.tilt.setFromUnitVectors(UP, floor.normal);
      rider.root.quaternion.premultiply(this.tilt.slerp(IDENTITY, 1 - support));
    }
    rider.root.position
      .copy(point)
      .sub(
        this.offset
          .set(0, MX_RECOVERY.uprightHeight * rise, 0)
          .applyQuaternion(rider.root.quaternion),
      );
    if (floor) {
      rider.root.updateWorldMatrix(true, false);
      floor.applyMatrix4(this.local.copy(rider.root.matrixWorld).invert());
    }
    rider.separated(remount ? 2 : rise > 0 ? 1 : 0, tumble, time, rise, floor);
  }
}
