import { ReplayRecorder } from '../src/storage/recorders.ts';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import * as T from 'three';
import { Vec3 } from '../src/core/math.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { CAR_STRIDE, F, H, HEADER, K, SKID_BASE, carBase } from '../src/simulation/protocol.ts';
import { CHANNELS, packTelemetry, telemetryCsv } from '../src/storage/telemetry-schema.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';

const o = carBase(0),
  k = o + SKID_BASE;
// Explicit recorded-state fixtures isolate temporal presentation; the first test
// independently verifies those channels against a real production floor strike.
function snapshot(time: number, work = time * 4300) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.CARS] = 1;
  f[H.TIME] = time;
  f[o + F.QW] = 1;
  f[k + K.SPARK_WORK] = work;
  f[k + K.SLIDE_WORK] = work;
  f[k + K.TOTAL_WORK] = work;
  f[k + K.SPARK_X] = 200;
  f[k + K.SPARK_Y] = 3;
  f[k + K.SPARK_Z] = 50 + time * 20;
  f[k + K.NORMAL_Y] = 1;
  f[k + K.VELOCITY_Z] = 20;
  return f;
}
function dispose(effects: Effects) {
  effects.group.traverse((object) => {
    if (object instanceof T.Points) {
      object.geometry.dispose();
      (object.material as T.Material).dispose();
    }
  });
}
class Pages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(p: ReplayPage) {
    this.pages.set(p.id, structuredClone(p));
  }
  async get(id: number) {
    return structuredClone(this.pages.get(id)!);
  }
  async dispose() {
    this.pages.clear();
  }
}
it('records a real chassis strike and exports every skid measurement without moving old CSV fields', async () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const car = sim.cars[0];
  car.body.position.y -= 0.17; // Declared low-floor initial condition, no mid-run override.
  car.body.orientation.rotate(new Vec3(0, 0, 30), car.body.velocity);
  sim.step(1 / 120);
  const frame = sim.makeFrame(),
    copy = frame.slice(),
    skid = car.skid;
  expect(skid.sparkWorkJ).toBeGreaterThan(0);
  expect(car.floorHealth).toBeLessThan(1);
  const actual = [
    skid.contacts,
    skid.normalLoad,
    skid.slidingPower,
    skid.dampingPower,
    skid.sparkPower,
    skid.point.x,
    skid.point.y,
    skid.point.z,
    skid.normal.x,
    skid.normal.y,
    skid.normal.z,
    skid.velocity.x,
    skid.velocity.y,
    skid.velocity.z,
    skid.slidingWorkJ,
    skid.sparkWorkJ,
    skid.totalWorkJ,
  ];
  expect(Array.from(frame.slice(k, k + 17))).toEqual(actual.map(Math.fround));
  expect(new Set(CHANNELS).size).toBe(228);
  expect(createHash('sha256').update(CHANNELS.slice(0, 211).join(',')).digest('hex')).toBe(
    '3d0fa8ee4003197268344b84889f8fcc85849b5c5d027b830aec8440ffae1f89',
  );
  const values = new Float32Array(CHANNELS.length);
  packTelemetry(frame, values, 0);
  expect(Array.from(values.slice(211))).toEqual(actual.map(Math.fround));
  const csv = (await telemetryCsv(values, 1).text()).trim().split('\n');
  expect(csv[0].split(',').slice(211)).toEqual(CHANNELS.slice(211));
  expect(csv[1].split(',').slice(211).map(Number)).toEqual(actual.map(Math.fround));
  expect(frame).toEqual(copy);
});
it('preserves contact work and actual anchors across evicted replay pages and backward seeks', async () => {
  const store = new Pages(),
    replay = new SessionReplay(1, store, undefined, 4);
  for (let i = 0; i < 48; i++) {
    replay.append(snapshot(i / 15));
    if (i % 4 === 3) await replay.settle();
  }
  const a = replay.makeFrame(),
    b = replay.makeFrame();
  try {
    for (const index of [1, 27, 3, 40, 0]) {
      const time = (index + 0.5) / 15;
      for (let attempt = 0; attempt < 4 && replay.sample(time, a, b) === null; attempt++)
        await replay.settle();
      const alpha = replay.sample(time, a, b);
      expect(alpha).not.toBeNull();
      expect(a.slice(k, k + 17)).toEqual(snapshot(index / 15).slice(k, k + 17));
      expect(b.slice(k, k + 17)).toEqual(snapshot((index + 1) / 15).slice(k, k + 17));
      const shown = new PresentedFrame().sample(a, b, alpha!);
      expect(shown[k + K.SPARK_WORK]).toBeCloseTo(time * 4300, 2);
      expect(shown[k + K.SPARK_X]).toBe(200);
    }
  } finally {
    await replay.dispose();
  }
});
it('never blends the first spark anchor from the world origin or decreases accumulated work mid-frame', () => {
  const a = snapshot(0),
    b = snapshot(1);
  a.fill(0, k, k + 17);
  const copies = [a.slice(), b.slice()],
    shown = new PresentedFrame();
  expect(shown.sample(a, b, 0.5)[k + K.SPARK_X]).toBe(200);
  expect(shown.value[k + K.SPARK_WORK]).toBe(2150);
  expect(shown.value[k + K.NORMAL_Y]).toBe(1);
  const reset = snapshot(2, 0);
  expect(shown.sample(b, reset, 0.5)[k + K.SPARK_WORK]).toBe(4300);
  expect(shown.sample(b, reset, 1)[k + K.SPARK_WORK]).toBe(0);
  expect(a).toEqual(copies[0]);
  expect(b).toEqual(copies[1]);
});
it.each([0.5, 5, 24, 30, 60, 90, 120, 144])(
  'integrates recorded spark work at %s display Hz without render-dependent births',
  (hz) => {
    const effects = new Effects(),
      playback = new EffectPlayback(effects);
    try {
      const duration = 2;
      for (let i = 0; i <= duration * hz; i++) playback.update(snapshot(i / hz));
      expect(playback.elapsed).toBeCloseTo(duration, 6);
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(100);
    } finally {
      dispose(effects);
    }
  },
);
it('short inter-snapshot strikes use the recorded contact, not a current airborne chassis or a vertical impact flag', () => {
  const effects = new Effects();
  try {
    effects.update(snapshot(0, 0), 0, false);
    const f = snapshot(0.1, 430);
    f[o + F.X] = -500;
    f[o + F.Y] = 50;
    f[k + K.CONTACTS] = 0; // Strike completed before this recorded frame.
    effects.update(f, 0.1);
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(5);
    const position = (effects.group.children[0] as T.Points).geometry.getAttribute('position');
    for (let i = 0; i < 5; i++) {
      expect(position.getX(i)).toBeCloseTo(200, 0);
      expect(position.getY(i)).toBeGreaterThan(3);
      expect(position.getZ(i)).toBeGreaterThan(52);
    }
    const next = snapshot(0.2, 430);
    next[o + F.BOTTOM_ENERGY] = 1e6; // Normal damping alone cannot manufacture sparks.
    effects.update(next, 0.1);
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(5);
  } finally {
    dispose(effects);
  }
});
it('pauses, disabled effects, explicit seeks and rewinds do not generate catch-up spark bursts', () => {
  const effects = new Effects(),
    playback = new EffectPlayback(effects);
  try {
    playback.update(snapshot(0));
    playback.update(snapshot(0.2));
    const before = effects.diagnostics().spawned;
    for (let i = 0; i < 100; i++) playback.update(snapshot(0.2));
    expect(effects.diagnostics().spawned).toEqual(before);
    effects.enabled = false;
    playback.update(snapshot(1));
    effects.enabled = true;
    playback.update(snapshot(1.1));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(
      before[PARTICLE_KIND.SPARK] + 5,
    );
    playback.reset();
    playback.update(snapshot(10));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(0);
    playback.update(snapshot(3));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(0);
    playback.update(snapshot(3.1));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SPARK]).toBe(5);
  } finally {
    dispose(effects);
  }
});

it('the diagnostic replay recorder also preserves all floor-contact channels at native capture times', () => {
  const recorder = new ReplayRecorder(1, 2);
  const frames = Array.from({ length: 12 }, (_, i) => snapshot(i / 15));
  frames.forEach((f) => recorder.append(f));
  const a = recorder.makeFrame(),
    b = recorder.makeFrame(),
    presented = new PresentedFrame();
  for (const frame of frames) {
    const alpha = recorder.sample(frame[H.TIME], a, b);
    const value = presented.sample(a, b, alpha);
    expect(value.slice(k, k + 17)).toEqual(frame.slice(k, k + 17));
  }
});
