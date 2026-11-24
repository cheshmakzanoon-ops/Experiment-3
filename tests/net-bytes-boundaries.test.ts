import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, DecodeError, fromBase64, toBase64 } from '../src/net/bytes.ts';

const golden = Uint8Array.of(
  0xab,
  0xfe,
  0x34,
  0x12,
  0xc7,
  0xcf,
  0x98,
  0xba,
  0xdc,
  0xfe,
  0,
  0,
  0xc0,
  0x3f,
  0,
  0,
  0,
  0,
  0,
  0,
  0xd0,
  0xbf,
  1,
  2,
  3,
  0x80,
  0x80,
  1,
);

function randomSource(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
}

describe('binary byte boundaries', () => {
  it.each([0, Number.MIN_VALUE, 0.75, 1, 3, 256])(
    'grows from capacity %s without changing little-endian bytes',
    (capacity) => {
      const writer = new ByteWriter(capacity);
      expect(writer.bytes(new Uint8Array()).finish()).toEqual(new Uint8Array());
      writer.u8(0xab).i8(-2).u16(0x1234).i16(-12345).u32(0xfedcba98).f32(1.5).f64(-0.25);
      writer.bytes(Uint8Array.of(99, 1, 2, 3, 99).subarray(1, 4)).varint(16384);
      const finished = writer.finish();
      expect(finished).toEqual(golden);
      expect(writer.length).toBe(golden.length);
      writer.u8(0x55);
      expect(finished).toEqual(golden);
      finished[0] = 0;
      expect(writer.finish()).toEqual(Uint8Array.of(...golden, 0x55));
    },
  );

  it('reads only the supplied subarray and returns independent byte slices', () => {
    const backing = Uint8Array.of(91, 92, ...golden, 93, 94);
    const reader = new ByteReader(backing.subarray(2, 2 + golden.length));
    expect(reader.u8()).toBe(0xab);
    expect(reader.i8()).toBe(-2);
    expect(reader.u16()).toBe(0x1234);
    expect(reader.i16()).toBe(-12345);
    expect(reader.u32()).toBe(0xfedcba98);
    expect(reader.f32()).toBe(1.5);
    expect(reader.f64()).toBe(-0.25);
    const bytes = reader.bytes(3);
    expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
    bytes[0] = 99;
    expect(backing.subarray(2, 2 + golden.length)).toEqual(golden);
    expect(reader.varint()).toBe(16384);
    expect(reader.remaining).toBe(0);
    expect(reader.bytes(0)).toEqual(new Uint8Array());
    expect(() => reader.end()).not.toThrow();
    expect(() => reader.u8()).toThrow(DecodeError);
    expect(reader.offset).toBe(golden.length);
  });

  it('rejects invalid byte lengths without moving or corrupting the cursor', () => {
    const reader = new ByteReader(Uint8Array.of(17, 34, 51));
    expect(reader.u8()).toBe(17);
    for (const length of [-1, -Number.MIN_VALUE, 0.5, 1.5, NaN, Infinity, -Infinity, 2 ** 53]) {
      expect(() => reader.bytes(length)).toThrow(DecodeError);
      expect(reader.offset).toBe(1);
      expect(reader.remaining).toBe(2);
    }
    expect(() => reader.bytes(3)).toThrow(DecodeError);
    expect(() => reader.bytes(Number.MAX_SAFE_INTEGER)).toThrow(DecodeError);
    expect(reader.offset).toBe(1);
    expect(reader.bytes(0)).toEqual(new Uint8Array());
    expect(reader.bytes(2)).toEqual(Uint8Array.of(34, 51));
    expect(() => reader.end()).not.toThrow();
  });

  it.each([
    ['u8', 1],
    ['i8', 1],
    ['u16', 2],
    ['i16', 2],
    ['u32', 4],
    ['f32', 4],
    ['f64', 8],
  ] as const)('rejects every truncated %s within a subarray', (method, width) => {
    const backing = new Uint8Array(32);
    for (let length = 0; length < width; length++) {
      const reader = new ByteReader(backing.subarray(3, 3 + length));
      expect(() => reader[method]()).toThrow(DecodeError);
      expect(reader.offset).toBe(0);
      expect(reader.remaining).toBe(length);
    }
  });
});

describe('safe unsigned LEB128 boundaries', () => {
  it.each([
    [0, [0]],
    [127, [0x7f]],
    [128, [0x80, 1]],
    [16383, [0xff, 0x7f]],
    [16384, [0x80, 0x80, 1]],
    [2 ** 32 - 1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
    [2 ** 32, [0x80, 0x80, 0x80, 0x80, 0x10]],
    [2 ** 49, [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 1]],
    [Number.MAX_SAFE_INTEGER, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f]],
  ] as const)('preserves the exact bytes of %s', (value, bytes) => {
    const encoded = Uint8Array.from(bytes);
    expect(new ByteWriter(1).varint(value).finish()).toEqual(encoded);
    const reader = new ByteReader(encoded);
    expect(reader.varint()).toBe(value);
    expect(() => reader.end()).not.toThrow();
  });

  it('rejects unsafe, truncated, and more-than-eight-byte varints as DecodeError', () => {
    const continued = Array<number>(7).fill(0x80);
    for (const bytes of [
      [],
      [0x80],
      [0xff],
      [...continued, 0x10],
      [0x81, ...continued.slice(1), 0x10],
      [...Array<number>(7).fill(0xff), 0x7f],
      [...continued, 0x80],
      [...continued, 0x80, 0],
    ]) {
      expect(() => new ByteReader(Uint8Array.from(bytes)).varint()).toThrow(DecodeError);
    }
  });

  it('keeps accepting safe overlong encodings within the existing eight-byte bound', () => {
    for (const value of [0, 1, 127]) {
      const reader = new ByteReader(
        Uint8Array.of(value | 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0),
      );
      expect(reader.varint()).toBe(value);
      expect(() => reader.end()).not.toThrow();
    }
  });

  it('keeps invalid writer inputs from partially appending a value', () => {
    const writer = new ByteWriter().u8(42);
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, 2 ** 53]) {
      expect(() => writer.varint(value)).toThrow();
      expect(writer.finish()).toEqual(Uint8Array.of(42));
    }
  });

  it('round-trips deterministic safe integers and matches an exact BigInt byte oracle', () => {
    const random = randomSource(0xb17eb0);
    for (let i = 0; i < 512; i++) {
      const value = (random() & 0x1fffff) * 2 ** 32 + random();
      const encoded = new ByteWriter(i % 4).varint(value).finish();
      let exact = BigInt(value);
      const expected: number[] = [];
      do {
        const byte = Number(exact & 0x7fn);
        exact >>= 7n;
        expected.push(byte | (exact > 0n ? 0x80 : 0));
      } while (exact > 0n);
      expect(encoded).toEqual(Uint8Array.from(expected));
      const reader = new ByteReader(
        Uint8Array.of(77, ...encoded, 88).subarray(1, encoded.length + 1),
      );
      expect(reader.varint()).toBe(value);
      expect(() => reader.end()).not.toThrow();
    }
  });

  it('agrees with exact arithmetic for deterministic random byte strings', () => {
    const random = randomSource(0xbadc0de);
    for (let i = 0; i < 512; i++) {
      const bytes = Uint8Array.from({ length: i % 11 }, () => random() >>> 24);
      let exact = 0n;
      let terminal = -1;
      for (let k = 0; k < Math.min(bytes.length, 8); k++) {
        exact += BigInt(bytes[k] & 0x7f) << BigInt(7 * k);
        if (!(bytes[k] & 0x80)) {
          terminal = k;
          break;
        }
      }
      const reader = new ByteReader(bytes);
      if (terminal < 0 || exact > BigInt(Number.MAX_SAFE_INTEGER)) {
        expect(() => reader.varint()).toThrow(DecodeError);
      } else {
        expect(reader.varint()).toBe(Number(exact));
        expect(reader.offset).toBe(terminal + 1);
        expect(reader.remaining).toBe(bytes.length - terminal - 1);
      }
    }
  });
});

describe('base64 compatibility at byte boundaries', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('preserves the base64 vector %s', (plain, encoded) => {
    const bytes = Uint8Array.from(plain, (char) => char.charCodeAt(0));
    expect(toBase64(bytes)).toBe(encoded);
    expect(fromBase64(encoded)).toEqual(bytes);
  });

  it('round-trips deterministic byte subarrays across padding and growth boundaries', () => {
    const random = randomSource(0x64);
    for (let length = 0; length <= 256; length++) {
      const backing = Uint8Array.from({ length: length + 5 }, () => random() >>> 24);
      const bytes = backing.subarray(2, length + 2);
      const written = new ByteWriter(length % 4).bytes(bytes).finish();
      expect(written).toEqual(bytes);
      expect(fromBase64(toBase64(written))).toEqual(bytes);
    }
  });

  it('retains existing padding validation and tolerance of unused padding bits', () => {
    for (const text of ['a', 'abc', 'a===', '=AAA', 'AA=A', 'AAAA====', 'AA-_', 'AA A']) {
      expect(() => fromBase64(text)).toThrow(DecodeError);
    }
    expect(fromBase64('Zh==')).toEqual(Uint8Array.of(102));
    expect(fromBase64('Zm9=')).toEqual(Uint8Array.of(102, 111));
  });
});
