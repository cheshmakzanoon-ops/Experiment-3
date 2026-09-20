import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Track } from '../src/simulation/track.ts';
import { loft, cockpitShell, batchScene } from '../src/rendering/geometry.ts';

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

it('leaves the actual steering display sightline open through the monocoque', () => {
  const shell = new T.Mesh(cockpitShell(), new T.MeshStandardMaterial({ side: T.DoubleSide }));
  shell.updateMatrixWorld();
  const eye = new T.Vector3(0, 0.41, -0.48);
  const display = new T.Vector3(0, 0.125, 0.195);
  const direction = display.clone().sub(eye);
  const ray = new T.Raycaster(eye, direction.clone().normalize(), 0, direction.length());
  expect(ray.intersectObject(shell)).toHaveLength(0);
  // The same shell still has real sidewalls.
  ray.set(new T.Vector3(1, 0.02, -0.3), new T.Vector3(-1, 0, 0));
  ray.far = 2;
  expect(ray.intersectObject(shell).length).toBeGreaterThan(0);
});
it('keeps separated material batches spatially cullable', () => {
  const root = new T.Group(),
    material = new T.MeshStandardMaterial();
  for (const x of [0, 5, 300]) {
    const box = new T.Mesh(new T.BoxGeometry(), material);
    box.position.x = x;
    root.add(box);
  }
  batchScene(root, new Set());
  expect(root.children).toHaveLength(2);
  for (const object of root.children) {
    const geometry = (object as T.Mesh).geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeLessThan(10);
  }
});
