import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { OffroadScene } from '../src/rendering/offroad/index.ts';
import {
  MX_LANDMARK_BUDGET,
  MxCourseLandmarks,
  mxJumpGuideProfile,
} from '../src/rendering/offroad/mx-course-landmarks.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track } from '../src/simulation/track.ts';
import { MX_COURSE_SITE_HEIGHT } from '../src/rendering/offroad/mx-course-sites.ts';

describe('course identities and surveyed jump reading', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s diagrams reproduce the contact profile and actual landing zone',
    (id) => {
      const track = rigTrack(id),
        surface = Track.offroadOf(track) as TrackTerrainSurface;
      for (const jump of surface.course.jumps) {
        const diagram = mxJumpGuideProfile(surface.course, jump);
        expect(diagram.samples).toHaveLength(65);
        expect(diagram.from).toBeLessThan(jump.start);
        expect(diagram.to).toBeGreaterThanOrEqual(jump.end);
        expect(diagram.takeoff).toBe(jump.takeoff);
        expect(diagram.landingFrom).toBe(jump.landing - jump.landingLength / 2);
        expect(diagram.landingTo).toBe(jump.landing + jump.landingLength / 2);
        for (const point of diagram.samples)
          expect(point.h).toBe(surface.course.profileHeight(point.s));
      }
    },
  );

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s keeps full model footprints inside cleared sites with bounded resources',
    (id) => {
      const track = rigTrack(id),
        source = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
        hash = source.hash(),
        landmarks = new MxCourseLandmarks(track);
      expect(landmarks.plan.guides.length).toBeGreaterThanOrEqual(2);
      expect(landmarks.draws).toBeLessThanOrEqual(MX_LANDMARK_BUDGET.draws);
      expect(landmarks.triangles).toBeLessThanOrEqual(MX_LANDMARK_BUDGET.triangles);
      if (id === 'valley-ridge-mx') {
        expect(landmarks.plan.landmarks.map((s) => s.kind).sort()).toEqual([
          'barn',
          'quarry',
          'ridge-deck',
        ]);
        const quarry = landmarks.root.getObjectByName('QUARRY / rock') as T.Mesh;
        const uv = quarry.geometry.getAttribute('uv');
        let minU = Infinity,
          maxU = -Infinity,
          minV = Infinity,
          maxV = -Infinity;
        for (let i = 0; i < uv.count; i++) {
          minU = Math.min(minU, uv.getX(i));
          maxU = Math.max(maxU, uv.getX(i));
          minV = Math.min(minV, uv.getY(i));
          maxV = Math.max(maxV, uv.getY(i));
        }
        expect([minU, maxU, minV, maxV].every(Number.isFinite)).toBe(true);
        expect(maxU - minU, 'metre-scale stone projection across the quarry').toBeGreaterThan(8);
        expect(maxV - minV, 'vertical rock faces retain physical texture scale').toBeGreaterThan(4);
        for (const site of landmarks.plan.landmarks) {
          const root = landmarks.root.getObjectByName(site.name)!;
          let finite = true,
            highest = -Infinity,
            radius = 0;
          root.traverse((object) => {
            if (!(object instanceof T.Mesh)) return;
            const position = object.geometry.getAttribute('position');
            for (let i = 0; i < position.count; i++) {
              const distance = Math.hypot(position.getX(i) - site.x, position.getZ(i) - site.z);
              finite &&= Number.isFinite(position.getY(i)) && Number.isFinite(distance);
              highest = Math.max(highest, position.getY(i));
              radius = Math.max(radius, distance);
            }
          });
          expect(finite, `${site.kind}: all vertices are finite`).toBe(true);
          expect(highest, `${site.kind}: optical height`).toBeLessThanOrEqual(
            site.y + MX_COURSE_SITE_HEIGHT.landmark,
          );
          expect(radius, `${site.kind}: cleared footprint`).toBeLessThanOrEqual(site.radius + 0.01);
        }
      } else expect(landmarks.plan.landmarks).toHaveLength(0);
      let outsideGuideEnvelope = 0;
      landmarks.root.getObjectByName('MX advance jump profile boards')!.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const position = object.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          const site = landmarks.plan.guides.find(
            (guide) =>
              Math.hypot(position.getX(i) - guide.x, position.getZ(i) - guide.z) <= guide.radius,
          );
          if (
            !site ||
            !Number.isFinite(position.getY(i)) ||
            position.getY(i) > site.y + MX_COURSE_SITE_HEIGHT.guide
          )
            outsideGuideEnvelope++;
        }
      });
      expect(outsideGuideEnvelope, 'every guide vertex fits a complete reserved envelope').toBe(0);
      expect(source.hash()).toBe(hash);
      const resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
      landmarks.root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        resources.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          resources.add(material);
          const map = (material as T.MeshStandardMaterial).map;
          if (map && material.name === 'MX surveyed jump profile signs') resources.add(map);
        }
      });
      const disposed = new Set<object>();
      resources.forEach((resource) =>
        resource.addEventListener('dispose', () => disposed.add(resource)),
      );
      landmarks.dispose();
      expect(disposed.size).toBe(resources.size);
      expect(landmarks.root.children).toHaveLength(0);
    },
    30000,
  );

  it('constructs the production owner for MX and never attaches it to rallycross', () => {
    const mxQueue = new BuildQueue(),
      mx = new OffroadScene(rigTrack('valley-ridge-mx'), mxQueue);
    expect(mx.landmarks).toBeNull();
    mxQueue.runSynchronously();
    expect(mx.landmarks?.plan.landmarks).toHaveLength(3);
    expect(mx.group.getObjectByName('MX course identities and surveyed jump guides')).toBe(
      mx.landmarks!.root,
    );
    mx.dispose();
    const rxQueue = new BuildQueue(),
      rx = new OffroadScene(rigTrack('kestrel-rx'), rxQueue);
    rxQueue.runSynchronously();
    expect(rx.landmarks).toBeNull();
    rx.dispose();
  }, 60000);
});
