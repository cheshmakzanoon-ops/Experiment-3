import type { Participant } from './festival-events.ts';

export interface FestivalRivalGap {
  car: number;
  name: string;
  /** Absolute difference in legal route metres, including completed laps. */
  metres: number;
}
export interface FestivalRivalGaps {
  ahead: FestivalRivalGap | null;
  behind: FestivalRivalGap | null;
}

/** The nearest active opponents by the same legal progress as the race
 * standings. This is a route-distance gap, never a guessed time interval
 * or straight-line distance across a hairpin/overpass. Finished and off-route
 * cars do not supply a misleading moving target. At most eight participants. */
export function rivalGaps(participants: readonly Participant[]): FestivalRivalGaps | null {
  const player = participants[0];
  if (
    !player ||
    player.finishTime !== null ||
    player.progress.offRoute ||
    !Number.isFinite(player.progress.distance)
  )
    return null;
  let ahead: FestivalRivalGap | null = null;
  let behind: FestivalRivalGap | null = null;
  for (let i = 1; i < Math.min(8, participants.length); i++) {
    const other = participants[i];
    if (other.finishTime !== null || other.progress.offRoute) continue;
    const delta = other.progress.distance - player.progress.distance;
    if (!Number.isFinite(delta)) continue;
    // Standings break equal-progress ties by entrant order: player is first.
    if (delta > 0 && (!ahead || delta < ahead.metres))
      ahead = { car: other.car.id, name: other.name, metres: delta };
    else if (delta <= 0 && (!behind || -delta < behind.metres))
      behind = { car: other.car.id, name: other.name, metres: -delta };
  }
  return ahead || behind ? { ahead, behind } : null;
}
