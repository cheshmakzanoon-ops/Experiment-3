import { expect, it } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { landmarkSitePlan } from '../src/rendering/venue-landmark.ts';
import { sampleHallApproach } from '../e2e/fixtures/event-hall-approach.ts';

for (const weather of ['clear', 'rain'] as const) {
  it(`A71 ${weather} approach retains at least four native physics samples`, () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      opponents: 11,
      weather,
      seed: 1887,
    });
    sim.autoPlayer = true;
    for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
    const site = landmarkSitePlan(sim.track);
    const observed: number[] = [];
    const result = sampleHallApproach(sim, site.s, (sample) => {
      expect(sim.makeFrame()).toEqual(sample.frame);
      expect(sim.cars[0].s).toBe(sample.station);
      observed.push(sample.time);
    });
    expect(observed).toEqual(result.samples.map((sample) => sample.time));
    expect(result.completed).toBe(true);
    expect(result.samples.length).toBeGreaterThanOrEqual(4);
    expect(result.samples.length).toBeLessThanOrEqual(6);
    for (let i = 0; i < result.samples.length; i++) {
      const sample = result.samples[i];
      expect(sample.frame[H.CARS]).toBe(12);
      expect(sample.station).toBeGreaterThanOrEqual(site.s - 100);
      expect(sample.station).toBeLessThanOrEqual(site.s + 110);
      expect(sample.delta).toBeCloseTo(0.125, 5);
      expect(sample.frame).not.toBe(sample.previous);
      expect(sample.time).toBe(sample.frame[H.TIME]);
      if (i) {
        expect(sample.time).toBeGreaterThan(result.samples[i - 1].time);
        expect(sample.station - result.samples[i - 1].station).toBeGreaterThanOrEqual(40);
      }
    }
    expect(sim.cars[0].s).toBeGreaterThan(site.s + 110);
  });
}
it('A71 approach rejects invalid sites before stepping physics', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 });
  const initial = sim.makeFrame().slice();
  for (const station of [NaN, Infinity, -1, 99, sim.track.length - 100])
    expect(() => sampleHallApproach(sim, station)).toThrow('Invalid A71 approach station');
  expect(sim.makeFrame()).toEqual(initial);
});
