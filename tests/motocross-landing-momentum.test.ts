import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { motocrossYawInertia } from '../src/simulation/offroad/mx-ground-physics.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

/** Deliberately exercise the production adapter transition, not a second
 * implementation of touchdown. The public step tests below also prove its
 * real caller enables the player-MX path and publishes the same velocity. */
interface LandingState {
  flightSpeed: number;
  playerMotocross: boolean;
  roadPitch: number;
  mxYawRate: number;
  projectedContact: boolean;
  vertical(dt: number, boundary?: { front: boolean; rear: boolean; time: number }): void;
  stepInterval(dt: number, track: Track, boundary: boolean): void;
  firstFlightContact(dt: number, start: unknown): boolean;
  writeBody(track: Track, dt: number): void;
}

function state(bike: DirtBikeVehicle) {
  return bike as unknown as LandingState;
}

function horizontal(forward: number, side: number, heading: number) {
  return {
    x: Math.sin(heading) * forward + Math.cos(heading) * side,
    z: Math.cos(heading) * forward - Math.sin(heading) * side,
  };
}

function physicalVelocity(bike: DirtBikeVehicle) {
  const forward = bike.airborne
    ? state(bike).flightSpeed
    : bike.dynamics.speed * Math.cos(bike.groundPitch);
  return { ...horizontal(forward, bike.slide, bike.dynamics.heading), y: bike.vy };
}

function energy(bike: DirtBikeVehicle) {
  const v = physicalVelocity(bike);
  return 0.5 * bike.dynamics.mass * (v.x ** 2 + v.y ** 2 + v.z ** 2);
}

function motion(bike: DirtBikeVehicle) {
  return {
    clock: bike.clock, x: bike.dynamics.x, z: bike.dynamics.z, y: bike.cgY,
    velocity: physicalVelocity(bike), speed: bike.dynamics.speed,
    heading: bike.dynamics.heading, lateral: bike.slide, airborne: bike.airborne,
    frontSpin: bike.frontSpin, rearSpin: bike.rearSpin,
  };
}

/** Keep first contact separate from later grounded pickup in the same
 * public update. These wrappers only observe the real integration calls. */
function contactIntervals(bike: DirtBikeVehicle) {
  const internal = state(bike), physical = internal.stepInterval.bind(bike),
    vertical = internal.vertical.bind(bike), contact = internal.firstFlightContact.bind(bike);
  type Motion = ReturnType<typeof motion>;
  const complete: { duration: number; before: Motion; after: Motion; force: number[];
    frontInertia: number; controls: number[]; previousBodyY: number }[] = [];
  const events: { boundary: { front: boolean; rear: boolean; time: number };
    index: number; duration: number; incoming: Motion; outgoing: Motion }[] = [];
  const completed: Motion[] = [];
  const physicalSpy = vi.spyOn(internal, 'stepInterval').mockImplementation((dt, track, boundary) => {
    const before = motion(bike), interval = { duration: dt, before, after: before,
      force: [0, 0], frontInertia: bike.tires[0].inertia, controls: [0, 0, 0, 0],
      previousBodyY: bike.body.position.y };
    complete.push(interval);
    physical(dt, track, boundary);
    interval.after = motion(bike);
    interval.force = [bike.tires[0].fx, bike.tires[2].fx];
    interval.controls = [bike.brake, bike.rearBrake,
      bike.dynamics.assistedDriveForce, bike.dynamics.engineBrakeForce];
  });
  const verticalSpy = vi.spyOn(internal, 'vertical').mockImplementation((dt, boundary) => {
    const incoming = motion(bike);
    vertical(dt, boundary);
    if (boundary) events.push({ boundary: { ...boundary }, index: complete.length - 1,
      duration: dt, incoming, outgoing: motion(bike) });
  });
  const contactSpy = vi.spyOn(internal, 'firstFlightContact').mockImplementation((dt, start) => {
    const landed = contact(dt, start);
    if (landed) completed.push(motion(bike));
    return landed;
  });
  return { complete, events, completed, restore() {
    contactSpy.mockRestore(); verticalSpy.mockRestore(); physicalSpy.mockRestore();
  } };
}

function samePhysicalState(bike: DirtBikeVehicle, plain: DirtBikeVehicle) {
  expect(motion(bike)).toEqual(motion(plain));
  expect(bike.dynamics).toEqual(plain.dynamics);
  expect(bike.tires).toEqual(plain.tires);
  expect(bike.body).toEqual(plain.body);
  expect(bike.machineMotion).toEqual(plain.machineMotion);
  expect([bike.fuel, bike.gear, bike.rpm, bike.riderBody, bike.riderBodyRate,
    bike.pitch, bike.pitchRate, bike.airYaw, bike.airYawRate, bike.fork, bike.shock,
    bike.forceFront, bike.forceRear]).toEqual([
    plain.fuel, plain.gear, plain.rpm, plain.riderBody, plain.riderBodyRate,
    plain.pitch, plain.pitchRate, plain.airYaw, plain.airYawRate, plain.fork, plain.shock,
    plain.forceFront, plain.forceRear,
  ]);
}

/** Exact free-wheel geometry for chosen incoming compressions. The contact
 * samples are fixed horizontally, as in production writeBody(). */
function contactPose(bike: DirtBikeVehicle, compression: readonly [number, number]) {
  const spec = bike.definition.bike!,
    L = bike.spec.wheelbase,
    sag = factoryBikeSag(bike.definition),
    HF = spec.cgHeight + sag.fork,
    HR = spec.cgHeight + sag.shock,
    front = bike.contacts[0].height,
    rear = bike.contacts[2].height;
  bike.pitch = Math.asin(
    (front - rear - compression[0] + compression[1]) / Math.hypot(L, HF - HR),
  ) + Math.atan2(HF - HR, L);
  bike.cgY = rear + spec.cgToRear * Math.sin(bike.pitch) +
    HR * Math.cos(bike.pitch) - compression[1];
}

function touchdown(
  definition: VehicleDefinition,
  grade: number,
  compression: readonly [number, number] = [0.01, 0.01],
  cross = 0,
  yaw = 0,
  heading = 0,
) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    spec = definition.bike!,
    internal = state(bike),
    chassisGrade = grade * Math.cos(yaw) + cross * Math.sin(yaw),
    gradient = horizontal(grade, cross, heading);
  bike.dynamics.mass = definition.spec.dryMass + spec.fuel;
  bike.dynamics.speed = internal.flightSpeed = 10;
  bike.dynamics.heading = heading;
  internal.playerMotocross = true;
  internal.roadPitch = Math.asin(chassisGrade);
  bike.airborne = true;
  bike.airTime = 0.5;
  bike.vy = -8;
  bike.airYaw = yaw;
  bike.airYawRate = 0.7;
  bike.frontSpin = 0;
  bike.rearSpin = 79;
  for (const [index, reach] of [[0, spec.cgToFront], [2, -spec.cgToRear]]) {
    bike.contacts[index].height = reach * chassisGrade;
    bike.contacts[index].normal.set(-gradient.x, 1, -gradient.z).normalize();
  }
  contactPose(bike, compression);
  return bike;
}

describe('player motocross touchdown momentum', () => {
  it.each([MX_250, MX_450])(
    '$id preserves horizontal momentum at compliant front, rear and two-tyre contact',
    (definition) => {
      for (const grade of [-0.3, 0, 0.3])
        for (const compression of [[0.01, 0.01], [0.01, -0.05], [-0.05, 0.01]] as const)
          for (const dt of [1 / 120, 1 / 240, 1 / 480, 1e-4, 1e-6, 1e-8]) {
            const bike = touchdown(definition, grade, compression),
              before = physicalVelocity(bike),
              beforeEnergy = energy(bike);
            // Upstream now refines supported motion internally. Compare the
            // transition with the same already-supported initial state,
            // rather than treating its incoming force sample as a mean force.
            const supported = touchdown(definition, grade, compression);
            supported.airborne = false;
            supported.dynamics.speed = 10 / Math.cos(supported.groundPitch);
            state(supported).vertical(dt);
            state(bike).vertical(dt);
            const after = physicalVelocity(bike);
            expect(bike.airborne).toBe(false);
            expect(state(bike).projectedContact).toBe(false);
            expect(bike.forceFront > 0).toBe(compression[0] > 0);
            expect(bike.forceRear > 0).toBe(compression[1] > 0);
            expect(after.x).toBeCloseTo(before.x, 12);
            expect(after.z).toBeCloseTo(before.z, 12);
            expect(after.y).toBeCloseTo(supported.vy, 12);
            expect(bike.cgY).toBeCloseTo(supported.cgY, 12);
            expect(bike.pitchRate).toBeCloseTo(supported.pitchRate, 12);
            // Contact/gravity work tends to zero with dt. A finite energy
            // jump at first contact cannot be attributed to the springs.
            expect(Math.abs(energy(bike) - beforeEnergy)).toBeLessThan(1e5 * dt);
            expect(bike.frontSpin).toBe(0);
            expect(bike.rearSpin).toBe(79);
          }
    },
  );

  it.each([MX_250, MX_450])(
    '$id re-expresses yawed, sideways landings without redirecting world momentum',
    (definition) => {
      for (const grade of [-0.3, 0, 0.3])
        for (const cross of [-0.35, 0.35])
          for (const yaw of [-0.5, 0.5])
            for (const heading of [-2.1, 0, 0.8])
              for (const side of [-2, 2]) {
                const bike = touchdown(definition, grade, [0.01, 0.01], cross, yaw, heading);
                bike.slide = side;
                const before = physicalVelocity(bike), beforeEnergy = energy(bike);
                state(bike).vertical(1e-8);
                const after = physicalVelocity(bike);
                expect(bike.airborne).toBe(false);
                expect(after.x).toBeCloseTo(before.x, 11);
                expect(after.z).toBeCloseTo(before.z, 11);
                expect(Math.abs(energy(bike) - beforeEnergy)).toBeLessThan(0.001);
                expect(bike.dynamics.heading).toBeCloseTo(heading + yaw, 12);
                expect(bike.airYaw).toBe(0);
                expect(bike.airYawRate).toBe(0);
                expect(state(bike).mxYawRate).toBe(0.7);
                expect(bike.lastLanding!.yawError).toBe(yaw);
                expect(bike.lastLanding!.normalSpeed).toBeCloseTo(
                  (grade * 10 + cross * side + 8) / Math.hypot(1, grade, cross),
                  12,
                );
                expect(bike.frontSpin).toBe(0);
                expect(bike.rearSpin).toBe(79);
              }
    },
  );

  it.each([MX_250, MX_450])(
    '$id retains the real normal impulse on a deep, banked landing before changing speed units',
    (definition) => {
      for (const grade of [-0.3, 0.3])
        for (const compression of [[0.6, -0.08], [-0.08, 0.6], [0.6, 0.6]] as const)
          for (const yaw of [-0.35, 0.35]) {
            const cross = 0.25, side = -1.4, heading = 0.7, dt = 1e-8,
              bike = touchdown(definition, grade, compression, cross, yaw, heading),
              spec = definition.bike!,
              yawInertia = motocrossYawInertia(bike.dynamics.mass, spec.cgToFront, spec.cgToRear);
            bike.slide = side;
            bike.pitchRate = -0.4;
            const beforeEnergy = energy(bike) +
              0.5 * bike.air.pitchInertia * bike.pitchRate ** 2 +
              0.5 * yawInertia * bike.airYawRate ** 2;
            state(bike).vertical(dt);
            expect(bike.airborne).toBe(false);
            expect(state(bike).projectedContact).toBe(true);
            // Every hard-stop impulse follows the same plane normal. Remove
            // the known compliant/gravity increment to recover its vertical
            // impulse and independently predict both horizontal components.
            const impulsePerMass = bike.vy + 8 -
              ((bike.forceFront + bike.forceRear) / bike.dynamics.mass - G) * dt;
            expect(impulsePerMass).toBeGreaterThan(0);
            const expected = horizontal(10 - grade * impulsePerMass, side - cross * impulsePerMass, heading),
              after = physicalVelocity(bike),
              afterEnergy = energy(bike) +
                0.5 * bike.air.pitchInertia * bike.pitchRate ** 2 +
                0.5 * yawInertia * state(bike).mxYawRate ** 2;
            expect(after.x).toBeCloseTo(expected.x, 10);
            expect(after.z).toBeCloseTo(expected.z, 10);
            expect(afterEnergy).toBeLessThan(beforeEnergy);
            expect(bike.frontSpin).toBe(0);
            expect(bike.rearSpin).toBe(79);
          }
    },
  );

  it.each([MX_250, MX_450, SM_450])(
    '$id keeps the existing non-player touchdown conversion',
    (definition) => {
      for (const grade of [-0.3, 0, 0.3]) {
        const bike = touchdown(definition, grade);
        state(bike).playerMotocross = false;
        state(bike).vertical(1 / 240);
        const slope = Math.atan(grade);
        expect(bike.dynamics.speed).toBeCloseTo(10 * Math.cos(slope) + bike.vy * Math.sin(slope), 12);
        expect(bike.frontSpin).toBeCloseTo(bike.dynamics.speed / definition.bike!.frontWheelRadius, 12);
        expect(bike.rearSpin).toBeCloseTo(bike.dynamics.speed / definition.bike!.rearWheelRadius, 12);
      }
    },
  );

  it.each([MX_250, MX_450])(
    '$id preserves first-contact momentum and accounts for later public-step wheel pickup on sloping terrain',
    (definition) => {
      const track = rigTrack('valley-ridge-mx'),
        p = track.at(35, trackPoint()),
        heading = Math.atan2(p.tx, p.tz),
        sample = track.sample.bind(track);
      for (const grade of [-0.3, 0, 0.3])
        for (const cross of [-0.25, 0.25])
          for (const yaw of [-0.35, 0, 0.35])
            for (const dt of [1 / 120, 1 / 240, 1 / 480]) {
              const gradient = horizontal(grade, cross, heading),
                terrain = vi.spyOn(track, 'sample').mockImplementation((x, z, out, hint) => {
                  sample(x, z, out, hint);
                  out.height = p.y + gradient.x * (x - p.x) + gradient.z * (z - p.z);
                  out.normal.set(-gradient.x, 1, -gradient.z).normalize();
                  return out;
                });
              try {
                const create = () => {
                  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
                  bike.place(track, 35);
                  bike.airborne = true;
                  bike.airTime = 0.5;
                  bike.dynamics.speed = state(bike).flightSpeed = 10;
                  bike.slide = 1.2;
                  bike.vy = -8;
                  bike.airYaw = yaw;
                  bike.frontSpin = 0;
                  bike.rearSpin = 79;
                  state(bike).writeBody(track, 0);
                  contactPose(bike, [0.04, 0.04]);
                  state(bike).writeBody(track, 0);
                  return bike;
                };
                const bike = create(), plain = grade === 0.3 && cross === 0.25 && yaw === 0.35 && dt === 1 / 120
                  ? create() : null, ledger = contactIntervals(bike), initial = motion(bike);
                // Both tyres already overlap at the incoming instant. The
                // swept solver finds t=0, so there is no free-flight span
                // in which drag could reduce the event's momentum. Later
                // complete intervals have genuine grounded tyre impulses.
                try {
                  bike.step(dt, track);
                  expect(ledger.events).toHaveLength(1);
                  expect(ledger.completed).toHaveLength(1);
                  const event = ledger.events[0], first = ledger.complete[0], completion = ledger.completed[0];
                  expect(event.index).toBe(0);
                  expect(event.boundary).toEqual({ front: true, rear: true, time: initial.clock });
                  expect(event.duration).toBe(first.duration);
                  expect(event.incoming.velocity).toEqual(initial.velocity);
                  expect([event.incoming.x, event.incoming.y, event.incoming.z]).toEqual([
                    initial.x, initial.y, initial.z,
                  ]);
                  for (const phase of [event.outgoing, completion]) {
                    expect(phase.airborne).toBe(false);
                    expect(phase.velocity.x).toBeCloseTo(initial.velocity.x, 10);
                    expect(phase.velocity.z).toBeCloseTo(initial.velocity.z, 10);
                    expect(phase.frontSpin).toBe(0);
                    // The rotor phase precedes swept contact and advances
                    // once over the containing physical interval.
                    expect(phase.rearSpin).toBeCloseTo(79 - 2 * first.duration, 12);
                  }
                  expect(first.after).toEqual(completion);
                  expect(ledger.complete.reduce((sum, interval) => sum + interval.duration, 0)).toBeCloseTo(dt, 12);
                  let frontImpulse = 0, rearImpulse = 0, previous = initial;
                  for (const [index, interval] of ledger.complete.entries()) {
                    const { before, after, duration } = interval;
                    expect(before).toEqual(previous);
                    expect(after.clock - before.clock).toBeCloseTo(duration, 12);
                    if (index === 0) {
                      expect(before.airborne).toBe(true);
                      expect(interval.force).toEqual([0, 0]);
                    } else {
                      expect(before.airborne || after.airborne).toBe(false);
                      expect(interval.controls).toEqual([0, 0, 0, 0]);
                      expect(interval.frontInertia * (after.frontSpin - before.frontSpin)).toBeCloseTo(
                        -interval.force[0] * definition.bike!.frontWheelRadius * duration, 11);
                      expect(bike.air.spinInertia * (after.rearSpin - before.rearSpin)).toBeCloseTo(
                        -interval.force[1] * definition.bike!.rearWheelRadius * duration, 11);
                    }
                    frontImpulse += interval.force[0] * duration;
                    rearImpulse += interval.force[1] * duration;
                    previous = after;
                  }
                  expect(bike.tires[0].fx * dt).toBeCloseTo(frontImpulse, 11);
                  expect(bike.tires[2].fx * dt).toBeCloseTo(rearImpulse, 11);
                  expect(motion(bike)).toEqual(previous);
                  const velocity = physicalVelocity(bike), last = ledger.complete.at(-1)!;
                  expect(bike.body.velocity.x).toBeCloseTo(velocity.x, 10);
                  expect(bike.body.velocity.z).toBeCloseTo(velocity.z, 10);
                  expect(bike.body.velocity.y).toBeCloseTo((bike.body.position.y - last.previousBodyY) / last.duration, 10);
                  expect(state(bike).playerMotocross).toBe(true);
                  expect(bike.airborne).toBe(false);
                  expect(bike.riding).toBe(true);
                  expect(state(bike).projectedContact).toBe(false);
                  expect(bike.landings).toBe(1);
                  expect(bike.dynamics.crashes).toBe(0);
                  expect(bike.lastLanding!.normalSpeed).toBeGreaterThan(4);
                  expect(bike.lastLanding!.time).toBe(initial.clock);
                  expect([bike.cgY, bike.vy, bike.pitch, bike.pitchRate,
                    bike.dynamics.speed, bike.slide, bike.frontSpin, bike.rearSpin,
                    bike.forceFront, bike.forceRear, bike.body.velocity.y,
                    bike.fork, bike.shock].every(Number.isFinite)).toBe(true);
                  if (dt === 1 / 120) {
                    expect(ledger.complete.length).toBeGreaterThan(1);
                    expect(bike.frontSpin).toBeGreaterThan(completion.frontSpin);
                  }
                  if (plain) {
                    plain.step(dt, track);
                    for (let tick = 0; tick < 32; tick++) {
                      samePhysicalState(bike, plain);
                      bike.step(dt, track);
                      plain.step(dt, track);
                    }
                    samePhysicalState(bike, plain);
                  }
                } finally { ledger.restore(); }
              } finally {
                terrain.mockRestore();
              }
            }
    },
  );
});
