import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import type { CircuitId } from '../src/simulation/circuits.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';

interface SuspensionState {
  playerMotocross: boolean;
  motocrossCourse: boolean;
  flightSpeed: number;
  faceSlope: number;
  freeSteps: number;
  mxYawRate: number;
  sampleSuspensionContacts(track: Track): void;
  airTorque: number;
  automaticBody: number;
  vertical(dt: number, boundary?: { front: boolean; rear: boolean; time: number }): void;
  stepInterval(dt: number, track: Track, boundary: boolean): void;
  writeBody(track: Track, dt: number): void;
}
const state = (bike: DirtBikeVehicle) => bike as unknown as SuspensionState;
const cases = [MX_250, MX_450].flatMap(definition => (['raw', 'sport'] as Assist[])
  .map(assist => ({ definition, assist, id: definition.id })));
const planar = (forward: number, lateral: number, heading: number) => ({
  x: Math.sin(heading) * forward + Math.cos(heading) * lateral,
  z: Math.cos(heading) * forward - Math.sin(heading) * lateral,
});

function motion(bike: DirtBikeVehicle) {
  const d = bike.dynamics;
  return {
    clock: bike.clock, airborne: bike.airborne, airTime: bike.airTime,
    x: d.x, z: d.z, y: bike.cgY, vy: bike.vy, heading: d.heading,
    forward: bike.airborne ? state(bike).flightSpeed : d.speed * Math.cos(bike.groundPitch),
    lateral: bike.slide, speed: d.speed, mass: d.mass,
    frontSpin: bike.frontSpin, rearSpin: bike.rearSpin,
  };
}
type Motion = ReturnType<typeof motion>;
type FlightInterval = {
  duration: number; before: Motion; after: Motion; drag: number;
  previousBodyY: number;
  force: number[]; brake: number; rearBrake: number; frontInertia: number;
  airTorque: number; bodyTorque: number;
};

/** Check the actual free intervals after the conversion. Refining a public
 * update may leave real drag/rotor motion after its takeoff event. The exact
 * quadratic-drag arc and gravity energy balance are independent of the
 * adapter's choice of interval count. */
function freeIntervals(bike: DirtBikeVehicle, start: Motion, intervals: FlightInterval[], duration: number) {
  const a = bike.air;
  let expected = start, elapsed = 0;
  for (const interval of intervals) {
    const { before, after, duration: dt } = interval, k = interval.drag / after.mass,
      travel = k === 0 ? before.forward * dt : Math.log1p(k * before.forward * dt) / k,
      forward = before.forward / (1 + k * before.forward * dt),
      world = planar(forward, before.lateral, before.heading),
      previousWorld = planar(before.forward, before.lateral, before.heading),
      velocity = before.vy - G * dt;
    expect(before).toEqual(expected);
    expect(before.airborne && after.airborne).toBe(true);
    expect(interval.force).toEqual([0, 0]);
    expect(after.heading).toBe(before.heading);
    expect(after.lateral).toBe(before.lateral);
    expect(after.forward).toBeCloseTo(forward, 11);
    expect(after.speed).toBeCloseTo(forward, 11);
    expect(after.x).toBeCloseTo(before.x + Math.sin(before.heading) * travel +
      Math.cos(before.heading) * before.lateral * dt, 10);
    expect(after.z).toBeCloseTo(before.z + Math.cos(before.heading) * travel -
      Math.sin(before.heading) * before.lateral * dt, 10);
    expect(after.y).toBeCloseTo(before.y + before.vy * dt - 0.5 * G * dt ** 2, 11);
    expect(after.vy).toBeCloseTo(velocity, 11);
    const beforeEnergy = 0.5 * after.mass * (previousWorld.x ** 2 + previousWorld.z ** 2 + before.vy ** 2),
      afterEnergy = 0.5 * after.mass * (world.x ** 2 + world.z ** 2 + after.vy ** 2),
      dragWork = 0.5 * after.mass * (forward ** 2 - before.forward ** 2);
    expect(afterEnergy - beforeEnergy + after.mass * G * (after.y - before.y)).toBeCloseTo(dragWork, 7);
    expect(dragWork).toBeLessThanOrEqual(0);
    // These real face approaches release both brakes. Rotor drag and rear
    // drive may continue, but neither rotor resets to the rolling speed.
    expect([interval.brake, interval.rearBrake]).toEqual([0, 0]);
    const coast = before.frontSpin * Math.exp(-0.4 * dt),
      frontImpulse = interval.frontInertia * (after.frontSpin - coast);
    expect(after.frontSpin).toBeCloseTo(coast, 11);
    expect(a.spinInertia * (after.rearSpin - before.rearSpin)).toBeCloseTo(
      (interval.airTorque - interval.bodyTorque) * dt - frontImpulse, 11);
    expect(after.airTime - before.airTime).toBeCloseTo(dt, 12);
    elapsed += dt;
    expected = after;
  }
  expect(elapsed).toBeCloseTo(duration, 12);
  return expected;
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

/** Replace only a fixture's queried height field with an analytical plane.
 * Production placement, sampling and dynamics still own the contact points. */
function plane(grade: number, cross = 0, venue: CircuitId = 'valley-ridge-mx') {
  const track = rigTrack(venue), point = track.at(35, trackPoint()),
    heading = Math.atan2(point.tx, point.tz), gradient = planar(grade, cross, heading),
    sample = track.sample.bind(track);
  const spy = vi.spyOn(track, 'sample').mockImplementation((x, z, out, hint) => {
    sample(x, z, out, hint);
    out.height = point.y + gradient.x * (x - point.x) + gradient.z * (z - point.z);
    out.normal.set(-gradient.x, 1, -gradient.z).normalize();
    return out;
  });
  return { track, point, heading, gradient, restore: () => spy.mockRestore() };
}

describe('player motocross slope coordinates', () => {
  it.each(cases)('$id $assist samples the angle of its horizontal contact span from placement', ({ definition, assist }) => {
    for (const grade of [-0.75, -0.6, -0.3, 0, 0.3, 0.6, 0.75]) {
      const terrain = plane(grade, 0.25);
      try {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
        bike.place(terrain.track, 35);
        expect(bike.groundPitch).toBeCloseTo(Math.atan(grade), 11);
        for (const turn of [-1.1, 0, 1.1, Math.PI]) {
          bike.placeFree(terrain.track, terrain.point.x, terrain.point.z,
            terrain.heading + turn, terrain.point.y);
          expect(bike.groundPitch).toBeCloseTo(Math.atan(grade * Math.cos(turn) + 0.25 * Math.sin(turn)), 11);
          for (const pitch of [-0.7, 0.7]) for (const yaw of [-0.4, 0, 0.4]) {
            bike.pitch = pitch;
            bike.airYaw = yaw;
            state(bike).sampleSuspensionContacts(terrain.track);
            const angle = Math.atan(grade * Math.cos(turn + yaw) + 0.25 * Math.sin(turn + yaw));
            expect(bike.groundPitch).toBeCloseTo(angle, 11);
            const [front, , rear] = bike.contactPoints;
            expect(Math.hypot(front.x - rear.x, front.z - rear.z)).toBeCloseTo(definition.spec.wheelbase, 12);
          }
          bike.airYaw = 0;
        }
      } finally { terrain.restore(); }
    }
  });

  it.each(cases)('$id $assist uses the same analytical slope for its first ground step and transport', ({ definition, assist }) => {
    for (const grade of [-0.6, 0, 0.6]) for (const speed of [0, 10]) {
      const terrain = plane(grade);
      try {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition), dt = 1e-6;
        bike.place(terrain.track, 35);
        bike.dynamics.speed = speed;
        const x = bike.dynamics.x, z = bike.dynamics.z, angle = Math.atan(grade);
        bike.step(dt, terrain.track);
        expect(state(bike).playerMotocross).toBe(true);
        expect(bike.airborne).toBe(false);
        expect(bike.dynamics.slope).toBeCloseTo(Math.sin(angle), 11);
        expect(bike.groundPitch).toBeCloseTo(angle, 11);
        const distance = (bike.dynamics.x - x) * Math.sin(terrain.heading) +
          (bike.dynamics.z - z) * Math.cos(terrain.heading);
        // The acceleration contributes O(dt²); this checks physical travel
        // independently of the contact solver's integration subdivisions.
        expect(Math.abs(distance - speed * Math.cos(angle) * dt)).toBeLessThan(2e-10);
        const forward = bike.body.velocity.x * Math.sin(bike.heading) +
          bike.body.velocity.z * Math.cos(bike.heading);
        expect(forward).toBeCloseTo(bike.dynamics.speed * Math.cos(angle), 10);
        expect([bike.dynamics.speed, bike.vy, bike.pitchRate].every(Number.isFinite)).toBe(true);
      } finally { terrain.restore(); }
    }
  });

  it.each(cases)('$id $assist selects the right slope on the final marked AI step and the next player step', ({ definition, assist }) => {
    const terrain = plane(0.45);
    try {
      for (const markBeforePlace of [false, true]) {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
        if (markBeforePlace) bike.aiControlled(1);
        bike.place(terrain.track, 35);
        expect(bike.groundPitch).toBeCloseTo(markBeforePlace ? Math.asin(0.45) : Math.atan(0.45), 11);
        if (!markBeforePlace) bike.aiControlled(1);
        bike.step(1e-6, terrain.track);
        expect(state(bike).playerMotocross).toBe(false);
        expect(bike.dynamics.slope).toBeCloseTo(0.45, 11);
        expect(bike.groundPitch).toBeCloseTo(Math.asin(0.45), 11);
        bike.step(1e-6, terrain.track);
        expect(state(bike).playerMotocross).toBe(true);
        expect(bike.dynamics.slope).toBeCloseTo(0.45 / Math.hypot(1, 0.45), 11);
        expect(bike.groundPitch).toBeCloseTo(Math.atan(0.45), 11);
      }
    } finally { terrain.restore(); }
  });

  it.each(cases)('$id $assist preserves represented world momentum on a live AI/player handoff', ({ definition, assist }) => {
    for (const grade of [-0.6, 0.6]) for (const speed of [0, 10])
      for (const dt of [1 / 120, 1 / 240, 1 / 480, 1e-8]) {
        const terrain = plane(grade);
        try {
          const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
          bike.place(terrain.track, 35);
          bike.dynamics.speed = speed;
          // A rolling plane state also has the matching vertical velocity;
          // otherwise a fast downhill setup genuinely leaves both springs.
          bike.vy = speed * Math.sin(bike.groundPitch);
          bike.step(dt, terrain.track);
          for (const ai of [true, false]) {
            const d = bike.dynamics, forward = d.speed * Math.cos(bike.groundPitch),
              before = planar(forward, bike.slide, d.heading), coreStep = d.step.bind(d),
              incomingKE = 0.5 * (forward ** 2 + bike.slide ** 2 + bike.vy ** 2);
            let observed = false;
            bike.aiControlled(ai ? 1 : 0);
            const spy = vi.spyOn(d, 'step').mockImplementation((...args) => {
              // Read the real core boundary after selecting the new contact
              // convention, before any physical force has advanced this step.
              const nextForward = d.speed * Math.cos(bike.groundPitch),
                outgoing = planar(nextForward, bike.slide, d.heading);
              expect(outgoing.x).toBeCloseTo(before.x, 11);
              expect(outgoing.z).toBeCloseTo(before.z, 11);
              expect(0.5 * (nextForward ** 2 + bike.slide ** 2 + bike.vy ** 2)).toBeCloseTo(incomingKE, 11);
              observed = true;
              return coreStep(...args);
            });
            try { bike.step(dt, terrain.track); } finally { spy.mockRestore(); }
            expect(observed).toBe(true);
            expect(state(bike).playerMotocross).toBe(!ai);
            expect(bike.airborne).toBe(false);
          }
        } finally { terrain.restore(); }
      }
  });

  it('keeps supermoto and non-MX courses on their surveyed slope convention, including a reused bike', () => {
    for (const [definition, venue] of [[SM_450, 'valley-ridge-mx'], [MX_250, 'aurel'], [MX_450, 'kestrel-rx']] as const) {
      const terrain = plane(0.45, 0, venue);
      try {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
        bike.place(rigTrack('arena-nord-sx'), 35);
        bike.step(1e-6, rigTrack('arena-nord-sx'));
        bike.place(terrain.track, 35);
        expect(bike.groundPitch).toBeCloseTo(Math.asin(0.45), 11);
        bike.step(1e-6, terrain.track);
        expect(state(bike).playerMotocross).toBe(false);
        expect(bike.dynamics.slope).toBeCloseTo(0.45, 11);
        expect(bike.groundPitch).toBeCloseTo(Math.asin(0.45), 11);
      } finally { terrain.restore(); }
    }
  });
});

describe('player motocross departure momentum', () => {
  it.each(cases)('$id $assist preserves world velocity through an unloaded departure, including at zero speed', ({ definition, assist }) => {
    for (const grade of [-0.6, 0, 0.6]) for (const sign of [-1, 1])
      for (const speed of [0, 14]) for (const dt of [1 / 120, 1 / 240, 1 / 480, 1e-8]) {
        const terrain = plane(grade, sign * 0.25);
        try {
          const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition),
            heading = terrain.heading + sign * 1.1;
          bike.placeFree(terrain.track, terrain.point.x, terrain.point.z, heading, terrain.point.y);
          const internal = state(bike);
          // An isolated loss-of-support boundary deliberately separates the
          // two-patch chord from the last loaded tyre's face. The public
          // surveyed approaches below establish this state naturally too.
          internal.playerMotocross = internal.motocrossCourse = true;
          internal.faceSlope = -sign * 0.8;
          internal.mxYawRate = sign * 0.6;
          bike.cgY += 4;
          bike.pitch = sign * 0.5;
          bike.pitchRate = sign * 0.7;
          bike.vy = 3;
          bike.slide = sign * 2;
          bike.dynamics.speed = speed;
          bike.frontSpin = 13;
          bike.rearSpin = 29;
          const forward = speed * Math.cos(bike.groundPitch),
            incoming = planar(forward, bike.slide, heading),
            m = bike.dynamics.mass, energy = 0.5 * m * (forward ** 2 + bike.slide ** 2 + bike.vy ** 2);
          for (let tick = 1; tick <= 3; tick++) {
            internal.vertical(dt);
            expect(bike.airborne).toBe(tick === 3);
            expect([bike.forceFront, bike.forceRear]).toEqual([0, 0]);
          }
          const outgoing = planar(internal.flightSpeed, bike.slide, bike.heading),
            expectedVy = 3 - G * 3 * dt,
            afterEnergy = 0.5 * m * (internal.flightSpeed ** 2 + bike.slide ** 2 + bike.vy ** 2);
          expect(outgoing.x).toBeCloseTo(incoming.x, 12);
          expect(outgoing.z).toBeCloseTo(incoming.z, 12);
          expect(bike.vy).toBeCloseTo(expectedVy, 12);
          expect(afterEnergy - energy).toBeCloseTo(0.5 * m * (expectedVy ** 2 - 9), 8);
          expect(bike.dynamics.speed).toBeCloseTo(forward, 12);
          expect(bike.lastTakeoff).toBeCloseTo(Math.hypot(forward, expectedVy), 12);
          expect(bike.airYaw).toBe(0);
          expect(bike.airYawRate).toBe(sign * 0.6);
          expect([bike.frontSpin, bike.rearSpin]).toEqual([13, 29]);
          internal.writeBody(terrain.track, 0);
          expect(bike.body.velocity.x).toBeCloseTo(incoming.x, 12);
          expect(bike.body.velocity.z).toBeCloseTo(incoming.z, 12);
        } finally { terrain.restore(); }
      }
  });

  it.each([MX_250, MX_450, SM_450])('$id retains the non-player last-face departure split', definition => {
    const terrain = plane(0.3);
    try {
      for (const face of [-0.7, 0, 0.7]) {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
        bike.aiControlled(10);
        bike.place(terrain.track, 35);
        const internal = state(bike);
        internal.faceSlope = face;
        bike.cgY += 4;
        bike.dynamics.speed = 14;
        for (let tick = 0; tick < 3; tick++) internal.vertical(1 / 240);
        expect(bike.airborne).toBe(true);
        expect(internal.flightSpeed).toBeCloseTo(14 / Math.hypot(1, face), 12);
        expect(bike.dynamics.speed).toBe(14);
        expect(bike.frontSpin).toBe(14 / definition.bike!.frontWheelRadius);
        expect(bike.rearSpin).toBe(14 / definition.bike!.rearWheelRadius);
      }
    } finally { terrain.restore(); }
  });

  it.each(cases.flatMap(config => (['valley-ridge-mx', 'arena-nord-sx'] as const)
    .flatMap(venue => [120, 240, 480].map(hz => ({ ...config, venue, hz })))))(
    '$id $assist $venue at $hz Hz carries takeoff momentum through the remaining public flight intervals', ({ definition, assist, venue, hz }) => {
    const track = rigTrack(venue), course = offroadCourse(track.circuit)!,
      jump = course.jumps.find(item => item.name === (venue === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP'))!,
      speed = venue === 'valley-ridge-mx' ? 13.5 : 13, dt = 1 / hz;
    const create = () => {
      const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
      bike.place(track, jump.start - 12);
      bike.dynamics.speed = speed;
      bike.gear = 3;
      return bike;
    };
    const bike = create(), plain = assist === 'sport' && hz === 120 ? create() : null,
      internal = state(bike), vertical = internal.vertical.bind(bike), physical = internal.stepInterval.bind(bike),
      intervals: FlightInterval[] = [];
    let departure: { before: Motion; after: Motion; duration: number; index: number;
      road: number; face: number; takeoff: number } | undefined;
    const physicalSpy = vi.spyOn(internal, 'stepInterval').mockImplementation((step, terrain, boundary) => {
      const before = motion(bike), interval: FlightInterval = {
        duration: step, before, after: before, drag: bike.dynamics.p.drag,
        previousBodyY: bike.body.position.y,
        force: [], brake: 0, rearBrake: 0, frontInertia: bike.tires[0].inertia,
        airTorque: 0, bodyTorque: 0,
      };
      intervals.push(interval);
      physical(step, terrain, boundary);
      interval.after = motion(bike);
      interval.force = [bike.forceFront, bike.forceRear];
      interval.brake = bike.brake;
      interval.rearBrake = bike.rearBrake;
      interval.airTorque = internal.airTorque;
      interval.bodyTorque = -internal.automaticBody * bike.air.bodyTorque;
    });
    const spy = vi.spyOn(internal, 'vertical').mockImplementation((step, boundary) => {
      const before = motion(bike), road = bike.groundPitch, face = Math.atan(internal.faceSlope);
      vertical(step, boundary);
      if (!departure && !before.airborne && bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3)
        departure = { before, after: motion(bike), duration: step, index: intervals.length - 1,
          road, face, takeoff: bike.lastTakeoff };
    });
    try {
      for (let tick = 0; !departure && tick < 6 * hz && bike.riding; tick++) {
        if (!bike.airborne) rideLine(bike, track,
          bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1 ? Math.max(speed, bike.dynamics.speed) : speed);
        intervals.length = 0;
        if (plain) Object.assign(plain.input, bike.input);
        bike.step(dt, track);
        if (plain) {
          plain.step(dt, track);
          expect(motion(bike)).toEqual(motion(plain));
        }
      }
      expect(departure).toBeDefined();
      const event = departure!, { before, after, duration } = event,
        incoming = planar(before.forward, before.lateral, before.heading),
        outgoing = planar(after.forward, after.lateral, after.heading),
        expectedVy = before.vy - G * duration;
      expect(internal.playerMotocross).toBe(true);
      expect(bike.riding && bike.airborne).toBe(true);
      expect([bike.forceFront, bike.forceRear]).toEqual([0, 0]);
      // Losing support converts the coordinate, not the horizontal
      // momentum. Only this physical interval contributes gravity here.
      expect(outgoing.x).toBeCloseTo(incoming.x, 10);
      expect(outgoing.z).toBeCloseTo(incoming.z, 10);
      expect(after.speed).toBeCloseTo(before.forward, 11);
      expect(after.vy).toBeCloseTo(expectedVy, 11);
      expect([after.frontSpin, after.rearSpin]).toEqual([before.frontSpin, before.rearSpin]);
      expect(event.takeoff).toBeCloseTo(Math.hypot(before.forward, expectedVy), 11);
      const outgoingKE = 0.5 * before.mass * (outgoing.x ** 2 + outgoing.z ** 2 + after.vy ** 2),
        incomingKE = 0.5 * before.mass * (incoming.x ** 2 + incoming.z ** 2 + before.vy ** 2);
      expect(outgoingKE - incomingKE).toBeCloseTo(0.5 * before.mass * (expectedVy ** 2 - before.vy ** 2), 7);
      expect(Math.abs(event.road - event.face)).toBeGreaterThan(0.005);
      expect(intervals.reduce((sum, interval) => sum + interval.duration, 0)).toBeCloseTo(dt, 12);
      const tail = intervals.slice(event.index + 1), tailTime = tail.reduce((sum, interval) => sum + interval.duration, 0),
        endpoint = freeIntervals(bike, after, tail, tailTime), world = planar(endpoint.forward, endpoint.lateral, endpoint.heading);
      expect(motion(bike)).toEqual(endpoint);
      expect(bike.airTime).toBeCloseTo(tailTime, 12);
      expect(bike.body.velocity.x).toBeCloseTo(world.x, 10);
      expect(bike.body.velocity.z).toBeCloseTo(world.z, 10);
      const last = intervals.at(-1)!;
      // The body channel is the published pose secant (including lean
      // height); the physical CG tangent above remains the gravity arc.
      expect(bike.body.velocity.y).toBeCloseTo((bike.body.position.y - last.previousBodyY) / last.duration, 10);
      expect([bike.body.position.x, bike.body.position.y, bike.body.position.z,
        bike.body.velocity.x, bike.body.velocity.y, bike.body.velocity.z,
        bike.pitch, bike.pitchRate, bike.fork, bike.shock].every(Number.isFinite)).toBe(true);
      if (hz === 120) expect(tail.length).toBeGreaterThan(0);
      if (plain) samePhysicalState(bike, plain);
      // The next public call has its own mass and may itself be refined.
      // Its actual free intervals still integrate exactly one full dt.
      intervals.length = 0;
      bike.input.steer = bike.input.brake = 0;
      if (plain) Object.assign(plain.input, bike.input);
      bike.step(dt, track);
      expect(motion(bike)).toEqual(freeIntervals(bike, endpoint, intervals, dt));
      if (plain) {
        plain.step(dt, track);
        for (let tick = 0; tick < 32; tick++) {
          samePhysicalState(bike, plain);
          Object.assign(plain.input, bike.input);
          bike.step(dt, track);
          plain.step(dt, track);
        }
        samePhysicalState(bike, plain);
      }
    } finally { spy.mockRestore(); physicalSpy.mockRestore(); }
  });
});
