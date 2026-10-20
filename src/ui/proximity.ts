import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  carBase,
} from '../simulation/protocol.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
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
  const gp = vehicleAt(Math.round(frame[player + RACE_BASE + R.VEHICLE])).classId === 'gp-bike';
  if (gp && (frame[player + F.IN_PIT] || frame[player + BIKE_BASE + B.STATE] !== 0))
    return result;
  const qx = frame[player + F.QX],
    qy = frame[player + F.QY],
    qz = frame[player + F.QZ],
    qw = frame[player + F.QW];
  const bodyX = 1 - 2 * (qy * qy + qz * qz),
    bodyZ = 2 * (qx * qz - qw * qy);
  const forwardX = 2 * (qx * qz + qw * qy),
    forwardZ = 1 - 2 * (qx * qx + qy * qy);
  // GP roll must not shrink the lateral axis: at 60 degrees a rival 1.4 m
  // away projected below the old 0.8 m threshold and disappeared. Flatten
  // and normalize the nose, then take its ground-plane perpendicular.
  // In the motorcycle frame +X is the rider's LEFT (protocol.ts and
  // bikeOrientation), so a positive projection belongs to the left arrow.
  // Keep the existing other-family convention unchanged in this GP pass.
  const forwardLength = Math.hypot(forwardX, forwardZ);
  if (gp && (!Number.isFinite(forwardLength) || forwardLength < 0.2)) return result;
  const noseX = gp ? forwardX / forwardLength : forwardX,
    noseZ = gp ? forwardZ / forwardLength : forwardZ,
    sideX = gp ? noseZ : bodyX,
    sideZ = gp ? -noseX : bodyZ;
  for (let id = 1; id < cars; id++) {
    const o = carBase(id);
    if (frame[o + F.RETIRED] || frame[o + F.FINISH] || (gp && frame[o + F.IN_PIT]))
      continue;
    const dx = frame[o + F.X] - frame[player + F.X],
      dy = frame[o + F.Y] - frame[player + F.Y],
      dz = frame[o + F.Z] - frame[player + F.Z];
    const side = dx * sideX + dz * sideZ,
      along = dx * noseX + dz * noseZ;
    if (
      ![side, along, dy].every(Number.isFinite) ||
      Math.abs(dy) > 2.5 ||
      Math.abs(along) > 12 ||
      Math.abs(side) < (gp ? 0.35 : 0.8) ||
      Math.abs(side) > (gp ? 6 : 8)
    )
      continue;
    const key = (gp ? side > 0 : side < 0) ? 'left' : 'right';
    const gpPair =
      gp && vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])).classId === 'gp-bike';
    // A motorcycle has a shorter overlap zone than a car. Leave extra
    // lateral room while either rider hangs off; these are authored warning
    // distances, not collision bounds or dimensions measured from a photo.
    const playerLean = frame[player + BIKE_BASE + B.LEAN],
      otherLean = frame[o + BIKE_BASE + B.LEAN],
      leanRoom =
        gpPair && Number.isFinite(playerLean + otherLean)
          ? Math.max(Math.abs(Math.sin(playerLean)), Math.abs(Math.sin(otherLean)))
          : 1;
    if (
      Math.abs(along) < (gpPair ? 3.3 : 5.6) &&
      Math.abs(side) < (gpPair ? 2.6 + 0.8 * leanRoom : 4.5)
    )
      result[key] = 'overlap';
    else if (result[key] === 'clear') result[key] = 'near';
  }
  return result;
}
