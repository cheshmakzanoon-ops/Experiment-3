import { describe, expect, it, vi } from 'vitest';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { GP_R1 } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import { trackPoint, Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

class PathProbe extends BikeAIDriver {
  sampleOffset(track: Track, station: number) {
    return this.steeringLineOffset(track, station);
  }
  sampleCurvature(track: Track, station: number) {
    return this.steeringLineCurvature(track, station);
  }
}

const native = (driver: BikeAIDriver) =>
  driver as unknown as {
    steerIntent(track: Track, steer: number): number;
    steeringTarget: number;
    steeringCorrection: number;
  };

/** Independently construct the authored path as a world-space interpolation
 * between the centreline and full racing line, without a steering helper. */
function lanePoint(track: Track, station: number, width: number) {
  const centre = track.at(station, trackPoint()),
    raw = racingLineFor(track).offsetAt(station),
    fullX = centre.x + centre.nx * raw,
    fullZ = centre.z + centre.nz * raw;
  return {
    x: centre.x + (fullX - centre.x) * width,
    z: centre.z + (fullZ - centre.z) * width,
    centre,
  };
}

describe('road motorcycle steering owns the shared narrowed path', () => {
  it.each([
    { circuit: 'poggio-alto', index: 400 },
    { circuit: 'vellamar', index: 275 },
    { circuit: 'ardennes', index: 1687 },
  ] as const)(
    'keeps the wet $circuit target on the authored world-space lane',
    ({ circuit, index }) => {
      const sim = new Simulation({
          ...DEFAULT_OPTIONS,
          circuit,
          vehicles: ['gpr1'],
          mode: 'practice',
          opponents: 0,
        }),
        bike = sim.cars[0] as BikeVehicle,
        track = sim.track,
        station = index * racingLineFor(track).step,
        width = 0.55,
        expected = lanePoint(track, station, width),
        lookahead = lanePoint(track, station + 25.2, width),
        driver = new PathProbe(bike);
      bike.place(track, station);
      bike.s = station;
      bike.lateral =
        (expected.x - expected.centre.x) * expected.centre.nx +
        (expected.z - expected.centre.z) * expected.centre.nz;
      bike.speed = bike.dynamics.speed = 40;
      bike.contacts[0].water = 0.8;
      bike.contacts[2].water = 0;
      // The shared planner publishes one absolute lookahead location. Recover
      // its scalar coordinate from the world-space point, not from the helper.
      bike.aiOffset =
        (lookahead.x - lookahead.centre.x) * lookahead.centre.nx +
        (lookahead.z - lookahead.centre.z) * lookahead.centre.nz;
      native(driver).steerIntent(track, 0);
      const target = native(driver).steeringTarget,
        x = expected.centre.x + expected.centre.nx * target,
        z = expected.centre.z + expected.centre.nz * target;
      expect(Math.hypot(x - expected.x, z - expected.z)).toBeLessThan(1e-9);
    },
  );

  it.each([
    { water: 0.8, lineScale: 1, width: 0.55, slope: 0.25 },
    { water: 0.4, lineScale: 1, width: 0.775, slope: -0.25 },
    { water: 0, lineScale: 0.7, width: 0.7, slope: 0.25 },
  ])(
    'requests no path correction on a width $width straight diagonal',
    ({ water, lineScale, width, slope }) => {
      const track = new Track('clear', true),
        line = racingLineFor(track),
        bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', {
          ...GP_R1,
          ai: { ...GP_R1.ai, lineScale },
        }),
        driver = new PathProbe(bike),
        station = 100,
        point = (s: number) => ({ x: width * slope * (s - station), z: s });
      const sample = vi.spyOn(track, 'at').mockImplementation((s, out = trackPoint()) => {
        Object.assign(out, {
          s,
          x: 0,
          y: 0,
          z: s,
          tx: 0,
          tz: 1,
          nx: 1,
          nz: 0,
          width: 20,
          curvature: 0,
          gradient: 0,
        });
        return out;
      });
      const offset = vi.spyOn(line, 'offsetAt').mockImplementation((s) => slope * (s - station)),
        curvature = vi.spyOn(line, 'curvatureAt').mockReturnValue(0);
      try {
        const before = point(station - 3),
          after = point(station + 3),
          here = point(station),
          ahead = point(station + 25.2);
        bike.s = station;
        bike.lateral = here.x;
        bike.speed = bike.dynamics.speed = 40;
        bike.dynamics.heading = Math.atan2(after.x - before.x, after.z - before.z);
        bike.dynamics.motoGP!.lateralSpeed = 0;
        bike.aiOffset = ahead.x;
        bike.contacts[0].water = water;
        bike.contacts[2].water = 0;
        native(driver).steerIntent(track, 0);
        expect(native(driver).steeringTarget).toBeCloseTo(here.x, 12);
        expect(Math.abs(native(driver).steeringCorrection)).toBeLessThan(1e-10);
      } finally {
        sample.mockRestore();
        offset.mockRestore();
        curvature.mockRestore();
      }
    },
  );

  it('retains the original dry full-width offsets and curvature bit for bit', () => {
    const track = new Track('clear', true),
      bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1),
      driver = new PathProbe(bike),
      line = racingLineFor(track);
    bike.contacts[0].water = 0;
    // Path narrowing belongs to the same front-contact sample as base AI;
    // a wet rear alone must not choose a different authored line here.
    bike.contacts[2].water = 0.8;
    for (const station of [0, 0.25, 63.7, 1600.3, track.length - 0.125, track.length + 1]) {
      expect(driver.sampleOffset(track, station)).toBe(line.offsetAt(station));
      expect(driver.sampleCurvature(track, station)).toBe(line.curvatureAt(station));
    }
  });

  it('uses the shared envelope curvature blend without replacing the solved curve', () => {
    const track = new Track('clear', true),
      bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1),
      driver = new PathProbe(bike),
      line = racingLineFor(track);
    const curve = vi.spyOn(line, 'curvatureAt').mockReturnValue(0.012),
      sample = vi.spyOn(track, 'at').mockImplementation((s, out = trackPoint()) => {
        out.s = s;
        out.curvature = -0.004;
        return out;
      });
    try {
      bike.contacts[0].water = 0.8;
      expect(driver.sampleCurvature(track, 100)).toBeCloseTo(0.0048, 15);
      bike.contacts[0].water = 0;
      sample.mockClear();
      expect(driver.sampleCurvature(track, 100)).toBe(0.012);
      expect(sample).not.toHaveBeenCalled();
    } finally {
      curve.mockRestore();
      sample.mockRestore();
    }
  });
});
