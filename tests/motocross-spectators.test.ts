import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import {
  MX_SPECTATOR_SETBACK,
  MxSpectators,
  planMxSpectators,
} from '../src/rendering/offroad/mx-spectators.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

afterEach(() => setMxQuality('high'));

describe('MX spectators and flag marshals', () => {
  it('stands onlookers beside the course, outside its run-off and clear of the furniture', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      dressing = new MxCourseDressing(track),
      sites = dressing.trackside.plan.sites,
      plan = planMxSpectators(track, sites),
      nearest = trackPoint();
    try {
      expect(plan.groups).toBeGreaterThan(15);
      expect(plan.placements.filter((p) => p.kind === 'spectator').length).toBeGreaterThan(80);
      expect(plan.placements.filter((p) => p.kind === 'marshal').length).toBeGreaterThan(0);
      for (const p of plan.placements) {
        const lateral = track.nearest(p.x, p.z, nearest);
        const edge = surface.course.legalWidth(nearest.width, nearest.s, lateral);
        expect(Math.abs(lateral)).toBeGreaterThan(
          edge + (p.kind === 'marshal' ? 0.8 : MX_SPECTATOR_SETBACK - 0.05),
        );
        expect(Number.isFinite(p.y)).toBe(true);
        for (const site of sites)
          if (!(p.kind === 'marshal' && Math.hypot(site.x - p.x, site.z - p.z) < 1.4))
            expect(Math.hypot(site.x - p.x, site.z - p.z)).toBeGreaterThan(site.radius);
      }
      // Deterministic, and no two people share a spot.
      expect(planMxSpectators(track, sites).placements).toEqual(plan.placements);
      for (let i = 0; i < plan.placements.length; i += 3)
        for (let j = i + 1; j < plan.placements.length; j += 5)
          expect(
            Math.hypot(
              plan.placements[i].x - plan.placements[j].x,
              plan.placements[i].z - plan.placements[j].z,
            ),
          ).toBeGreaterThan(0.4);
    } finally {
      dressing.dispose();
    }
  });

  it('keeps the indoor arena to its own bowl crowd', () => {
    const track = rigTrack('arena-nord-sx');
    expect(planMxSpectators(track, []).placements).toHaveLength(0);
    const none = new MxSpectators(track, []);
    expect(none.root.children).toHaveLength(0);
    none.dispose();
  });

  it('builds standing instanced crowds per stretch of course and one flag draw, thinned on Low and Medium', () => {
    const track = rigTrack('valley-ridge-mx'),
      dressing = new MxCourseDressing(track),
      crowd = new MxSpectators(track, dressing.trackside.plan.sites);
    try {
      const people = crowd.root.children.filter(
        (o): o is T.InstancedMesh => o instanceof T.InstancedMesh,
      );
      expect(people.length).toBeGreaterThan(3);
      expect(people.length).toBe(crowd.stats.draws);
      expect(people.length).toBeLessThan(16);
      const total = people.reduce((n, m) => n + m.count, 0);
      expect(total).toBe(crowd.stats.spectators + crowd.stats.marshals);
      for (const mesh of people) {
        const style = mesh.geometry.getAttribute('spectatorStyle') as T.InstancedBufferAttribute;
        // Everyone stands (style z), nobody floats in a seated pose.
        for (let i = 0; i < style.count; i++) expect(style.getZ(i)).toBe(1);
        expect(mesh.customDepthMaterial).toBeDefined();
        expect(mesh.instanceColor).not.toBeNull();
      }
      expect(crowd.root.getObjectByName('MX marshal signal flags and poles')).toBeDefined();
      const drawn = () => people.reduce((n, m) => n + m.count, 0);
      setMxQuality('medium');
      expect(drawn()).toBeLessThan(total * 0.5);
      expect(drawn()).toBeGreaterThan(total * 0.2);
      setMxQuality('high');
      expect(drawn()).toBe(total);
      crowd.update(12.3);
      crowd.update(Number.NaN);
      expect(crowd.stats.triangles).toBeGreaterThan(100_000);
      expect(crowd.stats.triangles).toBeLessThan(900_000);
    } finally {
      crowd.dispose();
      dressing.dispose();
    }
  });
});
