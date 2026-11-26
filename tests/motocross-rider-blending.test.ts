import { describe, expect, it, vi } from 'vitest';
import { controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { RiderWeight } from '../src/simulation/offroad/rider-weight.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { levelMotocrossTrack } from './motocross-test-track.ts';

const BLEND_EDGE = 0.15;
const legacyPose = (automatic: number, manual: number) =>
  automatic + manual * (1 - Math.sign(manual) * automatic);

/** A parked, braking rider retains a real automatic rearward brace while
 * reversing the manual stroke. Only controls are written; the suspension,
 * automatic posture and manual stroke all advance through production code. */
function brakeReversal(definition: VehicleDefinition, hz: number, direction: number) {
  const dt = 1 / hz,
    track = levelMotocrossTrack(),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    stroke = new RiderWeight();
  bike.place(track, 35);
  bike.input.brake = 1;
  bike.input.riderLean = direction;
  for (let n = 0; n < 5 * hz; n++) {
    bike.step(dt, track);
    stroke.step(direction, dt);
  }
  bike.input.riderLean = -direction;
  const trace: { manual: number; pose: number; legacy: number }[] = [];
  for (let n = 0; n < Math.round(0.6 * hz); n++) {
    bike.step(dt, track);
    stroke.step(-direction, dt);
    const automatic = bike.postureMotion!.automaticBody;
    expect(automatic).toBeCloseTo(-0.55, 12);
    expect(bike.riderBody).toBe(stroke.pose(automatic));
    expect(bike.riding && !bike.airborne).toBe(true);
    expect(bike.speed).toBe(0);
    trace.push({
      manual: stroke.position,
      pose: bike.riderBody,
      legacy: legacyPose(automatic, stroke.position),
    });
  }
  expect(bike.dynamics.crashes).toBe(0);
  const crossing = trace.findIndex((row, i) => i > 0 && row.manual * trace[i - 1].manual <= 0);
  expect(crossing).toBeGreaterThan(1);
  expect(crossing).toBeLessThan(trace.length - 1);
  // Compare secants wholly on either side, excluding the mixed crossing
  // interval. A derivative corner survives timestep refinement; a C1 join
  // brings these rates together as the sampling interval becomes smaller.
  const rateGap = (field: 'pose' | 'legacy') => Math.abs(
    (trace[crossing + 1][field] - trace[crossing][field] -
      trace[crossing - 1][field] + trace[crossing - 2][field]) / dt,
  );
  return {
    gap: rateGap('pose'),
    legacyGap: rateGap('legacy'),
    maximumChange: Math.max(...trace.map((row) => Math.abs(row.pose - row.legacy))),
  };
}

/** Launch from the surveyed table using the ordinary approach controller,
 * then reverse manual input during an uninterrupted, physically free flight. */
function airborneReversal(definition: VehicleDefinition) {
  const dt = 1 / 240,
    track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((candidate) => candidate.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
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
  let launched = false;
  for (let n = 0; n < 6 / dt; n++) {
    if (!bike.airborne) rideLine(bike, track,
      bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
        ? Math.max(speed, bike.dynamics.speed) : speed);
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      launched = true;
      break;
    }
  }
  expect(launched).toBe(true);
  bike.aiControlled(0);
  Object.assign(bike.input, controls(), { throttle: 0.1, brake: 0.35, clutch: 0.05 });
  const physics = [], poses = [];
  for (let n = 0; n < 0.8 / dt; n++) {
    bike.input.riderLean = n < 60 ? 1 : n < 144 ? -1 : 0;
    bike.step(dt, track);
    expect(bike.airborne && bike.riding).toBe(true);
    expect(bike.forceFront + bike.forceRear).toBe(0);
    physics.push([
      bike.s, bike.dynamics.x, bike.dynamics.z, bike.cgY, bike.vy,
      bike.pitch, bike.pitchRate, bike.frontSpin, bike.rearSpin,
    ]);
    poses.push(bike.riderBody);
  }
  return { physics, poses };
}

describe('continuous motocross automatic/manual rider blending', () => {
  it('retains neutral, full authority, zero-auto mapping and the established outer response', () => {
    const stroke = new RiderWeight();
    for (const automatic of [-1, -0.99, -0.55, -0, 0, 0.45, 0.99, 1]) {
      stroke.position = 0;
      expect(stroke.pose(automatic)).toBe(automatic);
      for (const manual of [-1, -0.8, -0.5, -BLEND_EDGE, BLEND_EDGE, 0.5, 0.8, 1]) {
        stroke.position = manual;
        expect(stroke.pose(automatic)).toBe(legacyPose(automatic, manual));
        if (Math.abs(manual) === 1) expect(stroke.pose(automatic)).toBe(manual);
      }
    }
    for (let sample = -200; sample <= 200; sample++) {
      stroke.position = sample / 200;
      expect(stroke.pose(0)).toBe(stroke.position);
    }
  });

  it('is bounded and monotone across both axes without increasing the manual slope beyond 8/3', () => {
    const stroke = new RiderWeight();
    let maximumChange = 0;
    for (let a = -100; a <= 100; a++) {
      const automatic = a / 100;
      let previous = -1;
      for (let x = -200; x <= 200; x++) {
        stroke.position = x / 200;
        const pose = stroke.pose(automatic);
        expect(pose).toBeGreaterThanOrEqual(-1);
        expect(pose).toBeLessThanOrEqual(1);
        expect(pose).toBeGreaterThanOrEqual(previous - 1e-14);
        stroke.velocity = 1;
        expect(stroke.poseRate(automatic)).toBeGreaterThanOrEqual(0);
        expect(stroke.poseRate(automatic)).toBeLessThanOrEqual(8 / 3 + 1e-14);
        stroke.velocity = 0;
        expect(stroke.poseRate(automatic, 1)).toBeGreaterThanOrEqual(0);
        maximumChange = Math.max(maximumChange, Math.abs(pose - legacyPose(automatic, stroke.position)));
        previous = pose;
      }
    }
    expect(maximumChange).toBeCloseTo(8 * BLEND_EDGE / 27, 12);
  });

  it('joins both one-sided manual rates at neutral and at both untouched outer segments', () => {
    const stroke = new RiderWeight(), h = 1e-7;
    stroke.velocity = 1;
    for (const automatic of [-1, -0.99, -0.55, 0, 0.45, 0.99, 1]) {
      for (const manual of [-BLEND_EDGE, 0, BLEND_EDGE]) {
        stroke.position = manual - h;
        const before = stroke.pose(automatic);
        stroke.position = manual + h;
        const after = stroke.pose(automatic);
        stroke.position = manual;
        const middle = stroke.pose(automatic), rate = stroke.poseRate(automatic);
        expect((middle - before) / h).toBeCloseTo(rate, 5);
        expect((after - middle) / h).toBeCloseTo(rate, 5);
        if (manual === 0) expect(rate).toBeCloseTo(1 - automatic * automatic, 14);
      }
    }
  });

  it('reports the joint automatic/manual derivative without changing the physical stroke', () => {
    const stroke = new RiderWeight(), dt = 1e-7;
    for (const automatic of [-0.95, -0.55, 0, 0.45, 0.95]) {
      for (const manual of [-0.8, -BLEND_EDGE, -0.12, -1e-4, 0, 1e-4, 0.12, BLEND_EDGE, 0.8]) {
        for (const velocity of [-4, 0, 3]) {
          for (const automaticRate of [-1.4, 0, 1.4]) {
            stroke.position = manual - velocity * dt;
            const before = stroke.pose(automatic - automaticRate * dt);
            stroke.position = manual + velocity * dt;
            const after = stroke.pose(automatic + automaticRate * dt);
            stroke.position = manual;
            stroke.velocity = velocity;
            stroke.displacement = 0.0123;
            expect(stroke.poseRate(automatic, automaticRate)).toBeCloseTo((after - before) / (2 * dt), 4);
            expect([stroke.position, stroke.velocity, stroke.displacement]).toEqual([manual, velocity, 0.0123]);
          }
        }
      }
    }
  });

  it.each([MX_250, MX_450])('$id removes the persistent rate corner in real brake-braced reversals', (definition) => {
    for (const direction of [-1, 1]) {
      const traces = [120, 240, 480].map((hz) => brakeReversal(definition, hz, direction));
      for (const [i, trace] of traces.entries()) {
        expect(trace.legacyGap).toBeGreaterThan(3.8);
        expect(trace.gap).toBeLessThan(trace.legacyGap * 0.75);
        expect(trace.maximumChange).toBeLessThan(0.019);
        if (i) expect(trace.gap).toBeLessThan(traces[i - 1].gap * 0.75);
      }
      expect(traces[2].gap).toBeLessThan(traces[2].legacyGap * 0.25);
    }
  });

  it.each([MX_250, MX_450])('$id preserves every airborne physical state through a real manual reversal', (definition) => {
    const current = airborneReversal(definition);
    const legacy = vi.spyOn(RiderWeight.prototype, 'pose').mockImplementation(function (
      this: RiderWeight, automatic: number,
    ) {
      return this.position === 0 ? automatic : legacyPose(automatic, this.position);
    });
    try {
      const previous = airborneReversal(definition);
      expect(current.physics).toEqual(previous.physics);
      expect(Math.max(...current.poses.map((pose, i) => Math.abs(pose - previous.poses[i]))))
        .toBeGreaterThan(0.001);
    } finally {
      legacy.mockRestore();
    }
  });
});
