import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import type { ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { BikeShells } from '../src/rendering/bike.ts';
import { GP_CORNER_PRESET, menuPreview } from '../src/rendering/menu-preview.ts';
import { gpDiscGlow } from '../src/rendering/gp-disc-glow.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { Track } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { B, BIKE_BASE, F, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';

/** Vehicle art 3: D5 (CR-750 fairing), D10 (karts), D11 (trucks). Geometry facts, not pixels. */
beforeAll(() => {
  const noop = () => undefined;
  class Canvas {
    width = 256;
    height = 256;
    getContext() {
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 30 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
});
afterAll(() => vi.unstubAllGlobals());

function body(id: string) {
  const def = VEHICLES[id as keyof typeof VEHICLES];
  return buildVehicleBody(1, def, bodySheetFor(def)!);
}
const stats = (root: T.Object3D) => {
  root.updateMatrixWorld(true);
  let triangles = 0,
    meshes = 0;
  const box = new T.Box3().setFromObject(root);
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    meshes++;
    const g = o.geometry as T.BufferGeometry;
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { triangles, meshes, box };
};
const finite = (root: T.Object3D) => {
  let ok = true;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = (o.geometry as T.BufferGeometry).getAttribute('position').array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) ok = false;
  });
  return ok;
};
describe('D11 trucks: an upright face with hardware on it', () => {
  it('keeps the bonnet level to a tall, square front instead of drooping to the tip', () => {
    for (const id of ['dx8', 'rp6']) {
      const def = VEHICLES[id as keyof typeof VEHICLES];
      const sheet = bodySheetFor(def) as ClosedSheet;
      const frame = bodyFrame(def);
      const model = new ClosedBodyModel(frame, sheet, [
        sheet.wheels.width[0] / 2,
        sheet.wheels.width[1] / 2,
      ]);
      // The profile's height at the front axle and just behind the tip: the drop over the
      // overhang. The old sports-car droop fell (bonnet - nose + 0.06) there; a truck now falls
      // about half of (bonnet - nose), so a tall face stands at the front.
      const drop = model.topY(frame.frontAxle) - model.topY(model.zFront - 0.001),
        oldDrop = sheet.bonnet - sheet.nose + 0.06;
      expect(drop).toBeGreaterThan(0);
      expect(drop).toBeLessThan(oldDrop * 0.7);
      expect(finite(body(id).lods[0].group)).toBe(true);
    }
  });
  it('is detailed at the near level (lamps in the face, arch lips, bumper) and cheap at the far one', () => {
    const near = (id: string) => stats(body(id).lods[0].group).triangles;
    const far = (id: string) => stats(body(id).lods[2].group).triangles;
    for (const id of ['dx8', 'rp6']) {
      expect(near(id)).toBeGreaterThan(8000);
      // The hardware is `detail < 2` only: the far level carries none of it.
      expect(far(id)).toBeLessThan(near(id) / 4);
    }
  });
});

describe('D10 karts: moulded panels, and two different karts', () => {
  it('builds both karts with finite geometry at every level and a distinct plan', () => {
    const sk = body('sk125'),
      dk = body('dk100');
    for (const b of [sk, dk]) for (const lod of b.lods) expect(finite(lod.group)).toBe(true);
    const a = stats(sk.lods[0].group),
      c = stats(dk.lods[0].group);
    // The gearbox kart's nose is long and wide, the direct-drive kart's short and pointed: the
    // bodies differ in length, and in triangles (different panels, pods and bumper).
    expect(
      Math.abs(a.box.max.z - c.box.max.z) + Math.abs(a.box.min.z - c.box.min.z),
    ).toBeGreaterThan(0.05);
    expect(a.triangles).not.toBe(c.triangles);
    // Moulded: far more than the old ellipsoid-and-box kart (~10 k triangles at LOD0 was the old
    // total for both), and still a light machine.
    expect(a.triangles).toBeGreaterThan(5000);
    expect(a.triangles).toBeLessThan(60000);
    // The far level stays cheap.
    expect(stats(sk.lods[2].group).triangles).toBeLessThan(a.triangles / 3);
  });
});

describe('D5 CR-750 bullet fairing', () => {
  it('builds the tapered bullet with its lamp dome and bracket at every level', () => {
    const shells = new BikeShells();
    const host = { root: new T.Group() };
    const track = new Track('clear', false, undefined, circuitDefinition('aurel'));
    const frame = menuPreview(track, undefined, 'cr750');
    const camera = new T.PerspectiveCamera(50, 16 / 9);
    sampleChassisPose(frame, frame, carBase(0), 1, host.root.position, host.root.quaternion);
    shells.update(frame, frame, 1, [host], camera, 'high', 0);
    const levels = (
      shells as unknown as { entries: Map<number, { levels: { root: T.Group }[] }> }
    ).entries.get(0)!.levels;
    const counts = levels.map((level) => stats(level.root).triangles);
    // High > mid > far, all finite.
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    for (const level of levels) expect(finite(level.root)).toBe(true);
    shells.disposeAll();
  });
});

describe('GP-R1 corner hero frame (photo preset)', () => {
  const track = new Track('clear', false, undefined, circuitDefinition('aurel'));
  const o = carBase(0);
  it('leans 55 to 60 degrees, hangs the rider off, heats the rotors and rolls the chassis about its patch', () => {
    const frame = menuPreview(track, undefined, 'gpr1', GP_CORNER_PRESET);
    const lean = frame[o + BIKE_BASE + B.LEAN];
    expect((lean * 180) / Math.PI).toBeGreaterThan(55);
    expect((lean * 180) / Math.PI).toBeLessThan(60);
    expect(frame[o + BIKE_BASE + B.RIDER_OFFSET]).toBeCloseTo(0.25, 6);
    expect(gpDiscGlow(frame[o + WHEEL_BASE + W.DISC_TEMP])).toBeGreaterThan(0.2);
    expect(frame[o + F.BRAKE]).toBeGreaterThan(0.3);
    // The quaternion stays a unit and carries the roll about the machine's own forward axis.
    const q = new T.Quaternion(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    expect(q.length()).toBeCloseTo(1, 5);
    const side = new T.Vector3(1, 0, 0).applyQuaternion(q),
      yaw = Math.atan2(
        new T.Vector3(0, 0, 1).applyQuaternion(q).x,
        new T.Vector3(0, 0, 1).applyQuaternion(q).z,
      );
    // Leaning left drops the machine's left side (+x) by sin(lean) of its width: rolled, not just rotated.
    expect(side.y).toBeCloseTo(-Math.sin(lean), 3);
    expect(Number.isFinite(yaw)).toBe(true);
    // A plain preview is untouched, and a car ignores the pose.
    const plain = menuPreview(track, undefined, 'gpr1');
    expect(plain[o + BIKE_BASE + B.LEAN]).toBe(0);
    const car = menuPreview(track, undefined, 'apx01', GP_CORNER_PRESET);
    expect(car[o + F.QX]).toBe(0);
    expect(car[o + BIKE_BASE + B.LEAN]).toBe(0);
  });
  it('puts the knee on the road and lights the sparks through the real bike model', () => {
    const shells = new BikeShells();
    const host = { root: new T.Group() };
    const camera = new T.PerspectiveCamera(50, 16 / 9);
    for (const [pose, expectSparks] of [
      [GP_CORNER_PRESET, true],
      [undefined, false],
    ] as const) {
      const frame = menuPreview(track, undefined, 'gpr1', pose);
      sampleChassisPose(frame, frame, o, 1, host.root.position, host.root.quaternion);
      shells.update(frame, frame, 1, [host], camera, 'high', 0);
      const model = (
        shells as unknown as {
          entries: Map<
            number,
            { levels: { sliderSparks?: { points: T.Points }; rider: { kneeDown: number[] } }[] }
          >;
        }
      ).entries.get(0)!.levels[0];
      expect(model.sliderSparks?.points.visible).toBe(expectSparks);
      expect(model.rider.kneeDown.some(Boolean)).toBe(expectSparks);
    }
    shells.disposeAll();
  });
});
