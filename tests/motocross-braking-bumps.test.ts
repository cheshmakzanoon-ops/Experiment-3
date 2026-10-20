import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { clamp, mod } from '../src/core/math.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import {
  brakingBumpSample,
  sampleBrakingBumps,
  type BrakingBumpSpec,
} from '../src/simulation/offroad/braking-bumps.ts';
import { OffroadCourse, relief } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigBike, rigTrack, rideLine } from '../src/simulation/offroad/jump-rig.ts';
import { LongitudinalProfile } from '../src/simulation/offroad/profile.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const span: BrakingBumpSpec = {
  name: 'test entry',
  from: 990,
  to: 28,
  centre: -1.5,
  halfWidth: 3.1,
  height: 0.1,
  spacing: 3.8,
};
const L = 1000;
function sample(s: number, lateral = span.centre) {
  return sampleBrakingBumps([span], s, lateral, L, brakingBumpSample());
}

/** Production tyre/suspension integration, using only throttle/brake/steer
 * to hold the chosen lane after ordinary placement. No contact, load,
 * airborne or chassis pose is fabricated. */
function rideEntry(
  track: Track,
  definition: VehicleDefinition,
  line: BrakingBumpSpec,
  lateral: number,
  speed: number,
) {
  (Track.offroadOf(track) as TrackTerrainSurface).terrain.reset();
  const bike = rigBike(definition, track, line.from - 5, speed);
  bike.place(track, line.from - 5, lateral);
  bike.dynamics.speed = speed;
  bike.gear = 2;
  let lowestFork = Infinity,
    highestFork = -Infinity,
    airborneTicks = 0;
  for (let tick = 0; tick < 1600 && bike.s < line.to; tick++) {
    rideLine(bike, track, speed);
    bike.input.steer = clamp(bike.input.steer + lateral * 0.08, -1, 1);
    bike.step(1 / 240, track);
    if (bike.s > line.from + 5 && bike.s < line.to - 3) {
      lowestFork = Math.min(lowestFork, bike.fork);
      highestFork = Math.max(highestFork, bike.fork);
      airborneTicks += Number(bike.airborne);
    }
  }
  expect(bike.s).toBeGreaterThanOrEqual(line.to);
  expect(bike.dynamics.crashes).toBe(0);
  expect(Math.abs(bike.lateral - lateral)).toBeLessThan(0.12);
  return { forkStroke: highestFork - lowestFork, airborneSeconds: airborneTicks / 240 };
}

describe('physical motocross braking lines', () => {
  it('has continuous height and slope at entry, exit, lateral support and lap wrap', () => {
    for (const s of [span.from, span.to]) {
      const before = sample(s - 1e-5),
        after = sample(s + 1e-5);
      for (const key of ['h', 'ds', 'dl', 'work'] as const)
        expect(Math.abs(before[key] - after[key]), `${s}: ${key}`).toBeLessThan(1e-6);
    }
    for (const lateral of [span.centre - span.halfWidth, span.centre + span.halfWidth]) {
      const left = sample(3, lateral - 1e-5),
        right = sample(3, lateral + 1e-5);
      for (const key of ['h', 'ds', 'dl', 'work'] as const)
        expect(Math.abs(left[key] - right[key]), `${lateral}: ${key}`).toBeLessThan(1e-6);
    }
    expect(sample(0)).toEqual(sample(L));
    expect(sample(-0.1)).toEqual(sample(L - 0.1));
    expect(sample(600)).toEqual(brakingBumpSample());
  });

  it('returns the derivative of its height through crests, lane taper and run-out', () => {
    const epsilon = 1e-4;
    for (let s = 987.5; s < 1031; s += 0.61)
      for (let lateral = -4.9; lateral < 2; lateral += 0.71) {
        const value = sample(s, lateral),
          ds = (sample(s + epsilon, lateral).h - sample(s - epsilon, lateral).h) / (2 * epsilon),
          dl = (sample(s, lateral + epsilon).h - sample(s, lateral - epsilon).h) / (2 * epsilon);
        expect(value.ds).toBeCloseTo(ds, 6);
        expect(value.dl).toBeCloseTo(dl, 6);
      }
  });

  it('removes the height step where the existing rough chop meets smooth soil and track edges', () => {
    const course = new OffroadCourse(
        {
          kind: 'motocross',
          soil: 'loam',
          offTrack: 'turf',
          zones: [],
          moisture: 0.2,
          berms: [],
          chop: 0.025,
        },
        new LongitudinalProfile([]),
        [],
        [{ from: 990, to: 20 }],
        L,
      ),
      point = trackPoint();
    point.width = 5;
    for (const s of [990, 20])
      for (const offset of [-1e-5, 0, 1e-5]) {
        const value = course.relief(s + offset, 0, point, relief());
        expect(Math.abs(value.h)).toBeLessThan(1e-9);
        expect(Math.abs(value.ds)).toBeLessThan(1e-6);
      }
    for (const side of [-1, 1])
      for (const offset of [-1e-5, 0, 1e-5]) {
        const value = course.relief(3, side * (point.width + offset), point, relief());
        expect(Math.abs(value.h)).toBeLessThan(1e-9);
        expect(Math.abs(value.dl)).toBeLessThan(1e-6);
      }
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s leaves its jumps and an alternative entry line clear of the authored bumps',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
        course = terrain.course,
        point = trackPoint(),
        out = brakingBumpSample();
      expect(course.spec.brakingBumps!.length).toBeGreaterThan(0);
      for (const line of course.spec.brakingBumps!) {
        let maxHeight = 0,
          maxSlope = 0;
        const run = mod(line.to - line.from, track.length);
        for (let into = 0; into <= run; into += 0.25) {
          const s = line.from + into;
          track.at(s, point);
          const value = sampleBrakingBumps([line], s, line.centre, track.length, out);
          maxHeight = Math.max(maxHeight, value.h);
          maxSlope = Math.max(maxSlope, Math.abs(value.ds), Math.abs(value.dl));
          expect(Math.abs(line.centre) + line.halfWidth).toBeLessThan(point.width);
          expect(course.jumps.some((jump) => s >= jump.start - 2.6 && s <= jump.end + 2.4)).toBe(
            false,
          );
          const quiet = -Math.sign(line.centre) * point.width * 0.65;
          expect(sampleBrakingBumps([line], s, quiet, track.length, out)).toEqual(
            brakingBumpSample(),
          );
        }
        expect(maxHeight).toBeGreaterThan(line.height * 0.75);
        expect(maxHeight).toBeLessThanOrEqual(line.height);
        expect(maxSlope).toBeLessThan(0.2);
        expect(course.isRough((line.from + line.to) / 2)).toBe(true);
      }
    },
  );

  it.each([MX_250, MX_450])(
    '$id traverses all entries with a measurable suspension choice and no crash at 32/47 km/h',
    (definition) => {
      for (const id of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
        const track = rigTrack(id),
          course = (Track.offroadOf(track) as TrackTerrainSurface).course;
        for (const line of course.spec.brakingBumps!)
          for (const speed of [9, 13]) {
            const point = track.at(line.from, trackPoint()),
              quiet = -Math.sign(line.centre) * point.width * 0.65,
              worn = rideEntry(track, definition, line, line.centre, speed),
              smooth = rideEntry(track, definition, line, quiet, speed);
            expect(worn.forkStroke).toBeGreaterThan(smooth.forkStroke + 0.02);
            expect(worn.forkStroke).toBeLessThan(0.12);
            // Fast chop may unweight both tyres momentarily, but these
            // corner approaches must not become another launch feature.
            expect(worn.airborneSeconds).toBeLessThan(0.05);
            expect(smooth.airborneSeconds).toBe(0);
          }
      }
    },
  );

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s renders the physical bumped height and shades only its shared worked footprint',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
        lines = terrain.course.spec.brakingBumps!,
        maxHeight = Math.max(...lines.map((line) => line.height)),
        sample = brakingBumpSample(),
        view = new TerrainView(track);
      let workedVertices = 0,
        quietVertices = 0;
      try {
        for (const child of view.group.children) {
          const mesh = child as T.Mesh,
            position = mesh.geometry.getAttribute('position'),
            course = mesh.geometry.getAttribute('mxCourse'),
            work = mesh.geometry.getAttribute('mxBrakingWork');
          for (let i = 0; i < course.count; i++) {
            const lateral = course.getX(i),
              s = course.getY(i);
            sampleBrakingBumps(lines, s, lateral, track.length, sample);
            if (sample.work > 0.1) workedVertices++;
            else if (sample.work === 0) quietVertices++;
            expect(work.getX(i)).toBeCloseTo(sample.work, 4);
            expect(work.getY(i)).toBeCloseTo(sample.h / maxHeight, 4);
            if (sample.work > 0)
              expect(position.getY(i)).toBeCloseTo(terrain.baseHeight(s, lateral), 4);
          }
        }
        expect(workedVertices).toBeGreaterThan(150);
        expect(quietVertices).toBeGreaterThan(workedVertices * 10);
        // The existing 1 m render rows approximate the shared smooth
        // field between vertices. Keep that geometric error below 2 cm.
        for (const line of lines)
          for (let s = line.from + 0.25; s < line.to; s += 0.5)
            expect(
              Math.abs(view.heightAt(s, line.centre) - terrain.baseHeight(s, line.centre)),
            ).toBeLessThan(0.02);
      } finally {
        view.dispose();
      }
    },
  );
});
