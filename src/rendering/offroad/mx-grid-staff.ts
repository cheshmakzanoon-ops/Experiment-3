import * as T from 'three';
import { surfaceSample, type Track } from '../../simulation/track.ts';

/** Two staggered positions inside one grid slot. Behind the rear wheel the
 * team can withdraw down the apron without crossing the neighbouring bikes. */
export const MX_GRID_MARKS = [
  { x: -0.28, z: -1.42, yaw: 0.24 },
  { x: 0.28, z: -2.15, yaw: -0.18 },
] as const;

export class MxGridGround {
  private readonly foot = new T.Vector3();
  private readonly soil = surfaceSample();

  /** Staff and carried equipment stand upright even when the chassis pitches. */
  level(bike: T.Object3D) {
    this.foot.set(0, 0, 1).applyQuaternion(bike.quaternion);
    bike.rotation.set(0, Math.atan2(this.foot.x, this.foot.z), 0);
  }

  floor(bike: T.Object3D, x: number, z: number, cgHeight: number, track?: Track) {
    if (!track) return -cgHeight;
    this.foot.set(x, 0, z).applyMatrix4(bike.matrix);
    track.sample(this.foot.x, this.foot.z, this.soil, bike.position.y - cgHeight);
    return this.soil.height - bike.position.y;
  }
}
