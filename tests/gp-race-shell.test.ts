import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import {
  gpFrontTyreExclusion,
  gpLiveryMaterial,
  gpRaceBodywork,
} from '../src/rendering/gp-race-bodywork.ts';
import { shellPanelGeometry, type P3 } from '../src/rendering/gp-race-shell.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { meshColumnsFor, meshSurfaceIntrusion } from './gp-mesh-clearance.ts';

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

const release = (root: T.Object3D) =>
  root.traverse((object) => {
    if (object instanceof T.Mesh) object.geometry.dispose();
  });

describe('GP race shell control-net surfaces', () => {
  it('passes through its control points and mirrors a closed centre seam smoothly', () => {
    const net: P3[][] = [
      [
        [0, 0.2, 0],
        [0.1, 0.15, 0],
        [0.12, 0, 0],
        [0, -0.05, 0],
      ],
      [
        [0, 0.25, 0.2],
        [0.12, 0.2, 0.2],
        [0.15, 0, 0.2],
        [0, -0.06, 0.2],
      ],
      [
        [0, 0.2, 0.4],
        [0.1, 0.15, 0.4],
        [0.12, 0, 0.4],
        [0, -0.05, 0.4],
      ],
    ];
    const g = shellPanelGeometry({ name: 'probe', net, rows: 4, cols: 4 });
    try {
      const p = g.getAttribute('position'),
        n = g.getAttribute('normal');
      const has = (x: number, y: number, z: number) => {
        for (let i = 0; i < p.count; i++)
          if (
            Math.abs(p.getX(i) - x) < 1e-6 &&
            Math.abs(p.getY(i) - y) < 1e-6 &&
            Math.abs(p.getZ(i) - z) < 1e-6
          )
            return true;
        return false;
      };
      for (const row of net)
        for (const [x, y, z] of row) {
          expect(has(x, y, z)).toBe(true);
          expect(has(-x, y, z)).toBe(true);
        }
      for (let i = 0; i < p.count; i++) {
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
        // Centre-seam normals carry no sideways component on either half.
        if (Math.abs(p.getX(i)) < 1e-6) expect(Math.abs(n.getX(i))).toBeLessThan(1e-6);
        // The crown faces up, the right flank faces +X.
        if (p.getY(i) > 0.24) expect(n.getY(i)).toBeGreaterThan(0.5);
        if (p.getX(i) > 0.14 && Math.abs(p.getY(i)) < 0.02) expect(n.getX(i)).toBeGreaterThan(0.8);
      }
    } finally {
      g.dispose();
    }
  });

  it('trims every section at the first excluded point and keeps a regular grid', () => {
    const net: P3[][] = [0, 0.1, 0.2].map((z) => [
      [0, 0.2, z],
      [0.1, 0.1, z],
      [0.1, -0.1, z],
      [0, -0.2, z],
    ]);
    const exclude = (v: T.Vector3) => v.y < 0;
    const g = shellPanelGeometry({ name: 'trim', net, rows: 2, cols: 3, exclude });
    try {
      const p = g.getAttribute('position');
      let lowest = Infinity;
      for (let i = 0; i < p.count; i++) lowest = Math.min(lowest, p.getY(i));
      expect(lowest).toBeGreaterThan(-1e-4);
      expect(lowest).toBeLessThan(1e-3);
    } finally {
      g.dispose();
    }
  });
});

describe('GP race shell R6 on the production models', () => {
  it.each(['gpr1', 'gpr2'] as const)(
    '%s: finite, owned geometry with livery UVs at every LOD and one entrant paint',
    (id) => {
      const materials = new BikeMaterials(3);
      const shells = (['high', 'mid', 'far'] as const).map((detail) =>
        gpRaceBodywork(materials, detail, id, 3),
      );
      try {
        const paint = gpLiveryMaterial(materials, 3, id);
        expect(paint.map).toBeTruthy();
        expect(paint.roughnessMap).toBeTruthy();
        expect(paint.clearcoatMap).toBe(paint.roughnessMap);
        expect(paint.roughnessMap!.colorSpace).toBe(T.NoColorSpace);
        expect(paint.side).toBe(T.DoubleSide);
        expect(materials.list).toContain(paint);
        const triangles = shells.map((shell) => {
          let count = 0;
          shell.root.traverse((o) => {
            if (!(o instanceof T.Mesh)) return;
            const g = o.geometry,
              p = g.getAttribute('position'),
              n = g.getAttribute('normal');
            for (let i = 0; i < p.count; i++) {
              expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
              expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
            }
            if (g.index)
              for (let i = 0; i < g.index.count; i++) expect(g.index.getX(i)).toBeLessThan(p.count);
            count += (g.index?.count ?? p.count) / 3;
          });
          // Every mesh carries UVs: carbon and seat finishes sample maps.
          shell.root.traverse((o) => {
            if (o instanceof T.Mesh) expect(o.geometry.getAttribute('uv')).toBeTruthy();
          });
          for (const part of [shell.body, shell.tank, shell.tail]) {
            expect(part.material).toBe(paint);
            expect(part.geometry.getAttribute('uv')).toBeTruthy();
          }
          return count;
        });
        // Strictly cheaper LODs, and the high shell stays inside the
        // former authored shell's 16.7k-triangle allowance.
        expect(triangles[0]).toBeLessThan(16700);
        expect(triangles[1]).toBeLessThan(triangles[0] * 0.6);
        expect(triangles[2]).toBeLessThan(triangles[1]);
        const again = gpRaceBodywork(materials, 'high', id, 3);
        try {
          expect(again.body.geometry).not.toBe(shells[0].body.geometry);
          expect(again.body.material).toBe(shells[0].body.material);
        } finally {
          release(again.root);
        }
      } finally {
        shells.forEach((shell) => release(shell.root));
        materials.dispose();
      }
    },
  );

  it('paints each entrant separately and keeps the livery inside its atlas', () => {
    const a = new BikeMaterials(0),
      b = new BikeMaterials(1);
    try {
      const pa = gpLiveryMaterial(a, 0, 'gpr1'),
        pb = gpLiveryMaterial(b, 1, 'gpr1');
      expect(pa).not.toBe(pb);
      expect(gpLiveryMaterial(a, 0, 'gpr1')).toBe(pa);
      const shell = gpRaceBodywork(a, 'high', 'gpr1', 0);
      try {
        const uv = shell.body.geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) {
          expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getX(i)).toBeLessThanOrEqual(1);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getY(i)).toBeLessThanOrEqual(1);
        }
      } finally {
        release(shell.root);
      }
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it('keeps the reference proportions: pointed nose, tall screen, low belly, high tail', () => {
    const materials = new BikeMaterials(0);
    const shell = gpRaceBodywork(materials, 'high', 'gpr1', 0);
    try {
      const bounds = (name: string) =>
        new T.Box3().setFromObject(shell.root.getObjectByName(name)!, true);
      const body = bounds('GP race shell / flank and nose'),
        screen = bounds('GP race shell / screen'),
        tail = bounds('GP race shell / tail');
      // Road at y = -0.62: belly ~7 cm above it, screen crown ~1.12 m.
      expect(body.min.y).toBeGreaterThan(-0.56);
      expect(body.min.y).toBeLessThan(-0.53);
      expect(body.max.z).toBeGreaterThan(0.95);
      expect(screen.max.y).toBeGreaterThan(0.49);
      expect(tail.min.z).toBeLessThan(-0.94);
      expect(tail.max.y).toBeGreaterThan(0.4);
      // Narrow tail, wider fairing.
      expect(tail.max.x).toBeLessThan(0.15);
      expect(body.max.x).toBeGreaterThan(0.25);
      expect(body.max.x).toBeLessThan(0.27);
    } finally {
      release(shell.root);
      materials.dispose();
    }
  });

  it('never places painted skin inside the front tyre clearance envelope', () => {
    const materials = new BikeMaterials(0);
    for (const id of ['gpr1', 'gpr2'] as const) {
      const shell = gpRaceBodywork(materials, 'high', id, 0);
      try {
        const p = shell.body.geometry.getAttribute('position'),
          v = new T.Vector3();
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i);
          // Boundary samples sit exactly on the envelope after bisection.
          v.multiplyScalar(1);
          if (gpFrontTyreExclusion(v)) {
            const dz = v.z - 0.7,
              dy = v.y + 0.32;
            expect(Math.hypot(dz, dy)).toBeGreaterThan(0.32);
          }
        }
      } finally {
        release(shell.root);
      }
    }
    materials.dispose();
  });

  it.each(['gpr1', 'gpr2'] as const)(
    '%s: the moving front assembly clears the shell through travel and racing steering lock',
    (id) => {
      const definition = VEHICLES[id],
        spec = definition.bike!,
        materials = new BikeMaterials(0),
        model = new BikeModel(definition, 0, 'high', materials, false);
      try {
        const surfaces: T.Mesh[] = [];
        model.root.traverse((object) => {
          if (
            object instanceof T.Mesh &&
            /^GP race shell \/ (flank and nose|box wings|ground-effect scoops|inner upper fairing)/.test(
              object.name,
            )
          )
            surfaces.push(object);
        });
        // The carbon inner upper fairing sits just ahead of the fork tubes'
        // sweep and must clear them at racing lock and full travel too.
        expect(surfaces.length).toBe(4);
        let steering: T.Object3D | undefined;
        model.root.traverse((object) => {
          if (!(object instanceof T.Mesh) || object.material !== materials.forkUpper) return;
          let parent = object.parent!;
          while (parent.name === 'Batched rigid motorcycle detail') parent = parent.parent!;
          steering ??= parent;
        });
        const moving: T.Mesh[] = [];
        steering!.traverse((object) => {
          // Bars and grips sit behind the fairing at racing lock; the
          // envelope concerns the wheel, fender, fork and brakes below it.
          if (object instanceof T.Mesh) moving.push(object);
        });
        const samples: { fork: number; steer: number; depth: number; worst: unknown }[] = [];
        const lock = 0.35;
        for (const fork of [0, spec.forkTravel / 2, spec.forkTravel])
          for (const steer of [-lock, 0, lock]) {
            model.pose({
              ...staticSag(definition),
              fork,
              steer,
              frontRotation: 0,
              rearRotation: 0,
              chassisLean: 0,
              riderOffset: 0,
              tuck: 1,
              brake: 0,
              rearBrake: 0,
              discTemp: 280,
              compoundColour: 0xffffff,
              riding: true,
            });
            model.root.updateMatrixWorld(true);
            const grid = meshColumnsFor(surfaces, 0.006),
              overlap = meshSurfaceIntrusion(surfaces, moving, grid);
            samples.push({ fork, steer, depth: overlap.maximumDepth, worst: overlap.worst });
          }
        const worst = Math.max(...samples.map((s) => s.depth));
        expect(worst, JSON.stringify(samples)).toBeLessThan(0.004);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
    60000,
  );
});
