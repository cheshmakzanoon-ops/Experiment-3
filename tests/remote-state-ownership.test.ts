import { describe, expect, it } from 'vitest';
import { RemoteCarTrack } from '../src/net/interpolation.ts';
import { emptyCarState, type CarNetState } from '../src/net/snapshot.ts';

const fields = Object.keys(emptyCarState()) as (keyof CarNetState)[];

function state(tick: number): CarNetState {
  return {
    ...emptyCarState(3),
    flags: 65,
    x: tick / 10,
    y: tick / 24,
    z: -tick / 8,
    vx: 12,
    vy: 5,
    vz: -15,
    wx: 0.1,
    wy: -0.2,
    wz: 0.3,
    ax: -0.4,
    ay: 0.5,
    az: -0.6,
    steer: -0.7,
    throttle: 0.8,
    brake: 0.9,
    gear: 4,
    rpm: 9600,
    s: tick / 4,
    laps: 2,
    rank: 7,
  };
}

function filled(ticks = [0, 6]) {
  const track = new RemoteCarTrack();
  for (const tick of ticks) track.push(tick, state(tick));
  return track;
}

describe('remote snapshot ownership', () => {
  it('keeps the existing empty-history results', () => {
    const track = new RemoteCarTrack();
    expect(track.newest).toBe(-1);
    expect(track.latest()).toBeUndefined();
    expect(track.sample(0)).toBeNull();
  });

  it('owns both interpolation endpoints and later extrapolation inputs', () => {
    const track = new RemoteCarTrack();
    const first = state(0),
      second = state(6);
    track.push(0, first);
    track.push(6, second);
    const times = [0, 1.5, 3, 5.75, 6, 9, 21, 22];
    const expected = times.map((time) => track.sample(time));
    expect(track.sample(3)?.pose.x).toBe(0.3);
    for (const field of fields) {
      first[field] = 100;
      second[field] = -200;
    }
    expect(times.map((time) => track.sample(time))).toEqual(expected);
    expect(track.latest()).toEqual(state(6));
  });

  it('supports reusing one decoder object across successive snapshots', () => {
    const track = new RemoteCarTrack(),
      reference = filled([0, 6, 12, 18]);
    const reused = emptyCarState();
    for (const tick of [0, 6, 12, 18]) {
      Object.assign(reused, state(tick));
      expect(track.push(tick, reused)).toBe(true);
    }
    Object.assign(reused, state(900));
    for (let tick = 0; tick <= 36; tick += 0.25)
      expect(track.sample(tick)).toEqual(reference.sample(tick));
    expect(track.latest()).toEqual(state(18));
  });

  it('returns detached complete HUD states on every latest call', () => {
    const track = filled();
    const first = track.latest()!,
      second = track.latest()!;
    expect(Object.keys(first)).toEqual(fields);
    expect(first).toEqual(state(6));
    expect(first).not.toBe(second);
    const sample = track.sample(9);
    for (const field of fields) first[field] = 1000;
    expect(second).toEqual(state(6));
    expect(track.latest()).toEqual(state(6));
    expect(track.sample(9)).toEqual(sample);
  });

  it.each([-0, NaN, Infinity, -Infinity])('preserves scalar values exactly (%s)', (value) => {
    const track = new RemoteCarTrack();
    const input = state(0);
    // Wire validation is upstream; copying must not normalize existing values.
    for (const field of fields) input[field] = value;
    track.push(0, input);
    const latest = track.latest()!;
    for (const field of fields) expect(Object.is(latest[field], value)).toBe(true);
    for (const field of fields) input[field] = 0.125;
    for (const field of fields) expect(Object.is(track.latest()![field], value)).toBe(true);
  });

  it.each([
    [3, 'interpolated'],
    [9, 'extrapolated'],
    [60, 'held'],
  ] as const)('keeps a %s-tick %s sample detached', (tick, kind) => {
    const track = filled();
    const sample = track.sample(tick)!;
    expect(sample.kind).toBe(kind);
    const expected = structuredClone(sample);
    for (const key of Object.keys(sample.pose) as (keyof typeof sample.pose)[])
      sample.pose[key] = 1000;
    sample.kind = 'held';
    expect(track.sample(tick)).toEqual(expected);
    expect(track.latest()).toEqual(state(6));
  });

  it('reads each scalar contract field once, including inherited accessors', () => {
    const expected = state(6),
      reads = new Map<keyof CarNetState, number>();
    const prototype = {};
    for (const key of fields)
      Object.defineProperty(prototype, key, {
        get: () => {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return expected[key];
        },
      });
    const input = Object.create(prototype) as CarNetState;
    const track = new RemoteCarTrack();
    track.push(6, input);
    expect(track.latest()).toEqual(expected);
    track.latest();
    track.sample(6);
    for (const key of fields) expect(reads.get(key)).toBe(1);
  });

  it('retains only the scalar state contract, not caller metadata', () => {
    const input = { ...state(6), metadata: { owner: 'caller' } };
    const track = new RemoteCarTrack();
    track.push(6, input);
    expect(track.latest()).toEqual(state(6));
    expect(track.latest()).not.toHaveProperty('metadata');
  });

  it.each([0, 6, 12, 18])(
    'rejects duplicate tick %s without reading or copying its input',
    (tick) => {
      const track = filled([0, 6, 12, 18]);
      let reads = 0;
      const rejected = new Proxy(state(tick), {
        get() {
          reads++;
          throw new Error('Duplicate state must not be read');
        },
        ownKeys() {
          throw new Error('Duplicate state must not be enumerated');
        },
      });
      expect(track.push(tick, rejected)).toBe(false);
      expect(reads).toBe(0);
      expect(track.latest()).toEqual(state(18));
      expect(track.sample(9)).toEqual(filled([0, 6, 12, 18]).sample(9));
    },
  );

  it.each([false, true])(
    'keeps ingress atomic when a late scalar read throws (empty: %s)',
    (empty) => {
      const track = filled(empty ? [] : [0, 6, 12]);
      const newest = track.newest,
        latest = track.latest();
      const times = [0, 3, 6, 9, 12, 18];
      const samples = times.map((tick) => track.sample(tick));
      const sentinel = new Error('State accessor failed');
      const invalid = state(9);
      Object.defineProperty(invalid, 'rank', {
        get: () => {
          throw sentinel;
        },
      });
      expect(() => track.push(9, invalid)).toThrow(sentinel);
      expect(track.newest).toBe(newest);
      expect(track.latest()).toEqual(latest);
      expect(times.map((tick) => track.sample(tick))).toEqual(samples);
      expect(track.push(9, state(9))).toBe(true);
      expect(track.sample(9)?.pose).toMatchObject({ x: 0.9, y: 9 / 24, z: -9 / 8 });
    },
  );

  it('preserves out-of-order insertion and newest-state selection', () => {
    const track = filled([12, 0, 18, 6]),
      reference = filled([0, 6, 12, 18]);
    expect(track.newest).toBe(18);
    expect(track.latest()).toEqual(state(18));
    for (let tick = -1; tick <= 40; tick += 0.25)
      expect(track.sample(tick)).toEqual(reference.sample(tick));
  });

  it('keeps the inclusive 240-tick history boundary and sparse bracketing pair', () => {
    const track = filled(Array.from({ length: 41 }, (_, index) => index * 6));
    expect(track.sample(0)).not.toBeNull();
    track.push(246, state(246));
    expect(track.sample(0)).toBeNull();
    expect(track.sample(6)).not.toBeNull();
    expect(track.latest()).toEqual(state(246));

    const sparse = filled([0, 600]);
    expect(sparse.sample(0)).not.toBeNull();
    sparse.push(606, state(606));
    expect(sparse.sample(0)).toBeNull();
    const before = sparse.sample(603);
    // Historically accepted stale insertions are still immediately pruned.
    expect(sparse.push(0, state(0))).toBe(true);
    expect(sparse.sample(0)).toBeNull();
    expect(sparse.sample(603)).toEqual(before);
    expect(sparse.newest).toBe(606);
  });

  it('preserves each custom extrapolation cap while isolating its returned pose', () => {
    const track = filled();
    for (const cap of [0, 1, 7.5, 15, 60]) {
      const sample = track.sample(100, cap)!;
      expect(sample.kind).toBe('held');
      expect(sample.pose.x).toBe(0.6 + 12 * cap * (1000 / 120 / 1000));
      sample.pose.x = -100;
      expect(track.sample(100, cap)?.pose.x).toBe(0.6 + 12 * cap * (1000 / 120 / 1000));
    }
  });
});
