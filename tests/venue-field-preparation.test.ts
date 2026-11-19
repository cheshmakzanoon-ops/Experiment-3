import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VenueField } from '../src/rendering/venue-kit/field.ts';
import {
  prepareVenueField,
  venueField,
  venueFieldPreparationSteps,
} from '../src/rendering/venue-kit/plan.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

function fixture() {
  // Two crossing roads, 9 m apart. This exercises the visual field's lower
  // corridor selection as well as nearest station/side and untouched cells.
  const points = [];
  for (let i = 0; i <= 16; i++)
    points.push({ ...trackPoint(), x: -80 + i * 10, y: 0, z: 0, s: i * 10 });
  for (let i = 0; i <= 16; i++)
    points.push({ ...trackPoint(), x: 0, y: 9, z: -80 + i * 10, s: 200 + i * 10 });
  return { points } as unknown as Track;
}
function digest(field: VenueField) {
  const hash = createHash('sha256');
  for (const values of [field.distance, field.height, field.station, field.side, field.corridorLow])
    hash.update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
  return hash.digest('hex');
}
function complete(iterator: Generator<void, VenueField, void>) {
  let steps = 0;
  for (;;) {
    const value = iterator.next();
    if (value.done) return { field: value.value, steps };
    steps++;
  }
}

describe('cooperative venue field preparation', () => {
  it('preserves the pre-change real MX raster byte for byte', () => {
    const track = new Track('clear', false, undefined, circuitDefinition('valley-ridge-mx'));
    const result = complete(prepareVenueField(track));
    expect(result.steps).toBe(venueFieldPreparationSteps(track));
    expect(result.field.ready).toBe(true);
    expect(digest(result.field)).toBe(
      'c370781547503b517e816ef8f54cc33407b2c2d7550fd9b3b435729a1132f62e',
    );
    expect(venueField(track)).toBe(result.field);
  });

  it('preserves synchronous construction and lower-road ground at a stacked crossing', () => {
    const track = fixture(),
      synchronous = new VenueField(track),
      result = complete(prepareVenueField(track));
    expect(synchronous.ready).toBe(true);
    expect(digest(result.field)).toBe(digest(synchronous));
    const crossing = result.field.nearest(0, 0);
    expect(crossing.distance).toBe(0);
    expect(crossing.low).toBe(0);
    expect(result.field.nearest(0, 60).height).toBe(9);
    expect(result.field.nearest(-5000, -5000).distance).toBe(Infinity);
    expect(result.field.sample(0, 0, { distance: NaN, height: NaN }).height).toBe(0);
  });

  it('lets a synchronous consumer finish the pending owner and never replaces it later', () => {
    const track = fixture(),
      first = prepareVenueField(track),
      second = prepareVenueField(track);
    expect(first.next().done).toBe(false);
    expect(second.next().done).toBe(false);
    const synchronous = venueField(track);
    expect(synchronous.ready).toBe(true);
    expect(first.next()).toEqual({ done: true, value: synchronous });
    expect(second.next()).toEqual({ done: true, value: synchronous });
    expect(venueField(track)).toBe(synchronous);
    expect(digest(synchronous)).toBe(digest(new VenueField(track)));
  });

  it('shares incremental work while cancelling one waiter leaves the other live', () => {
    const track = fixture(),
      first = prepareVenueField(track),
      second = prepareVenueField(track);
    expect(first.next().done).toBe(false);
    expect(second.next().done).toBe(false);
    first.return(undefined as unknown as VenueField);
    const result = complete(second);
    expect(result.steps + 2).toBe(venueFieldPreparationSteps(track));
    expect(digest(result.field)).toBe(digest(new VenueField(track)));
    expect(venueField(track)).toBe(result.field);
  });

  it('drops unfinished work after its last waiter cancels', () => {
    const track = fixture(),
      first = prepareVenueField(track);
    first.next();
    first.next();
    first.return(undefined as unknown as VenueField);
    const replacement = complete(prepareVenueField(track));
    expect(replacement.steps).toBe(venueFieldPreparationSteps(track));
    expect(digest(replacement.field)).toBe(digest(new VenueField(track)));
  });

  it('returns a completed shared owner without extra raster work or late publication', () => {
    const track = fixture(),
      first = prepareVenueField(track),
      second = prepareVenueField(track);
    first.next();
    const winner = complete(second).field;
    expect(first.next()).toEqual({ done: true, value: winner });
    expect(prepareVenueField(track).next()).toEqual({ done: true, value: winner });
    expect(venueField(track)).toBe(winner);
  });

  it('rejects invalid incremental batch sizes before corrupting the cursor', () => {
    const field = new VenueField(fixture(), 10, 320, 24, true);
    for (const size of [0, -1, 0.5, NaN])
      expect(() => field.advance(size)).toThrow('Invalid venue field preparation batch');
    expect(field.ready).toBe(false);
    expect(field.advance(Infinity)).toBe(true);
  });
});
