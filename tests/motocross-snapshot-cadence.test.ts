import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

const venues = [
  ['valley-ridge-mx', 'mx450'],
  ['arena-nord-sx', 'mx250'],
] as const;

it.each(venues)(
  '%s preserves all eight riders and disturbed soil at 30, 60 and 120 Hz snapshot publication',
  async (circuit, vehicle) => {
    const commonFrames: Buffer[] = [];
    let terrainHash: string | undefined;
    for (const publishHz of [30, 60, 120]) {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        circuit,
        vehicles: Array(8).fill(vehicle),
        opponents: 7,
        seed: 75243,
        laps: 5,
        mode: 'race',
        ruleset: 'motocross-moto',
      });
      const frame = new Float32Array(HEADER + 8 * CAR_STRIDE);
      const bytes = Buffer.from(frame.buffer);
      const input = controls();
      let shared = 0;
      let published = 0;
      let peakSpeed = 0;
      for (let tick = 1; tick <= 24 * 120; tick++) {
        sim.autoPlayer = tick > 1500;
        if (!sim.autoPlayer) {
          input.throttle = tick < 500 ? 0.72 : 0.9;
          input.brake = tick > 1100 && tick < 1180 ? 0.26 : 0;
          input.steer = Math.sin(tick * 0.014) * 0.052;
          input.riderLean = Math.cos(tick * 0.009) * 0.17;
          sim.setInput(input);
        }
        sim.step(1 / 120);
        // Let the runner process progress messages between chunks of fixed-step work.
        if (tick % 240 === 0) await setImmediate();
        if (tick % (120 / publishHz) !== 0) continue;
        sim.writeFrame(frame);
        published++;
        if (tick % 4 !== 0) continue;
        // Hash every byte, including all rivals and the wheel and suspension channels.
        const digest = createHash('sha256').update(bytes).digest();
        if (publishHz === 30) commonFrames.push(digest);
        else
          expect(digest.equals(commonFrames[shared]), `${publishHz} Hz at tick ${tick}`).toBe(true);
        peakSpeed = Math.max(peakSpeed, frame[carBase(0) + F.SPEED]);
        shared++;
      }
      expect(shared).toBe(720);
      expect(published).toBe(24 * publishHz);
      expect(frame[H.TICK]).toBe(2880);
      expect(peakSpeed).toBeGreaterThan(4);
      const ground = sim.offroad!.terrain.hash();
      if (publishHz === 30) terrainHash = ground;
      else expect(ground).toBe(terrainHash);
    }
  },
  120_000,
);
