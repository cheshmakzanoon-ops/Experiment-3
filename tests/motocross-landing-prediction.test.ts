import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { controls, DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { surfaceSample, type Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** Reach the surveyed takeoff with the real rider/terrain, then give the
 * player only the usual controls. No airborne pose or contact is fabricated. */
function launch(
  definition: VehicleDefinition,
  assist: Assist = 'raw',
  dt = DT,
  ai = false,
  feature?: { name: string; extraSpeed: number },
) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find(
      (j) => j.name === (feature?.name ?? 'RIDGE TABLE'),
    )!,
    speed = jumpHoldSpeed(jump) + (feature?.extraSpeed ?? 0),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e6);
  for (let gear = 1; gear < definition.spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    const rpm =
      ((speed / definition.spec.wheelRadius) *
        definition.spec.gearRatios[gear + 1] *
        definition.spec.finalDrive *
        30) /
      Math.PI;
    if (rpm < definition.spec.shiftRPM * 0.85) break;
  }
  for (let t = 0; t < 6; t += dt) {
    if (!bike.airborne)
      rideLine(
        bike,
        track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed)
          : speed,
      );
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      if (!ai) bike.aiControlled(0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error('The production takeoff was not reached');
}

function land(
  definition: VehicleDefinition, assist: Assist, body: number, dt = DT, ai = false,
  feature?: { name: string; extraSpeed: number },
) {
  const run = launch(definition, assist, dt, ai, feature),
    bike = run.bike,
    samples: { at: number; remaining: number; slope: number }[] = [];
  let incomingVy = 0,
    incomingSpeed = 0,
    incomingClock = 0,
    incomingX = 0,
    incomingZ = 0,
    incomingRate = 0,
    incomingPitch = 0,
    incomingSide = 0,
    incomingHeading = 0;
  bike.input.riderLean = body;
  while (bike.airborne && bike.airTime < 3) {
    samples.push({ at: bike.airTime, remaining: bike.landingIn, slope: bike.landingTarget });
    incomingVy = bike.vy;
    incomingSide = bike.slide;
    incomingHeading = bike.dynamics.heading;
    incomingPitch = bike.pitch;
    incomingSpeed = bike.dynamics.speed;
    incomingClock = bike.clock;
    incomingX = bike.dynamics.x;
    incomingZ = bike.dynamics.z;
    incomingRate = bike.pitchRate;
    bike.step(dt, run.track);
  }
  expect(bike.airborne).toBe(false);
  expect(bike.lastLanding!.airTime).toBeGreaterThan(0.8);
  return {
    ...run,
    samples,
    incomingVy,
    incomingSpeed,
    incomingClock,
    incomingX,
    incomingZ,
    incomingRate,
    incomingPitch,
    incomingSide,
    incomingHeading,
  };
}

/** Observe the real front wheel approaching its free-position contact. */
function frontApproach(bike: DirtBikeVehicle, track: Track) {
  const spec = bike.definition.bike!, sag = factoryBikeSag(bike.definition),
    arm = spec.cgToFront, height = spec.cgHeight + sag.fork,
    heading = bike.heading, h = heading + bike.airYaw,
    free = bike.cgY + arm * Math.sin(bike.pitch) - height * Math.cos(bike.pitch),
    patch = surfaceSample();
  track.sample(bike.dynamics.x + Math.sin(h) * arm, bike.dynamics.z + Math.cos(h) * arm, patch, free);
  const n = patch.normal,
    vx = Math.sin(heading) * bike.dynamics.speed + Math.cos(heading) * bike.slide + Math.cos(h) * arm * bike.airYawRate,
    vz = Math.cos(heading) * bike.dynamics.speed - Math.sin(heading) * bike.slide - Math.sin(h) * arm * bike.airYawRate;
  return { gap: free - patch.height,
    closing: -(n.x * vx + n.z * vz) / n.y - bike.vy -
      (arm * Math.cos(bike.pitch) + height * Math.sin(bike.pitch)) * bike.pitchRate };
}

describe('motocross first-tyre landing prediction', () => {
  it('keeps a midair sideswipe in ballistic motion while the motorcycle yaws independently', () => {
    const plain = launch(MX_450), hit = launch(MX_450);
    const a = plain.bike, b = hit.bike;
    for (let i = 0; i < 18; i++) {
      a.step(DT, plain.track);
      b.step(DT, hit.track);
    }
    const heading = b.dynamics.heading, sh = Math.sin(heading), ch = Math.cos(heading);
    b.body.velocity.x -= 0.7 * ch;
    b.body.velocity.z += 0.7 * sh;
    b.body.omega.y += 1.5;
    a.step(DT, plain.track);
    b.step(DT, hit.track);
    expect(b.dynamics.speed).toBeCloseTo(a.dynamics.speed, 7);
    expect(b.slide - a.slide).toBeCloseTo(-0.7, 7);
    expect(b.vy).toBeCloseTo(a.vy, 7);
    for (let i = 0; i < 10; i++) {
      a.step(DT, plain.track);
      b.step(DT, hit.track);
    }
    expect(b.airborne).toBe(true);
    expect(b.dynamics.heading).toBeCloseTo(heading, 10);
    expect(b.airYaw - a.airYaw).toBeGreaterThan(0.035);
    expect(b.cgY).toBeCloseTo(a.cgY, 5);
    expect(b.dynamics.speed).toBeCloseTo(a.dynamics.speed, 7);
  });

  it.each(
    [MX_250, MX_450].flatMap((definition) =>
      [1 / 120, 1 / 240].map((dt) => ({ id: definition.id, definition, dt })),
    ),
  )(
    '$id at $dt s forecasts actual first contact through fore/aft player strokes',
    ({ definition, dt }) => {
      for (const assist of ['raw', 'sport'] as const)
        for (const body of [-1, 0, 1]) {
          const { bike, samples } = land(definition, assist, body, dt),
            landing = bike.lastLanding!,
            final = samples.filter((sample) => landing.airTime - sample.at < 0.2);
          expect(final.length).toBeGreaterThan(20);
          const error = Math.max(
            ...final.map((sample) => Math.abs(sample.remaining - (landing.airTime - sample.at))),
          );
          expect(error, `${assist} body=${body}`).toBeLessThan(0.035);
          expect(samples.at(-1)!.remaining).toBeLessThan(0.025);
          expect(Math.abs(samples.at(-1)!.slope - landing.slope)).toBeLessThan(0.06);
          expect(bike.dynamics.crashes).toBe(0);
        }
    },
  );

  it('ages the remaining contact time between terrain forecasts', () => {
    const { bike, track } = launch(MX_450);
    while (bike.airTime < 0.7) bike.step(DT, track);
    let countdowns = 0;
    for (let n = 0; n < 12; n++) {
      const previous = bike.landingIn;
      bike.step(DT, track);
      if (Math.abs(previous - bike.landingIn - DT) < 1e-10) countdowns++;
    }
    expect(bike.airborne).toBe(true);
    expect(countdowns).toBeGreaterThanOrEqual(10);
  });

  it.each([MX_250, MX_450])(
    '$id records incoming impact before a suspension impulse can soften the touchdown verdict',
    (definition) => {
      for (const dt of [1 / 120, 1 / 240, 1 / 480]) {
        const { bike, track, incomingVy, incomingSpeed, incomingClock, incomingX, incomingZ,
            incomingPitch, incomingRate, incomingSide, incomingHeading } =
            land(definition, 'raw', 0, dt),
          landing = bike.lastLanding!,
          cos = Math.cos(incomingHeading),
          sin = Math.sin(incomingHeading),
          free = landing.time - incomingClock,
          k = bike.dynamics.p.drag / bike.dynamics.mass,
          incomingPlanar = incomingSpeed / (1 + k * incomingSpeed * free),
          eventVy = incomingVy - G * free,
          travel = Math.log1p(k * incomingSpeed * free) / k,
          x = incomingX + sin * travel + cos * incomingSide * free,
          z = incomingZ + cos * travel - sin * incomingSide * free,
          observed = bike as unknown as { airTorque: number; automaticBody: number },
          eventPitch = incomingPitch + (incomingRate + observed.airTorque / bike.air.pitchInertia * free) *
            Math.exp(-(0.3 + 0.5 * bike.standing) * free) * free;
        expect(free).toBeGreaterThan(0);
        expect(free).toBeLessThan(dt);
        const touching = [0, 2].filter(
          (i) => (i === 0 ? bike.forceFront : bike.forceRear) > 0,
        );
        const patches = touching.map(i => {
          const arm = i === 0 ? definition.bike!.cgToFront : -definition.bike!.cgToRear,
            patch = surfaceSample();
          track.sample(x + sin * arm, z + cos * arm, patch, bike.cgY);
          return patch.normal;
        });
        const cross = patches.reduce((sum, n) => sum - (n.x * cos - n.z * sin) / n.y, 0) / patches.length;
        const grade = patches.reduce((sum, n) => sum - (n.x * sin + n.z * cos) / n.y, 0) / patches.length;
        const expected =
          (grade * incomingPlanar + cross * incomingSide - eventVy) /
          Math.hypot(1, grade, cross);
        expect(landing.slope).toBeCloseTo(Math.atan(grade), 8);
        expect(landing.normalSpeed).toBeCloseTo(expected, 8);
        expect(landing.pitchError + landing.slope).toBeCloseTo(eventPitch + observed.automaticBody * 0.06, 8);
        expect(landing.normalSpeed).toBeGreaterThan(4);
      }
    },
  );

  it('retains the first bottoming stroke and incoming crash severity on a real triple overshoot', () => {
    const { bike, track } = launch(MX_450, 'raw', DT, false, {
      name: 'SKY TRIPLE',
      extraSpeed: 6,
    });
    // Phase the unchanged 30 Hz step immediately before the observed front
    // crossing so its supported remainder can physically reach full travel.
    // A step whose event falls near its end cannot truthfully report a stop.
    while (bike.airborne && bike.airTime < 4) {
      const front = frontApproach(bike, track),
        imminent = front.gap > 0 && front.closing > 0 && front.gap < front.closing * DT;
      bike.step(imminent ? 1 / 30 : DT, track);
    }
    const landing = bike.lastLanding!;
    expect(landing.airTime).toBeGreaterThan(2);
    expect(landing.normalSpeed).toBeGreaterThan(10);
    expect(landing.bottomSpeed).toBeGreaterThan(bike.air.bottomOutSpeed);
    expect(landing.pitchError).toBeLessThan(-bike.air.noseDownLimit);
    bike.step(DT, track);
    expect(landing.outcome).toBe('crash-front');
    expect(bike.dynamics.crashes).toBe(1);
    expect(bike.lastLanding).toBe(landing);
    expect(bike.airborne).toBe(false);
  });

  it.each([MX_250, MX_450])('$id AI forecasts first tyre contact on the table and triple', (definition) => {
    for (const name of ['RIDGE TABLE', 'SKY TRIPLE'])
      for (const dt of [1 / 120, 1 / 240]) {
        const { bike, samples } = land(definition, 'sport', 0, dt, true, { name, extraSpeed: 0 });
        const landing = bike.lastLanding!;
        const final = samples.filter((sample) => landing.airTime - sample.at < 0.2);
        expect(final.length).toBeGreaterThan(18);
        for (const sample of final)
          expect(Math.abs(sample.remaining - (landing.airTime - sample.at))).toBeLessThan(0.04);
        expect(samples.at(-1)!.remaining).toBeLessThan(0.03);
        expect(bike.dynamics.crashes).toBe(0);
      }
  });

  it('retains the supermoto contact forecast for both a rider and an AI opponent', () => {
    for (const ai of [true, false]) {
      const reference = { ...SM_450, id: 'unchanged-landing-reference' },
        before = land(reference, 'sport', 0, DT, ai),
        after = land(SM_450, 'sport', 0, DT, ai);
      expect(after.samples).toEqual(before.samples);
      expect(after.bike.lastLanding).toEqual(before.bike.lastLanding);
      expect(after.bike.body.position).toEqual(before.bike.body.position);
      expect(after.bike.body.velocity).toEqual(before.bike.body.velocity);
    }
  });
});
