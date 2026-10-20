import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { gpFrontBrakeTip } from '../src/rendering/gp-front-brake.ts';

// Geometry and articulation checks only; actual materials are drawn by the
// production-model browser fixture with a real Canvas/WebGL implementation.
beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop: () => undefined })
          : key === 'measureText'
            ? () => ({ width: 10 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function pose(id: string, brake = 0, rearBrake = 0) {
  const sag = staticSag(VEHICLES[id]);
  return {
    fork: sag.fork,
    shock: sag.shock,
    steer: 0.18,
    frontRotation: 1,
    rearRotation: 2,
    chassisLean: 0.25,
    riderOffset: 0.08,
    tuck: 0.4,
    brake,
    rearBrake,
    discTemp: 320,
    compoundColour: 0xffffff,
    riding: true,
  };
}

describe('GP front-brake lever follows the presented hand control', () => {
  it.each(['gpr1', 'gpr2'])('%s pulls toward the grip about the existing pivot', (id) => {
    const materials = new BikeMaterials(0),
      model = new BikeModel(VEHICLES[id], 0, 'high', materials, true);
    try {
      const pivot = model.root.getObjectByName('GP front-brake lever pivot')!;
      const lever = model.root.getObjectByName('GP articulated front-brake lever') as T.Mesh;
      expect(pivot.children).toEqual([lever]);
      expect(pivot.position.toArray()).toEqual([-0.211, -0.034, 0.03]);
      const geometry = lever.geometry,
        material = lever.material,
        originalVertices = Array.from(geometry.getAttribute('position').array),
        tip = gpFrontBrakeTip(new T.Vector3());
      const inSteeringFrame = () => {
        model.root.updateMatrixWorld(true);
        return tip.clone().applyMatrix4(lever.matrix).applyMatrix4(pivot.matrix);
      };
      model.pose(pose(id));
      const releasedTip = inSteeringFrame(),
        releasedWorld = lever.matrixWorld.elements.slice();
      let previousZ = releasedTip.z;
      for (const brake of [0.25, 0.5, 0.75, 1]) {
        const input = pose(id, brake),
          before = { ...input };
        model.pose(input);
        const squeezedTip = inSteeringFrame();
        expect(squeezedTip.z).toBeLessThan(previousZ);
        // The distal end closes the gap without going behind the rubber grip.
        expect(squeezedTip.z).toBeGreaterThan(-0.05);
        expect(squeezedTip.x).toBeLessThan(-0.3);
        expect(input).toEqual(before);
        expect(pivot.position.toArray()).toEqual([-0.211, -0.034, 0.03]);
        previousZ = squeezedTip.z;
      }
      expect(releasedTip.z - previousZ).toBeGreaterThan(0.025);
      model.pose(pose(id, 0.5));
      inSteeringFrame();
      const held = lever.matrixWorld.elements.slice();
      model.pose(pose(id, 0.5));
      inSteeringFrame();
      expect(lever.matrixWorld.elements).toEqual(held);
      model.pose(pose(id, 0, 1));
      inSteeringFrame();
      expect(lever.matrixWorld.elements).toEqual(releasedWorld);
      expect(lever.geometry).toBe(geometry);
      expect(lever.material).toBe(material);
      expect(Array.from(geometry.getAttribute('position').array)).toEqual(originalVertices);
      for (const brake of [NaN, Infinity, -1]) {
        model.pose(pose(id, brake));
        expect(pivot.rotation.y).toBeCloseTo(0);
      }
      model.pose(pose(id, 2));
      expect(pivot.rotation.y).toBeCloseTo(-0.25);
    } finally {
      model.dispose();
      materials.dispose();
    }
  });

  it('keeps the new articulation out of cheaper LODs and other road motorcycles', () => {
    for (const [id, detail] of [
      ['gpr1', 'mid'],
      ['gpr2', 'far'],
      ['sbk1000', 'high'],
      ['ss600', 'high'],
    ] as const) {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, detail, materials, true);
      try {
        model.pose(pose(id, 1));
        expect(model.root.getObjectByName('GP front-brake lever pivot')).toBeUndefined();
      } finally {
        model.dispose();
        materials.dispose();
      }
    }
  });
});
