import * as T from 'three';
import type { FormulaCar } from './car.ts';
/** Snapshot-derived world-space focus anchors. No physical pose is changed. */
export function photoSubject(
  car: Pick<FormulaCar, 'root' | 'helmet' | 'steering' | 'wheelPivots'>,
  subject: number,
  out: T.Vector3,
) {
  if (!Number.isInteger(subject) || subject < 0 || subject > 6)
    throw new Error('Invalid photographic detail');
  car.root.updateWorldMatrix(true, true);
  if (subject === 1) return car.helmet.localToWorld(out.set(0, 0.12, 0.02));
  if (subject === 2) return car.steering.localToWorld(out.set(0, 0.025, 0));
  if (subject === 3) {
    const wheel = car.wheelPivots[0];
    if (!wheel) throw new Error('Photographic wheel is unavailable');
    return wheel.getWorldPosition(out);
  }
  const local: readonly [number, number, number] =
    subject === 4
      ? [0, -0.23, 2.28]
      : subject === 5
        ? [0, 0.53, -2.15]
        : subject === 6
          ? [0, 3.1, 8.5]
          : [0, 0.15, 0];
  return car.root.localToWorld(out.set(...local));
}
