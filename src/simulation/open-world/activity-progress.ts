import { clamp } from '../../core/math.ts';
import type { FestivalEventSpec } from './region-data.ts';

/** Live activity feedback. Stars and drift points remain provisional until
 * the activity finishes; these values never settle results or career rewards. */
export interface FestivalActivityProgress {
  metric: 'speed' | 'average-speed' | 'drift';
  value: number;
  unit: 'KM/H' | 'PTS';
  stars: number;
  /** The next star, or the three-star threshold to maintain once reached. */
  targetStars: number;
  target: number;
  /** Current measurement minus the target, in the displayed unit. */
  delta: number;
  progress: number;
  remainingMeters: number;
  /** Average needed over the remaining measured section of a speed zone.
   * Null for other activities, an expired time budget, or the finish. This
   * is a timing requirement, not a claim that the car can attain the speed. */
  requiredAverageKmh: number | null;
  targetTimeExpired: boolean;
  provisional: true;
  assisted: boolean;
  offRoute: boolean;
}

export interface FestivalActivitySample {
  elapsed: number;
  /** Accepted net route progress since this run's actual entry station. */
  legalDistance: number;
  /** Measured route length, excluding the rolling entry and finish run-out. */
  measuredDistance: number;
  speedKmh: number;
  driftScore: number;
  assisted: boolean;
  offRoute: boolean;
}

/** One source for activity measurements and their next score
 * threshold. It consumes the same legal distance and scoring total as the
 * result path; backing up cannot manufacture distance or average speed. */
export function activityProgress(
  spec: Pick<FestivalEventSpec, 'kind' | 'stars'>,
  sample: FestivalActivitySample,
): FestivalActivityProgress | null {
  const metric =
    spec.kind === 'speed-trap'
      ? 'speed'
      : spec.kind === 'speed-zone'
        ? 'average-speed'
        : spec.kind === 'drift-zone'
          ? 'drift'
          : null;
  const targets = spec.stars;
  if (
    !metric ||
    !targets ||
    targets.length !== 3 ||
    targets.some((v, i) => !Number.isFinite(v) || v <= 0 || (i > 0 && v <= targets[i - 1])) ||
    !Number.isFinite(sample.elapsed) ||
    sample.elapsed < 0 ||
    !Number.isFinite(sample.legalDistance) ||
    !Number.isFinite(sample.measuredDistance) ||
    sample.measuredDistance <= 0 ||
    !Number.isFinite(sample.speedKmh) ||
    !Number.isFinite(sample.driftScore)
  )
    return null;

  const distance = clamp(sample.legalDistance, 0, sample.measuredDistance);
  const remainingMeters = Math.max(0, sample.measuredDistance - distance);
  const value = Math.max(
    0,
    metric === 'speed'
      ? sample.speedKmh
      : metric === 'drift'
        ? sample.driftScore
        : sample.elapsed > 0.5
          ? (distance / sample.elapsed) * 3.6
          : 0,
  );
  if (!Number.isFinite(value)) return null;
  const stars = targets.filter((target) => value >= target).length;
  const targetStars = Math.min(3, stars + 1);
  const target = targets[targetStars - 1];
  let requiredAverageKmh: number | null = null;
  let targetTimeExpired = false;
  if (metric === 'average-speed' && remainingMeters > 0) {
    const budget = (sample.measuredDistance / target) * 3.6 - sample.elapsed;
    targetTimeExpired = budget <= 0;
    if (budget > 0) {
      const required = (remainingMeters / budget) * 3.6;
      if (Number.isFinite(required)) requiredAverageKmh = required;
    }
  }
  return {
    metric,
    value,
    unit: metric === 'drift' ? 'PTS' : 'KM/H',
    stars,
    targetStars,
    target,
    delta: value - target,
    progress: clamp(value / target, 0, 1),
    remainingMeters,
    requiredAverageKmh,
    targetTimeExpired,
    provisional: true,
    assisted: sample.assisted,
    offRoute: sample.offRoute,
  };
}
