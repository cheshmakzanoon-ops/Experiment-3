import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { gpEquipmentUv } from '../src/rendering/gp-equipment-print.ts';
import { addGpRacingGlove } from '../src/rendering/gp-rider-glove.ts';

describe('GP race equipment print', () => {
  it('keeps the eight cuts and each filtered edge inside the shared limb atlas', () => {
    for (const [i, part] of (
      ['plain', 'palm', 'back', 'closure', 'knuckle', 'digit', 'foot', 'shaft'] as const
    ).entries()) {
      const geometry = new T.PlaneGeometry();
      const uv = gpEquipmentUv(geometry, part).getAttribute('uv');
      for (let vertex = 0; vertex < uv.count; vertex++) {
        expect(uv.getX(vertex) * 1024).toBeGreaterThanOrEqual(i * 128 + 4);
        expect(uv.getX(vertex) * 1024).toBeLessThanOrEqual(i * 128 + 124);
        expect(uv.getY(vertex) * 512).toBeGreaterThanOrEqual(4);
        expect(uv.getY(vertex) * 512).toBeLessThanOrEqual(124);
      }
      geometry.dispose();
    }
  });
  it('prints the braked fingers from the same digit cut as fingers around the other grip', () => {
    const root = new T.Group(),
      material = new T.MeshStandardMaterial();
    const finishes = { leather: material, panel: material, armour: material, printed: material };
    const fingers = addGpRacingGlove(root, 'high', -1, finishes, true)!;
    const fixed = root.getObjectByName('GP wrapped finger 3') as T.Mesh;
    for (const mesh of [fingers.mesh, fixed]) {
      const uv = mesh.geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThan(5 / 8);
        expect(uv.getX(i)).toBeLessThan(6 / 8);
      }
    }
    fingers.dispose();
    root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    material.dispose();
  });
});
