import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { gpBankGrass } from '../src/rendering/vegetation/grass.ts';
import { GpWindSleeve } from '../src/rendering/venue-kit/gp-windsock.ts';
import { GpRailUmbrellas } from '../src/rendering/venue-kit/gp-rail-umbrellas.ts';
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
import { apronWidth } from '../src/simulation/gp-course-edges.ts';

describe('GP general-admission viewing banks', () => {
  it('deploys the sewn canopies from the rail and preserves their clamps in a reversible crosswind', () => {
    const group = new GpRailUmbrellas([new T.Vector3(1,.9,10),new T.Vector3(1,1,16)],-1,47);
    const mesh=group.mesh, probe=new T.Mesh(mesh.geometry,mesh.material), g=mesh.geometry;
    const b=g.getAttribute('position'), cloth=g.getAttribute('gpUmbrellaFabric');
    const wind=new T.Vector4(8,3,10,.7), fabric:number[]=[], clamps:number[]=[];
    for(let i=0;i<b.count;i++) {
      if(cloth.getX(i)>0) fabric.push(i);
      else if(b.getY(i)<-.05) clamps.push(i);
    }
    function width() {
      mesh.getMorphAt(0,probe);
      const box=new T.Box3(), p=new T.Vector3();
      for(const i of fabric) box.expandByPoint(probe.getVertexPosition(i,p));
      return box.max.z-box.min.z;
    }
    group.presentWorld(0,wind);
    expect(width()).toBeLessThan(.13);
    group.presentWorld(18,wind);
    expect(width()).toBeGreaterThan(1.2);
    const wet=Array.from(probe.morphTargetInfluences!), version=mesh.morphTexture!.version;
    group.presentWorld(18,wind);
    expect(mesh.morphTexture!.version).toBe(version);
    const p=new T.Vector3();
    for(const i of clamps) expect(probe.getVertexPosition(i,p).distanceTo(new T.Vector3().fromBufferAttribute(b,i))).toBeLessThan(1e-6);
    group.presentWorld(18,new T.Vector4(-8,-3,10,.7));
    mesh.getMorphAt(0,probe);
    expect(probe.morphTargetInfluences![1]).toBeCloseTo(-wet[1],6);
    expect(probe.morphTargetInfluences![2]).toBeCloseTo(-wet[2],6);
    group.presentWorld(18,wind);mesh.getMorphAt(0,probe);
    expect(probe.morphTargetInfluences).toEqual(wet);
    group.presentWorld(0,wind);expect(width()).toBeLessThan(.13);
    mesh.dispose();g.dispose();(mesh.material as T.Material).dispose();
  });
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
          const meadow = gpBankGrass({ site, height }, 8, 4, 0.3);
          expect(meadow.length).toBeGreaterThan(80);
          expect(meadow.length).toBeLessThan(310);
          for (const clump of meadow) {
            const dx = clump.x - site.x,
              dz = clump.z - site.z;
            const x = c * dx - n * dz,
              z = n * dx + c * dz;
            expect(Math.abs(x)).toBeGreaterThan(site.width * 0.345);
            expect(Math.abs(z - 3)).toBeGreaterThanOrEqual(2.5);
            expect(clump.y).toBeCloseTo(height(x, z) - 0.012, 5);
            expect(clump.tile).toBeGreaterThanOrEqual(0);
            expect(clump.tile).toBeLessThan(8);
          }
          expect(gpBankGrass({ site, height }, 8, 4, 0.3)).toEqual(meadow);
          const positions = geometry.getAttribute('position'),
            normals = geometry.getAttribute('normal');
          expect(inGpSpectatorBank(sites, site.x, site.z, 0)).toBe(true);
          for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i),
              z = positions.getZ(i),
              wx = site.x + c * x + n * z,
              wz = site.z - n * x + c * z;
            const l = track.nearest(wx, wz, near);
            const uv = geometry.getAttribute('uv');
            expect(uv.getX(i) * 5).toBeCloseTo(l, 2);
            const unwrapped = uv.getY(i) * 5 - near.s;
            expect(unwrapped - Math.round(unwrapped / track.length) * track.length).toBeCloseTo(
              0,
              2,
            );
            expect(geometry.getAttribute('edgeMetres').getX(i)).toBeCloseTo(
              Math.abs(l) - near.width,
              2,
            );
            expect(geometry.getAttribute('gpVergeInset').getX(i)).toBeCloseTo(
              4 - apronWidth(track.gpEdges!.at(near.s, l < 0 ? -1 : 1)),
              3,
            );
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

describe('recorded wind at the GP viewing bank', () => {
  it('suspends a circular mouth and a tapered, drooping outlet under the actual wind vector', () => {
    const cone = new GpWindSleeve(),
      g = cone.mesh.geometry,
      p = g.getAttribute('position') as T.BufferAttribute,
      n = g.getAttribute('normal'),
      point = new T.Vector3(),
      radius = g.boundingSphere!.radius;
    const ring = (row: number) => {
      const centre = new T.Vector3();
      for (let j = 0; j < 14; j++) centre.add(point.fromBufferAttribute(p, row * 14 + j));
      return centre.multiplyScalar(1 / 14);
    };
    const mouth = ring(0),
      calm = ring(19);
    expect(calm.y).toBeLessThan(-2.1);
    expect(calm.x).toBeCloseTo(0, 5);
    expect(mouth.length()).toBeCloseTo(0.42, 5);
    cone.present(9, 0, 7.25, 0.8);
    const east = ring(19),
      snapshot = p.array.slice(),
      version = p.version;
    expect(east.x).toBeGreaterThan(2);
    expect(east.y).toBeGreaterThan(calm.y + 1.2);
    for (let i = 0; i < p.count; i++) {
      expect(point.fromBufferAttribute(p, i).length()).toBeLessThan(radius);
      expect(point.fromBufferAttribute(n, i).length()).toBeCloseTo(1, 5);
    }
    cone.present(9, 0, 7.25, 0.8);
    expect(p.version).toBe(version);
    cone.present(-9, 0, 7.25, 0.8);
    expect(ring(19).x).toBeCloseTo(-east.x, 4);
    cone.present(9, 0, 7.25, 0.8);
    expect(p.array).toEqual(snapshot);
    cone.present(NaN, 0, NaN, NaN);
    expect(ring(19).distanceTo(calm)).toBeLessThan(0.00001);
    (cone.mesh.material as T.Material).dispose();
    g.dispose();
  });
});
