import { expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PHASE, type RaceDirector } from '../src/simulation/race.ts';
import { RACING_LINE, racingLineFor } from '../src/simulation/racing-line.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;

class PathProbe extends BikeAIDriver {
  atLimit: ReturnType<PathProbe['selection']> | null = null;
  selection() {
    return { ...this.selectedRoadPath };
  }
  selectedOffsetForReview(track: Track, station: number, previous = false) {
    return this.selectedRoadOffset(
      track,
      station,
      previous ? this.selectedRoadPath.previousLane : this.selectedRoadPath.lane,
    );
  }
  alterUnusedRoadSnapshot() {
    this.selectedRoadPath.lane = this.selectedRoadPath.previousLane = 999;
  }
  protected override limitSpeed(
    desired: number,
    track: Track,
    race: RaceDirector,
    offset = this.bike.aiOffset,
  ) {
    this.atLimit = this.selection();
    return super.limitSpeed(desired, track, race, offset);
  }
}

const native = (driver: BikeAIDriver) =>
  driver as unknown as {
    offset: number;
    steeringTarget: number;
    steerIntent(track: Track, steer: number): number;
  };

function fixture(vehicle = 'gpr1', lateral = -3.5) {
  const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'montejaral',
      mode: 'practice',
      opponents: 0,
      vehicles: [vehicle],
      seed: 5111,
    }),
    bike = sim.cars[0] as BikeVehicle,
    driver = new PathProbe(bike);
  sim.race.phase = PHASE.RACING;
  sim.race.time = sim.race.greenAt + 2;
  bike.place(sim.track, 960, lateral);
  bike.speed = bike.dynamics.speed = 40;
  const update = () => driver.update(DT, sim.track, sim.cars, sim.race);
  update();
  return { sim, bike, driver, update };
}

it('retains the selected current lane when its published preview is clipped at a different station', () => {
  const { sim, bike, driver } = fixture(),
    line = racingLineFor(sim.track),
    near = bike.s + 6 + bike.speed * 0.48,
    previewReach = sim.track.at(near, trackPoint()).width - RACING_LINE.edgeMargin,
    currentReach = bike.trackPosition.width - RACING_LINE.edgeMargin,
    actual = native(driver);
  expect(driver.selection().valid).toBe(true);
  expect(driver.atLimit).toEqual(driver.selection());
  expect(Math.abs(actual.offset)).toBeLessThan(currentReach);
  expect(Math.abs(bike.aiOffset)).toBeCloseTo(previewReach, 12);
  expect(driver.selectedOffsetForReview(sim.track, near)).toBeCloseTo(bike.aiOffset, 12);
  expect(driver.selectedOffsetForReview(sim.track, bike.s)).toBeCloseTo(actual.offset, 12);
  expect(actual.steeringTarget).toBeCloseTo(actual.offset, 12);
  const fromClippedPreview = line.offsetAt(bike.s) + bike.aiOffset - line.offsetAt(near);
  expect(Math.abs(fromClippedPreview - actual.steeringTarget)).toBeGreaterThan(2);
});

it('uses the existing base road bound for the selected current point as well as its preview', () => {
  const { sim, bike, driver } = fixture('gpr1', 5.4),
    reach = bike.trackPosition.width - RACING_LINE.edgeMargin;
  expect(Math.abs(native(driver).offset)).toBeGreaterThan(reach);
  expect(driver.selectedOffsetForReview(sim.track, bike.s)).toBeCloseTo(reach, 12);
  expect(native(driver).steeringTarget).toBeCloseTo(reach, 12);
});

it('rebases the previous selected point at takeover instead of turning a pose jump into lane velocity', () => {
  const { sim, bike, driver, update } = fixture();
  sim.race.time += 1;
  bike.place(sim.track, bike.s + 20, 1.5);
  bike.speed = bike.dynamics.speed = 40;
  const placedLateral = bike.lateral;
  update();
  expect(driver.selection().valid).toBe(true);
  expect(driver.selectedOffsetForReview(sim.track, bike.s, true)).toBeCloseTo(placedLateral, 12);
  expect(driver.selection().dt).toBe(DT);
});

it.each(['lights', 'reaction', 'rider-down', 'pit', 'pit-approach'] as const)(
  'invalidates the selected road snapshot for %s',
  (mode) => {
    const { sim, bike, driver, update } = fixture();
    expect(driver.selection().valid).toBe(true);
    if (mode === 'lights') sim.race.phase = PHASE.LIGHTS;
    else if (mode === 'reaction') sim.race.time = sim.race.greenAt;
    else if (mode === 'rider-down') bike.dynamics.state = 'lowside';
    else if (mode === 'pit') {
      bike.inPit = true;
      bike.pitPhase = 1;
    } else {
      bike.place(sim.track, mod(sim.track.pitEntryS() - 10, sim.track.length), 0);
      bike.speed = bike.dynamics.speed = 15;
      bike.pitRequested = true;
    }
    update();
    expect(driver.selection().valid).toBe(false);
  },
);

it('leaves non-GP steering on its existing path contract', () => {
  const { sim, driver } = fixture('sbk1000'),
    target = native(driver).steeringTarget;
  expect(driver.selection().valid).toBe(true);
  driver.alterUnusedRoadSnapshot();
  native(driver).steerIntent(sim.track, 0);
  expect(native(driver).steeringTarget).toBe(target);
});
