import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Track } from '../src/simulation/track.ts';
import { loft } from '../src/rendering/geometry.ts';

describe('Visible geometry agrees with the physical surface', () => {
  it.each([-1, 1])('gives side %s strips upward-facing triangles', (side) => {
    const track = new Track('clear', true);
    const scene = Object.assign(Object.create(CircuitScene.prototype), {
      track,
      group: new T.Group(),
    }) as CircuitScene;
    const strip = scene.ribbon(new T.MeshStandardMaterial(), {
      start: 20,
      end: 60,
      step: 2,
      offset: (_s, t) => side * (8 + t),
    });
    const normals = strip.geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0.99);
    strip.geometry.dispose();
  });
  it('gives loft sidewalls outward-facing normals', () => {
    const geometry = loft([
      [-1, 0, 1, 1],
      [0, 0, 1, 1],
      [1, 0, 1, 1],
    ]);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < position.count; i++) {
      const outward = position.getX(i) * normal.getX(i) + position.getY(i) * normal.getY(i);
      expect(outward).toBeGreaterThan(0.95);
    }
    geometry.dispose();
  });
});
