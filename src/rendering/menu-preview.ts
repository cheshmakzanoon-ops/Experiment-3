import { Track, trackPoint } from '../simulation/track.ts';
import { DEFAULT_SETUP, VEHICLE } from '../simulation/config.ts';
import {
  F,
  H,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

/** Static menu presentation, not a simulated or award-eligible driving session.
 * Keep the track coordinate, world pose and wheel dimensions consistent: the
 * studio/HQ floor samples F.S, not the position of an unrelated grid-start cell.
 * This level, unladen pose deliberately has no invented tire contact forces. */
export function menuPreview(track: Track, distance = track.length - 32): Float32Array {
  if (!Number.isFinite(distance)) throw new Error('Invalid menu preview position');
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  // Quantize the coordinate once, then derive world height from that same value.
  frame[o + F.S] = track.at(distance, trackPoint()).s;
  const p = track.at(frame[o + F.S], trackPoint()),
    yaw = Math.atan2(p.tx, p.tz);
  frame[H.CARS] = 1;
  frame[H.LENGTH] = track.length;
  frame[H.AMBIENT] = 24;
  frame[H.CLOUD] = 0.12;
  frame[o + F.X] = p.x;
  // FormulaCar's actual hub anchor is +0.05 m; the wheel extends down by
  // restLength + radius. Previously the preview was a further 19 mm too low.
  frame[o + F.Y] = p.y + VEHICLE.restLength + VEHICLE.wheelRadius - 0.05;
  frame[o + F.Z] = p.z;
  frame[o + F.QY] = Math.sin(yaw / 2);
  frame[o + F.QW] = Math.cos(yaw / 2);
  frame[o + F.GEAR] = 1;
  frame[o + F.RPM] = VEHICLE.idleRPM;
  frame[o + F.FUEL] = 24;
  frame[o + F.BATTERY] = 3.2e6;
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = frame[o + F.FLOOR_HEALTH] = 1;
  frame[o + F.COMPOUND] = 1;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.LENGTH] = VEHICLE.restLength;
    frame[w + W.RADIUS] = VEHICLE.wheelRadius;
    frame[w + W.PRESSURE] = i < 2 ? DEFAULT_SETUP.frontPressure : DEFAULT_SETUP.rearPressure;
  }
  return frame;
}
