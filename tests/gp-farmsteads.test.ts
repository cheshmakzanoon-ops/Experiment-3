import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { drawnTerrain, terrainFor } from '../src/rendering/terrain.ts';
import {
  gpFarmsteadPlan,
  inGpFarmstead,
  buildGpFarmsteads,
} from '../src/rendering/venue-kit/gp-farmsteads.ts';
import { grovePlan, vegetationPlan } from '../src/rendering/landscape.ts';

describe('rural GP circuit architecture', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s places low-cost buildings on visible ground outside the venue',
    (id) => {
      const t = new Track('clear', false, undefined, CIRCUITS[id]),
        sites = gpFarmsteadPlan(t);
      const root = new T.Group(),
        p = trackPoint(),
        terrain = drawnTerrain(t),
        sea = terrainFor(t).seaLevel;
      expect(gpFarmsteadPlan(t)).toBe(sites);
      expect(sites.length).toBeGreaterThanOrEqual(2);
      buildGpFarmsteads(t, root);
      expect(root.children).toHaveLength(sites.length);
      const materials = new Set<T.Material>();
      for (const [i, site] of sites.entries()) {
        expect(terrain.height(site.x, site.z)).toBeCloseTo(site.y, 6);
        if (sea !== null) expect(site.y).toBeGreaterThan(sea + 5);
        t.nearest(site.x, site.z, p);
        expect(Math.hypot(p.x - site.x, p.z - site.z)).toBeGreaterThanOrEqual(100);
        const item = root.children[i] as T.Mesh,
          g = item.geometry,
          normal = g.getAttribute('normal'),
          index = g.index!;
        expect(item.castShadow).toBe(false);
        expect(index.count / 3).toBeLessThan(1200);
        expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
        // Roof faces, gables and all four sides must be present with finite normals.
        const ns = new T.Vector3();
        let upwardRoof = 0;
        for (let j = 0; j < normal.count; j++) {
          ns.fromBufferAttribute(normal, j);
          expect(ns.length()).toBeCloseTo(1, 4);
          if (ns.y > 0.45 && ns.y < 0.99) upwardRoof++;
        }
        expect(upwardRoof).toBeGreaterThan(10);
        materials.add(item.material as T.Material);
        g.dispose();
      }
      expect(materials.size).toBe(1);
      materials.forEach((m) => m.dispose());
      const grove = grovePlan(t);
      for (const tree of [...vegetationPlan(t), ...grove.groves, ...grove.treeline]) {
        expect(inGpFarmstead(sites, tree.x, tree.z, 3)).toBe(false);
      }
    },
  );
  it('leaves ordinary road venues free of GP farm structures', () => {
    const t = new Track();
    expect(gpFarmsteadPlan(t)).toHaveLength(0);
  });
});
