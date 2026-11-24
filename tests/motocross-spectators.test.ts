import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CrowdCluster } from '../src/rendering/crowd.ts';
import { buildGrandstand, type standMaterials } from '../src/rendering/grandstand.ts';
import { venuePlan } from '../src/rendering/venue-plan.ts';
import { PHASE } from '../src/simulation/race.ts';
import { MarshalStaffView, type MarshalLocation } from '../src/rendering/marshal-staff.ts';
import {
  mxMarshalLocations,
  mxFurnitureGround,
  planMxTracksideFurniture,
  MX_FURNITURE_LIMITS,
} from '../src/rendering/offroad/mx-trackside-furniture.ts';
import { disposeOffroadResources } from '../src/rendering/offroad/owned-resources.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { CAR_STRIDE, HEADER, H, F, carBase } from '../src/simulation/protocol.ts';
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

  it('grounds each public rail outside all race lanes and leaves the static metal in the shadow bake', () => {
    const track = rigTrack('valley-ridge-mx'), surface = Track.offroadOf(track) as TrackTerrainSurface;
    const dressing = new MxCourseDressing(track), crowd = new MxSpectators(track, dressing.trackside.plan.sites, dressing.courseSites);
    const rails = crowd.rails.getObjectByName('Galvanised viewing barriers') as T.InstancedMesh;
    try {
      expect(crowd.root.getObjectByName(rails.name)).toBeUndefined();
      expect(rails.isInstancedMesh && rails.castShadow).toBe(true);
      expect(rails.count).toBeGreaterThan(6);
      expect(rails.count).toBeLessThan(120);
      const p = rails.geometry.getAttribute('position'), point = trackPoint(), matrix = new T.Matrix4(), location = new T.Vector3();
      const reserved = [...dressing.trackside.plan.sites, ...dressing.courseSites.landmarks, ...dressing.courseSites.guides];
      let maxFootGap = 0;
      for (let i = 0; i < rails.count; i++) {
        rails.getMatrixAt(i, matrix);
        location.setFromMatrixPosition(matrix);
        for (const obstacle of reserved) expect(Math.hypot(location.x - obstacle.x, location.z - obstacle.z)).toBeGreaterThan(obstacle.radius + 1.5);
        for (let j = 0; j < p.count; j++) {
          if (p.getY(j) > 1e-5) continue;
          location.fromBufferAttribute(p, j).applyMatrix4(matrix);
          const lateral = track.nearest(location.x, location.z, point);
          expect(Math.abs(lateral)).toBeGreaterThan(surface.course.legalWidth(point.width, point.s, lateral) + 2.85);
          maxFootGap = Math.max(maxFootGap, Math.abs(location.y - mxFurnitureGround(track, location.x, location.z)));
        }
      }
      expect(maxFootGap).toBeLessThan(.09);
      expect((rails.geometry.getIndex()!.count / 3) * rails.count).toBeLessThan(50000);
    } finally {
      dressing.dispose();
      crowd.dispose();
    }
  });

  it('thins the standing public independently of race officials on Low and Medium', () => {
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
      expect(total).toBe(crowd.stats.spectators);
      expect(crowd.stats.marshals).toBe(dressing.trackside.stats['marshal-post']);
      for (const mesh of people) {
        const style = mesh.geometry.getAttribute('spectatorStyle') as T.InstancedBufferAttribute;
        // Everyone stands (style z), nobody floats in a seated pose.
        for (let i = 0; i < style.count; i++) expect(style.getZ(i)).toBe(1);
        expect(mesh.customDepthMaterial).toBeDefined();
        expect(mesh.instanceColor).not.toBeNull();
      }
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
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'keeps each official grounded beside their %s post and relays local race control through holds and seeks',
    (venue) => {
      const track = rigTrack(venue),
        course = (Track.offroadOf(track) as TrackTerrainSurface).course;
      const sites = planMxTracksideFurniture(track).sites;
      const locations: MarshalLocation[] = [];
      const staff = new MarshalStaffView(locations, 'individual', MX_FURNITURE_LIMITS.marshalPosts);
      const frame = new Float32Array(HEADER + CAR_STRIDE),
        rider = carBase(0);
      frame[H.CARS] = 1;
      frame[H.LENGTH] = track.length;
      const camera = new T.Vector3(),
        point = trackPoint(),
        pose = new T.Matrix4(),
        origin = new T.Vector3();
      try {
        // Mirrors deferred venue construction: the actor buffers exist before the approved post sites.
        staff.update(frame, camera);
        expect(staff.active).toBe(0);
        locations.push(...mxMarshalLocations(track, sites));
        expect(locations.length).toBe(sites.filter((s) => s.type === 'marshal').length);
        expect(locations.length).toBeGreaterThan(0);
        for (const site of locations) {
          const lateral = track.nearest(site.x, site.z, point);
          expect(Math.abs(lateral)).toBeGreaterThan(
            course.legalWidth(point.width, point.s, lateral) + 0.8,
          );
          expect(site.y).toBeCloseTo(mxFurnitureGround(track, site.x, site.z), 6);
          const footing = new T.Matrix4()
            .makeRotationY(site.yaw)
            .setPosition(site.x, site.y, site.z);
          for (const ankle of site.feet!) {
            const boot = ankle.clone().applyMatrix4(footing);
            expect(boot.y - 0.055).toBeCloseTo(mxFurnitureGround(track, boot.x, boot.z), 6);
          }
          frame[rider + F.S] = site.s;
          camera.set(site.x, site.y + 1.5, site.z);
          for (const signal of [FLAG.GREEN, FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE]) {
            frame[rider + F.LOCAL_FLAG] = signal;
            frame[H.TIME] = 2.3;
            staff.update(frame, camera);
            expect(staff.unreachable).toBe(0);
            expect(staff.maxGripError).toBeLessThan(1e-5);
            expect(staff.poles.count).toBe(staff.flags.count);
            expect(staff.flags.count > 0).toBe(signal !== FLAG.GREEN);
            // The post being inspected owns a body with its feet at this exact world-space footing.
            const near = Array.from({ length: staff.bodies.count }, (_, i) => {
              staff.bodies.getMatrixAt(i, pose);
              return origin
                .setFromMatrixPosition(pose)
                .distanceTo(new T.Vector3(site.x, site.y, site.z));
            });
            expect(Math.min(...near)).toBeLessThan(1e-4);
            if (signal === FLAG.GREEN) continue;
            const held = staff.flags.instanceMatrix.array.slice();
            frame[H.TIME] = 5.4;
            staff.update(frame, camera);
            frame[H.TIME] = 2.3;
            staff.update(frame, camera);
            expect(staff.flags.instanceMatrix.array).toEqual(held);
          }
          setMxQuality('low');
          frame[rider + F.LOCAL_FLAG] = FLAG.YELLOW;
          staff.update(frame, camera);
          expect(staff.flags.count).toBeGreaterThan(0);
        }
        staff.update(frame, camera.set(100000, 1, 100000));
        expect(staff.active).toBe(0);
      } finally {
        disposeOffroadResources([staff.root]);
      }
    },
  );
});

it('Valley Ridge grandstand seats track a passing pack and use the actual race or broadcast lens', () => {
  const track = rigTrack('valley-ridge-mx');
  const site = venuePlan(track).grandstands[0];
  const props = new T.Group(), crowd = new T.Group(), clusters: CrowdCluster[] = [];
  const materials = Object.fromEntries(
    ['concrete', 'steel', 'roof', 'underside', 'seats', 'people', 'sign']
      .map(name => [name,new T.MeshStandardMaterial()]),
  ) as ReturnType<typeof standMaterials>;
  buildGrandstand(track,props,crowd,site,materials,clusters);
  try {
    const cluster = clusters[0];
    const frame = new Float32Array(HEADER + CAR_STRIDE), o = carBase(0);
    frame[H.CARS] = 1; frame[H.PHASE] = PHASE.RACING; frame[o+F.SPEED] = 27;
    crowd.updateMatrixWorld(true);
    const mesh = cluster.levels[0], seat = new T.Matrix4(), centre = new T.Vector3();
    const v = new T.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i,seat); centre.add(v.setFromMatrixPosition(seat));
    }
    mesh.localToWorld(centre.multiplyScalar(1/mesh.count));
    const m = cluster.root.matrixWorld.elements;
    const along = new T.Vector3(m[8],0,m[10]).normalize().multiplyScalar(site.side);
    const front = new T.Vector3(-along.z,0,along.x);
    const near = centre.clone().addScaledVector(front,17);
    const far = centre.clone().addScaledVector(front,146);
    function pass(station: number) {
      const rider = near.clone().addScaledVector(along,station);
      frame[o+F.X] = rider.x; frame[o+F.Z] = rider.z;
      cluster.update(4,near,0,frame,58,16/9,false,1080);
      return cluster.gpYaw!.value;
    }
    const arriving = pass(-21);
    expect(arriving).toBeLessThan(-.12);
    expect(pass(21)).toBeGreaterThan(.12);
    expect(pass(-21)).toBe(arriving);
    frame[H.PHASE] = PHASE.GRID;
    expect(pass(21)).toBe(0);
    cluster.update(4,far,0,frame,58,16/9,false,540);
    expect(cluster.levels.map(l => l.visible)).toEqual([false,false,true,false]);
    cluster.update(4,far,0,frame,58,16/9,false,1080);
    expect(cluster.levels.map(l => l.visible)).toEqual([false,true,false,false]);
    cluster.update(4,far,0,frame,12,16/9,false,1080);
    expect(cluster.levels[0].visible).toBe(true);
  } finally {
    disposeOffroadResources([props,crowd]);
  }
});
