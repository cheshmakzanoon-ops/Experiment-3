import { afterEach, describe, expect, it, vi } from 'vitest';
import { Quat, Vec3 } from '../src/core/math.ts';
import { drivenInertiaFactor } from '../src/simulation/differential.ts';
import { RoadContactFrame } from '../src/simulation/road-contact.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

afterEach(() => vi.restoreAllMocks());

function frameValues(frame: RoadContactFrame) {
  return [frame.normal, frame.axle, frame.forward, frame.lateral]
    .flatMap((v) => [v.x, v.y, v.z])
    .concat(frame.inclination);
}

type ClutchState = {
  tires: { load: number; slip: number }[];
  frontShare: number | null;
  drivenLeft: number;
  drivenRight: number;
  body: { mass: number };
  spec: { wheelRadius: number; wheelInertia: number };
  clutch: { wheelInertia: number };
};
const coupleClutch = Vehicle.prototype['coupleClutch'] as (
  this: ClutchState,
  share: number,
) => void;

function clutchState(): ClutchState {
  return {
    tires: Array.from({ length: 4 }, () => ({ load: 1000, slip: 0 })),
    frontShare: 0.35,
    drivenLeft: 2,
    drivenRight: 3,
    body: { mass: 900 },
    spec: { wheelRadius: 0.3, wheelInertia: 1.5 },
    clutch: { wheelInertia: -1 },
  };
}

describe('road-contact length reuse', () => {
  it('preserves the exact combined pitch, roll, bank, steer and camber frame with four hypot calls', () => {
    const frame = new RoadContactFrame(),
      orientation = new Quat();
    orientation.integrateWorld(new Vec3(0.14, 0.45, -0.12), 1);
    const hypot = vi.spyOn(Math, 'hypot');
    expect(frame.set(orientation, 0.32, new Vec3(-0.25, 1, 0.09), 0.08)).toBe(true);
    expect(hypot).toHaveBeenCalledTimes(4);
    // Float64 results captured from the unchanged 1c609bf method. Exact
    // equality also distinguishes signed zero; tolerance would hide reordering.
    expect(frameValues(frame)).toStrictEqual([
      -0.2416163888426646,
      0.9664655553706584,
      0.08698189998335926,
      0.7071429801249919,
      -0.10825460067037981,
      -0.6987343895169623,
      0.7070588650089061,
      0.11395254474410926,
      0.6979130167568587,
      0.6645970824905477,
      0.2301285463136345,
      -0.7108808410110837,
      0.34294167258950475,
    ]);
  });

  it('keeps invalid finite and angle guards ahead of length work and state mutation', () => {
    const frame = new RoadContactFrame();
    frame.set(new Quat().yaw(0.4), 0.2, new Vec3(-0.3, 1, 0.2), 0.1);
    const before = frameValues(frame);
    const cases: [Vec3, number, number][] = [
      [new Vec3(NaN, 1, 0), 0, 0],
      [new Vec3(Infinity, 1, 0), 0, 0],
      [new Vec3(Number.MAX_VALUE, Number.MAX_VALUE, 0), 0, 0],
      [new Vec3(0, 1, 0), NaN, 0],
      [new Vec3(0, 1, 0), -Infinity, 0],
      [new Vec3(0, 1, 0), 0, NaN],
      [new Vec3(0, 1, 0), 0, Infinity],
    ];
    for (const [normal, steering, camber] of cases) {
      const length = vi.spyOn(normal, 'length');
      expect(() => frame.set(new Quat(), steering, normal, camber)).toThrow(
        'Invalid road-contact frame',
      );
      expect(length).not.toHaveBeenCalled();
      expect(frameValues(frame)).toStrictEqual(before);
    }
  });

  it('preserves signed zeros, length thresholds and degenerate or overflowing normals', () => {
    const frame = new RoadContactFrame(),
      orientation = new Quat();
    expect(frame.set(orientation, 0, new Vec3(-0, 1e-8, -0))).toBe(true);
    expect(frame.normal).toStrictEqual(new Vec3(-0, 1, -0));
    const accepted = frameValues(frame);
    for (const length of [0, Number.MIN_VALUE, 1e-8 * (1 - Number.EPSILON)]) {
      expect(() => frame.set(orientation, 0, new Vec3(-0, length, -0))).toThrow(
        'Invalid road-contact frame',
      );
      expect(frameValues(frame)).toStrictEqual(accepted);
    }
    for (const tangent of [0, 1e-8 * (1 - Number.EPSILON)]) {
      expect(frame.set(orientation, 0, new Vec3(1, tangent, -0))).toBe(false);
      expect(frame.forward).toStrictEqual(new Vec3());
      expect(frame.lateral).toStrictEqual(new Vec3());
    }
    expect(frame.set(orientation, 0, new Vec3(1, 1e-8, -0))).toBe(true);
    // Vec3.finite accepts this cancelling sum, while hypot overflows. Retain
    // the existing scale-by-zero degeneracy instead of adding a new rejection.
    expect(
      frame.set(orientation, 0, new Vec3(Number.MAX_VALUE, -Number.MAX_VALUE, -0)),
    ).toBe(false);
    expect(frame.normal).toStrictEqual(new Vec3(0, -0, -0));
    expect(frame.forward).toStrictEqual(new Vec3());
    expect(frame.lateral).toStrictEqual(new Vec3());
  });
});

describe('clutch slip reduction without a temporary array', () => {
  it('uses the greatest absolute slip at every AWD corner without mapping the tires', () => {
    const state = clutchState(),
      map = vi.spyOn(state.tires, 'map');
    for (let wheel = 0; wheel < 4; wheel++) {
      for (const sign of [-1, 1]) {
        for (let i = 0; i < 4; i++) state.tires[i].slip = i === wheel ? sign * 0.06 : 0.02;
        coupleClutch.call(state, 0.4);
        // Half grip refers 4.05 kg m² plus the 1.5 kg m² wheel rotor,
        // then applies the existing AWD centre inertia factor.
        expect(state.clutch.wheelInertia).toBe(5.55 * drivenInertiaFactor(0.35));
      }
    }
    expect(map).not.toHaveBeenCalled();
  });

  it('retains zero-slip, saturation, invalid-slip and unsupported-wheel behavior', () => {
    const state = clutchState(),
      factor = drivenInertiaFactor(0.35);
    for (let wheel = 0; wheel < 4; wheel++) {
      for (const slip of [-0, 0, -0.12, 0.12, -Infinity, Infinity, NaN]) {
        for (const tire of state.tires) {
          tire.load = 1000;
          tire.slip = -0;
        }
        state.tires[wheel].slip = slip;
        coupleClutch.call(state, 0.4);
        if (Number.isNaN(slip)) expect(state.clutch.wheelInertia).toBeNaN();
        else expect(state.clutch.wheelInertia).toBe((slip === 0 ? 9.6 : 1.5) * factor);
        state.tires[wheel].load = 1;
        coupleClutch.call(state, 0.4);
        expect(state.clutch.wheelInertia).toBe(1.5 * factor);
      }
    }
  });

  it('continues to ignore undriven-wheel slips in either single-axle layout', () => {
    const state = clutchState();
    state.frontShare = null;
    for (const drivenLeft of [0, 2]) {
      state.drivenLeft = drivenLeft;
      state.drivenRight = drivenLeft + 1;
      for (let i = 0; i < 4; i++)
        state.tires[i].slip = i === drivenLeft || i === drivenLeft + 1 ? 0.06 : NaN;
      coupleClutch.call(state, 0.4);
      expect(state.clutch.wheelInertia).toBe(9.6);
    }
  });
});
