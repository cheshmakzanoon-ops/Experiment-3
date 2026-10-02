import * as T from 'three';
import type { JackPoint, JackRole } from '../../src/rendering/a32-jack-pose.ts';

/** Independent acceptance oracle, not the production pitJackClearance helper.
 * A loaded/lowering pad stays on its measured chassis socket. Once fully down,
 * phase 5 moves the front jack right and rear jack left by 1.55 m over
 * 4.72..5.15 service seconds. Withdrawal is not a failed lifting contact.
 * All comparisons are car-local, including the original ground tolerance. */
export function measureA32Contact(
  role: JackRole,
  phase: number,
  clock: number,
  height: number,
  actual: T.Vector3,
  fit: JackPoint,
  ground: T.Vector3,
) {
  if (
    !['front', 'rear'].includes(role) ||
    !Number.isInteger(phase) ||
    phase < 2 ||
    phase > 5 ||
    clock < 0 ||
    height < 0 ||
    fit.length !== 3 ||
    ![phase, clock, height, ...actual.toArray(), ...fit, ...ground.toArray()].every(Number.isFinite)
  )
    throw new Error('Invalid A32 contact witness');
  const clear = phase === 5 && height <= 1e-6;
  const u = clear ? Math.max(0, Math.min(1, (clock - 4.72) / 0.43)) : 0;
  const expectedOffset = (role === 'front' ? 1 : -1) * 1.55 * u * u * (3 - 2 * u);
  const anchor = new T.Vector3(...fit);
  const carContactError = actual.distanceTo(anchor);
  anchor.x += expectedOffset;
  return {
    role,
    phase,
    clock,
    height,
    state: expectedOffset === 0 ? 'contact' : 'withdrawing',
    expectedOffset,
    observedOffset: actual.x - fit[0],
    carContactError,
    error: actual.distanceTo(anchor),
    floorError: Math.abs(ground.y - (-0.43 - height)),
  };
}
