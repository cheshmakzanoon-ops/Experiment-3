import { expect, it } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { TracksideDirector, tracksideFraming } from '../src/rendering/trackside.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import {
  PIT_SERVICE_RADIUS,
  PIT_CREW_MAX_DISTANCE,
  pitCrewDetail,
  PitPoseCache,
} from '../src/rendering/pit-presentation.ts';
import { RaceComposition } from '../src/rendering/race-composition.ts';
import { H, F, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { buildBarrierChunk, barrierMaterials } from '../src/rendering/circuit-barriers.ts';

function service(x = 0) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.CARS] = 1;
  f[H.PHASE] = 3;
  f[o + F.QW] = 1;
  f[o + F.X] = x;
  f[o + F.Y] = 0.65;
  f[o + F.IN_PIT] = 1;
  f[o + F.PIT_PHASE] = 3;
  f[o + F.PIT_CLOCK] = 1.8;
  f[o + F.JACK_HEIGHT] = 0.19;
  return f;
}
const zero = new T.Vector3();
it('uses a real telephoto lens for service without changing ordinary racing lenses', () => {
  for (const aspect of [9 / 16, 1, 4 / 3, 16 / 9, 21 / 9])
    for (const distance of [30, 45, 80, 120, 160]) {
      const original = tracksideFraming(distance, 42, aspect, PIT_SERVICE_RADIUS);
      const shot = tracksideFraming(distance, 42, aspect, PIT_SERVICE_RADIUS, true);
      expect(original.fov).toBeGreaterThanOrEqual(24);
      expect(shot.fits).toBe(true);
      expect(shot.fov).toBeLessThanOrEqual(original.fov);
      const fraction =
        Math.tan(Math.asin(PIT_SERVICE_RADIUS / distance)) /
        (Math.tan((shot.fov * Math.PI) / 360) * Math.min(1, aspect));
      expect(fraction).toBeGreaterThan(0.69);
      expect(fraction).toBeLessThanOrEqual(0.72);
    }
  expect(tracksideFraming(160, 42, 16 / 9, PIT_SERVICE_RADIUS, true).fov).toBeLessThan(7);
});
it('projects the complete real crew envelope at every bay and viewport with a readable footprint', () => {
  const track = new Track(),
    p = trackPoint(),
    composition = new RaceComposition();
  for (let bay = 0; bay < 12; bay++) {
    const s = 102 + bay * 7;
    track.at(s, p);
    const f = service(),
      o = carBase(0);
    f[o + F.S] = s;
    f[o + F.X] = p.x + p.nx * 24.1;
    f[o + F.Y] = p.y + 0.65;
    f[o + F.Z] = p.z + p.nz * 24.1;
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.tx, p.tz));
    [F.QX, F.QY, F.QZ, F.QW].forEach((key, i) => (f[o + key] = q.toArray()[i]));
    composition.update(f, 0);
    const original = f.slice();
    for (const aspect of [9 / 16, 1, 16 / 9, 21 / 9]) {
      const d = new TracksideDirector(track);
      d.update(
        s,
        composition.target,
        zero,
        0,
        aspect,
        composition.radius,
        true,
        composition.visibility,
      );
      expect(d.framingFits).toBe(true);
      expect(d.subjectScreenFraction).toBeGreaterThan(0.69);
      expect(d.subjectScreenFraction).toBeLessThanOrEqual(0.72);
      const camera = new T.PerspectiveCamera(d.fov, aspect, 0.045, 7000);
      camera.position.copy(d.position);
      camera.lookAt(d.gaze);
      camera.updateMatrixWorld(true);
      for (const point of composition.visibility!.points) {
        const clip = point.clone().project(camera);
        expect(Math.abs(clip.x)).toBeLessThan(0.79);
        expect(Math.abs(clip.y)).toBeLessThan(0.79);
        expect(clip.z).toBeGreaterThan(-1);
        expect(clip.z).toBeLessThan(1);
      }
      expect(d.position.equals(d.rigs[d.activeId].position)).toBe(true);
    }
    expect(f).toEqual(original);
  }
});
it('reframes a held service and returns to the unchanged racing lens without advancing time', () => {
  const track = new Track(),
    d = new TracksideDirector(track),
    p = trackPoint();
  track.at(0, p);
  const target = new T.Vector3(p.x, p.y, p.z),
    visibility = { anchor: target, points: [], maxDistance: PIT_CREW_MAX_DISTANCE };
  d.update(0, target, zero, 0);
  const ordinary = d.fov,
    id = d.activeId;
  d.update(0, target, zero, 0, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
  const serviceFov = d.fov;
  expect(serviceFov).toBeLessThan(ordinary);
  for (let i = 0; i < 10; i++) {
    d.update(0, target, zero, 0, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
    expect(d.fov).toBe(serviceFov);
    expect(d.activeId).toBe(id);
  }
  d.update(0, target, zero, 0);
  expect(d.fov).toBe(ordinary);
  d.reset();
  expect(d.subjectScreenFraction).toBe(0);
});
it('makes detail depend on lens magnification, never using optical distance for physical culling', () => {
  expect(pitCrewDetail(44)).toBe(0);
  expect(pitCrewDetail(45)).toBe(1);
  expect(pitCrewDetail(140, 6)).toBe(0);
  expect(pitCrewDetail(140, 58)).toBe(1);
  const f = service(),
    cache = new PitPoseCache(),
    camera = new T.Vector3(140, 0.65, 0);
  cache.prepare(f, camera, true, 58);
  cache.commit();
  expect(cache.levels[0]).toBe(1);
  expect(cache.prepare(f, camera, true, 6)).toBe(true);
  cache.commit();
  expect(cache.levels[0]).toBe(0);
  expect(cache.prepare(f, camera, true, 5)).toBe(false);
  camera.x = PIT_CREW_MAX_DISTANCE + 1;
  cache.prepare(f, camera, true, 4);
  cache.commit();
  expect(cache.levels[0]).toBe(-1);
});
it('uses the selected authored cloth in the actual fifteen-person crew and reuses held poses', () => {
  const f = service(),
    original = f.slice(),
    crew = new PitCrewView();
  const camera = new T.Vector3(140, 0.65, 0);
  try {
    crew.update(f, camera, true, 58);
    expect(crew.summary().nearActors).toBe(0);
    crew.update(f, camera, true, 6);
    expect(crew.summary().nearActors).toBe(15);
    expect(crew.activeActors).toBe(15);
    const builds = crew.summary().poseBuilds;
    crew.update(f, camera, true, 5);
    expect(crew.summary().poseBuilds).toBe(builds);
    expect(crew.summary().poseReuses).toBeGreaterThan(0);
    crew.update(f, camera, true, 58);
    expect(crew.summary().nearActors).toBe(0);
    expect(f).toEqual(original);
  } finally {
    crew.dispose();
  }
});
it('rejects invalid lens values even when there are no service actors', () => {
  const f = service(),
    cache = new PitPoseCache();
  f[carBase(0) + F.IN_PIT] = 0;
  for (const [fov, aspect] of [
    [0, 1],
    [180, 1],
    [NaN, 1],
    [58, 0],
    [58, Infinity],
  ])
    expect(() => cache.prepare(f, zero, true, fov, aspect)).toThrow('Invalid pit crew lens');
});
it('places the permanent pit lens above the actual foreground fence at all twelve bays', () => {
  const track = new Track(),
    p = trackPoint(),
    group = new T.Group(),
    materials = barrierMaterials();
  for (let s = 0; s < 320; s += 80) buildBarrierChunk(track, group, s, s + 80, materials);
  group.updateMatrixWorld(true);
  const panels = group.children.filter((mesh) => /fence|steel/.test(mesh.name));
  expect(panels.length).toBeGreaterThan(0);
  let formerForegroundHits = 0;
  try {
    for (let bay = 0; bay < 12; bay++) {
      const s = 102 + bay * 7,
        f = service(),
        o = carBase(0);
      track.at(s, p);
      f[o + F.S] = s;
      f[o + F.X] = p.x + p.nx * 24.1;
      f[o + F.Y] = p.y + 0.65;
      f[o + F.Z] = p.z + p.nz * 24.1;
      const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.tx, p.tz));
      f[o + F.QY] = q.y;
      f[o + F.QW] = q.w;
      const c = new RaceComposition();
      c.update(f, 0);
      const d = new TracksideDirector(track);
      d.update(s, c.target, zero, 0, 16 / 9, c.radius, true, c.visibility);
      expect(d.activeId).toBe(1);
      for (const to of [c.target, ...c.visibility!.points]) {
        const blocked = (from: T.Vector3) => {
          const ray = to.clone().sub(from),
            length = ray.length();
          // The near fence is the demonstrated foreground obstruction. The
          // remote service-envelope corners may cross a far pit fence; this
          // does not claim every empty bounding-box corner is actor visibility.
          return (
            new T.Raycaster(from, ray.normalize(), 0.01, length / 2).intersectObjects(panels, false)
              .length > 0
          );
        };
        expect(blocked(d.position)).toBe(false);
        formerForegroundHits += Number(blocked(d.position.clone().add(new T.Vector3(0, -1.5, 0))));
      }
    }
    expect(formerForegroundHits).toBe(108);
  } finally {
    group.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
    for (const material of Object.values(materials)) material.dispose();
  }
});
