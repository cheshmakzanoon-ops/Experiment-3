import { expect, it } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { sampleSecondaryStandLap } from '../e2e/fixtures/secondary-stand-traversal.ts';
for (const weather of ['clear', 'rain'] as const)
  it(`A12 ${weather}: visits all six stands with exact live, ordered production frames`, async () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      opponents: 11,
      weather,
      seed: 1887,
    });
    sim.autoPlayer = true;
    for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
    let previousTime = -Infinity,
      previousStation = -Infinity;
    const counts = new Map<number, number>();
    const result = await sampleSecondaryStandLap(sim, (sample) => {
      expect(sample.frame).toEqual(sim.makeFrame());
      expect(sample.station).toBe(sim.cars[0].s);
      expect(sample.time).toBeGreaterThan(previousTime);
      expect(sample.station).toBeGreaterThan(previousStation);
      expect(sample.delta).toBeGreaterThan(0);
      expect(sample.station).toBeGreaterThanOrEqual(sample.site - 100);
      expect(sample.station).toBeLessThanOrEqual(sample.site + 110);
      counts.set(sample.site, (counts.get(sample.site) ?? 0) + 1);
      previousTime = sample.time;
      previousStation = sample.station;
    });
    expect(result.completed).toBe(true);
    expect([...counts.keys()]).toEqual([450, 780, 1220, 1670, 2210, 2600]);
    for (const count of counts.values()) expect(count).toBeGreaterThanOrEqual(4);
  }, 120000);
it('A12 rejects an invalid starting session without stepping it', async () => {
  for (const options of [
    { ...DEFAULT_OPTIONS, circuit: 'vellamar' as const },
    { ...DEFAULT_OPTIONS },
  ]) {
    const sim = new Simulation(options),
      before = sim.makeFrame().slice();
    await expect(sampleSecondaryStandLap(sim)).rejects.toThrow();
    expect(sim.makeFrame()).toEqual(before);
  }
});
