import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MX_RAKE } from '../src/rendering/offroad/motocross-axles.ts';
import { smRoadContactAngle } from '../src/rendering/offroad/motocross-road-tread.ts';
import { MxTyreTraces } from '../src/rendering/offroad/mx-tyre-traces.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { Roost } from '../src/rendering/offroad/roost.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  M,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_MOTION_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';

function field(machine: 'mx450' | 'sm450' = 'mx450') {
  const track = rigTrack('valley-ridge-mx'),
    marks = new MxTyreTraces(track),
    roost = new Roost(track);
  let rut = 0;
  const surface = {
    geometryRevision: 0,
    heightAt: (s: number, l: number) => 2 + s * 0.003 + l * 0.14 - rut,
  };
  roost.groundHeight = surface.heightAt;
  const def = VEHICLES[machine],
    p = trackPoint(),
    sag = factoryBikeSag(def),
    o = carBase(0);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(machine);
  frame[o + F.SPEED] = 14;
  frame[o + BIKE_BASE + B.FORK] = sag.fork;
  frame[o + BIKE_BASE + B.SHOCK] = sag.shock;
  for (const w of [o + WHEEL_BASE, o + WHEEL_BASE + 2 * WHEEL_STRIDE]) {
    frame[w + W.SURFACE] = MATERIAL.DIRT;
    frame[w + W.LOAD] = 580;
    frame[w + W.OMEGA] = 41.3;
  }
  const drive = (s: number, t: number, l = 0) => {
    track.at(s, p);
    const yaw = Math.atan2(p.tx, p.tz);
    frame[H.TIME] = t;
    frame[o + F.X] = p.x + p.nx * l;
    frame[o + F.Z] = p.z + p.nz * l;
    frame[o + F.Y] = surface.heightAt(s, l) + def.bike!.cgHeight;
    frame[o + F.QY] = Math.sin(yaw / 2);
    frame[o + F.QW] = Math.cos(yaw / 2);
    marks.record(frame, roost);
  };
  return {
    marks,
    roost,
    frame,
    o,
    drive,
    surface,
    lower: () => {
      rut += 0.12;
      surface.geometryRevision++;
    },
    dispose: () => {
      marks.dispose();
      roost.dispose();
    },
  };
}

describe('fresh motocross tyre impressions', () => {
  it('lays 22 pairs per physical revolution, including reverse, wheel lock and older frames', () => {
    const h = field();
    const tau = 2 * Math.PI,
      wheel = h.o + WHEEL_BASE,
      motion = h.o + WHEEL_MOTION_BASE,
      geometry = h.marks.mesh.geometry;
    const phases = (from: number, front: boolean) => {
      const uv = geometry.getAttribute('uv'),
        print = geometry.getAttribute('mxTrace');
      const steps: number[] = [];
      for (let i = from; i < h.marks.recordedSegments; i++)
        if ((print.getW(i * 4) === 1) === front) steps.push(uv.getY(i * 4 + 2) - uv.getY(i * 4));
      expect(steps.length).toBeGreaterThan(0);
      return steps.reduce((total, delta) => total + delta, 0);
    };
    try {
      h.frame[motion + M.VALID] = 5;
      h.frame[wheel + W.ROTATION] = tau * 0.25;
      h.frame[wheel + 2 * WHEEL_STRIDE + W.ROTATION] = tau * 0.75;
      h.frame[wheel + W.OMEGA] = h.frame[wheel + 2 * WHEEL_STRIDE + W.OMEGA] = 0;
      h.drive(60, 0);
      h.frame[motion + M.TURNS_FR] = 1;
      h.frame[wheel + 2 * WHEEL_STRIDE + W.ROTATION] = tau * 0.25;
      h.drive(60.8, 0.05);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(phases(0, true)).toBeCloseTo(22, 4);
      expect(phases(0, false)).toBeCloseTo(-11, 4);
      expect(geometry.getAttribute('uv').getY(0)).toBeCloseTo(0.5, 4);
      let previous = h.marks.recordedSegments;
      h.drive(61.6, 0.1);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(phases(previous, true)).toBe(0);
      expect(phases(previous, false)).toBe(0);
      // Legacy snapshots have angular velocity without a measured winding.
      previous = h.marks.recordedSegments;
      h.frame[motion + M.VALID] = 0;
      h.frame[wheel + W.OMEGA] = tau / 0.05;
      h.drive(62.4, 0.15);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(phases(previous, true)).toBeCloseTo(11, 3);
      previous = h.marks.recordedSegments;
      h.drive(63.2, 0.2);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(phases(previous, true)).toBeCloseTo(22, 3);
    } finally {
      h.dispose();
    }
  });
  it('matches the SM450 groove phase against the displayed axle as the track banks and bars turn', () => {
    const rake = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -MX_RAKE);
    const ground = new T.Vector3(-0.35, 0.88, 0.23).normalize();
    for (const steer of [-0.37, 0, 0.44]) {
      const bar = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), steer);
      const normal = ground.clone().applyQuaternion(rake.clone().multiply(bar).invert());
      expect(smRoadContactAngle(ground, true, steer)).toBeCloseTo(
        Math.atan2(normal.z, normal.y),
        12,
      );
      expect(smRoadContactAngle(ground, false, steer)).toBeCloseTo(
        Math.atan2(ground.z, ground.y),
        12,
      );
    }
  });
  it('presses the distinct SM450 front and rear moulds while letting real slip erase their channels', () => {
    const h = field('sm450');
    try {
      const motion = h.o + WHEEL_MOTION_BASE;
      const front = h.o + WHEEL_BASE;
      const rear = front + 2 * WHEEL_STRIDE;
      h.frame[motion + M.VALID] = 5;
      h.frame[front + W.SLIP] = 0;
      h.frame[rear + W.SLIP] = 0.8;
      h.drive(60, 0);
      h.frame[motion + M.TURNS_FR] = 1;
      h.frame[motion + M.TURNS_RR] = 1;
      h.drive(60.8, 0.05);
      h.marks.show(h.frame[H.TIME], h.surface);
      const print = h.marks.mesh.geometry.getAttribute('mxTrace');
      const uv = h.marks.mesh.geometry.getAttribute('uv');
      const winding = [0, 0];
      for (let segment = 0; segment < h.marks.recordedSegments; segment++) {
        const vertex = segment * 4;
        const pitch = -print.getW(vertex);
        const axle = print.getZ(vertex) === 0 ? 0 : 1;
        expect(print.getZ(vertex)).toBe(axle);
        expect(pitch).toBeCloseTo(2 * Math.PI * (axle === 0 ? 0.3 / 20 : 0.31 / 24), 6);
        winding[axle] += uv.getY(vertex + 2) - uv.getY(vertex);
      }
      expect(winding[0]).toBeCloseTo(20, 2);
      expect(winding[1]).toBeCloseTo(24, 2);
    } finally {
      h.dispose();
    }
  });
  it('piles the measured skid to the side of travel and restores its wetness when seeking', () => {
    const h = field();
    try {
      const geometry = h.marks.mesh.geometry;
      const shear = geometry.getAttribute('mxShear');
      const print = geometry.getAttribute('mxTrace');
      const sample = (start: number) =>
        Array.from({ length: h.marks.recordedSegments - start }, (_, i) =>
          shear.getX((start + i) * 4),
        );
      h.frame[h.o + OFFROAD_BASE + O.MOISTURE] = 0.74;
      h.drive(60, 0);
      h.drive(60.8, 0.05, 0.65);
      h.marks.show(h.frame[H.TIME], h.surface);
      const right = sample(0),
        first = h.marks.recordedSegments;
      expect(first).toBeGreaterThan(0);
      expect(Math.min(...right)).toBeGreaterThan(0.8);
      expect(shear.getY(0)).toBeCloseTo(0.74, 2);
      h.drive(61.6, 0.1, 0);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(Math.max(...sample(first))).toBeLessThan(-0.8);
      const second = h.marks.recordedSegments;
      h.frame[h.o + WHEEL_BASE + W.ANGLE] = 0.6;
      h.drive(62.4, 0.15, 0);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(sample(second).every((v) => v === 0)).toBe(true);
      expect(print.getZ(second * 4)).toBe(0);
      const held = Array.from(shear.array);
      h.marks.show(0, h.surface);
      h.marks.show(h.frame[H.TIME], h.surface);
      expect(Array.from(shear.array)).toEqual(held);
    } finally {
      h.dispose();
    }
  });

  it('submits only unexpired quads in one indexed draw when their GPU slots wrap', () => {
    const h = field();
    const geometry = h.marks.mesh.geometry,
      index = geometry.index!;
    const capacity = geometry.getAttribute('position').count / 4;
    const arrivals: number[] = [];
    try {
      for (let i = 0; i < 10000 && arrivals.length < capacity + 75; i++) {
        h.drive(40 + (i % 145) * 0.74, i / 30);
        while (arrivals.length < h.marks.recordedSegments) arrivals.push(h.frame[H.TIME]);
      }
      expect(arrivals.length).toBeGreaterThan(capacity);
      const now = h.frame[H.TIME],
        first = arrivals.findIndex((t) => t > now - 12);
      const count = arrivals.length - first;
      h.marks.show(now, h.surface);
      expect(first).toBeLessThan(capacity);
      expect(h.marks.visibleSegments).toBe(count);
      expect(geometry.drawRange).toEqual({ start: first * 6, count: count * 6 });
      for (let i = 0; i < count; i++)
        expect(index.getX(geometry.drawRange.start + i * 6)).toBe(((first + i) % capacity) * 4);
      h.marks.show(now + 13, h.surface);
      expect(h.marks.visibleSegments).toBe(0);
      expect(h.marks.mesh.visible).toBe(false);
      h.marks.show(now, h.surface);
      expect(geometry.drawRange).toEqual({ start: first * 6, count: count * 6 });
    } finally {
      h.dispose();
    }
  });

  it('updates only the actual ground cells beneath a print across sparse ruts, compaction and rewinds', () => {
    const lap = field(),
      view = new TerrainView(rigTrack('valley-ridge-mx'));
    const surface = {
      get geometryRevision() {
        return view.geometryRevision;
      },
      heightRevisions: view.heightRevisions,
      heightCellAt: view.heightCellAt.bind(view),
      heightAt: view.heightAt.bind(view),
    };
    let reads = 0;
    surface.heightAt = (s, l) => {
      reads++;
      return view.heightAt(s, l);
    };
    try {
      view.record({ blocks: new Float32Array(), wetness: 0, reset: true }, 0, true);
      for (let i = 0; i < 18; i++) lap.drive(46 + i * 0.71, i / 20);
      const time = lap.frame[H.TIME];
      lap.marks.show(time, surface);
      const vertices = reads;
      expect(vertices).toBeGreaterThan(50);
      const initial = Array.from(lap.marks.mesh.geometry.getAttribute('position').array);
      const here = view.heightCellAt(52, 0),
        away = view.heightCellAt(160, 0);
      const change = (cell: number, depth: number, compaction: number, t: number) => {
        view.record(
          { blocks: new Float32Array([cell, depth, compaction]), wetness: 0, reset: false },
          t,
          true,
        );
        reads = 0;
        lap.marks.show(time, surface);
        return reads;
      };
      expect(change(away, 0.09, 0.4, 1)).toBe(0);
      expect(change(here, 0, 0.5, 2)).toBe(0);
      const affected = change(here, 0.1, 0.5, 3);
      expect(affected).toBeGreaterThan(0);
      expect(affected).toBeLessThan(vertices / 2);
      expect(Array.from(lap.marks.mesh.geometry.getAttribute('position').array)).not.toEqual(
        initial,
      );
      view.showAt(0);
      lap.marks.show(time, surface);
      expect(Array.from(lap.marks.mesh.geometry.getAttribute('position').array)).toEqual(initial);
    } finally {
      lap.dispose();
      view.dispose();
    }
  });

  it('records the same trail independently of display cadence, reprojects into ruts, and restores a replay seek', () => {
    const live = field(),
      sparse = field();
    try {
      for (let i = 0; i <= 24; i++) {
        const s = 46 + i * 0.71,
          time = i / 20;
        live.drive(s, time);
        sparse.drive(s, time);
        live.marks.show(time, live.surface);
      }
      // Use the exact stored Float32 timestamp of the authoritative frame.
      const time = live.frame[H.TIME];
      live.marks.show(time, live.surface);
      sparse.marks.show(time, sparse.surface);
      expect(live.marks.recordedSegments).toBeGreaterThan(48);
      expect(live.marks.recordedSegments).toBe(sparse.marks.recordedSegments);
      const g = live.marks.mesh.geometry;
      const visible = () =>
        Array.from(g.getAttribute('position').array.slice(0, g.drawRange.count * 2));
      const original = visible(),
        v = g.getAttribute('position') as T.BufferAttribute;
      expect(original).toEqual(
        Array.from(
          sparse.marks.mesh.geometry.getAttribute('position').array.slice(0, original.length),
        ),
      );
      const version = v.version;
      live.marks.show(time, live.surface);
      expect(v.version).toBe(version);
      live.marks.show(0.51, live.surface);
      expect(visible().length).toBeLessThan(original.length);
      live.marks.show(time, live.surface);
      expect(visible()).toEqual(original);
      live.lower();
      live.marks.show(time, live.surface);
      expect(v.getY(0)).toBeCloseTo(original[1] - 0.12, 5);
      expect(v.getX(0)).toBe(original[0]);
      expect(g.getAttribute('mxTrace').getY(0)).toBeGreaterThan(0.35);
      live.marks.show(time + 13, live.surface);
      expect(live.marks.mesh.visible).toBe(false);
    } finally {
      live.dispose();
      sparse.dispose();
    }
  });

  it('breaks the trail on flight, pit surfaces, missing snapshots and teleports, and discards a branched future', () => {
    const h = field(),
      off = h.o + OFFROAD_BASE,
      wheel = h.o + WHEEL_BASE;
    try {
      h.drive(30, 0);
      h.drive(30.72, 0.05);
      const start = h.marks.recordedSegments;
      expect(start).toBeGreaterThan(0);
      h.frame[off + O.AIRBORNE] = 1;
      h.drive(31.4, 0.1);
      h.drive(32.1, 0.15);
      h.frame[off + O.AIRBORNE] = 0;
      h.drive(32.8, 0.2);
      expect(h.marks.recordedSegments).toBe(start);
      h.frame[wheel + W.SURFACE] = h.frame[wheel + 2 * WHEEL_STRIDE + W.SURFACE] = MATERIAL.ASPHALT;
      h.drive(33.5, 0.25);
      h.frame[wheel + W.SURFACE] = h.frame[wheel + 2 * WHEEL_STRIDE + W.SURFACE] = MATERIAL.DIRT;
      h.drive(34.2, 0.3);
      h.drive(40, 1.0);
      h.drive(100, 1.05);
      expect(h.marks.recordedSegments).toBe(start);
      h.drive(100.72, 1.1);
      expect(h.marks.recordedSegments).toBeGreaterThan(start);
      const beforeRetirement = h.marks.recordedSegments;
      h.frame[h.o + F.RETIRED] = 1;
      h.drive(101.44, 1.15);
      expect(h.marks.recordedSegments).toBe(beforeRetirement);
      h.frame[h.o + F.RETIRED] = 0;
      h.drive(30, 0.01);
      expect(h.marks.recordedSegments).toBe(0);
      h.marks.show(3, h.surface);
      expect(h.marks.mesh.visible).toBe(false);
      h.drive(30.7, 0.06);
      h.marks.show(0.08, h.surface);
      expect(h.marks.mesh.visible).toBe(true);
    } finally {
      h.dispose();
    }
  });
});
