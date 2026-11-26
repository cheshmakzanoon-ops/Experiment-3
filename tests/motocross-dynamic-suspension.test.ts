import { describe, expect, it } from 'vitest';
import { clamp, G } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  B, BIKE_BASE, F, MX_MOTION, W, WHEEL_BASE, WHEEL_STRIDE, carBase,
} from '../src/simulation/protocol.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { rideMotocrossFlight } from './motocross-flight-controls.ts';
import { levelMotocrossTrack } from './motocross-test-track.ts';

const venues = [
  { circuit: 'valley-ridge-mx', jump: 'RIDGE TABLE', speed: 13.5 },
  { circuit: 'arena-nord-sx', jump: 'TABLETOP', speed: 13 },
] as const;
const cases = [MX_250, MX_450].flatMap(definition => venues.flatMap(venue =>
  [120, 240].map(hz => ({ ...venue, definition, bike: definition.id, hz })),
));

function gaps(bike: DirtBikeVehicle, definition: VehicleDefinition, cgY = bike.cgY, pitch = bike.pitch) {
  const spec = definition.bike!, reference = factoryBikeSag(definition);
  return [
    bike.contacts[0].height - (cgY + spec.cgToFront * Math.sin(pitch) -
      (spec.cgHeight + reference.fork) * Math.cos(pitch)),
    bike.contacts[2].height - (cgY - spec.cgToRear * Math.sin(pitch) -
      (spec.cgHeight + reference.shock) * Math.cos(pitch)),
  ];
}

function assertSnapshot(sim: Simulation, bike: DirtBikeVehicle) {
  const frame = sim.makeFrame(), base = carBase(0), spec = bike.definition.bike!;
  expect(frame[base + F.Y]).toBe(Math.fround(bike.body.position.y));
  for (const [field, travel, stroke, firstWheel] of [
    [B.FORK, spec.forkTravel, bike.fork, 0],
    [B.SHOCK, spec.shockTravel, bike.shock, 2],
  ]) {
    expect(frame[base + BIKE_BASE + field]).toBe(Math.fround(stroke));
    for (const wheel of [firstWheel, firstWheel + 1]) {
      const offset = base + WHEEL_BASE + wheel * WHEEL_STRIDE;
      expect(frame[offset + W.COMPRESSION]).toBe(frame[base + BIKE_BASE + field]);
      expect(frame[offset + W.LENGTH]).toBe(Math.fround(travel - stroke + 0.2));
    }
  }
  expect(frame[base + MX_MOTION.FORK_RATE]).toBe(Math.fround(bike.machineMotion!.forkRate));
  expect(frame[base + MX_MOTION.SHOCK_RATE]).toBe(Math.fround(bike.machineMotion!.shockRate));
}

describe('live motocross suspension timestamps', () => {
  it.each(cases)('$bike on $circuit at $hz Hz publishes the current pose through full travel and rebound', ({
    definition, circuit, jump: name, speed, hz,
  }) => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', circuit,
      ruleset: 'motocross-moto', opponents: 0, vehicles: [definition.id] });
    const bike = sim.cars[0] as DirtBikeVehicle, track = sim.track;
    const jump = offroadCourse(track.circuit)!.jumps.find(item => item.name === name)!;
    const spec = definition.bike!, dt = 1 / hz;
    bike.place(track, jump.start - 12);
    bike.dynamics.speed = speed;
    bike.gear = 3;
    let oneAxle = 0, airborne = 0, landed = false, incomingDifference = 0;
    const bottomed = [false, false], rebounded = [false, false], extended = [false, false];
    // Only ordinary placement/approach speed and rider controls are supplied.
    // The real surveyed face, flight and touchdown create every stroke.
    for (let tick = 0; tick < 6 * hz; tick++) {
      if (!bike.airborne) rideLine(bike, track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed) : speed);
      else rideMotocrossFlight(bike);
      const previousFork = bike.fork, previousShock = bike.shock;
      bike.step(dt, track);
      expect(bike.riding).toBe(true);
      expect([
        bike.cgY, bike.vy, bike.pitch, bike.pitchRate, bike.dynamics.speed,
        bike.body.position.x, bike.body.position.y, bike.body.position.z,
        bike.forceFront, bike.forceRear, bike.fork, bike.shock,
      ].every(Number.isFinite)).toBe(true);
      const current = gaps(bike, definition);
      for (const [i, travel, stroke] of [[0, spec.forkTravel, bike.fork], [1, spec.shockTravel, bike.shock]]) {
        expect(stroke).toBeCloseTo(clamp(current[i], 0, travel), 11);
        extended[i] ||= stroke === 0;
        bottomed[i] ||= stroke === travel;
        rebounded[i] ||= bottomed[i] && stroke < travel / 2;
      }
      expect(bike.machineMotion!.forkRate).toBeCloseTo((bike.fork - previousFork) / dt, 10);
      expect(bike.machineMotion!.shockRate).toBeCloseTo((bike.shock - previousShock) / dt, 10);
      incomingDifference = Math.max(incomingDifference,
        Math.abs(bike.fork - bike.compressionFront), Math.abs(bike.shock - bike.compressionRear));
      oneAxle += Number((bike.forceFront > 0) !== (bike.forceRear > 0));
      airborne += Number(bike.airborne);
      landed ||= (bike.lastLanding?.airTime ?? 0) > 1;
      if (tick % (hz / 60) === 0) assertSnapshot(sim, bike);
    }
    expect(bike.dynamics.crashes).toBe(0);
    expect(airborne).toBeGreaterThan(hz);
    expect(oneAxle).toBeGreaterThan(5);
    expect(landed).toBe(true);
    expect(extended).toEqual([true, true]);
    expect(bottomed).toEqual([true, true]);
    expect(rebounded).toEqual([true, true]);
    // This trajectory distinguishes incoming force travel from publication;
    // equating these channels would reintroduce a full solver-tick delay.
    expect(incomingDifference).toBeGreaterThan(0.01);

    bike.place(track, jump.start - 12);
    const settled = gaps(bike, definition);
    expect(bike.fork).toBeCloseTo(settled[0], 11);
    expect(bike.shock).toBeCloseTo(settled[1], 11);
    expect(bike.fork).toBe(bike.compressionFront);
    expect(bike.shock).toBe(bike.compressionRear);
    expect(bike.forceFront + bike.forceRear).toBeCloseTo(bike.dynamics.mass * G, 9);
    expect(bike.vy).toBe(0);
    expect(bike.pitchRate).toBe(0);
    expect(bike.machineMotion!.forkRate).toBe(0);
    expect(bike.machineMotion!.shockRate).toBe(0);
    // Check the very first reset frame, before another physical step can
    // conceal stale wheel compression/length behind the settled bike block.
    assertSnapshot(sim, bike);
  });

  it.each([MX_250, MX_450].flatMap(definition => [120, 240].map(hz => ({ definition, bike: definition.id, hz }))))(
    '$bike at $hz Hz evaluates the physical spring/damper on the incoming braking stroke', ({ definition, hz }) => {
      // The one-dimensional force oracle excludes cross-bank/yaw motion.
      const track = levelMotocrossTrack();
      const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
      const spec = definition.bike!, air = spec.offroad!, reference = factoryBikeSag(definition);
      bike.place(track, 35);
      bike.dynamics.speed = 12;
      bike.gear = 3;
      bike.input.brake = 0.7;
      let endpointForceError = 0;
      for (let tick = 0; tick < 0.3 * hz; tick++) {
        const incoming = { y: bike.cgY, pitch: bike.pitch, vy: bike.vy, rate: bike.pitchRate };
        bike.step(1 / hz, track);
        expect(bike.riding && !bike.airborne).toBe(true);
        const compression = gaps(bike, definition, incoming.y, incoming.pitch);
        for (const [i, front, actual, published] of [
          [0, true, bike.forceFront, bike.fork], [1, false, bike.forceRear, bike.shock],
        ] as const) {
          const contact = bike.contacts[front ? 0 : 2], n = contact.normal;
          const arm = front ? spec.cgToFront : -spec.cgToRear;
          const reach = spec.cgHeight + (front ? reference.fork : reference.shock);
          const travel = front ? spec.forkTravel : spec.shockTravel;
          const stiffness = front ? spec.forkRate : spec.shockRate;
          // The unsteered straight has no yaw/cross-slope motion. Use its
          // measured terrain gradient and incoming shaft velocity; all
          // samples remain below the mechanical stop in this brake test.
          expect(bike.dynamics.steer).toBe(0);
          expect(bike.slide).toBe(0);
          expect(compression[i]).toBeLessThan(travel);
          const heading = bike.dynamics.heading;
          const grade = -(n.x * Math.sin(heading) + n.z * Math.cos(heading)) / n.y;
          const shaftRate = grade * bike.dynamics.speed * Math.cos(bike.groundPitch) -
            incoming.vy - (arm * Math.cos(incoming.pitch) + reach * Math.sin(incoming.pitch)) * incoming.rate;
          const damping = (front ? air.forkDamping : air.shockDamping) * (1 + 0.5 * bike.standing);
          const damper = damping * shaftRate * (shaftRate < 0 ? 2.2 : 1) /
            (1 + Math.abs(shaftRate) / air.damperKnee);
          const forceAt = (gap: number) => gap <= 0 ? 0 : Math.max(0,
            stiffness * gap * (1 + air.progression * (gap / travel) ** 2) + damper);
          expect(actual).toBeCloseTo(forceAt(compression[i]), 8);
          expect(front ? bike.compressionFront : bike.compressionRear)
            .toBeCloseTo(clamp(compression[i], 0, travel), 11);
          endpointForceError = Math.max(endpointForceError, Math.abs(actual - forceAt(published)));
        }
      }
      // A force accidentally re-evaluated on the displayed endpoint would
      // fail by tens of newtons, far above the floating-point tolerance.
      expect(endpointForceError).toBeGreaterThan(20);
    },
  );

  it.each([120, 240])('supermoto preserves its legacy 20 ms stroke filter at %i Hz', hz => {
    const track = rigTrack('valley-ridge-mx');
    const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', SM_450);
    bike.place(track, 35);
    bike.dynamics.speed = 12;
    bike.gear = 3;
    bike.input.brake = 0.7;
    const dt = 1 / hz, blend = 1 - Math.exp(-dt / 0.02);
    let geometricDifference = 0;
    for (let tick = 0; tick < 0.3 * hz; tick++) {
      const front = bike.fork, rear = bike.shock;
      bike.step(dt, track);
      expect(bike.riding && !bike.airborne).toBe(true);
      expect(bike.fork).toBeCloseTo(front + (bike.compressionFront - front) * blend, 12);
      expect(bike.shock).toBeCloseTo(rear + (bike.compressionRear - rear) * blend, 12);
      const current = gaps(bike, SM_450);
      geometricDifference = Math.max(geometricDifference, Math.abs(current[0] - bike.fork));
    }
    expect(geometricDifference).toBeGreaterThan(0.001);
    expect(bike.dynamics.crashes).toBe(0);
  });
});
