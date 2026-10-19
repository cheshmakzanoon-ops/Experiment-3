import { describe, expect, it } from 'vitest';
import { LiveFrameClock, type LiveFrameSample } from '../src/rendering/live-frame-clock.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';

const SPEED = 12;

function snapshot(time: number, vehicles: readonly number[] = [0]) {
  const frame = new Float32Array(HEADER + vehicles.length * CAR_STRIDE);
  frame[H.TIME] = time;
  frame[H.TICK] = Math.round(time * 120);
  frame[H.CARS] = vehicles.length;
  for (let id = 0; id < vehicles.length; id++) {
    const o = carBase(id);
    frame[o + F.X] = SPEED * time + id * 5;
    frame[o + F.QW] = 1;
    frame[o + RACE_BASE + R.VEHICLE] = vehicles[id];
  }
  return frame;
}

function sample(clock: LiveFrameClock, wallMs: number): LiveFrameSample {
  const value = clock.sample(wallMs);
  if (!value) throw new Error('Expected a retained live frame');
  return value;
}

function position(value: LiveFrameSample, id = 0) {
  const x = carBase(id) + F.X;
  return value.a[x] + (value.b[x] - value.a[x]) * value.alpha;
}

describe('live presentation clock', () => {
  it.each([24, 30, 60, 90, 120, 144])(
    'keeps constant-speed motion through alternating 2/3-tick deliveries at %i Hz',
    (fps) => {
      const clock = new LiveFrameClock();
      clock.observe(snapshot(0), 0);
      clock.setPaused(false);
      const deliveries: { wall: number; frame: Float32Array }[] = [];
      const jitter = [0, 1.8, 0.6, 2.4, 0.2, 1.1];
      let tick = 0;
      for (let packet = 0; tick < 370; packet++) {
        tick += packet % 2 === 0 ? 2 : 3;
        const time = tick / 120;
        deliveries.push({
          wall: time * 1000 + jitter[packet % jitter.length],
          frame: snapshot(time),
        });
      }
      let delivered = 0,
        previous = 0;
      for (let rendered = 0; rendered <= fps * 3; rendered++) {
        const wall = (rendered * 1000) / fps;
        while (delivered < deliveries.length && deliveries[delivered].wall <= wall + 1e-9) {
          const next = deliveries[delivered++];
          clock.observe(next.frame, next.wall);
        }
        const value = sample(clock, wall),
          x = position(value);
        expect(x).toBeGreaterThanOrEqual(previous);
        expect(value.alpha).toBeGreaterThanOrEqual(0);
        expect(value.alpha).toBeLessThanOrEqual(1);
        if (wall >= 100) {
          expect(x).toBeCloseTo((wall / 1000 - LiveFrameClock.DELAY) * SPEED, 4);
          expect(x - previous).toBeCloseTo(SPEED / fps, 4);
        }
        previous = x;
      }
    },
  );

  it('holds the latest measured pose during starvation and resumes without rollback', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    for (const time of [0, 0.025, 0.05, 0.075, 0.1]) clock.observe(snapshot(time), time * 1000);
    expect(position(sample(clock, 100))).toBeCloseTo((0.1 - LiveFrameClock.DELAY) * SPEED, 5);
    const held = position(sample(clock, 10000));
    expect(held).toBeCloseTo(0.1 * SPEED, 5);
    expect(position(sample(clock, 10010))).toBe(held);

    clock.observe(snapshot(0.125), 10020);
    expect(position(sample(clock, 10020))).toBe(held);
    clock.observe(snapshot(0.15), 10045);
    const resumed = sample(clock, 10045);
    expect(position(resumed)).toBeGreaterThan(held);
    expect(position(resumed)).toBeCloseTo((0.15 - LiveFrameClock.DELAY) * SPEED, 5);
    expect(position(resumed)).toBeLessThanOrEqual(resumed.b[carBase(0) + F.X]);
  });

  it('bounds history and visible latency when a stalled display receives a transport backlog', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    clock.observe(snapshot(0), 0);
    sample(clock, 0);
    for (let tick = 1; tick <= 240; tick++) clock.observe(snapshot(tick / 120), 2000);
    const value = sample(clock, 2000),
      shownTime = position(value) / SPEED;
    expect(clock.bufferedFrames).toBe(LiveFrameClock.CAPACITY);
    expect(shownTime).toBeGreaterThanOrEqual(2 - LiveFrameClock.MAX_LATENCY);
    expect(shownTime).toBeLessThanOrEqual(2);
    expect(position(sample(clock, 100000))).toBe(2 * SPEED);
  });

  it('never rewinds when a RAF timestamp predates a message or the preceding draw', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    for (const time of [0, 0.025, 0.05, 0.075, 0.1]) clock.observe(snapshot(time), time * 1000);
    const shown = position(sample(clock, 90));
    clock.observe(snapshot(0.125), 125);
    expect(position(sample(clock, 85))).toBe(shown);
    expect(position(sample(clock, 100))).toBeGreaterThan(shown);
  });

  it('owns copies of frame and traffic data after the original worker buffers are recycled', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    const frames = [snapshot(0), snapshot(0.025), snapshot(0.05)];
    const traffic = [
      new Float32Array([0, 10]),
      new Float32Array([1, 11]),
      new Float32Array([2, 12]),
    ];
    for (let i = 0; i < frames.length; i++) {
      clock.observe(frames[i], i * 25, traffic[i]);
      frames[i].fill(999);
      traffic[i].fill(999);
    }
    structuredClone([frames[0].buffer, traffic[0].buffer], {
      transfer: [frames[0].buffer, traffic[0].buffer],
    });
    expect(frames[0].byteLength).toBe(0);
    const value = sample(clock, (0.0125 + LiveFrameClock.DELAY) * 1000);
    expect(value.a[H.TIME]).toBe(0);
    expect(value.b[H.TIME]).toBeCloseTo(0.025, 6);
    expect(position(value)).toBeCloseTo(0.0125 * SPEED, 6);
    expect([...value.auxiliaryA!]).toEqual([0, 10]);
    expect([...value.auxiliaryB!]).toEqual([1, 11]);
    expect(value.a.buffer).not.toBe(frames[1].buffer);
    expect(value.b.buffer).not.toBe(frames[1].buffer);
  });

  it('pairs traffic with the selected history and handles absent or resized traffic blocks', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    clock.observe(snapshot(0), 0, new Float32Array([7]));
    clock.observe(snapshot(0.025), 25, new Float32Array([8, 9]));
    clock.observe(snapshot(0.05), 50);
    const between = sample(clock, (0.0125 + LiveFrameClock.DELAY) * 1000);
    expect([...between.auxiliaryA!]).toEqual([7]);
    expect([...between.auxiliaryB!]).toEqual([8, 9]);
    const held = sample(clock, 1000);
    expect(held.a).toBe(held.b);
    expect(held.auxiliaryA).toBeNull();
    expect(held.auxiliaryB).toBeNull();
  });

  it('reuses a bounded set of copied buffers across ordinary driving', () => {
    const clock = new LiveFrameClock(),
      storage = new Set<ArrayBufferLike>();
    clock.setPaused(false);
    for (let tick = 0; tick < 100; tick++) {
      clock.observe(snapshot(tick / 120), (tick * 1000) / 120);
      storage.add(sample(clock, (tick / 120 + LiveFrameClock.DELAY) * 1000).b.buffer);
    }
    expect(storage.size).toBe(LiveFrameClock.CAPACITY);
    expect(clock.bufferedFrames).toBe(LiveFrameClock.CAPACITY);
    clock.reset();
    expect(clock.sample(0)).toBeNull();
    clock.observe(snapshot(0), 0);
    expect(storage.has(sample(clock, 1000).b.buffer)).toBe(true);
  });

  it('shows exact paused barriers and excludes ninety seconds of paused wall time on resume', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    for (const time of [0, 0.025, 0.05]) clock.observe(snapshot(time), time * 1000);
    sample(clock, 50);
    clock.setPaused(true);
    const paused = sample(clock, 50);
    expect(paused.a).toBe(paused.b);
    expect(paused.alpha).toBe(1);
    expect(position(paused)).toBeCloseTo(0.05 * SPEED, 6);
    const barrier = snapshot(0.05);
    barrier[carBase(0) + F.GEAR] = 2;
    clock.observe(barrier, 60);
    expect(sample(clock, 90000).b[carBase(0) + F.GEAR]).toBe(2);
    clock.setPaused(false);
    expect(position(sample(clock, 90000))).toBeCloseTo(0.05 * SPEED, 6);
    clock.observe(snapshot(0.05 + 2 / 120), 90000 + 2000 / 120);
    clock.observe(snapshot(0.05 + 5 / 120), 90000 + 5000 / 120);
    expect(position(sample(clock, 90000 + 5000 / 120))).toBeCloseTo(
      (0.05 + 5 / 120 - LiveFrameClock.DELAY) * SPEED,
      5,
    );
  });

  it('treats rewinds and equal-time commands as authoritative history barriers', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    clock.observe(snapshot(1), 1000);
    clock.observe(snapshot(1.025), 1025);
    sample(clock, 1050);
    clock.observe(snapshot(0.5), 1100);
    let value = sample(clock, 1100);
    expect(value.a).toBe(value.b);
    expect(position(value)).toBe(0.5 * SPEED);
    const replacement = snapshot(0.5);
    replacement[carBase(0) + F.X] = 99;
    clock.observe(replacement, 1110);
    value = sample(clock, 1110);
    expect(value.a).toBe(value.b);
    expect(position(value)).toBe(99);
    expect(clock.bufferedFrames).toBe(1);
  });

  it('cuts to changed vehicle identities anywhere in the field and changed field sizes', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    clock.observe(snapshot(0, [1, 2]), 0);
    clock.observe(snapshot(0.025, [1, 2]), 25);
    clock.observe(snapshot(0.05, [1, 3]), 50);
    let value = sample(clock, 50);
    expect(value.a).toBe(value.b);
    expect(value.b[carBase(1) + RACE_BASE + R.VEHICLE]).toBe(3);
    expect(clock.bufferedFrames).toBe(1);
    clock.observe(snapshot(0.075, [1]), 75);
    value = sample(clock, 75);
    expect(value.a).toBe(value.b);
    expect(value.b[H.CARS]).toBe(1);
    expect(value.b.length).toBe(HEADER + CAR_STRIDE);
  });

  it('reset starts paused with no previous session timeline', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    clock.observe(snapshot(10), 10000);
    clock.observe(snapshot(10.025), 10025);
    sample(clock, 10050);
    clock.reset();
    expect(clock.sample(20000)).toBeNull();
    clock.observe(snapshot(0), 20000);
    clock.observe(snapshot(0.025), 20025);
    const value = sample(clock, 100000);
    expect(value.a).toBe(value.b);
    expect(value.alpha).toBe(1);
    expect(position(value)).toBeCloseTo(0.025 * SPEED, 6);
    expect(clock.bufferedFrames).toBe(1);
  });

  it('rejects invalid clocks and malformed snapshot headers before retaining data', () => {
    const clock = new LiveFrameClock();
    const missingCar = snapshot(0);
    missingCar[H.CARS] = 0;
    const fractionalCars = snapshot(0);
    fractionalCars[H.CARS] = 1.5;
    const malformed = [
      snapshot(NaN),
      snapshot(Infinity),
      snapshot(
        0,
        Array.from({ length: 33 }, () => 0),
      ),
      missingCar,
      fractionalCars,
      snapshot(0).slice(0, -1),
    ];
    for (const frame of malformed)
      expect(() => clock.observe(frame, 0)).toThrow('Invalid live presentation snapshot');
    for (const wall of [NaN, Infinity, -1]) {
      expect(() => clock.observe(snapshot(0), wall)).toThrow('Invalid live presentation snapshot');
      expect(() => clock.sample(wall)).toThrow('Invalid live presentation clock');
    }
    expect(clock.sample(0)).toBeNull();
  });
});
