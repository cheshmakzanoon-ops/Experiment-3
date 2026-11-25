import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G } from '../src/core/math.ts';
import { circuitDefinition, type CircuitDefinition, type CircuitId } from '../src/simulation/circuits.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import * as stops from '../src/simulation/offroad/contact-impulse.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { trackPoint, type SurfaceSample } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;
const solve = stops.coupledHardStopImpulses;
const single = stops.hardStopImpulse;
type Arguments = Parameters<typeof solve>;
type Internals = {
  vertical(dt: number): void;
  spring(compression: number, front: boolean): number;
  flightSpeed: number;
  mxYawRate: number;
  mxReferenceSpeed: number;
  playerMotocross: boolean;
  motocrossCourse: boolean;
};
const internals = (bike: DirtBikeVehicle) => bike as unknown as Internals;

/** A laboratory plane selects production course eligibility without changing
 * an authored venue, definition, force law, or the DirtBikeVehicle adapter. */
class Plane extends DynamicsTrack {
  override readonly circuit: CircuitDefinition;
  constructor(
    readonly gx: number, readonly gz: number,
    venue: CircuitId = 'valley-ridge-mx', readonly origin = 0,
  ) {
    super();
    this.circuit = circuitDefinition(venue);
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = this.gx * (x - this.origin) + this.gz * (z - this.origin);
    out.normal.set(-this.gx, 1, -this.gz).normalize();
    return out;
  }
}

function motion(bike: DirtBikeVehicle) {
  const state = internals(bike), heading = bike.dynamics.heading;
  const horizontal = bike.airborne ? state.flightSpeed : bike.dynamics.speed * Math.cos(bike.groundPitch);
  const yawRate = bike.airborne ? bike.airYawRate : state.playerMotocross ? state.mxYawRate : 0;
  return {
    horizontal, vertical: bike.vy, lateral: bike.slide, pitchRate: bike.pitchRate, yawRate,
    x: Math.sin(heading) * horizontal + Math.cos(heading) * bike.slide,
    z: Math.cos(heading) * horizontal - Math.sin(heading) * bike.slide,
  };
}
type Motion = ReturnType<typeof motion>;
type Impact = {
  args: Arguments;
  impulses: ReturnType<typeof solve>;
  before: Motion;
  after?: Motion;
  heading: number;
  rows: { gx: number; gz: number; pitch: number; yaw: number }[];
};

/** Read the contact's world gradient and differentiate the actual free-wheel
 * geometry. This oracle does not reuse the helper's travel-frame Jacobian. */
function rows(bike: DirtBikeVehicle) {
  const spec = bike.definition.bike!, sag = factoryBikeSag(bike.definition),
    chassis = bike.dynamics.heading + bike.airYaw, epsilon = 1e-6;
  return [true, false].map(front => {
    const normal = bike.contacts[front ? 0 : 2].normal,
      gx = -normal.x / normal.y, gz = -normal.z / normal.y,
      reach = front ? spec.cgToFront : -spec.cgToRear,
      height = spec.cgHeight + (front ? sag.fork : sag.shock),
      free = (pitch: number) => reach * Math.sin(pitch) - height * Math.cos(pitch);
    return {
      gx, gz,
      pitch: (free(bike.pitch + epsilon) - free(bike.pitch - epsilon)) / (2 * epsilon),
      yaw: reach * (gx * Math.cos(chassis) - gz * Math.sin(chassis)),
    };
  });
}

/** The real solver still runs. The first following spring evaluation is the
 * observation boundary: impulses have been published, but gravity, spring
 * torque, pitch damping and touchdown coordinate changes have not run. */
function observe(bike: DirtBikeVehicle, reversed = false) {
  const state = internals(bike), spring = state.spring, impacts: Impact[] = [];
  let pending: Impact | undefined;
  const coupled = vi.spyOn(stops, 'coupledHardStopImpulses').mockImplementation((...args) => {
    const result = reversed ? solve(args[0], args[1], args[2], args[4], args[3], args[5]) : solve(...args);
    const impulses = reversed ? { front: result.rear, rear: result.front } : result;
    pending = { args, impulses, before: motion(bike), rows: rows(bike), heading: bike.dynamics.heading };
    impacts.push(pending);
    return impulses;
  });
  const legacy = vi.spyOn(stops, 'hardStopImpulse');
  const springRead = vi.spyOn(state, 'spring').mockImplementation((compression, front) => {
    if (pending && !pending.after) pending.after = motion(bike);
    return spring.call(state, compression, front);
  });
  return { impacts, coupled, legacy, restore() {
    coupled.mockRestore(); legacy.mockRestore(); springRead.mockRestore();
  } };
}

function energy(v: Motion, mass: number, pitchInertia: number, yawInertia: number) {
  return 0.5 * (mass * (v.x ** 2 + v.vertical ** 2 + v.z ** 2) +
    pitchInertia * v.pitchRate ** 2 + yawInertia * v.yawRate ** 2);
}

function certify(bike: DirtBikeVehicle, impact: Impact, player = true) {
  const { args: [velocity, mass, pitchInertia, front, rear, yawInertia = Infinity], before, after, impulses } = impact;
  expect(after).toBeDefined();
  const spec = bike.definition.bike!;
  expect(mass).toBe(bike.dynamics.mass);
  expect(mass).toBe(bike.body.mass);
  expect(pitchInertia).toBe(bike.air.pitchInertia);
  expect(yawInertia).toBeCloseTo(Math.max(12, 0.42 * mass * (spec.cgToFront ** 2 + spec.cgToRear ** 2)), 12);
  for (const key of ['horizontal', 'vertical', 'pitchRate', 'lateral', 'yawRate'] as const)
    expect(velocity[key] ?? 0).toBeCloseTo(before[key], 12);
  const delta = { x: 0, vertical: 0, z: 0, pitch: 0, yaw: 0 };
  let loss = 0;
  for (const [index, contact, impulse] of [[0, front, impulses.front], [1, rear, impulses.rear]] as const) {
    expect(impulse).toBeGreaterThanOrEqual(0);
    if (!contact) {
      expect(impulse).toBe(0);
      continue;
    }
    const row = impact.rows[index];
    // AI intentionally retains its longitudinal-only terrain convention.
    const heading = impact.heading;
    const gx = player ? row.gx : contact.grade * Math.sin(heading),
      gz = player ? row.gz : contact.grade * Math.cos(heading), yaw = player ? row.yaw : 0;
    expect(contact.lever).toBeCloseTo(row.pitch, 8);
    expect(contact.grade).toBeCloseTo(row.gx * Math.sin(heading) + row.gz * Math.cos(heading), 11);
    expect(contact.crossGrade ?? 0).toBeCloseTo(player ? row.gx * Math.cos(heading) - row.gz * Math.sin(heading) : 0, 11);
    expect(contact.yawArm ?? 0).toBeCloseTo(yaw, 10);
    const closing = (v: Motion) => gx * v.x + gz * v.z - v.vertical - row.pitch * v.pitchRate + yaw * v.yawRate;
    expect(closing(after!)).toBeLessThanOrEqual(2e-9);
    expect(impulse * closing(after!)).toBeCloseTo(0, 5);
    delta.x -= gx * impulse;
    delta.z -= gz * impulse;
    delta.vertical += impulse;
    delta.pitch += row.pitch * impulse;
    delta.yaw -= yaw * impulse;
    loss += 0.5 * impulse * closing(before);
  }
  for (const key of ['x', 'vertical', 'z'] as const)
    expect(mass * (after![key] - before[key])).toBeCloseTo(delta[key], 8);
  expect(pitchInertia * (after!.pitchRate - before.pitchRate)).toBeCloseTo(delta.pitch, 6);
  expect(yawInertia * (after!.yawRate - before.yawRate)).toBeCloseTo(delta.yaw, 8);
  const beforeEnergy = energy(before, mass, pitchInertia, yawInertia),
    afterEnergy = energy(after!, mass, pitchInertia, yawInertia);
  expect(afterEnergy).toBeLessThanOrEqual(beforeEnergy + 1e-8);
  expect(beforeEnergy - afterEnergy).toBeCloseTo(loss, 5);
  return beforeEnergy - afterEnergy;
}

type Scenario = {
  name: string; grade: number; cross: number; heading: number; yaw: number;
  axle: 'front' | 'rear' | 'both';
};
const scenarios: Scenario[] = [
  { name: 'flat', grade: 0, cross: 0, heading: 0, yaw: 0, axle: 'both' },
  { name: 'front uphill', grade: 0.3, cross: 0, heading: 0.7, yaw: 0, axle: 'front' },
  { name: 'rear downhill', grade: -0.25, cross: 0, heading: -0.4, yaw: 0, axle: 'rear' },
  { name: 'off-camber', grade: 0.08, cross: 0.45, heading: -0.9, yaw: 0, axle: 'both' },
  { name: 'yawed bank', grade: 0.18, cross: -0.35, heading: 1.2, yaw: 0.4, axle: 'both' },
];

function fixture(
  definition: VehicleDefinition, scenario: Scenario, airborne = false,
  { ai = false, venue = 'valley-ridge-mx' as CircuitId, origin = 0, id = 0, fuel = 0.4 } = {},
) {
  const sh = Math.sin(scenario.heading), ch = Math.cos(scenario.heading),
    track = new Plane(sh * scenario.grade + ch * scenario.cross, ch * scenario.grade - sh * scenario.cross, venue, origin),
    bike = new DirtBikeVehicle(id, 'medium', DEFAULT_SETUP, 'raw', definition), spec = definition.bike!;
  bike.fuel = spec.fuel * fuel;
  bike.placeFree(track, origin, origin, scenario.heading, 0);
  bike.dynamics.speed = 12;
  bike.gear = 3;
  bike.aiControlled(ai ? 1e6 : 0);
  bike.step(DT, track); // Let the real public step select player/course scope.
  bike.airborne = airborne;
  bike.airYaw = airborne ? scenario.yaw : 0;
  bike.airYawRate = airborne ? 0.9 : 0;
  internals(bike).mxYawRate = 0.9;
  internals(bike).flightSpeed = 12;
  bike.dynamics.speed = 12;
  internals(bike).mxReferenceSpeed = 12;
  bike.slide = 2.3;
  bike.vy = -6;
  bike.pitchRate = 0.6;
  // Controlled initial overlap, using the real fixed hard points. The
  // public step must select and construct its own stop contacts from it.
  const chassis = bike.dynamics.heading + bike.airYaw, sag = factoryBikeSag(definition),
    HF = spec.cgHeight + sag.fork, HR = spec.cgHeight + sag.shock,
    front = track.sample(bike.dynamics.x + Math.sin(chassis) * spec.cgToFront,
      bike.dynamics.z + Math.cos(chassis) * spec.cgToFront, bike.contacts[0]).height,
    rear = track.sample(bike.dynamics.x - Math.sin(chassis) * spec.cgToRear,
      bike.dynamics.z - Math.cos(chassis) * spec.cgToRear, bike.contacts[2]).height,
    cF = spec.forkTravel + (scenario.axle === 'rear' ? -0.05 : 0.16),
    cR = spec.shockTravel + (scenario.axle === 'front' ? -0.05 : 0.16),
    length = spec.cgToFront + spec.cgToRear;
  bike.pitch = Math.asin((front - rear - cF + cR) / Math.hypot(length, HF - HR)) + Math.atan2(HF - HR, length);
  bike.cgY = rear + spec.cgToRear * Math.sin(bike.pitch) + HR * Math.cos(bike.pitch) - cR;
  return { bike, track };
}

afterEach(() => vi.restoreAllMocks());

describe('the live motocross hard-stop consumer', () => {
  it.each([MX_250, MX_450])('$id applies one physical impulse before compliant spring/gravity work', definition => {
    for (const scenario of scenarios) for (const airborne of [false, true]) {
      const { bike, track } = fixture(definition, scenario, airborne), tap = observe(bike);
      try {
        bike.step(DT, track);
        expect(tap.impacts, `${scenario.name}, airborne=${airborne}`).toHaveLength(1);
        const impact = tap.impacts[0];
        expect(Boolean(impact.args[3])).toBe(scenario.axle !== 'rear');
        expect(Boolean(impact.args[4])).toBe(scenario.axle !== 'front');
        expect(tap.legacy).not.toHaveBeenCalled();
        expect(certify(bike, impact)).toBeGreaterThan(0);
        // The full tick includes real compliant force and gravity work;
        // its energy is deliberately not called an inelastic impact loss.
        expect(Math.abs(bike.vy - impact.after!.vertical)).toBeGreaterThan(G * DT);
      } finally { tap.restore(); }
    }
  });

  it.each([MX_250, MX_450])('$id consumes either axle order and repeated zero-time solves without new momentum', definition => {
    const final: Motion[] = [];
    for (const reversed of [false, true]) {
      const { bike } = fixture(definition, scenarios[3]), tap = observe(bike, reversed);
      try {
        let projectedHeight = 0;
        for (let repeat = 0; repeat < 8; repeat++) {
          internals(bike).vertical(0);
          certify(bike, tap.impacts[repeat]);
          if (repeat > 0) {
            expect(tap.impacts[repeat].impulses.front + tap.impacts[repeat].impulses.rear).toBeLessThan(1e-9);
            expect(bike.cgY).toBeCloseTo(projectedHeight, 12);
          } else projectedHeight = bike.cgY;
        }
        final.push(motion(bike));
      } finally { tap.restore(); }
    }
    for (const key of Object.keys(final[0]) as (keyof Motion)[])
      expect(final[0][key]).toBeCloseTo(final[1][key], 11);
  });

  it('does not impulse separating deep contacts or contacts that remain within suspension travel', () => {
    for (const separating of [false, true]) {
      const { bike } = fixture(MX_250, scenarios[0]), tap = observe(bike);
      try {
        if (separating) {
          bike.vy = 6;
          bike.pitchRate = 0;
        } else bike.cgY += 0.4;
        const before = motion(bike);
        internals(bike).vertical(0);
        if (separating) {
          expect(tap.impacts).toHaveLength(1);
          expect(tap.impacts[0].impulses).toEqual({ front: 0, rear: 0 });
          certify(bike, tap.impacts[0]);
        } else expect(tap.coupled).not.toHaveBeenCalled();
        expect(tap.legacy).not.toHaveBeenCalled();
        expect(motion(bike)).toEqual(before);
      } finally { tap.restore(); }
    }
  });

  it('keeps AI stops coupled at any world position while retaining their legacy cross/yaw scope', () => {
    for (const airborne of [false, true]) {
      const results: Motion[] = [];
      for (const origin of [0, 20000]) {
        const { bike } = fixture(MX_450, scenarios[3], airborne, { ai: true, origin, id: origin ? 11 : 0 }), tap = observe(bike);
        try {
          expect(internals(bike).playerMotocross).toBe(false);
          internals(bike).vertical(0);
          expect(tap.impacts).toHaveLength(1);
          for (const contact of tap.impacts[0].args.slice(3, 5) as stops.HardStopContact[]) {
            expect(contact.crossGrade).toBe(0);
            expect(contact.yawArm).toBe(0);
          }
          certify(bike, tap.impacts[0], false);
          results.push(motion(bike));
        } finally { tap.restore(); }
      }
      for (const key of Object.keys(results[0]) as (keyof Motion)[])
        expect(results[0][key]).toBeCloseTo(results[1][key], 8);
    }
  });

  it('retains the single and sequential legacy calls for supermoto and road-course dirt bikes', () => {
    for (const [definition, venue] of [[SM_450, 'valley-ridge-mx'], [MX_250, 'aurel']] as const)
      for (const axle of ['front', 'both'] as const) {
      const { bike } = fixture(definition, { ...scenarios[1], axle }, false, { venue }), tap = observe(bike), before = motion(bike);
      try {
        internals(bike).vertical(0);
        expect(tap.coupled).not.toHaveBeenCalled();
        expect(tap.legacy).toHaveBeenCalledTimes(axle === 'both' ? 2 : 1);
        let expected = { ...before };
        for (const [i, args] of tap.legacy.mock.calls.entries()) {
          const impulse = single(...args);
          expect(tap.legacy.mock.results[i].value).toBe(impulse);
          expect(args[8]).toBe(0);
          expect(args[9]).toBeUndefined();
          expect(args[0]).toBeCloseTo(expected.horizontal, 11);
          expect(args[1]).toBeCloseTo(expected.vertical, 11);
          expect(args[2]).toBeCloseTo(expected.pitchRate, 11);
          expected = { ...expected, horizontal: args[0] - args[3] * impulse / args[5],
            vertical: args[1] + impulse / args[5], pitchRate: args[2] + args[4] * impulse / args[6] };
        }
        const after = motion(bike);
        for (const key of ['horizontal', 'vertical', 'pitchRate'] as const)
          expect(after[key]).toBeCloseTo(expected[key], 11);
        expect(after.lateral).toBe(before.lateral);
        expect(after.yawRate).toBe(before.yawRate);
        expect(energy(after, bike.dynamics.mass, bike.air.pitchInertia, 1))
          .toBeLessThanOrEqual(energy(before, bike.dynamics.mass, bike.air.pitchInertia, 1) + 1e-8);
      } finally { tap.restore(); }
    }
  });

  it.each([MX_250, MX_450])('$id reaches the coupled stop through the unmodified stadium median approach', definition => {
    const track = rigTrack('arena-nord-sx'), point = track.at(36, trackPoint()),
      bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition), collisions = new CollisionSolver();
    bike.placeFree(track, point.x - point.nx * 5, point.z - point.nz * 5,
      Math.atan2(-point.nx, -point.nz), 0);
    bike.dynamics.speed = 10;
    bike.gear = 2;
    bike.input.throttle = 0.2;
    const tap = observe(bike);
    for (let tick = 0; tick < 3 / DT && bike.riding; tick++) {
      bike.step(DT, track);
      for (const impact of tap.impacts.splice(0)) certify(bike, impact);
      collisions.solve([bike], track);
    }
    expect(tap.coupled).toHaveBeenCalled();
    expect(tap.legacy).not.toHaveBeenCalled();
    expect(bike.body.position.finite()).toBe(true);
  });

  it('does not add kinetic energy when the forward-only publication clips a backward stop result', () => {
    for (const definition of [MX_250, MX_450]) {
      const scenario = { ...scenarios[0], grade: 0.55 }, { bike } = fixture(definition, scenario), tap = observe(bike);
      bike.dynamics.speed = 1 / Math.cos(bike.groundPitch);
      bike.vy = -8;
      bike.pitchRate = 0;
      bike.slide = 0;
      internals(bike).mxYawRate = 0;
      try {
        for (let repeat = 0; repeat < 8; repeat++) {
          internals(bike).vertical(0);
          const impact = tap.impacts[repeat], [, mass, inertia, , , iz = Infinity] = impact.args;
          expect(impact.after!.horizontal).toBeGreaterThanOrEqual(0);
          expect(energy(impact.after!, mass, inertia, iz))
            .toBeLessThanOrEqual(energy(impact.before, mass, inertia, iz) + 1e-8);
        }
        // The scalar travel representation can need another stop solve
        // after clipping backward motion. This test certifies passivity,
        // not full contact closure across that documented publication limit.
      } finally { tap.restore(); }
    }
  });
});
