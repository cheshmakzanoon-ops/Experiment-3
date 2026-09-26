import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { visibleReducedWheelPivots } from '../e2e/fixtures/visible-wheel-pivots.ts';

function scene() {
  const root = new T.Group(),
    high = new T.Group(),
    reduced = new T.Group();
  high.visible = false;
  const geometry = new T.BoxGeometry(),
    material = new T.MeshBasicMaterial();
  const suspension = new T.InstancedMesh(geometry, material, 1);
  const lamp = new T.Mesh(geometry, material);
  root.add(suspension, lamp, high, reduced);
  // Reduced body and wing groups have meshes, not a nested wheel-spin group.
  reduced.add(new T.Group().add(new T.Mesh(geometry, material)), new T.Group());
  const wheels = Array.from({ length: 4 }, (_, index) => {
    const wheel = new T.Group();
    wheel.position.x = index;
    wheel.rotation.y = index * 0.1;
    wheel.add(new T.Group().add(new T.Mesh(geometry, material)));
    reduced.add(wheel);
    return wheel;
  });
  return {
    root,
    high,
    reduced,
    wheels,
    lamp,
    suspension,
    dispose: () => {
      suspension.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

describe('reduced wheel inspection ownership', () => {
  it('reads the actual pivot objects despite persistent root meshes and reordered children', () => {
    const f = scene();
    try {
      expect(visibleReducedWheelPivots(f.root)).toEqual(f.wheels);
      f.root.children.reverse();
      expect(visibleReducedWheelPivots(f.root)).toEqual(f.wheels);
      const result = visibleReducedWheelPivots(f.root);
      f.wheels[2].rotation.y = 0.7;
      expect(result[2].rotation.y).toBe(0.7);
      expect(result[2]).toBe(f.wheels[2]);
    } finally {
      f.dispose();
    }
  });
  it('rejects a missing wheel instead of accepting an incomplete measurement', () => {
    const f = scene();
    try {
      f.reduced.remove(f.wheels[3]);
      expect(() => visibleReducedWheelPivots(f.root)).toThrow('four visible');
    } finally {
      f.dispose();
    }
  });
  it('rejects a hidden wheel or root', () => {
    const f = scene();
    try {
      f.wheels[1].visible = false;
      expect(() => visibleReducedWheelPivots(f.root)).toThrow('four visible');
      f.root.visible = false;
      expect(() => visibleReducedWheelPivots(f.root)).toThrow('root is not visible');
    } finally {
      f.dispose();
    }
  });
  it('rejects multiple presented models and a missing model', () => {
    const f = scene();
    try {
      f.high.visible = true;
      expect(() => visibleReducedWheelPivots(f.root)).toThrow('found 2');
      f.high.visible = false;
      f.reduced.visible = false;
      expect(() => visibleReducedWheelPivots(f.root)).toThrow('found 0');
    } finally {
      f.dispose();
    }
  });
});
