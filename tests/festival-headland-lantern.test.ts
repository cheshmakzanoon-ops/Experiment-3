import * as T from 'three';
import { describe, it, expect } from 'vitest';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { headlandSignal } from '../src/rendering/open-world/headland-lantern.ts';
import type { Structure } from '../src/simulation/open-world/placement.ts';

const site: Structure = {
  kind: 'lighthouse',
  x: 3930,
  z: -2460,
  base: 12,
  height: 28,
  hx: 3.5,
  hz: 3.5,
  heading: 0,
  floors: 1,
  style: 151,
};
describe('Port Ilse headland light', () => {
  it('shows two narrow, repeatable flashes per revolution from a fixed coastal bearing', () => {
    for (const t of [0, 0.86, 4, 6.42, 17.35]) {
      const a = (t * Math.PI) / 8,
        x = Math.sin(a) * 1100,
        z = Math.cos(a) * 1100;
      expect(headlandSignal(t, x, 0, z)).toBeCloseTo(1, 7);
      expect(headlandSignal(t + 8, x, 0, z)).toBeCloseTo(1, 7);
      expect(headlandSignal(t + 4, x, 0, z)).toBeLessThan(0.001);
      expect(headlandSignal(t, x, 1100, z)).toBeLessThan(0.001);
    }
    expect(headlandSignal(0, 0, 0, 0)).toBe(0);
  });
  it('keeps the optic behind the panes, occludes its flash with the terrain and drives it from simulation time', () => {
    const b = new Buildings([site]);
    try {
      const group = b.root.getObjectByName('Port Ilse headland light')!;
      expect(group.position.toArray()).toEqual([site.x, site.base + site.height, site.z]);
      const lens = group.getObjectByName('Lighthouse lantern') as T.Mesh;
      const glass = group.getObjectByName('Twelve lantern-room panes') as T.Mesh;
      const flash = group.getObjectByName('Headland optical flash') as T.Sprite;
      expect(group.children).toHaveLength(4);
      expect(lens.position.y).toEqual(glass.position.y);
      expect(flash.material.depthTest).toBe(true);
      expect(flash.material.depthWrite).toBe(false);
      lens.geometry.computeBoundingSphere();
      glass.geometry.computeBoundingSphere();
      expect(lens.geometry.boundingSphere!.radius).toBeLessThan(
        glass.geometry.boundingSphere!.radius,
      );
      const eye = group.position.clone().add(new T.Vector3(0, lens.position.y, 800));
      b.setNight(0, 0, eye);
      expect(flash.visible).toBe(false);
      b.setNight(1, 8, eye);
      expect(flash.visible).toBe(true);
      expect(b.lantern.emissiveIntensity).toBeGreaterThan(18);
      b.setNight(1, 4, eye);
      expect(flash.visible).toBe(false);
      expect(b.lantern.emissiveIntensity).toBeLessThan(0.4);
      b.setNight(1, 8, eye);
      expect(lens.rotation.y).toBeCloseTo(Math.PI);
      expect(flash.visible).toBe(true);
    } finally {
      b.dispose();
    }
  });
});
