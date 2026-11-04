import {
  festivalVehicles,
  festivalDefaultVehicle,
} from '../simulation/open-world/festival-machines.ts';
import type { FestivalResult } from '../simulation/open-world/festival-result.ts';

/** Persisted festival state (`festival:v1`): discovered events, best results,
 * the chosen machine and the ambient traffic setting. A light module so the
 * career reads discoveries without loading the festival session. */
export interface FestivalSave {
  version: 1;
  discovered: string[];
  best: Record<string, { stars: number; time: number | null; value: number | null }>;
  vehicle: string;
  /** Ambient traffic on (default) or off; absent in saves before it existed. */
  traffic?: boolean;
}
export const FESTIVAL_SAVE_KEY = 'festival:v1';
const EVENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const measure = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/** Best results as stored: an object of event id to 0-3 stars with finite,
 * non-negative time and value (or null). Anything else is dropped, so a damaged
 * or hand-edited file cannot carry NaN or a non-record into the comparisons
 * that later decide what is a new best. */
function validateBest(value: unknown): FestivalSave['best'] {
  const out: FestivalSave['best'] = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value).slice(0, 256)) {
    if (!EVENT_ID.test(id) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!Number.isInteger(r.stars) || (r.stars as number) < 0 || (r.stars as number) > 3) continue;
    out[id] = { stars: r.stars as number, time: measure(r.time), value: measure(r.value) };
  }
  return out;
}
export function validateFestivalSave(value: unknown): FestivalSave | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<FestivalSave>;
  if (v.version !== 1 || !Array.isArray(v.discovered) || typeof v.vehicle !== 'string') return null;
  return {
    version: 1,
    discovered: v.discovered.filter((d): d is string => typeof d === 'string').slice(0, 256),
    best: validateBest(v.best),
    vehicle: v.vehicle,
    traffic: typeof v.traffic === 'boolean' ? v.traffic : true,
  };
}
/** The machine a festival session drives, and the one the festival save
 * keeps. A road machine chosen in the MACHINE menu (a car or a road
 * motorcycle) wins over the save; the Formula default falls back to the
 * saved festival machine. The career's loan is driven but never saved: the
 * save keeps the player's own choice. */
export function festivalMachineChoice(
  options: { vehicle?: string; loaner?: boolean },
  saved: string,
): { drive: string; save: string } {
  const vehicles = festivalVehicles();
  const chosen = vehicles.find((v) => v.id === options.vehicle && v.classId !== 'formula');
  const kept = vehicles.some((v) => v.id === saved) ? saved : festivalDefaultVehicle();
  const drive = chosen?.id ?? kept;
  return { drive, save: options.loaner ? kept : drive };
}
/** Fold one finished festival run into the save's best results (in place).
 * Assisted (autopilot) and unfinished runs never count. Returns true when the
 * save changed, so the caller persists it. The festival session and the
 * headless QA harness (scripts/studio/tools/festival-qa.ts) share this. */
export function recordFestivalBest(save: FestivalSave, result: FestivalResult): boolean {
  if (!result.completed || result.assisted) return false;
  const best = save.best[result.eventId],
    value = result.trapKmh ?? result.averageKmh ?? result.driftScore ?? null;
  const better =
    !best ||
    result.stars > best.stars ||
    (result.time !== null && (best.time === null || result.time < best.time)) ||
    (value !== null && (best.value === null || value > best.value));
  if (!better) return false;
  save.best[result.eventId] = {
    stars: Math.max(result.stars, best?.stars ?? 0),
    time:
      result.time !== null && (best?.time == null || result.time < best.time)
        ? result.time
        : (best?.time ?? null),
    value:
      value !== null && (best?.value == null || value > best.value)
        ? value
        : (best?.value ?? null),
  };
  return true;
}
