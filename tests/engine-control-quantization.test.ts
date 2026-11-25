import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter } from '../src/net/bytes.ts';
import {
  ClientCommandLog,
  quantizeControls,
  readControls,
  writeControls,
} from '../src/net/input.ts';
import { controls, type Controls } from '../src/simulation/config.ts';

function encoded(value: Controls) {
  const writer = new ByteWriter(8);
  writeControls(writer, value);
  return writer.finish();
}

/** The unchanged production codec is independent of the scalar implementation. */
function compareWire(value: Controls) {
  const bytes = encoded(value),
    expected = readControls(new ByteReader(bytes)),
    actual = quantizeControls(value);
  for (const key of Object.keys(expected) as (keyof Controls)[]) {
    if (!Object.is(actual[key], expected[key]))
      throw new Error(
        `Wire mismatch for ${key}: ${String(actual[key])} / ${String(expected[key])}`,
      );
  }
  const again = encoded(actual);
  for (let i = 0; i < bytes.length; i++) {
    if (again[i] !== bytes[i]) throw new Error(`Re-encoded byte ${i} changed`);
  }
  return actual;
}

describe('control quantization without temporary wire storage', () => {
  it('matches every steering code and both sides of every rounding boundary', () => {
    const value = controls();
    let compared = 0;
    for (let code = -32767; code <= 32767; code++) {
      value.steer = code / 32767;
      compareWire(value);
      compared++;
      if (code === 32767) continue;
      const boundary = (code + 0.5) / 32767;
      for (const offset of [-Number.EPSILON, 0, Number.EPSILON]) {
        value.steer = boundary + offset;
        compareWire(value);
        compared++;
      }
    }
    expect(compared).toBe(262137);
  });

  it('matches every pedal and rider-lean code and their rounding boundaries', () => {
    const value = controls();
    let compared = 0;
    for (const field of ['throttle', 'brake', 'clutch', 'rearBrake', 'riderLean'] as const) {
      const limit = field === 'riderLean' ? 63 : 255,
        first = field === 'riderLean' ? -63 : 0;
      for (let code = first; code <= limit; code++) {
        value[field] = code / limit;
        compareWire(value);
        compared++;
        if (code === limit) continue;
        const boundary = (code + 0.5) / limit;
        for (const offset of [-Number.EPSILON, 0, Number.EPSILON]) {
          value[field] = boundary + offset;
          compareWire(value);
          compared++;
        }
      }
      value[field] = 0;
    }
    expect(compared).toBe(4589);
  });

  it('retains integer coercion and clamping for non-finite or malformed runtime values', () => {
    const values: unknown[] = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      -Number.MIN_VALUE,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      undefined,
      null,
      '',
      '0.6',
      'invalid',
      true,
      false,
      [],
      [1],
      {},
    ];
    for (const field of [
      'throttle',
      'brake',
      'clutch',
      'rearBrake',
      'steer',
      'riderLean',
      'shift',
      'ers',
    ] as const) {
      for (const value of values) compareWire({ ...controls(), [field]: value } as Controls);
    }
    const zero = quantizeControls({ ...controls(), steer: -0, riderLean: -0 });
    expect(Object.is(zero.steer, 0)).toBe(true);
    expect(Object.is(zero.riderLean, 0)).toBe(true);
  });

  it('preserves wire rejection of values that cannot be converted to numeric pedals', () => {
    for (const field of ['throttle', 'brake', 'clutch', 'rearBrake', 'steer', 'riderLean']) {
      for (const bad of [1n, Symbol('invalid control')]) {
        const value = { ...controls(), [field]: bad } as Controls;
        expect(() => encoded(value)).toThrow(TypeError);
        expect(() => quantizeControls(value)).toThrow(TypeError);
      }
    }
  });

  it('retains discrete signs, strict ERS cases, truthy flags and absent optional fields', () => {
    for (const shift of [
      -Infinity,
      -1,
      -Number.MIN_VALUE,
      -0,
      0,
      Number.MIN_VALUE,
      1,
      Infinity,
      NaN,
    ]) {
      for (const ers of [-1, 0, 0.5, 1, 2, 3, NaN, undefined, '2'])
        compareWire({ ...controls(), shift, ers } as Controls);
    }
    for (const field of ['manualClutch', 'reverse', 'drs', 'overtake', 'pit']) {
      for (const value of [false, true, undefined, null, 0, 1, '', 'false', [], {}])
        compareWire({ ...controls(), [field]: value } as Controls);
    }
    const oldInput = controls();
    delete oldInput.rearBrake;
    delete oldInput.riderLean;
    delete oldInput.drs;
    delete oldInput.overtake;
    expect(compareWire(oldInput)).toMatchObject({
      rearBrake: 0,
      riderLean: 0,
      drs: false,
      overtake: false,
    });
    expect(quantizeControls({ ...controls(), shift: Number.MIN_VALUE }).shift).toBe(1);
  });

  it('matches a deterministic mixed-control trace and keeps each issued command independent', () => {
    let seed = 0x65f03a19;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
      log = new ClientCommandLog();
    log.start(720);
    for (let i = 0; i < 16384; i++) {
      const value: Controls = {
        throttle: random() * 3 - 1,
        brake: random() * 3 - 1,
        clutch: random() * 3 - 1,
        rearBrake: random() * 3 - 1,
        steer: random() * 4 - 2,
        riderLean: random() * 4 - 2,
        shift: random() * 2 - 1,
        ers: (i % 3) as 0 | 1 | 2,
        manualClutch: i % 5 === 0,
        reverse: i % 7 === 0,
        drs: i % 11 === 0,
        overtake: i % 13 === 0,
        pit: i % 17 === 0,
      };
      const expected = compareWire(value),
        command = log.issue(2, value);
      for (const key of Object.keys(expected) as (keyof Controls)[])
        if (!Object.is(command.controls[key], expected[key]))
          throw new Error(`Command ${i} changed ${key}`);
      value.throttle = 0.12345;
      if (command.controls.throttle !== expected.throttle)
        throw new Error(`Command ${i} retained caller input`);
    }
    expect(log.nextSeq).toBe(16384);
    expect(log.nextTick).toBe(720 + 32768);
  });

  it('returns the same public field shape without sharing or mutating input objects', () => {
    const input = Object.freeze({ ...controls(), throttle: 0.75, riderLean: -0.8 }),
      first = compareWire(input),
      second = compareWire(input),
      wire = readControls(new ByteReader(encoded(input)));
    expect(Object.keys(first)).toEqual(Object.keys(wire));
    expect(first).not.toBe(input);
    expect(first).not.toBe(second);
    first.throttle = 0;
    first.riderLean = 1;
    expect(second).toEqual(wire);
    expect(input.throttle).toBe(0.75);
    expect(input.riderLean).toBe(-0.8);
  });
});
