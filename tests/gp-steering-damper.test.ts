import * as T from 'three';
import { describe, it, expect } from 'vitest';
import { GpSteeringDamper } from '../src/rendering/gp-steering-damper.ts';
describe('telescoping steering damper', () => {
  it('keeps both eyes on their mounts and positive shaft engagement through steering and replay', () => {
    const metal = new T.MeshPhysicalMaterial(),
      damper = new GpSteeringDamper({ forkUpper: metal, steel: metal });
    const first = damper.root.children[0] as T.Mesh,
      rod = damper.slider;
    const original = first.geometry.getAttribute('position').array.slice();
    const eye = new T.Vector3(),
      lengths: number[] = [];
    for (const turn of [0, 0.54, -0.54, 0.22, -0.31, 0.54, 0]) {
      damper.update(turn);
      damper.root.updateMatrixWorld(true);
      expect(first.getWorldPosition(eye).toArray()).toEqual([-0.108, 0.028, -0.091]);
      const target = new T.Vector3(0.065, 0.028, -0.02).applyAxisAngle(
        new T.Vector3(0, 1, 0),
        turn,
      );
      expect(rod.getWorldPosition(eye).distanceTo(target)).toBeLessThan(1e-7);
      expect(rod.scale.toArray()).toEqual([1, 1, 1]);
      const length = rod.position.x;
      lengths.push(length);
      // The shaft covers the barrel seal with positive overlap at max lock.
      expect(length - 0.106).toBeLessThan(0.124 - 0.008);
      expect(length - 0.018).toBeGreaterThan(0.124 + 0.004);
      expect(first.geometry.getAttribute('position').array).toEqual(original);
    }
    expect(lengths[0]).toBe(lengths.at(-1));
    expect(lengths[1]).toBe(lengths[5]);
    expect(Math.abs(lengths[1] - lengths[2])).toBeGreaterThan(0.025);
    expect((first.geometry.index!.count + rod.geometry.index!.count) / 3).toBeLessThan(325);
    for (const mesh of [first, rod, damper.frameMount, damper.yokeMount]) mesh.geometry.dispose();
    metal.dispose();
  });
});
