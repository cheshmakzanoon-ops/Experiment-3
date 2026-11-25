import { describe, expect, it } from 'vitest';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { FIGURE_EIGHT_OVERPASS } from '../src/simulation/test-venues.ts';
import { TrackLaneIndex } from '../src/simulation/track-lane-index.ts';
import { ROUTE_LAYER_GAP, Track, trackPoint } from '../src/simulation/track.ts';

// Test access to the existing constructor choice lets the oracle execute the
// original production nearest() path, including its layer/banking decisions.
const laneOwner = (track: Track) => track as unknown as { laneIndex: TrackLaneIndex | null };
const indexState = (index: TrackLaneIndex) =>
  index as unknown as {
    capacity: number;
    cells: Map<string, { segments: readonly number[]; witness: number }>;
  };

function pavedIndex(track: Track) {
  const index = laneOwner(track).laneIndex;
  expect(index).toBeInstanceOf(TrackLaneIndex);
  expect(indexState(index!).capacity).toBe(2048);
  return index!;
}

function exactQueries(track: Track, index: TrackLaneIndex) {
  const expected = trackPoint();
  const observed = trackPoint();
  return (x: number, z: number, height?: number) => {
    const owner = laneOwner(track);
    let lateral: number;
    try {
      owner.laneIndex = null;
      lateral = track.nearest(x, z, expected, height);
    } finally {
      owner.laneIndex = index;
    }
    expect(track.nearest(x, z, observed, height)).toBe(lateral);
    // Compare every Float64 TrackPoint field, rather than a station tolerance.
    expect(observed).toStrictEqual(expected);
    return observed;
  };
}

describe('bounded paved lane candidates', () => {
  it.each(['aurel', 'vellamar', 'speedbowl', 'dockyard', 'dockyard-reverse', 'poggio-alto'])(
    '%s exactly matches coarse search at offsets, signed cell boundaries and the lap seam',
    (id) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id));
      const index = pavedIndex(track);
      const check = exactQueries(track, index);
      let coarseTests = 0;
      let localTests = 0;
      let negativeQueries = 0;
      for (let i = 0; i < track.points.length; i += 3) {
        const p = track.points[i];
        for (const lateral of [-24, -p.width, -0.00001, 0, p.width, 24]) {
          const x = p.x + p.nx * lateral;
          const z = p.z + p.nz * lateral;
          const coarse = track.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
          for (const height of [undefined, p.y + p.bank * lateral + 0.5, p.y + 8]) {
            check(x, z, height);
            if (x < 0 || z < 0) negativeQueries++;
            if (coarse) {
              coarseTests += coarse.length;
              localTests += index.candidates(x, z, coarse, height, ROUTE_LAYER_GAP).length;
            }
          }
        }
        for (const cell of [4, 32])
          for (const epsilon of [-1e-7, 0, 1e-7])
            check(
              cell * Math.floor(p.x / cell) + epsilon,
              cell * Math.floor(p.z / cell) - epsilon,
              p.y,
            );
      }
      for (const station of [
        -1e-7,
        0,
        1e-7,
        track.length - 1e-7,
        track.length,
        track.length + 1e-7,
      ]) {
        const p = track.at(station, trackPoint());
        for (const height of [undefined, p.y + 0.5, p.y + 8]) check(p.x, p.z, height);
      }
      const p = track.points[0];
      for (const height of [NaN, Infinity, -Infinity]) check(p.x, p.z, height);
      expect(negativeQueries).toBeGreaterThan(0);
      expect(localTests).toBeLessThan(coarseTests);
      expect(indexState(index).cells.size).toBeLessThanOrEqual(2048);

      // Outside the original coarse hash, nearest() still scans all segments
      // without populating the lane cache or inventing a search radius.
      const before = indexState(index).cells.size;
      expect(track.hash.has('3125,-3125')).toBe(false);
      for (const height of [undefined, 0, 100]) check(1e5, -1e5, height);
      expect(indexState(index).cells.size).toBe(before);
    },
  );

  it('retains both overpass decks and the original fallback when no deck is eligible', () => {
    const track = new Track('clear', false, undefined, FIGURE_EIGHT_OVERPASS);
    const index = pavedIndex(track);
    const check = exactQueries(track, index);
    const coarse = track.hash.get('0,0')!;
    for (const height of [undefined, 0.5, 4, 4.5, 9.5, 100])
      for (const epsilon of [-1e-7, 0, 1e-7]) check(epsilon, -epsilon, height);
    const lower = check(0, 0, 0.5).s;
    const upper = check(0, 0, 9.5).s;
    expect(Math.min(lower, track.length - lower)).toBeLessThan(2);
    expect(Math.abs(upper - track.length / 2)).toBeLessThan(2);
    expect(index.candidates(0, 0, coarse, 100, ROUTE_LAYER_GAP)).toBe(coarse);

    const witness = indexState(index).cells.get('0,0')!.witness;
    const boundary =
      Math.max(track.points[witness].y, track.points[witness + 1].y) + ROUTE_LAYER_GAP;
    for (const height of [boundary - 0.5e-7, boundary, boundary + 1e-7]) {
      expect(index.candidates(0, 0, coarse, height, ROUTE_LAYER_GAP)).toBe(coarse);
      check(0, 0, height);
    }
  });

  it('keeps the original bank-aware layer search high on the speedbowl', () => {
    const track = new Track('clear', false, undefined, circuitDefinition('speedbowl'));
    const index = pavedIndex(track);
    const check = exactQueries(track, index);
    const p = track.at(track.circuit.corners[0].s, trackPoint());
    const lateral = 9;
    const x = p.x + p.nx * lateral;
    const z = p.z + p.nz * lateral;
    const height = p.y + p.bank * lateral + 0.4;
    expect(height - p.y).toBeGreaterThan(ROUTE_LAYER_GAP);
    const coarse = track.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`)!;
    expect(index.candidates(x, z, coarse, height, ROUTE_LAYER_GAP)).toBe(coarse);
    expect(Math.abs(check(x, z, height).s - p.s)).toBeLessThan(2);
  });

  it.each(['aurel', 'speedbowl'])(
    '%s evicts at the production capacity and rebuilds exact candidates on revisit',
    (id) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id));
      const index = pavedIndex(track);
      const state = indexState(index);
      const check = exactQueries(track, index);
      const queries: [number, number][] = [];
      for (const key of track.hash.keys()) {
        const [hx, hz] = key.split(',').map(Number);
        for (let ix = 0; ix < 8; ix++)
          for (let iz = 0; iz < 8; iz++) queries.push([hx * 32 + ix * 4 + 2, hz * 32 + iz * 4 + 2]);
        if (queries.length >= 2050) break;
      }
      const [x, z] = queries[0];
      const key = `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
      check(x, z);
      const first = state.cells.get(key)!;
      check(x, z);
      expect(state.cells.get(key)).toBe(first);
      for (const [x, z] of queries.slice(1, 2050)) {
        check(x, z);
        expect(state.cells.size).toBeLessThanOrEqual(2048);
      }
      expect(state.cells.size).toBe(2048);
      expect(state.cells.has(key)).toBe(false);
      check(x, z);
      expect(state.cells.size).toBe(2048);
      expect(state.cells.get(key)).not.toBe(first);
      expect(state.cells.get(key)).toStrictEqual(first);
    },
  );

  it('retains the original candidate order for exact equal-distance segments', () => {
    const points = [
      { x: -2, z: 0 },
      { x: 6, z: 0 },
      { x: -2, z: 4 },
      { x: 6, z: 4 },
      { x: 80, z: 80 },
      { x: 84, z: 84 },
    ].map((p) => ({ ...trackPoint(), ...p }));
    for (const coarse of [
      [2, 4, 0],
      [0, 4, 2],
    ]) {
      const index = new TrackLaneIndex(points, 2048);
      // At (2,2), segments 0 and 2 are both exactly two metres away.
      const local = index.candidates(2, 2, coarse);
      expect(local).toEqual(coarse.filter((i) => i !== 4));
      expect(index.candidates(2, 2, coarse)).toBe(local);
    }
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx', 'kestrel-rx', 'pinewood-stage'])(
    '%s retains its existing off-road index selection',
    (id) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id));
      const index = laneOwner(track).laneIndex;
      if (
        track.circuit.offroad!.kind === 'motocross' ||
        track.circuit.offroad!.kind === 'supercross'
      ) {
        expect(index).toBeInstanceOf(TrackLaneIndex);
        expect(indexState(index!).capacity).toBe(Infinity);
      } else expect(index).toBeNull();
    },
  );
});
