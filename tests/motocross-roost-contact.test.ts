import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { Roost, ROOST_CAPACITY, ROOST_GROUND_SAMPLES } from '../src/rendering/offroad/roost.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

const pending: Roost[] = [];
afterEach(() => {
  for (const roost of pending.splice(0)) roost.dispose();
});

function harness(riders = 1) {
  const track = rigTrack('valley-ridge-mx');
  const terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
  const roost = new Roost(track);
  pending.push(roost);
  const frame = new Float32Array(HEADER + CAR_STRIDE * riders);
  frame[H.CARS] = riders;
  const p = track.at(100, trackPoint());
  const yaw = Math.atan2(p.tx, p.tz);
  for (let id = 0; id < riders; id++) {
    const b = carBase(id);
    frame[b + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    frame[b + F.X] = p.x;
    frame[b + F.Y] = terrain.baseHeight(p.s, 0) + 0.55;
    frame[b + F.Z] = p.z;
    frame[b + F.QY] = Math.sin(yaw / 2);
    frame[b + F.QW] = Math.cos(yaw / 2);
    frame[b + F.S] = p.s;
    frame[b + F.SPEED] = 15;
    frame[b + F.VX] = p.tx * 15;
    frame[b + F.VZ] = p.tz * 15;
    for (const wheel of [0, 2]) {
      const w = b + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[w + W.LOAD] = 600;
      frame[w + W.SLIP] = 0.35;
      frame[w + W.SURFACE] = MATERIAL.DIRT;
    }
  }
  const b = carBase(0),
    o = b + OFFROAD_BASE;
  const load = (front: number, rear: number) => {
    frame[b + WHEEL_BASE + W.LOAD] = front;
    frame[b + WHEEL_BASE + 2 * WHEEL_STRIDE + W.LOAD] = rear;
  };
  const jump = () => {
    frame[b + F.SPEED] = 0;
    frame[o + O.AIRBORNE] = 1;
    frame[o + O.AIR_TIME] = 0.7;
    roost.update(frame, 1 / 60);
    frame[o + O.AIRBORNE] = 0;
    frame[o + O.LANDING_SPEED] = 6;
  };
  return { track, terrain, roost, frame, b, o, p, load, jump };
}

describe('lit motocross soil and independent touchdown contacts', () => {
  it('keeps opaque lit fragments and diffuse dust in one bounded particle pool', () => {
    const h = harness(8);
    h.roost.density = 1.5;
    for (let i = 0; i < 36; i++) h.roost.update(h.frame, 1 / 60);
    const mesh = h.roost.clods!;
    expect(mesh.material).toBeInstanceOf(T.MeshStandardMaterial);
    expect((mesh.material as T.MeshStandardMaterial).roughness).toBeGreaterThan(0.85);
    expect((mesh.material as T.MeshStandardMaterial).metalness).toBe(0);
    expect(mesh.count).toBeGreaterThan(20);
    expect(mesh.count).toBeLessThanOrEqual(h.roost.active);
    expect(h.roost.active).toBeLessThanOrEqual(ROOST_CAPACITY);
    expect([...mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
    expect(mesh.instanceColor).not.toBeNull();
    expect(mesh.receiveShadow).toBe(true);
    const matrix = [...mesh.instanceMatrix.array];
    const particles = [...h.roost.points.geometry.getAttribute('position').array];
    h.roost.update(h.frame, 0);
    expect([...mesh.instanceMatrix.array]).toEqual(matrix);
    expect([...h.roost.points.geometry.getAttribute('position').array]).toEqual(particles);
    h.roost.clear();
    expect(mesh.count).toBe(0);
    expect(h.roost.active).toBe(0);
    expect(h.roost.contactShadows!.count).toBe(0);
  });

  it('emits a front-first landing at the front tyre and waits for actual rear contact', () => {
    const h = harness();
    h.frame[h.o + O.MOISTURE] = 0.7; // Wet clay: every visible fragment is solid.
    h.jump();
    h.load(600, 0);
    h.roost.update(h.frame, 1 / 60);
    expect(h.roost.active).toBe(13);
    expect(h.roost.clods!.count).toBe(13);
    expect(h.roost.contactShadows!.count).toBe(1);
    const matrix = new T.Matrix4(),
      position = new T.Vector3();
    h.roost.clods!.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    const frontAlong = (position.x - h.p.x) * h.p.tx + (position.z - h.p.z) * h.p.tz;
    expect(frontAlong).toBeGreaterThan(0.4);
    h.roost.update(h.frame, 1 / 60);
    expect(h.roost.active).toBe(13);
    h.load(600, 600);
    h.roost.update(h.frame, 1 / 60);
    expect(h.roost.active).toBe(26);
    expect(h.roost.contactShadows!.count).toBe(2);
    h.roost.clods!.getMatrixAt(25, matrix);
    position.setFromMatrixPosition(matrix);
    const rearAlong = (position.x - h.p.x) * h.p.tx + (position.z - h.p.z) * h.p.tz;
    expect(rearAlong).toBeLessThan(-0.4);
    h.roost.update(h.frame, 1 / 60);
    expect(h.roost.active).toBe(26);
  });

  it('expires an unobserved rear landing and never invents contact from a stale airborne load', () => {
    const h = harness();
    h.frame[h.o + O.AIRBORNE] = 1;
    for (let i = 0; i < 12; i++) h.roost.update(h.frame, 1 / 60);
    expect(h.roost.active).toBe(0);
    h.jump();
    h.load(600, 0);
    h.roost.update(h.frame, 1 / 60);
    for (let i = 0; i < 24; i++) h.roost.update(h.frame, 1 / 60);
    const before = h.roost.active;
    h.load(600, 600);
    h.roost.update(h.frame, 1 / 60);
    expect(h.roost.active).toBeLessThanOrEqual(before);
  });

  it('uses displayed ruts for shadows and lets debris descend below its old emission plane', () => {
    const h = harness();
    let depression = 0.18;
    h.roost.groundHeight = (s, lateral) => h.terrain.baseHeight(s, lateral) - depression;
    h.frame[h.o + O.RUT_FRONT] = h.frame[h.o + O.RUT_REAR] = 0.02;
    h.frame[h.o + O.MOISTURE] = 0.7;
    h.jump();
    h.load(600, 600);
    h.roost.update(h.frame, 1 / 60);
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      at = trackPoint();
    h.roost.contactShadows!.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    const lateral = h.track.nearest(position.x, position.z, at);
    expect(position.y).toBeCloseTo(h.roost.groundHeight(at.s, lateral) + 0.022, 5);
    const births = [...h.roost.points.geometry.getAttribute('position').array];
    depression = 1.2; // A different displayed terrain state; birth-floor clipping would hide these.
    h.frame[H.CARS] = 0;
    let travelledBelowOldFloor = false;
    for (let tick = 0; tick < 65; tick++) {
      h.roost.update(h.frame, 1 / 60);
      const points = h.roost.points.geometry.getAttribute('position');
      for (let i = 0; i < points.count; i++) {
        if (points.getY(i) < -1000) continue;
        if (points.getY(i) < births[i * 3 + 1] - 0.15) travelledBelowOldFloor = true;
        const l = h.track.nearest(points.getX(i), points.getZ(i), at);
        expect(points.getY(i)).toBeGreaterThanOrEqual(h.roost.groundHeight(at.s, l) - 0.025);
      }
    }
    expect(travelledBelowOldFloor).toBe(true);
  });

  it('bounds terrain sampling even with many riders and releases both render resources', () => {
    const h = harness(8);
    let reads = 0;
    h.roost.groundHeight = (s, lateral) => {
      reads++;
      return h.terrain.baseHeight(s, lateral);
    };
    for (let i = 0; i < 20; i++) h.roost.update(h.frame, 1 / 60);
    h.frame[H.CARS] = 0;
    for (let i = 0; i < 12; i++) {
      reads = 0;
      h.roost.update(h.frame, 1 / 60);
      expect(reads).toBeLessThanOrEqual(ROOST_GROUND_SAMPLES * 5);
    }
    let geometryDisposed = false,
      materialDisposed = false;
    h.roost.clods!.geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    (h.roost.clods!.material as T.Material).addEventListener('dispose', () => {
      materialDisposed = true;
    });
    h.roost.dispose();
    pending.splice(pending.indexOf(h.roost), 1);
    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
    const legacy = new Roost(rigTrack('kestrel-rx'));
    pending.push(legacy);
    expect(legacy.clods).toBeNull();
  });
});
