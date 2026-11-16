import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

const draws = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh) n++;
  });
  return n;
};

describe('motocross event feather flags', () => {
  it('stands clusters of three on the outdoor turns inside the existing cloth/steel batches', () => {
    const dressing = new MxCourseDressing(rigTrack('valley-ridge-mx'));
    try {
      expect(dressing.stats.flags).toBeGreaterThanOrEqual(9);
      expect(dressing.stats.flags % 3).toBe(0);
      // Merged into the printed-cloth and galvanised-frame batches.
      const cloth = dressing.root.getObjectByName('MX printed woven barriers') as T.Mesh;
      cloth.geometry.computeBoundingBox();
      expect(cloth.geometry.boundingBox!.max.y - cloth.geometry.boundingBox!.min.y).toBeGreaterThan(
        3,
      );
      // The flags add none; the bale and van instances add one each.
      expect(draws(dressing.root)).toBeLessThanOrEqual(16);
      expect(
        Object.values(cloth.geometry.attributes).every((a) =>
          Array.from(a.array).every(Number.isFinite),
        ),
      ).toBe(true);
    } finally {
      dressing.dispose();
    }
  });

  it('stacks bales on the turn outsides and parks vans behind the service canopies, clear of the course', () => {
    const track = rigTrack('valley-ridge-mx'),
      course = (Track.offroadOf(track) as TrackTerrainSurface).course,
      dressing = new MxCourseDressing(track),
      point = trackPoint(),
      m = new T.Matrix4(),
      p = new T.Vector3();
    try {
      expect(dressing.stats.bales).toBeGreaterThan(15);
      expect(dressing.stats.vans).toBeGreaterThan(3);
      for (const [name, margin] of [
        ['MX round straw bales', 0.9],
        ['MX team vans', 5],
      ] as const) {
        const mesh = dressing.root.getObjectByName(name) as T.InstancedMesh;
        expect(mesh).toBeInstanceOf(T.InstancedMesh);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          const lateral = track.nearest(p.x, p.z, point);
          expect(Math.abs(lateral), `${name} ${i}`).toBeGreaterThan(
            course.legalWidth(point.width, point.s, lateral) + margin,
          );
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
      for (const site of dressing.trackside.plan.sites) {
        const vans = dressing.root.getObjectByName('MX team vans') as T.InstancedMesh;
        for (let i = 0; i < vans.count; i++) {
          vans.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          expect(Math.hypot(site.x - p.x, site.z - p.z)).toBeGreaterThan(site.radius + 2.5);
        }
      }
    } finally {
      dressing.dispose();
    }
  });

  it('leaves the indoor stadium without flags', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    try {
      expect(dressing.stats.flags).toBe(0);
      expect(dressing.stats.bales + dressing.stats.vans).toBe(0);
    } finally {
      dressing.dispose();
    }
  });
});
