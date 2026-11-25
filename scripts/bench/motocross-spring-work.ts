/** Read-only audit of the reduced MX suspension's virtual work.
 *
 * Run: node --experimental-transform-types scripts/bench/motocross-spring-work.ts
 *
 * The optional counterfactual is made by importing a one-expression edit of
 * the adapter through a data URL. No production file is written. It is a
 * sensitivity experiment, not a validated implementation or replacement rig.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { G } from '../../src/core/math.ts';
import { DEFAULT_SETUP } from '../../src/simulation/config.ts';
import { DirtBikeVehicle } from '../../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../../src/simulation/offroad/dirt-bikes.ts';
import { rigTrack, rideLine } from '../../src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from '../../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../../src/simulation/offroad/venues.ts';
import type { SurfaceSample } from '../../src/simulation/track.ts';
import type { VehicleDefinition } from '../../src/simulation/vehicles.ts';
import { DynamicsTrack } from '../dynamics-fixtures.ts';

type Constructor = typeof DirtBikeVehicle;
type Geometry = ReturnType<typeof geometry>;
function geometry(definition: VehicleDefinition) {
  const b = definition.bike!, sag = factoryBikeSag(definition);
  return {
    b, mass: definition.spec.dryMass + b.fuel,
    a: [b.cgToFront, -b.cgToRear],
    h: [b.cgHeight + sag.fork, b.cgHeight + sag.shock],
    k: [b.forkRate, b.shockRate],
    travel: [b.forkTravel, b.shockTravel],
    progression: b.offroad!.progression,
  };
}
function gap(g: Geometry, axle: number, height: number, pitch: number, terrain: number) {
  return terrain - height - g.a[axle] * Math.sin(pitch) + g.h[axle] * Math.cos(pitch);
}
function spring(g: Geometry, axle: number, compression: number) {
  const c = Math.max(0, Math.min(g.travel[axle], compression));
  return g.k[axle] * c * (1 + g.progression * (c / g.travel[axle]) ** 2) +
    40 * g.k[axle] * Math.max(0, compression - g.travel[axle]);
}
function springSlope(g: Geometry, axle: number, compression: number) {
  if (compression <= 0) return 0;
  if (compression > g.travel[axle]) return 40 * g.k[axle];
  return g.k[axle] * (1 + 3 * g.progression * (compression / g.travel[axle]) ** 2);
}
/** Exact antiderivative of the default-preload spring and linear bump stop. */
function potential(g: Geometry, axle: number, compression: number) {
  const c = Math.max(0, Math.min(g.travel[axle], compression));
  const beyond = Math.max(0, compression - g.travel[axle]);
  return g.k[axle] * (c * c / 2 + g.progression * c ** 4 / (4 * g.travel[axle] ** 2)) +
    spring(g, axle, g.travel[axle]) * beyond + 20 * g.k[axle] * beyond ** 2;
}
function elastic(g: Geometry, height: number, pitch: number, terrain: number[]) {
  const c = terrain.map((value, axle) => gap(g, axle, height, pitch, value));
  const forces = c.map((value, axle) => spring(g, axle, value));
  const levers = g.a.map((value, axle) => value * Math.cos(pitch) + g.h[axle] * Math.sin(pitch));
  const legacy = forces.reduce((total, value, axle) => total + value * g.a[axle] * Math.cos(pitch), 0);
  const geometric = forces.reduce((total, value, axle) => total + value * levers[axle], 0);
  return { c, forces, levers, legacy, geometric,
    heave: forces[0] + forces[1],
    energy: c.reduce((total, value, axle) => total + potential(g, axle, value), 0),
  };
}

function perturbation(definition: VehicleDefinition) {
  const g = geometry(definition), height = 1, eps = 1e-6;
  const samples = [-0.3, -0.12, 0, 0.12, 0.3, 0.65].map(pitch => {
    // Independent supported configurations; perturb pitch with fixed terrain.
    const terrain = g.a.map((arm, axle) => height + arm * Math.sin(pitch) -
      g.h[axle] * Math.cos(pitch) + (axle === 0 ? 0.08 : 0.1));
    const current = elastic(g, height, pitch, terrain);
    const derivative = -(elastic(g, height, pitch + eps, terrain).energy -
      elastic(g, height, pitch - eps, terrain).energy) / (2 * eps);
    assert.ok(Math.abs(derivative - current.geometric) < 1e-6);
    return { pitch, legacyNm: current.legacy, potentialDerivativeNm: derivative,
      missingNm: current.geometric - current.legacy };
  });
  // A closed rectangle in configuration space excludes explanations based
  // solely on changing the chosen stored-energy reference.
  const pitch = 0.25;
  const terrain = g.a.map((arm, axle) => height + arm * Math.sin(pitch) -
    g.h[axle] * Math.cos(pitch) + 0.12);
  const corners = [[height - 0.005, pitch - 0.01], [height + 0.005, pitch - 0.01],
    [height + 0.005, pitch + 0.01], [height - 0.005, pitch + 0.01],
    [height - 0.005, pitch - 0.01]];
  let legacyJ = 0, geometricJ = 0;
  for (let edge = 1; edge < corners.length; edge++) {
    const from = corners[edge - 1], to = corners[edge], divisions = 2048;
    const dy = (to[0] - from[0]) / divisions, dp = (to[1] - from[1]) / divisions;
    for (let step = 0; step < divisions; step++) {
      const f = elastic(g, from[0] + (step + 0.5) * dy, from[1] + (step + 0.5) * dp, terrain);
      legacyJ += f.heave * dy + f.legacy * dp;
      geometricJ += f.heave * dy + f.geometric * dp;
    }
  }
  assert.ok(Math.abs(geometricJ) < 1e-7);
  assert.ok(Math.abs(legacyJ) > 0.5);
  return { bike: definition.id, samples, closedLoop: { legacyJ, geometricJ } };
}

function balanceDiagnostics(definition: VehicleDefinition) {
  const g = geometry(definition), p = Math.atan(-g.a[1] / g.h[1]);
  const rearLoad = g.mass * G;
  // At the adapter's own geometric balance point the correct rear spring
  // lever is zero, but the legacy lever still supplies a restoring torque.
  const legacyAtBalance = rearLoad * g.a[1] * Math.cos(p);
  const geometricAtBalance = rearLoad * (g.a[1] * Math.cos(p) + g.h[1] * Math.sin(p));
  // Isolate the rear damper at 0.8 rad, 1 rad/s, zero heave. Its total
  // spring+damper force is still positive at 150 mm stroke, so clamping
  // does not suppress the illustrated local negative-damping component.
  const pitch = 0.8, rate = 1;
  const oldLever = g.a[1] * Math.cos(pitch);
  const lever = oldLever + g.h[1] * Math.sin(pitch);
  const compressionRate = -lever * rate;
  const air = g.b.offroad!;
  const damper = air.shockDamping * compressionRate * 2.2 /
    (1 + Math.abs(compressionRate) / air.damperKnee);
  assert.ok(spring(g, 1, 0.15) + damper > 0);
  return { bike: definition.id, balancePitch: p,
    legacyRearMomentAtBalanceNm: legacyAtBalance, geometricRearMomentAtBalanceNm: geometricAtBalance,
    rearDamperAt08: { legacyPowerW: damper * oldLever * rate,
      geometricPowerW: damper * lever * rate, compressionRate } };
}

class Grade extends DynamicsTrack {
  constructor(readonly grade: number) { super(); }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = z * this.grade;
    out.normal.set(0, 1, -this.grade).normalize();
    return out;
  }
}
function equilibrium(definition: VehicleDefinition, grade: number) {
  const g = geometry(definition), track = new Grade(grade);
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.placeFree(track, 0, 0, 0, 0);
  const terrain = [bike.contacts[0].height, bike.contacts[2].height];
  let y = bike.cgY, p = bike.pitch;
  const before = elastic(g, y, p, terrain);
  // Solve both force equations for this same reduced gap geometry. No rider
  // or longitudinal input; the independent Newton Jacobian is symmetric.
  for (let iteration = 0; iteration < 20; iteration++) {
    const f = elastic(g, y, p, terrain);
    const residualY = f.heave - g.mass * G, residualP = f.geometric;
    if (Math.abs(residualY) + Math.abs(residualP) < 1e-9) break;
    const k = f.c.map((c, axle) => springSlope(g, axle, c));
    const yy = -k[0] - k[1];
    const yp = -k[0] * f.levers[0] - k[1] * f.levers[1];
    const pp = f.forces.reduce((total, force, axle) => total +
      force * (-g.a[axle] * Math.sin(p) + g.h[axle] * Math.cos(p)) -
      k[axle] * f.levers[axle] ** 2, 0);
    const determinant = yy * pp - yp * yp;
    y -= (pp * residualY - yp * residualP) / determinant;
    p -= (yy * residualP - yp * residualY) / determinant;
  }
  const after = elastic(g, y, p, terrain);
  assert.ok(Math.abs(after.heave - g.mass * G) + Math.abs(after.geometric) < 1e-7);
  assert.ok(after.c.every((c, axle) => c > 0 && c < g.travel[axle]));
  return { bike: definition.id, grade, initialPitch: bike.pitch,
    missingNm: before.geometric - before.legacy,
    initialAddedRadS2: (before.geometric - before.legacy) / bike.air.pitchInertia,
    oldFrontN: before.forces[0], geometricFrontN: after.forces[0],
    equilibriumPitchChangeDeg: (p - bike.pitch) * 180 / Math.PI,
    equilibriumHeightChangeMm: (y - bike.cgY) * 1000,
    equilibriumForkChangeMm: (after.c[0] - before.c[0]) * 1000,
    equilibriumShockChangeMm: (after.c[1] - before.c[1]) * 1000 };
}

type Internals = { vertical(dt: number): void; projectedContact: boolean; crashReason: string };
function measure(bike: DirtBikeVehicle) {
  const hidden = bike as unknown as Internals, original = hidden.vertical.bind(bike);
  const g = geometry(bike.definition);
  const stats = { loadedTicks: 0, oneAxleTicks: 0, peakOffsetNm: 0,
    signedOmissionWorkJ: 0, absoluteOmissionWorkJ: 0, latestOffsetNm: 0 };
  hidden.vertical = dt => {
    const pitch = bike.pitch, rate = bike.pitchRate, riding = bike.riding;
    original(dt);
    if (!riding || hidden.projectedContact || bike.forceFront + bike.forceRear <= 0) return;
    const missing = Math.sin(pitch) * (g.h[0] * bike.forceFront + g.h[1] * bike.forceRear);
    stats.loadedTicks++;
    stats.oneAxleTicks += Number((bike.forceFront > 0) !== (bike.forceRear > 0));
    stats.peakOffsetNm = Math.max(stats.peakOffsetNm, Math.abs(missing));
    // These integrals isolate the unmatched pitch-force port. They are not
    // total vehicle energy: drive, damping, changing terrain and collisions
    // all exchange energy elsewhere in the production reduced model. On
    // the counterfactual trajectory this is the port restored by that edit,
    // not a residual of its already-corrected pitch equation.
    stats.signedOmissionWorkJ -= missing * rate * dt;
    stats.absoluteOmissionWorkJ += Math.abs(missing * rate * dt);
    stats.latestOffsetNm = missing;
  };
  return stats;
}

async function counterfactual(source: string, url: URL) {
  const from = '(FF * fa - FR * ra) * cos + pitchMoment + bodyShift + (this.airborne ? this.airTorque : 0)';
  const to = 'FF * (fa * cos + HF * sin) + FR * (-ra * cos + HR * sin) + pitchMoment + bodyShift + (this.airborne ? this.airTorque : 0)';
  assert.equal(source.split(from).length, 2, 'Adapter changed: review the counterfactual before running it');
  const js = stripTypeScriptTypes(source.replace(from, to), { mode: 'transform' })
    .replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote: string, specifier: string) =>
      `from '${new URL(specifier, url).href}'`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  return module.DirtBikeVehicle as Constructor;
}

function wheelie(C: Constructor, definition: VehicleDefinition, hz: number) {
  const track = rigTrack('valley-ridge-mx');
  const bike = new C(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  bike.place(track, 35);
  const stats = measure(bike);
  bike.input.throttle = 1;
  let sample: object | undefined, firstLift = -1, maximumPitch = -Infinity, crashTime = -1;
  for (let tick = 1; tick <= hz; tick++) {
    bike.step(1 / hz, track);
    maximumPitch = Math.max(maximumPitch, bike.pitch);
    if (firstLift < 0 && bike.forceFront === 0) firstLift = tick / hz;
    if (tick === Math.round(0.35 * hz)) sample = { pitch: bike.pitch, rate: bike.pitchRate,
      speed: bike.dynamics.speed, frontN: bike.forceFront, rearN: bike.forceRear,
      offsetNm: stats.latestOffsetNm };
    if (!bike.riding) { crashTime = tick / hz; break; }
  }
  return { bike: definition.id, hz, firstLift, sampleAt035: sample, maximumPitch,
    crashTime, crashCause: (bike as unknown as Internals).crashReason || bike.crashCauses.at(-1)?.cause || 'none',
    endState: bike.dynamics.state, endAirborne: bike.airborne, endRate: bike.pitchRate, ...stats };
}

function jump(C: Constructor, definition: VehicleDefinition,
  venue: 'valley-ridge-mx' | 'arena-nord-sx', ai: boolean) {
  const track = rigTrack(venue);
  const name = venue === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP';
  const speed = venue === 'valley-ridge-mx' ? 13.5 : 13;
  const feature = offroadCourse(track.circuit)!.jumps.find(j => j.name === name)!;
  const bike = new C(0, 'medium', DEFAULT_SETUP, 'sport', definition);
  bike.place(track, feature.start - 12);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  if (ai) bike.aiControlled(1e9);
  const stats = measure(bike), hz = 240;
  let firstTakeoff: object | undefined, firstLanding: object | undefined;
  let candidateTakeoff: object | undefined;
  for (let tick = 0; tick < 6 * hz; tick++) {
    if (!bike.airborne) rideLine(bike, track,
      bike.s >= feature.start - 1 && bike.s <= feature.takeoff + 1
        ? Math.max(speed, bike.dynamics.speed) : speed);
    const wasAirborne = bike.airborne;
    bike.step(1 / hz, track);
    if (!wasAirborne && bike.airborne && bike.s >= feature.start - 1 && bike.s <= feature.takeoff + 3)
      candidateTakeoff = { s: bike.s, pitch: bike.pitch, rate: bike.pitchRate,
        speed: bike.lastTakeoff, vy: bike.vy };
    if (wasAirborne && !bike.airborne) {
      // Approach ripples can cause millisecond hops. Select a sustained
      // flight from the named feature, retaining its mutable graded record.
      if (!firstLanding && candidateTakeoff && bike.lastLanding && bike.lastLanding.airTime > 0.3) {
        firstTakeoff = candidateTakeoff;
        firstLanding = bike.lastLanding;
      }
      candidateTakeoff = undefined;
    }
    if (!bike.riding) break;
  }
  return { bike: definition.id, venue, controller: ai ? 'AI aids' : 'player Sport',
    crashes: bike.dynamics.crashes,
    crashCause: (bike as unknown as Internals).crashReason || bike.crashCauses.at(-1)?.cause || 'none',
    firstTakeoff, firstLanding, ...stats };
}

const sourceUrl = new URL('../../src/simulation/offroad/dirt-bike-vehicle.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const Trial = await counterfactual(source, sourceUrl);
const definitions = [MX_250, MX_450];
const variants = [['production', DirtBikeVehicle], ['torque-only counterfactual', Trial]] as const;
const output = {
  adapterSha256: createHash('sha256').update(source).digest('hex'),
  note: 'Offset/omission-work metrics use the omitted port evaluated along each trajectory; they are only actual equation residuals for production. The trial restores that port but changes no calibration, assists or static initialization.',
  virtualWork: definitions.map(perturbation),
  balanceDiagnostics: definitions.map(balanceDiagnostics),
  staticGrades: definitions.flatMap(definition => [-0.3, -0.12, 0, 0.12, 0.3]
    .map(grade => equilibrium(definition, grade))),
  wheelies: variants.flatMap(([variant, C]) => definitions.flatMap(definition => [240, 480]
    .map(hz => ({ variant, ...wheelie(C, definition, hz) })))),
  jumps: variants.flatMap(([variant, C]) => definitions.flatMap(definition =>
    (['valley-ridge-mx', 'arena-nord-sx'] as const).flatMap(venue => [false, true]
      .map(ai => ({ variant, ...jump(C, definition, venue, ai) }))))),
};
console.log(JSON.stringify(output, (_key, value) =>
  typeof value === 'number' ? Number(value.toFixed(9)) : value, 2));
