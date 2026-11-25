import { createHash } from 'node:crypto';
import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { sampleMxFootField } from '../src/rendering/offroad/mx-foot-pose.ts';
import {
  MX_BOOT_PEDAL,
  MX_BOOT_PEG,
  motocrossBootFrame,
} from '../src/rendering/offroad/motocross-rider-contact.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MxGearStroke } from '../src/simulation/offroad/mx-gear-stroke.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  MX_FOOT,
  R,
  RACE_BASE,
  carBase,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const positions = (stroke: MxGearStroke) => [stroke.angle, stroke.cover, stroke.clear];
const rates = (stroke: MxGearStroke) => [stroke.angleRate, stroke.coverRate, stroke.clearRate];
const car = carBase(0),
  fields = [MX_FOOT.ANGLE, MX_FOOT.COVER, MX_FOOT.CLEAR] as const;
const presented = (a: Float32Array, b: Float32Array, alpha: number) =>
  fields.map((field) => sampleMxFootField(a, b, car, field, alpha));

/** Only the foot controller is prescribed. The real writer performs every
 * Float32 conversion; no hand-assembled optional trajectory is substituted. */
function recordingSource(id: 'mx250' | 'mx450' = 'mx250') {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
  const frame = (clock: number) => {
    bike.clock = clock;
    const result = new Float32Array(HEADER + CAR_STRIDE);
    result[H.CARS] = 1;
    result[H.TIME] = clock;
    result[car + F.QW] = 1;
    result[car + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    writeWheelContact(result, car, bike);
    return result;
  };
  return { stroke: bike.gearStroke, frame };
}

function recording(
  source: ReturnType<typeof recordingSource>,
  at: number,
  next: number,
  origin = 0,
  hz = 30,
  phase = 0.6,
) {
  const event = origin + at,
    leftTime = event - phase / hz,
    rightTime = leftTime + 1 / hz;
  source.stroke.reset();
  source.stroke.engage(-1, origin);
  const previous = new MxGearStroke();
  previous.engage(-1, origin);
  const a = source.frame(leftTime);
  source.stroke.engage(next, event);
  const b = source.frame(rightTime);
  return {
    a,
    b,
    leftTime,
    rightTime,
    event,
    truth: (clock: number) => positions((clock < event ? previous : source.stroke).sample(clock)),
  };
}

describe('motocross motion near control travel limits', () => {
  it('retains every isolated position and rate from the previous canonical strokes', () => {
    // Golden trace from the pre-fix controller a4f599f2. This fixes the
    // established 260 ms envelopes independently of the new bridge formula.
    const samples: number[] = [],
      stroke = new MxGearStroke();
    for (const direction of [-1, 1]) {
      stroke.reset();
      stroke.engage(direction, 0);
      for (let n = 0; n <= 2700; n++) {
        stroke.sample(n / 10000);
        samples.push(...positions(stroke), ...rates(stroke));
      }
    }
    expect(samples).toHaveLength(32412);
    const bytes = new Uint8Array(new Float64Array(samples).buffer);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '147209b832093c423474a267d1ecf1b9726943211412b8118e93db4546e31399',
    );
  });

  it('bounds every channel rate when a legal accepted command arrives near an extremum', () => {
    const stroke = new MxGearStroke();
    const interruptions = [19 / 240, 27 / 240, 46 / 240, 56 / 240];
    for (const peak of [0.08, 0.115, 0.194, 0.237])
      for (const delta of [1e-9, 1e-6, 1e-3]) interruptions.push(peak - delta);
    for (const at of interruptions)
      for (const next of [-1, 1]) {
        stroke.reset();
        stroke.engage(-1, 0);
        stroke.sample(at);
        const incoming = rates(stroke),
          start = positions(stroke);
        stroke.engage(next, at);
        expect(positions(stroke.sample(at))).toEqual(start);
        rates(stroke).forEach((rate, axis) => expect(rate).toBeCloseTo(incoming[axis], 9));
        // A full 0.46 rad selector handoff takes 45 ms. Its zero-rate cubic
        // peaks at 1.5*distance/time; the incoming continuation contributes no
        // more than the measured incoming rate. The corresponding clearance
        // handoff is 10 ms. Cover coasts only its measured stopping distance,
        // then crosses the sleeve over the established 22 ms interval.
        const bounds = [
          Math.abs(incoming[0]) + (1.5 * 0.46) / 0.045,
          Math.max(1.75 * Math.abs(incoming[1]), 1.5 / 0.022),
          Math.abs(incoming[2]) + 1.5 / 0.01,
        ];
        const offsets = [0, 1e-12, 1e-10, 1e-8, 1e-6, 1e-5];
        for (let n = 1; n <= 240; n++) offsets.push(n / 4000);
        for (const after of offsets) {
          stroke.sample(at + after);
          positions(stroke).forEach((value, axis) => {
            expect(value).toBeGreaterThanOrEqual((axis === 0 ? -0.24 : 0) - 1e-12);
            expect(value).toBeLessThanOrEqual((axis === 0 ? 0.22 : 1) + 1e-12);
            expect(Number.isFinite(value)).toBe(true);
          });
          rates(stroke).forEach((rate, axis) =>
            expect(
              Math.abs(rate),
              `at=${at}, next=${next}, axis=${axis}, after=${after}`,
            ).toBeLessThanOrEqual(bounds[axis] + 1e-8),
          );
        }
        expect([...positions(stroke.sample(at + 0.27)), ...rates(stroke)]).toEqual([
          0, 0, 0, 0, 0, 0,
        ]);
      }
  });

  it('preserves local position and velocity where a limited tangent rejoins its full-duration motion', () => {
    const stroke = new MxGearStroke();
    for (const at of [19 / 240, 27 / 240, 0.079999, 0.114999, 0.193999, 0.236999]) {
      for (const next of [-1, 1]) {
        stroke.reset();
        stroke.engage(-1, 0);
        stroke.sample(at);
        const position = positions(stroke),
          velocity = rates(stroke);
        stroke.engage(next, at);
        for (const axis of [0, 1, 2]) {
          const minimum = axis === 0 ? -0.24 : 0,
            maximum = axis === 0 ? 0.22 : 1;
          const room = velocity[axis] > 0 ? maximum - position[axis] : position[axis] - minimum;
          const coverRoom = velocity[1] > 0 ? 1 - position[1] : position[1];
          const duration =
            axis === 0
              ? 0.045
              : axis === 2
                ? 0.01
                : velocity[1] === 0
                  ? 0.01
                  : Math.min(0.01, (2 * coverRoom) / Math.abs(velocity[1]));
          const join =
            velocity[axis] === 0
              ? duration
              : Math.min(duration, (0.99 * 3 * room) / Math.abs(velocity[axis]));
          if (!(join > 1e-10)) continue;
          const epsilon = Math.min(1e-9, join * 1e-4);
          stroke.sample(at + join - epsilon);
          const before = positions(stroke)[axis],
            incoming = rates(stroke)[axis];
          stroke.sample(at + join);
          const rate = rates(stroke)[axis];
          stroke.sample(at + join + epsilon);
          const after = positions(stroke)[axis],
            outgoing = rates(stroke)[axis];
          expect(Math.abs(incoming - outgoing)).toBeLessThan(0.001);
          expect((after - before) / (2 * epsilon)).toBeCloseTo(rate, 3);
        }
      }
    }
  });

  it('reconstructs near-extremum commands through the real Float32 writer at short and long clocks', () => {
    const source = recordingSource();
    let maximumError = 0;
    for (const origin of [0, 3600, 1048576])
      for (const hz of [60, 30]) {
        for (const peak of [0.08, 0.115, 0.194, 0.237])
          for (const delta of [1e-9, 1e-7, 1e-6, 0.001]) {
            for (const next of [-1, 1]) {
              const test = recording(source, peak - delta, next, origin, hz);
              for (const after of [0, 1e-10, 1e-8, 1e-6, 1e-5, 0.001, 0.005]) {
                const clock = test.event + after;
                const alpha = (clock - test.leftTime) / (test.rightTime - test.leftTime);
                const actual = presented(test.a, test.b, alpha),
                  expected = test.truth(clock);
                actual.forEach((value, axis) => {
                  maximumError = Math.max(maximumError, Math.abs(value - expected[axis]));
                  expect(Number.isFinite(value)).toBe(true);
                });
              }
            }
          }
      }
    expect(maximumError).toBeLessThan(2e-5);
  });

  it('keeps Float32 samples coherent on both sides of the continuation eligibility boundary', () => {
    const source = recordingSource(),
      canonical = new MxGearStroke();
    canonical.engage(-1, 0);
    for (const [axis, begin, end, duration] of [
      [0, 0.078001, 0.114999, 0.045],
      [2, 0.06, 0.079999, 0.01],
    ]) {
      let lo = begin,
        hi = end;
      const margin = (time: number) => {
        canonical.sample(time);
        const p = positions(canonical)[axis],
          rate = rates(canonical)[axis];
        const room = rate > 0 ? (axis === 0 ? 0.22 : 1) - p : p - (axis === 0 ? -0.24 : 0);
        return Math.abs(rate) * duration - 3 * 0.99 * room;
      };
      expect(margin(lo)).toBeLessThan(0);
      expect(margin(hi)).toBeGreaterThan(0);
      for (let i = 0; i < 55; i++) {
        const middle = (lo + hi) / 2;
        if (margin(middle) > 0) hi = middle;
        else lo = middle;
      }
      for (const origin of [0, 3600, 1048576])
        for (const offset of [-1e-9, -1e-11, 0, 1e-11, 1e-9]) {
          for (const next of [-1, 1]) {
            const test = recording(source, (lo + hi) / 2 + offset, next, origin);
            for (const alpha of [0.1, 0.3, 0.6, 0.7, 0.9]) {
              const clock = test.leftTime + alpha * (test.rightTime - test.leftTime);
              const expected = test.truth(clock);
              presented(test.a, test.b, alpha).forEach((value, channel) =>
                expect(Math.abs(value - expected[channel])).toBeLessThan(2e-5),
              );
            }
          }
        }
    }
  });
});

const configurations = (['mx250', 'mx450'] as const).flatMap((id) =>
  (['mid', 'high'] as const).map((detail) => [id, detail] as const),
);

it.each(configurations)(
  '%s/%s keeps the actual boot clear through 240 Hz near-extremum shifts',
  (id, detail) => {
    const source = recordingSource(id),
      materials = new BikeMaterials(0),
      definition = VEHICLES[id];
    const model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms());
    const selector = model.root.getObjectByName('Motocross gear selector')!;
    const boot = model.root.getObjectByName('Motocross left boot')!;
    const toe = new T.Vector3(...MX_BOOT_PEDAL)
      .sub(new T.Vector3(...MX_BOOT_PEG))
      .applyQuaternion(motocrossBootFrame(new T.Quaternion()));
    const sleeve = new T.Vector3(),
      origin = new T.Vector3(),
      axis = new T.Vector3(),
      ray = new T.Raycaster();
    const pose: BikePoseValues = {
      ...staticSag(definition),
      steer: 0,
      frontRotation: 0,
      rearRotation: 0,
      chassisLean: 0,
      riderOffset: 0,
      tuck: 0,
      brake: 0,
      rearBrake: 0.75,
      discTemp: 0,
      compoundColour: 0xffffff,
      riding: true,
      standing: 0.24,
    };
    const surface = (object: T.Object3D, up: number) => {
      ray.set(origin.copy(sleeve).addScaledVector(axis.set(0, up, 0), -0.14), axis);
      return ray.intersectObject(object, true)[0]?.point.y;
    };
    let minimum = Infinity;
    const measure = (channels: number[]) => {
      [pose.shiftAngle, pose.shiftCover, pose.shiftClear] = channels;
      model.pose(pose);
      model.root.updateMatrixWorld(true);
      let gap = Infinity;
      for (const x of [0.014, 0.031, 0.043]) {
        selector.localToWorld(sleeve.set(x, toe.y + 0.072, toe.z + 0.016));
        const bottom = surface(boot, 1),
          top = surface(boot, -1);
        const low = surface(selector, 1)!,
          high = surface(selector, -1)!;
        expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true);
        if (bottom !== undefined && top !== undefined)
          gap = Math.min(gap, Math.max(bottom - high, low - top));
      }
      minimum = Math.min(minimum, gap);
      return gap;
    };
    try {
      for (const [direction, clock] of [
        [1, 0.045],
        [-1, 0.115],
      ]) {
        source.stroke.reset();
        source.stroke.engage(direction, 0);
        const gap = measure(positions(source.stroke.sample(clock)));
        expect(gap).toBeGreaterThan(-0.003);
        expect(gap).toBeLessThan(0.006);
      }
      for (const tick of [19, 27, 46, 56])
        for (const next of [-1, 1]) {
          const test = recording(source, tick / 240, next);
          for (const alpha of [0.1, 0.3, 0.6, 0.65, 0.7, 0.8, 0.9, 1])
            measure(presented(test.a, test.b, alpha));
        }
      expect(minimum).toBeGreaterThan(-0.003);
    } finally {
      model.dispose();
      materials.dispose();
    }
  },
);
