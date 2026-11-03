import { smooth } from '../core/math.ts';

/** Ground mist wisps in a fog bank (effects.ts): a few big, faint, slow puffs
 * at knee height that the wind moves, so the near field of a fog is not a flat
 * veil. Presentation only (a function of the presented snapshot, bounded
 * count, the existing soft-cloud pool). `owner` marks a puff as mist among the
 * car-owned smoke it shares the pool with. */
export const MIST = Object.freeze({
  owner: -3,
  /** Births per second in a full bank. */
  rate: 5,
  maxBirths: 4,
  /** Edge of the square (m) around the followed car the wisps are born in. */
  spread: 44,
  life: [6, 9] as readonly [number, number],
  size: [3.2, 5.2] as readonly [number, number],
  growth: 0.35,
  alpha: 0.1,
});
/** How much of a bank counts as ground fog for the wisps, 0..1: none in clear
 * air, in dust or while it snows (snow is its own near-field), full from an
 * extinction of about 8 per km (a visibility under ~500 m). */
export function mistAmount(extinctionPerKm: number, dust: number, snowShare = 0) {
  if (!Number.isFinite(extinctionPerKm) || extinctionPerKm <= 0) return 0;
  const d = Number.isFinite(dust) ? Math.min(1, Math.max(0, dust)) : 0;
  return smooth(1.5, 8, extinctionPerKm) * (1 - d) * (1 - Math.min(1, Math.max(0, snowShare)));
}
