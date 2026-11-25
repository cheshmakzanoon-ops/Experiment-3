import * as T from 'three';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import {
  MX_BOOT_PEDAL, MX_BOOT_PEG, motocrossBootFrame,
} from '../src/rendering/offroad/motocross-rider-contact.ts';
import { MxGearStroke } from '../src/simulation/offroad/mx-gear-stroke.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const context = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

const configurations = (['mx250', 'mx450'] as const)
  .flatMap(id => (['mid', 'high'] as const).map(detail => [id, detail] as const));
const interruptionTimes = [.060, .063, .078, .090, .115, .126, .174, .205, .220, .231, .236, .259];
const handoffTimes = [0, .003, .005, .010, .015, .022, .032, .039, .045, .060];

it.each(configurations)('%s/%s clears the actual sleeve through repeated and reversed accepted strokes', (id, detail) => {
  const materials = new BikeMaterials(0), definition = VEHICLES[id];
  const model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms());
  const selector = model.root.getObjectByName('Motocross gear selector')!;
  const boot = model.root.getObjectByName('Motocross left boot')!;
  const toe = new T.Vector3(...MX_BOOT_PEDAL).sub(new T.Vector3(...MX_BOOT_PEG))
    .applyQuaternion(motocrossBootFrame(new T.Quaternion()));
  const stroke = new MxGearStroke(), ray = new T.Raycaster();
  const pose: BikePoseValues = { ...staticSag(definition), steer: 0, frontRotation: 0, rearRotation: 0,
    chassisLean: 0, riderOffset: 0, tuck: 0, brake: 0, rearBrake: .75,
    discTemp: 0, compoundColour: 0xffffff, riding: true, standing: .24 };
  const sleeve = new T.Vector3(), origin = new T.Vector3(), axis = new T.Vector3();
  const surface = (object: T.Object3D, up: number) => {
    ray.set(origin.copy(sleeve).addScaledVector(axis.set(0, up, 0), -.14), axis);
    return ray.intersectObject(object, true)[0]?.point.y;
  };
  const gap = (time: number) => {
    stroke.sample(time);
    pose.shiftAngle = stroke.angle;
    pose.shiftCover = stroke.cover;
    pose.shiftClear = stroke.clear;
    model.pose(pose);
    model.root.updateMatrixWorld(true);
    let distance = Infinity;
    // Inspect three stations across the authored rubber sleeve, including
    // the original control-animation fixture's .031 m contact station.
    for (const x of [.014, .031, .043]) {
      selector.localToWorld(sleeve.set(x, toe.y + .072, toe.z + .016));
      const bottom = surface(boot, 1), top = surface(boot, -1);
      const low = surface(selector, 1)!, high = surface(selector, -1)!;
      expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true);
      // A lateral clearing motion legitimately takes the forefoot outside
      // this vertical ray. If it overlaps the sleeve in plan, their two
      // measured surface intervals must remain separated within 3 mm.
      if (bottom !== undefined && top !== undefined)
        distance = Math.min(distance, Math.max(bottom - high, low - top));
    }
    return distance;
  };
  try {
    // Keep a positive control: the existing meshes must still make contact
    // on both the toe crown and the sole, rather than simply missing rays.
    for (const [direction, at] of [[1, .045], [-1, .115]]) {
      stroke.reset();
      stroke.engage(direction, 0);
      const distance = gap(at);
      expect(distance).toBeGreaterThan(-.003);
      expect(distance).toBeLessThan(.006);
    }
    let minimum = Infinity, worst = '';
    const check = (clock: number, label: string) => {
      const distance = gap(clock);
      if (distance < minimum) {
        minimum = distance;
        worst = `${label}, clock=${clock}, cover=${stroke.cover}, clear=${stroke.clear}`;
      }
    };
    for (const first of [-1, 1]) for (const next of [-1, 1]) {
      for (const at of interruptionTimes) {
        stroke.reset();
        stroke.engage(first, 0);
        stroke.engage(next, at);
        for (const after of handoffTimes) check(at + after, `${first} -> ${next} at ${at}`);
      }
    }
    stroke.reset();
    let clock = 0;
    for (const [direction, interval] of [
      [-1, .060], [-1, .063], [1, .115], [-1, .060],
      [1, .231], [1, .090], [-1, .060], [1, .174],
    ]) {
      stroke.engage(direction, clock);
      for (const after of handoffTimes) check(clock + after, `repeated ${direction}`);
      clock += interval;
    }
    expect(minimum, worst).toBeGreaterThan(-.003);
    expect(gap(clock + .260)).toBeLessThan(.006);
    expect([stroke.angle, stroke.cover, stroke.clear]).toEqual([0, 0, 0]);
  } finally {
    model.dispose();
    materials.dispose();
  }
});

it('keeps the toe outside while crossing the sleeve for every 60–259 ms interruption', () => {
  const stroke = new MxGearStroke();
  let minimumClear = 1;
  for (const first of [-1, 1]) for (const next of [-1, 1]) {
    for (let elapsed = 60; elapsed < 260; elapsed++) {
      stroke.reset();
      stroke.engage(first, 0);
      stroke.engage(next, elapsed / 1000);
      for (let tick = 0; tick <= 60; tick++) {
        stroke.sample((elapsed + tick) / 1000);
        if (stroke.cover > .12 && stroke.cover < .88)
          minimumClear = Math.min(minimumClear, stroke.clear);
      }
    }
  }
  expect(minimumClear).toBeGreaterThan(.94);
});

it('joins every coordinated waypoint with continuous positions and rates', () => {
  const stroke = new MxGearStroke(), epsilon = 1e-9;
  const values = () => [stroke.cover, stroke.clear];
  const rates = () => [stroke.coverRate, stroke.clearRate];
  for (const direction of [-1, 1]) for (const at of [.063, .115, .220, .236]) {
    stroke.reset();
    stroke.engage(-1, 0);
    stroke.sample(at);
    const position = values(), velocity = rates();
    stroke.engage(direction, at);
    stroke.sample(at);
    expect(values()).toEqual(position);
    rates().forEach((rate, axis) => expect(rate).toBeCloseTo(velocity[axis], 9));
    for (const after of [.010, .032, .045, .059, .260]) {
      stroke.sample(at + after - epsilon);
      const before = values(), incoming = rates();
      stroke.sample(at + after + epsilon);
      rates().forEach((rate, axis) => expect(rate).toBeCloseTo(incoming[axis], 3));
      values().forEach((value, axis) => expect(value).toBeCloseTo(before[axis], 6));
    }
    expect([...values(), ...rates()]).toEqual([0, 0, 0, 0]);
  }
});
