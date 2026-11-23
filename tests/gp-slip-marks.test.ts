import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  B,
  BC,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  ROAD_BIKE_CONTACT,
  W,
  WHEEL_BASE,
  WHEEL_CONTACT_BASE,
  WHEEL_STRIDE,
  carBase,
  wheelContactBase,
} from '../src/simulation/protocol.ts';
import { SURFACE, type Track, type TrackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { gpSlipInk, GpSlipMarks } from '../src/rendering/gp-slip-marks.ts';

const track = {
  length: 2000,
  at(s: number, p: TrackPoint) {
    Object.assign(p, { x: 0, z: s, s, nx: 1, nz: 0, tx: 0, tz: 1, width: 8 });
    return p;
  },
} as Track;
const frame = new Float32Array(HEADER + CAR_STRIDE),
  c = carBase(0);
const contact = (wheel: number) => wheelContactBase(c, wheel);
const wheel = (i: number) => c + WHEEL_BASE + i * WHEEL_STRIDE;
function sample(t: number, z: number) {
  frame.fill(0);
  frame[H.TIME] = t;
  frame[H.CARS] = 1;
  frame[c + F.S] = frame[c + F.Z] = z;
  frame[c + F.QW] = 1;
  frame[c + F.Y] = 0.55;
  frame[c + F.SPEED] = 30;
  frame[c + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
  frame[c + WHEEL_CONTACT_BASE] = ROAD_BIKE_CONTACT;
  for (const i of [0, 2]) {
    const at = contact(i),
      w = wheel(i);
    frame[at + BC.Z] = z + (i ? -0.7 : 0.7);
    frame[at + BC.LOAD] = frame[w + W.LOAD] = 1000;
    frame[at + BC.NORMAL_Y] = 1;
    frame[w + W.PRESSURE] = 185;
    frame[w + W.SLIP_POWER] = 3200;
  }
  return frame;
}

describe('physical GP tyre wipes', () => {
  it('responds to sliding work, contact force and water at each axle', () => {
    const hard = gpSlipInk(1000, 25, 3200, 0);
    expect(hard).toBeGreaterThan(0.5);
    expect(gpSlipInk(1000, 25, 40, 0)).toBe(0);
    expect(gpSlipInk(1000, 25, 3200, 0.2)).toBeLessThan(hard);
    for (const args of [
      [0, 25, 3200, 0],
      [1000, 0, 3200, 0],
      [1000, 25, 3200, 0.4],
      [NaN, 25, 3200, 0],
    ])
      expect(gpSlipInk(args[0], args[1], args[2], args[3])).toBe(0);
  });

  it('renders two physical tread widths, keeps held frames stable and selects the recorded past', () => {
    const marks = new GpSlipMarks(track, new T.MeshStandardMaterial());
    marks.record(sample(0, 0));
    marks.record(sample(0.05, 1.5));
    marks.record(sample(0.1, 3));
    marks.record(frame);
    expect(marks.recordedSegments).toBe(4);
    marks.show(0.11);
    expect(marks.visibleSegments).toBe(4);
    const geometry = marks.mesh.geometry,
      p = geometry.getAttribute('position');
    const frontWidth = p.getX(1) - p.getX(0),
      rearWidth = p.getX(5) - p.getX(4);
    expect(frontWidth).toBeGreaterThan(0.045);
    expect(frontWidth).toBeLessThan(0.12);
    expect(rearWidth).toBeGreaterThan(frontWidth);
    expect(p.getY(0)).toBeCloseTo(0.006, 5);
    const v = (p as T.InterleavedBufferAttribute).data.version;
    marks.show(0.11);
    expect((p as T.InterleavedBufferAttribute).data.version).toBe(v);
    marks.show(0.025);
    expect(marks.mesh.visible).toBe(false);
    marks.show(0.075);
    expect(marks.visibleSegments).toBe(2);
    marks.truncate(0.075);
    expect(marks.recordedSegments).toBe(2);
    marks.record(sample(0.08, 15));
    marks.record(sample(0.13, 16.5));
    marks.show(1);
    expect(marks.visibleSegments).toBe(4);
    expect(p.getZ(8)).toBeGreaterThan(14);
    marks.clear();
    expect(marks.visibleSegments).toBe(0);
    expect(marks.recordedSegments).toBe(0);
  });

  it('breaks the ribbon at lifts, pits, device discontinuities and surface changes', () => {
    const marks = new GpSlipMarks(track, new T.MeshStandardMaterial());
    const air = () => {
      frame[contact(0) + BC.GAP] = 0.15;
      frame[contact(2) + BC.LOAD] = 0;
    };
    const gravel = () => {
      frame[wheel(0) + W.SURFACE] = frame[wheel(2) + W.SURFACE] = SURFACE.GRAVEL;
    };
    const service = () => {
      frame[c + F.IN_PIT] = 1;
    };
    const fallen = () => {
      frame[c + BIKE_BASE + B.STATE] = 2;
    };
    const legacy = () => {
      frame[c + WHEEL_CONTACT_BASE] = 0;
    };
    const otherMachine = () => {
      frame[c + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr2');
    };
    for (const cut of [air, gravel, service, fallen, legacy, otherMachine]) {
      marks.clear();
      marks.record(sample(0, 0));
      marks.record(sample(0.05, 1.5));
      sample(0.1, 3);
      cut();
      marks.record(frame);
      marks.record(sample(0.15, 4.5));
      marks.record(sample(0.2, 6));
      expect(marks.recordedSegments).toBe(4);
    }
    marks.record(sample(0.25, 90));
    expect(marks.recordedSegments).toBe(4);
    marks.record(sample(4, 92));
    expect(marks.recordedSegments).toBe(4);
  });

  it('draws a bounded ring across wraps and rebuilds exactly on backward and forward seeks', () => {
    const marks = new GpSlipMarks(track, new T.MeshStandardMaterial());
    for (let i = 0; i <= 1700; i++) marks.record(sample(i / 30, i));
    expect(marks.recordedSegments).toBe(3400);
    marks.show(60);
    const g = marks.mesh.geometry,
      p = g.getAttribute('position');
    const endCount = marks.visibleSegments,
      endStart = g.drawRange.start;
    const before = Array.from((p as T.InterleavedBufferAttribute).data.array);
    expect(endCount).toBeLessThan(marks.recordedSegments);
    expect(endStart).toBeGreaterThan(0);
    marks.show(0.07);
    expect(marks.visibleSegments).toBe(4);
    marks.show(60);
    expect(marks.visibleSegments).toBe(endCount);
    expect(g.drawRange.start).toBe(endStart);
    expect(Array.from((p as T.InterleavedBufferAttribute).data.array)).toEqual(before);
  });
});
