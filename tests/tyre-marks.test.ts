import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import {
  TYRE_MARKS,
  buildTyreMarks,
  tyreMarkZones,
  tyreMarks,
} from '../src/rendering/tyre-marks.ts';

function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      const noop = () => {};
      return new Proxy({ canvas: this }, { get: (t, k) => Reflect.get(t, k) ?? noop });
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}
afterEach(() => vi.unstubAllGlobals());

const track = (id: 'aurel' | 'vellamar') =>
  new Track('clear', false, undefined, circuitDefinition(id));

describe('laid tyre rubber', () => {
  for (const id of ['aurel', 'vellamar'] as const)
    it(`${id}: braking zones end at corners and every mark lies on the asphalt near the line`, () => {
      const t = track(id),
        line = racingLineFor(t),
        p = trackPoint();
      const zones = tyreMarkZones(t);
      expect(tyreMarkZones(t)).toEqual(zones);
      const braking = zones.filter((z) => z.kind === 'braking');
      expect(braking.length).toBeGreaterThanOrEqual(4);
      for (const zone of braking) {
        expect(zone.strength).toBeGreaterThanOrEqual(TYRE_MARKS.minimumDrop);
        expect(zone.end).toBeGreaterThan(zone.start);
        // A braking zone ends where the line turns: a corner tighter than 200 m.
        let k = 0;
        for (let s = zone.end - 10; s <= zone.end + 30; s += 2)
          k = Math.max(k, Math.abs(line.curvatureAt(s)));
        expect(k).toBeGreaterThan(0.005);
      }
      // Exit marks stop where the next braking zone starts.
      for (const exit of zones.filter((z) => z.kind === 'exit'))
        for (const zone of braking)
          if (zone.start > exit.start) expect(exit.end).toBeLessThanOrEqual(zone.start + 1e-6);
      const marks = tyreMarks(t, zones);
      expect(marks.length).toBeGreaterThan(braking.length * 3);
      for (const mark of marks)
        for (let i = 0; i < mark.s.length; i++) {
          t.at(mark.s[i], p);
          expect(Math.abs(mark.lateral[i])).toBeLessThanOrEqual(p.width - TYRE_MARKS.width + 1e-5);
          expect(Math.abs(mark.lateral[i] - line.offsetAt(mark.s[i]))).toBeLessThanOrEqual(
            TYRE_MARKS.halfTrack + 1.05,
          );
          expect(mark.alpha[i]).toBeGreaterThanOrEqual(0);
          expect(mark.alpha[i]).toBeLessThanOrEqual(0.62);
        }
    });
  it('builds a few culled, upward-facing, non-occluding meshes on the road', () => {
    stubCanvas();
    const t = track('aurel'),
      group = new T.Group();
    const meshes = buildTyreMarks(t, group);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(Math.ceil(t.length / TYRE_MARKS.chunk));
    let triangles = 0;
    for (const mesh of meshes) {
      const material = mesh.material as T.MeshStandardMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.vertexColors).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.geometry.getAttribute('color').itemSize).toBe(4);
      const normal = mesh.geometry.getAttribute('normal'),
        position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < normal.count; i++) {
        expect(normal.getY(i)).toBeGreaterThan(0.9);
        expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
      }
      triangles += mesh.geometry.index!.count / 3;
    }
    expect(triangles).toBeLessThan(40000);
    expect(group.children).toHaveLength(meshes.length);
  });
});
