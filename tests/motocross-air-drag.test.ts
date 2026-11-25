import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { controls } from '../src/simulation/config.ts';
import { quadraticAirDrag } from '../src/simulation/offroad/air-drag.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import type { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

type FlightMode = 'player' | 'opponent' | 'riderless';
const MODES: FlightMode[] = ['player', 'opponent', 'riderless'];

/** Real production springs release the tyres from the surveyed takeoff.
 * Only the ordinary controls, initial run-up speed and public rider
 * separation transition are supplied; no airborne pose or load is set. */
function launch(definition: VehicleDefinition, mode: FlightMode = 'player') {
  const dt = 1 / 480,
    track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = rigBike(definition, track, jump.start - 12, speed);
  for (let tick = 0; tick < 6 / dt; tick++) {
    if (!bike.airborne) {
      const onFace = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
      rideLine(bike, track, onFace ? Math.max(speed, bike.dynamics.speed) : speed);
    }
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      bike.aiControlled(mode === 'opponent' ? 1e6 : 0);
      Object.assign(bike.input, controls());
      // The takeoff edge still publishes road speed along the face. Let
      // the first real flight step publish its horizontal component.
      bike.step(dt, track);
      if (mode === 'riderless') bike.dynamics.fall('highside');
      return { bike, track };
    }
  }
  throw new Error('The production RIDGE TABLE takeoff was not reached');
}

function expectUnsupported(bike: DirtBikeVehicle) {
  expect(bike.airborne).toBe(true);
  expect(bike.forceFront).toBe(0);
  expect(bike.forceRear).toBe(0);
}

describe('analytic quadratic airborne drag', () => {
  it('preserves endpoint, distance and drag work through unequal subdivisions', () => {
    const schedules = [
      [0.8],
      Array<number>(96).fill(1 / 120),
      Array<number>(192).fill(1 / 240),
      Array<number>(384).fill(1 / 480),
      Array.from({ length: 20 }, () => [0.013, 0.009, 0.007, 0.011]).flat(),
    ];
    for (const speed of [3, 18, 52])
      for (const drag of [0, 0.002, 0.05]) {
        const whole = quadraticAirDrag(speed, drag, 0.8);
        for (const schedule of schedules) {
          let current = speed, distance = 0, loss = 0;
          for (const dt of schedule) {
            const next = quadraticAirDrag(current, drag, dt);
            loss += 0.5 * (current ** 2 - next.speed ** 2);
            distance += next.distance;
            current = next.speed;
          }
          expect(current).toBeCloseTo(whole.speed, 11);
          expect(distance).toBeCloseTo(whole.distance, 11);
          expect(loss).toBeCloseTo(0.5 * (speed ** 2 - whole.speed ** 2), 9);
          // Integrating dv / v² gives reciprocal speed linear in time;
          // integrating dv / v gives the independent distance relation.
          expect(1 / current - 1 / speed).toBeCloseTo(drag * 0.8, 12);
          if (drag > 0) expect(drag * distance).toBeCloseTo(Math.log(speed / current), 12);
        }
      }
  });

  it('stays finite and passive even when one Euler drag step would reverse the bike', () => {
    for (const speed of [0, 1e-9, 3, 20, 150])
      for (const drag of [0, 0.0001, 0.002, 0.8, 2000])
        for (const dt of [0, 1 / 480, 1 / 120, 0.3, 4, 60]) {
          const next = quadraticAirDrag(speed, drag, dt);
          expect(Number.isFinite(next.speed) && Number.isFinite(next.distance)).toBe(true);
          expect(next.speed).toBeGreaterThanOrEqual(0);
          expect(next.speed).toBeLessThanOrEqual(speed);
          expect(next.distance).toBeGreaterThanOrEqual(next.speed * dt - 1e-12);
          expect(next.distance).toBeLessThanOrEqual(speed * dt + 1e-12);
          expect(0.5 * next.speed ** 2).toBeLessThanOrEqual(0.5 * speed ** 2);
        }
  });

  it('has a continuous zero-drag limit without logarithmic cancellation', () => {
    for (const drag of [0, Number.MIN_VALUE, 1e-250, 1e-20]) {
      const motion = quadraticAirDrag(32, drag, 0.3);
      expect(motion.speed).toBeCloseTo(32, 12);
      expect(motion.distance).toBeCloseTo(9.6, 12);
    }
    expect(quadraticAirDrag(32, 0.002, 0)).toEqual({ speed: 32, distance: 0 });
    expect(quadraticAirDrag(0, 0.002, 0.8)).toEqual({ speed: 0, distance: 0 });
  });

  it('rejects invalid inputs instead of turning passive drag into thrust', () => {
    for (const args of [
      [-1, 0.002, 0.1], [12, -0.002, 0.1], [12, 0.002, -0.1],
      [NaN, 0.002, 0.1], [12, Infinity, 0.1], [12, 0.002, Infinity],
    ]) expect(() => quadraticAirDrag(args[0], args[1], args[2])).toThrow(RangeError);
  });
});

describe('production motocross flight drag', () => {
  it.each([MX_250, MX_450].flatMap((definition) =>
    MODES.map((mode) => ({ definition, id: definition.id, mode })),
  ))('$id $mode integrates the existing force and travel without steering its free mass', ({ definition, mode }) => {
    const { bike, track } = launch(definition, mode),
      heading = bike.dynamics.heading,
      slide = bike.slide,
      sh = Math.sin(heading), ch = Math.cos(heading),
      y = bike.cgY, vy = bike.vy;
    let elapsed = 0;
    // Whip, rider and wheel inputs may rotate the chassis. They do not add
    // a horizontal centre-of-mass force or change its lateral air velocity.
    bike.input.steer = 0.55;
    bike.input.riderLean = 0.7;
    bike.input.throttle = 0.6;
    for (let tick = 0; tick < 20; tick++)
      for (const dt of [1 / 120, 1 / 240, 1 / 480, 0.011, 0.009]) {
        const speed = bike.dynamics.speed, x = bike.dynamics.x, z = bike.dynamics.z;
        bike.step(dt, track);
        const drag = bike.dynamics.p.drag / bike.dynamics.mass,
          factor = 1 + drag * speed * dt,
          distance = Math.log1p(drag * speed * dt) / drag;
        elapsed += dt;
        expectUnsupported(bike);
        expect(bike.dynamics.speed).toBeCloseTo(speed / factor, 11);
        expect(bike.dynamics.speed).toBeLessThanOrEqual(speed);
        expect(bike.dynamics.x).toBeCloseTo(x + sh * distance + ch * slide * dt, 10);
        expect(bike.dynamics.z).toBeCloseTo(z + ch * distance - sh * slide * dt, 10);
        expect(bike.dynamics.heading).toBeCloseTo(heading, 12);
        expect(bike.slide).toBeCloseTo(slide, 12);
        expect(bike.cgY).toBeCloseTo(y + vy * elapsed - 0.5 * G * elapsed ** 2, 10);
        expect(bike.vy).toBeCloseTo(vy - G * elapsed, 10);
      }
    expect(bike.riding).toBe(mode !== 'riderless');
    if (mode === 'player') expect(Math.abs(bike.airYaw)).toBeGreaterThan(0.1);
  });

  it.each([MX_250, MX_450].flatMap((definition) =>
    MODES.map((mode) => ({ definition, id: definition.id, mode })),
  ))('$id $mode retains its actual trajectory across 120/240/480 Hz and unequal steps', ({ definition, mode }) => {
    const schedules = [
      ...[120, 240, 480].map((hz) => Array<number>(0.75 * hz).fill(1 / hz)),
      Array.from({ length: 45 }, () => [1 / 120, 1 / 480, 1 / 480, 1 / 240]).flat(),
    ];
    const results = schedules.map((schedule) => {
      const { bike, track } = launch(definition, mode),
        start = [bike.dynamics.x, bike.dynamics.z, bike.dynamics.speed];
      for (const dt of schedule) {
        bike.step(dt, track);
        expectUnsupported(bike);
      }
      return { start, x: bike.dynamics.x, z: bike.dynamics.z, speed: bike.dynamics.speed };
    });
    for (const result of results.slice(1)) {
      expect(result.start).toEqual(results[0].start);
      // The real adapter consumes its 0.0002 kg/s idle fuel between steps.
      // That changes k slightly; it is not a constant-mass synthetic flight.
      expect(result.speed).toBeCloseTo(results[0].speed, 8);
      expect(result.x).toBeCloseTo(results[0].x, 8);
      expect(result.z).toBeCloseTo(results[0].z, 8);
    }
  });

  it.each([MX_250, MX_450])('$id follows the horizontal points used by its first-tyre forecast', (definition) => {
    const { bike, track } = launch(definition);
    bike.input.steer = 0.5;
    for (let tick = 0; tick < 60; tick++) bike.step(1 / 500, track);
    expectUnsupported(bike);
    expect(Math.abs(bike.airYaw)).toBeGreaterThan(0);
    const sample = vi.spyOn(track, 'sample'),
      start = [bike.dynamics.x, bike.dynamics.z, bike.dynamics.speed];
    (bike as unknown as { predictTyreLanding(): void }).predictTyreLanding();
    const calls = sample.mock.calls.slice();
    sample.mockRestore();
    expect([bike.dynamics.x, bike.dynamics.z, bike.dynamics.speed]).toEqual(start);
    expect(calls.length).toBeGreaterThan(32);
    const front = definition.bike!.cgToFront, rear = definition.bike!.cgToRear;
    for (let point = 1; point <= 15; point++) {
      // The two forecast tyre points have opposite wheelbase arms. Their
      // weighted centre removes all extrapolated pitch/whip geometry.
      const f = calls[point * 2], r = calls[point * 2 + 1],
        x = (rear * f[0] + front * r[0]) / (front + rear),
        z = (rear * f[1] + front * r[1]) / (front + rear);
      for (let tick = 0; tick < 20; tick++) bike.step(1 / 500, track);
      expectUnsupported(bike);
      // Forecast k is frozen at its sampled mass; actual fuel burn remains
      // active. Its sub-micrometre drift is smaller than this metre bound.
      expect(Math.abs(bike.dynamics.x - x)).toBeLessThan(1e-6);
      expect(Math.abs(bike.dynamics.z - z)).toBeLessThan(1e-6);
    }
  });

  it.each(['player', 'riderless'] as const)('retains legacy supermoto endpoint stepping for $0 flight', (mode) => {
    const { bike, track } = launch(SM_450, mode);
    for (let tick = 0; tick < 24; tick++) {
      const dt = 1 / 240, speed = bike.dynamics.speed,
        x = bike.dynamics.x, z = bike.dynamics.z,
        heading = bike.dynamics.heading, slide = bike.slide;
      bike.step(dt, track);
      const coast = Math.max(0, speed - bike.dynamics.p.drag * speed ** 2 / bike.dynamics.mass * dt);
      expectUnsupported(bike);
      expect(bike.dynamics.speed).toBeCloseTo(coast, 12);
      expect(bike.dynamics.x).toBeCloseTo(x + (Math.sin(heading) * coast + Math.cos(heading) * slide) * dt, 10);
      expect(bike.dynamics.z).toBeCloseTo(z + (Math.cos(heading) * coast - Math.sin(heading) * slide) * dt, 10);
    }
  });
});
