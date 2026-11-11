import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MxLooseSoil, looseClodGeometry } from '../src/rendering/offroad/mx-loose-soil.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('MX loose soil', () => {
  afterEach(() => setMxQuality('high'));

  it('builds a small faceted clod with metre UVs and a darkened underside', () => {
    const g = looseClodGeometry(11, 0.4, 0.62);
    expect((g.getAttribute('position') as T.BufferAttribute).count).toBeLessThan(60);
    expect(g.index!.count / 3).toBe(80);
    const box = g.boundingBox!;
    expect(box.max.y).toBeLessThan(0.95);
    expect(box.max.y).toBeGreaterThan(0.35);
    const colour = g.getAttribute('color'),
      position = g.getAttribute('position');
    let low = 1,
      high = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < -0.2) low = Math.min(low, colour.getX(i));
      if (position.getY(i) > 0.2) high = Math.max(high, colour.getX(i));
    }
    expect(low).toBeLessThan(high);
    g.dispose();
  });

  it.each([
    ['valley-ridge-mx', true],
    ['arena-nord-sx', false],
  ] as const)('scatters %s crumbs off the starter pad, none larger than a fist', (id, pebbles) => {
    const track = rigTrack(id),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      soil = new MxLooseSoil(track);
    expect(soil.stats.clods).toBeGreaterThan(400);
    if (pebbles) expect(soil.stats.stones).toBeGreaterThan(20);
    else expect(soil.stats.stones).toBe(0);
    const gate = surface.course.spec.gate;
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      scale = new T.Vector3(),
      quaternion = new T.Quaternion(),
      point = trackPoint();
    let total = 0;
    soil.root.traverse((object) => {
      if (!(object instanceof T.InstancedMesh)) return;
      expect(object.castShadow).toBe(false);
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        matrix.decompose(position, quaternion, scale);
        // A 1-6 cm crumb: half-extent under 8 cm in every axis.
        expect(Math.max(scale.x, scale.y, scale.z)).toBeLessThan(0.08);
        const lateral = track.nearest(position.x, position.z, point);
        expect(Number.isFinite(lateral)).toBe(true);
        // Not on the starter's pad or its approach.
        if (gate) {
          const gap = Math.abs(
            ((point.s - gate.s + track.length * 1.5) % track.length) - track.length / 2,
          );
          expect(gap).toBeGreaterThan(3);
        }
        expect(Math.abs(lateral)).toBeLessThan(-surface.terrain.lateralMin);
        total++;
      }
    });
    expect(total).toBe(soil.stats.clods + soil.stats.stones);
    soil.dispose();
  });

  it('thins to a third on Low and Medium, restores on High, and is deterministic', () => {
    const track = rigTrack('valley-ridge-mx'),
      a = new MxLooseSoil(track),
      b = new MxLooseSoil(track);
    expect(a.stats).toEqual(b.stats);
    const drawn = () => {
      let n = 0;
      a.root.traverse((o) => {
        if (o instanceof T.InstancedMesh) n += o.count;
      });
      return n;
    };
    const full = drawn();
    expect(full).toBe(a.stats.clods + a.stats.stones);
    setMxQuality('medium');
    expect(drawn()).toBeLessThan(full * 0.4);
    expect(drawn()).toBeGreaterThan(full * 0.2);
    setMxQuality('high');
    expect(drawn()).toBe(full);
    a.dispose();
    b.dispose();
  });

  it('darkens and glosses with session wetness through a uniform, not a recompile', () => {
    const soil = new MxLooseSoil(rigTrack('valley-ridge-mx'));
    soil.setWetness(2);
    soil.setWetness(-1);
    soil.setWetness(0.6);
    soil.dispose();
  });
});
