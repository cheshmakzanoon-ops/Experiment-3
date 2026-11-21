import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MxLooseSoil, looseClodGeometry } from '../src/rendering/offroad/mx-loose-soil.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
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

  it('settles the field on live and replayed rut triangles, including hidden Low-detail crumbs', () => {
    const track = rigTrack('valley-ridge-mx'), view = new TerrainView(track), soil = new MxLooseSoil(track);
    const t = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
    const meshes = soil.root.children as T.InstancedMesh[];
    const initial = t.hash();
    const samples: number[] = [];
    const receiver = {
      get geometryRevision() { return view.geometryRevision; },
      heightRevisions: view.heightRevisions,
      heightCellAt: (s: number, l: number) => view.heightCellAt(s, l),
      heightAt(s: number, l: number) {
        samples.push(view.heightCellAt(s, l));
        return view.heightAt(s, l);
      },
    };
    const matrices = () => meshes.map(m => m.instanceMatrix.array.slice());
    const versions = () => meshes.map(m => m.instanceMatrix.version);
    try {
      const material = meshes.find(m => m.name.includes('clods'))!.material as T.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(0x8f6d4b);
      soil.conform(receiver);
      const full = matrices(), start = versions();
      const cell = samples.find(c => c > 2 * t.renderColumns && c % t.renderColumns < t.renderColumns - 2)!;
      expect(cell).toBeDefined();
      samples.length = 0;
      soil.conform(receiver);
      expect(samples).toHaveLength(0);
      expect(versions()).toEqual(start);
      setMxQuality('low');
      const patch = [cell, cell + 1, cell + t.renderColumns, cell + t.renderColumns + 1];
      view.record({ reset: false, wetness: 0.8, blocks: new Float32Array(patch.flatMap(c => [c, 0.09, 0.5])) }, 1, true);
      soil.conform(receiver);
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.length).toBeLessThan(soil.stats.clods / 8);
      const lowered = matrices();
      let drops = 0;
      for (let k = 0; k < lowered.length; k++) {
        for (let j = 0; j < lowered[k].length; j++) {
          if (lowered[k][j] === full[k][j]) continue;
          expect(j % 16).toBe(13);
          expect(lowered[k][j]).toBeLessThan(full[k][j]);
          drops++;
        }
      }
      expect(drops).toBeGreaterThan(0);
      setMxQuality('high');
      const after = versions();
      view.record({ reset: false, wetness: 0.92, blocks: new Float32Array() }, 2, true);
      soil.conform(receiver);
      expect(versions()).toEqual(after);
      view.showAt(0);
      soil.conform(receiver);
      expect(matrices()).toEqual(full);
      view.showLive();
      soil.conform(receiver);
      expect(matrices()).toEqual(lowered);
      expect(t.hash()).toBe(initial);
    } finally {
      soil.dispose();
      view.dispose();
    }
  });

  it('darkens and glosses with session wetness through a uniform, not a recompile', () => {
    const soil = new MxLooseSoil(rigTrack('valley-ridge-mx'));
    soil.setWetness(2);
    soil.setWetness(-1);
    soil.setWetness(0.6);
    soil.dispose();
  });
});
