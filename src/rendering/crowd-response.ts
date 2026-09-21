import { clamp } from '../core/math.ts';
import { F, H, CAR_STRIDE, HEADER, carBase } from '../simulation/protocol.ts';
import type { Vector2, Vector3 } from 'three';

/** Local, snapshot-derived spectator response. Nearby moving traffic and a real
 * close battle elicit cheering; a measured impact elicits a separate flinch.
 * No rank-swap guessing, invented overtake event, wall timer or mutable history.
 * This makes arbitrary replay seeks reproduce exactly the same response. */
export function crowdResponse(frame: Float32Array | undefined, centre: Vector3, out: Vector2) {
  out.set(0, 0);
  if (!frame) return out;
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.z))
    throw new Error('Non-finite crowd location');
  const cars = frame[H.CARS];
  if (!Number.isInteger(cars) || cars < 0 || cars > 12 || frame.length < HEADER + cars * CAR_STRIDE)
    throw new Error('Invalid crowd response snapshot');
  for (let id = 0; id < cars; id++) {
    const base = carBase(id);
    const x = frame[base + F.X],
      z = frame[base + F.Z],
      speed = Math.abs(frame[base + F.SPEED]);
    if (!Number.isFinite(x + z + speed + frame[base + F.IMPACT]))
      throw new Error('Non-finite crowd response state');
    const distance = Math.hypot(centre.x - x, centre.z - z);
    const near = clamp(1 - distance / 90, 0, 1) ** 2;
    if (!near) continue;
    out.y = Math.max(out.y, near * clamp(frame[base + F.IMPACT], 0, 1));
    if (frame[base + F.IN_PIT] || frame[base + F.PIT_PHASE] || frame[base + F.RETIRED]) continue;
    let activity = clamp((speed - 8) / 42, 0, 1) * 0.3;
    for (let other = id + 1; other < cars; other++) {
      const b = carBase(other);
      if (
        frame[b + F.IN_PIT] ||
        frame[b + F.PIT_PHASE] ||
        frame[b + F.RETIRED] ||
        Math.abs(frame[b + F.SPEED]) < 12 ||
        speed < 12
      )
        continue;
      const separation = Math.hypot(x - frame[b + F.X], z - frame[b + F.Z]);
      // Proximity is a battle cue, not proof that an overtake was completed.
      activity = Math.max(activity, clamp(1 - separation / 14, 0, 1));
    }
    out.x = Math.max(out.x, near * activity);
  }
  // A collision must not be represented as celebration.
  out.x *= 1 - out.y;
  return out;
}
