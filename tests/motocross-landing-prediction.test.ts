import { describe, expect, it } from 'vitest';
import { controls, DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
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
    incomingPlanar = 0,
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
    incomingPlanar =
      bike.dynamics.speed -
      ((bike.dynamics.p.drag * bike.dynamics.speed ** 2) / bike.dynamics.mass) * dt;
    bike.step(dt, run.track);
  }
  expect(bike.airborne).toBe(false);
  expect(bike.lastLanding!.airTime).toBeGreaterThan(0.8);
  return {
    ...run,
    samples,
    incomingVy,
    incomingPlanar,
    incomingPitch,
    incomingSide,
    incomingHeading,
  };
}

describe('motocross first-tyre landing prediction', () => {
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
        const { bike, incomingVy, incomingPlanar, incomingPitch, incomingSide, incomingHeading } =
            land(definition, 'raw', 0, dt),
          landing = bike.lastLanding!,
          cos = Math.cos(incomingHeading),
          sin = Math.sin(incomingHeading);
        const touching = [0, 2].filter(
          (i) => (i === 0 ? bike.compressionFront : bike.compressionRear) > 0,
        );
        const cross =
          touching.reduce((sum, i) => {
            const n = bike.contacts[i].normal;
            return sum - (n.x * cos - n.z * sin) / n.y;
          }, 0) / touching.length;
        const grade = Math.tan(landing.slope);
        const expected =
          (grade * incomingPlanar + cross * incomingSide - incomingVy) /
          Math.hypot(1, grade, cross);
        expect(landing.normalSpeed).toBeCloseTo(expected, 8);
        expect(landing.pitchError + landing.slope).toBeCloseTo(incomingPitch, 8);
        expect(landing.normalSpeed).toBeGreaterThan(4);
      }
    },
  );

  it('retains the first bottoming stroke and incoming crash severity on a real triple overshoot', () => {
    const { bike, track } = launch(MX_450, 'raw', DT, false, {
      name: 'SKY TRIPLE',
      extraSpeed: 6,
    });
    // A real excessive-speed takeoff followed by free flight. The larger
    // supported contact timestep exercises an initial stroke that reaches
    // the bump stop immediately, instead of bottoming over later samples.
    // No chassis state, terrain sample, load or force is supplied by a test.
    while (bike.airborne && bike.airTime < 4) bike.step(bike.airTime > 1 ? 1 / 30 : DT, track);
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
