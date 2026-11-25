import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLASHBACK, InputLog, Resimulation, applyLoggedInput } from '../src/core/flashback.ts';
import { circuitDefinition, type CircuitDefinition } from '../src/simulation/circuits.ts';
import { controls, DEFAULT_OPTIONS, type WeatherPreset } from '../src/simulation/config.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { SurfaceThermalStep } from '../src/simulation/surface-thermal.ts';
import { FIGURE_EIGHT_OVERPASS } from '../src/simulation/test-venues.ts';
import type { TrackLaneIndex } from '../src/simulation/track-lane-index.ts';
import { CELL_COLS, SURFACE, Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import type { WeatherKeyframe } from '../src/simulation/weather.ts';
import { Simulation } from '../src/simulation/world.ts';

afterEach(() => vi.restoreAllMocks());

const laneOwner = (track: Track) => track as unknown as { laneIndex: TrackLaneIndex | null };
const laneCells = (track: Track) =>
  (laneOwner(track).laneIndex as unknown as { cells: Map<string, unknown> }).cells;

const surfaceState = (track: Track) => ({
  clock: track.surfaceClock,
  weather: [
    track.rain,
    track.cloud,
    track.ambient,
    track.windX,
    track.windZ,
    track.visibility,
    track.dust,
    track.gust,
    track.moisture,
    track.fogCover,
  ],
  grids: [
    track.water.slice(),
    track.rubber.slice(),
    track.marbles.slice(),
    track.frozen.slice(),
    track.temperature.slice(),
    track.substrateTemperature.slice(),
    track.drainage.slice(),
    track.sheltered.slice(),
  ],
});

const weatherFrame = (timeSec: number, patch: Partial<WeatherKeyframe>): WeatherKeyframe => ({
  timeSec,
  cloudCover01: 0.8,
  rainRateMmHr: 24,
  ambientTempC: 20,
  windSpeedMS: 2,
  windDirection: 0,
  ...patch,
});

// The reference executes the actual coarse nearest() path and the same public
// solver without either optional coefficient bank. No equations are copied.
function pair(preset: WeatherPreset, circuit: CircuitDefinition, weather: WeatherKeyframe[]) {
  const track = new Track(preset, false, weather, circuit);
  const reference = new Track(preset, false, weather, circuit);
  laneOwner(reference).laneIndex = null;
  const queries = [0, 0.5, 0.31].map((fraction) => {
    const p = track.at(track.length * fraction, trackPoint());
    return [p.x, p.z, p.y + 0.5] as const;
  });
  const p = track.at(track.length * 0.31, trackPoint());
  for (const lateral of [p.width + 0.5, p.width + 6])
    queries.push([p.x + p.nx * lateral, p.z + p.nz * lateral, p.y + p.bank * lateral + 0.5]);
  queries.push([1e5, -1e5, 100]);
  return { track, reference, queries };
}

const uncachedAdvanceWet = SurfaceThermalStep.prototype.advanceWet;
function evolveWithoutCellCoefficients(track: Track, dt: number, time: number) {
  const spy = vi.spyOn(SurfaceThermalStep.prototype, 'advanceWet').mockImplementation(function (
    this: SurfaceThermalStep,
    surface,
    substrate,
    water,
    rainfall,
    drainage,
    heat,
  ) {
    return uncachedAdvanceWet.call(this, surface, substrate, water, rainfall, drainage, heat);
  });
  try {
    track.evolve(dt, time);
  } finally {
    spy.mockRestore();
  }
}

describe('surface coefficients composed with lane ownership', () => {
  it('keeps interleaved warm tracks exact through weather, exposure, drainage and traffic changes', () => {
    const rain = pair('rain', FIGURE_EIGHT_OVERPASS, [
      weatherFrame(0, {}),
      weatherFrame(1, {
        rainRateMmHr: 0,
        ambientTempC: 10,
        windSpeedMS: 0,
        moistureMmHr: 3,
        fogCover01: 0.9,
      }),
      weatherFrame(2, {
        cloudCover01: 0,
        rainRateMmHr: 0,
        ambientTempC: 40,
        windSpeedMS: 8,
      }),
      weatherFrame(3, { rainRateMmHr: 8, windSpeedMS: 1 }),
      weatherFrame(4, { rainRateMmHr: 0, ambientTempC: 28 }),
    ]);
    const snow = pair('snow', circuitDefinition('speedbowl'), [
      weatherFrame(0, { ambientTempC: -6, rainRateMmHr: 3 }),
      weatherFrame(1, { ambientTempC: -3, rainRateMmHr: 6 }),
      weatherFrame(2, { ambientTempC: 8, rainRateMmHr: 12, windSpeedMS: 4 }),
      weatherFrame(4, { ambientTempC: 30, rainRateMmHr: 0 }),
    ]);
    // Both decks reuse the same horizontal lane-cache cell but own separate
    // climate-grid rows and receive their own contact work.
    rain.queries[0] = [0, 0, 0.5];
    rain.queries[1] = [0, 0, 9.5];
    const pairs = [rain, snow];
    expect(laneOwner(rain.track).laneIndex).not.toBe(laneOwner(snow.track).laneIndex);
    expect(laneCells(rain.track)).not.toBe(laneCells(snow.track));
    const warmEntries = pairs.map(({ track, queries }) => {
      for (const [x, z, y] of queries) track.sample(x, z, surfaceSample(), y);
      return [...laneCells(track)];
    });
    const [lowerX, lowerZ, lowerY] = rain.queries[0];
    const [upperX, upperZ, upperY] = rain.queries[1];
    const rainLower = rain.track.sample(lowerX, lowerZ, surfaceSample(), lowerY);
    const rainUpper = rain.track.sample(upperX, upperZ, surfaceSample(), upperY);
    expect(rainLower.cell).not.toBe(rainUpper.cell);
    let time = 0;
    for (const [tick, dt] of [0.25, 0.25, 0.75, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5].entries()) {
      time += dt;
      for (const [world, { track, reference, queries }] of pairs.entries()) {
        const other = pairs[1 - world].track;
        const untouched = surfaceState(other);
        const [x, z, y] = queries[0];
        const cell = track.sample(x, z, surfaceSample(), y).cell;
        for (const owner of [track, reference]) {
          if (tick === 1) owner.sheltered[Math.floor(cell / CELL_COLS)] = 1;
          if (tick === 3) owner.drainage[cell] = 0;
          if (tick === 4) {
            owner.sheltered[Math.floor(cell / CELL_COLS)] = 0;
            owner.drainage[cell] = 1e-15;
            if (world === 0) {
              owner.water[cell] = 1e-4;
              owner.temperature[cell] = 60;
              owner.substrateTemperature[cell] = 30;
            }
          }
          if (tick === 5) {
            owner.drainage[cell] = 0.031;
            if (world === 1) {
              // Reach an actual melt event without a long warming sweep.
              owner.temperature[cell] = 1.5;
              owner.substrateTemperature[cell] = 8;
              owner.frozen[cell] = 0.2;
              owner.water[cell] = 0.004;
            }
          }
        }
        for (const [query, [qx, qz, qy]] of queries.entries()) {
          const actual = track.sample(qx, qz, surfaceSample(), qy);
          const expected = reference.sample(qx, qz, surfaceSample(), qy);
          expect(actual).toStrictEqual(expected);
          for (const [owner, contact] of [
            [track, actual],
            [reference, expected],
          ] as const)
            owner.interact(contact.cell, 3000, 1e5 * (query + 1), 12, 0.01, contact.surface, 0.2);
        }
        if (tick === 4 && world === 0) expect(track.water[cell]).toBeGreaterThan(0);
        track.evolve(dt, time);
        evolveWithoutCellCoefficients(reference, dt, time);
        expect(surfaceState(track)).toStrictEqual(surfaceState(reference));
        expect(surfaceState(other)).toStrictEqual(untouched);
        for (const [qx, qz, qy] of queries)
          expect(track.sample(qx, qz, surfaceSample(), qy)).toStrictEqual(
            reference.sample(qx, qz, surfaceSample(), qy),
          );
        if (tick === 2 && world === 0) expect(track.fogCover).toBeGreaterThan(0);
        if (tick === 4 && world === 0) expect(track.water[cell]).toBe(0);
        if (tick === 1 && world === 1) expect(track.meanFrozen()).toBeGreaterThan(0);
        if (tick === 5 && world === 1) {
          expect(track.frozen[cell]).toBeLessThan(0.2);
          expect(track.water[cell]).toBeGreaterThan(0.004);
        }
        expect(laneCells(track).size).toBeLessThanOrEqual(2048);
        for (const [key, entry] of warmEntries[world])
          expect(laneCells(track).get(key)).toBe(entry);
      }
    }
  });

  it('reconstructs wet surface history and pending traffic heat when rewinding between surface ticks', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      mode: 'practice' as const,
      opponents: 0,
      weather: 'rain' as const,
      seed: 2505,
    };
    const live = new Simulation(options);
    const initial = surfaceState(live.track);
    const log = new InputLog();
    applyLoggedInput(live, log, { ...controls(), throttle: 1 });
    while (live.tick < 120) live.step(FLASHBACK.dt);
    const interactions = vi.spyOn(live.track, 'interact');
    while (live.tick < 145) live.step(FLASHBACK.dt);
    expect(
      interactions.mock.calls.some(
        ([, load, energy, , dt, surface]) =>
          load > 1 &&
          energy > 0 &&
          dt > 0 &&
          (surface === SURFACE.ASPHALT || surface === SURFACE.PAINT || surface === SURFACE.KERB),
      ),
    ).toBe(true);
    interactions.mockRestore();
    const checkpoint = surfaceState(live.track);
    const checkpointFrame = live.makeFrame();
    expect(checkpoint.clock).toBeGreaterThan(0);
    expect(checkpoint.clock).toBeLessThan(0.5);
    while (live.tick < 205) live.step(FLASHBACK.dt);
    const completed = surfaceState(live.track);
    const completedFrame = live.makeFrame();

    const rewind = new Resimulation(options, log.entries, 145, { now: () => 0 });
    expect(rewind.simulation.track).not.toBe(live.track);
    expect(laneOwner(rewind.simulation.track).laneIndex).not.toBe(laneOwner(live.track).laneIndex);
    expect(surfaceState(rewind.simulation.track)).toStrictEqual(initial);
    while (!rewind.run(37)) {
      /* replay slices */
    }
    expect(surfaceState(rewind.simulation.track)).toStrictEqual(checkpoint);
    expect(rewind.simulation.makeFrame()).toStrictEqual(checkpointFrame);
    while (rewind.simulation.tick < 205) rewind.simulation.step(FLASHBACK.dt);
    expect(surfaceState(rewind.simulation.track)).toStrictEqual(completed);
    expect(rewind.simulation.makeFrame()).toStrictEqual(completedFrame);
    expect(surfaceState(live.track)).toStrictEqual(completed);
  });

  it('keeps terrain contact authoritative after warming coefficients and restoring or resetting ruts', () => {
    const track = new Track('rain', false, undefined, circuitDefinition('valley-ridge-mx'));
    const surface = Track.offroadOf(track);
    expect(surface).toBeInstanceOf(TrackTerrainSurface);
    const terrain = (surface as TrackTerrainSurface).terrain;
    const p = track.at(110.82, trackPoint());
    const query = () => track.sample(p.x, p.z, surfaceSample(), p.y + 8);
    track.evolve(0.5, 0.5);
    const before = query();
    expect(before.terrain).toBe(true);
    const checkpoint = terrain.checkpoint();
    for (let i = 0; i < 12; i++) terrain.deform(before.lateral, before.s, 1800, 0.6, 0.02);
    const rutted = query();
    expect(rutted.height).toBeLessThan(before.height);
    expect(rutted.cell).toBe(before.cell);
    track.evolve(0.5, 1);
    expect(query().height).toBe(rutted.height);
    const state = surfaceState(track);
    terrain.restore(checkpoint);
    const restored = query();
    expect(restored.height).toBe(before.height);
    expect(restored.water).toBe(track.water[restored.cell]);
    expect(restored.temp).toBe(track.temperature[restored.cell]);
    expect(surfaceState(track)).toStrictEqual(state);
    terrain.deform(before.lateral, before.s, 1800, 0.6, 0.02);
    terrain.reset();
    expect(query().height).toBe(before.height);
    expect(surfaceState(track)).toStrictEqual(state);
  });
});
