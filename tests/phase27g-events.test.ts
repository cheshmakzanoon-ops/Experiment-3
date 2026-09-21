import { referencePixelSample } from '../src/ui/reference-image.ts';
import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { SURFACE } from '../src/simulation/track.ts';
import {
  observeRace,
  referenceEvent,
  ReferenceEventWatch,
} from '../src/rendering/reference-events.ts';
import { postSignal } from '../src/rendering/marshal-staff.ts';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
import { referenceRoute } from '../src/ui/reference-routes.ts';

// Synthetic snapshots only exercise predicates. They are never saved as driving evidence.
function snapshot() {
  const f = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3 }).makeFrame();
  f[H.TIME] = 0;
  f[H.PHASE] = PHASE.RACING;
  for (let id = 0; id < 4; id++) {
    const b = carBase(id);
    f[b + F.X] = id === 1 ? 2.2 : 0;
    f[b + F.Z] = id * 2;
    f[b + F.S] = 100 + id * 2;
    f[b + F.Y] = 0.5;
    f[b + F.LATERAL] = id === 1 ? 2.2 : 0;
    f[b + F.SPEED] = 28;
    f[b + F.IN_PIT] = 0;
    f[b + F.PIT_PHASE] = 0;
    for (let wheel = 0; wheel < 4; wheel++) {
      const w = b + WHEEL_BASE + wheel * WHEEL_STRIDE;
      f[w + W.LOAD] = 1500;
      f[w + W.WATER] = 0.6;
      f[w + W.SURFACE] = SURFACE.ASPHALT;
    }
  }
  return f;
}
describe('27G reference events are actual read-only conditions, not route labels', () => {
  it('requires simultaneous physical traffic overlap, loaded wet patches and native states', () => {
    const f = snapshot(),
      before = f.slice();
    const observation = observeRace(f);
    expect(observation.events).toEqual(
      expect.arrayContaining(['motion', 'pack', 'battle', 'wet-traffic', 'wet-lap']),
    );
    expect(observation.nearbyCars).toBe(4);
    expect(observation.neighbour).toBe(1);
    expect(f).toEqual(before);
    for (let i = 1; i < 4; i++) f[carBase(i) + F.IN_PIT] = 1;
    expect(observeRace(f).events).not.toContain('pack');
    expect(observeRace(f).events).not.toContain('battle');
    expect(observeRace(f).events).not.toContain('wet-traffic');
    for (let i = 0; i < 4; i++) f[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
    expect(observeRace(f).events).not.toContain('wet-lap');
  });
  it('does not confuse a flyover, one moving car, or a parked rival with a battle', () => {
    const f = snapshot();
    f[carBase(1) + F.Y] = 10;
    expect(observeRace(f).events).not.toContain('battle');
    f[carBase(1) + F.Y] = 0.5;
    f[carBase(1) + F.SPEED] = 0;
    expect(observeRace(f).events).not.toContain('battle');
    f[carBase(1) + F.SPEED] = 28;
    f[carBase(1) + F.LATERAL] = 0;
    expect(observeRace(f).events).not.toContain('battle');
  });
  it('observes loaded corner, braking, gravel, service and actual countdown independently', () => {
    const f = snapshot(),
      b = carBase(0);
    f[b + F.G_LAT] = 0.9;
    f[b + F.G_LONG] = -0.7;
    f[b + F.BRAKE] = 0.8;
    f[b + WHEEL_BASE + W.SURFACE] = SURFACE.GRAVEL;
    expect(observeRace(f).events).toEqual(
      expect.arrayContaining(['loaded-corner', 'braking', 'gravel']),
    );
    f[b + F.IN_PIT] = 1;
    f[b + F.PIT_PHASE] = 3;
    f[b + F.SPEED] = 0;
    expect(observeRace(f).events).toEqual(['pit-service']);
    f[b + F.PIT_PHASE] = 0;
    f[b + F.IN_PIT] = 0;
    f[H.PHASE] = PHASE.LIGHTS;
    f[H.LIGHTS] = 5;
    expect(observeRace(f).events).toEqual(['start']);
    f[H.LIGHTS] = 0;
    expect(observeRace(f).events).not.toContain('start');
  });
  it('requires a continuous same-camera interval and keeps automation/replay/human limits', () => {
    const f = snapshot(),
      w = new ReferenceEventWatch();
    w.arm(93, 'a'.repeat(64), 'real-session');
    for (let i = 0; i <= 20; i++) {
      f[H.TIME] = i / 10;
      w.sample(f, 0, 'cockpit', 'real-session', false, i > 10);
    }
    expect(w.report()!.status).toBe('waiting');
    f[H.TIME] = 2.1;
    w.sample(f, 0, 'chase', 'real-session', false, false);
    expect(w.report()!.observedFor).toBe(0);
    for (let i = 22; i <= 53; i++) {
      f[H.TIME] = i / 10;
      w.sample(f, 0, 'cockpit', 'real-session', false, false);
    }
    const report = w.report()!;
    expect(report.status).toBe('observed');
    expect(report.automated).toBe(true);
    expect(report.humanAccepted).toBe(false);
    expect(report.visualAccepted).toBe(false);
    report.reason = 'tampered';
    expect(w.report()!.reason).not.toBe('tampered');
    w.arm(93, 'b'.repeat(64), 'second');
    w.sample(f, 0, 'cockpit', 'second', true, false);
    expect(w.report()!.status).toBe('interrupted');
  });
  it('resets on rewinds, long gaps and missed traffic rather than stitching evidence', () => {
    const f = snapshot(),
      w = new ReferenceEventWatch();
    w.arm(93, 'a'.repeat(64), 'test', true);
    for (const t of [0, 0.5, 1, 10, 10.5, 0.2, 0.7]) {
      f[H.TIME] = t;
      w.sample(f, 0, 'cockpit', 'test', true, false);
    }
    expect(w.report()!.observedFor).toBeCloseTo(0.5, 5);
    expect(w.active).toBe(true);
    w.interrupt('paused');
    expect(w.report()!.status).toBe('interrupted');
    w.clear();
    expect(w.report()).toBeNull();
    expect(() => w.arm(50, 'a'.repeat(64), 'test')).toThrow();
    expect(() => w.arm(93, 'wrong-source', 'test')).toThrow();
    expect(() => observeRace(new Float32Array(16))).toThrow();
    f[carBase(0) + F.SPEED] = NaN;
    expect(() => observeRace(f)).toThrow();
  });
  it('routes 093 to wet cockpit, 026 to assists, 070 to setup and does not invent network features', () => {
    expect(referenceEvent(93)).toMatchObject({ kind: 'wet-traffic', camera: 'cockpit' });
    expect(referenceRoute(REFERENCES[92])!.destination).toBe('event');
    expect(referenceRoute(REFERENCES[1])!.destination).toBe('photo');
    expect(referenceEvent(2)).toMatchObject({ kind: 'motion', camera: 'trackside' });
    expect(referenceRoute(REFERENCES[25])!.destination).toBe('settings');
    expect(referenceRoute(REFERENCES[69])!.destination).toBe('settings');
    expect(referenceRoute(REFERENCES[68])!.destination).toBe('gap');
    expect(referenceRoute(REFERENCES[32])!.photo!.backdrop).toBe('circuit');
    expect(referenceRoute(REFERENCES[99])!.photo!.focusSubject).toBe(1);
  });
});
it('a marshal never copies the player’s local yellow around the entire lap', () => {
  const f = snapshot(),
    b = carBase(0);
  f[b + F.LOCAL_FLAG] = FLAG.YELLOW;
  for (let i = 1; i < 4; i++) f[carBase(i) + F.S] = 1200 + i * 100;
  expect(postSignal(f, 100)).toBe(FLAG.YELLOW);
  expect(postSignal(f, 600)).toBe(FLAG.GREEN);
  f[b + F.IN_PIT] = 1;
  expect(postSignal(f, 100)).toBe(FLAG.GREEN);
  f[H.FLAG] = FLAG.CHEQUERED;
  expect(postSignal(f, 50)).toBe(FLAG.CHEQUERED);
  expect(postSignal(f, 600)).toBe(FLAG.GREEN);
});

it('rejects blank/transparent event PNG samples without confusing content with visual acceptance', () => {
  expect(() => referencePixelSample(new Uint8ClampedArray())).toThrow('Invalid');
  expect(() => referencePixelSample(new Uint8ClampedArray(8))).toThrow('transparent');
  expect(() => referencePixelSample(new Uint8ClampedArray([0, 0, 0, 255]))).toThrow('black');
  expect(() => referencePixelSample(new Uint8ClampedArray([255, 255, 255, 0]))).toThrow();
  expect(referencePixelSample(new Uint8ClampedArray([0, 0, 1, 255]))).toEqual({
    samples: 1,
    opaque: 1,
    nonblack: 1,
    visualAccepted: false,
  });
});
