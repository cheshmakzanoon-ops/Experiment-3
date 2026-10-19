import { H, R, RACE_BASE, carBase } from './protocol.ts';
import { trackPoint, type Track } from './track.ts';
import { vehicleAt, vehicleDefinition } from './vehicles.ts';

/** REF 014/016 show three-rider echelon starts. The current FIM layout uses
 * a 4 m longitudinal stagger and 12 m between three-rider rows (22 June 2026).
 * The lateral spread is an original venue-safe choice, not a surveyed grid.
 * https://www.fim-moto.com/en/news/news-detail/article/fim-grand-prix-world-championship-decisions-of-the-grand-prix-commission
 */
export const GP_GRID = Object.freeze({ columns: 3, stagger: 4, lateral: 3.2, edgeMargin: 1.25 });

/** Use one arrangement for the actual starting positions and their paint.
 * The returned station is the bike CG, preserving the venue's pole datum.
 * This is construction-time work; no race state or track samples are changed. */
export function gpGridSlot(track: Track, slot: number) {
  if (!Number.isInteger(slot) || slot < 0) throw new RangeError('Invalid GP grid slot');
  const s = track.length - track.pit.gridStart - slot * GP_GRID.stagger;
  const road = track.at(s, trackPoint());
  const spread = Math.min(GP_GRID.lateral, Math.max(0, road.width - GP_GRID.edgeMargin));
  return { s, lateral: ((slot % GP_GRID.columns) - 1) * spread };
}

/** Mixed exhibitions retain their existing two-column layout. Validated
 * session options already contain one vehicle ID for every entrant. */
export function gpGridForVehicles(ids: readonly string[] | undefined) {
  return !!ids?.length && ids.every((id) => vehicleDefinition(id).classId === 'gp-bike');
}

/** Presentation selects the whole recorded field, not the followed rider.
 * This keeps menu changes, a mixed field, pause and replay in agreement with
 * the simulation without adding a transport channel or a separate cache. */
export function gpGridForFrame(frame: Float32Array) {
  const count = frame[H.CARS];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    frame.length <= carBase(count - 1) + RACE_BASE + R.VEHICLE
  )
    return false;
  for (let i = 0; i < count; i++) {
    const id = frame[carBase(i) + RACE_BASE + R.VEHICLE];
    if (!Number.isInteger(id) || vehicleAt(id).classId !== 'gp-bike') return false;
  }
  return true;
}
