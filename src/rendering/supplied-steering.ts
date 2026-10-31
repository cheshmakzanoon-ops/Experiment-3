import { clamp } from '../core/math.ts';
import manifest from './supplied-player.manifest.json' with { type: 'json' };

/** Shared authored-clip mapping. Positive physical steering is a left turn;
 * the clip runs from right lock to left lock. Units of duration are retained
 * (seconds for Three, frame numbers for Babylon). */
export function steeringSample(steering: number, duration: number) {
  if (!Number.isFinite(steering) || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Invalid supplied driver steering sample');
  const normalized = clamp((steering * 2.2) / (manifest.steeringDegrees * (Math.PI / 180)), -1, 1);
  return (normalized + 1) * 0.5 * duration;
}
