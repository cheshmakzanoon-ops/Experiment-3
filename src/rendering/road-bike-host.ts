import * as T from 'three';
import { sampleChassisPose } from './snapshot-interpolation.ts';

/** A motorcycle supplies its own wheels, suspension, rider and paint. A grid
 * slot only needs this interpolated frame for camera, standings and effects. */
export class RoadBikeHost {
  readonly root = new T.Group();
  readonly suppliedPlayer = null;
  readonly mirrors: T.Mesh[] = [];
  readonly reflectivePaint: T.Material[] = [];
  constructor(readonly id: number) {
    this.root.name = 'Road motorcycle ' + (id + 1) + ' presentation frame';
  }
  update(a: Float32Array, b: Float32Array, o: number, t: number) {
    sampleChassisPose(a, b, o, t, this.root.position, this.root.quaternion);
  }
}
