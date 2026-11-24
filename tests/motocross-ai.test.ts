import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { DirtBikeAIDriver, jumpHoldSpeed, motocrossClosingSpeed, motocrossJumpApproachSteer } from '../src/simulation/offroad/ai.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { rollSpeed, RUNUP_TRACTION_ACCELERATION } from '../src/simulation/offroad/jump-target.ts';
import { LANDING_RULES } from '../src/simulation/offroad/riding-feedback.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { LapTracker } from '../src/simulation/race.ts';
import { personality, TrafficPlanner } from '../src/simulation/traffic.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

function tripleApproach(vehicle: 'mx250' | 'mx450', runUp = 12, heading = 0, speedOffset = 0) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear', circuit: 'valley-ridge-mx',
    opponents: 0, vehicles: [vehicle], seed: 41003,
  });
  for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
  const jump = offroadCourse(sim.track.circuit)!.jumps.find((j) => j.name === 'SKY TRIPLE')!,
    bike = sim.cars[0] as DirtBikeVehicle,
    speed = jumpHoldSpeed(jump) + speedOffset;
  bike.place(sim.track, jump.start - runUp);
  bike.dynamics.speed = speed;
  bike.dynamics.heading += heading;
  for (let gear = 1; gear < bike.spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    const rpm = speed / bike.spec.wheelRadius * bike.spec.gearRatios[gear + 1] *
      bike.spec.finalDrive * 30 / Math.PI;
    if (rpm < bike.spec.shiftRPM * 0.85) break;
  }
  sim.autoPlayer = true;
  return { sim, bike, jump, ai: sim.ai[0] as DirtBikeAIDriver };
}

function wetBeachedRider() {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS, mode: 'practice', weather: 'rain', circuit: 'valley-ridge-mx',
    opponents: 1, vehicles: ['mx250', 'mx450'], seed: 41003,
  });
  for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
  const bike = sim.cars[0] as DirtBikeVehicle,
    traffic = sim.cars[1] as DirtBikeVehicle;
  // This real wet face holds the driven bike still. Moving the other
  // rider controls production traffic braking without assigning AI input.
  bike.place(sim.track, 315.4, -1.52);
  bike.gear = 2;
  sim.autoPlayer = true;
  return { sim, bike, traffic, ai: sim.ai[0] as DirtBikeAIDriver };
}

describe('motocross close traffic', () => {
  it('closes a walking yellow-flag queue to bike length while retaining contact and speed reserves', () => {
    const track = rigTrack('arena-nord-sx');
    const rider = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
    const leader = new DirtBikeVehicle(1, 'medium', DEFAULT_SETUP, 'sport', MX_450);
    const traits = personality(60724, 0);
    const follow = (gap: number, speed: number, yellow: boolean, leadingSpeed = speed) => {
      rider.place(track, 105, 0);
      leader.place(track, 105 + gap, 0);
      rider.speed = speed;
      leader.speed = leadingSpeed;
      const planner = new TrafficPlanner();
      return planner.evaluate(rider, [rider, leader], track, 10, 6, traits, yellow, 0,
        false, () => 0, 0.5).speedLimit;
    };
    expect(follow(5.8, 0, true)).toBeGreaterThan(1);
    expect(follow(1.9, 0, true)).toBe(0);
    expect(follow(5.8, 0, false)).toBe(0);
    expect(follow(4.0, 0, true, 1.8)).toBeGreaterThan(0);
    expect(follow(1.9, 0, true, 1.8)).toBe(0);
    expect(follow(5.8, 5, true)).toBe(follow(5.8, 5, false));
  });
  it('reserves stopping distance for a stranded rider while leaving an outside pass open', () => {
    expect(motocrossClosingSpeed(4, 0.25, 0, 8, 0, 0.8)).toBeLessThan(2);
    expect(motocrossClosingSpeed(4, 1.4, 0, 8, 0, 0.8)).toBe(Infinity);
    expect(motocrossClosingSpeed(4, 1.3, -2, 8, 0, 0.8)).toBeLessThan(2);
    expect(motocrossClosingSpeed(-2, 0, 0, 8, 0, 0.8)).toBe(Infinity);
    expect(motocrossClosingSpeed(4, 0, 0, 8, 9, 0.8)).toBe(Infinity);
    expect(motocrossClosingSpeed(10, 0, 0, 12, 1, 0.42)).toBeLessThan(
      motocrossClosingSpeed(10, 0, 0, 12, 1, 0.85));
  });
});

describe('motocross committed jump handoff', () => {
  it.each([-1, 1])('finishes a committed lane change before the lip from side %s', (side) => {
    const lane = side * 0.44, lip = -side * 0.18;
    for (const [speed, distance] of [[5, 8], [10, 12], [24, 18]]) {
      expect(motocrossJumpApproachSteer(lane, lip, distance + 1, speed, true)).toBe(lane);
      expect(motocrossJumpApproachSteer(lane, lip, distance * 0.5, speed, true))
        .toBeCloseTo((lane + lip) * 0.5, 12);
      expect(motocrossJumpApproachSteer(lane, lip, 0, speed, true)).toBe(lip);
      expect(motocrossJumpApproachSteer(lane, lip, 0, speed, false)).toBe(lane);
    }
  });

  it.each([
    { lateral: 3.5, roll: true, previous: 'none' },
    { lateral: 11, roll: false, previous: 'none' },
    { lateral: 11, roll: true, previous: 'same landing' },
    { lateral: 11, roll: false, previous: 'other landing' },
    { lateral: 11, roll: false, previous: 'grip fall' },
    { lateral: 11, roll: true, previous: 'repeated nose landing' },
    { lateral: 11, roll: false, previous: 'recovered nose landing' },
  ])('chooses a jump with a rider at $lateral m and a history of $previous', ({ lateral, roll, previous }) => {
    const dt = 1 / 120;
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear',
      circuit: 'valley-ridge-mx', opponents: 1, vehicles: ['mx450', 'mx250'], seed: 41003 });
    for (let i = 0; i < 6 / dt; i++) sim.step(dt);
    const jump = offroadCourse(sim.track.circuit)!.jumps.find((j) => j.name === 'BARN DOUBLE')!;
    const parked = sim.cars[0] as DirtBikeVehicle, rider = sim.cars[1] as DirtBikeVehicle;
    const driver = sim.ai[1] as DirtBikeAIDriver, hold = jumpHoldSpeed(jump);
    parked.place(sim.track, jump.takeoff + 4, lateral);
    parked.input.brake = 1;
    rider.place(sim.track, jump.start - 40);
    if (previous !== 'none') rider.crashCauses.push({
      cause: previous === 'grip fall' ? 'grip-separated' : 'crash-front',
      s: previous === 'other landing' || previous.endsWith('nose landing') ? jump.takeoff - 35 : jump.takeoff + 8,
      time: rider.clock - 5,
    });
    if (previous.endsWith('nose landing')) rider.crashCauses.push({
      cause: 'crash-front', s: jump.takeoff - 80,
      time: rider.clock - (previous.startsWith('recovered') ? 150 : 45),
    });
    rider.dynamics.speed = hold;
    for (let gear = 1; gear < rider.spec.gearRatios.length - 1; gear++) {
      rider.gear = gear;
      const rpm = hold / rider.spec.wheelRadius * rider.spec.gearRatios[gear + 1] *
        rider.spec.finalDrive * 30 / Math.PI;
      if (rpm < rider.spec.shiftRPM * 0.85) break;
    }
    const initial = driver.decisions.rolls + driver.decisions.aborts;
    let beforeFlag: number | undefined, longestFlight = 0;
    for (let i = 0; i < 14 / dt && rider.s < jump.end + 4; i++) {
      sim.step(dt);
      if (beforeFlag === undefined && rider.s >= jump.start - 26) {
        expect(sim.race.control.flags[rider.id]).toBe(FLAG.GREEN);
        beforeFlag = driver.decisions.rolls + driver.decisions.aborts - initial;
      }
      if (rider.lastLanding && rider.lastLanding.s > jump.takeoff)
        longestFlight = Math.max(longestFlight, rider.lastLanding.distance);
    }
    expect(beforeFlag).toBe(roll ? 1 : 0);
    expect(rider.s).toBeGreaterThan(jump.end);
    expect(rider.dynamics.crashes).toBe(0);
    if (roll) expect(longestFlight).toBeLessThan(4);
    else expect(longestFlight).toBeGreaterThan(12);
  });

  it.each(['mx250', 'mx450'] as const)(
    'rides the Valley Ridge whoops and following triple on the %s from a normal race start',
    (vehicle) => {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', weather: 'clear',
        circuit: 'valley-ridge-mx', ruleset: 'motocross-moto', laps: 2,
        opponents: 0, vehicles: [vehicle], seed: 61007 });
      sim.autoPlayer = true;
      const bike = sim.cars[0] as DirtBikeVehicle, ai = sim.ai[0] as DirtBikeAIDriver;
      const course = offroadCourse(sim.track.circuit)!;
      const triple = course.jumps.find((j) => j.name === 'SKY TRIPLE')!;
      const rollers = course.rough.find((r) => r.to < triple.start && triple.start - r.to < 25)!;
      let entered = false, cleared = false, initialFalls = 0, initialPushes = 0, slowest = Infinity;
      for (let tick = 0; tick < 120 * 100; tick++) {
        sim.step(1 / 120);
        if (!entered && bike.s >= rollers.from && bike.s < rollers.from + 2) {
          entered = true;
          initialFalls = bike.dynamics.crashes;
          initialPushes = ai.decisions.pushes;
        }
        if (!entered) continue;
        if (bike.s > triple.takeoff && bike.s < triple.end) slowest = Math.min(slowest, bike.speed);
        if (bike.s > triple.end + 2) { cleared = true; break; }
      }
      expect(entered && cleared).toBe(true);
      expect(bike.dynamics.crashes).toBe(initialFalls);
      expect(ai.decisions.pushes).toBe(initialPushes);
      expect(slowest).toBeGreaterThan(4);
    },
    40000,
  );

  it.each(['mx250', 'mx450'] as const)(
    'allows a real %s clear to settle without treating touchdown as a beached gap rider',
    (vehicle) => {
      const { sim, bike, jump } = tripleApproach(vehicle);
      let flew = false, landing: DirtBikeVehicle['lastLanding'] = null,
        samples = 0, maxBrake = 0, minTarget = Infinity;
      for (let i = 0; i < 120 * 6; i++) {
        sim.step(1 / 120);
        flew ||= bike.airborne && bike.s > jump.start;
        if (!landing && flew && !bike.airborne && bike.lastLanding) landing = bike.lastLanding;
        if (!landing) continue;
        const age = bike.clock - landing.time;
        if (age > 1 / 120 && age < LANDING_RULES.settleSeconds) {
          samples++;
          maxBrake = Math.max(maxBrake, bike.input.brake);
          minTarget = Math.min(minTarget, bike.aiTarget);
        }
        if (age >= LANDING_RULES.settleSeconds) break;
      }
      expect(flew).toBe(true);
      expect(landing).not.toBeNull();
      expect(landing!.s).toBeGreaterThan(jump.takeoff + 0.5);
      expect(landing!.s).toBeLessThan(jump.end);
      expect(landing!.airTime).toBeGreaterThan(1);
      expect(samples).toBeGreaterThan(20);
      // The old inside-gap branch immediately asked for 4 m/s and nearly
      // full braking after this unchanged physical touchdown.
      expect(minTarget).toBeGreaterThan(10);
      expect(maxBrake).toBeLessThan(0.05);
      expect(bike.dynamics.crashes).toBe(0);
    },
  );

  it.each([
    ['mx250', -1], ['mx250', 1], ['mx450', -1], ['mx450', 1],
  ] as const)('aborts the %s clear once when heading recovery brakes from side %s', (vehicle, side) => {
    const { sim, bike, jump, ai } = tripleApproach(vehicle, 16, side * 0.6, -0.5);
    let flew = false, landing: DirtBikeVehicle['lastLanding'] = null;
    for (let i = 0; i < 120 * 6; i++) {
      sim.step(1 / 120);
      flew ||= bike.airborne && bike.s > jump.start;
      if (!landing && flew && !bike.airborne && bike.lastLanding) landing = bike.lastLanding;
      if (landing && bike.clock - landing.time > 0.5) break;
    }
    // The final heading guard used to brake after the planner's abort
    // check, then resume its locked clear at an unreachable lip speed.
    // Both mirrored physical approaches crashed at 10.7–11.1 m/s takeoff.
    expect(ai.decisions.aborts).toBe(1);
    expect(landing).not.toBeNull();
    expect(landing!.takeoffSpeed).toBeLessThan(6);
    expect(landing!.distance).toBeLessThan(3.5);
    expect(landing!.outcome).toBe('bottomed');
    expect(bike.s).toBeGreaterThan(jump.takeoff + 3);
    expect(bike.dynamics.crashes).toBe(0);
  });
});

describe('motocross cool-down lap', () => {
  it.each([false, true])('uses the classified rider’s pace and jump plan only after the flag (%s)', finished => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear',
      circuit: 'valley-ridge-mx', opponents: 0, vehicles: ['mx450'], seed: 60704 });
    for (let tick = 0; tick < 720; tick++) sim.step(1 / 120);
    const rider = sim.cars[0] as DirtBikeVehicle, driver = sim.ai[0] as DirtBikeAIDriver;
    rider.place(sim.track, 22);
    rider.dynamics.speed = 13;
    rider.gear = 2;
    if (finished) rider.finishTime = 125;
    sim.autoPlayer = true;
    let target = 0;
    for (let tick = 0; tick < 1800; tick++) {
      sim.step(1 / 120);
      if (rider.s > 25 && rider.s < 100) target = Math.max(target, rider.aiTarget);
    }
    expect(rider.s).toBeGreaterThan(160);
    expect(rider.dynamics.crashes).toBe(0);
    if (finished) {
      expect(target).toBeCloseTo(12);
      expect(driver.decisions.clears).toBe(0);
      expect(driver.decisions.rolls).toBeGreaterThan(0);
    } else {
      expect(target).toBeGreaterThan(20);
      expect(driver.decisions.clears).toBeGreaterThan(0);
    }
  });
});

describe('motocross AI rejoining', () => {
  it.each([['mx250', -1], ['mx450', 1]] as const)(
    '%s turns back down the course in a continuous marshal push after sustained wrong-way verge travel', (vehicle, side) => {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear',
        circuit: 'valley-ridge-mx', opponents: 0, vehicles: [vehicle], seed: 60704 });
      const dt = 1 / 120;
      for (let tick = 0; tick < 720; tick++) sim.step(dt);
      const rider = sim.cars[0] as DirtBikeVehicle, driver = sim.ai[0] as DirtBikeAIDriver;
      const shoulder = sim.track.at(76, trackPoint()).width - 0.15;
      rider.place(sim.track, 76, side * shoulder);
      rider.dynamics.heading += Math.PI + 0.035;
      rider.dynamics.speed = 3;
      rider.gear = 1;
      sim.autoPlayer = true;
      let assisting = 0, maxTurn = 0;
      for (let tick = 0; tick < 1440; tick++) {
        const before = rider.dynamics.heading;
        sim.step(dt);
        if (rider.dynamics.state === 'remount') {
          assisting++;
          maxTurn = Math.max(maxTurn, Math.abs(mod(rider.dynamics.heading - before + Math.PI, 2 * Math.PI) - Math.PI));
        }
        if (tick === 359) expect(driver.decisions.pushes).toBe(0);
      }
      expect(driver.decisions.pushes).toBe(1);
      expect(assisting).toBeGreaterThan(100);
      expect(maxTurn).toBeLessThan(0.05);
      expect(rider.s).toBeGreaterThan(100);
      expect(rider.dynamics.crashes).toBe(0);
    });

  it('waits for adjacent traffic to clear before turning a wrong-way bike around', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear',
      circuit: 'valley-ridge-mx', opponents: 1, vehicles: ['mx250', 'mx450'], seed: 60704 });
    for (let tick = 0; tick < 720; tick++) sim.step(1 / 120);
    const rider = sim.cars[0] as DirtBikeVehicle, traffic = sim.cars[1];
    const driver = sim.ai[0] as DirtBikeAIDriver;
    rider.place(sim.track, 76, sim.track.at(76, trackPoint()).width - 0.15);
    rider.dynamics.heading += Math.PI + 0.035;
    rider.dynamics.speed = 3;
    rider.gear = 1;
    sim.autoPlayer = true;
    let firstPush = -1;
    for (let tick = 0; tick < 1500; tick++) {
      const gap = tick < 660 ? 0 : 43;
      traffic.place(sim.track, rider.s + gap, rider.lateral - 2.2);
      sim.step(1 / 120);
      if (driver.decisions.pushes && firstPush < 0) firstPush = tick / 120;
    }
    expect(firstPush).toBeGreaterThanOrEqual(5.5);
    expect(firstPush).toBeLessThan(6);
    expect(driver.decisions.pushes).toBe(1);
    expect(rider.dynamics.crashes).toBe(0);
  });

  it.each([-1, 1])('slows a rider facing across the lane on side %s before driving onward', (side) => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      weather: 'clear',
      circuit: 'arena-nord-sx',
      opponents: 0,
      vehicles: ['mx450'],
      seed: 41003,
    });
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle,
      p = sim.track.at(35, trackPoint());
    bike.placeFree(
      sim.track,
      p.x + p.nx * side * 2.4,
      p.z + p.nz * side * 2.4,
      Math.atan2(p.tx, p.tz) + side * 0.9,
      0,
    );
    bike.dynamics.speed = 9;
    bike.dynamics.lean = -side * 0.25;
    bike.gear = 2;
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    // A normal 20+ m/s racing target previously accelerated a recovering
    // rider toward the opposite wall while the chassis was still leaning.
    expect(bike.aiTarget).toBeLessThanOrEqual(4.5);
    expect(bike.speed).toBeLessThan(7);
    expect(bike.input.throttle).toBe(0);
    expect(bike.input.brake).toBeGreaterThan(0.2);
    expect(bike.dynamics.crashes).toBe(0);
    expect(Math.abs(bike.lateral)).toBeLessThan(sim.track.boundaryAt(p, side));
  });

  it('holds one lane from the real stadium tabletop through its rollers and finish triple', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      weather: 'clear',
      circuit: 'arena-nord-sx',
      opponents: 0,
      vehicles: ['mx450'],
      seed: 41003,
    });
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle;
    bike.place(sim.track, 398, -1.5);
    bike.dynamics.speed = 10;
    bike.gear = 2;
    let greatestDrift = 0, greatestBank = 0;
    for (let i = 0; i < 660; i++) {
      sim.step(1 / 120);
      greatestDrift = Math.max(greatestDrift, Math.abs(bike.lateral + 1.5));
      greatestBank = Math.max(greatestBank, Math.abs(bike.dynamics.lean));
    }
    // Previously the next roller block requested the opposite side of the
    // lane while its tyres were hopping: >6 m drift and a wall crash. This
    // uses the production planner, tyre contact, jumps and collision solver.
    expect(greatestDrift).toBeLessThan(0.2);
    expect(greatestBank).toBeLessThan(0.05);
    expect(bike.s).toBeGreaterThan(469);
    expect(bike.speed).toBeGreaterThan(12);
    expect(bike.dynamics.crashes).toBe(0);
    expect(bike.airborne).toBe(true);
  });

  it('pushes a stranded drive tyre over Ridge Table when the chassis has just cleared the lip', () => {
    const { sim, bike: other, traffic: bike } = wetBeachedRider();
    other.place(sim.track, 50);
    sim.autoPlayer = false;
    const course = offroadCourse(sim.track.circuit)!;
    const ridge = course.jumps.find(j => j.name === 'RIDGE TABLE')!;
    // This recorded wet-moto stall is 12 cm beyond the takeoff station.
    const station = ridge.takeoff + 0.12;
    bike.place(sim.track, station, -0.91);
    expect(course.restartS(station)).toBeCloseTo(station, 6);
    bike.restart(sim.track, 'stranded');
    expect(bike.dynamics.state).toBe('remount');
    let previous = bike.s;
    for (let i=0;i<6*120;i++) {
      sim.step(1/120);
      expect(Math.abs(bike.s-previous)).toBeLessThan(0.15);
      previous = bike.s;
      if (bike.riding) break;
    }
    expect(bike.riding).toBe(true);
    expect(bike.s).toBeGreaterThan(ridge.end);
    const onTop = ridge.takeoff + bike.bikeSpec.cgToRear + bike.bikeSpec.rearWheelRadius + 1;
    bike.place(sim.track,onTop,-0.91);
    bike.restart(sim.track,'stranded');
    expect(bike.riding).toBe(true);
    expect(bike.s).toBeCloseTo(onTop,1);
  });

  it.each(['BARN DOUBLE', 'SUMMIT TABLE'])('pushes a beached front tyre off the %s approach', (name) => {
    const { sim, bike: other, traffic: bike } = wetBeachedRider();
    other.place(sim.track, 50);
    sim.autoPlayer = false;
    const jump = offroadCourse(sim.track.circuit)!.jumps.find((feature) => feature.name === name)!;
    const reach = bike.bikeSpec.cgToFront + bike.bikeSpec.frontWheelRadius;
    // The frame is just outside the survey's one-metre lead, but the rim
    // already overlaps the takeoff. A normal reset here used to repeat.
    bike.place(sim.track, jump.start - reach + 0.035, -1.5);
    const before = bike.s;
    bike.restart(sim.track);
    expect(bike.dynamics.state).toBe('remount');
    let previous = before, largestStep = 0;
    for (let i = 0; i < 6 * 120; i++) {
      sim.step(1 / 120);
      largestStep = Math.max(largestStep, Math.abs(bike.s - previous));
      previous = bike.s;
      if (bike.riding && bike.s >= jump.end) break;
    }
    expect(bike.s).toBeGreaterThan(jump.end);
    expect(largestStep).toBeLessThan(0.12);
    expect(bike.dynamics.crashes).toBe(0);
    // A tyre still fully on the approach restarts where the rider stopped.
    bike.place(sim.track, jump.start - reach - 0.25, -1.5);
    const approach = bike.s;
    bike.restart(sim.track);
    expect(bike.dynamics.state).toBe('riding');
    expect(Math.abs(bike.s - approach)).toBeLessThan(0.02);
  });

  it.each(['BARN DOUBLE', 'SUMMIT TABLE'])('gives a stranded rider a workable restart at the %s', (name) => {
    const { sim, bike: other, traffic: bike } = wetBeachedRider();
    other.place(sim.track, 50);
    sim.autoPlayer = false;
    const jump = offroadCourse(sim.track.circuit)!.jumps.find((feature) => feature.name === name)!;
    const rim = bike.bikeSpec.cgToFront + bike.bikeSpec.frontWheelRadius;
    bike.place(sim.track, jump.start - rim - 0.12, -2.5);
    bike.restart(sim.track);
    expect(bike.riding).toBe(true);
    bike.restart(sim.track, 'stranded');
    expect(bike.dynamics.state).toBe('remount');
    let last = bike.s, greatestStep = 0;
    for (let i = 0; i < 6 * 120 && !bike.riding; i++) {
      sim.step(1 / 120);
      greatestStep = Math.max(greatestStep, Math.abs(bike.s - last));
      last = bike.s;
    }
    expect(bike.s).toBeGreaterThan(jump.end);
    expect(greatestStep).toBeLessThan(0.12);
    expect(bike.dynamics.crashes).toBe(0);
    const runup = rollSpeed(jump.lipHeight) ** 2 / (2 * RUNUP_TRACTION_ACCELERATION);
    bike.place(sim.track, jump.start - runup - 0.5, -2.5);
    const before = bike.s;
    bike.restart(sim.track, 'stranded');
    expect(bike.riding).toBe(true);
    expect(Math.abs(bike.s - before)).toBeLessThan(0.02);
  });

  it.each([145.4, 448])('physically crosses timing gates during a long marshal recovery at %s m', (start) => {
    const track = rigTrack('arena-nord-sx'),
      bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450),
      lap = new LapTracker(track.length, track.length - 1);
    // Reach the approach's timing state through ordinary successive samples,
    // including the start line. No checkpoint or lap counter is assigned.
    let time = 0;
    for (let s = 0; s < start; s++) lap.update(s, time += 0.1, false);
    lap.update(start, time += 0.1, false);
    const gate = lap.nextGate;
    bike.place(track, start);
    bike.restart(track);
    expect(bike.dynamics.state).toBe('remount');
    let previous = bike.s, greatestStep = 0;
    for (let i = 0; i < 720; i++) {
      bike.step(1 / 120, track);
      const delta = mod(bike.s - previous + track.length / 2, track.length) - track.length / 2;
      greatestStep = Math.max(greatestStep, Math.abs(delta));
      lap.update(bike.s, time += 1 / 120, false);
      previous = bike.s;
      if (bike.riding) break;
    }
    expect(bike.riding).toBe(true);
    expect(greatestStep).toBeLessThan(0.15);
    expect(lap.nextGate).toBe(gate + 1);
    expect(lap.completed).toBe(0);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('helps a beached rider with the exact 4 m/s rolling target without waiting for the slower fallback', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear', circuit: 'arena-nord-sx',
      opponents: 0, vehicles: ['mx450'], seed: 41003,
    });
    // Pass the ordinary practice release and marshal assistance delay.
    for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle;
    // The observed beached pose: stopped on the steep middle mound with
    // the front lifted and the rear still at its sagged contact height.
    // Starting upstream depended on the brake solver stopping within 15 cm
    // of this point; the planner then asked for 4.016 m/s instead of exactly 4.
    bike.place(sim.track, 145.45);
    bike.pitch = 1.1;
    bike.cgY =
      bike.contacts[2].height + bike.bikeSpec.cgToRear * Math.sin(bike.pitch) +
      (bike.bikeSpec.cgHeight + bike.compressionRear) * Math.cos(bike.pitch) -
      bike.compressionRear;
    bike.gear = 2;
    let held = false, startedPush = false, heldAt = 0, pushAfter = -1;
    for (let i = 0; i < 1800; i++) {
      sim.step(1 / 120);
      if (!held && bike.speed < 0.1 && bike.aiTarget === 4 && bike.input.throttle > 0.9) {
        held = true;
        heldAt = sim.race.raceTime;
      }
      if (held && !startedPush && bike.dynamics.state === 'remount') {
        startedPush = true;
        pushAfter = sim.race.raceTime - heldAt;
      }
    }
    expect(held).toBe(true);
    expect(startedPush).toBe(true);
    expect(pushAfter).toBeGreaterThanOrEqual(3.9);
    expect(pushAfter).toBeLessThan(4.1);
    expect(bike.s).toBeGreaterThan(147);
    expect(bike.dynamics.crashes).toBe(0);
  });
});

describe('motocross stationary drive effort', () => {
  it('pauses effort during passing traffic and assists only after four seconds of actual drive', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let effort = 0, brakeTime = 0, movement = 0;
    let firstPush: { time: number; effort: number; throttle: number; brake: number } | null = null;
    for (let i = 0; i < 120 * 14; i++) {
      const blocked = Math.floor(i / 240) % 2 === 1,
        stationary = bike.riding && !bike.airborne && bike.speed < 0.5;
      traffic.place(sim.track, 315.4 + (blocked ? 2.8 : 40), -1.52);
      sim.step(1 / 120);
      if (!firstPush) {
        if (stationary && bike.aiTarget > 0.5 && bike.input.throttle > 0.2 && bike.input.brake < 0.1) {
          effort += 1 / 120;
        }
        if (stationary && bike.input.brake > 0.9) brakeTime += 1 / 120;
        movement = Math.max(movement, Math.abs(bike.s - 315.4));
        if (ai.decisions.pushes) firstPush = {
          time: i / 120, effort, throttle: bike.input.throttle, brake: bike.input.brake,
        };
      }
    }
    // Previously each two-second traffic pause erased the preceding drive
    // effort: this rider never got help despite over seven seconds driving.
    expect(firstPush).not.toBeNull();
    expect(firstPush!.time).toBeGreaterThan(8);
    expect(firstPush!.time).toBeLessThan(9);
    expect(firstPush!.effort).toBeGreaterThanOrEqual(3.9);
    expect(firstPush!.effort).toBeLessThan(4.1);
    expect(firstPush!.throttle).toBeGreaterThan(0.2);
    expect(firstPush!.brake).toBeLessThan(0.1);
    expect(brakeTime).toBeGreaterThan(3.5);
    expect(movement).toBeLessThan(0.05);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.s).toBeGreaterThan(330);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('waits for current traffic before helping when a rider arrives at the effort threshold', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    // Four seconds of uninterrupted real drive approach the assistance
    // threshold between the shared traffic planner's successive updates.
    for (let i = 0; i < 120 * 4; i++) {
      traffic.place(sim.track, 355.4, -1.52);
      sim.step(1 / 120);
    }
    expect(bike.riding).toBe(true);
    expect(bike.speed).toBeLessThan(0.5);
    expect(bike.input.throttle).toBeGreaterThan(0.2);
    expect(bike.input.brake).toBeLessThan(0.1);
    expect(ai.decisions.pushes).toBe(0);
    // The rival arrives while the cached pedals still request drive. The
    // next physics tick must not start a push before traffic is reassessed.
    for (let i = 0; i < 120; i++) {
      traffic.place(sim.track, 318.2, -1.52);
      sim.step(1 / 120);
      expect(ai.decisions.pushes).toBe(0);
      if (i >= 12) {
        expect(bike.input.throttle).toBeLessThan(0.01);
        expect(bike.input.brake).toBeGreaterThan(0.9);
      }
    }
    expect(Math.abs(bike.s - 315.4)).toBeLessThan(0.05);
    // The queue pauses the earned effort. Once clear, the next ordinary
    // traffic assessment can release assistance without another four seconds.
    let releasedAfter = -1;
    for (let i = 0; i < 24; i++) {
      traffic.place(sim.track, 355.4, -1.52);
      sim.step(1 / 120);
      if (ai.decisions.pushes) {
        releasedAfter = (i + 1) / 120;
        break;
      }
    }
    expect(releasedAfter).toBeGreaterThan(0);
    expect(releasedAfter).toBeLessThanOrEqual(0.1);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.input.throttle).toBeGreaterThan(0.2);
    expect(bike.input.brake).toBeLessThan(0.1);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('keeps a continuously brake-held traffic queue stationary without assistance', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let maxThrottle = 0, minBrake = 1, movement = 0;
    for (let i = 0; i < 120 * 14; i++) {
      traffic.place(sim.track, 318.2, -1.52);
      sim.step(1 / 120);
      movement = Math.max(movement, Math.abs(bike.s - 315.4));
      // Allow the normal traffic planner its first evaluation.
      if (i >= 120) {
        maxThrottle = Math.max(maxThrottle, bike.input.throttle);
        minBrake = Math.min(minBrake, bike.input.brake);
      }
    }
    expect(maxThrottle).toBeLessThan(0.01);
    expect(minBrake).toBeGreaterThan(0.9);
    expect(movement).toBeLessThan(0.05);
    expect(ai.decisions.pushes).toBe(0);
    expect(bike.riding).toBe(true);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('discards earlier effort when a real external push moves the bike', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let lastMotion = -1, maxSpeed = 0, firstPush = -1, positionBeforePush = 0;
    for (let i = 0; i < 120 * 10; i++) {
      if (i === 240) {
        const p = bike.trackPosition;
        bike.body.velocity.x += p.tx * 2;
        bike.body.velocity.z += p.tz * 2;
      }
      traffic.place(sim.track, 355.4, -1.52);
      sim.step(1 / 120);
      if (i >= 240 && bike.speed >= 0.5) lastMotion = i / 120;
      maxSpeed = Math.max(maxSpeed, bike.speed);
      if (ai.decisions.pushes) {
        firstPush = i / 120;
        positionBeforePush = bike.s;
        break;
      }
    }
    expect(maxSpeed).toBeGreaterThan(1);
    expect(positionBeforePush - 315.4).toBeGreaterThan(0.3);
    expect(lastMotion).toBeGreaterThan(2);
    expect(firstPush - lastMotion).toBeGreaterThanOrEqual(3.9);
    expect(firstPush - lastMotion).toBeLessThan(4.1);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.dynamics.crashes).toBe(0);
  });

  it('starts a fresh drive-effort interval after an actual manual remount', () => {
    const { sim, bike, traffic, ai } = wetBeachedRider();
    let returnedAt = -1, firstPush = -1, sawRemount = false, effort = 0;
    for (let i = 0; i < 120 * 14; i++) {
      if (i === 240) bike.restart(sim.track);
      const stationary = bike.riding && !bike.airborne && bike.speed < 0.5;
      traffic.place(sim.track, 355.4, -1.52);
      sim.step(1 / 120);
      if (i >= 240 && !bike.riding) sawRemount = true;
      if (sawRemount && returnedAt < 0 && bike.riding) {
        returnedAt = i / 120;
        bike.place(sim.track, 315.4, -1.52);
      }
      if (returnedAt >= 0 && stationary && bike.aiTarget > 0.5 &&
        bike.input.throttle > 0.2 && bike.input.brake < 0.1) effort += 1 / 120;
      if (ai.decisions.pushes) {
        firstPush = i / 120;
        break;
      }
    }
    expect(sawRemount).toBe(true);
    expect(returnedAt - 2).toBeGreaterThan(4.9);
    expect(returnedAt - 2).toBeLessThan(5.1);
    expect(firstPush - returnedAt).toBeGreaterThan(4);
    expect(firstPush - returnedAt).toBeLessThan(4.3);
    expect(effort).toBeGreaterThanOrEqual(3.9);
    expect(effort).toBeLessThan(4.1);
    expect(ai.decisions.pushes).toBe(1);
    expect(bike.dynamics.crashes).toBe(0);
  });
});
