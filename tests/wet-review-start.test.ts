import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { Effects } from '../src/rendering/effects.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import {
  RaceReviewEvents,
  raceReviewFrame,
  readRaceReviewFrame,
} from '../src/rendering/race-review.ts';

// Production simulation and particle observations only; no GPU pixels or human
// handling claim. Render sampling never changes the 120 Hz physics/controller.
describe('wet review prepared before the physical grid release', () => {
  it.each([
    { name: '2 Hz', intervals: [60] },
    { name: '1.5 Hz', intervals: [80] },
    { name: 'irregular subsecond sampling', intervals: [40, 75, 110, 85, 55] },
  ])(
    'qualifies real following with $name without relaxing its three-second gate',
    ({ intervals }) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'race',
        laps: 5,
        opponents: 7,
        weather: 'rain',
        compound: 'wet',
      });
      sim.autoPlayer = true;
      const frame = sim.makeFrame(),
        events = new RaceReviewEvents(),
        noSpray = new RaceReviewEvents(),
        sample = raceReviewFrame(),
        effects = new Effects(),
        playback = new EffectPlayback(effects);
      try {
        const prepared = frame.slice();
        // Repeated held frames cannot manufacture grid movement or following.
        for (let held = 0; held < 20; held++) {
          playback.update(frame, true, true);
          readRaceReviewFrame(frame, 0, effects.activeSprayCountFor(0), 0, sample);
          events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], sample);
        }
        expect(frame[H.TIME]).toBe(0);
        expect(frame[H.TICK]).toBe(0);
        expect(events.qualified('wet-following')).toBe(false);
        expect(frame).toEqual(prepared);
        let nextSample = 0,
          index = 0,
          maximumLeaderSpray = 0;
        for (let tick = 0; tick < 60 * 120; tick++) {
          sim.step(1 / 120);
          if (tick < nextSample) continue;
          nextSample += intervals[index++ % intervals.length];
          sim.writeFrame(frame);
          const before = frame.slice();
          playback.update(frame, true, true);
          readRaceReviewFrame(frame, 0, 0, 0, sample);
          sample.sprayParticles = effects.activeSprayCountFor(sample.leader);
          maximumLeaderSpray = Math.max(maximumLeaderSpray, sample.sprayParticles);
          events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], sample);
          // The same real wet field cannot qualify when its leader's emitted spray
          // is absent. Do not confuse a wet-weather label with observed following.
          noSpray.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], {
            ...sample,
            sprayParticles: 0,
          });
          expect(frame).toEqual(before);
          if (events.qualified('wet-following')) break;
        }
        expect(sim.cars).toHaveLength(8);
        expect(sim.cars.every((car) => car.body.position.finite() && !car.retired)).toBe(true);
        expect(maximumLeaderSpray).toBeGreaterThan(0);
        expect(events.summary('wet-following')).toMatchObject({
          qualified: true,
          gridLaunched: true,
          visualAccepted: false,
        });
        expect(events.wetFollowingSeconds).toBeGreaterThanOrEqual(3);
        expect(sim.race.time).toBeLessThan(60);
        expect(noSpray.qualified('wet-following')).toBe(false);
      } finally {
        const geometries = new Set<T.BufferGeometry>(),
          materials = new Set<T.Material>();
        effects.group.traverse((object) => {
          if (object instanceof T.Mesh || object instanceof T.Points) {
            geometries.add(object.geometry);
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              materials.add(material);
          }
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      }
    },
    30000,
  );
});
