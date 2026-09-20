import { clamp } from '../core/math.ts';

/** Physical and visible drain stations share this cadence. The road surface still
 * drains everywhere; these stations add a local low-edge evacuation path rather
 * than acting as decorative geometry disconnected from the water model. */
export const DRAIN_START_M = 345;
export const DRAIN_SPACING_M = 43;
export const DRAIN_END_MARGIN_M = 245;
export const DRAIN_INFLUENCE_M = 11;

export interface DrainStation {
  s: number;
  ordinal: number;
}

export function drainStations(trackLength: number): readonly DrainStation[] {
  if (!Number.isFinite(trackLength) || trackLength <= DRAIN_START_M + DRAIN_END_MARGIN_M)
    throw new Error('Invalid drainage track length');
  const stations: DrainStation[] = [];
  for (
    let s = DRAIN_START_M, ordinal = 0;
    s < trackLength - DRAIN_END_MARGIN_M;
    s += DRAIN_SPACING_M, ordinal++
  )
    stations.push({ s, ordinal });
  return stations;
}

/** Chooses the drainage edge from real road geometry. Positive bank rises toward
 * +normal, so the negative side is lower; on nearly flat road the bend outside
 * is preferred, then a deterministic alternating side avoids a visual pattern. */
export function drainSide(bank: number, curvature: number, ordinal: number): -1 | 1 {
  if (![bank, curvature, ordinal].every(Number.isFinite) || !Number.isInteger(ordinal))
    throw new Error('Invalid drainage geometry');
  if (Math.abs(bank) > 0.0025) return bank > 0 ? -1 : 1;
  if (Math.abs(curvature) > 0.0008) return curvature > 0 ? -1 : 1;
  return ordinal % 2 ? 1 : -1;
}

function nearestStation(s: number, trackLength: number) {
  const maximum = trackLength - DRAIN_END_MARGIN_M;
  if (s < DRAIN_START_M - DRAIN_INFLUENCE_M || s > maximum + DRAIN_INFLUENCE_M) return null;
  const ordinal = Math.round((s - DRAIN_START_M) / DRAIN_SPACING_M);
  if (ordinal < 0) return null;
  const stationS = DRAIN_START_M + ordinal * DRAIN_SPACING_M;
  if (stationS >= maximum) return null;
  return { s: stationS, ordinal };
}

/** Drainage coefficient in 1/s for one 512x7 surface cell. Baseline drainage is
 * strongest at both shoulders. A real drain station adds a smooth, bounded boost
 * only on the physically selected low/outside edge. */
export function surfaceDrainageRate(
  s: number,
  trackLength: number,
  bank: number,
  curvature: number,
  column: number,
) {
  if (
    ![s, trackLength, bank, curvature, column].every(Number.isFinite) ||
    trackLength <= 0 ||
    !Number.isInteger(column) ||
    column < 0 ||
    column > 6
  )
    throw new Error('Invalid drainage cell');
  const edge = Math.abs(column - 3) / 3,
    baseline = 0.002 + 0.003 * edge,
    station = nearestStation(s, trackLength);
  if (!station || edge <= 0) return baseline;
  const side: -1 | 1 = column < 3 ? -1 : 1,
    intended = drainSide(bank, curvature, station.ordinal);
  if (side !== intended) return baseline;
  const distance = Math.abs(s - station.s),
    phase = clamp(1 - distance / DRAIN_INFLUENCE_M, 0, 1),
    longitudinal = phase * phase * (3 - 2 * phase);
  return baseline + 0.004 * edge * longitudinal;
}
