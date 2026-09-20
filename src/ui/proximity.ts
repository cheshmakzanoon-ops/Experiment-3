import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';
export interface Proximity {
  left: 'clear' | 'near' | 'overlap';
  right: 'clear' | 'near' | 'overlap';
}
/** Physical relative positions, not standings or guessed track gaps. The
 * vertical gate avoids cars on a different road level; no simulated input is written. */
export function nearbyTraffic(frame: Float32Array): Proximity {
  const result: Proximity = { left: 'clear', right: 'clear' },
    cars = frame[H.CARS];
  if (
    !Number.isInteger(cars) ||
    cars < 1 ||
    cars > 12 ||
    frame.length !== HEADER + cars * CAR_STRIDE ||
    frame[H.PHASE] !== 2
  )
    return result;
  const player = carBase(0);
  if (frame[player + F.RETIRED] || frame[player + F.FINISH]) return result;
  const qx = frame[player + F.QX],
    qy = frame[player + F.QY],
    qz = frame[player + F.QZ],
    qw = frame[player + F.QW];
  const rightX = 1 - 2 * (qy * qy + qz * qz),
    rightZ = 2 * (qx * qz - qw * qy);
  const forwardX = 2 * (qx * qz + qw * qy),
    forwardZ = 1 - 2 * (qx * qx + qy * qy);
  for (let id = 1; id < cars; id++) {
    const o = carBase(id);
    if (frame[o + F.RETIRED] || frame[o + F.FINISH]) continue;
    const dx = frame[o + F.X] - frame[player + F.X],
      dy = frame[o + F.Y] - frame[player + F.Y],
      dz = frame[o + F.Z] - frame[player + F.Z];
    const side = dx * rightX + dz * rightZ,
      along = dx * forwardX + dz * forwardZ;
    if (
      ![side, along, dy].every(Number.isFinite) ||
      Math.abs(dy) > 2.5 ||
      Math.abs(along) > 12 ||
      Math.abs(side) < 0.8 ||
      Math.abs(side) > 8
    )
      continue;
    const key = side < 0 ? 'left' : 'right';
    if (Math.abs(along) < 5.6 && Math.abs(side) < 4.5) result[key] = 'overlap';
    else if (result[key] === 'clear') result[key] = 'near';
  }
  return result;
}
