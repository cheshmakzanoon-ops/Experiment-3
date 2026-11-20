import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { FixedStepper } from '../src/core/math.ts';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { B, BIKE_BASE, carBase, F } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

function drive(pulses: readonly number[]) {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    ruleset: 'gp-motorcycle',
    circuit: 'poggio-alto',
    vehicles: ['gpr2', 'gpr1'],
    opponents: 1,
    laps: 3,
    seed: 30101,
  });
  const clock = new FixedStepper(),
    input = controls(),
    digest = createHash('sha256');
  const frame = simulation.makeFrame(),
    bytes = new Uint8Array(frame.buffer),
    rider = carBase(0);
  let elapsed = 0,
    pulse = 0,
    peakSpeed = 0,
    peakLean = 0,
    peakBrake = 0;
  while (elapsed < 24 - 1e-9) {
    const delta = Math.min(pulses[pulse++ % pulses.length], 24 - elapsed);
    clock.advance(delta, (dt) => {
      // Recorded input belongs to a physics tick, including the start of a squeeze and its release.
      const t = clock.ticks / 120;
      input.throttle = t < 14 ? 0.78 : t < 17 ? 0 : 0.42;
      input.brake = t >= 14 && t < 17 ? 0.36 : 0;
      input.steer = t >= 11 && t < 16 ? 0.12 * Math.sin((t - 11) * Math.PI * 0.4) : 0;
      simulation.setInput(input);
      simulation.step(dt);
      simulation.writeFrame(frame);
      digest.update(bytes);
      peakSpeed = Math.max(peakSpeed, frame[rider + F.SPEED]);
      peakLean = Math.max(peakLean, Math.abs(frame[rider + BIKE_BASE + B.LEAN]));
      peakBrake = Math.max(peakBrake, frame[rider + F.BRAKE]);
    });
    elapsed += delta;
  }
  return {
    hash: digest.digest('hex'),
    ticks: clock.ticks,
    dropped: clock.droppedSeconds,
    peakSpeed,
    peakLean,
    peakBrake,
  };
}

it('replays GP wheel, rider and race snapshots identically at steady and uneven clock cadences', () => {
  const baseline = drive([1 / 60]);
  expect(baseline.ticks).toBe(2880);
  expect(baseline.dropped).toBe(0);
  expect(baseline.peakSpeed).toBeGreaterThan(20);
  expect(baseline.peakLean).toBeGreaterThan(0.05);
  expect(baseline.peakBrake).toBeCloseTo(0.36, 5);
  for (const cadence of [[1 / 30], [1 / 144], [0.004, 0.029, 0.013, 0.021, 0.008, 0.025]])
    expect(drive(cadence)).toEqual(baseline);
});
