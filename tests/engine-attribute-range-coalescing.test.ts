import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { markAll, markItems } from '../src/rendering/attribute-ranges.ts';

type Range = { start: number; count: number };
type Mark = readonly [number, number] | 'all';

function bytes(array: T.TypedArray) {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function expectSameBytes(actual: T.TypedArray, expected: T.TypedArray) {
  expect(
    Buffer.compare(
      Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
    ),
  ).toBe(0);
}

/** The installed Three uploader calls this GL shim; it copies the exact byte
 * windows passed to bufferSubData into a separate buffer, without emulating
 * Three's range merging or version checks. This is not a native GPU test. */
function recordingUpload(attribute: T.BufferAttribute) {
  const transfers: { offset: number; length: number }[] = [];
  let mirror = new Uint8Array(0);
  const gl = {
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    UNSIGNED_BYTE: 0x1401,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: (_target: number, array: T.TypedArray) => {
      mirror = bytes(array).slice();
    },
    bufferSubData: (
      _target: number,
      offset: number,
      array: T.TypedArray,
      first = 0,
      count = array.length - first,
    ) => {
      const length = count * array.BYTES_PER_ELEMENT;
      transfers.push({ offset, length });
      mirror.set(
        new Uint8Array(array.buffer, array.byteOffset + first * array.BYTES_PER_ELEMENT, length),
        offset,
      );
    },
  };
  const uploader = new WebGLAttributes(gl as unknown as WebGL2RenderingContext);
  const upload = () => uploader.update(attribute, gl.ARRAY_BUFFER);
  upload(); // Allocate initial storage before measuring subsequent transfers.
  return { upload, mirror, transfers };
}

/** A component bitset provides an independent union oracle. */
function spans(dirty: Uint8Array): Range[] {
  const result: Range[] = [];
  for (let component = 0; component < dirty.length; component++) {
    if (!dirty[component]) continue;
    const start = component;
    while (component + 1 < dirty.length && dirty[component + 1]) component++;
    result.push({ start, count: component - start + 1 });
  }
  return result;
}

function appendOnlyMark(attribute: T.BufferAttribute, first: number, last: number) {
  if (last < first) return;
  if (attribute.updateRanges.length >= 16) markAll(attribute);
  else {
    attribute.addUpdateRange(first * attribute.itemSize, (last - first + 1) * attribute.itemSize);
    attribute.needsUpdate = true;
  }
}

describe('bounded pending component unions', () => {
  it.each([1, 2, 3, 4, 16])('converts inclusive boundary items at item size %i', (itemSize) => {
    const array = Float32Array.from({ length: 8 * itemSize }, (_, i) => i + 0.25);
    const attribute = new T.BufferAttribute(array, itemSize);
    const before = array.slice();
    markItems(attribute, 7, 7);
    markItems(attribute, 0, 0);
    expect(attribute.updateRanges).toEqual([
      { start: 0, count: itemSize },
      { start: 7 * itemSize, count: itemSize },
    ]);
    expect(attribute.version).toBe(2);
    expect(array).toEqual(before);
  });

  it.each<{ name: string; marks: [number, number][]; expected: Range[] }>([
    {
      name: 'duplicates',
      marks: [
        [4, 7],
        [4, 7],
      ],
      expected: [{ start: 4, count: 4 }],
    },
    {
      name: 'contained spans',
      marks: [
        [4, 9],
        [5, 6],
      ],
      expected: [{ start: 4, count: 6 }],
    },
    {
      name: 'enclosing spans',
      marks: [
        [5, 6],
        [4, 9],
      ],
      expected: [{ start: 4, count: 6 }],
    },
    {
      name: 'overlap',
      marks: [
        [4, 7],
        [6, 9],
      ],
      expected: [{ start: 4, count: 6 }],
    },
    {
      name: 'adjacency from the right',
      marks: [
        [4, 7],
        [8, 9],
      ],
      expected: [{ start: 4, count: 6 }],
    },
    {
      name: 'adjacency from the left',
      marks: [
        [8, 9],
        [4, 7],
      ],
      expected: [{ start: 4, count: 6 }],
    },
    {
      name: 'bridges',
      marks: [
        [12, 15],
        [4, 7],
        [8, 11],
      ],
      expected: [{ start: 4, count: 12 }],
    },
    {
      name: 'multiple bridges',
      marks: [
        [20, 23],
        [4, 7],
        [12, 15],
        [8, 19],
      ],
      expected: [{ start: 4, count: 20 }],
    },
    {
      name: 'a clean component gap',
      marks: [
        [4, 7],
        [9, 10],
      ],
      expected: [
        { start: 4, count: 4 },
        { start: 9, count: 2 },
      ],
    },
  ])('preserves the exact union for $name', ({ marks, expected }) => {
    const attribute = new T.BufferAttribute(new Float32Array(64), 1);
    for (const [first, last] of marks) markItems(attribute, first, last);
    expect(attribute.updateRanges).toEqual(expected);
    expect(attribute.version).toBe(marks.length);
  });

  it('normalizes unordered component ranges from Three before applying the budget', () => {
    const attribute = new T.BufferAttribute(new Float32Array(192), 3);
    for (let repeat = 0; repeat < 4; repeat++) {
      attribute.addUpdateRange(30, 3);
      attribute.addUpdateRange(12, 3);
      attribute.addUpdateRange(1, 2);
      attribute.addUpdateRange(9, 3);
    }
    markItems(attribute, 7, 7);
    expect(attribute.updateRanges).toEqual([
      { start: 1, count: 2 },
      { start: 9, count: 6 },
      { start: 21, count: 3 },
      { start: 30, count: 3 },
    ]);
    expect(attribute.version).toBe(1);
  });

  it('retains 16 disjoint spans and falls back only for the seventeenth disjoint span', () => {
    const attribute = new T.BufferAttribute(new Float32Array(256 * 3), 3);
    for (let i = 0; i < 16; i++) {
      markItems(attribute, i * 3, i * 3);
      expect(attribute.updateRanges).toHaveLength(i + 1);
    }
    markItems(attribute, 45, 45); // A duplicate at capacity must not trigger fallback.
    expect(attribute.updateRanges).toHaveLength(16);
    markItems(attribute, 48, 48);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: attribute.array.length }]);
    markItems(attribute, 100, 100);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: attribute.array.length }]);
    expect(attribute.version).toBe(19);
  });

  it('merges a bridge at the budget boundary without allocating a seventeenth entry', () => {
    const attribute = new T.BufferAttribute(new Float32Array(256), 1);
    for (let i = 15; i >= 0; i--) markItems(attribute, i * 3, i * 3);
    markItems(attribute, 1, 44);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 46 }]);
    expect(attribute.version).toBe(17);
  });

  it('keeps full marks sticky, including full after partial and repeated full marks', () => {
    const attribute = new T.BufferAttribute(new Float32Array(24), 3);
    markItems(attribute, 2, 3);
    markAll(attribute);
    for (let i = 0; i < 40; i++) markItems(attribute, 2, 3);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 24 }]);
    expect(attribute.version).toBe(42);
    markAll(attribute);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 24 }]);
    expect(attribute.version).toBe(43);
  });

  it('leaves empty spans untouched before, between, and after full marks', () => {
    const attribute = new T.BufferAttribute(new Float32Array(24), 3);
    const emptyMarks = () => {
      const ranges = attribute.updateRanges.map((range) => ({ ...range }));
      const version = attribute.version;
      for (const [first, last] of [
        [0, -1],
        [8, 7],
        [Infinity, -Infinity],
      ])
        markItems(attribute, first, last);
      expect(attribute.updateRanges).toEqual(ranges);
      expect(attribute.version).toBe(version);
    };
    emptyMarks();
    markItems(attribute, 0, 0);
    emptyMarks();
    markAll(attribute);
    emptyMarks();
    const emptyAttribute = new T.BufferAttribute(new Float32Array(0), 3);
    markItems(emptyAttribute, 0, -1);
    expect(emptyAttribute.version).toBe(0);
    markAll(emptyAttribute);
    expect(emptyAttribute.updateRanges).toEqual([{ start: 0, count: 0 }]);
    expect(emptyAttribute.version).toBe(1);
  });
});

describe('actual Three WebGLAttributes transfers', () => {
  it.each([16, 17, 1000])('uploads 48 bytes after %i duplicate vec3 marks', (marks) => {
    for (const marker of [markItems, appendOnlyMark]) {
      const attribute = new T.BufferAttribute(new Float32Array(4096 * 3), 3);
      const recording = recordingUpload(attribute);
      for (let i = 0; i < marks; i++) {
        attribute.array.fill(i + 1, 300, 312);
        marker(attribute, 100, 103);
      }
      expect(attribute.version).toBe(marks);
      if (marker === markItems) expect(attribute.updateRanges).toEqual([{ start: 300, count: 12 }]);
      recording.upload();
      const expectedBytes = marker === appendOnlyMark && marks > 16 ? 49152 : 48;
      expect(recording.transfers).toEqual([
        { offset: expectedBytes === 48 ? 1200 : 0, length: expectedBytes },
      ]);
      expectSameBytes(recording.mirror, attribute.array);
      expect(attribute.updateRanges).toEqual([]);
    }
  });

  it('uploads 16 separate vec3 spans and a full buffer for 17 separate spans', () => {
    for (const marks of [16, 17]) {
      const attribute = new T.BufferAttribute(new Float32Array(256 * 3), 3);
      const recording = recordingUpload(attribute);
      for (let i = 0; i < marks; i++) {
        attribute.array[i * 9] = i + 1;
        markItems(attribute, i * 3, i * 3);
      }
      recording.upload();
      expect(recording.transfers).toHaveLength(marks === 16 ? 16 : 1);
      expect(recording.transfers.reduce((sum, transfer) => sum + transfer.length, 0)).toBe(
        marks === 16 ? 192 : 3072,
      );
      expectSameBytes(recording.mirror, attribute.array);
      expect(attribute.updateRanges).toEqual([]);
      expect(attribute.version).toBe(marks);
    }
  });

  it('clears full stickiness after upload and performs no transfer for an empty mark', () => {
    const attribute = new T.BufferAttribute(new Float32Array(96), 3);
    const recording = recordingUpload(attribute);
    attribute.array.fill(7);
    markAll(attribute);
    markItems(attribute, 0, 0);
    recording.upload();
    expect(recording.transfers).toEqual([{ offset: 0, length: 384 }]);
    expect(attribute.updateRanges).toEqual([]);
    attribute.array.fill(9, 30, 33);
    markItems(attribute, 10, 10);
    expect(attribute.updateRanges).toEqual([{ start: 30, count: 3 }]);
    recording.upload();
    markItems(attribute, 0, -1);
    recording.upload();
    expect(recording.transfers).toEqual([
      { offset: 0, length: 384 },
      { offset: 120, length: 12 },
    ]);
    expectSameBytes(recording.mirror, attribute.array);
    expect(attribute.version).toBe(3);
  });

  it.each([Uint8Array, Uint16Array, Float32Array])(
    'respects typed-array byte widths and view offsets for %s',
    (ArrayType) => {
      const storage = new ArrayType(78);
      storage.fill(11);
      const array = storage.subarray(3, 75);
      const attribute = new T.BufferAttribute(array, 3);
      const recording = recordingUpload(attribute);
      array.fill(29, 6, 12);
      markItems(attribute, 2, 3);
      recording.upload();
      expect(recording.transfers).toEqual([
        { offset: 6 * array.BYTES_PER_ELEMENT, length: 6 * array.BYTES_PER_ELEMENT },
      ]);
      expectSameBytes(recording.mirror, array);
      expect(Array.from(storage.subarray(0, 3))).toEqual([11, 11, 11]);
      expect(Array.from(storage.subarray(75))).toEqual([11, 11, 11]);
    },
  );

  it.each([1, 2, 3, 4, 16])(
    'matches a component union and uploaded byte oracle at item size %i',
    (itemSize) => {
      const array = new Float32Array(128 * itemSize);
      const reference = array.slice();
      const dirty = new Uint8Array(array.length);
      const attribute = new T.BufferAttribute(array, itemSize);
      const recording = recordingUpload(attribute);
      let seed = 0x10203040 + itemSize;
      const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
      let operation = 0;
      let version = 0;
      let previousFirst = 0;
      // Four cycles through five intervals: 640 marks and 20 uploads per item size.
      for (let cycle = 0; cycle < 4; cycle++) {
        for (const deferredMarks of [1, 2, 17, 43, 97]) {
          for (let i = 0; i < deferredMarks; i++, operation++) {
            if (operation % 61 === 0) {
              const value = random() % 65536;
              array.fill(value);
              reference.fill(value);
              const before = bytes(array).slice();
              markAll(attribute);
              expectSameBytes(array, before);
              dirty.fill(1);
              version++;
            } else {
              const first = operation % 5 === 0 ? previousFirst : random() % 128;
              const last = operation % 29 === 0 ? first - 1 : Math.min(127, first + (random() % 8));
              previousFirst = first;
              if (last >= first) {
                const value = random() % 65536;
                array.fill(value, first * itemSize, (last + 1) * itemSize);
                reference.fill(value, first * itemSize, (last + 1) * itemSize);
                dirty.fill(1, first * itemSize, (last + 1) * itemSize);
                if (spans(dirty).length > 16) dirty.fill(1);
                version++;
              }
              const before = bytes(array).slice();
              markItems(attribute, first, last);
              expectSameBytes(array, before);
            }
            expect(attribute.updateRanges).toEqual(spans(dirty));
            expect(attribute.updateRanges.length).toBeLessThanOrEqual(16);
            expect(attribute.version).toBe(version);
          }
          recording.upload();
          expectSameBytes(recording.mirror, reference);
          expect(attribute.updateRanges).toEqual([]);
          dirty.fill(0);
        }
      }
      expect(operation).toBe(640);
    },
  );

  it('compares transfer volume for five dirty-range workloads and optional warmed CPU timing', () => {
    const workloads: { name: string; marks: Mark[]; expectedBytes: number }[] = [
      { name: 'duplicate', marks: Array.from({ length: 17 }, () => [100, 103]), expectedBytes: 48 },
      {
        name: 'overlap',
        marks: Array.from({ length: 17 }, (_, i) => [100 + (i % 4), 103 + (i % 4)]),
        expectedBytes: 84,
      },
      {
        name: 'adjacent',
        marks: Array.from({ length: 17 }, (_, i) => [100 + i * 4, 103 + i * 4]),
        expectedBytes: 816,
      },
      {
        name: 'disjoint',
        marks: Array.from({ length: 17 }, (_, i) => [100 + i * 8, 103 + i * 8]),
        expectedBytes: 49152,
      },
      {
        name: 'full-dirty',
        marks: ['all', ...Array.from({ length: 16 }, (): Mark => [100, 103])],
        expectedBytes: 49152,
      },
    ];
    const metrics: {
      workload: string;
      implementation: string;
      bytes: number;
      nsPerMark?: number;
    }[] = [];
    for (const workload of workloads) {
      for (const marker of [appendOnlyMark, markItems]) {
        const attribute = new T.BufferAttribute(new Float32Array(4096 * 3), 3);
        const recording = recordingUpload(attribute);
        const batch = () => {
          attribute.clearUpdateRanges();
          for (const mark of workload.marks)
            if (mark === 'all') markAll(attribute);
            else marker(attribute, mark[0], mark[1]);
        };
        batch();
        recording.upload();
        const transferred = recording.transfers.reduce((sum, transfer) => sum + transfer.length, 0);
        expect(transferred).toBe(marker === markItems ? workload.expectedBytes : 49152);
        const metric = {
          workload: workload.name,
          implementation: marker === markItems ? 'coalesced' : 'append-only',
          bytes: transferred,
          nsPerMark: undefined as number | undefined,
        };
        if (process.env.ENGINE_ATTRIBUTE_RANGE_BENCH === '1') {
          for (let i = 0; i < 1000; i++) batch();
          const samples: number[] = [];
          for (let sample = 0; sample < 5; sample++) {
            const start = performance.now();
            for (let i = 0; i < 2000; i++) batch();
            samples.push(((performance.now() - start) * 1e6) / (2000 * workload.marks.length));
          }
          samples.sort((a, b) => a - b);
          metric.nsPerMark = Number(samples[2].toFixed(2));
        }
        metrics.push(metric);
      }
    }
    if (process.env.ENGINE_ATTRIBUTE_RANGE_BENCH === '1') console.log(JSON.stringify(metrics));
  });
});
