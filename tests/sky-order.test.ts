import { expect, it } from 'vitest';
import { Sky } from 'three/addons/objects/Sky.js';
import { configureSky } from '../src/rendering/daylight.ts';
import { frontToBackOpaque, type OpaqueItem } from '../src/rendering/opaque-order.ts';

it('sorts the actual far-depth sky after opaque objects regardless of its misleading object-centre depth', () => {
  const sky = new Sky();
  const vertex = sky.material.vertexShader;
  configureSky(sky);
  const background: OpaqueItem = {
    groupOrder: 0,
    renderOrder: 0,
    z: -1,
    id: sky.id,
    material: { id: 0, name: sky.material.name },
  };
  const foreground: OpaqueItem = {
    groupOrder: 8,
    renderOrder: 1000,
    z: 0.9,
    id: 900,
    material: { id: 1, name: 'Opaque circuit' },
  };
  expect(frontToBackOpaque(background, foreground)).toBeGreaterThan(0);
  expect(frontToBackOpaque(foreground, background)).toBeLessThan(0);
  expect(frontToBackOpaque(background, background)).toBe(0);
  expect([background, foreground].sort(frontToBackOpaque)).toEqual([foreground, background]);
  expect(sky.material.depthTest).toBe(true);
  expect(sky.material.depthWrite).toBe(false);
  expect(sky.material.transparent).toBe(false);
  expect(sky.material.vertexShader).toBe(vertex);
  expect(vertex).toContain('gl_Position.z = gl_Position.w');
  sky.geometry.dispose();
  sky.material.dispose();
});
