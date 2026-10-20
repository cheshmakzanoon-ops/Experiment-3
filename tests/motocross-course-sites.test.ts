import { describe, expect, it } from 'vitest';
import {
  MX_COURSE_SITE_HEIGHT,
  planMxCourseSites,
} from '../src/rendering/offroad/mx-course-sites.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import {
  mxFurnitureGround,
  planMxTracksideFurniture,
} from '../src/rendering/offroad/mx-trackside-furniture.ts';
import { STADIUM } from '../src/rendering/offroad/stadium-dimensions.ts';
import { tracksideRigs } from '../src/rendering/trackside.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { mod } from '../src/core/math.ts';

describe('surveyed motocross landmarks and jump guides', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s keeps complete site envelopes behind all lanes and away from occupied ground',
    (id) => {
      const track = rigTrack(id),
        surface = Track.offroadOf(track) as TrackTerrainSurface,
        before = surface.terrain.hash(),
        plan = planMxCourseSites(track),
        all = [...plan.landmarks, ...plan.guides],
        furniture = planMxTracksideFurniture(track).sites,
        cameras = tracksideRigs(track),
        p = trackPoint();
      expect(all.length).toBeGreaterThan(0);
      expect(plan.rejected).toBeGreaterThan(0);
      expect(surface.terrain.hash()).toBe(before);
      let clearance = Infinity;
      for (const site of all) {
        expect([site.x, site.y, site.z, site.yaw, site.station].every(Number.isFinite)).toBe(true);
        expect(inStandFootprint(track, site.x, site.z, site.radius + 0.8)).toBe(false);
        expect(site.y).toBeGreaterThan(mxFurnitureGround(track, site.x, site.z));
        for (const occupied of furniture)
          expect(Math.hypot(site.x - occupied.x, site.z - occupied.z)).toBeGreaterThanOrEqual(
            site.radius + occupied.radius + 1,
          );
        for (const camera of cameras)
          expect(
            Math.hypot(site.x - camera.position.x, site.z - camera.position.z),
          ).toBeGreaterThanOrEqual(site.radius + 2.4);
        // A separate half-metre survey of the real track includes adjacent
        // lanes and interpolated widths, instead of reading planner flags.
        for (let s = 0; s < track.length; s += 0.5) {
          track.at(s, p);
          const width = Math.max(
            track.boundaryAt(p, -1),
            track.boundaryAt(p, 1),
            surface.course.legalWidth(p.width, s, -1),
            surface.course.legalWidth(p.width, s, 1),
          );
          clearance = Math.min(
            clearance,
            Math.hypot(site.x - p.x, site.z - p.z) - width - site.radius,
          );
        }
      }
      expect(clearance).toBeGreaterThanOrEqual(0.78);
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
          expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThanOrEqual(
            all[i].radius + all[j].radius + 1,
          );
      // Independently sample each covered camera-to-rider segment through
      // actual ground and the complete new geometry's conservative height.
      // Sites must not block these views even when the support itself is clear.
      for (const camera of cameras)
        for (const fraction of [-0.35, 0, 0.35]) {
          const target = track.at(camera.centerS + camera.coverageM * fraction, trackPoint()),
            targetY = surface.terrain.baseHeight(target.s, 0) + 1.1;
          for (let step = 0; step <= 80; step++) {
            const t = step / 80,
              x = camera.position.x + (target.x - camera.position.x) * t,
              y = camera.position.y + (targetY - camera.position.y) * t,
              z = camera.position.z + (target.z - camera.position.z) * t;
            for (const site of all) {
              if (Math.hypot(x - site.x, z - site.z) > site.radius) continue;
              const height =
                'kind' in site ? MX_COURSE_SITE_HEIGHT.landmark : MX_COURSE_SITE_HEIGHT.guide;
              expect(y < mxFurnitureGround(track, x, z) || y > site.y + height).toBe(true);
            }
          }
        }
      expect(planMxCourseSites(track)).toEqual(plan);

      if (id === 'valley-ridge-mx') {
        expect(plan.landmarks.map((s) => s.kind)).toEqual(['barn', 'quarry', 'ridge-deck']);
        for (const site of plan.landmarks) {
          const feature =
            site.kind === 'quarry'
              ? track.circuit.corners.find((c) => c.name === site.name)!.s
              : surface.course.jumps.find((j) => j.name === site.name)!.takeoff;
          const distance =
            mod(site.station - feature + track.length / 2, track.length) - track.length / 2;
          expect(Math.abs(distance)).toBeLessThanOrEqual(30.001);
          track.at(site.station, p);
          const dx = p.x - site.x,
            dz = p.z - site.z;
          expect(
            (-Math.sin(site.yaw) * dx - Math.cos(site.yaw) * dz) / Math.hypot(dx, dz),
          ).toBeCloseTo(1, 8);
        }
      } else {
        expect(plan.landmarks).toHaveLength(0);
        const floor = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (let s = 0; s < track.length; s += 4) {
          track.at(s, p);
          for (const side of [-1, 1]) {
            const x = p.x + p.nx * p.width * side,
              z = p.z + p.nz * p.width * side;
            floor.minX = Math.min(floor.minX, x - STADIUM.margin);
            floor.maxX = Math.max(floor.maxX, x + STADIUM.margin);
            floor.minZ = Math.min(floor.minZ, z - STADIUM.margin);
            floor.maxZ = Math.max(floor.maxZ, z + STADIUM.margin);
          }
        }
        for (const site of plan.guides) {
          expect(site.x - site.radius).toBeGreaterThan(floor.minX);
          expect(site.x + site.radius).toBeLessThan(floor.maxX);
          expect(site.z - site.radius).toBeGreaterThan(floor.minZ);
          expect(site.z + site.radius).toBeLessThan(floor.maxZ);
        }
      }
      expect(new Set(plan.guides.map((g) => g.index)).size).toBe(plan.guides.length);
      for (const guide of plan.guides) {
        expect(guide.jump).toBe(surface.course.jumps[guide.index]);
        const approach = mod(guide.jump.start - guide.station, track.length);
        expect(approach).toBeGreaterThanOrEqual(8 - 1e-6);
        expect(approach).toBeLessThanOrEqual(18 + 1e-6);
        track.at(guide.station, p);
        expect(Math.sin(guide.yaw) * p.tx + Math.cos(guide.yaw) * p.tz).toBeCloseTo(-1, 5);
      }
      console.info(
        'MX course sites',
        JSON.stringify({
          id,
          landmarks: plan.landmarks.map((s) => s.kind),
          guides: plan.guides.map((g) => g.jump.name),
          minimumLaneClearance: clearance,
          rejected: plan.rejected,
        }),
      );
    },
  );

  it('rejects a road circuit without adding any scenery', () => {
    expect(() => planMxCourseSites(new Track())).toThrow(/motocross or supercross/);
  });
});
