import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import {
  GP_TAIL_LAMP_Z,
  gpTailLampY,
  gpFrontTyreExclusion,
  gpLiveryMaterial,
  gpRaceBodywork,
} from '../src/rendering/gp-race-bodywork.ts';
import { gpAerofoil } from '../src/rendering/gp-aerofoil.ts';
import { liveryUv, shellPanelGeometry, type P3 } from '../src/rendering/gp-race-shell.ts';
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
  it('keeps mirrored atlas charts separate across a smooth welded crown', () => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([
      0, .3, -.4, .06, .28, -.28, 0, .3, -.2, -.06, .28, -.28,
    ], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    const n = new T.Vector3().fromBufferAttribute(g.getAttribute('normal'), 0);
    liveryUv(g);
    const index = g.index!, uv = g.getAttribute('uv'), normal = g.getAttribute('normal');
    expect(index.count).toBe(6);
    for (let k = 0; k < 3; k++) expect(uv.getX(index.getX(k))).toBeLessThan(.5);
    for (let k = 3; k < 6; k++) expect(uv.getX(index.getX(k))).toBeGreaterThan(.5);
    expect(new T.Vector3().fromBufferAttribute(normal, index.getX(3)).distanceTo(n)).toBe(0);
    expect(uv.getX(index.getX(0)) + uv.getX(index.getX(3))).toBeCloseTo(1);
    g.dispose();
  });

  it('faces the painted exterior outward and closes the ends of a tapered aerofoil', () => {
    const foil = gpAerofoil([[0, 0, 0], [0.15, 0, 0], [0.3, 0, 0]], 0.18, 0.12, 6, 16, 0.08);
    const surface = new T.Mesh(foil, new T.MeshBasicMaterial({ side: T.FrontSide }));
    const down = new T.Vector3(0, -1, 0);
    const cast = (x: number, z: number) =>
      new T.Raycaster(new T.Vector3(x, 0.1, z), down).intersectObject(surface)[0];
    // At the same distance from each end of the chord a NACA section is
    // fuller at its nose. A reversed section still passes a bounds test.
    const chord = 0.13;
    const nose = cast(0.15, (0.65 - 0.15) * chord);
    const tail = cast(0.15, (0.65 - 0.85) * chord);
    expect(nose.point.y).toBeGreaterThan(tail.point.y * 1.9);
    expect(nose.face!.normal.y).toBeGreaterThan(0.9);
    for (const [x, direction] of [[-0.01, 1], [0.31, -1]]) {
      const hit = new T.Raycaster(new T.Vector3(x, 0.0005, 0.002), new T.Vector3(direction, 0, 0))
        .intersectObject(surface)[0];
      expect(hit.distance).toBeCloseTo(0.01);
      expect(hit.face!.normal.x).toBeCloseTo(-direction);
    }
    foil.dispose();
    surface.material.dispose();
  });

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
  it.each(['gpr1', 'gpr2'] as const)('%s exposes the recessed rear lamp seat at every LOD', (id) => {
    const m = new BikeMaterials(0);
    try {
      for (const detail of ['high', 'mid', 'far'] as const) {
        const shell = gpRaceBodywork(m, detail, id, 0);
        try {
          const lining = shell.root.getObjectByName('GP race shell / ram-air mouth')!;
          for (const x of [-.027, .027]) {
            const ray = new T.Raycaster(new T.Vector3(x, gpTailLampY(id === 'gpr2'), -1.1), new T.Vector3(0, 0, 1));
            const wall = ray.intersectObject(lining)[0];
            expect(wall.point.z).toBeCloseTo(GP_TAIL_LAMP_Z, 4);
            expect(wall.face!.normal.z).toBeLessThan(-.9);
            expect(ray.intersectObject(shell.tail)[0]?.point.z ?? 0).toBeGreaterThan(wall.point.z);
          }
          shell.tail.geometry.computeBoundingBox();
          expect(GP_TAIL_LAMP_Z - shell.tail.geometry.boundingBox!.min.z).toBeGreaterThan(.035);
        } finally {
          release(shell.root);
        }
      }
    } finally {
      m.dispose();
    }
  });

  it.each(['gpr1', 'gpr2'] as const)('%s presents the front number to an approaching camera', (id) => {
    const m = new BikeMaterials(3);
    for (const detail of ['high', 'mid'] as const) {
      const shell = gpRaceBodywork(m, detail, id, 3);
      const number = shell.root.getObjectByName('GP race shell / nose number') as T.Mesh;
      const ray = new T.Raycaster(new T.Vector3(0,.20,2),new T.Vector3(0,0,-1));
      let visibleRows = 0;
      for (let y=.19;y<.275;y+=.004) {
        ray.ray.origin.set(.01,y,2);
        const hit=ray.intersectObject(number)[0], surface=ray.intersectObject(shell.body)[0];
        if(hit?.uv && surface && hit.uv.y > .15 && hit.uv.y < .85 && Math.abs(surface.point.z-hit.point.z)<.002)
          visibleRows++;
      }
      expect(visibleRows).toBeGreaterThanOrEqual(9);
      release(shell.root);
    }
    m.dispose();
  });

  it.each(['gpr1', 'gpr2'] as const)('%s keeps the nose inlet open through its drawn LODs', (id) => {
    const m = new BikeMaterials(0);
    try {
      for (const detail of ['high', 'mid', 'far'] as const) {
        const shell = gpRaceBodywork(m, detail, id, 0);
        try {
          const duct = shell.root.getObjectByName('GP race shell / ram-air mouth')!;
          // Off-centre rays miss the R2 divider. Paint at the mouth would make
          // the dark liner invisible even if the geometry were present.
          for (const x of [-.025, .025]) {
            const ray = new T.Raycaster(new T.Vector3(x, .133, 1.1), new T.Vector3(0, 0, -1));
            const back = ray.intersectObject(duct)[0];
            expect(back.point.z).toBeGreaterThan(.83);
            expect(back.point.z).toBeLessThan(.875);
            expect(back.face!.normal.z).toBeGreaterThan(.5);
            const paint = ray.intersectObject(shell.body)[0];
            expect(paint?.point.z ?? 0).toBeLessThan(back.point.z);
          }
          const centre = new T.Raycaster(new T.Vector3(0, .134, 1.1), new T.Vector3(0, 0, -1));
          const front = centre.intersectObject(duct)[0];
          expect(front.point.z > .9).toBe(id === 'gpr2');
        } finally {
          release(shell.root);
        }
      }
    } finally {
      m.dispose();
    }
  });

  it.each(['gpr1', 'gpr2'] as const)(
    '%s has recessed exit ducts on both flanks and attached aerofoils across LODs',
    (id) => {
      const m = new BikeMaterials(0);
      try {
        for (const detail of ['high', 'mid', 'far'] as const) {
          const shell = gpRaceBodywork(m, detail, id, 0);
          shell.root.updateMatrixWorld(true);
          try {
            const wing = shell.root.getObjectByName('GP race shell / box wings') as T.Mesh;
            const p = wing.geometry.getAttribute('position'),
              ray = new T.Raycaster();
            const shoot = (side: number, y: number, z: number, object: T.Object3D) => {
              ray.set(new T.Vector3(side, y, z), new T.Vector3(-side, 0, 0));
              return ray.intersectObject(object)[0]?.point;
            };
            for (const side of [-1, 1]) {
              let upper = false,
                lower = false,
                tip = 0;
              for (let i = 0; i < p.count; i++) {
                const x = p.getX(i) * side,
                  y = p.getY(i),
                  z = p.getZ(i);
                if (x < 0) continue;
                tip = Math.max(tip, x);
                if (x > 0.24 || (upper && lower)) continue;
                const wall = shoot(side, y, z, shell.body);
                if (wall && side * wall.x - x > 0.002) {
                  if (y > 0.075) upper = true;
                  if (y < 0.036) lower = true;
                }
              }
              expect(upper && lower, detail + ' aero return is fixed at both ends').toBe(true);
              expect(tip).toBeGreaterThan(0.29);
              if (detail === 'far') continue;
              const liner = shell.root.getObjectByName('GP race shell / ram-air mouth')!;
              const blades = shell.root.getObjectByName('GP race shell / ground-effect scoops')!;
              const cut = (v: number) => {
                const u = 0.5;
                return [-0.066 + 0.013 * u + 0.171 * v, 0.226 + 0.136 * u + 0.052 * v] as const;
              };
              const [gy, gz] = cut(0.12),
                [by, bz] = cut(1 / (id === 'gpr2' ? 4 : 5));
              expect(shoot(side, gy, gz, shell.body)?.x ?? 0).toBeCloseTo(0, 4);
              const back = shoot(side, gy, gz, liner)!;
              expect(side * back.x).toBeGreaterThan(0.13);
              expect(shoot(side, gy, gz, blades)).toBeUndefined();
              const front = shoot(side, by, bz, blades)!;
              expect((front.x - shoot(side, by, bz, liner)!.x) * side).toBeGreaterThan(0.017);
            }
          } finally {
            shell.root.traverse((o) => {
              if (o instanceof T.Mesh) o.geometry.dispose();
            });
          }
        }
      } finally {
        m.dispose();
      }
    },
  );
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
