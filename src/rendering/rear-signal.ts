import * as T from 'three';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';

/** Preserve the existing original rear-signal behaviour, shared by the visible
 * lamp and its near-spray tint. Simulation time is the only phase source. */
export function rearSignalIntensity(brake: number, time: number) {
  if (![brake, time].every(Number.isFinite)) return 0;
  return brake > 0.1 ? 2.5 : Math.sin(time * 12) > 0 ? 1.4 : 0.1;
}

/** All supported cars fit in a fixed twelve-source uniform array. Keeping their
 * identities stable avoids nearest-light switching/pop at a pack boundary.
 * This is bounded, unshadowed single-scatter tint, not a volumetric light solver. */
export class RearSignalField {
  readonly positions = Array.from({ length: 12 }, () => new T.Vector4());
  readonly directions = Array.from({ length: 12 }, () => new T.Vector3(0, 0, -1));
  readonly count = { value: 0 };
  private q = new T.Quaternion();
  private p = new T.Vector3();
  update(frame: Float32Array, enabled = true) {
    this.count.value = 0;
    const cars = frame[H.CARS];
    if (!enabled) return;
    if (
      !Number.isInteger(cars) ||
      cars < 0 ||
      cars > 12 ||
      frame.length < HEADER + CAR_STRIDE * cars ||
      !Number.isFinite(frame[H.TIME])
    )
      throw new Error('Invalid rear-signal frame');
    for (let id = 0; id < cars; id++) {
      const o = carBase(id);
      const values = [
        frame[o + F.X],
        frame[o + F.Y],
        frame[o + F.Z],
        frame[o + F.QX],
        frame[o + F.QY],
        frame[o + F.QZ],
        frame[o + F.QW],
        frame[o + F.BRAKE],
      ];
      if (!values.every(Number.isFinite)) throw new Error('Non-finite rear-signal pose');
      this.q.set(values[3], values[4], values[5], values[6]);
      if (Math.abs(this.q.lengthSq() - 1) > 0.02)
        throw new Error('Invalid rear-signal orientation');
      this.q.normalize();
      this.p.set(0, -0.23, -2.28).applyQuaternion(this.q);
      this.positions[id].set(
        values[0] + this.p.x,
        values[1] + this.p.y,
        values[2] + this.p.z,
        rearSignalIntensity(values[7], frame[H.TIME]),
      );
      this.directions[id].set(0, 0, -1).applyQuaternion(this.q);
    }
    this.count.value = cars;
  }
}
