import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { SC_PHASE, SAFETY_CAR } from '../src/simulation/safety-car.ts';
import { Simulation } from '../src/simulation/world.ts';
import {
  VISIBILITY_RULES,
  WeatherTimeline,
  raceHazard,
  safePaceMS,
  weatherKeyframes,
  type RaceHazard,
  type WeatherKeyframe,
} from '../src/simulation/weather.ts';
import { WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';

describe('race control: what the drivers can see and the water on the road', () => {
  it('safePaceMS is the speed one can stop from inside the view (1 s reaction, 8 m/s2)', () => {
    // v = a (sqrt(t^2 + 2 V / a) - t): the stopping distance v t + v^2 / 2a equals the view.
    for (const view of [20, 35, 60, 100, 170, 480]) {
      const v = safePaceMS(view);
      expect(v * VISIBILITY_RULES.reaction + (v * v) / (2 * VISIBILITY_RULES.braking)).toBeCloseTo(
        view,
        9,
      );
    }
    // The virtual-safety-car pace (32 m/s) is what 96 m of view allows.
    expect(safePaceMS(100)).toBeCloseTo(32.8, 1);
    expect(safePaceMS(60)).toBeCloseTo(24, 6);
    expect(safePaceMS(35)).toBeCloseTo(17, 0);
    expect(safePaceMS(0)).toBe(0);
    expect(safePaceMS(Number.NaN)).toBe(0);
  });
  it('is green in clear air, the shipped presets at their worst, and ordinary rain', () => {
    expect(raceHazard(30000, 0)).toBe(0);
    expect(raceHazard(110, 0.03)).toBe(0); // Dawn fog at its opening 110 m
    expect(raceHazard(170, 0)).toBe(0); // Dust storm at its worst
    expect(raceHazard(483, 2.5)).toBe(0); // Thunderstorm: view and deepest mean water
    expect(raceHazard(2400, 1.1)).toBe(0); // Heavy rain
    // And the weather presets never cross a line over their whole timeline (view alone).
    for (const id of WEATHER_IDS) {
      const min = Math.min(...weatherKeyframes(id).map((k) => k.visibilityM ?? 30000));
      expect(raceHazard(min, 0), id).toBe(0);
    }
  });
  it('steps up at 100 m, 60 m and 35 m of view, and at 3.5, 5 and 7 mm of mean water', () => {
    expect(raceHazard(99, 0)).toBe(1);
    expect(raceHazard(59, 0)).toBe(2);
    expect(raceHazard(34, 0)).toBe(3);
    expect(raceHazard(30000, 3.6)).toBe(1);
    expect(raceHazard(30000, 5.1)).toBe(2);
    expect(raceHazard(30000, 7.1)).toBe(3);
    // The worse of the two readings wins.
    expect(raceHazard(80, 5.1)).toBe(2);
    expect(raceHazard(30, 3.6)).toBe(3);
  });
  it('lets a level go only 25 % clear of its line, so a flickering bank does not flap the race', () => {
    let level: RaceHazard = 0;
    const read = (view: number) => (level = raceHazard(view, 0, level));
    expect(read(98)).toBe(1);
    expect(read(105)).toBe(1); // above the line, inside the release margin
    expect(read(124)).toBe(1);
    expect(read(126)).toBe(0);
    expect(read(55)).toBe(2);
    expect(read(70)).toBe(2);
    expect(read(76)).toBe(1); // Released from 2 (60 x 1.25 = 75) but still inside reduced pace
    expect(read(30)).toBe(3);
    expect(read(40)).toBe(3);
    expect(read(43)).toBe(3);
    expect(read(44)).toBe(2); // 35 x 1.25 = 43.75
    // Non-finite readings change nothing.
    expect(raceHazard(Number.NaN, 0, 2)).toBe(2);
  });
});

describe('the safety car director follows the hazard ladder', () => {
  // A dense bank that thickens and lifts on a fixed schedule of session time.
  const schedule: WeatherKeyframe[] = [
    [0, 30000],
    [10, 30000],
    [11, 80],
    [40, 80],
    [41, 50],
    [70, 50],
    [71, 25],
    [110, 25],
    [111, 30000],
    [600, 30000],
  ].map(([timeSec, visibilityM]) => ({
    timeSec,
    visibilityM,
    cloudCover01: 0.3,
    rainRateMmHr: 0,
    ambientTempC: 15,
    windSpeedMS: 1,
    windDirection: 0.5,
  }));
  const start = () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      laps: 30,
      opponents: 3,
      seed: 4417,
    });
    sim.autoPlayer = true;
    Object.defineProperty(sim.track, 'weather', { value: new WeatherTimeline(schedule) });
    return sim;
  };
  const speeds = (sim: Simulation) => sim.cars.map((c) => c.speed);
  it('runs reduced pace, safety car and suspension through the bank, then lifts back to green', () => {
    const sim = start(),
      DT = 1 / 120,
      session = () => sim.race.time - sim.race.greenAt;
    const at = (t: number) => {
      while (session() < t) sim.step(DT);
    };
    at(9);
    expect(sim.race.hazard).toBe(0);
    expect(sim.race.safetyCar.phase).toBe(SC_PHASE.NONE);
    expect(sim.race.safetyCar.deployments).toBe(0);

    at(26);
    expect(sim.race.hazard).toBe(1);
    expect(sim.race.safetyCar.phase).toBe(SC_PHASE.VSC);
    expect(sim.race.message).toContain('LOW VISIBILITY');
    expect(sim.race.message).toContain('VIRTUAL SAFETY CAR');
    // Limited to what 80 m of view allows (29.6 m/s), with a little braking slack.
    expect(Math.max(...speeds(sim))).toBeLessThan(33);

    at(56);
    expect(sim.race.hazard).toBe(2);
    expect(sim.race.safetyCar.phase).toBe(SC_PHASE.DEPLOYED);
    expect(sim.race.safetyCar.deployments).toBe(1);
    expect(sim.race.safetyCar.speed).toBeLessThanOrEqual(safePaceMS(50) + 1e-6);
    expect(sim.race.safetyCar.speed).toBeLessThan(SAFETY_CAR.scSpeed);
    expect(sim.race.message).toContain('SAFETY CAR');

    at(100);
    expect(sim.race.hazard).toBe(3);
    expect(sim.race.safetyCar.suspended).toBe(true);
    expect(sim.race.safetyCar.speed).toBeLessThan(0.5);
    expect(Math.max(...speeds(sim))).toBeLessThan(4);
    expect(sim.race.message).toContain('RACE SUSPENDED');
    for (const car of sim.cars) expect(car.body.position.finite()).toBe(true);
    // Held on the road, not recovered by marshals, and nobody retires.
    expect(sim.cars.every((c) => !c.retired)).toBe(true);

    at(112);
    // The bank lifts; the ladder hands back down without a hard jump to green.
    expect(sim.race.hazard).toBeLessThanOrEqual(2);
    at(200);
    expect(sim.race.hazard).toBe(0);
    expect(sim.race.safetyCar.suspended).toBe(false);
    expect(sim.race.safetyCar.phase).toBe(SC_PHASE.NONE);
    expect(Math.max(...speeds(sim))).toBeGreaterThan(20);
  }, 120000);
  it('leaves a race without a weather hazard exactly as it was', () => {
    const a = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 3, seed: 4417 });
    a.autoPlayer = true;
    for (let i = 0; i < 120 * 30; i++) a.step(1 / 120);
    expect(a.race.hazard).toBe(0);
    expect(a.race.safetyCar.deployments).toBe(0);
    expect(a.race.safetyCar.hazard).toBe(0);
  });
});
