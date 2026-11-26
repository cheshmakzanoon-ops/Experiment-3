import { describe, expect, it, vi } from 'vitest';
import { clamp, G } from '../src/core/math.ts';
import { controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { surfaceSample, type Track } from '../src/simulation/track.ts';

const DT = 1 / 240;

/** Share a real surveyed departure; only the subsequent integration step
 * varies. No airborne position, wheel load, force or contact is supplied. */
function launch(definition = MX_450) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find(j => j.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e6);
  for (let gear = 1; gear < definition.spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    if (speed / definition.spec.wheelRadius * definition.spec.gearRatios[gear + 1] *
      definition.spec.finalDrive * 30 / Math.PI < definition.spec.shiftRPM * 0.85) break;
  }
  for (let tick = 0; tick < 6 / DT; tick++) {
    if (!bike.airborne) rideLine(bike, track,
      bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
        ? Math.max(speed, bike.dynamics.speed) : speed);
    bike.step(DT, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      bike.aiControlled(0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error('Production RIDGE TABLE departure was not reached');
}

/** Independently sample each free tyre at the complete current pose. */
function tyres(bike: DirtBikeVehicle, track: Track) {
  const spec = bike.definition.bike!, sag = factoryBikeSag(bike.definition),
    heading = bike.heading, wheelHeading = heading + bike.airYaw,
    sh = Math.sin(heading), ch = Math.cos(heading);
  return [true, false].map(front => {
    const arm = front ? spec.cgToFront : -spec.cgToRear,
      height = spec.cgHeight + (front ? sag.fork : sag.shock),
      y = bike.cgY + arm * Math.sin(bike.pitch) - height * Math.cos(bike.pitch),
      patch = surfaceSample();
    track.sample(bike.dynamics.x + Math.sin(wheelHeading) * arm,
      bike.dynamics.z + Math.cos(wheelHeading) * arm, patch, y);
    const vx = sh * bike.dynamics.speed + ch * bike.slide + Math.cos(wheelHeading) * arm * bike.airYawRate,
      vz = ch * bike.dynamics.speed - sh * bike.slide - Math.sin(wheelHeading) * arm * bike.airYawRate,
      n = patch.normal;
    return {
      gap: y - patch.height,
      closing: -(n.x * vx + n.z * vz) / n.y - bike.vy -
        (arm * Math.cos(bike.pitch) + height * Math.sin(bike.pitch)) * bike.pitchRate,
      grade: -(n.x * sh + n.z * ch) / n.y,
      cross: -(n.x * ch - n.z * sh) / n.y,
    };
  });
}

function pose(bike: DirtBikeVehicle) {
  return {
    clock: bike.clock, y: bike.cgY, vy: bike.vy, pitch: bike.pitch,
    pitchRate: bike.pitchRate, airborne: bike.airborne,
    x: bike.dynamics.x, z: bike.dynamics.z, speed: bike.dynamics.speed,
    heading: bike.heading, lateral: bike.slide,
    frontSpin: bike.frontSpin, rearSpin: bike.rearSpin,
  };
}

type ContactBoundary = { front: boolean; rear: boolean; time: number };
function observation(bike: DirtBikeVehicle) {
  return bike as unknown as {
    vertical(dt: number, boundary?: ContactBoundary): void;
    stepInterval(dt: number, track: Track, boundary: boolean): void;
    automaticBody: number;
  };
}

/** Observe the real phase boundaries without prescribing the numerical
 * integration between them. An outer vertical call delegates a swept event
 * to a nested supported remainder; only that remainder spends support time. */
function contactLedger(bike: DirtBikeVehicle, track: Track) {
  const model = observation(bike), vertical = model.vertical.bind(bike),
    physical = model.stepInterval.bind(bike);
  type Pose = ReturnType<typeof pose>;
  const complete: { duration: number; before: Pose; after: Pose; mass: number;
    frontInertia: number; force: number[]; frontBrake: number }[] = [];
  const support: { duration: number; before: Pose; after: Pose; force: number[] }[] = [];
  const events: { boundary: ContactBoundary; physicalIndex: number; remainder: number;
    state: Pose; tyres: ReturnType<typeof tyres>; body: number }[] = [];
  const physicalSpy = vi.spyOn(model, 'stepInterval').mockImplementation((step, terrain, boundary) => {
    const before = pose(bike), interval = { duration: step, before, after: before,
      mass: bike.dynamics.mass, frontInertia: bike.tires[0].inertia, force: [0, 0], frontBrake: 0 };
    complete.push(interval);
    physical(step, terrain, boundary);
    interval.after = pose(bike);
    interval.mass = bike.dynamics.mass;
    interval.force = [bike.tires[0].fx, bike.tires[2].fx];
    interval.frontBrake = bike.brake;
  });
  const verticalSpy = vi.spyOn(model, 'vertical').mockImplementation((step, boundary) => {
    const active = boundary !== undefined || !bike.airborne, before = pose(bike);
    if (boundary) events.push({ boundary: { ...boundary }, physicalIndex: complete.length - 1,
      remainder: step, state: before, tyres: tyres(bike, track), body: model.automaticBody });
    vertical(step, boundary);
    if (active) support.push({ duration: step, before, after: pose(bike),
      force: [bike.forceFront, bike.forceRear] });
  });
  return { complete, support, events,
    reset() { complete.length = support.length = events.length = 0; },
    restore() { verticalSpy.mockRestore(); physicalSpy.mockRestore(); },
  };
}

const cases = [MX_250, MX_450].flatMap(definition => [120, 240, 480].map(hz => ({
  definition, bike: definition.id, hz,
})));

describe('motocross first-contact time coherence', () => {
  it.each(cases)('$bike at $hz Hz never publishes an unsupported closing penetration', ({ definition, hz }) => {
    const { bike, track } = launch(definition);
    let separating = 0;
    for (let tick = 0; bike.airborne && tick < 3 * hz; tick++) {
      for (const tyre of tyres(bike, track)) {
        if (tyre.gap < -1e-8) {
          expect(tyre.closing).toBeLessThan(0);
          separating++;
        }
      }
      expect([bike.forceFront, bike.forceRear]).toEqual([0, 0]);
      bike.step(1 / hz, track);
    }
    expect(separating).toBeGreaterThan(0);
    expect(bike.airborne).toBe(false);
    expect(bike.forceFront + bike.forceRear).toBeGreaterThan(0);
    expect(bike.lastLanding!.airTime).toBeGreaterThan(0.8);
  });

  const contactCases = [
    ...cases.map(row => ({ ...row, longContact: false })),
    ...[MX_250, MX_450].map(definition => ({ definition, bike: definition.id, hz: 240, longContact: true })),
  ];
  it.each(contactCases)('$bike at $hz Hz records the free incoming event and integrates support once afterward (long contact: $longContact)', ({ definition, hz, longContact }) => {
    const { bike, track } = launch(definition), dt = 1 / hz,
      plain = longContact ? launch(definition) : null, ledger = contactLedger(bike, track);
    let before = pose(bike), publicDuration = dt;
    try {
      for (let tick = 0; bike.airborne && tick < 3 * hz; tick++) {
        before = pose(bike);
        const imminent = tyres(bike, track).some(tyre =>
          tyre.gap > 0 && tyre.closing > 0 && tyre.gap < tyre.closing * dt);
        publicDuration = longContact && imminent ? 1 / 30 : dt;
        ledger.reset();
        bike.step(publicDuration, track);
        if (plain) {
          plain.bike.step(publicDuration, plain.track);
          expect(pose(bike)).toEqual(pose(plain.bike));
        }
      }
    } finally {
      ledger.restore();
    }
    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0], incoming = event.state, landing = bike.lastLanding!,
      free = landing.time - before.clock, supported = publicDuration - free,
      first = ledger.support[0], last = ledger.support.at(-1)!;
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(publicDuration);
    expect(ledger.complete.reduce((sum, interval) => sum + interval.duration, 0)).toBeCloseTo(publicDuration, 12);
    expect(ledger.support.reduce((sum, interval) => sum + interval.duration, 0)).toBeCloseTo(supported, 12);
    expect(first.duration).toBe(event.remainder);
    expect(first.before).toEqual(incoming);
    expect(event.boundary.time).toBe(landing.time);
    // The free horizontal arc is evaluated with each actual interval's
    // mass. Fuel may change mass between complete intervals, but there is
    // no contact force or artificial free-time extension before the event.
    let x = before.x, z = before.z, speed = before.speed, freeSum = 0;
    for (const [index, interval] of ledger.complete.entries()) {
      if (index > event.physicalIndex) break;
      const duration = index === event.physicalIndex
        ? event.boundary.time - interval.before.clock : interval.duration,
        k = bike.dynamics.p.drag / interval.mass,
        travel = Math.log1p(k * speed * duration) / k;
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(interval.duration);
      expect(interval.before.airborne).toBe(true);
      expect(interval.before.heading).toBe(before.heading);
      x += Math.sin(before.heading) * travel + Math.cos(before.heading) * before.lateral * duration;
      z += Math.cos(before.heading) * travel - Math.sin(before.heading) * before.lateral * duration;
      speed /= 1 + k * speed * duration;
      freeSum += duration;
    }
    expect(freeSum).toBeCloseTo(free, 12);
    expect(incoming.x).toBeCloseTo(x, 10);
    expect(incoming.z).toBeCloseTo(z, 10);
    expect(incoming.y).toBeCloseTo(before.y + before.vy * free - 0.5 * G * free ** 2, 11);
    expect(incoming.vy).toBeCloseTo(before.vy - G * free, 11);
    expect(incoming.speed).toBeCloseTo(speed, 11);
    expect(Math.min(...event.tyres.map(tyre => Math.abs(tyre.gap)))).toBeLessThan(1e-8);
    expect(Math.min(...event.tyres.map(tyre => tyre.gap))).toBeGreaterThan(-1e-8);
    const loaded = event.tyres.filter((_, index) => index === 0 ? event.boundary.front : event.boundary.rear),
      grade = loaded.reduce((sum, tyre) => sum + tyre.grade, 0) / loaded.length,
      cross = loaded.reduce((sum, tyre) => sum + tyre.cross, 0) / loaded.length;
    expect(landing.slope).toBeCloseTo(Math.atan(grade), 11);
    expect(landing.normalSpeed).toBeCloseTo(
      (grade * incoming.speed + cross * incoming.lateral - incoming.vy) / Math.hypot(1, grade, cross), 10);
    expect(landing.pitchError + landing.slope).toBeCloseTo(incoming.pitch + event.body * 0.06, 11);
    // Support is a positive physical impulse relative to the independently
    // known free arc. Do not equate its incoming force with the integral of
    // a changing spring, or require the replaced Euler endpoint equations.
    expect(first.force[0] + first.force[1]).toBeGreaterThan(0);
    expect(bike.vy).toBeGreaterThan(incoming.vy - G * supported);
    expect(bike.cgY).toBeGreaterThan(incoming.y + incoming.vy * supported - 0.5 * G * supported ** 2);
    for (let index = 1; index < ledger.support.length; index++) {
      const prior = ledger.support[index - 1], current = ledger.support[index];
      expect(current.before.y).toBe(prior.after.y);
      expect(current.before.vy).toBe(prior.after.vy);
    }
    expect(bike.vy).toBe(last.after.vy);
    expect(bike.cgY).toBe(last.after.y);
    expect([bike.forceFront, bike.forceRear]).toEqual(last.force);
    // Each flight interval advances the rotors once, including the one
    // containing touchdown. Subsequent ground intervals may pick them up;
    // their actual front-rotor impulse and public mean forces must agree.
    let frontImpulse = 0, rearImpulse = 0;
    for (const interval of ledger.complete) {
      const { before: start, after, duration } = interval;
      expect(after.clock - start.clock).toBeCloseTo(duration, 12);
      if (start.airborne) {
        expect(after.frontSpin).toBeCloseTo(start.frontSpin * Math.exp(-0.4 * duration), 11);
        expect(after.rearSpin).toBeCloseTo(Math.max(0, start.rearSpin - 2 * duration), 11);
        expect(interval.force).toEqual([0, 0]);
      } else {
        expect(interval.frontBrake).toBe(0);
        expect(interval.frontInertia * (after.frontSpin - start.frontSpin)).toBeCloseTo(
          -interval.force[0] * definition.bike!.frontWheelRadius * duration, 11);
      }
      frontImpulse += interval.force[0] * duration;
      rearImpulse += interval.force[1] * duration;
    }
    expect(bike.tires[0].fx * publicDuration).toBeCloseTo(frontImpulse, 11);
    expect(bike.tires[2].fx * publicDuration).toBeCloseTo(rearImpulse, 11);
    expect(bike.landings).toBe(1);
    expect(bike.dynamics.crashes).toBe(0);
    expect([bike.cgY, bike.vy, bike.pitch, bike.pitchRate, bike.forceFront, bike.forceRear,
      bike.frontSpin, bike.rearSpin, bike.fork, bike.shock].every(Number.isFinite)).toBe(true);
    if (plain) {
      expect(publicDuration).toBe(1 / 30);
      expect(ledger.complete.length).toBeGreaterThan(1);
      expect(ledger.support.length).toBeGreaterThan(1);
      expect(event.remainder).toBeLessThan(supported);
      // A read-only observer must preserve both the present state and
      // latent state that can affect later contact or recovery updates.
      for (let tick = 0; tick < 32; tick++) {
        expect(pose(bike)).toEqual(pose(plain.bike));
        expect(bike.dynamics).toEqual(plain.bike.dynamics);
        expect(bike.tires).toEqual(plain.bike.tires);
        expect(bike.body).toEqual(plain.bike.body);
        expect(bike.machineMotion).toEqual(plain.bike.machineMotion);
        expect([bike.fuel, bike.gear, bike.rpm, bike.riderBody, bike.riderBodyRate]).toEqual([
          plain.bike.fuel, plain.bike.gear, plain.bike.rpm, plain.bike.riderBody, plain.bike.riderBodyRate,
        ]);
        bike.step(dt, track);
        plain.bike.step(dt, plain.track);
      }
    }
  });

  it('converges both at common elapsed time and after the same observed pickup duration', () => {
    const run = (dt: number) => {
      const { bike, track } = launch(), start = bike.clock;
      let observedTouchdown = 0, relative = 0, common = 0;
      for (let tick = 1; tick <= Math.round(1.4 / dt); tick++) {
        if (bike.airborne) {
          const wanted = (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
            Math.max(0.12, bike.landingIn) - bike.pitchRate;
          Object.assign(bike.input, controls(), { throttle: clamp(wanted * 1.2, 0, 1),
            clutch: clamp(-wanted * 1.2, 0, 1),
            brake: Number(bike.airTime > 0.2 && bike.airTime < 0.6) });
        } else Object.assign(bike.input, controls());
        bike.step(dt, track);
        if (!bike.airborne && !observedTouchdown) observedTouchdown = tick;
        if (observedTouchdown && tick === observedTouchdown + Math.round(0.3 / dt)) relative = bike.dynamics.speed;
        if (tick === Math.round(1.375 / dt)) {
          expect(bike.clock - start).toBeCloseTo(1.375, 10);
          common = bike.dynamics.speed;
        }
      }
      expect(bike.riding).toBe(true);
      expect(bike.dynamics.crashes).toBe(0);
      return { relative, common };
    };
    const coarse = run(DT), fine = run(DT / 2);
    expect(Math.abs(coarse.relative - fine.relative)).toBeLessThan(0.03);
    expect(Math.abs(coarse.common - fine.common)).toBeLessThan(0.03);
  });
});
