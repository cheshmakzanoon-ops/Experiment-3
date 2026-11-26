import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { surfaceSample, type Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** Observe the real predictor and bottoming accumulator without supplying
 * a pose, contact, force or suspension state to the production simulation. */
function observations(bike: DirtBikeVehicle) {
  return bike as unknown as {
    predictTyreLanding(): void;
    bottomPeak: number;
    vertical(dt: number, boundary?: { front: boolean; rear: boolean; time: number }): void;
  };
}

function launch(definition = MX_450, dt = DT, name = 'RIDGE TABLE', extraSpeed = 0) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === name)!,
    speed = jumpHoldSpeed(jump) + extraSpeed,
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e6);
  for (let gear = 1; gear < definition.spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    const rpm = speed / definition.spec.wheelRadius * definition.spec.gearRatios[gear + 1] *
      definition.spec.finalDrive * 30 / Math.PI;
    if (rpm < definition.spec.shiftRPM * 0.85) break;
  }
  for (let t = 0; t < 6; t += dt) {
    if (!bike.airborne) {
      const face = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
      rideLine(bike, track, face ? Math.max(speed, bike.dynamics.speed) : speed);
    }
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      bike.aiControlled(0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error(`Production ${name} takeoff was not reached`);
}

/** Independent free-wheel geometry at the published chassis timestamp. */
function tyres(bike: DirtBikeVehicle, track: Track, definition: VehicleDefinition) {
  const spec = definition.bike!,
    sag = factoryBikeSag(definition),
    heading = bike.dynamics.heading,
    wheelHeading = heading + bike.airYaw,
    sh = Math.sin(heading), ch = Math.cos(heading);
  return [true, false].map((front) => {
    const reach = front ? spec.cgToFront : -spec.cgToRear,
      height = spec.cgHeight + (front ? sag.fork : sag.shock),
      freeY = bike.cgY + reach * Math.sin(bike.pitch) - height * Math.cos(bike.pitch),
      patch = surfaceSample();
    track.sample(
      bike.dynamics.x + Math.sin(wheelHeading) * reach,
      bike.dynamics.z + Math.cos(wheelHeading) * reach,
      patch, freeY,
    );
    const vx = sh * bike.dynamics.speed + ch * bike.slide +
        Math.cos(wheelHeading) * reach * bike.airYawRate,
      vz = ch * bike.dynamics.speed - sh * bike.slide -
        Math.sin(wheelHeading) * reach * bike.airYawRate,
      vy = bike.vy + (reach * Math.cos(bike.pitch) + height * Math.sin(bike.pitch)) * bike.pitchRate,
      n = patch.normal;
    return {
      gap: freeY - patch.height,
      closing: -vy - (n.x * vx + n.z * vz) / n.y,
      slope: Math.atan2(-(n.x * sh + n.z * ch), n.y),
    };
  });
}

function physicalState(bike: DirtBikeVehicle) {
  return {
    airborne: bike.airborne, airTime: bike.airTime,
    y: bike.cgY, vy: bike.vy, pitch: bike.pitch, pitchRate: bike.pitchRate,
    yaw: bike.airYaw, yawRate: bike.airYawRate,
    x: bike.dynamics.x, z: bike.dynamics.z, speed: bike.dynamics.speed, slide: bike.slide,
    loads: [bike.forceFront, bike.forceRear],
    travel: [bike.compressionFront, bike.compressionRear, bike.fork, bike.shock],
    spin: [bike.frontSpin, bike.rearSpin],
    landings: bike.landings, crashes: bike.dynamics.crashes,
  };
}

describe('motocross landing observation boundaries', () => {
  it.each([MX_250, MX_450])('$id ignores a separating initial overlap on the real takeoff', (definition) => {
    const { bike, track } = launch(definition),
      rear = tyres(bike, track, definition)[1],
      before = physicalState(bike);
    expect(rear.gap).toBeLessThan(0);
    expect(rear.closing).toBeLessThan(0);
    expect(before.loads).toEqual([0, 0]);
    observations(bike).predictTyreLanding();
    expect(bike.landingIn).toBeGreaterThan(0.8);
    expect(physicalState(bike)).toEqual(before);
    bike.step(DT, track);
    expect(bike.airborne).toBe(true);
    expect([bike.forceFront, bike.forceRear]).toEqual([0, 0]);
    expect(bike.cgY).toBeCloseTo(before.y + before.vy * DT - 0.5 * G * DT ** 2, 11);
  });

  it('reports an already-closing first tyre immediately without applying a contact impulse', () => {
    const dt = 1 / 120,
      { bike, track } = launch(MX_250, dt);
    bike.input.riderLean = 1;
    let observed = false;
    const model = observations(bike), vertical = model.vertical.bind(bike),
      spy = vi.spyOn(model, 'vertical').mockImplementation((step, boundary) => {
        // The corrected step resolves contact before publishing a closing
        // overlap. Observe that actual boundary before its force solve.
        if (boundary?.front) {
          const front = tyres(bike, track, MX_250)[0];
          expect(front.gap).toBeLessThanOrEqual(0);
          expect(Math.abs(front.gap)).toBeLessThan(1e-8);
          expect(front.closing).toBeGreaterThan(0);
          const before = physicalState(bike);
          expect(before.loads).toEqual([0, 0]);
          model.predictTyreLanding();
          expect(bike.landingIn).toBe(0);
          expect(bike.landingTarget).toBeCloseTo(front.slope, 12);
          expect(physicalState(bike)).toEqual(before);
          observed = true;
        }
        vertical(step, boundary);
      });
    try {
      while (bike.airborne && bike.airTime < 2) bike.step(dt, track);
    } finally {
      spy.mockRestore();
    }
    expect(observed).toBe(true);
    expect(bike.airborne).toBe(false);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('publishes a stop reached inside the landing step before the next tick judges pitch', () => {
    const { bike, track } = launch(MX_450, DT, 'SKY TRIPLE', 6),
      plain = launch(MX_450, DT, 'SKY TRIPLE', 6),
      contactDt = 1 / 30, spec = MX_450.bike!, sag = factoryBikeSag(MX_450);
    let incoming = physicalState(bike), event = physicalState(bike),
      incomingClock = bike.clock, eventClock = bike.clock,
      eventTyre = tyres(bike, track, MX_450)[0];
    const model = observations(bike), vertical = model.vertical.bind(bike),
      forceModel = bike as unknown as {
        spring(compression: number, front: boolean): number;
        flightSpeed: number;
        mxYawRate: number;
        forkFirmness: number;
        shockFirmness: number;
      }, spring = forceModel.spring.bind(bike);
    // Read actual visited physical states. A midpoint force preview does not
    // move the chassis, so repeated observations of that state are deduped.
    // No force returned by production supplies this geometric shaft oracle.
    const visit = () => {
      const state = physicalState(bike), h = bike.dynamics.heading, wheel = h + bike.airYaw,
        forward = bike.airborne ? forceModel.flightSpeed : bike.dynamics.speed * Math.cos(bike.groundPitch),
        yawRate = bike.airborne ? bike.airYawRate : forceModel.mxYawRate,
        sin = Math.sin(bike.pitch), cos = Math.cos(bike.pitch);
      const shafts = [true, false].map(front => {
        const arm = front ? spec.cgToFront : -spec.cgToRear,
          height = spec.cgHeight + (front ? sag.fork : sag.shock),
          patch = bike.contacts[front ? 0 : 2], n = patch.normal,
          compression = patch.height - (bike.cgY + arm * sin - height * cos),
          vx = Math.sin(h) * forward + Math.cos(h) * bike.slide + Math.cos(wheel) * arm * yawRate,
          vz = Math.cos(h) * forward - Math.sin(h) * bike.slide - Math.sin(wheel) * arm * yawRate,
          rate = -(n.x * vx + n.z * vz) / n.y - bike.vy -
            (arm * cos + height * sin) * bike.pitchRate,
          travel = front ? spec.forkTravel : spec.shockTravel,
          k = front ? spec.forkRate : spec.shockRate,
          C = (front ? bike.air.forkDamping : bike.air.shockDamping) * (1 + 0.5 * bike.standing) *
            (front ? forceModel.forkFirmness : forceModel.shockFirmness),
          stroke = Math.max(0, Math.min(compression, travel)),
          elastic = k * stroke * (1 + bike.air.progression * (stroke / travel) ** 2),
          damper = C * rate * (rate < 0 ? 2.2 : 1) / (1 + Math.abs(rate) / bike.air.damperKnee),
          stop = compression > travel ? 40 * k * (compression - travel) + 6 * C * Math.max(0, rate) : 0;
        return { compression, rate, travel, force: Math.max(0, elastic + damper + stop) };
      });
      return { state, shafts };
    };
    type Visit = ReturnType<typeof visit>;
    type Interval = { duration: number; boundary: boolean; visits: Visit[];
      incoming?: Visit; force: number[]; compression: number[]; bottom: number };
    const intervals: Interval[] = [];
    let active: Interval | undefined;
    const observe = () => {
      if (!active) return;
      const value = visit(), last = active.visits.at(-1);
      if (!last || value.state.y !== last.state.y || value.state.vy !== last.state.vy ||
          value.state.pitch !== last.state.pitch || value.state.pitchRate !== last.state.pitchRate)
        active.visits.push(value);
      return value;
    };
    const springSpy = vi.spyOn(forceModel, 'spring').mockImplementation((compression, front) => {
      const value = observe();
      if (active && !active.incoming) active.incoming = value;
      return spring(compression, front);
    });
    const spy = vi.spyOn(model, 'vertical').mockImplementation((step, boundary) => {
      const supported = boundary !== undefined || !bike.airborne;
      if (boundary) {
        event = physicalState(bike);
        eventClock = bike.clock;
        eventTyre = tyres(bike, track, MX_450)[0];
      }
      if (supported) {
        active = { duration: step, boundary: !!boundary, visits: [], force: [], compression: [], bottom: 0 };
        intervals.push(active);
        observe();
      }
      vertical(step, boundary);
      if (supported) {
        observe();
        active!.force = [bike.forceFront, bike.forceRear];
        active!.compression = [bike.compressionFront, bike.compressionRear];
        active!.bottom = model.bottomPeak;
        active = undefined;
      }
    });
    try {
      while (bike.airborne && bike.airTime < 4) {
        incoming = physicalState(bike);
        incomingClock = bike.clock;
        const front = tyres(bike, track, MX_450)[0],
          imminent = front.gap > 0 && front.closing > 0 && front.gap < front.closing * DT;
        const duration = imminent ? contactDt : DT;
        bike.step(duration, track);
        plain.bike.step(duration, plain.track);
        expect(physicalState(bike)).toEqual(physicalState(plain.bike));
      }
    } finally {
      spy.mockRestore();
      springSpy.mockRestore();
    }
    const landing = bike.lastLanding!, first = intervals[0], last = intervals.at(-1)!,
      endpoint = tyres(bike, track, MX_450)[0], travel = spec.forkTravel,
      free = landing.time - incomingClock, supported = contactDt - free;
    expect(landing.airTime).toBeGreaterThan(2);
    expect(Math.abs(eventTyre.gap)).toBeLessThan(1e-8);
    expect(eventTyre.closing).toBeGreaterThan(0);
    expect(first.boundary).toBe(true);
    expect(intervals.filter(interval => interval.boundary)).toHaveLength(1);
    expect(first.compression[0]).toBeLessThan(travel);
    expect(bike.forceFront).toBeGreaterThan(0);
    expect(-endpoint.gap).toBeGreaterThan(travel);
    expect(bike.fork).toBe(travel);
    expect(landing.bottomSpeed).toBeGreaterThan(bike.air.bottomOutSpeed);
    expect(model.bottomPeak).toBe(landing.bottomSpeed);
    // Free motion is ballistic up to the event; every later physical
    // interval contributes only its own supported duration, exactly once.
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(DT);
    expect(event.vy).toBeCloseTo(incoming.vy - G * free, 11);
    expect(event.y).toBeCloseTo(incoming.y + incoming.vy * free - 0.5 * G * free ** 2, 11);
    expect(intervals.length).toBeGreaterThan(1);
    expect(intervals.reduce((sum, interval) => sum + interval.duration, 0)).toBeCloseTo(supported, 11);
    let peak = 0, crossings = 0;
    for (const interval of intervals) {
      expect(interval.duration).toBeGreaterThan(0);
      expect(interval.visits.length).toBeGreaterThan(1);
      const entry = interval.incoming!;
      for (let axle = 0; axle < 2; axle++) {
        const shaft = entry.shafts[axle];
        const loaded = shaft.compression > 0 || (interval.boundary && axle === 0);
        expect(interval.force[axle]).toBeCloseTo(loaded ? shaft.force : 0, 9);
        expect(interval.compression[axle]).toBeCloseTo(Math.max(0, Math.min(shaft.compression, shaft.travel)), 11);
      }
      for (let i = 0; i < interval.visits.length; i++) for (let axle = 0; axle < 2; axle++) {
        const current = interval.visits[i].shafts[axle], prior = interval.visits[i - 1]?.shafts[axle];
        if (current.compression > current.travel) peak = Math.max(peak, current.rate);
        if (prior && prior.compression <= current.travel && current.compression > current.travel) {
          crossings++;
          const fraction = (current.travel - prior.compression) / (current.compression - prior.compression);
          peak = Math.max(peak, prior.rate + fraction * (current.rate - prior.rate));
        }
      }
    }
    expect(crossings).toBeGreaterThan(0);
    expect(landing.bottomSpeed).toBeCloseTo(peak, 8);
    expect([bike.forceFront, bike.forceRear]).toEqual(last.force);
    expect([bike.compressionFront, bike.compressionRear]).toEqual(last.compression);
    // The rotor flight update precedes first support in its physical
    // interval. Later ground intervals may then pick up the wheels normally.
    const rotorInterval = eventClock - incomingClock;
    expect(event.spin[0]).toBeCloseTo(incoming.spin[0] * Math.exp(-0.4 * rotorInterval), 11);
    expect(event.spin[1]).toBeCloseTo(Math.max(0, incoming.spin[1] - 2 * rotorInterval), 11);
    expect(landing.pitchError + landing.slope).toBeCloseTo(event.pitch, 11);
    expect(landing.normalSpeed).toBeGreaterThan(10);
    expect(landing.outcome).toBe('clean');
    expect([bike.cgY, bike.vy, bike.pitch, bike.pitchRate, bike.forceFront, bike.forceRear,
      bike.frontSpin, bike.rearSpin, bike.fork, bike.shock].every(Number.isFinite)).toBe(true);
    expect(bike.dynamics).toEqual(plain.bike.dynamics);
    expect(bike.tires).toEqual(plain.bike.tires);
    expect(bike.body).toEqual(plain.bike.body);
    expect(bike.machineMotion).toEqual(plain.bike.machineMotion);
    expect([bike.clock, bike.fuel, bike.gear, bike.rpm]).toEqual([
      plain.bike.clock, plain.bike.fuel, plain.bike.gear, plain.bike.rpm,
    ]);
    bike.step(DT, track);
    plain.bike.step(DT, plain.track);
    expect(physicalState(bike)).toEqual(physicalState(plain.bike));
    expect(bike.lastLanding).toBe(landing);
    expect(landing.outcome).toBe('crash-front');
    expect(bike.dynamics.crashes).toBe(1);
  });

  it('leaves a real first compression below full travel unmarked', () => {
    const { bike, track } = launch();
    while (bike.airborne && bike.airTime < 2) bike.step(DT, track);
    expect(bike.airborne).toBe(false);
    expect(bike.fork).toBeLessThan(MX_450.bike!.forkTravel);
    expect(bike.shock).toBeLessThan(MX_450.bike!.shockTravel);
    expect(bike.lastLanding!.bottomSpeed).toBe(0);
  });
});

describe('motocross forecast sampling phase', () => {
  it.each([
    { name: '120 Hz', steps: [1 / 120] },
    { name: '240 Hz', steps: [1 / 240] },
    { name: '480 Hz', steps: [1 / 480] },
    { name: 'unequal subdivisions', steps: [0.013, 0.009, 0.007, 0.011] },
  ])('uses the first available beginning-of-step pose at each deadline with $name', ({ steps }) => {
    const { bike, track } = launch(),
      observed: { at: number; period: number }[] = [],
      starts: number[] = [],
      state = observations(bike),
      forecast = state.predictTyreLanding.bind(bike),
      spy = vi.spyOn(state, 'predictTyreLanding').mockImplementation(() => {
        const at = bike.airTime;
        forecast();
        observed.push({ at, period: bike.landingIn < 0.3 ? 0.05 : 0.1 });
      });
    for (let i = 0; bike.airborne && bike.airTime < 2; i++) {
      starts.push(bike.airTime);
      bike.step(steps[i % steps.length], track);
    }
    spy.mockRestore();
    expect(observed.length).toBeGreaterThan(6);
    expect(observed.some((sample) => sample.period === 0.05)).toBe(true);
    let due = 0;
    for (let i = 0; i < observed.length; i++) {
      const firstAvailable = starts.find((t) => t >= due - 1e-12)!;
      expect(observed[i].at).toBeCloseTo(firstAvailable, 12);
      due += observed[i].period;
    }
    expect(bike.airborne).toBe(false);
    expect(bike.dynamics.crashes).toBe(0);
  });
});
