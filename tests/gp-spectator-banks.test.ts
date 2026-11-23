import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  gpSpectatorBankPlan,
  inGpSpectatorBank,
} from '../src/rendering/venue-kit/gp-spectator-bank-sites.ts';
import {
  gpBankSurface,
  buildGpSpectatorBank,
} from '../src/rendering/venue-kit/gp-spectator-banks.ts';
import { cataloguePlantingGround } from '../src/rendering/venue-kit/planting-ground.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { CrowdCluster } from '../src/rendering/crowd.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('GP general-admission viewing banks', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s sites and feet follow the drawn lawn outside every racing corridor',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      const sites = gpSpectatorBankPlan(track),
        near = trackPoint(),
        base = cataloguePlantingGround(track);
      expect(sites).toHaveLength(2);
      expect(gpSpectatorBankPlan(track)).toBe(sites);
      const [a, b] = sites;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(120);
      const material = new T.MeshStandardMaterial();
      try {
        for (const site of sites) {
          const c = Math.cos(site.yaw),
            n = Math.sin(site.yaw);
          const { geometry, height } = gpBankSurface(track, site);
          const positions = geometry.getAttribute('position'),
            normals = geometry.getAttribute('normal');
          expect(inGpSpectatorBank(sites, site.x, site.z, 0)).toBe(true);
          for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i),
              z = positions.getZ(i),
              wx = site.x + c * x + n * z,
              wz = site.z - n * x + c * z;
            const l = track.nearest(wx, wz, near);
            expect(Math.abs(l) - track.boundaryAt(near, l < 0 ? -1 : 1)).toBeGreaterThan(8);
            expect(inStandFootprint(track, wx, wz, 3)).toBe(false);
            expect(normals.getY(i)).toBeGreaterThan(0.5);
            expect(height(x, z)).toBeCloseTo(positions.getY(i), 4);
            expect(positions.getY(i) - base(near.s, l, wx, wz)).toBeLessThan(site.rise + 0.02);
          }
          const props = new T.Group(),
            fans = new T.Group(),
            clusters: CrowdCluster[] = [];
          buildGpSpectatorBank(track, site, props, fans, clusters, material, material, material);
          const crowd = clusters[0].levels[0],
            styles = crowd.geometry.getAttribute('spectatorStyle');
          expect(crowd.count).toBeGreaterThan(85);
          expect(crowd.count).toBeLessThan(195);
          expect(fans.getObjectByName('Spectator team flags')).toBeDefined();
          const pose = new T.Matrix4(),
            foot = new T.Vector3(),
            ray = new T.Raycaster(),
            down = new T.Vector3(0, -1, 0);
          const lawn = new T.Mesh(geometry, material);
          for (let i = 0; i < crowd.count; i++) {
            crowd.getMatrixAt(i, pose);
            foot.set(-0.47, -0.3, 0).applyMatrix4(pose);
            expect(styles.getZ(i)).toBe(1);
            expect(height(foot.x, foot.z)).toBeCloseTo(foot.y, 4);
            if (i % 16 === 0) {
              ray.set(foot.clone().addScaledVector(down, -2), down);
              expect(ray.intersectObject(lawn)[0].point.y).toBeCloseTo(foot.y, 4);
            }
          }
          props.traverse((o) => {
            if (o instanceof T.Mesh) o.geometry.dispose();
          });
          fans.traverse((o) => {
            if (!(o instanceof T.Mesh)) return;
            o.geometry.dispose();
            if (o instanceof T.InstancedMesh) o.dispose();
            if (o.parent === clusters[0].root) {
              o.material.dispose();
              o.customDepthMaterial?.dispose();
              o.customDistanceMaterial?.dispose();
            }
          });
          geometry.dispose();
        }
      } finally {
        material.dispose();
      }
    },
  );
  it('leaves the other championships to their authored stands', () => {
    expect(gpSpectatorBankPlan(new Track('clear', false, undefined, CIRCUITS.aurel))).toEqual([]);
  });
});
