import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { MotocrossAxles } from '../src/rendering/offroad/motocross-axles.ts';
import { MX_SILENCER_MOUNT } from '../src/rendering/offroad/mx-silencer.ts';
import { Roost, ROOST_CAPACITY, ROOST_GROUND_SAMPLES } from '../src/rendering/offroad/roost.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import {
  B,
  BIKE_BASE,
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
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';

const pending: Roost[] = [];
afterEach(() => {
  for (const roost of pending.splice(0)) roost.dispose();
});

function harness(riders = 1, venue: 'valley-ridge-mx' | 'arena-nord-sx' = 'valley-ridge-mx') {
  const track = rigTrack(venue);
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
  it('emits the two-stroke plume at the tipped silencer, with outdoor drift and repeatable seeks', () => {
    for (const venue of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      const { roost, frame, b } = harness(1, venue), mesh = roost.exhaust!.points;
      const attr = mesh.geometry.getAttribute('position'), update = () => roost.update(frame, 0);
      frame[b + RACE_BASE + R.VEHICLE] = vehicleIndex('mx250');
      frame[H.TIME] = 3;
      frame[b + F.RPM] = 3800;
      frame[b + F.SPEED] = 0;
      frame[b+F.VX] = frame[b+F.VZ] = 0;
      update();
      const count=mesh.geometry.drawRange.count, calm=Array.from(attr.array.slice(0,count*3));
      expect(count).toBeGreaterThan(3);
      expect(mesh.material).toBe(roost.points.material);
      const m=MX_SILENCER_MOUNT;
      const expected=new T.Vector3(m.x,m.y-Math.sin(m.pitch)*m.outletZ,m.z+Math.cos(m.pitch)*m.outletZ)
        .applyQuaternion(new T.Quaternion().fromArray(frame,b+F.QX)).add(new T.Vector3().fromArray(frame,b+F.X));
      expect(expected.distanceTo(new T.Vector3().fromBufferAttribute(attr,0))).toBeLessThan(0.00002);
      frame[H.WIND_X]=7; update();
      expect(attr.getX(0)).toBeCloseTo(calm[0],5);
      if (venue==='valley-ridge-mx') expect(attr.getX(count-1)).toBeGreaterThan(calm[(count-1)*3]+0.3);
      else expect(Array.from(attr.array.slice(0,count*3))).toEqual(calm);
      frame[H.TIME]=2.65; update(); frame[H.TIME]=3;frame[H.WIND_X]=0;update();
      expect(Array.from(attr.array.slice(0,count*3))).toEqual(calm);
      frame[b+RACE_BASE+R.VEHICLE]=vehicleIndex('mx450');update();expect(mesh.visible).toBe(false);
      frame[b+RACE_BASE+R.VEHICLE]=vehicleIndex('mx250');frame[b+F.RPM]=0;update();expect(mesh.visible).toBe(false);
    }
  });
  it('drapes the engine shade over the displayed bank and pad, with finite fade and repeatable seeking', () => {
    const { roost, frame, b, p, track } = harness();
    const ground = (s: number, lateral: number) => 0.12 * (s - p.s) + 0.28 * lateral;
    roost.groundHeight = ground;
    frame[b + F.Y] = 0.86;
    const shade = roost.contactShadows!.children[0] as T.Mesh<T.BufferGeometry>;
    const pos = shade.geometry.getAttribute('position'), colours = shade.geometry.getAttribute('color');
    const probe = trackPoint();
    const draw = () => roost.update(frame, 1 / 60);
    draw();
    expect(shade.visible).toBe(true);
    expect(shade.geometry.drawRange.count).toBe(48);
    const original = Array.from(pos.array.slice(0, 45));
    const alpha = colours.getW(7);
    for (let v = 0; v < 15; v++) {
      const l = track.nearest(pos.getX(v), pos.getZ(v), probe);
      expect(pos.getY(v)).toBeCloseTo(ground(probe.s, l) + 0.014, 3);
    }
    frame[b + F.Y] += 0.5;
    draw();
    expect(colours.getW(7)).toBeLessThan(alpha);
    expect(colours.getW(7)).toBeGreaterThan(0);
    frame[b + F.Y] += 2;
    draw();
    expect(shade.visible).toBe(false);
    frame[b + F.Y] = 0.86;
    roost.startPad = { padHeightAt: () => 0.4 };
    draw();
    expect(pos.getY(7)).toBeCloseTo(0.414, 5);
    roost.startPad = null;
    roost.clear();
    expect(shade.geometry.drawRange.count).toBe(0);
    draw();
    expect(Array.from(pos.array.slice(0, 45))).toEqual(original);
    frame[b + F.RETIRED] = 1;
    draw();
    expect(shade.visible).toBe(false);
  });
  it('carries the same race-time clod and dust trajectories across 10–144 Hz presentations', () => {
    const duration = 0.5;
    const trace = (hz: number) => {
      const h = harness();
      h.frame[H.CARS] = 0;
      h.frame[H.WIND_X] = 6;
      h.roost.groundHeight = () => -2;
      const emission = h.roost as unknown as {
        spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, wet: number, dust: boolean): number;
      };
      for (const dust of [false, true]) emission.spawn(0, 1, 0, 3, 7, -2, 0.3, dust);
      // Include the final fractional frame for an odd refresh rate.
      for (let frame = 0; frame / hz < duration - 1e-9; frame++) {
        const step = Math.min(1 / hz, duration - frame / hz);
        h.roost.update(h.frame, step);
      }
      const position = h.roost.points.geometry.getAttribute('position');
      expect(h.roost.active).toBe(2);
      return Array.from(position.array.slice(0, 6));
    };
    const canonical = trace(60);
    const travel = -Math.expm1(-0.25 * duration) / 0.25;
    expect(canonical[0]).toBeCloseTo(3 * travel, 5);
    expect(canonical[1]).toBeCloseTo(1 + 7 * travel - 9.81 * (duration - travel) / 0.25, 5);
    for (const hz of [10, 15, 24, 30, 72, 144]) {
      const actual = trace(hz);
      for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(canonical[i], 4);
    }
  });

  it.each(['valley-ridge-mx','arena-nord-sx'] as const)('advects only exposed suspended fines in %s with the recorded crosswind', venue => {
    const calm = harness(1, venue), wind = harness(1, venue);
    for (const h of [calm,wind]) {
      for (let i=0;i<40;i++) h.roost.update(h.frame,1/60);
      h.load(0,0);
    }
    wind.frame[H.WIND_X] = 7;
    wind.frame[H.WIND_Z] = -3;
    for (let i=0;i<30;i++) {
      calm.roost.update(calm.frame,1/60);
      wind.roost.update(wind.frame,1/60);
    }
    const a = calm.roost.points.geometry, b = wind.roost.points.geometry;
    const kind = a.getAttribute('mxParticleShape'), alpha = a.getAttribute('mxParticleAlpha');
    const p = a.getAttribute('position'), q = b.getAttribute('position');
    let observed = 0;
    for (let i=0;i<p.count;i++) {
      if (kind.getX(i)!==1 || alpha.getX(i)<=0) continue;
      observed++;
      const dx = q.getX(i)-p.getX(i), dz = q.getZ(i)-p.getZ(i);
      if (venue === 'valley-ridge-mx') {
        expect(dx).toBeGreaterThan(0.15);
        expect(dz/dx).toBeCloseTo(-3/7,3);
      } else {
        expect(dx).toBe(0);
        expect(dz).toBe(0);
      }
    }
    expect(observed).toBeGreaterThan(0);
    expect(wind.roost.clods!.instanceMatrix.array).toEqual(calm.roost.clods!.instanceMatrix.array);
  });
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
    const geometry = h.roost.points.geometry;
    const count = geometry.drawRange.count;
    expect(count).toBe(h.roost.active - mesh.count);
    const liveFines = new Set<number>();
    for (let i = 0; i < count; i++) {
      const slot = geometry.index!.getX(i);
      expect(geometry.getAttribute('mxParticleShape').getX(slot)).toBe(1);
      expect(geometry.getAttribute('mxParticleAlpha').getX(slot)).toBeGreaterThan(0);
      liveFines.add(slot);
    }
    expect(liveFines.size).toBe(count);
    const position = geometry.getAttribute('position') as T.BufferAttribute;
    const versions = [position.version, geometry.index!.version, mesh.instanceMatrix.version];
    const matrix = [...mesh.instanceMatrix.array];
    const particles = [...h.roost.points.geometry.getAttribute('position').array];
    h.roost.update(h.frame, 0);
    expect([...mesh.instanceMatrix.array]).toEqual(matrix);
    expect([position.version, geometry.index!.version, mesh.instanceMatrix.version]).toEqual(versions);
    expect([...h.roost.points.geometry.getAttribute('position').array]).toEqual(particles);
    h.roost.clear();
    expect(mesh.count).toBe(0);
    expect(geometry.drawRange.count).toBe(0);
    expect(h.roost.active).toBe(0);
    expect(h.roost.contactShadows!.count).toBe(0);
  });

  it('throws wet earth behind a spinning rear and ahead of a locked rear in the same contact plane', () => {
    const direction = (treadSpeed: number) => {
      const h = harness(), wheel = h.b + WHEEL_BASE + 2 * WHEEL_STRIDE;
      h.load(0, 800);
      h.frame[h.o + O.MOISTURE] = 0.8;
      h.frame[wheel + W.RADIUS] = 0.34;
      h.frame[wheel + W.OMEGA] = treadSpeed / 0.34;
      h.roost.update(h.frame, 1 / 30);
      const geometry = h.roost.points.geometry, positions = geometry.getAttribute('position');
      const origin = h.roost.wheelPatch(0, false)!.position.clone();
      h.load(0, 0);
      h.roost.update(h.frame, 1 / 30);
      const outward = new T.Vector3();
      for (let i = 0; i < h.roost.clods!.count; i++) {
        outward.x += positions.getX(i) - origin.x;
        outward.z += positions.getZ(i) - origin.z;
      }
      expect(h.roost.clods!.count).toBeGreaterThan(2);
      return (outward.x * h.p.tx + outward.z * h.p.tz) / h.roost.clods!.count;
    };
    expect(direction(31)).toBeLessThan(-0.2);
    expect(direction(0)).toBeGreaterThan(0.12);
  });

  it('spreads roost over a moving tyre path and restarts emission at a discontinuous position', () => {
    const h = harness(), wheel = h.b + WHEEL_BASE + 2 * WHEEL_STRIDE;
    h.load(0, 850);
    h.frame[wheel + W.RADIUS] = 0.34;
    h.frame[wheel + W.OMEGA] = 35 / 0.34;
    h.frame[h.o + O.MOISTURE] = 0.8;
    const move = (metres: number) => {
      h.frame[h.b + F.X] += h.p.tx * metres;
      h.frame[h.b + F.Z] += h.p.tz * metres;
      const first = h.roost.active;
      h.roost.update(h.frame, 1 / 30);
      const pos = h.roost.points.geometry.getAttribute('position');
      const result: number[] = [];
      for (let i = first; i < h.roost.active; i++) result.push(pos.getX(i) * h.p.tx + pos.getZ(i) * h.p.tz);
      return Math.max(...result) - Math.min(...result);
    };
    expect(move(0)).toBe(0);
    expect(move(0.5)).toBeGreaterThan(0.28);
    expect(move(8)).toBeLessThan(0.001);
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

  it('moves loaded shadows with the steered contact across a bank and clears old contacts on release', () => {
    const h = harness(), b = h.b + BIKE_BASE;
    h.roost.groundHeight = (_s, l) => 0.28 * l;
    h.frame[b + B.FORK] = 0.02;
    h.frame[b + B.SHOCK] = 0.15;
    h.frame[b + B.STEER] = -0.4;
    h.roost.update(h.frame, 0);
    const first = h.roost.wheelPatch(0, true)!.position.clone();
    const rear = h.roost.wheelPatch(0, false)!.position.clone();
    h.frame[b + B.FORK] = 0.29;
    h.frame[b + B.STEER] = 0.4;
    h.roost.update(h.frame, 0);
    const frontPatch = h.roost.wheelPatch(0, true)!;
    expect(frontPatch.position.distanceTo(first)).toBeGreaterThan(0.11);
    expect(h.roost.wheelPatch(0, false)!.position.distanceTo(rear)).toBeLessThan(1e-8);
    const l = h.track.nearest(frontPatch.position.x, frontPatch.position.z, trackPoint());
    expect(frontPatch.position.y).toBeCloseTo(0.28 * l, 6);
    expect(Math.abs(frontPatch.forward.dot(frontPatch.normal))).toBeLessThan(1e-6);
    const m = new T.Matrix4();
    h.roost.contactShadows!.getMatrixAt(0, m);
    const shadowAxis = new T.Vector3(0, 0, 1).transformDirection(m);
    expect(shadowAxis.dot(frontPatch.forward)).toBeGreaterThan(0.9999);
    h.load(0, 800);
    h.roost.update(h.frame, 0);
    expect(h.roost.wheelPatch(0, true)).toBeUndefined();
    h.frame[h.o + O.AIRBORNE] = 1;
    h.roost.update(h.frame, 0);
    expect(h.roost.wheelPatch(0, false)).toBeUndefined();
  });

  it('rests the loaded tyre and its rolling direction on the displayed rut facet during a seek', () => {
    const h = harness(), view = new TerrainView(h.track), axles = MotocrossAxles.of(VEHICLES.mx450);
    try {
      const relative = h.b + BIKE_BASE, quat = new T.Quaternion().fromArray(h.frame, h.b + F.QX);
      quat.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.48));
      quat.toArray(h.frame, h.b + F.QX);
      h.frame[relative + B.FORK] = 0.19;
      h.frame[relative + B.STEER] = 0.32;
      const plane = new T.Plane(), normal = new T.Vector3();
      let faceReads = 0;
      h.roost.groundHeight = (s, l, out) => {
        if (out) faceReads++;
        return view.heightAt(s, l, out);
      };
      const patch = () => {
        h.roost.update(h.frame, 0);
        const sample = h.roost.wheelPatch(0, true)!;
        expect(view.planeAtWorld(sample.position, plane)).toBe(true);
        expect(Math.abs(plane.distanceToPoint(sample.position))).toBeLessThan(1e-6);
        expect(sample.normal.dot(plane.normal)).toBeCloseTo(1, 7);
        axles.hub(true, h.frame[relative + B.FORK], h.frame[relative + B.STEER], new T.Vector3(), normal);
        normal.applyQuaternion(quat);
        expect(Math.abs(sample.forward.dot(normal))).toBeLessThan(1e-6);
        expect(Math.abs(sample.forward.dot(plane.normal))).toBeLessThan(1e-6);
        return sample;
      };
      view.record({ blocks: new Float32Array(), wetness: 0, reset: true }, 0, true);
      const initial = patch(), oldHeight = initial.position.y;
      const cell = view.heightCellAt(initial.station, initial.lateral);
      const stride = h.terrain.renderColumns;
      const blocks = Float32Array.from([cell, cell + 1, cell + stride, cell + stride + 1]
        .flatMap((i) => [i, 0.16, 0.4]));
      view.record({ blocks, wetness: 0, reset: false }, 1, true);
      expect(patch().position.y).toBeLessThan(oldHeight - 0.035);
      view.showAt(0);
      expect(patch().position.y).toBeCloseTo(oldHeight, 6);
      expect(faceReads).toBe(12); // twice for each of two loaded wheels, three presentations
    } finally {
      view.dispose();
    }
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
