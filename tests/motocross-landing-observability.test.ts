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
      contactDt = 1 / 30, spec = MX_450.bike!, sag = factoryBikeSag(MX_450);
    let incoming = physicalState(bike), event = physicalState(bike),
      eventTyre = tyres(bike, track, MX_450)[0];
    const forceModel = bike as unknown as {
      spring(compression: number, front: boolean): number;
      airTorque: number;
      longitudinal: number;
    };
    type Stage = { state: ReturnType<typeof physicalState>; forces: number[]; torque: number;
      damping: number; duration: number };
    const stages: Stage[] = [], spring = forceModel.spring.bind(bike), exp = Math.exp;
    let boundaryActive: { front: boolean; rear: boolean } | undefined, pending: Stage | undefined;
    const springSpy = vi.spyOn(forceModel, 'spring').mockImplementation((compression, front) => {
      if (boundaryActive && !pending) {
        const state = physicalState(bike), h = bike.heading, chassis = h + bike.airYaw,
          sin = Math.sin(state.pitch), cos = Math.cos(state.pitch);
        // Reconstruct each complete spring/damper/stop force from the real
        // incoming pose and sampled terrain. No force returned by the
        // implementation supplies this oracle's impulse or pitch moment.
        const forces = [true, false].map(isFront => {
          const arm = isFront ? spec.cgToFront : -spec.cgToRear,
            height = spec.cgHeight + (isFront ? sag.fork : sag.shock),
            patch = bike.contacts[isFront ? 0 : 2], n = patch.normal,
            c = patch.height - (state.y + arm * sin - height * cos),
            atBoundary = stages.length === 0 && (isFront ? boundaryActive!.front : boundaryActive!.rear);
          if (c <= 0 && !atBoundary) return 0;
          const grade = -(n.x * Math.sin(h) + n.z * Math.cos(h)) / Math.max(0.1, n.y),
            across = -(n.x * Math.cos(h) - n.z * Math.sin(h)) / Math.max(0.1, n.y),
            yawArm = -(n.x * Math.cos(chassis) - n.z * Math.sin(chassis)) * arm / Math.max(0.1, n.y),
            rate = grade * state.speed + across * state.slide + yawArm * bike.airYawRate -
              state.vy - (arm * cos + height * sin) * state.pitchRate,
            travel = isFront ? spec.forkTravel : spec.shockTravel,
            k = isFront ? spec.forkRate : spec.shockRate,
            C = (isFront ? bike.air.forkDamping : bike.air.shockDamping) * (1 + 0.5 * bike.standing),
            stroke = Math.max(0, Math.min(c, travel)),
            elastic = k * stroke * (1 + bike.air.progression * (stroke / travel) ** 2),
            damper = C * rate * (rate < 0 ? 2.2 : 1) / (1 + Math.abs(rate) / bike.air.damperKnee),
            stop = c > travel ? 40 * k * (c - travel) + 6 * C * Math.max(0, rate) : 0;
          return Math.max(0, elastic + damper + stop);
        });
        const contact = forces[0] > 0 || forces[1] > 0;
        pending = { state, forces, duration: 0,
          damping: contact ? 1.5 + 2.5 * bike.standing : 0.3 + 0.5 * bike.standing,
          torque: (forces[0] * spec.cgToFront - forces[1] * spec.cgToRear) * cos +
            (contact ? forceModel.longitudinal * spec.cgHeight -
              bike.riderBody * 0.25 * spec.riderMass * G * cos : 0) + forceModel.airTorque };
      }
      return spring(compression, front);
    });
    // Read the actual local duration at its physical pitch-damping port.
    // This avoids deriving a step count from the adapter's refinement rule.
    const dampingSpy = vi.spyOn(Math, 'exp').mockImplementation(exponent => {
      if (boundaryActive && pending) {
        pending.duration = -exponent / pending.damping;
        stages.push(pending);
        pending = undefined;
      }
      return exp(exponent);
    });
    const model = observations(bike), vertical = model.vertical.bind(bike),
      spy = vi.spyOn(model, 'vertical').mockImplementation((step, boundary) => {
        if (boundary) {
          event = physicalState(bike);
          eventTyre = tyres(bike, track, MX_450)[0];
          boundaryActive = boundary;
        }
        vertical(step, boundary);
        if (boundary) boundaryActive = undefined;
      });
    try {
      while (bike.airborne && bike.airTime < 4) {
        incoming = physicalState(bike);
        const front = tyres(bike, track, MX_450)[0],
          imminent = front.gap > 0 && front.closing > 0 && front.gap < front.closing * DT;
        bike.step(imminent ? contactDt : DT, track);
      }
    } finally {
      spy.mockRestore();
      springSpy.mockRestore();
      dampingSpy.mockRestore();
    }
    const landing = bike.lastLanding!,
      endpoint = tyres(bike, track, MX_450)[0],
      travel = MX_450.bike!.forkTravel,
      free = landing.airTime - incoming.airTime, supported = contactDt - free;
    expect(landing.airTime).toBeGreaterThan(2);
    expect(Math.abs(eventTyre.gap)).toBeLessThan(1e-8);
    expect(eventTyre.closing).toBeGreaterThan(0);
    expect(bike.forceFront).toBeGreaterThan(0);
    expect(bike.compressionFront).toBeLessThan(travel);
    expect(-endpoint.gap).toBeGreaterThan(travel);
    expect(bike.fork).toBe(travel);
    expect(landing.bottomSpeed).toBeGreaterThan(bike.air.bottomOutSpeed);
    expect(landing.bottomSpeed).toBeGreaterThan(Math.min(eventTyre.closing, endpoint.closing));
    expect(landing.bottomSpeed).toBeLessThan(Math.max(eventTyre.closing, endpoint.closing));
    expect(observations(bike).bottomPeak).toBe(landing.bottomSpeed);
    // The first span remains free. The refined supported forces act only
    // over the remainder; observing the later stop adds no second impulse.
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(DT);
    expect(event.vy).toBeCloseTo(incoming.vy - G * free, 11);
    expect(event.y).toBeCloseTo(incoming.y + incoming.vy * free - 0.5 * G * free ** 2, 11);
    expect(stages.length).toBeGreaterThan(1);
    expect(stages.reduce((sum, stage) => sum + stage.duration, 0)).toBeCloseTo(supported, 11);
    expect(bike.forceFront).toBeCloseTo(stages[0].forces[0], 9);
    expect(bike.forceRear).toBeCloseTo(stages[0].forces[1], 9);
    let velocity = event.vy, height = event.y, pitch = event.pitch, pitchRate = event.pitchRate;
    for (const stage of stages) {
      expect(stage.duration).toBeGreaterThan(0);
      expect(stage.state.vy).toBeCloseTo(velocity, 11);
      expect(stage.state.y).toBeCloseTo(height, 11);
      expect(stage.state.pitchRate).toBeCloseTo(pitchRate, 11);
      expect(stage.state.pitch).toBeCloseTo(pitch, 11);
      velocity += ((stage.forces[0] + stage.forces[1]) / bike.dynamics.mass - G) * stage.duration;
      pitchRate = (pitchRate + stage.torque / bike.air.pitchInertia * stage.duration) *
        exp(-stage.damping * stage.duration);
      height += velocity * stage.duration;
      pitch += pitchRate * stage.duration;
    }
    expect(bike.vy).toBeCloseTo(velocity, 11);
    expect(bike.cgY).toBeCloseTo(height, 11);
    expect(bike.pitchRate).toBeCloseTo(pitchRate, 11);
    expect(bike.pitch).toBeCloseTo(pitch, 11);
    expect(bike.frontSpin).toBeCloseTo(incoming.spin[0] * exp(-0.4 * contactDt), 11);
    expect(bike.rearSpin).toBeCloseTo(Math.max(0, incoming.spin[1] - 2 * contactDt), 11);
    expect(landing.pitchError + landing.slope).toBeCloseTo(event.pitch, 11);
    expect(landing.normalSpeed).toBeGreaterThan(10);
    expect(landing.outcome).toBe('clean');
    bike.step(DT, track);
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
