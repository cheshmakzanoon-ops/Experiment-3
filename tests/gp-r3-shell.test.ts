import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { gpR3Shell, GP_R3_SHELL_REVISION } from '../src/rendering/gp-r3-shell.ts';
import { atlasUv, gpR3LiveryMaterial, sidePixel, topPixel } from '../src/rendering/gp-r3-livery.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const triangles = (group: T.Object3D) => {
  let count = 0;
  group.traverse((o) => {
    if (o instanceof T.Mesh) count += o.geometry.index!.count / 3;
  });
  return count;
};

describe('GP-R3 hard-surface shell', () => {
  it.each([
    ['high', 24000],
    ['mid', 8000],
    ['far', 3000],
  ] as const)(
    '%s ships finite, symmetric, fully attributed panels within budget',
    (detail, cap) => {
      const materials = new BikeMaterials(3);
      try {
        const shell = gpR3Shell(materials, detail, 3, true);
        expect(shell.userData.referenceRevision).toBe(GP_R3_SHELL_REVISION);
        const paint = shell.getObjectByName('GP bodywork / paint') as T.Mesh;
        expect(paint).toBeInstanceOf(T.Mesh);
        expect(triangles(shell)).toBeLessThan(cap);
        const box = new T.Box3().setFromObject(shell);
        // Mirrored halves: the envelope is centred on the chassis plane.
        expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(1e-6);
        // Within the existing chassis envelope (wing tips, beak, tail, keel).
        expect(box.max.x).toBeLessThan(0.36);
        expect(box.max.z).toBeLessThan(1.0);
        expect(box.min.z).toBeGreaterThan(-0.9);
        expect(box.min.y).toBeGreaterThan(-0.5);
        shell.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const g = o.geometry;
          for (const name of ['position', 'normal', 'uv']) {
            const a = g.getAttribute(name);
            expect(a, `${o.name} ${name}`).toBeDefined();
            for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i])).toBe(true);
          }
          const p = g.getAttribute('position'),
            index = g.index!,
            ab = new T.Vector3(),
            ac = new T.Vector3(),
            a = new T.Vector3();
          let degenerate = 0;
          for (let i = 0; i < index.count; i += 3) {
            a.fromBufferAttribute(p, index.getX(i));
            ab.fromBufferAttribute(p, index.getX(i + 1)).sub(a);
            ac.fromBufferAttribute(p, index.getX(i + 2)).sub(a);
            if (ab.cross(ac).length() < 1e-12) degenerate++;
          }
          // Panel tips converge to a point; only those rows may collapse.
          expect(degenerate / (index.count / 3)).toBeLessThan(0.05);
        });
      } finally {
        materials.dispose();
      }
    },
  );

  it('shares one deep clear-coat livery per entrant across every LOD', () => {
    const materials = new BikeMaterials(5);
    try {
      const a = gpR3LiveryMaterial(materials, 5),
        b = gpR3LiveryMaterial(materials, 5);
      expect(a).toBe(b);
      expect(a.clearcoat).toBe(1);
      expect(a.clearcoatRoughness).toBeLessThan(0.06);
      expect(a.map).toBeInstanceOf(T.Texture);
      expect(materials.list).toContain(a);
      const high = gpR3Shell(materials, 'high', 5, true),
        mid = gpR3Shell(materials, 'mid', 5, true);
      expect((high.getObjectByName('GP bodywork / paint') as T.Mesh).material).toBe(a);
      expect((mid.getObjectByName('GP bodywork / paint') as T.Mesh).material).toBe(a);
    } finally {
      materials.dispose();
    }
  });

  it('projects each flank and the plan view into its own atlas region', () => {
    const [ru, rv] = atlasUv('side', 0.2, 0, 0.3),
      [lu, lv] = atlasUv('side', -0.2, 0, 0.3),
      [tu, tv] = atlasUv('top', 0.05, 0.3, 0.3);
    expect(ru).toBeLessThan(0.5);
    expect(lu).toBeGreaterThan(0.5);
    expect(rv).toBeGreaterThan(0.5);
    expect(lv).toBeGreaterThan(0.5);
    expect(tv).toBeLessThan(0.5);
    expect(tu).toBeGreaterThan(0);
    // The front of the machine is on the viewer's left on the right flank
    // and on the right on the left flank, so wordmarks read on both sides.
    expect(sidePixel(1, 0.9, 0)[0]).toBeLessThan(sidePixel(1, -0.5, 0)[0]);
    expect(sidePixel(-1, 0.9, 0)[0]).toBeGreaterThan(sidePixel(-1, -0.5, 0)[0]);
    expect(topPixel(0.9, 0)[0]).toBeLessThan(topPixel(-0.5, 0)[0]);
  });

  it('keeps the nose clear of the front tyre at full fork travel', () => {
    const def = VEHICLES.gpr1,
      b = def.bike!,
      materials = new BikeMaterials(0),
      model = new BikeModel(def, 0, 'high', materials, true);
    try {
      model.pose({
        ...staticSag(def),
        fork: b.forkTravel,
        steer: 0,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0,
        riderOffset: 0,
        tuck: 1,
        brake: 1,
        rearBrake: 0,
        discTemp: 300,
        compoundColour: 0xffffff,
        riding: true,
      });
      model.root.updateMatrixWorld(true);
      const shell = model.root.getObjectByName('GP-R3 hard-surface shell (high)')!;
      expect(shell).toBeDefined();
      // Rake 0.42 rad: full travel lifts the axle along the fork axis.
      const axle = new T.Vector3(0, b.frontWheelRadius - b.cgHeight, b.cgToFront).add(
        new T.Vector3(0, Math.cos(0.42), -Math.sin(0.42)).multiplyScalar(b.forkTravel),
      );
      const p = new T.Vector3();
      let closest = Infinity;
      shell.traverse((o) => {
        if (!(o instanceof T.Mesh) || o.name === 'GP bodywork / screen') return;
        const position = o.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          p.fromBufferAttribute(position, i);
          if (Math.abs(p.x) > 0.075) continue;
          closest = Math.min(closest, Math.hypot(p.y - axle.y, p.z - axle.z));
        }
      });
      expect(closest).toBeGreaterThan(b.frontWheelRadius + 0.01);
    } finally {
      materials.dispose();
    }
  });
});
