import { mod } from '../../core/math.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { CatalogueMeta, VenueSpan } from '../../simulation/circuit-catalogue/venue-data.ts';
import type { StandSpec, VenuePlan } from '../venue-plan.ts';
import { VENUE_THEMES } from './theme.ts';
import { VenueField } from './field.ts';

/** Catalogue metadata of a track, or null for the bespoke original venues. */
export function catalogueOf(track: Track): CatalogueMeta | null {
  return track.circuit.catalogue ?? null;
}
const fields = new WeakMap<Track, VenueField>();
const pendingFields = new WeakMap<Track, { field: VenueField; waiters: number }>();
const FIELD_SEGMENTS_PER_STEP = 4;
/** Only completed rasters are visible to synchronous scene construction. */
export function venueFieldReady(track: Track) {
  return fields.has(track);
}
/** The venue's coarse distance/height field, built once per Track. */
export function venueField(track: Track) {
  let field = fields.get(track);
  if (!field) {
    // A synchronous caller must never observe an unfinished raster. Finish
    // the shared preparation rather than allocating a second field; suspended
    // generators subsequently return this exact completed owner.
    field = pendingFields.get(track)?.field ?? new VenueField(track);
    if (!field.ready) field.advance(Infinity);
    fields.set(track, field);
    pendingFields.delete(track);
  }
  return field;
}
/** Maximum extra construction tasks needed for a cold catalogue field. */
export function venueFieldPreparationSteps(track: Track) {
  return Math.ceil((track.points.length - 1) / FIELD_SEGMENTS_PER_STEP);
}
/** Cooperative, shared preparation with completed-only cache publication.
 * Each waiter advances at most four segments, and cancelling one does not
 * cancel another. Once the final waiter leaves, an unfinished raster can be
 * collected. A synchronous consumer may complete the same owner at any time. */
export function* prepareVenueField(track: Track): Generator<void, VenueField, void> {
  const known = fields.get(track);
  if (known) return known;
  let pending = pendingFields.get(track);
  if (!pending) {
    pending = { field: new VenueField(track, 10, 320, 24, true), waiters: 0 };
    pendingFields.set(track, pending);
  }
  pending.waiters++;
  try {
    while (!pending.field.ready) {
      const completed = fields.get(track);
      if (completed) return completed;
      pending.field.advance(FIELD_SEGMENTS_PER_STEP);
      yield;
    }
    // Never replace an owner installed while this generator was suspended.
    if (!fields.has(track)) fields.set(track, pending.field);
    return fields.get(track)!;
  } finally {
    pending.waiters--;
    if (pending.waiters === 0 && pendingFields.get(track) === pending) pendingFields.delete(track);
  }
}
/** Is lap distance `s` inside a (possibly wrapping) span? */
export function inSpan(span: { from: number; to: number }, s: number, length: number) {
  const x = mod(s, length);
  return span.from <= span.to ? x >= span.from && x <= span.to : x >= span.from || x <= span.to;
}
export function sideSpanAt(
  spans: readonly VenueSpan[],
  s: number,
  side: number,
  length: number,
): boolean {
  for (const span of spans) if (span.side === side && inSpan(span, s, length)) return true;
  return false;
}

/** Pit building frame: garages start before the first box and run past the
 * last; everything sits on the pit side, `depth` metres beyond the lane. */
export function paddockSpan(track: Track) {
  const pit = track.pit;
  const from = pit.firstBox - 18,
    to = pit.firstBox + 11 * pit.boxSpacing + 18;
  return { from, to, side: pit.side, lateral: pit.offset + 9.5 };
}

/** Event-hall plaza radius (venue-landmark.ts LANDMARK.plazaRadius). */
export const PLAZA_RADIUS = 27.5;
const landmarks = new WeakMap<Track, ReturnType<typeof findLandmark>>();
function findLandmark(track: Track) {
  const pit = track.pit,
    p = trackPoint(),
    near = trackPoint();
  const middle = pit.firstBox + 5.5 * pit.boxSpacing;
  for (const lateral of [110, 140, 175, 220, 280])
    for (const side of [pit.side, -pit.side])
      for (const shift of [0, -80, 80, -160, 160, 240]) {
        const s = mod(middle + shift, track.length);
        track.at(s, p);
        const x = p.x + p.nx * side * lateral,
          z = p.z + p.nz * side * lateral;
        let clear = true;
        for (let a = 0; a < 16 && clear; a++)
          for (const r of [0, PLAZA_RADIUS + 12]) {
            const wx = x + Math.cos((a / 16) * Math.PI * 2) * r,
              wz = z + Math.sin((a / 16) * Math.PI * 2) * r;
            const l = track.nearest(wx, wz, near);
            if (Math.abs(l) < track.boundary(near.s, l < 0 ? -1 : 1) + 45) clear = false;
          }
        if (clear) return { x, z, s, yaw: Math.atan2(p.tx, p.tz), y: p.y - 0.9 };
      }
  // Far behind the paddock as a last resort (always clear of the venue).
  track.at(middle, p);
  const lateral = pit.side * 420;
  return {
    x: p.x + p.nx * lateral,
    z: p.z + p.nz * lateral,
    s: middle,
    yaw: Math.atan2(p.tx, p.tz),
    y: p.y - 0.9,
  };
}
/** The catalogue venue's event-hall plaza: a clear, levelled site behind the
 * paddock (the kit terrain flattens it). */
export function catalogueLandmark(track: Track) {
  let site = landmarks.get(track);
  if (!site) landmarks.set(track, (site = findLandmark(track)));
  return site;
}

const plans = new WeakMap<Track, VenuePlan>();
/** VenuePlan for a catalogue layout, derived from its data: authored stands
 * (or the start straight and slowest corners), fictional signage, no
 * districts or service compounds (the kit dresses those itself). */
export function catalogueVenuePlan(track: Track): VenuePlan {
  const known = plans.get(track);
  if (known) return known;
  const meta = track.circuit.catalogue!,
    style = VENUE_THEMES[meta.theme],
    paddock = paddockSpan(track);
  const stands: StandSpec[] = [];
  const clearOfPaddock = (s: number, side: number) =>
    side !== paddock.side ||
    !inSpan({ from: paddock.from - 60, to: paddock.to + 60 }, s, track.length);
  // Main straight opposite the paddock.
  stands.push(
    { s: -60, side: -track.pit.side, length: 64 },
    { s: 40, side: -track.pit.side, length: 80 },
  );
  for (const span of meta.dressing.stands) {
    const s = mod(span.from + mod(span.to - span.from, track.length) / 2, track.length);
    if (!clearOfPaddock(s, span.side)) continue;
    if (
      stands.some(
        (o) => Math.abs(mod(o.s - s + track.length / 2, track.length) - track.length / 2) < 90,
      )
    )
      continue;
    const site = { s: Math.round(s), side: span.side, length: Math.round(span.length) };
    // A long GP terrace can cut back across its own curved corridor even
    // when no other section is nearby. Reject that site before filling the
    // authored stand budget, so later safe spectator locations can replace it.
    if (isGpCourse(track) && !standClear(track, site)) continue;
    stands.push(site);
    if (stands.length >= style.stands + 2) break;
  }
  const plan: VenuePlan = Object.freeze({
    grandstands: Object.freeze(stands.filter((site) => standClear(track, site))),
    serviceZones: Object.freeze([]),
    districts: Object.freeze([]),
    districtRelief: 0.5,
    plantingZones:
      style.planting ??
      Object.freeze([{ endFraction: 1, canopyRatio: 0.84, species: 'broadleaf' }]),
    signs: Object.freeze([
      {
        text: meta.signage ?? style.sponsor,
        s: 300,
        lateral: -(track.boundary(300, -1) + 6),
        width: 18,
        height: 2,
      },
    ]),
    brakingBoards: Object.freeze([]),
    gantryLabel: track.circuit.name,
    landmark: 'event-hall',
  } as VenuePlan);
  plans.set(track, plan);
  return plan;
}
/** A stand's deck must not overlap another section's corridor. */
function standClear(track: Track, site: StandSpec) {
  const p = track.at(mod(site.s, track.length), trackPoint()),
    near = trackPoint();
  const base = site.side * (track.boundary(site.s, site.side) + 7);
  if (isGpCourse(track)) {
    const length = site.length + 1.5,
      samples = Math.ceil(length / 8);
    for (const u of [-2, 6, 13])
      for (let sample = 0; sample <= samples; sample++) {
        const v = -length / 2 + (length * sample) / samples,
          lateral = base + site.side * u,
          x = p.x + p.nx * lateral + p.tx * v,
          z = p.z + p.nz * lateral + p.tz * v,
          l = track.nearest(x, z, near);
        if (Math.abs(l) < track.boundaryAt(near, l < 0 ? -1 : 1) + 4) return false;
      }
    return true;
  }
  for (const u of [-2, 6, 13])
    for (const v of [-site.length / 2, 0, site.length / 2]) {
      const l0 = base + site.side * u,
        x = p.x + p.nx * l0 + p.tx * v,
        z = p.z + p.nz * l0 + p.tz * v;
      const l = track.nearest(x, z, near);
      const gap = Math.abs(mod(near.s - p.s + track.length / 2, track.length) - track.length / 2);
      if (gap > 80 && Math.abs(l) < track.boundary(near.s, l < 0 ? -1 : 1) + 4) return false;
    }
  return true;
}
