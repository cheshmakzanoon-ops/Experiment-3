import { describe, expect, it } from 'vitest';
import { COURSE_CELL } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track } from '../src/simulation/track.ts';

describe.each(['valley-ridge-mx', 'arena-nord-sx'] as const)('%s tyre contact in ridden soil', id => {
  it('crosses a packed rut without a height or traction step and reproduces it after rewind', () => {
    const track = rigTrack(id), { terrain } = Track.offroadOf(track) as TrackTerrainSurface;
    const x = terrain.lateralMin + (Math.floor(terrain.columns / 2) + 0.5) * COURSE_CELL.lateral;
    const s = 45.25, step = COURSE_CELL.lateral;
    terrain.restore({
      cells: Uint32Array.of(terrain.cellIndex(x, s)),
      depth: Float32Array.of(0.12), compaction: Float32Array.of(0.8), sequence: 1,
    });
    const recorded = terrain.checkpoint(), before = terrain.hash();
    const mid = terrain.contact(x + step / 2, s);
    expect(mid.depth).toBeCloseTo(0.06, 6);
    expect(mid.compaction).toBeCloseTo(0.4, 6);
    expect(mid.height).toBeCloseTo(terrain.base(x + step / 2, s) - mid.depth, 8);
    for (const offset of [0, step / 2, step]) {
      const left = terrain.contact(x + offset - 1e-5, s);
      const right = terrain.contact(x + offset + 1e-5, s);
      expect(Math.abs(left.height - right.height)).toBeLessThan(0.00004);
      expect(Math.abs(left.grip - right.grip)).toBeLessThan(0.00008);
    }
    expect(terrain.hash()).toBe(before);
    terrain.reset();
    expect(terrain.depthAt(x, s)).toBe(0);
    terrain.restore(recorded);
    expect(terrain.contact(x + step / 2, s)).toEqual(mid);
  });

  it('moves the centre of deposited pressure continuously over the soil grid', () => {
    const track = rigTrack(id), { terrain } = Track.offroadOf(track) as TrackTerrainSurface;
    const stamp = (x: number, s: number) => {
      terrain.reset();
      terrain.deform(x, s, 750, 0.22, 1 / 120);
      const state = terrain.checkpoint();
      let total = 0, across = 0, along = 0;
      for (const [i, cell] of state.cells.entries()) {
        const weight = state.compaction[i];
        const col = cell % terrain.columns, row = Math.floor(cell / terrain.columns);
        const start = row * COURSE_CELL.along;
        let centre = (start + Math.min(track.length, start + COURSE_CELL.along)) / 2;
        if (centre - s > track.length / 2) centre -= track.length;
        if (s - centre > track.length / 2) centre += track.length;
        total += weight;
        across += weight * (terrain.lateralMin + (col + 0.5) * COURSE_CELL.lateral);
        along += weight * centre;
      }
      return { x: across / total, s: along / total, total, cells: state.cells.length };
    };
    // A road tyre entered on the same dirt venue keeps its calibrated wheel
    // footprint. A mixed class shares soil, while each tyre supplies its load.
    terrain.reset();
    terrain.deform(0.001, 60.501, 750, 0.22, 1 / 120, false);
    expect(terrain.checkpoint().cells).toHaveLength(3);
    const centre = stamp(0.125, 60.25);
    expect(centre.cells).toBe(3);
    for (const [x, s] of [[-0.001, 60.249], [0.001, 60.251], [0.125, 60.499],
      [0.125, 60.501], [0.033, 60.38], [0.033, 0], [0.033, track.length - 0.014]]) {
      const pressure = stamp(x, s);
      expect(pressure.x).toBeCloseTo(x, 6);
      expect(pressure.s).toBeCloseTo(s, 6);
      expect(pressure.total).toBeCloseTo(centre.total, 9);
      expect(pressure.cells).toBeLessThanOrEqual(8);
    }
    // The shoulder of an edge contact cannot wrap to the far column.
    stamp(terrain.lateralMin + 0.01, 60.38);
    expect(terrain.checkpoint().cells.every((cell) => cell % terrain.columns <= 1)).toBe(true);
    const recorded = terrain.checkpoint();
    const before = terrain.hash();
    terrain.reset();
    terrain.restore(recorded);
    expect(terrain.hash()).toBe(before);
  });

  it('uses the true end of the short final row at the lap seam and meets the undeformed verge', () => {
    const track = rigTrack(id), { terrain } = Track.offroadOf(track) as TrackTerrainSurface;
    const lastStart = (terrain.rows - 1) * COURSE_CELL.along;
    const lastCentre = (track.length + lastStart) / 2;
    const x = terrain.lateralMin + COURSE_CELL.lateral / 2;
    terrain.restore({
      cells: Uint32Array.of(terrain.cellIndex(x, lastCentre)),
      depth: Float32Array.of(0.1), compaction: Float32Array.of(0.5), sequence: 3,
    });
    expect(terrain.depthAt(x, lastCentre)).toBeCloseTo(0.1, 6);
    const midpoint = (lastCentre + track.length + COURSE_CELL.along / 2) / 2;
    expect(terrain.depthAt(x, midpoint)).toBeCloseTo(0.05, 6);
    expect(terrain.depthAt(x, midpoint - track.length)).toBeCloseTo(0.05, 6);
    expect(terrain.heightAt(x, 0)).toBeCloseTo(terrain.heightAt(x, track.length), 7);
    expect(terrain.depthAt(terrain.lateralMin, lastCentre)).toBe(0);
    expect(terrain.depthAt(terrain.lateralMin + 1e-5, lastCentre)).toBeLessThan(1e-7);
    expect(terrain.depthAt(x, COURSE_CELL.along / 2)).toBe(0);
    terrain.reset();
  });
});
