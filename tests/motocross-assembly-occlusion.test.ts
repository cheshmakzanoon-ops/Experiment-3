import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { applyMxAssemblyOcclusion } from '../src/rendering/offroad/mx-assembly-occlusion.ts';

function recess() {
  const root = new T.Group(),
    metal = new T.MeshStandardMaterial();
  const floor = new T.Mesh(new T.PlaneGeometry(0.3, 0.3, 6, 6), metal);
  floor.rotateX(-Math.PI / 2);
  const cover = new T.Mesh(new T.BoxGeometry(0.24, 0.012, 0.24, 4, 1, 4), metal);
  cover.position.y = 0.048;
  root.add(floor, cover);
  return {
    root,
    floor,
    cover,
    dispose() {
      floor.geometry.dispose();
      cover.geometry.dispose();
      metal.dispose();
    },
  };
}

describe('motocross rigid-assembly light transport', () => {
  it('shades a sheltered surface and leaves an open surface and a moving lever exposed', () => {
    const r = recess();
    try {
      applyMxAssemblyOcclusion('test/recess', r.root, [], 0.005, 0.1);
      const cavity = r.floor.geometry.getAttribute('mxAssemblyCavity');
      expect(cavity.normalized).toBe(true);
      expect(cavity.array).toBeInstanceOf(Uint8Array);
      expect(cavity.getX(24)).toBeGreaterThan(0.65);
      const above = r.cover.geometry.getAttribute('normal');
      const cover = r.cover.geometry.getAttribute('mxAssemblyCavity');
      for (let i = 0; i < above.count; i++) if (above.getY(i) > 0.95) expect(cover.getX(i)).toBe(0);
      // Same index count and materials, but a changed clearance must invalidate the bake.
      r.cover.position.y = 0.25;
      applyMxAssemblyOcclusion('test/recess', r.root, [], 0.005, 0.1);
      expect(r.floor.geometry.getAttribute('mxAssemblyCavity').getX(24)).toBe(0);
      const newRig = recess();
      try {
        applyMxAssemblyOcclusion('test/lever', newRig.root, [newRig.cover], 0.005, 0.1);
        expect(newRig.cover.geometry.hasAttribute('mxAssemblyCavity')).toBe(false);
        expect(newRig.floor.geometry.getAttribute('mxAssemblyCavity').getX(24)).toBe(0);
      } finally {
        newRig.dispose();
      }
    } finally {
      r.dispose();
    }
  });

  it('shares identical vertex bytes across entrants in different world poses', () => {
    const first = recess(),
      second = recess();
    try {
      second.root.position.set(300, 11, -26);
      second.root.rotation.set(0.58, -0.3, 0.68);
      applyMxAssemblyOcclusion('test/entrants', first.root, [], 0.005, 0.1);
      applyMxAssemblyOcclusion('test/entrants', second.root, [], 0.005, 0.1);
      expect(first.floor.geometry.getAttribute('mxAssemblyCavity').array).toBe(
        second.floor.geometry.getAttribute('mxAssemblyCavity').array,
      );
      expect(first.cover.geometry.getAttribute('mxAssemblyCavity').array).toBe(
        second.cover.geometry.getAttribute('mxAssemblyCavity').array,
      );
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});
