import { describe, expect, it } from 'vitest';
import { COMPOUNDS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { peakGrip } from '../src/simulation/tire.ts';
import { Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** The production creek-bottom soil cells provide all four combinations:
 * dry/dry, mud/dry at entry, mud/mud, then dry/mud at exit. Only placement,
 * initial speed and rider controls change; no contact sample is invented. */
function creekBike(definition: VehicleDefinition, station: 'dry' | 'entry' | 'mud' | 'exit') {
  const track = rigTrack('valley-ridge-mx'),
    creek = offroadCourse(track.circuit)!.spec.zones.find((zone) => zone.soil === 'mud')!,
    s = { dry: creek.from - 2, entry: creek.from, mud: creek.from + 2, exit: creek.to }[station],
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
  bike.place(track, s);
  bike.dynamics.speed = 12;
  bike.gear = 3;
  bike.autoShift = false;
  bike.rpm =
    ((bike.dynamics.speed / definition.spec.wheelRadius) *
      definition.spec.gearRatios[bike.gear + 1] *
      definition.spec.finalDrive *
      30) /
    Math.PI;
  return { bike, track, creek };
}

function contactStep(
  definition: VehicleDefinition,
  station: Parameters<typeof creekBike>[1],
  pedal: 'throttle' | 'brake',
) {
  const { bike, track } = creekBike(definition, station),
    surfaces = [bike.contacts[0].surface, bike.contacts[2].surface],
    frontLoad = bike.forceFront,
    rearLoad = bike.forceRear,
    frontGrip = peakGrip(bike.tires[0], 2200, bike.contacts[0], 20) / COMPOUNDS.medium.mu,
    rearGrip = peakGrip(bike.tires[2], 2200, bike.contacts[2], 20) / COMPOUNDS.medium.mu;
  bike.input[pedal] = 1;
  bike.step(DT, track);
  const d = bike.dynamics;
  // From static sag, zero steer and identical contact support, these are
  // the production tyre model's own material/temperature/wear coefficients.
  expect(d.frontGrip).toBeCloseTo(frontGrip, 12);
  expect(d.rearGrip).toBeCloseTo(rearGrip, 12);
  expect(d.frontBrakeForce).toBeLessThanOrEqual(d.p.mu * frontGrip * frontLoad + 1e-8);
  expect(Math.abs(d.driveForce - d.rearBrakeForce)).toBeLessThanOrEqual(
    d.p.mu * rearGrip * rearLoad + 1e-8,
  );
  expect(bike.riding && !bike.airborne).toBe(true);
  expect(bike.dynamics.crashes).toBe(0);
  return { bike, surfaces };
}

describe('motocross independently sampled tyre grip', () => {
  it.each([MX_250, MX_450])(
    '$id keeps dry-rear drive while the front enters the real creek mud',
    (definition) => {
      const dry = contactStep(definition, 'dry', 'throttle'),
        frontMud = contactStep(definition, 'entry', 'throttle'),
        bothMud = contactStep(definition, 'mud', 'throttle'),
        rearMud = contactStep(definition, 'exit', 'throttle');
      expect(frontMud.surfaces).toEqual([MATERIAL.MUD, MATERIAL.DIRT]);
      expect(rearMud.surfaces).toEqual([MATERIAL.DIRT, MATERIAL.MUD]);
      expect(frontMud.bike.dynamics.driveForce).toBe(dry.bike.dynamics.driveForce);
      expect(frontMud.bike.dynamics.driveForce).toBeGreaterThan(
        bothMud.bike.dynamics.driveForce + 40,
      );
      expect(rearMud.bike.dynamics.driveForce).toBe(bothMud.bike.dynamics.driveForce);
      expect(frontMud.bike.tires[2].fx).toBe(frontMud.bike.dynamics.driveForce);
      expect(frontMud.bike.dynamics.rearSlip).toBe(0);
    },
  );

  it.each([MX_250, MX_450])(
    '$id recovers dry-front braking while the rear is still crossing mud',
    (definition) => {
      const dry = contactStep(definition, 'dry', 'brake'),
        frontMud = contactStep(definition, 'entry', 'brake'),
        bothMud = contactStep(definition, 'mud', 'brake'),
        rearMud = contactStep(definition, 'exit', 'brake');
      expect(rearMud.bike.dynamics.frontBrakeForce).toBe(dry.bike.dynamics.frontBrakeForce);
      expect(rearMud.bike.dynamics.frontBrakeForce).toBeGreaterThan(
        bothMud.bike.dynamics.frontBrakeForce + 40,
      );
      expect(frontMud.bike.dynamics.frontBrakeForce).toBe(bothMud.bike.dynamics.frontBrakeForce);
      // The stronger front brake unloads the muddy rear; its ABS cannot
      // claim the front's clean grip or preserve the previous pedal force.
      expect(rearMud.bike.dynamics.rearBrakeForce).toBeLessThan(
        frontMud.bike.dynamics.rearBrakeForce,
      );
      expect(rearMud.bike.dynamics.rearUse).toBeLessThanOrEqual(0.951);
    },
  );

  it('changes each contact at real soil entry and exit while the lean intent settles continuously', () => {
    const { bike, track, creek } = creekBike(MX_450, 'dry'),
      terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
      soil = terrain.soil.slice(),
      moisture = terrain.baseMoisture.slice(),
      terrainHash = terrain.hash();
    let frontEntry = false,
      rearEntry = false,
      frontExit = false,
      rearExit = false;
    for (let i = 0; i < 4 / DT && bike.s < creek.to + 3; i++) {
      rideLine(bike, track, 12);
      const front = bike.contacts[0].surface,
        rear = bike.contacts[2].surface,
        previousLeanBudget = bike.dynamics.grip,
        frontRaw = peakGrip(bike.tires[0], 2200, bike.contacts[0], 20) / COMPOUNDS.medium.mu,
        rearRaw = peakGrip(bike.tires[2], 2200, bike.contacts[2], 20) / COMPOUNDS.medium.mu,
        frontLoad = bike.forceFront,
        rearLoad = bike.forceRear;
      bike.step(DT, track);
      const d = bike.dynamics,
        target = Math.min(d.frontGrip!, d.rearGrip!);
      expect(d.frontGrip! / d.rearGrip!).toBeCloseTo(frontRaw / rearRaw, 12);
      if (i > 0)
        expect(d.grip).toBeCloseTo(
          previousLeanBudget + (target - previousLeanBudget) * (DT / 0.35),
          12,
        );
      expect(d.frontBrakeForce).toBeLessThanOrEqual(d.p.mu * d.frontGrip! * frontLoad + 1e-8);
      expect(Math.abs(d.driveForce - d.rearBrakeForce)).toBeLessThanOrEqual(
        d.p.mu * d.rearGrip! * rearLoad + 1e-8,
      );
      if (!frontEntry && front === MATERIAL.MUD && rear === MATERIAL.DIRT) {
        // Grip loss is effective now, even though the old lean target still
        // needs time to settle. The rear retains its sampled clean contact.
        expect(d.grip).toBeGreaterThan(d.frontGrip! + 0.005);
        expect(d.rearGrip).toBeGreaterThan(d.frontGrip! + 0.04);
        frontEntry = true;
      }
      if (frontEntry && front === MATERIAL.MUD && rear === MATERIAL.MUD) rearEntry = true;
      if (rearEntry && front === MATERIAL.DIRT && rear === MATERIAL.MUD) {
        expect(d.frontGrip).toBeGreaterThan(d.rearGrip! + 0.04);
        frontExit = true;
      }
      if (frontExit && front === MATERIAL.DIRT && rear === MATERIAL.DIRT) rearExit = true;
      expect(bike.riding && !bike.airborne).toBe(true);
    }
    expect([frontEntry, rearEntry, frontExit, rearExit]).toEqual([true, true, true, true]);
    // Reading each patch changes neither the authoritative soil assignment
    // nor its moisture/deformation state; the normal terrain owner still
    // applies wheel work in full sessions.
    expect(terrain.soil).toEqual(soil);
    expect(terrain.baseMoisture).toEqual(moisture);
    expect(terrain.hash()).toBe(terrainHash);
  });

  it('clears the player contact map on AI handover and leaves supermoto on shared grip', () => {
    const { bike, track } = creekBike(MX_450, 'entry');
    bike.step(DT, track);
    expect(bike.dynamics.frontGrip).toBeLessThan(bike.dynamics.rearGrip!);
    bike.aiControlled(1e6);
    bike.step(DT, track);
    expect(bike.dynamics.frontGrip).toBeUndefined();
    expect(bike.dynamics.rearGrip).toBeUndefined();
    bike.aiControlled(0);
    bike.step(DT, track);
    expect(bike.dynamics.frontGrip).toBeLessThan(bike.dynamics.rearGrip!);

    const supermoto = creekBike(SM_450, 'entry');
    supermoto.bike.step(DT, supermoto.track);
    expect(supermoto.bike.dynamics.frontGrip).toBeUndefined();
    expect(supermoto.bike.dynamics.rearGrip).toBeUndefined();
  });
});
