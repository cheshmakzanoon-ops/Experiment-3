import * as T from 'three';
import { describe, expect, it } from 'vitest';
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
import { trackPoint } from '../src/simulation/track.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';

function field() {
  const track = rigTrack('valley-ridge-mx'),
    marks = new MxTyreTraces(track),
    roost = new Roost(track);
  let rut = 0;
  const surface = {
    geometryRevision: 0,
    heightAt: (s: number, l: number) => 2 + s * 0.003 + l * 0.14 - rut,
  };
  roost.groundHeight = surface.heightAt;
  const def = VEHICLES.mx450,
    p = trackPoint(),
    sag = factoryBikeSag(def),
    o = carBase(0);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
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
