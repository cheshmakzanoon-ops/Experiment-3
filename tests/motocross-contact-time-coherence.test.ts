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
    x: bike.dynamics.x, z: bike.dynamics.z, speed: bike.dynamics.speed,
    heading: bike.heading, lateral: bike.slide,
    frontSpin: bike.frontSpin, rearSpin: bike.rearSpin,
  };
}

type ContactBoundary = { front: boolean; rear: boolean; time: number };
function observation(bike: DirtBikeVehicle) {
  return bike as unknown as {
    vertical(dt: number, boundary?: ContactBoundary): void;
    automaticBody: number;
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

  it.each(cases)('$bike at $hz Hz records the free incoming event and integrates support once afterward', ({ definition, hz }) => {
    const { bike, track } = launch(definition), dt = 1 / hz,
      observed = observation(bike), vertical = observed.vertical.bind(bike);
    const boundaries: { time: number; remainder: number; state: ReturnType<typeof pose>;
      tyres: ReturnType<typeof tyres>; body: number }[] = [];
    const spy = vi.spyOn(observed, 'vertical').mockImplementation((step, boundary) => {
      if (boundary) boundaries.push({ time: boundary.time, remainder: step,
        state: pose(bike), tyres: tyres(bike, track), body: observed.automaticBody });
      vertical(step, boundary);
    });
    let before = pose(bike);
    try {
      for (let tick = 0; bike.airborne && tick < 3 * hz; tick++) {
        before = pose(bike);
        bike.step(dt, track);
      }
    } finally {
      spy.mockRestore();
    }
    expect(boundaries).toHaveLength(1);
    const event = boundaries[0], incoming = event.state, landing = bike.lastLanding!,
      free = landing.time - before.clock, supported = dt - free,
      k = bike.dynamics.p.drag / bike.dynamics.mass,
      travel = Math.log1p(k * before.speed * free) / k;
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(dt);
    expect(event.remainder).toBeCloseTo(supported, 12);
    expect(event.time).toBe(landing.time);
    expect(incoming.x).toBeCloseTo(before.x + Math.sin(before.heading) * travel +
      Math.cos(before.heading) * before.lateral * free, 10);
    expect(incoming.z).toBeCloseTo(before.z + Math.cos(before.heading) * travel -
      Math.sin(before.heading) * before.lateral * free, 10);
    expect(incoming.y).toBeCloseTo(before.y + before.vy * free - 0.5 * G * free ** 2, 11);
    expect(incoming.vy).toBeCloseTo(before.vy - G * free, 11);
    expect(incoming.speed).toBeCloseTo(before.speed / (1 + k * before.speed * free), 11);
    expect(Math.min(...event.tyres.map(tyre => Math.abs(tyre.gap)))).toBeLessThan(1e-8);
    expect(Math.min(...event.tyres.map(tyre => tyre.gap))).toBeGreaterThan(-1e-8);
    const loaded = event.tyres.filter((_, index) => (index === 0 ? bike.forceFront : bike.forceRear) > 0),
      grade = loaded.reduce((sum, tyre) => sum + tyre.grade, 0) / loaded.length,
      cross = loaded.reduce((sum, tyre) => sum + tyre.cross, 0) / loaded.length;
    expect(landing.slope).toBeCloseTo(Math.atan(grade), 11);
    expect(landing.normalSpeed).toBeCloseTo(
      (grade * incoming.speed + cross * incoming.lateral - incoming.vy) / Math.hypot(1, grade, cross), 10);
    expect(landing.pitchError + landing.slope).toBeCloseTo(incoming.pitch + event.body * 0.06, 11);
    expect(bike.vy).toBeCloseTo(incoming.vy +
      ((bike.forceFront + bike.forceRear) / bike.dynamics.mass - G) * supported, 10);
    expect(bike.cgY).toBeCloseTo(incoming.y + bike.vy * supported, 10);
    // The transition does not run the rotor or tyre impulse a second time.
    expect(bike.frontSpin).toBeCloseTo(before.frontSpin * Math.exp(-0.4 * dt), 11);
    expect(bike.rearSpin).toBeCloseTo(Math.max(0, before.rearSpin - 2 * dt), 11);
    expect(bike.tires[0].fx).toBe(0);
    expect(bike.tires[2].fx).toBe(0);
    expect(bike.landings).toBe(1);
    expect(bike.dynamics.crashes).toBe(0);
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
