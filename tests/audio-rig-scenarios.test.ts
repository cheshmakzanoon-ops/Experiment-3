import { describe, expect, it } from 'vitest';
import {
  ENGINE_KINDS,
  FRAME_STEP,
  REPRESENTATIVES,
  SAMPLE_RATE,
  effectScenarios,
  engineScenarios,
  enginePlan,
  expectedF0,
  forwardGears,
  mixScenarios,
  speedAt,
  torqueAt,
} from '../scripts/studio/tools/audio-scenarios.ts';
import { VEHICLES, VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import { SpatialAudioScene } from '../src/audio/spatial.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';

/** The measurement rig is only as honest as the snapshots it feeds the production
 * audio graph: these pin that the synthetic engine states are physically sane and
 * that every scene is a valid presented frame. */
describe('audio rig scenarios', () => {
  it('steps frames on the render quantum so context.suspend() lands on every one', () => {
    expect((FRAME_STEP * SAMPLE_RATE) % 128).toBe(0);
    expect(FRAME_STEP).toBeGreaterThan(0.025); // RacingAudio.update skips steps closer than 25 ms
  });
  it('renders the catalogue: every representative exists, ids are unique', () => {
    for (const id of REPRESENTATIVES) expect(VEHICLES[id], id).toBeDefined();
    const all = [...engineScenarios(), ...effectScenarios(), ...mixScenarios()];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    const mixes = all.filter((s) => s.group === 'engine' && s.tags.kind === 'mid');
    expect(mixes.length).toBe(VEHICLE_IDS.length);
  });
  it('interpolates torque curves and converts revs to road speed through the gearbox', () => {
    const curve = [
      [1000, 100],
      [3000, 300],
    ] as const;
    expect(torqueAt(curve, 500)).toBe(100);
    expect(torqueAt(curve, 2000)).toBe(200);
    expect(torqueAt(curve, 9000)).toBe(300);
    expect(speedAt('apx01', 8, 12000)).toBeGreaterThan(speedAt('apx01', 1, 12000));
    expect(forwardGears('apx01')).toBe(8);
  });
  it('keeps every engine plan inside the rev range, in a real gear, with revs falling on each upshift', () => {
    for (const id of REPRESENTATIVES) {
      const spec = VEHICLES[id].spec;
      for (const kind of ENGINE_KINDS) {
        const plan = enginePlan(id, kind);
        expect(plan.seconds, `${id} ${kind}`).toBeGreaterThanOrEqual(2);
        const gears = forwardGears(id);
        for (let t = 0; t < plan.seconds; t += 0.05) {
          const s = plan.at(t);
          expect(Number.isFinite(s.rpm + s.torque + s.speed), `${id} ${kind} ${t}`).toBe(true);
          expect(s.rpm, `${id} ${kind} ${t}`).toBeLessThanOrEqual(spec.limiterRPM);
          expect(s.rpm, `${id} ${kind} ${t}`).toBeGreaterThan(0);
          expect(s.gear).toBeGreaterThanOrEqual(1);
          expect(s.gear).toBeLessThanOrEqual(Math.max(1, gears));
        }
        const sorted = [...plan.events].sort((a, b) => a - b);
        expect(plan.events).toEqual(sorted);
        if (kind === 'shift' || kind === 'pull')
          for (const e of plan.events) {
            const before = plan.at(e - 0.02),
              after = plan.at(e + 0.3);
            expect(after.gear, `${id} ${kind} @${e}`).toBeGreaterThan(before.gear);
            expect(after.rpm, `${id} ${kind} @${e}`).toBeLessThan(before.rpm);
          }
      }
    }
  });
  it('expects the electric voice to follow road speed and the others the firing frequency', () => {
    const f = expectedF0('apx01', {
      rpm: 6000,
      torque: 0,
      speed: 0,
      gear: 1,
      throttle: 0,
      brake: 0,
    });
    expect(f).toBeCloseTo((6000 / 60) * 3, 6); // V6: three firings per revolution
    const slow = expectedF0('eh3', { rpm: 0, torque: 0, speed: 0, gear: 1, throttle: 0, brake: 0 });
    const fast = expectedF0('eh3', {
      rpm: 0,
      torque: 0,
      speed: 60,
      gear: 1,
      throttle: 0,
      brake: 0,
    });
    expect(fast).toBeGreaterThan(slow);
  });
  it('builds valid presented snapshots for every scene (grid size, finite, car 0 is the listener target)', () => {
    const scene = new SpatialAudioScene();
    for (const s of [...effectScenarios(), ...mixScenarios(), ...engineScenarios().slice(0, 40)]) {
      for (const t of [0, s.seconds / 2, s.seconds - FRAME_STEP]) {
        const frame = s.frameAt(t);
        expect(frame.length, s.id).toBe(HEADER + frame[H.CARS] * CAR_STRIDE);
        expect(frame.every(Number.isFinite), s.id).toBe(true);
        expect(() => scene.update(frame, s.viewAt(t)), s.id).not.toThrow();
      }
      expect(s.seconds, s.id).toBeGreaterThan(0.5);
    }
  });
});
