import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS, TELEMETRY_STRIDE, telemetryCsv } from '../src/storage/telemetry-schema.ts';

const MIME = 'text/csv;charset=utf-8';
const NativeBlob = globalThis.Blob;

function valuesFor(count: number) {
  const values = new Float32Array(count * TELEMETRY_STRIDE);
  for (let index = 0; index < values.length; index++) values[index] = (index % 8191) / 37 - 100;
  // Preserve JavaScript's number spelling, including Float32 extremes and -0.
  const spellings = [0, -0, 1 / 3, 1e-7, 1e21, 3.4028234663852886e38, 1.401298464324817e-45];
  for (let row = 0; row < count; row++) values.set(spellings, row * TELEMETRY_STRIDE);
  return values;
}

/** No chunk boundaries in the reference: one ordinary row per input record. */
function expectedCsv(values: Float32Array) {
  const lines = [CHANNELS.join(',')];
  for (let offset = 0; offset < values.length; offset += TELEMETRY_STRIDE)
    lines.push(Array.from(values.subarray(offset, offset + TELEMETRY_STRIDE)).join(','));
  return lines.join('\n') + '\n';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telemetry CSV chunk storage', () => {
  it.each([0, 1, 499, 500, 501, 999, 1000, 1001])(
    'preserves every byte and line ending for %i rows',
    async (count) => {
      const values = valuesFor(count);
      const input = new Uint8Array(values.buffer).slice();
      const blob = telemetryCsv(values, count);
      const expected = new TextEncoder().encode(expectedCsv(values));
      expect(blob.type).toBe(MIME);
      expect(blob.size).toBe(expected.length);
      expect(Buffer.compare(Buffer.from(await blob.arrayBuffer()), expected)).toBe(0);
      expect(Buffer.compare(Buffer.from(values.buffer), input)).toBe(0);
    },
  );

  it('owns completed CSV bytes without retaining the full export as strings', async () => {
    const assemblies: { stringCodeUnits: number }[] = [];
    vi.stubGlobal(
      'Blob',
      class ObservedBlob extends NativeBlob {
        constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
          // Retain scalar observations only, never the strings or Blob parts.
          const stringCodeUnits = parts.reduce(
            (sum, part) => sum + (typeof part === 'string' ? part.length : 0),
            0,
          );
          super(parts, options);
          if (options?.type === MIME) assemblies.push({ stringCodeUnits });
        }
      },
    );
    const count = 1001;
    // A valid view may have unrelated malformed sentinels outside its range.
    const backing = new Float32Array((count + 2) * TELEMETRY_STRIDE).fill(NaN);
    const values = backing.subarray(TELEMETRY_STRIDE, (count + 1) * TELEMETRY_STRIDE);
    values.set(valuesFor(count));
    const expected = expectedCsv(values);
    const blob = telemetryCsv(values, count);
    vi.unstubAllGlobals();
    expect(assemblies).toHaveLength(1);
    const headerBytes = new TextEncoder().encode(CHANNELS.join(',') + '\n').length;
    expect(assemblies[0].stringCodeUnits).toBeLessThanOrEqual(headerBytes);

    // Neither source mutation nor transfer can change the completed export.
    values.fill(Infinity);
    structuredClone(backing, { transfer: [backing.buffer] });
    expect(values.byteLength).toBe(0);
    expect(await blob.text()).toBe(expected);
    expect(await structuredClone(blob).text()).toBe(expected);
  });

  it.each([
    { count: -1, length: 0 },
    { count: 0.5, length: 0 },
    { count: NaN, length: 0 },
    { count: Infinity, length: 0 },
    { count: Number.MAX_SAFE_INTEGER + 1, length: 0 },
    { count: 0, length: TELEMETRY_STRIDE },
    { count: 1, length: 0 },
    { count: 1, length: TELEMETRY_STRIDE - 1 },
    { count: 1, length: TELEMETRY_STRIDE + 1 },
  ])('rejects shape $count / $length before constructing output', ({ count, length }) => {
    const constructed = vi.fn();
    vi.stubGlobal(
      'Blob',
      class ObservedBlob extends NativeBlob {
        constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
          super(parts, options);
          constructed();
        }
      },
    );
    expect(() => telemetryCsv(new Float32Array(length), count)).toThrow(
      'Invalid telemetry export shape',
    );
    expect(constructed).not.toHaveBeenCalled();
  });

  it.each([
    { row: 499, field: TELEMETRY_STRIDE - 1, value: NaN },
    { row: 500, field: 0, value: Infinity },
    { row: 1000, field: TELEMETRY_STRIDE - 1, value: -Infinity },
  ])(
    'rejects a malformed value at row $row without publishing partial CSV',
    ({ row, field, value }) => {
      const published = vi.fn();
      vi.stubGlobal(
        'Blob',
        class ObservedBlob extends NativeBlob {
          constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
            super(parts, options);
            if (options?.type === MIME) published();
          }
        },
      );
      const values = valuesFor(1001);
      values[row * TELEMETRY_STRIDE + field] = value;
      expect(() => telemetryCsv(values, 1001)).toThrow(
        `Non-finite telemetry at row ${row}, channel ${CHANNELS[field]}`,
      );
      expect(published).not.toHaveBeenCalled();
      // A failed call must not leave partial chunks in the next export.
      const recovered = telemetryCsv(new Float32Array(0), 0);
      expect(recovered.type).toBe(MIME);
      expect(recovered.size).toBe(new TextEncoder().encode(CHANNELS.join(',') + '\n').length);
      expect(published).toHaveBeenCalledTimes(1);
    },
  );
});
