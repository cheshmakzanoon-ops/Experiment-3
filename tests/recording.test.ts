import { describe, it, expect } from 'vitest';
import {
  H,
  F,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
  PROTOCOL_VERSION,
} from '../src/simulation/protocol.ts';
import {
  CHANNELS,
  TELEMETRY_STRIDE,
  packTelemetry,
  telemetryCsv,
} from '../src/storage/telemetry-schema.ts';
import { TelemetrySampler } from '../src/storage/telemetry-sampler.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import type { Simulation } from '../src/simulation/world.ts';

class MemoryPages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  closed = false;
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error('missing');
    return structuredClone(page);
  }
  async dispose() {
    this.closed = true;
    this.pages.clear();
  }
}
function pose(i: number) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.TIME] = 5 + i / 15;
  f[H.RACE_TIME] = i / 15;
  f[H.TICK] = i * 8;
  f[H.CARS] = 1;
  f[carBase(0) + F.X] = i;
  f[carBase(0) + F.QW] = 1;
  f[carBase(0) + F.MOTOR_POWER] = 12000 + i;
  return f;
}
describe('real-state telemetry', () => {
  it('has unique named fields and faithfully exports each wheel and hybrid power', async () => {
    expect(CHANNELS.length).toBe(228);
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
    const f = pose(0),
      out = new Float32Array(TELEMETRY_STRIDE);
    f[carBase(0) + F.MOTOR_POWER] = 120000;
    f[carBase(0) + F.REGEN_POWER] = 20000;
    for (let wheel = 0; wheel < 4; wheel++)
      f[carBase(0) + WHEEL_BASE + wheel * WHEEL_STRIDE + W.PRESSURE] = 151 + wheel;
    packTelemetry(f, out, 0);
    expect(out[CHANNELS.indexOf('motor_power_W')]).toBe(120000);
    expect(out[CHANNELS.indexOf('regen_power_W')]).toBe(20000);
    expect(out[CHANNELS.indexOf('RR_pressure_kPa')]).toBe(153);
    expect(out[CHANNELS.indexOf('FL_pressure_kPa')]).toBe(152);
    const text = await telemetryCsv(out, 1).text();
    expect(text.trim().split('\n')).toHaveLength(2);
    expect(text.split('\n')[1].split(',')).toHaveLength(228);
    out[5] = NaN;
    expect(() => telemetryCsv(out, 1)).toThrow('Non-finite');
    expect(() => telemetryCsv(out, 2)).toThrow('shape');
  });
  it.each([24, 30, 60, 90, 120, 144])(
    'captures exactly 60 Hz and 15 Hz with %i Hz display delivery',
    (fps) => {
      const frame = pose(0);
      const fake = {
        tick: 0,
        makeFrame: () => frame.slice(),
        writeFrame(out: Float32Array, ms: number, dropped: number) {
          out.set(frame);
          out[H.TICK] = this.tick;
          out[H.TIME] = this.tick / 120;
          out[H.STEP_MS] = ms;
          out[H.DROPPED] = dropped;
        },
      };
      const telemetry: number[] = [],
        replay: number[] = [],
        warnings: string[] = [];
      const sampler: TelemetrySampler = new TelemetrySampler(
        fake as unknown as Simulation,
        (buffer, rows) => {
          const values = new Float32Array(buffer);
          for (let i = 0; i < rows; i++)
            telemetry.push(values[i * TELEMETRY_STRIDE + CHANNELS.indexOf('tick')]);
          expect(values[CHANNELS.indexOf('physics_step_ms')]).toBeCloseTo(0.3);
          sampler.recycle(buffer);
        },
        (message) => warnings.push(message),
        (buffer, rows) => {
          const values = new Float32Array(buffer);
          for (let i = 0; i < rows; i++) replay.push(values[i * frame.length + H.TICK]);
          sampler.recycleReplay(buffer);
        },
      );
      let lastRender = 0;
      for (let i = 1; i <= 1200; i++) {
        fake.tick = i;
        sampler.capture(0.3, 0);
        if (i / 120 - lastRender >= 1 / fps) lastRender = i / 120;
        if (i % 60 === 0) sampler.flushReplay();
      }
      sampler.flush();
      sampler.flushReplay();
      expect(telemetry).toHaveLength(600);
      expect(replay).toHaveLength(150);
      expect(telemetry.every((t, i) => t === 2 * (i + 1))).toBe(true);
      expect(replay.every((t, i) => t === 8 * (i + 1))).toBe(true);
      expect(warnings).toEqual([]);
    },
  );
  it('bounds stalled consumer memory and reports gaps instead of inventing samples', () => {
    const f = pose(0),
      warnings: string[] = [];
    const fake = {
      tick: 0,
      makeFrame: () => f.slice(),
      writeFrame(out: Float32Array) {
        out.set(f);
      },
    };
    let delivered = 0;
    const sampler = new TelemetrySampler(
      fake as unknown as Simulation,
      () => delivered++,
      (m) => warnings.push(m),
    );
    for (let i = 1; i <= 2400; i++) {
      fake.tick = i;
      sampler.capture();
    }
    expect(delivered).toBe(6);
    expect(warnings.some((s) => s.startsWith('Telemetry capture gap'))).toBe(true);
    expect(warnings.some((s) => s.startsWith('Replay capture gap'))).toBe(true);
    expect(warnings).toHaveLength(2);
  });
  it('keeps batched samples chronological through ring wrap', () => {
    const recorder = new TelemetryRecorder(1);
    const batch = new Float32Array(TELEMETRY_STRIDE * 40);
    for (let i = 0; i < 40; i++) packTelemetry(pose(i), batch, i * TELEMETRY_STRIDE);
    recorder.appendBatch(batch, 40);
    for (let i = 0; i < 40; i++) packTelemetry(pose(i + 40), batch, i * TELEMETRY_STRIDE);
    recorder.appendBatch(batch, 40);
    expect(recorder.count).toBe(60);
    const snapshot = recorder.snapshot();
    expect(snapshot[0]).toBeCloseTo(20 / 15);
    expect(snapshot[(recorder.count - 1) * TELEMETRY_STRIDE]).toBeCloseTo(79 / 15);
  });
});
describe('paged full-session replay', () => {
  it('seeks across evicted pages and retains the original spatial weather state', async () => {
    const store = new MemoryPages(),
      replay = new SessionReplay(1, store, undefined, 4);
    replay.recordSurface(new Float32Array([0.1, 1.25]), new Float32Array([0.3, 0.5]), 0);
    for (let i = 0; i < 120; i++) {
      replay.append(pose(i));
      if (i === 40)
        replay.recordSurface(
          new Float32Array([2, 0.5]),
          new Float32Array([0.7, 0.8]),
          pose(i)[H.TIME],
        );
      if (i % 4 === 3) await replay.settle();
    }
    await replay.settle();
    expect(replay.count).toBe(120);
    expect(replay.bytes).toBeLessThan(6 * replay.stride * 4 * 4 + 1000);
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(1.5 / 15, a, b)).toBeNull();
    await replay.settle();
    expect(replay.sample(1.5 / 15, a, b)).toBeCloseTo(0.5, 3);
    expect(a[carBase(0) + F.X]).toBe(1);
    expect(b[carBase(0) + F.MOTOR_POWER]).toBe(12002);
    expect(replay.surfaceState.water[0]).toBeCloseTo(0.1, 3);
    const time = 3.5 / 15;
    for (let j = 0; j < 3 && replay.sample(time, a, b) === null; j++) await replay.settle();
    expect(replay.sample(time, a, b)).toBeCloseTo(0.5, 3);
    expect(a[carBase(0) + F.X]).toBe(3);
    expect(b[carBase(0) + F.X]).toBe(4);
    for (let j = 0; j < 3 && replay.sample(80 / 15, a, b) === null; j++) await replay.settle();
    expect(replay.surfaceState.water[0]).toBe(2);
    await replay.dispose();
    expect(store.closed).toBe(true);
  });
  it('retains more than the old twenty-minute recording limit without resident growth', async () => {
    const store = new MemoryPages(),
      replay = new SessionReplay(1, store, undefined, 300);
    for (let i = 0; i <= 19000; i++) {
      replay.append(pose(i));
      if (i % 300 === 299) await replay.settle();
    }
    await replay.settle();
    expect(replay.duration).toBeGreaterThan(1200);
    expect(replay.start).toBe(5);
    expect(replay.count).toBe(19001);
    expect(replay.bytes).toBeLessThanOrEqual(5 * 300 * replay.stride * 4);
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    replay.sample(0, a, b);
    await replay.settle();
    expect(replay.sample(0, a, b)).toBe(0);
    expect(a[carBase(0) + F.X]).toBe(0);
    await replay.dispose();
  });
  it('surfaces storage failure and preserves already captured memory', async () => {
    const warnings: string[] = [],
      store = new MemoryPages();
    store.put = async () => {
      throw new Error('Quota exceeded');
    };
    const replay = new SessionReplay(1, store, (m) => warnings.push(m), 4);
    for (let i = 0; i < 5; i++) replay.append(pose(i));
    await replay.settle();
    expect(replay.error).toContain('Quota exceeded');
    replay.append(pose(6));
    expect(replay.count).toBe(5);
    expect(warnings).toHaveLength(1);
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(0, a, b)).toBe(0);
    await replay.dispose();
  });
  it('rejects malformed disk pages and does not complete a stale seek after disposal', async () => {
    const store = new MemoryPages(),
      replay = new SessionReplay(1, store, undefined, 2);
    for (let i = 0; i < 20; i++) {
      replay.append(pose(i));
      await replay.settle();
    }
    const old = store.pages.get(0)!;
    old.version = PROTOCOL_VERSION + 1;
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    replay.sample(0, a, b);
    await replay.settle();
    expect(replay.error).toContain('Incompatible');
    expect(a.every((value) => value === 0)).toBe(true);
    await replay.dispose();
  });
});

it('keeps powertrain energy, damage and fragment poses connected to serialized state', async () => {
  const { Simulation } = await import('../src/simulation/world.ts');
  const { DEFAULT_OPTIONS } = await import('../src/simulation/config.ts');
  const { DEBRIS_BASE, D } = await import('../src/simulation/protocol.ts');
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
  sim.cars[0].input.throttle = 1;
  sim.cars[0].input.ers = 2;
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  const before = sim.makeFrame(),
    base = carBase(0);
  expect(before[base + F.MOTOR_POWER]).toBeGreaterThan(0);
  expect(before[base + F.MOTOR_POWER]).toBeCloseTo(sim.cars[0].motorPower, 2);
  sim.cars[0].damage(200000, true);
  const after = sim.makeFrame();
  expect(after[base + F.LOST_MASS]).toBe(4.5);
  expect(after[base + DEBRIS_BASE + D.ACTIVE]).toBe(1);
  expect(after[base + DEBRIS_BASE + D.Z]).toBeCloseTo(sim.cars[0].debris.pieces[0].position.z, 3);
  sim.cars[0].repairFrontWing(10);
  expect(sim.cars[0].lostMass).toBe(0);
  sim.cars[0].damage(200000, true);
  expect(sim.cars[0].lostMass).toBe(4.5);
  expect(sim.cars[0].debris.pieces.filter((piece) => piece.active)).toHaveLength(2);
});

describe('replay integrity and seek ownership', () => {
  async function archived() {
    const store = new MemoryPages();
    const replay = new SessionReplay(1, store, undefined, 2);
    replay.recordSurface(new Float32Array([0.2]), new Float32Array([0.4]), 0);
    for (let i = 0; i < 20; i++) {
      replay.append(pose(i));
      await replay.settle();
    }
    return { store, replay };
  }
  it.each([
    'finite coordinate',
    'finite surface',
    'surface timestamp',
    'surface omission',
    'surface dimensions',
    'first timestamp',
    'last timestamp',
    'car count',
    'array type',
  ])('rejects changed %s in an evicted page before exposing any output', async (fault) => {
    const { store, replay } = await archived();
    const page = store.pages.get(0)!;
    if (fault === 'finite coordinate') page.frames[carBase(0) + F.X] += 1;
    if (fault === 'finite surface') page.surfaces[0].data[0] += 1;
    if (fault === 'surface timestamp') page.surfaces[0].time += 1;
    if (fault === 'surface omission') page.surfaces = [];
    if (fault === 'surface dimensions') page.surfaces[0].data = new Uint16Array(6);
    if (fault === 'first timestamp') page.frames[H.TIME] += 0.01;
    if (fault === 'last timestamp') page.frames[page.stride + H.TIME] += 0.01;
    if (fault === 'car count') page.frames[H.CARS] = 2;
    if (fault === 'array type')
      page.frames = new Float64Array(page.frames) as unknown as Float32Array;
    const a = replay.makeFrame().fill(-7),
      b = replay.makeFrame().fill(-9);
    expect(replay.sample(0, a, b)).toBeNull();
    await replay.settle();
    expect(replay.error).toContain('Incompatible replay page');
    expect(replay.sample(0, a, b)).toBeNull();
    expect(a.every((value) => value === -7)).toBe(true);
    expect(b.every((value) => value === -9)).toBe(true);
    await replay.dispose();
  });
  it('retains the previous surface when weather delivery leads a pose batch at a page seam', async () => {
    const r = new SessionReplay(1, new MemoryPages(), undefined, 2);
    r.recordSurface(new Float32Array([0.1]), new Float32Array([0.2]), 0);
    r.append(pose(0));
    r.append(pose(1));
    r.recordSurface(new Float32Array([2]), new Float32Array([0.8]), 5.3);
    r.append(pose(2));
    r.append(pose(3));
    await r.settle();
    const a = r.makeFrame(),
      b = r.makeFrame();
    expect(r.sample(2.5 / 15, a, b)).toBeCloseTo(0.5, 3);
    expect(r.surfaceState.water[0]).toBeCloseTo(0.1, 3);
    r.append(pose(4));
    r.append(pose(5));
    await r.settle();
    r.sample(4.8 / 15, a, b);
    expect(r.surfaceState.water[0]).toBe(2);
    r.sample(2.5 / 15, a, b);
    expect(r.surfaceState.water[0]).toBeCloseTo(0.1, 3);
    await r.dispose();
  });
  it('selects a surface recorded on the next page inside the interpolation seam', async () => {
    const r = new SessionReplay(1, new MemoryPages(), undefined, 2);
    r.recordSurface(new Float32Array([0.1]), new Float32Array([0.2]), 0);
    for (let i = 0; i < 3; i++) r.append(pose(i));
    r.recordSurface(new Float32Array([1.5]), new Float32Array([0.6]), 5.1);
    await r.settle();
    const a = r.makeFrame(),
      b = r.makeFrame();
    expect(r.sample(0.11, a, b)).toBeCloseTo(0.65, 3);
    expect(r.surfaceState.water[0]).toBe(1.5);
    r.sample(0.09, a, b);
    expect(r.surfaceState.water[0]).toBeCloseTo(0.1, 3);
    await r.dispose();
  });
  it('clears a later decoded surface when rewinding before the first recorded surface', async () => {
    const r = new SessionReplay(1, new MemoryPages());
    for (let i = 0; i < 5; i++) r.append(pose(i));
    r.recordSurface(new Float32Array([1]), new Float32Array([0.5]), 5.1);
    const a = r.makeFrame(),
      b = r.makeFrame();
    r.sample(0.2, a, b);
    expect(r.surfaceState.water[0]).toBe(1);
    r.sample(0, a, b);
    expect(r.surfaceState.time).toBe(-1);
    expect(r.surfaceState.water).toHaveLength(0);
    expect(r.surfaceState.rubber).toHaveLength(0);
    expect(r.surfaceState.marbles).toHaveLength(0);
    await r.dispose();
  });
  it.each([
    'shape',
    'negative time',
    'backward time',
    'car count',
    'zero quaternion',
    'non-unit quaternion',
  ])('stops invalid %s capture explicitly', async (fault) => {
    const r = new SessionReplay(1, new MemoryPages());
    r.append(pose(1));
    const f = pose(2);
    if (fault === 'shape') f[H.TIME] = NaN;
    if (fault === 'negative time') f[H.TIME] = -1;
    if (fault === 'backward time') f[H.TIME] = 5;
    if (fault === 'car count') f[H.CARS] = 2;
    if (fault === 'zero quaternion') f[carBase(0) + F.QW] = 0;
    if (fault === 'non-unit quaternion') f[carBase(0) + F.QW] = 2;
    r.append(f);
    expect(r.error).toContain('Invalid replay snapshot');
    expect(r.count).toBe(1);
    await r.dispose();
  });
  it('rejects surface dimensions changing within a session', async () => {
    const r = new SessionReplay(1, new MemoryPages());
    r.recordSurface(new Float32Array([0]), new Float32Array([0]), 0);
    r.recordSurface(new Float32Array([0, 0]), new Float32Array([0, 0]), 1);
    expect(r.error).toContain('Invalid replay surface');
    await r.dispose();
  });
  it('never lets an older disk seek overwrite a newer displayed seek', async () => {
    const { store, replay } = await archived();
    const releases = new Map<number, (page: ReplayPage) => void>();
    store.get = (id) => new Promise((resolve) => releases.set(id, resolve));
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(0, a, b)).toBeNull();
    expect(replay.sample(pose(4)[H.TIME] - replay.start, a, b)).toBeNull();
    releases.get(2)!(structuredClone(store.pages.get(2)!));
    // Let only the newer read complete; the old seek is still outstanding.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replay.sample(pose(4)[H.TIME] - replay.start, a, b)).not.toBeNull();
    const shownA = a.slice(),
      shownB = b.slice();
    releases.get(0)!(structuredClone(store.pages.get(0)!));
    await replay.settle();
    expect(a).toEqual(shownA);
    expect(b).toEqual(shownB);
    expect(replay.sample(pose(4)[H.TIME] - replay.start, a, b)).not.toBeNull();
    expect(a).toEqual(shownA);
    await replay.dispose();
  });
  it('disposes during a pending disk read without resurrecting a frame or cache', async () => {
    const { store, replay } = await archived();
    let release!: (page: ReplayPage) => void;
    store.get = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const a = replay.makeFrame().fill(-3),
      b = replay.makeFrame().fill(-4);
    replay.sample(0, a, b);
    const disposing = replay.dispose();
    release(structuredClone(store.pages.get(0)!));
    await disposing;
    expect(replay.sample(0, a, b)).toBeNull();
    expect(a.every((value) => value === -3)).toBe(true);
    expect(b.every((value) => value === -4)).toBe(true);
    expect(store.closed).toBe(true);
    expect(replay.error).toBeNull();
  });
});
