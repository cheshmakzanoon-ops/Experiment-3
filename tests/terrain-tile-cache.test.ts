import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  gridHeight,
  TerrainTileCache,
  TILE_RES,
  TILE_SIZE,
  TILE_STEP,
  type TerrainCarver,
} from '../src/simulation/open-world/terrain-tiles.ts';

function heightsAt(x0: number, z0: number, step: number, res: number) {
  const side = res + 1;
  return Float32Array.from({ length: side * side }, (_, index) => {
    const x = x0 + (index % side) * step;
    const z = z0 + Math.floor(index / side) * step;
    return Math.sin(x / 91) * 7 + Math.cos(z / 67) * 11;
  });
}

function fixture(budget = 4) {
  const build = vi.fn((x0: number, z0: number, step: number, res: number) => ({
    heights: heightsAt(x0, z0, step, res),
    road: new Float32Array((res + 1) ** 2),
    distance: new Float32Array((res + 1) ** 2),
  }));
  const carver = { build } as unknown as TerrainCarver;
  return { cache: new TerrainTileCache(carver, budget), build, carver };
}

const center = (index: number) => (index + 0.5) * TILE_SIZE;

beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('terrain tile cache residency and scheduling', () => {
  it.each([0, -1, -Infinity, Infinity, NaN, 0.5, 2.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid residency budget %s before any terrain is generated',
    (budget) => {
      const { carver, build } = fixture();
      expect(() => new TerrainTileCache(carver, budget)).toThrow(RangeError);
      expect(build).not.toHaveBeenCalled();
    },
  );

  it('refreshes a repeated sample after prefetch changes the most recent tile', () => {
    const { cache, build } = fixture(2);
    const height = cache.height(center(0), center(0));
    cache.want(center(1), center(0), 0, 0);
    cache.prefetch(1);
    expect(cache.height(center(0), center(0))).toBe(height);

    cache.height(center(2), center(0));

    expect(cache.has(center(0), center(0))).toBe(true);
    expect(cache.has(center(1), center(0))).toBe(false);
    expect(cache.has(center(2), center(0))).toBe(true);
    expect(cache.height(center(0), center(0))).toBe(height);
    expect(build).toHaveBeenCalledTimes(3);
    expect(cache.stats).toMatchObject({ resident: 2, peakResident: 2, evicted: 1, stalls: 2 });
  });

  it('removes synchronous misses from pending work before they can be evicted', () => {
    const { cache, build } = fixture(1);
    cache.want(center(0), center(0), 0, 0);
    expect(cache.queuedCount).toBe(1);
    cache.height(center(0), center(0));
    expect(cache.queuedCount).toBe(0);
    cache.height(center(1), center(0));
    cache.prefetch(1);

    expect(cache.has(center(1), center(0))).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.stats.prefetched).toBe(0);
  });

  it('bounds delayed requests and retains the newest requested areas', () => {
    const { cache, build } = fixture(4);
    for (let index = 0; index < 100; index++) {
      cache.want(center(index), center(0), 0, 0);
      expect(cache.queuedCount).toBeLessThanOrEqual(cache.budget);
    }
    cache.prefetch(1);

    expect(build.mock.calls.map(([x0]) => x0)).toEqual([99, 98, 97, 96].map((i) => i * TILE_SIZE));
    expect(cache.queuedCount).toBe(0);
    expect(cache.stats).toMatchObject({ resident: 4, peakResident: 4, generated: 4, prefetched: 4 });
  });

  it('starts the latest requested area before older pending work', () => {
    const { cache, build } = fixture(4);
    cache.want(center(0), center(0), 0, 0);
    cache.want(center(1), center(0), 0, 0);
    cache.want(center(2), center(0), 0, 0);
    let now = 0;
    vi.mocked(performance.now).mockImplementation(() => now++);
    cache.prefetch(2);

    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][0]).toBe(2 * TILE_SIZE);
    expect(cache.queuedCount).toBe(2);
  });

  it('keeps the current tile ahead of neighbours and lookahead under a tight budget', () => {
    const { cache, build } = fixture(1);
    cache.want(TILE_SIZE + 1, TILE_SIZE + 1, TILE_SIZE, 0);
    cache.prefetch(1);

    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0].slice(0, 2)).toEqual([TILE_SIZE, TILE_SIZE]);
    expect(cache.has(TILE_SIZE + 1, TILE_SIZE + 1)).toBe(true);
  });

  it('generates one tile for a positive budget even when checking the clock consumes it', () => {
    const { cache, build } = fixture();
    cache.want(center(0), center(0), 0, 0);
    cache.want(center(1), center(0), 0, 0);
    let now = 0;
    vi.mocked(performance.now).mockImplementation(() => now++);
    cache.prefetch(0.01);

    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.queuedCount).toBe(1);
    expect(cache.stats.prefetched).toBe(1);
  });

  it.each([0, -1, -Infinity, NaN])('does no prefetch work for time budget %s', (budgetMs) => {
    const { cache, build } = fixture();
    cache.want(center(0), center(0), 0, 0);
    cache.prefetch(budgetMs);
    expect(build).not.toHaveBeenCalled();
    expect(cache.queuedCount).toBe(1);
  });

  it('deduplicates requests and clears residency, pending work, and the sample fast path', () => {
    const { cache, build } = fixture();
    for (let index = 0; index < 10; index++) cache.want(center(0), center(0), 0, 0);
    expect(cache.queuedCount).toBe(1);
    const height = cache.height(center(0), center(0));
    cache.want(center(1), center(0), 0, 0);
    cache.clear();

    expect(cache.queuedCount).toBe(0);
    expect(cache.stats.resident).toBe(0);
    expect(cache.has(center(0), center(0))).toBe(false);
    cache.prefetch(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.height(center(0), center(0))).toBe(height);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('preserves exact grid heights and normals through prefetch, eviction, and regeneration', () => {
    const { cache } = fixture(2);
    const points = [
      [3.25, 8.75],
      [-0.25, -3.75],
      [TILE_SIZE, -TILE_SIZE],
      [TILE_SIZE + 3, TILE_SIZE + 1],
      [3.25, 8.75],
    ];
    for (const [x, z] of points) {
      const x0 = Math.floor(x / TILE_SIZE) * TILE_SIZE;
      const z0 = Math.floor(z / TILE_SIZE) * TILE_SIZE;
      const expectedNormal = { x: 0, y: 0, z: 0 };
      const expected = gridHeight(
        heightsAt(x0, z0, TILE_STEP, TILE_RES),
        TILE_RES + 1,
        (x - x0) / TILE_STEP,
        (z - z0) / TILE_STEP,
        TILE_STEP,
        expectedNormal,
      );
      cache.want(x, z, 0, 0);
      cache.prefetch(1);
      const normal = { x: 0, y: 0, z: 0 };
      expect(cache.height(x, z, normal)).toBe(expected);
      expect(normal).toEqual(expectedNormal);
      expect(cache.stats.resident).toBeLessThanOrEqual(cache.budget);
    }
    expect(cache.stats.evicted).toBeGreaterThan(0);
  });
});
