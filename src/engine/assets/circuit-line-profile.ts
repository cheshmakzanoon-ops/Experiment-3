import { clamp, mod, smooth } from '../../core/math.ts';
import { racingLineFor } from '../../simulation/racing-line.ts';
import type { Track } from '../../simulation/track.ts';
import { tyreMarkZones } from './tyre-mark-zones.ts';

export const CIRCUIT_LINE_PROFILE_STEP = 2;

interface LineProfile {
  offset: Float32Array;
  brake: Float32Array;
  step: number;
  length: number;
}
const profiles = new WeakMap<Track, LineProfile>();
const bikeProfiles = new WeakMap<Track, LineProfile>();

/** Racing-line offset and braking weight along a lap, sampled every
 * CIRCUIT_LINE_PROFILE_STEP metres. The weight rises through each braking zone
 * to 1 at the apex (scaled by the speed lost), fades over ~20 m after it, and
 * carries a lighter share through slow-corner exits. Cached per track. */
export function apexLineProfile(track: Track, motorcycle = false): LineProfile {
  const cache = motorcycle ? bikeProfiles : profiles;
  let profile = cache.get(track);
  if (profile) return profile;
  const line = racingLineFor(track),
    length = track.length,
    n = Math.max(8, Math.round(length / CIRCUIT_LINE_PROFILE_STEP)),
    step = length / n;
  const offset = new Float32Array(n),
    brake = new Float32Array(n);
  for (let i = 0; i < n; i++) offset[i] = line.offsetAt(i * step);
  for (const zone of tyreMarkZones(track, motorcycle)) {
    const span = Math.max(zone.end - zone.start, 1e-3);
    if (zone.kind === 'braking') {
      const peak = clamp(zone.strength / 28, 0.45, 1);
      const reach = span + 40;
      for (let d = 0; d <= reach; d += step) {
        const s = zone.start + d;
        const w =
          d <= span ? peak * smooth(0, 1, d / span) ** 0.8 : peak * Math.exp(-(d - span) / 18);
        const i = Math.round(mod(s, length) / step) % n;
        brake[i] = Math.max(brake[i], w);
      }
    } else {
      for (let d = 0; d <= span; d += step) {
        const i = Math.round(mod(zone.start + d, length) / step) % n;
        brake[i] = Math.max(brake[i], 0.55 * (1 - smooth(0, 1, d / span)));
      }
    }
  }
  profile = { offset, brake, step, length };
  cache.set(track, profile);
  return profile;
}

function sample(profile: LineProfile, values: Float32Array, s: number) {
  const u = mod(s, profile.length) / profile.step,
    i = Math.floor(u) % values.length,
    f = u - Math.floor(u);
  return values[i] + (values[(i + 1) % values.length] - values[i]) * f;
}
/** Per-vertex `apexLine` for a road vertex at lap distance `s`, lateral `l`:
 * (signed metres from the racing line, braking weight 0-1). */
export function apexLineAt(
  track: Track,
  s: number,
  l: number,
  out: [number, number] = [0, 0],
  motorcycle = false,
) {
  const profile = apexLineProfile(track, motorcycle);
  out[0] = l - sample(profile, profile.offset, s);
  out[1] = clamp(sample(profile, profile.brake, s), 0, 1);
  return out;
}
