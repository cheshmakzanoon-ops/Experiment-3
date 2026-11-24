import { describe, expect, it } from 'vitest';
import { ResponseModel } from '../src/net/prediction.ts';
import { controls, type Controls } from '../src/simulation/config.ts';

// Frozen pre-optimization oracle: ResponseModel from the checked-in implementation
// before agent 29. Its arithmetic remains independent of the scalar implementation.
// Section SHA-256: b25ffa0dbf7a3c686475cc2968e21e0b0dec043f3952dfb554cf23cad94867fe
const BINS = 20,
  BIN_SPEED = 5,
  FORGET = 0.995;
/** Online-learned response of the local car to its inputs: longitudinal
 * acceleration against throttle/brake and yaw rate against steering, per
 * 5 m/s speed band, with exponential forgetting (≈ 10 s at 20 Hz). Learned
 * from the authoritative stream, so it follows the vehicle class, setup,
 * tyre state and assists without client-side physics. */
class ReferenceResponseModel {
  private normal = new Float64Array(BINS * 9);
  private target = new Float64Array(BINS * 3);
  private yawNum = new Float64Array(BINS);
  private yawDen = new Float64Array(BINS);
  observations = 0;
  private bin(speed: number) {
    return Math.min(BINS - 1, Math.max(0, Math.floor(speed / BIN_SPEED)));
  }
  observe(speed: number, aLong: number, yawRate: number, input: Controls) {
    const b = this.bin(speed),
      x = [1, input.throttle, input.brake];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++)
        this.normal[b * 9 + i * 3 + j] = this.normal[b * 9 + i * 3 + j] * FORGET + x[i] * x[j];
      this.target[b * 3 + i] = this.target[b * 3 + i] * FORGET + x[i] * aLong;
    }
    this.yawNum[b] = this.yawNum[b] * FORGET + yawRate * input.steer;
    this.yawDen[b] = this.yawDen[b] * FORGET + input.steer * input.steer;
    this.observations++;
  }
  /** [d a_long / d throttle, d a_long / d brake] (m/s² per unit input). */
  longGain(speed: number): [number, number] {
    const b = this.bin(speed),
      m = Array.from(this.normal.subarray(b * 9, b * 9 + 9)),
      t = this.target.subarray(b * 3, b * 3 + 3);
    for (const i of [0, 4, 8]) m[i] += 1e-2;
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (!(Math.abs(det) > 1e-6)) return [0, 0];
    // Cramer's rule for the throttle and brake coefficients.
    const replace = (col: number) => {
      const r = [...m];
      for (let i = 0; i < 3; i++) r[i * 3 + col] = t[i];
      return (
        r[0] * (r[4] * r[8] - r[5] * r[7]) -
        r[1] * (r[3] * r[8] - r[5] * r[6]) +
        r[2] * (r[3] * r[7] - r[4] * r[6])
      );
    };
    const gThrottle = replace(1) / det,
      gBrake = replace(2) / det;
    return [
      Number.isFinite(gThrottle) ? Math.max(-5, Math.min(40, gThrottle)) : 0,
      Number.isFinite(gBrake) ? Math.max(-80, Math.min(5, gBrake)) : 0,
    ];
  }
  yawGain(speed: number) {
    const b = this.bin(speed);
    return this.yawDen[b] > 0.05 ? this.yawNum[b] / this.yawDen[b] : 0;
  }
}

const pair = () => [new ReferenceResponseModel(), new ResponseModel()] as const;
const input = (throttle = 0, brake = 0, steer = 0): Controls => ({
  ...controls(),
  throttle,
  brake,
  steer,
});
function compare(models: ReturnType<typeof pair>, speeds: number[]) {
  const [reference, candidate] = models;
  for (const speed of speeds) {
    expect(candidate.longGain(speed)).toEqual(reference.longGain(speed));
    expect(Object.is(candidate.yawGain(speed), reference.yawGain(speed))).toBe(true);
  }
  expect(candidate.observations).toBe(reference.observations);
}
function train(
  models: ReturnType<typeof pair>,
  speed: number,
  acceleration: number,
  yaw: number,
  command: Controls,
) {
  for (const model of models) model.observe(speed, acceleration, yaw, command);
}

function randomSource() {
  let seed = 293710;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

describe('ResponseModel exact arithmetic with scalar coefficient evaluation', () => {
  it('preserves untrained, out-of-range and nonfinite speed queries', () => {
    compare(pair(), [-Infinity, -100, -0, 0, 1, 4.999999, 5, 94.99, 95, 100, Infinity, NaN]);
  });

  it('preserves all trained bands and exponential forgetting over a long seeded stream', () => {
    const models = pair(),
      random = randomSource();
    for (let i = 0; i < 16000; i++) {
      const speed = (i % 20) * 5 + random() * 5;
      const throttle = random(),
        brake = i % 3 === 0 ? random() : 0,
        steer = random() * 2 - 1;
      train(
        models,
        speed,
        -1.2 + throttle * 14 - brake * 35,
        steer * 0.4,
        input(throttle, brake, steer),
      );
      if (i % 31 === 0)
        compare(
          models,
          Array.from({ length: 20 }, (_, band) => band * 5 + 2),
        );
    }
    compare(
      models,
      Array.from({ length: 20 }, (_, band) => band * 5 + 2),
    );
    // Inspect the numerical state only to establish that the training update has
    // not changed its operation order. No internal buffer identity is required.
    type State = {
      normal: Float64Array;
      target: Float64Array;
      yawNum: Float64Array;
      yawDen: Float64Array;
    };
    const before = models[0] as unknown as State,
      after = models[1] as unknown as State;
    for (const field of ['normal', 'target', 'yawNum', 'yawDen'] as const) {
      expect(after[field]).toEqual(before[field]);
    }
  });

  it.each([0, 1, 9, 19])('keeps training and queries isolated to speed band %i', (band) => {
    const models = pair();
    for (let i = 0; i < 200; i++) {
      const throttle = (i % 7) / 6,
        brake = (i % 5) / 4;
      train(
        models,
        band * 5 + 2,
        -0.7 + 10 * throttle - 30 * brake,
        0.18,
        input(throttle, brake, 0.3),
      );
    }
    compare(
      models,
      Array.from({ length: 20 }, (_, b) => b * 5 + 2),
    );
    if (band > 0) expect(models[1].longGain(band * 5 - Number.EPSILON * band * 5)).toEqual([0, 0]);
  });

  it.each([0, 0.25, 1])(
    'preserves regularization with collinear throttle and brake %f',
    (value) => {
      const models = pair();
      for (let i = 0; i < 3000; i++) train(models, 42, value * 8 - 2, 0, input(value, value));
      compare(models, [40, 42, 44.9999]);
    },
  );

  it.each([-100000, 100000])('retains gain clipping with acceleration scale %f', (scale) => {
    const models = pair();
    for (let i = 0; i < 300; i++) {
      const throttle = (i % 7) / 6,
        brake = (i % 5) / 4;
      train(models, 26, scale * (throttle - brake), 0, input(throttle, brake));
    }
    compare(models, [25, 26, 29.99]);
    const [throttle, brake] = models[1].longGain(26);
    expect(throttle).toBe(scale > 0 ? 40 : -5);
    expect(brake).toBe(scale > 0 ? -80 : 5);
  });

  it('retains signed-zero observations and boundary rounding', () => {
    const models = pair();
    for (const speed of [-0, 0, 4.999999999999999, 5, 94.99999999999999, 95]) {
      train(models, speed, -0, -0, input(-0, 0, -0));
      compare(models, [-0, 0, 4.999999999999999, 5, 94.99999999999999, 95]);
    }
  });

  it.each([NaN, Infinity, -Infinity])(
    'preserves existing handling of nonfinite training data %s',
    (value) => {
      const models = pair();
      train(models, 7, value, value, input(value, 0.3, 0.2));
      train(models, 18, 1, 0.1, input(0.5, 0.2, 0.1));
      compare(models, [5, 7, 15, 18, 0, 95]);
    },
  );

  it('retains independent returned pairs without sharing mutable solve storage', () => {
    const models = pair();
    for (let i = 0; i < 200; i++)
      train(models, 12, i % 7, 0.2, input((i % 5) / 4, (i % 3) / 2, 0.1));
    const before = models[1].longGain(12),
      later = models[1].longGain(12),
      expected = models[0].longGain(12);
    expect(later).not.toBe(before);
    before[0] = 123456;
    before[1] = -123456;
    compare(models, [12]);
    train(models, 12, 4, -0.2, input(0.1, 0.8, -0.3));
    expect(later).toEqual(expected);
  });

  it('reads controls in the original order and does not retain the producer object', () => {
    const logs: string[][] = [[], []];
    const models = pair();
    models.forEach((model, index) => {
      const command = controls();
      for (const [key, value] of [
        ['throttle', 0.3],
        ['brake', 0.1],
        ['steer', 0.2],
      ] as const) {
        Object.defineProperty(command, key, {
          configurable: true,
          get: () => {
            logs[index].push(key);
            return value;
          },
        });
      }
      model.observe(12, 3, 0.1, command);
      model.longGain(12);
      model.yawGain(12);
    });
    expect(logs[1]).toEqual(['throttle', 'brake', 'steer', 'steer', 'steer']);
    expect(logs[1]).toEqual(logs[0]);
    compare(models, [12]);
  });
});
