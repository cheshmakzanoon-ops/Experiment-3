import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { BikeMaterials, BikeModel } from '../src/rendering/bike.ts';
import { bikeSheetFor, SHELL_SCHEME } from '../src/rendering/bike-sheet.ts';
import { LIVERIES } from '../src/simulation/config.ts';

/** D5: SS-600 and SBK-1000 were an egg-shaped cowl over the forks and half the
 * tank on a black belly pan; CR-750 a bulbous shell around its fork. The sport
 * bikes now wear the GP race shell's moulding set (nose, tank, tail, screen,
 * ram-air mouth, inner fairing) without the prototypes' box wings and
 * ground-effect scoops; the classic bike a bullet half-fairing ahead of the
 * fork. Canvas textures are stubbed: geometry and structure are measured. */
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

const names = (root: T.Object3D) => {
  const out: string[] = [];
  root.traverse((o) => out.push(o.name));
  return out;
};
const triangles = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};
const release = (root: T.Object3D) =>
  root.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
function build(id: string, detail: 'high' | 'mid' | 'far' = 'high') {
  const materials = new BikeMaterials(SHELL_SCHEME[id] ?? 0);
  const model = new BikeModel(VEHICLES[id], SHELL_SCHEME[id] ?? 0, detail, materials, true);
  return {
    model,
    materials,
    done: () => {
      release(model.root);
      materials.dispose();
    },
  };
}
function screenTop(root: T.Object3D) {
  const mesh = root.getObjectByName('GP race shell / screen') as T.Mesh;
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.max.y;
}

describe('sport and classic bike fairings (D5)', () => {
  it.each(['ss600', 'sbk1000'])(
    '%s wears the GP race shell without wings or scoops, and not the old egg cowl',
    (id) => {
      const { model, done } = build(id);
      try {
        const all = names(model.root);
        expect(all).toContain('GP race shell R6 sport (high)');
        for (const part of [
          'flank and nose',
          'tank',
          'tail',
          'screen',
          'ram-air mouth',
          'seat pad',
          'inner upper fairing',
        ])
          expect(all, part).toContain(`GP race shell / ${part}`);
        // No prototype aero, no instrument cowl or black belly pan of the old build.
        expect(all.some((n) => n.includes('box wings'))).toBe(false);
        expect(all.some((n) => n.includes('ground-effect scoops'))).toBe(false);
        expect(all.some((n) => n.startsWith('Open motorcycle instrument cowl'))).toBe(false);
        // The shell owns the tank and tail; the road bike keeps its own engine, rider
        // and exhaust, so it is not a GP prototype (no GP rear-chassis undertail).
        expect(all.some((n) => n.includes('GP enclosed carbon undertail'))).toBe(false);
      } finally {
        done();
      }
    },
  );

  it('keeps the GP prototypes exactly as they were: shell, wings and scoops', () => {
    for (const id of ['gpr1', 'gpr2']) {
      const { model, done } = build(id);
      try {
        const all = names(model.root);
        expect(all).toContain(`GP race shell R6 ${id} (high)`);
        expect(all.some((n) => n.includes('box wings'))).toBe(true);
        expect(all.some((n) => n.includes('ground-effect scoops'))).toBe(true);
      } finally {
        done();
      }
    }
  });

  it('follows the sheet for the screen and the machine scheme for the paint', () => {
    expect(bikeSheetFor(VEHICLES.ss600).screen).toBeGreaterThan(
      bikeSheetFor(VEHICLES.sbk1000).screen,
    );
    const ss = build('ss600'),
      sbk = build('sbk1000');
    try {
      expect(screenTop(ss.model.root)).toBeGreaterThan(screenTop(sbk.model.root) + 0.01);
    } finally {
      ss.done();
      sbk.done();
    }
    // The player's two sport bikes are not the prototypes' team red (scheme 0) or each other.
    expect(SHELL_SCHEME.ss600).not.toBe(0);
    expect(SHELL_SCHEME.sbk1000).not.toBe(0);
    expect(SHELL_SCHEME.ss600).not.toBe(SHELL_SCHEME.sbk1000);
    for (const scheme of Object.values(SHELL_SCHEME)) expect(scheme).toBeLessThan(LIVERIES.length);
    const paint = new BikeMaterials(SHELL_SCHEME.ss600).paint.color.getHex();
    expect(paint).toBe(LIVERIES[SHELL_SCHEME.ss600]);
  });

  it('stays inside the GP prototypes triangle budget at every LOD', () => {
    for (const id of ['ss600', 'sbk1000']) {
      const counts = (['high', 'mid', 'far'] as const).map((detail) => {
        const { model, done } = build(id, detail);
        const n = triangles(model.root);
        done();
        return n;
      });
      expect(counts[0], id).toBeLessThan(110000);
      expect(counts[1], id).toBeLessThan(counts[0]);
      expect(counts[2], id).toBeLessThan(counts[1]);
    }
  });

  it('gives the classic bike a bullet fairing ahead of the fork, not an egg around it', () => {
    expect(bikeSheetFor(VEHICLES.cr750).screen).toBe(0);
    expect(bikeSheetFor(VEHICLES.cr750).fairing).toBe('classic');
    const { model, materials, done } = build('cr750');
    try {
      model.root.updateMatrixWorld(true);
      // Side view through the fork (z ~ 0.5 at headlamp height): the first thing a ray
      // from the side meets is a fork leg, not fairing paint. The old egg covered it.
      const first = (z: number, y: number, x: number) => {
        const ray = new T.Raycaster(
          new T.Vector3(x * 1.5, y, z),
          new T.Vector3(-Math.sign(x), 0, 0),
          0,
          3,
        );
        return ray.intersectObject(model.root, true)[0];
      };
      for (const z of [0.46, 0.5, 0.54])
        for (const x of [1, -1]) {
          const hit = first(z, 0.12, x);
          expect(hit, `fork z=${z} side ${x}`).toBeDefined();
          expect(hit.object instanceof T.Mesh && hit.object.material === materials.paint).toBe(
            false,
          );
        }
      // Head-on at headlamp height the bullet is the first thing met: ahead of the axle, compact.
      const head = new T.Raycaster(
        new T.Vector3(0, 0.14, 3),
        new T.Vector3(0, 0, -1),
        0,
        4,
      ).intersectObject(model.root, true)[0];
      expect(head).toBeDefined();
      expect(head.point.z).toBeGreaterThan(0.88);
      expect(head.point.z).toBeLessThan(1.0);
      // The sheet has no screen, so the transmissive windscreen is not built.
      let screens = 0;
      model.root.traverse((o) => {
        if (o instanceof T.Mesh && o.material === materials.screen) screens++;
      });
      expect(screens).toBe(0);
    } finally {
      done();
    }
  });
});
