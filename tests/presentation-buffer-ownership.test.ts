import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';

function frame(time: number, cars = 1) {
  const value = new Float32Array(HEADER + cars * CAR_STRIDE);
  value[H.TIME] = time;
  value[H.TICK] = Math.round(time * 120);
  value[H.CARS] = cars;
  for (let id = 0; id < cars; id++) {
    const car = carBase(id),
      speed = 2 + id,
      spin = 0.4 + id * 0.1;
    value[car + F.X] = id * 3 + speed * time;
    value[car + F.VX] = speed;
    value[car + F.QY] = Math.sin((spin * time) / 2);
    value[car + F.QW] = Math.cos((spin * time) / 2);
    value[car + F.WY] = spin;
  }
  return value;
}

function offsetView(value: Float32Array) {
  const backing = new Float32Array(value.length + 28).fill(-913),
    view = backing.subarray(11, 11 + value.length);
  view.set(value);
  return { backing, view };
}

function outputs() {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),
  };
}

function pose(
  a: Float32Array,
  b: Float32Array,
  id: number,
  alpha: number,
  out = outputs(),
) {
  sampleChassisPose(
    a,
    b,
    carBase(id),
    alpha,
    out.position,
    out.orientation,
    out.velocity,
    out.angularVelocity,
  );
  return out;
}

function values(out: ReturnType<typeof outputs>) {
  return [
    ...out.position.toArray(),
    ...out.orientation.toArray(),
    ...out.velocity.toArray(),
    ...out.angularVelocity.toArray(),
  ];
}

describe('presentation buffer ownership at transfer and reuse boundaries', () => {
  it.each([1, 32])('retains only the %i-entrant view and its auxiliary view after transfer', (cars) => {
    const clock = new LiveFrameClock(),
      snapshots = [frame(0, cars), frame(0.025, cars)],
      traffic = [new Float32Array([7, 8]), new Float32Array([17, 18])];
    clock.setPaused(false);
    for (let i = 0; i < snapshots.length; i++) {
      const source = offsetView(snapshots[i]),
        auxiliary = offsetView(traffic[i]);
      expect(source.view.byteOffset).toBeGreaterThan(0);
      clock.observe(source.view, i * 25, auxiliary.view);
      // Transfer the entire backing stores, including the adjacent sentinel data.
      // Presentation must retain the views' contents without borrowing either store.
      structuredClone([source.backing.buffer, auxiliary.backing.buffer], {
        transfer: [source.backing.buffer, auxiliary.backing.buffer],
      });
      expect(source.view.byteLength).toBe(0);
      expect(auxiliary.view.byteLength).toBe(0);
    }
    const sampled = clock.sample((0.0125 + LiveFrameClock.DELAY) * 1000)!;
    expect(sampled.a).toEqual(snapshots[0]);
    expect(sampled.b).toEqual(snapshots[1]);
    expect(sampled.alpha).toBeCloseTo(0.5, 6);
    expect(sampled.auxiliaryA).toEqual(traffic[0]);
    expect(sampled.auxiliaryB).toEqual(traffic[1]);
    expect(sampled.a.byteOffset).toBe(0);
    expect(sampled.a.buffer.byteLength).toBe(snapshots[0].byteLength);
    expect(sampled.auxiliaryA!.buffer.byteLength).toBe(traffic[0].byteLength);
  });

  it('keeps frame/auxiliary storage bounded and paired through repeated wrap and reset', () => {
    const clock = new LiveFrameClock(),
      source = frame(0, 2),
      traffic = new Float32Array(3),
      frameStorage = new Set<ArrayBufferLike>(),
      auxiliaryStorage = new Set<ArrayBufferLike>();
    let result: ReturnType<LiveFrameClock['sample']> = null;
    for (let session = 0; session < 3; session++) {
      clock.reset();
      expect(clock.sample(session * 10000)).toBeNull();
      clock.setPaused(false);
      for (let tick = 0; tick < 64; tick++) {
        source[H.TIME] = tick / 120;
        source[H.TICK] = tick;
        traffic.set([session, tick, -tick]);
        const wall = session * 10000 + (tick * 1000) / 120;
        clock.observe(source, wall, traffic);
        const sampled = clock.sample(wall)!;
        if (result) expect(sampled).toBe(result);
        result = sampled;
        for (const [retained, auxiliary] of [
          [sampled.a, sampled.auxiliaryA!],
          [sampled.b, sampled.auxiliaryB!],
        ]) {
          expect(auxiliary).toEqual(
            new Float32Array([session, retained[H.TICK], -retained[H.TICK]]),
          );
          expect(retained.buffer).not.toBe(source.buffer);
          expect(auxiliary.buffer).not.toBe(traffic.buffer);
          frameStorage.add(retained.buffer);
          auxiliaryStorage.add(auxiliary.buffer);
        }
        expect(clock.bufferedFrames).toBeLessThanOrEqual(LiveFrameClock.CAPACITY);
        source[H.TICK] = traffic[1] = 999;
        expect(sampled.b[H.TICK]).not.toBe(999);
        expect(sampled.auxiliaryB![1]).not.toBe(999);
      }
      // Expose the newest slots as well as the delayed interpolation pair.
      const newest = clock.sample(session * 10000 + 1000)!;
      frameStorage.add(newest.b.buffer);
      auxiliaryStorage.add(newest.auxiliaryB!.buffer);
    }
    expect(frameStorage.size).toBe(LiveFrameClock.CAPACITY);
    expect(auxiliaryStorage.size).toBe(LiveFrameClock.CAPACITY);
  });

  it('rejects malformed replacement frames atomically without losing the retained timeline', () => {
    const clock = new LiveFrameClock();
    clock.setPaused(false);
    clock.observe(frame(0), 0, new Float32Array([1]));
    clock.observe(frame(0.025), 25, new Float32Array([2]));
    const before = clock.sample(40)!,
      saved = {
        a: before.a.slice(),
        b: before.b.slice(),
        alpha: before.alpha,
        auxiliaryA: before.auxiliaryA!.slice(),
        auxiliaryB: before.auxiliaryB!.slice(),
      };
    const malformed = frame(-10);
    malformed[H.CARS] = 1.5;
    malformed[carBase(0) + RACE_BASE + R.VEHICLE] = 3;
    expect(() => clock.observe(malformed, 50)).toThrow('Invalid live presentation snapshot');
    expect(() => clock.observe(frame(0.05), NaN)).toThrow('Invalid live presentation snapshot');
    expect(clock.bufferedFrames).toBe(2);
    expect(clock.sample(40)).toEqual(saved);
  });
});

describe('shared pose scratch ownership', () => {
  it('samples nonzero-offset views without reading or modifying surrounding data', () => {
    const a = frame(0, 2),
      b = frame(0.1, 2),
      offsetA = offsetView(a),
      offsetB = offsetView(b),
      originalA = offsetA.backing.slice(),
      originalB = offsetB.backing.slice();
    for (const alpha of [0, 0.19, 0.81, 1, 0.43])
      for (const id of [1, 0]) {
        const expected = values(pose(a, b, id, alpha));
        expect(values(pose(offsetA.view, offsetB.view, id, alpha))).toEqual(expected);
      }
    expect(offsetA.backing).toEqual(originalA);
    expect(offsetB.backing).toEqual(originalB);
  });

  it('publishes the interpolated pose before a quaternion callback samples another entrant', () => {
    const a = frame(0, 2),
      b = frame(0.1, 2),
      outer = outputs(),
      inner = outputs(),
      expectedOuter = values(pose(a, b, 0, 0.37)),
      expectedInner = values(pose(a, b, 1, 0.79));
    let callbacks = 0;
    outer.orientation._onChange(() => {
      callbacks++;
      pose(a, b, 1, 0.79, inner);
    });
    pose(a, b, 0, 0.37, outer);
    expect(callbacks).toBe(1);
    expect(values(outer)).toEqual(expectedOuter);
    expect(values(inner)).toEqual(expectedInner);
    // Later calls may reuse internal scratch, never caller-owned pose outputs.
    for (const alpha of [0.1, 1, 0, 0.9]) pose(a, b, 1, alpha);
    expect(values(outer)).toEqual(expectedOuter);
    expect(values(inner)).toEqual(expectedInner);
  });
});
