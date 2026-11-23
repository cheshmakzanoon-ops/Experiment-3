import { clamp } from '../core/math.ts';
import { B, BIKE_BASE, F, H, CAR_STRIDE, HEADER, carBase } from '../simulation/protocol.ts';
import { PHASE } from '../simulation/race.ts';
import type { Vector2, Vector3 } from 'three';

/** Head turn toward a passing pack, in a spectator's seat frame. Neighbouring
 * entrants contribute together, so a pair passing side by side cannot make
 * heads snap between targets when their running order changes. */
export function gpSpectatorYaw(
  frame: Float32Array,
  centre: Vector3,
  sideX: number,
  sideZ: number,
  leadSeconds = 0,
) {
  if (frame[H.PHASE] !== PHASE.RACING) return 0;
  let direction = 0,
    total = 0;
  for (let id = 0; id < frame[H.CARS]; id++) {
    const o = carBase(id);
    if (
      frame[o + F.IN_PIT] ||
      frame[o + F.PIT_PHASE] ||
      frame[o + F.RETIRED] ||
      frame[o + BIKE_BASE + B.STATE]
    )
      continue;
    // A grandstand spectator can look a few metres ahead of a fast Formula
    // car. Bound the lead so a replay splice cannot pull a whole row around.
    const vx = frame[o + F.VX],
      vz = frame[o + F.VZ];
    const lead = leadSeconds > 0 ? Math.min(leadSeconds, 8 / Math.max(1, Math.hypot(vx, vz))) : 0;
    const dx = frame[o + F.X] + vx * lead - centre.x,
      dz = frame[o + F.Z] + vz * lead - centre.z;
    const distanceSq = dx * dx + dz * dz;
    const forward = sideX * dz - sideZ * dx;
    if (forward <= 0 || distanceSq >= 90 * 90 || distanceSq < 0.01) continue;
    const range = 1 - distanceSq / (90 * 90);
    const strength =
      range * range * clamp(forward / 8, 0, 1) * clamp((frame[o + F.SPEED] - 3) / 20, 0, 1);
    direction += (strength * (sideX * dx + sideZ * dz)) / Math.sqrt(distanceSq);
    total += strength;
  }
  return (0.62 * direction) / Math.max(1, total);
}

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
