import { afterEach, describe, expect, it, vi } from 'vitest';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { FIGURE_EIGHT_OVERPASS } from '../src/simulation/test-venues.ts';
import { TrackLaneIndex } from '../src/simulation/track-lane-index.ts';
import { ROUTE_LAYER_GAP, Track, trackPoint, type TrackPoint } from '../src/simulation/track.ts';

afterEach(() => vi.restoreAllMocks());

const stateOf = (index: TrackLaneIndex) =>
  index as unknown as {
    capacity: number;
    cells: Map<string, { segments: readonly number[]; witness: number }>;
    fifoKeys: string[] | null;
    fifoCursor: number;
  };

// Construct the existing unbounded path, then supply its original eviction
// threshold. This executes the retained Map-iterator policy with the actual
// candidate builder, witness and height fallback; no geometry is copied.
function iteratorReference(points: readonly TrackPoint[], capacity: number) {
  const index = new TrackLaneIndex(points);
  stateOf(index).capacity = capacity;
  return index;
}

const keysOf = (index: TrackLaneIndex) => [...stateOf(index).cells].map(([key]) => key);

function expectBoundedKeys(index: TrackLaneIndex) {
  const state = stateOf(index);
  const keys = state.fifoKeys!;
  expect(keys.length).toBe(state.cells.size);
  expect(keys.length).toBeLessThanOrEqual(state.capacity);
  expect([...keys.slice(state.fifoCursor), ...keys.slice(0, state.fifoCursor)]).toEqual(
    keysOf(index),
  );
}

function actualQueries(track: Track, index: TrackLaneIndex, reference: TrackLaneIndex) {
  const owner = track as unknown as { laneIndex: TrackLaneIndex | null };
  const expected = trackPoint();
  const observed = trackPoint();
  return (x: number, z: number, height?: number) => {
    let expectedLateral: number;
    try {
      owner.laneIndex = reference;
      expectedLateral = track.nearest(x, z, expected, height);
    } finally {
      owner.laneIndex = index;
    }
    expect(track.nearest(x, z, observed, height)).toBe(expectedLateral);
    expect(observed).toStrictEqual(expected);
    const coarse = track.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
    if (coarse) {
      const actual = index.candidates(x, z, coarse, height, ROUTE_LAYER_GAP);
      const original = reference.candidates(x, z, coarse, height, ROUTE_LAYER_GAP);
      expect(actual).toStrictEqual(original);
      expect(actual === coarse).toBe(original === coarse);
      const key = `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
      expect(stateOf(index).cells.get(key)).toStrictEqual(stateOf(reference).cells.get(key));
    }
  };
}

function distinctCells(track: Track, count: number) {
  const queries: [number, number][] = [];
  for (const key of track.hash.keys()) {
    const [hx, hz] = key.split(',').map(Number);
    for (let ix = 0; ix < 8; ix++)
      for (let iz = 0; iz < 8; iz++) {
        queries.push([hx * 32 + ix * 4 + 2, hz * 32 + iz * 4 + 2]);
        if (queries.length === count) return queries;
      }
  }
  throw new Error(`Track has fewer than ${count} lane cells`);
}

describe('lane-cache FIFO eviction', () => {
  it.each([1, 2, 2048])(
    'matches iterator eviction and exact nearest fields through repeated cycles at capacity %s',
    (capacity) => {
      const track = new Track('clear', false, undefined, circuitDefinition('aurel'));
      const index = new TrackLaneIndex(track.points, capacity);
      const reference = iteratorReference(track.points, capacity);
      const actualKeys = vi.spyOn(stateOf(index).cells, 'keys');
      const originalKeys = vi.spyOn(stateOf(reference).cells, 'keys');
      const check = actualQueries(track, index, reference);
      const queries = distinctCells(track, Math.max(capacity * 2, 4));
      const heights = [undefined, 0.5, 9.5, 100, NaN, Infinity, -Infinity];
      let misses = 0;
      let firstCell: unknown;
      for (let cycle = 0; cycle < 2; cycle++) {
        for (const [i, [x, z]] of queries.entries()) {
          const key = `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
          if (!stateOf(index).cells.has(key)) misses++;
          check(x, z, heights[i % heights.length]);
          expect(stateOf(index).cells.size).toBeLessThanOrEqual(capacity);
          if (cycle === 0 && i === 0) firstCell = stateOf(index).cells.get(key);
          if (cycle === 1 && i === 0) {
            expect(stateOf(index).cells.get(key)).not.toBe(firstCell);
            expect(stateOf(index).cells.get(key)).toStrictEqual(firstCell);
          }
          // Small capacities check every transition; the production capacity
          // checks fill, wrap and end boundaries without quadratic assertions.
          if (capacity <= 2 || i === capacity - 1 || i === queries.length - 1) {
            expect([...stateOf(index).cells]).toStrictEqual([...stateOf(reference).cells]);
            expectBoundedKeys(index);
          }
        }
      }
      expect(misses).toBe(queries.length * 2);
      expect(stateOf(index).cells.size).toBe(capacity);
      expect(actualKeys).not.toHaveBeenCalled();
      expect(originalKeys).toHaveBeenCalledTimes(misses - capacity);
    },
  );

  it('keeps hit insertion order, replaces revisited entries and retains no evicted keys', () => {
    const points = [
      { x: -2, z: 0 },
      { x: 6, z: 0 },
      { x: -2, z: 4 },
      { x: 6, z: 4 },
      { x: 80, z: 80 },
      { x: 84, z: 84 },
    ].map((point) => ({ ...trackPoint(), ...point }));
    const coarse = [2, 4, 0];
    const index = new TrackLaneIndex(points, 2);
    const first = index.candidates(2, 2, coarse);
    expect(first).toEqual([2, 0]);
    index.candidates(6, 2, coarse);
    const beforeHit = [...stateOf(index).fifoKeys!];
    expect(index.candidates(2, 2, [0, 2])).toBe(first);
    expect(keysOf(index)).toEqual(['0,0', '1,0']);
    expect(stateOf(index).fifoKeys).toEqual(beforeHit);
    expect(stateOf(index).fifoCursor).toBe(0);
    index.candidates(10, 2, coarse);
    expect(keysOf(index)).toEqual(['1,0', '2,0']);
    expectBoundedKeys(index);
    const revisited = index.candidates(2, 2, [0, 2]);
    expect(revisited).not.toBe(first);
    expect(revisited).toEqual([0, 2]);
    expect(keysOf(index)).toEqual(['2,0', '0,0']);
    expectBoundedKeys(index);
  });

  it.each(['overpass', 'speedbowl'])(
    'retains exact %s candidates, witnesses and layer fallback across signed boundaries',
    (venue) => {
      const circuit = venue === 'overpass' ? FIGURE_EIGHT_OVERPASS : circuitDefinition('speedbowl');
      const track = new Track('clear', false, undefined, circuit);
      const index = new TrackLaneIndex(track.points, 2);
      const reference = iteratorReference(track.points, 2);
      const check = actualQueries(track, index, reference);
      for (const x of [-4 - 1e-7, -4, -4 + 1e-7, -1e-7, 0, 1e-7, 4])
        for (const z of [-32 - 1e-7, -32, -32 + 1e-7, -1e-7, 0, 1e-7]) {
          for (const height of [undefined, 0.5, 4 - 0.5e-7, 4, 4 + 1e-7, 9.5, 100])
            check(x, z, height);
          expect([...stateOf(index).cells]).toStrictEqual([...stateOf(reference).cells]);
          expectBoundedKeys(index);
        }
      const p = track.at(track.circuit.corners[0]?.s ?? 0, trackPoint());
      for (const lateral of [-9, 0, 9])
        check(p.x + p.nx * lateral, p.z + p.nz * lateral, p.y + p.bank * lateral + 0.4);
      check(0, 0, 9.5);
      check(0, 0, 0.5);
      expect([...stateOf(index).cells]).toStrictEqual([...stateOf(reference).cells]);
      expectBoundedKeys(index);
    },
  );

  it.each([Infinity, NaN, 0, -0, -1, -Infinity, 0.5, 1.5])(
    'preserves the existing capacity %s behavior without ring storage',
    (capacity) => {
      const points = [trackPoint(), { ...trackPoint(), x: 4 }];
      const index = new TrackLaneIndex(points, capacity);
      const reference = iteratorReference(points, capacity);
      for (let cycle = 0; cycle < 3; cycle++)
        for (const x of [0, 4, 8, 0, -4, 4, 12, -8]) {
          expect(index.candidates(x, 0, [0])).toStrictEqual(reference.candidates(x, 0, [0]));
          expect([...stateOf(index).cells]).toStrictEqual([...stateOf(reference).cells]);
          expect(stateOf(index).fifoKeys).toBeNull();
        }
      const expectedSize =
        capacity === Infinity || Number.isNaN(capacity) ? 6 : Math.max(1, Math.ceil(capacity));
      expect(stateOf(index).cells.size).toBe(expectedSize);
    },
  );

  it('grows a very large integral capacity lazily with resident entries', () => {
    const index = new TrackLaneIndex([trackPoint(), { ...trackPoint(), x: 4 }], 2 ** 40);
    expect(stateOf(index).fifoKeys).toEqual([]);
    for (const x of [0, 4, -4, 0]) {
      index.candidates(x, 0, [0]);
      expectBoundedKeys(index);
    }
    expect(stateOf(index).fifoKeys).toEqual(['0,0', '1,0', '-1,0']);
  });

  it('does not evict or advance the ring when building a missing cell fails', () => {
    const points = [trackPoint(), { ...trackPoint(), x: 4 }];
    const index = new TrackLaneIndex(points, 2);
    index.candidates(0, 0, [0]);
    index.candidates(4, 0, [0]);
    const before = [...stateOf(index).cells];
    expect(() => index.candidates(8, 0, [points.length])).toThrow(TypeError);
    expect([...stateOf(index).cells]).toStrictEqual(before);
    expectBoundedKeys(index);
    index.candidates(8, 0, [0]);
    expect(keysOf(index)).toEqual(['1,0', '2,0']);
    expectBoundedKeys(index);
  });
});
