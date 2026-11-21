import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { apronWidth, GP_KERB_WIDTH } from '../src/simulation/gp-course-edges.ts';
import {
  buildTrackInfrastructure,
  drainGratingGeometry,
  trackInfrastructurePlan,
} from '../src/rendering/track-infrastructure.ts';

describe('GP shoulder drains', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s fits every grate between the kerb and the native verge',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      const p = trackPoint();
      for (const site of trackInfrastructurePlan(track).drains) {
        track.at(site.s, p);
        const amount = track.gpEdges!.at(site.s, site.side);
        const half = 0.21 * (0.72 + 0.28 * amount);
        const across = Math.abs(site.lateral) - p.width;
        expect(across - half).toBeGreaterThan(GP_KERB_WIDTH * amount);
        expect(across + half).toBeLessThan(apronWidth(amount));
      }
    },
  );
  it('draws the slotted metal and beds in bounded sectors, clear of the pavement', () => {
    const track = new Track('rain', false, undefined, CIRCUITS['poggio-alto']);
    const plan = trackInfrastructurePlan(track);
    const root = new T.Group(),
      safety = new T.MeshStandardMaterial();
    buildTrackInfrastructure(track, root, safety, {
      ...plan,
      marshalPosts: [],
      utilities: [],
      cameras: [],
    });
    const sectors = root.children.filter((o) => o.name.startsWith('GP shoulder drainage sector'));
    expect(sectors.length).toBeLessThan(plan.drains.length / 2);
    for (const sector of sectors) {
      expect(sector.children).toHaveLength(2);
      for (const mesh of sector.children as T.Mesh[]) {
        expect(mesh.castShadow).toBe(false);
        expect(mesh.geometry.boundingSphere!.radius).toBeLessThan(125);
      }
    }
    const site = plan.drains.find((s) => track.gpEdges!.at(s.s, s.side) === 0)!;
    const { grate, bed } = drainGratingGeometry(track, site);
    const wp = new T.Vector3(),
      p = trackPoint();
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), site.yaw);
    for (const geometry of [grate, bed]) {
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        wp.fromBufferAttribute(positions, i).applyQuaternion(q);
        wp.x += site.x;
        wp.y += site.y;
        wp.z += site.z;
        const l = track.nearest(wp.x, wp.z, p);
        const above = wp.y - (p.y + p.bank * Math.max(-12, Math.min(12, l)) - 0.008);
        expect(above).toBeGreaterThan(0);
        expect(above).toBeLessThan(0.008);
      }
      geometry.dispose();
    }
    const materials = new Set<T.Material>();
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        materials.add(o.material as T.Material);
      }
    });
    materials.forEach((m) => m.dispose());
    safety.dispose();
  });
});
