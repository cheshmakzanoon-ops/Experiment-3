/** Front-rotor phase audit. Production is never edited: a two-expression
 * legacy-inertia counterfactual runs in memory, then the original method is
 * restored. Run with node --experimental-transform-types and capture JSON. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DynamicsTrack } from '../dynamics-fixtures.ts';
import { clamp } from '../../src/core/math.ts';
import { circuitDefinition, type CircuitId } from '../../src/simulation/circuits.ts';
import { controls, DEFAULT_SETUP } from '../../src/simulation/config.ts';
import { MOTORCYCLE_THERMAL } from '../../src/simulation/motorcycle-thermal.ts';
import {
  DirtBikeVehicle,
  type LandingRecord,
} from '../../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450, SM_450 } from '../../src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../../src/simulation/offroad/venues.ts';
import type { VehicleDefinition } from '../../src/simulation/vehicles.ts';
import {
  observePlayerStepIntervals,
  runPlayerFlight,
  type PlayerCase,
} from './motocross-player-dynamics.ts';

class Plane extends DynamicsTrack {
  override readonly circuit;
  constructor(venue: CircuitId = 'valley-ridge-mx') {
    super();
    this.circuit = circuitDefinition(venue);
  }
}

type Internals = {
  airTorque: number;
  automaticBody: number;
  flightSpeed: number;
  writeBody(track: DynamicsTrack, dt: number): void;
};

function rig(definition: VehicleDefinition, venue: CircuitId = 'valley-ridge-mx', ai = false) {
  const track = new Plane(venue),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    model = bike as unknown as Internals;
  bike.placeFree(track, 0, 0, 0, 0);
  if (ai) bike.aiControlled(1e6);
  bike.step(1 / 240, track);
  bike.autoShift = false;
  bike.gear = 3;
  bike.cgY = 10;
  bike.pitch = bike.pitchRate = bike.vy = 0;
  bike.forceFront = bike.forceRear = 0;
  bike.airborne = true;
  bike.airTime = 0.2;
  model.flightSpeed = bike.dynamics.speed = 8;
  bike.frontSpin = 30;
  bike.rearSpin = 0;
  Object.assign(bike.input, controls(), { brake: 1 });
  model.writeBody(track, 0);
  return { bike, track, model };
}

function ledger(definition: VehicleDefinition, hz: number) {
  const { bike, track, model } = rig(definition),
    inertia = bike.tires[0].inertia,
    initialOmega = bike.frontSpin,
    initialEnergyJ = 0.5 * inertia * initialOmega ** 2,
    p = MOTORCYCLE_THERMAL.front;
  let heatJ = 0,
    bearingJ = 0,
    angularMismatchNms = 0,
    chassisMismatchNms = 0,
    intervals = 0;
  for (let tick = 0; tick < hz && bike.frontSpin > 0; tick++) {
    observePlayerStepIntervals(bike, track, 1 / hz, ({ before, dt }) => {
      const tire = bike.tires[0],
        coast = before.frontSpin * Math.exp(-0.4 * dt),
        loss =
          (p.brake.airBase + p.brake.airSpeed * Math.hypot(bike.dynamics.speed, bike.slide)) *
            (tire.discTemp - track.ambient) +
          p.tyre.discToCore * (tire.discTemp - tire.coreTemp);
      heatJ += p.brake.capacity * (tire.discTemp - before.discs[0]) + loss * dt;
      bearingJ += 0.5 * inertia * (before.frontSpin ** 2 - coast ** 2);
      angularMismatchNms +=
        (model.airTorque + model.automaticBody * bike.air.bodyTorque) * dt -
        bike.air.spinInertia * (bike.rearSpin - before.rearSpin) -
        inertia * (bike.frontSpin - coast);
      // This fixture has zero riderLean throughout. The observed chassis
      // rate therefore exposes applied angular impulse after accounting
      // for its existing free-flight damping and the other known ports.
      const decay = Math.exp(-(0.3 + 0.5 * bike.standing) * dt);
      chassisMismatchNms +=
        bike.air.pitchInertia * (bike.pitchRate / decay - before.pitchRate) +
        model.automaticBody * bike.air.bodyTorque * dt -
        bike.air.spinInertia * (bike.rearSpin - before.rearSpin) -
        inertia * (bike.frontSpin - coast);
      intervals++;
    });
  }
  const finalEnergyJ = 0.5 * inertia * bike.frontSpin ** 2;
  return {
    machine: definition.id,
    hz,
    inertia,
    initialOmega,
    initialEnergyJ,
    heatJ,
    bearingJ,
    finalEnergyJ,
    finalOmega: bike.frontSpin,
    energyResidualJ: heatJ + bearingJ + finalEnergyJ - initialEnergyJ,
    angularMismatchNms,
    chassisMismatchNms,
    intervals,
    landings: bike.landings,
    airborne: bike.airborne,
  };
}

/** Explicit zero-front-brake controls on an actual surveyed jump. A named
 * feedback script is insufficient: it can carry an approach brake request
 * through a short, earlier free interval before the intended departure. */
function noFrontBrakeTrace(definition: VehicleDefinition, venue: PlayerCase['venue']) {
  const track = rigTrack(venue),
    jump = offroadCourse(track.circuit)!.jumps.find(
      (item) => item.name === (venue === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP'),
    )!,
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
    model = bike as unknown as Internals,
    hash = createHash('sha256'),
    speed = venue === 'valley-ridge-mx' ? 13.5 : 13,
    dt = 1 / 240;
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  let airborneIntervals = 0,
    frontBrakeIntervals = 0,
    touchdown = 0;
  let landing: LandingRecord | null = null;
  for (let tick = 0; tick < 18 / dt; tick++) {
    if (!bike.riding || touchdown) Object.assign(bike.input, controls());
    else if (bike.airborne) {
      const wanted =
        (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
          Math.max(0.12, bike.landingIn) -
        bike.pitchRate;
      Object.assign(bike.input, controls(), {
        throttle: clamp(wanted * 1.2, 0, 1),
        clutch: clamp(-wanted * 1.2, 0, 1),
      });
    } else
      rideLine(
        bike,
        track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed)
          : speed,
      );
    bike.input.brake = 0;
    observePlayerStepIntervals(bike, track, dt, ({ before }) => {
      if (before.airborne) {
        airborneIntervals++;
        frontBrakeIntervals += Number(bike.brake !== 0);
      }
    });
    const d = bike.dynamics;
    hash.update(
      JSON.stringify({
        clock: bike.clock,
        dynamics: Object.fromEntries(
          Object.entries(d).filter(
            ([, value]) =>
              typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string',
          ),
        ),
        motion: [
          bike.cgY,
          bike.vy,
          bike.pitch,
          bike.pitchRate,
          bike.frontSpin,
          bike.rearSpin,
          bike.forceFront,
          bike.forceRear,
          bike.airYaw,
          bike.airYawRate,
          bike.standing,
          bike.riderBody,
          bike.fork,
          bike.shock,
          bike.gear,
          bike.rpm,
          model.airTorque,
          model.automaticBody,
          model.flightSpeed,
        ],
        body: [bike.body.position, bike.body.velocity, bike.body.orientation],
        tires: bike.tires.map((tire) => [
          tire.omega,
          tire.fx,
          tire.fy,
          tire.load,
          tire.energy,
          tire.surfaceTemp,
          tire.carcassTemp,
          tire.coreTemp,
          tire.discTemp,
          tire.wear,
        ]),
        input: bike.input,
        landing: bike.lastLanding,
      }),
    );
    // Ignore short approach hops; retain the actual surveyed flight even
    // if a subsequent suspension rebound publishes another landing record.
    if (bike.lastLanding && bike.lastLanding.airTime > 0.5 && !touchdown) {
      touchdown = bike.clock;
      landing = bike.lastLanding;
    }
    if (touchdown && bike.clock - touchdown >= 0.3) break;
  }
  return {
    machine: definition.id,
    venue,
    traceSha256: hash.digest('hex'),
    airborneIntervals,
    frontBrakeIntervals,
    landing,
    crashes: bike.dynamics.crashes,
  };
}

function legacyTrace(definition: VehicleDefinition, venue: CircuitId, ai: boolean) {
  const { bike, track, model } = rig(definition, venue, ai),
    hash = createHash('sha256');
  Object.assign(bike.input, controls(), { brake: 0.6, throttle: 0.15, clutch: 0.1, steer: 0.2 });
  for (let tick = 0; tick < 240; tick++) {
    bike.step(1 / 240, track);
    const d = bike.dynamics;
    hash.update(
      JSON.stringify({
        clock: bike.clock,
        state: d.state,
        dynamics: Object.fromEntries(
          Object.entries(d).filter(
            ([, value]) => typeof value === 'number' || typeof value === 'boolean',
          ),
        ),
        sprung: [
          bike.cgY,
          bike.vy,
          bike.pitch,
          bike.pitchRate,
          bike.airYaw,
          bike.airYawRate,
          bike.frontSpin,
          bike.rearSpin,
          bike.forceFront,
          bike.forceRear,
          bike.fork,
          bike.shock,
          bike.riderBody,
          bike.riderBodyRate,
          bike.standing,
          bike.airTime,
          bike.fuel,
          bike.gear,
          bike.rpm,
          model.airTorque,
          model.automaticBody,
          model.flightSpeed,
        ],
        body: [bike.body.position, bike.body.velocity, bike.body.orientation],
        tires: bike.tires.map((tire) => [
          tire.inertia,
          tire.omega,
          tire.load,
          tire.fx,
          tire.fy,
          tire.energy,
          tire.surfaceTemp,
          tire.carcassTemp,
          tire.coreTemp,
          tire.discTemp,
          tire.wear,
        ]),
        input: bike.input,
      }),
    );
  }
  return {
    machine: definition.id,
    venue,
    ai,
    traceSha256: hash.digest('hex'),
    airborne: bike.airborne,
    crashes: bike.dynamics.crashes,
  };
}

async function audit() {
  const sourceUrl = new URL('../../src/simulation/offroad/dirt-bike-vehicle.ts', import.meta.url),
    source = readFileSync(sourceUrl, 'utf8'),
    hash = (s: string) => createHash('sha256').update(s).digest('hex'),
    expression = 'this.playerMotocross ? this.tires[0].inertia : spec.wheelInertia';
  if (source.split(expression).length !== 2)
    throw new Error('Adapter changed: review the isolated legacy front-inertia counterfactual');
  const js = stripTypeScriptTypes(source.replace(expression, 'spec.wheelInertia'), {
      mode: 'transform',
    }).replace(
      /from (['"])(\.[^'"]+)\1/g,
      (_match, _quote: string, path: string) => `from '${new URL(path, sourceUrl).href}'`,
    ),
    legacy = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`))
      .DirtBikeVehicle.prototype as object,
    prototype = DirtBikeVehicle.prototype,
    original = Object.getOwnPropertyDescriptor(prototype, 'flight')!;
  const modes = [];
  try {
    for (const mode of ['physical-front-inertia', 'legacy-front-inertia'] as const) {
      Object.defineProperty(
        prototype,
        'flight',
        mode === 'physical-front-inertia'
          ? original
          : Object.getOwnPropertyDescriptor(legacy, 'flight')!,
      );
      const ledgers = [MX_250, MX_450].flatMap((definition) =>
        [120, 240, 480].map((hz) => ledger(definition, hz)),
      );
      const noFrontBrake = [MX_250, MX_450].flatMap((definition) =>
        (['valley-ridge-mx', 'arena-nord-sx'] as const).map((venue) =>
          noFrontBrakeTrace(definition, venue),
        ),
      );
      const excluded = [
        legacyTrace(MX_250, 'valley-ridge-mx', true),
        legacyTrace(MX_450, 'arena-nord-sx', true),
        legacyTrace(SM_450, 'valley-ridge-mx', false),
        legacyTrace(SM_450, 'arena-nord-sx', false),
        legacyTrace(MX_250, 'aurel', false),
        legacyTrace(MX_450, 'aurel', false),
      ];
      const adverse = [240, 480, 960, 1920].map((hz) => {
        const run = runPlayerFlight(
          { machine: 'mx250', venue: 'arena-nord-sx', assist: 'raw', hz },
          'front-lock',
        );
        return {
          hz,
          landing: run.landing,
          crashes: run.crashes,
          violations: run.violations,
          traceSha256: run.traceSha256,
        };
      });
      modes.push({ mode, ledgers, noFrontBrake, excluded, adverse });
    }
  } finally {
    Object.defineProperty(prototype, 'flight', original);
  }
  const [current, previous] = modes,
    preservedWithoutFrontBrake = current.noFrontBrake.every(
      (run, i) => run.traceSha256 === previous.noFrontBrake[i].traceSha256,
    ),
    preservedExcluded = current.excluded.every(
      (run, i) => run.traceSha256 === previous.excluded[i].traceSha256,
    ),
    after = hash(readFileSync(sourceUrl, 'utf8')),
    evidence = {
      adapterSha256: hash(source),
      afterSha256: after,
      sourceStable: hash(source) === after,
      preservedWithoutFrontBrake,
      preservedExcluded,
      counterfactual:
        'Only flight() uses the old generic front inertia; every other current method and state is identical.',
      modes,
    };
  console.log(JSON.stringify(evidence, null, 2));
  if (
    !evidence.sourceStable ||
    !preservedWithoutFrontBrake ||
    !preservedExcluded ||
    current.ledgers.some(
      (run) =>
        Math.abs(run.energyResidualJ) > 1e-7 ||
        Math.abs(run.angularMismatchNms) > 1e-11 ||
        Math.abs(run.chassisMismatchNms) > 1e-11 ||
        !run.airborne ||
        run.landings !== 0 ||
        run.finalOmega !== 0,
    ) ||
    current.noFrontBrake.some(
      (run) => run.airborneIntervals === 0 || run.frontBrakeIntervals !== 0 || !run.landing,
    ) ||
    current.adverse.some((run) => run.violations.length)
  )
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await audit();
