import { describe, expect, it } from 'vitest';
import { controls, type Controls } from '../src/simulation/config.ts';
import { LocalCarPredictor, type Pose } from '../src/net/prediction.ts';
import { CAR_FLAG, emptyCarState, type CarNetState } from '../src/net/snapshot.ts';

const fields = Object.keys(emptyCarState()) as (keyof CarNetState)[];
const poseFields = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw'] as const;
const input = (tick: number): Controls => ({
  ...controls(),
  throttle: (((Math.floor(tick / 17) % 11) + 11) % 11) / 10,
  brake: tick % 101 > 80 ? 0.25 : 0,
  steer: Math.sin(tick * 0.001) * 0.25,
});

function state(tick: number): CarNetState {
  const yaw = tick * 0.002;
  return {
    ...emptyCarState(3),
    flags: CAR_FLAG.FULL,
    x: Math.sin(yaw) * 4,
    y: tick / 240,
    z: tick / 10,
    qy: Math.sin(yaw / 2),
    qw: Math.cos(yaw / 2),
    vx: Math.cos(yaw) * 0.96,
    vy: 0.5,
    vz: 12,
    wx: 0.01,
    wy: 0.24,
    wz: -0.02,
    ax: -Math.sin(yaw) * 0.2304,
    ay: 0.02,
    az: -0.03,
    steer: 0.17,
    throttle: 0.6,
    brake: 0.1,
    gear: 4,
    rpm: 9600,
    s: tick / 3,
    laps: 2,
    rank: 7,
  };
}

function capture(predictor: LocalCarPredictor) {
  return {
    ready: predictor.ready,
    tick: predictor.tick,
    authoritative: predictor.authoritative,
    history: Array.from({ length: 80 }, (_, tick) => predictor.predictedAt(tick)),
    stats: structuredClone(predictor.stats),
    observations: predictor.model.observations,
    gains: [0, 12, 55, 100].map((speed) => [
      ...predictor.model.longGain(speed),
      predictor.model.yawGain(speed),
    ]),
  };
}

function damagePose(pose: Pose) {
  for (const field of poseFields) pose[field] = 1000;
}

describe('predictor state ownership', () => {
  it('preserves empty and pruned history results and the original prediction horizon', () => {
    const p = new LocalCarPredictor();
    expect(p.authoritative).toBeNull();
    expect(p.predictedAt(0)).toBeUndefined();
    p.reconcile(state(0), 0, input, 240, 0);
    expect(p.tick).toBe(60);
    expect(p.predictedAt(0)).toBeUndefined();
    expect(p.predictedAt(1)).toBeDefined();
    expect(p.predictedAt(60)).toBeDefined();
    expect(p.predictedAt(61)).toBeUndefined();
    p.reconcile(state(6), 6, input, 66, 50);
    expect(p.predictedAt(6)).toBeUndefined();
    expect(p.predictedAt(7)).toBeDefined();
    expect(p.predictedAt(66)).toBeDefined();
    expect(p.predictedAt(67)).toBeUndefined();
  });

  it('prevents a queried pose from fabricating a later reconciliation error', () => {
    const p = new LocalCarPredictor(),
      reference = new LocalCarPredictor();
    const linear = (tick: number) => ({
      ...emptyCarState(),
      flags: CAR_FLAG.FULL,
      x: tick / 10,
      vx: 12,
    });
    p.reconcile(linear(0), 0, input, 18, 0);
    reference.reconcile(linear(0), 0, input, 18, 0);
    const queried = p.predictedAt(12)!;
    expect(Object.keys(queried)).toEqual(poseFields);
    damagePose(queried);
    expect(p.predictedAt(12)).toEqual(reference.predictedAt(12));
    p.reconcile(linear(12), 12, input, 30, 100);
    reference.reconcile(linear(12), 12, input, 30, 100);
    expect(p.stats.positionError[0]).toBeLessThan(1e-12);
    expect(capture(p)).toEqual(capture(reference));
  });

  it('returns independent predicted poses without recording additional observations', () => {
    const p = new LocalCarPredictor();
    p.reconcile(state(0), 0, input, 18, 0);
    const before = capture(p);
    const first = p.predictedAt(12)!,
      second = p.predictedAt(12)!;
    expect(first).not.toBe(second);
    damagePose(first);
    expect(second).toEqual(before.history[12]);
    for (let n = 0; n < 32; n++) damagePose(p.predictedAt(12)!);
    expect(capture(p)).toEqual(before);
  });

  it('owns every authoritative scalar after reconciliation', () => {
    const p = new LocalCarPredictor();
    const producer = state(0),
      expected = { ...producer };
    p.reconcile(producer, 0, input, 18, 0);
    for (const field of fields) producer[field] = 1000;
    expect(p.authoritative).toEqual({ tick: 0, state: expected });
    expect(Object.keys(p.authoritative!.state)).toEqual(fields);
  });

  it('returns independent authoritative wrappers and complete states', () => {
    const p = new LocalCarPredictor();
    p.reconcile(state(6), 6, input, 24, 50);
    const before = capture(p);
    const first = p.authoritative!,
      second = p.authoritative!;
    expect(first).not.toBe(second);
    expect(first.state).not.toBe(second.state);
    for (const field of fields) first.state[field] = 1000;
    first.tick = -99;
    first.state = state(9000);
    expect(second).toEqual(before.authoritative);
    expect(capture(p)).toEqual(before);
  });

  it('retains detached earlier getter results when the next authority arrives', () => {
    const p = new LocalCarPredictor(),
      producer = state(0);
    p.reconcile(producer, 0, input, 18, 0);
    const earlier = p.authoritative!;
    Object.assign(producer, state(6));
    p.reconcile(producer, 6, input, 24, 50);
    expect(earlier).toEqual({ tick: 0, state: state(0) });
    earlier.state.rank = 900;
    expect(p.authoritative).toEqual({ tick: 6, state: state(6) });
  });

  it.each([-0, NaN, Infinity, -Infinity])('copies HUD scalar values exactly (%s)', (value) => {
    const p = new LocalCarPredictor(),
      producer = state(0);
    const hudFields = ['id', 'gear', 'rpm', 's', 'laps', 'rank'] as const;
    for (const field of hudFields) producer[field] = value;
    producer.x = -0;
    producer.qx = -0;
    p.reconcile(producer, 0, input, 18, 0);
    const latest = p.authoritative!.state;
    for (const field of hudFields) expect(Object.is(latest[field], value)).toBe(true);
    expect(Object.is(latest.x, -0)).toBe(true);
    expect(Object.is(latest.qx, -0)).toBe(true);
    for (const field of fields) producer[field] = 123;
    for (const field of hudFields)
      expect(Object.is(p.authoritative!.state[field], value)).toBe(true);
  });

  it('reads every inherited scalar getter once before any input callback', () => {
    const p = new LocalCarPredictor(),
      expected = state(0),
      prototype = {};
    const reads = new Map<keyof CarNetState, number>();
    for (const field of fields)
      Object.defineProperty(prototype, field, {
        get: () => {
          reads.set(field, (reads.get(field) ?? 0) + 1);
          return expected[field];
        },
      });
    const producer = Object.create(prototype) as CarNetState;
    let callbacks = 0;
    p.reconcile(
      producer,
      0,
      (tick) => {
        callbacks++;
        expect(reads.size).toBe(fields.length);
        for (const field of fields) expect(reads.get(field)).toBe(1);
        return input(tick);
      },
      18,
      0,
    );
    expect(callbacks).toBeGreaterThan(0);
    expect(p.authoritative).toEqual({ tick: 0, state: expected });
    p.render(0);
    p.predictedAt(12);
    for (const field of fields) expect(reads.get(field)).toBe(1);
  });

  it('does not retain unrelated producer metadata', () => {
    const p = new LocalCarPredictor();
    const producer = { ...state(0), metadata: { owner: 'caller' } };
    p.reconcile(producer, 0, input, 18, 0);
    expect(p.authoritative!.state).toEqual(state(0));
    expect(p.authoritative!.state).not.toHaveProperty('metadata');
  });

  it('finishes the input-state copy before callbacks can reuse the producer', () => {
    const p = new LocalCarPredictor(),
      reference = new LocalCarPredictor();
    const producer = state(0);
    p.reconcile(
      producer,
      0,
      (tick) => {
        for (const field of fields) producer[field] = 1000;
        return input(tick);
      },
      18,
      0,
    );
    reference.reconcile(state(0), 0, input, 18, 0);
    expect(capture(p)).toEqual(capture(reference));
  });

  it.each([-1, 0, 5, 6])('ignores stale tick %s without reading the producer', (tick) => {
    const p = new LocalCarPredictor();
    p.reconcile(state(6), 6, input, 24, 50);
    const before = capture(p);
    const producer = new Proxy(state(0), {
      get() {
        throw new Error('must not read');
      },
    });
    expect(() =>
      p.reconcile(
        producer,
        tick,
        () => {
          throw new Error('must not look up input');
        },
        500,
        1000,
      ),
    ).not.toThrow();
    expect(capture(p)).toEqual(before);
  });

  it.each(['az', 'rank'] as const)(
    'leaves existing state intact when %s throws during copying',
    (field) => {
      const p = new LocalCarPredictor(),
        reference = new LocalCarPredictor();
      p.reconcile(state(0), 0, input, 18, 0);
      reference.reconcile(state(0), 0, input, 18, 0);
      const before = capture(p),
        sentinel = new Error('producer field failed');
      const producer = state(6);
      producer.flags |= CAR_FLAG.CONTACT;
      Object.defineProperty(producer, field, {
        get() {
          throw sentinel;
        },
      });
      expect(() =>
        p.reconcile(
          producer,
          6,
          () => {
            throw new Error('must not look up input');
          },
          24,
          50,
        ),
      ).toThrow(sentinel);
      expect(capture(p)).toEqual(before);
      p.reconcile(state(6), 6, input, 24, 50);
      reference.reconcile(state(6), 6, input, 24, 50);
      expect(capture(p)).toEqual(capture(reference));
    },
  );

  it('does not establish a first authority when a late scalar read fails', () => {
    const p = new LocalCarPredictor(),
      producer = state(0);
    const before = capture(p),
      sentinel = new Error('rank unavailable');
    Object.defineProperty(producer, 'rank', {
      get() {
        throw sentinel;
      },
    });
    expect(() => p.reconcile(producer, 0, input, 18, 0)).toThrow(sentinel);
    expect(capture(p)).toEqual(before);
  });

  it('keeps rendered poses detached from future rendering and history', () => {
    const p = new LocalCarPredictor(),
      reference = new LocalCarPredictor();
    for (const predictor of [p, reference]) {
      predictor.reconcile(state(0), 0, input, 18, 0);
      predictor.render(0);
      predictor.reconcile({ ...state(6), x: state(6).x + 1 }, 6, input, 24, 50);
    }
    const rendered = p.render(50);
    expect(rendered).toEqual(reference.render(50));
    damagePose(rendered);
    expect(p.render(100)).toEqual(reference.render(100));
    expect(capture(p)).toEqual(capture(reference));
  });

  it('isolates reused inputs and every returned view across normal, contact and AI traces', () => {
    const p = new LocalCarPredictor(),
      reference = new LocalCarPredictor();
    const producer = state(0);
    for (let n = 0; n < 128; n++) {
      const tick = n * 6,
        now = (tick * 1000) / 120;
      const flags =
        CAR_FLAG.FULL | (n % 17 === 0 ? CAR_FLAG.CONTACT : 0) | (n % 29 === 0 ? CAR_FLAG.AI : 0);
      Object.assign(producer, state(tick), { flags });
      reference.reconcile({ ...producer }, tick, input, tick + 18, now);
      p.reconcile(producer, tick, input, tick + 18, now);
      for (const field of fields) producer[field] = 1000;
      expect(p.authoritative).toEqual(reference.authoritative);
      const authority = p.authoritative!;
      authority.tick = -1000;
      for (const field of fields) authority.state[field] = -1000;
      for (let t = tick + 1; t <= tick + 18; t++) {
        const pose = p.predictedAt(t)!;
        expect(pose).toEqual(reference.predictedAt(t));
        damagePose(pose);
      }
      for (const delay of [0, 7, 14]) {
        const pose = p.render(now + delay);
        expect(pose).toEqual(reference.render(now + delay));
        damagePose(pose);
      }
    }
    expect(capture(p)).toEqual(capture(reference));
  });
});
