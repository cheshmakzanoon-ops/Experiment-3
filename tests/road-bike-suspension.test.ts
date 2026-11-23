import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G, Vec3 } from '../src/core/math.ts';
import { GP_R1, GP_R2, SS_600 } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { COMPOUNDS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MotoGPChassis, gpHangOffAngle } from '../src/simulation/motogp-physics.ts';
import type { SurfaceSample, TrackPoint } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;
type Profile = (z: number) => { height: number; slope: number };
const flat: Profile = () => ({ height: 0, slope: 0 });
const crest: Profile = (z) => {
  const height = 2 * Math.exp(-((z / 10) ** 2));
  return { height, slope: (-2 * z * height) / 100 };
};

/** The production adapter runs unmodified. Only the sampled road geometry
 * is analytic, so launch support and ballistic acceleration have an
 * independent physical expectation rather than a screenshot tolerance. */
class ProfileTrack extends DynamicsTrack {
  constructor(readonly profile: Profile) {
    super();
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    const p = this.profile(z);
    out.height = p.height;
    out.normal.set(0, 1, -p.slope).normalize();
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    // The road adapter casts vertically; the analytic collision and sampled
    // height are the same profile, including the one-metre discontinuity.
    if (down.x !== 0 || down.z !== 0 || down.y >= 0) return Infinity;
    const distance = (this.profile(origin.z).height - origin.y) / down.y;
    if (distance < 0 || distance > maximum) return Infinity;
    this.sample(origin.x, origin.z, out);
    return distance;
  }
  override nearest(x: number, z: number, out: TrackPoint) {
    const lateral = super.nearest(x, z, out);
    out.y = this.profile(z).height;
    return lateral;
  }
}

function machine(definition: VehicleDefinition, track: ProfileTrack, speed = 0, z = 0) {
  const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
  bike.placeFree(track, 0, z, 0, track.profile(z).height);
  bike.dynamics.speed = speed;
  for (const tyre of bike.tires)
    tyre.carcassTemp = tyre.surfaceTemp = COMPOUNDS[tyre.compound].ideal;
  return bike;
}

describe('production road/GP sprung chassis and unilateral contacts', () => {
  it.each([GP_R1, GP_R2])('$id carries fairing damage into both axles and recovers through pit repair', (definition) => {
    const track = new ProfileTrack(flat);
    const reference = machine(definition, track, 55);
    const damaged = machine(definition, track, 55);
    const point = new Vec3(0, 0.3, 0.6);
    // Repeated light contact scuffs the fairing without triggering a rider fall.
    for (let i = 0; i < 40; i++) damaged.impactAt(2000, point);
    reference.wake = damaged.wake = 0.5;
    for (let i = 0; i < 120; i++) {
      reference.step(DT, track);
      damaged.step(DT, track);
    }
    expect(damaged.riding).toBe(true);
    expect(damaged.frontHealth).toBeCloseTo(0.8, 10);
    const coefficient = definition.bike!.downforce;
    const force = coefficient * 0.85 * 0.89 * damaged.speed ** 2;
    expect(damaged.aero.front).toBeCloseTo(force * definition.bike!.downforceFront, 8);
    expect(damaged.aero.rear).toBeCloseTo(force * (1 - definition.bike!.downforceFront), 8);
    expect(damaged.roadSuspension.frontCompression).toBeLessThan(reference.roadSuspension.frontCompression);
    expect(damaged.roadSuspension.rearCompression).toBeLessThan(reference.roadSuspension.rearCompression);
    damaged.repairFrontWing(1);
    damaged.step(DT, track);
    expect(damaged.dynamics.p.downforce).toBe(reference.dynamics.p.downforce);
    damaged.wake = 0;
    damaged.floorHealth = 0.5;
    damaged.step(DT, track);
    expect(damaged.dynamics.p.downforce).toBeCloseTo(coefficient * 0.725, 10);
  });

  it.each([GP_R1, GP_R2])('$id loads both axles with the wing force reported in and out of a wake', (definition) => {
    const track = new ProfileTrack(flat);
    const clean = machine(definition, track, 55);
    const following = machine(definition, track, 55);
    following.wake = 1;
    for (let step = 0; step < 120; step++) {
      clean.step(DT, track);
      following.step(DT, track);
    }
    const coefficient = definition.bike!.downforce;
    expect(clean.dynamics.p.downforce).toBe(coefficient);
    expect(following.dynamics.p.downforce).toBeCloseTo(0.7 * coefficient, 10);
    expect(following.aero.front + following.aero.rear)
      .toBeCloseTo(0.7 * coefficient * following.speed ** 2, 8);
    expect(following.roadSuspension.frontCompression).toBeLessThan(clean.roadSuspension.frontCompression);
    expect(following.roadSuspension.rearCompression).toBeLessThan(clean.roadSuspension.rearCompression);
    following.wake = 0;
    following.step(DT, track);
    expect(following.dynamics.p.downforce).toBe(coefficient);
  });

  it.each([GP_R1, GP_R2, SS_600])(
    '$id settles at static sag with weight supported once',
    (definition) => {
      const track = new ProfileTrack(flat),
        bike = machine(definition, track);
      for (let i = 0; i < 1200; i++) bike.step(DT, track);
      const d = bike.dynamics;
      expect(bike.riding).toBe(true);
      expect(bike.body.position.y).toBeCloseTo(bike.bikeSpec.cgHeight, 5);
      expect(Math.abs(bike.body.velocity.y)).toBeLessThan(1e-6);
      expect(d.frontLoad + d.rearLoad).toBeCloseTo(d.mass * G, 3);
      expect(bike.fork).toBeCloseTo(d.frontLoad / bike.bikeSpec.forkRate, 6);
      expect(bike.shock).toBeCloseTo(d.rearLoad / bike.bikeSpec.shockRate, 6);
      expect(bike.roadSuspension.airborne).toBe(false);
      expect(bike.gVert).toBeCloseTo(1, 6);
    },
  );

  it.each([GP_R1, GP_R2, SS_600])(
    '$id leaves a fast crest, has no airborne tyre force, and lands',
    (definition) => {
      const track = new ProfileTrack(crest),
        bike = machine(definition, track, 30, -22);
      bike.input.throttle = 0.18;
      let flightFrames = 0,
        clearance = 0,
        landingLoad = 0,
        previousVelocity = 0;
      for (let i = 0; i < 900; i++) {
        previousVelocity = bike.body.velocity.y;
        bike.step(DT, track);
        const d = bike.dynamics,
          freefall = G + (bike.bikeSpec.downforce * d.speed * d.speed) / d.mass;
        expect(bike.riding).toBe(true);
        // Neither a tyre nor a damper can pull the motorcycle down through a
        // crest faster than gravity plus its authored aerodynamic downforce.
        if (i > 0)
          expect((bike.body.velocity.y - previousVelocity) / DT).toBeGreaterThan(-freefall - 0.02);
        if (bike.roadSuspension.airborne) {
          flightFrames++;
          expect(d.frontLoad + d.rearLoad).toBe(0);
          expect(d.driveForce + d.frontBrakeForce + d.rearBrakeForce).toBe(0);
          expect(bike.tires[0].load + bike.tires[2].load).toBe(0);
          expect(bike.gVert).toBe(0);
          if (d.motoGP) expect(Math.abs(d.motoGP.frontFy) + Math.abs(d.motoGP.rearFy)).toBe(0);
          clearance = Math.max(
            clearance,
            bike.body.position.y - track.profile(d.z).height - bike.bikeSpec.cgHeight,
          );
        } else if (flightFrames) landingLoad = Math.max(landingLoad, d.frontLoad + d.rearLoad);
      }
      expect(flightFrames).toBeGreaterThan(30);
      expect(clearance).toBeGreaterThan(0.25);
      expect(landingLoad).toBeGreaterThan(1.2 * bike.dynamics.mass * G);
      expect(bike.roadSuspension.airborne).toBe(false);
      expect(Math.abs(bike.body.velocity.y)).toBeLessThan(0.1);
      expect(Math.abs(bike.body.position.y - bike.bikeSpec.cgHeight)).toBeLessThan(0.025);
    },
  );

  it.each([GP_R1, SS_600])(
    '$id falls from a one-metre road drop and absorbs the landing within suspension travel',
    (definition) => {
      const track = new ProfileTrack((z) => ({ height: z < 0 ? 1 : 0, slope: 0 })),
        bike = machine(definition, track, 20, -4);
      let flightFrames = 0,
        landed = false,
        minHeight = Infinity;
      for (let i = 0; i < 600; i++) {
        bike.step(DT, track);
        expect(bike.riding).toBe(true);
        if (bike.roadSuspension.airborne) flightFrames++;
        else if (flightFrames) landed = true;
        if (bike.dynamics.z > 2) minHeight = Math.min(minHeight, bike.body.position.y);
        expect(bike.fork).toBeGreaterThanOrEqual(0);
        expect(bike.fork).toBeLessThanOrEqual(bike.bikeSpec.forkTravel);
        expect(bike.shock).toBeGreaterThanOrEqual(0);
        expect(bike.shock).toBeLessThanOrEqual(bike.bikeSpec.shockTravel);
      }
      expect(flightFrames).toBeGreaterThan(40);
      expect(landed).toBe(true);
      expect(minHeight).toBeGreaterThan(0.4);
      expect(bike.body.position.y).toBeCloseTo(bike.bikeSpec.cgHeight, 2);
      expect(Math.abs(bike.body.velocity.y)).toBeLessThan(0.05);
    },
  );

  it('preserves world horizontal momentum during yawing flight, apart from aerodynamic drag', () => {
    const track = new ProfileTrack(crest),
      bike = machine(GP_R1, track, 30, -22),
      d = bike.dynamics;
    for (
      let i = 0;
      i < 400 && Math.min(bike.roadSuspension.frontGap, bike.roadSuspension.rearGap) < 0.3;
      i++
    )
      bike.step(DT, track);
    expect(bike.roadSuspension.airborne).toBe(true);
    const gp = d.motoGP!;
    gp.yawRate = 0.6;
    gp.lateralSpeed = 3;
    d.leanRate = 0.2;
    for (let i = 0; i < 12; i++) {
      const heading = d.heading,
        speed = d.speed,
        side = gp.lateralSpeed,
        combinedLean = d.lean + gpHangOffAngle(d.riderOffset, d.p.cgHeight);
      bike.step(DT, track);
      expect(bike.roadSuspension.airborne).toBe(true);
      expect(gp.yawRate).toBe(0.6);
      expect(d.leanRate).toBe(0.2);
      expect(d.lean + gpHangOffAngle(d.riderOffset, d.p.cgHeight)).toBeCloseTo(
        combinedLean + 0.2 * DT,
        12,
      );
      expect(d.driveForce + d.frontBrakeForce + d.rearBrakeForce).toBe(0);
      // The rider retucks at the start of the integration tick. Evaluate the
      // drag actually applied over this interval, using its initial velocity.
      const drag = ((d.p.drag * d.dragScale * speed * speed) / d.mass) * DT;
      const expectedX = Math.sin(heading) * (speed - drag) + Math.cos(heading) * side;
      const expectedZ = Math.cos(heading) * (speed - drag) - Math.sin(heading) * side;
      expect(bike.body.velocity.x).toBeCloseTo(expectedX, 9);
      expect(bike.body.velocity.z).toBeCloseTo(expectedZ, 9);
      expect(Math.hypot(bike.body.velocity.x, bike.body.velocity.z)).toBeCloseTo(
        Math.hypot(speed - drag, side),
        9,
      );
    }
  });

  it.each([GP_R1, GP_R2])('$id transports airborne side and yaw impulses without curving the flight path', definition => {
    const track = new ProfileTrack(crest), bike = machine(definition, track, 30, -22);
    const d = bike.dynamics, gp = d.motoGP!;
    for (let i = 0; i < 400 && Math.min(bike.roadSuspension.frontGap, bike.roadSuspension.rearGap) < .30; i++)
      bike.step(DT, track);
    expect(bike.roadSuspension.airborne).toBe(true);
    gp.yawRate = .75;
    bike.body.velocity.x += 2.8 * Math.cos(d.heading);
    bike.body.velocity.z -= 2.8 * Math.sin(d.heading);
    bike.body.omega.y += .68;
    const initialHeading = d.heading, initialX = d.x, initialZ = d.z;
    let travelledX = 0, travelledZ = 0;
    for (let i=0; i<12; i++) {
      const vx=bike.body.velocity.x, vz=bike.body.velocity.z, speed=d.speed, heading=d.heading;
      bike.step(DT,track);
      expect(bike.roadSuspension.airborne).toBe(true);
      const drag=d.p.drag*d.dragScale*speed*speed/d.mass*DT;
      const expectedX=vx-drag*Math.sin(heading), expectedZ=vz-drag*Math.cos(heading);
      expect(bike.body.velocity.x).toBeCloseTo(expectedX,8);
      expect(bike.body.velocity.z).toBeCloseTo(expectedZ,8);
      travelledX+=expectedX*DT; travelledZ+=expectedZ*DT;
    }
    expect(d.heading-initialHeading).toBeGreaterThan(12 * DT * gp.yawRate + .02);
    expect(d.x-initialX).toBeCloseTo(travelledX,5);
    expect(d.z-initialZ).toBeCloseTo(travelledZ,5);
  });
  it('continues rear-supported yaw without any front road-steering force', () => {
    const track = new ProfileTrack(flat),
      bike = machine(GP_R1, track),
      geometry = bike.dynamics.motoGP!.geometry;
    const runs = [-0.3, 0.3].map((steer) => {
      const gp = new MotoGPChassis(geometry);
      gp.reset(30);
      gp.yawRate = 0.3;
      gp.lateralSpeed = 0.5;
      gp.frontOmega = 150;
      gp.step({
        dt: DT,
        speed: 30,
        mass: 245,
        lean: 0.25,
        steer,
        frontLoad: 0,
        rearLoad: 1800,
        frontMu: 1.7,
        rearMu: 1.7,
        frontFx: 0,
        rearFx: 0,
        frontContact: 0,
        frontBrakeExcess: 0,
        rearDriveExcess: 0,
        rearBrakeExcess: 0,
        inertialContacts: true,
      });
      expect(gp.frontFy).toBe(0);
      expect(gp.frontStiffness).toBe(0);
      expect(Math.abs(gp.rearFy)).toBeGreaterThan(10);
      expect(gp.yawRate).toBeCloseTo(
        0.3 - ((geometry.rearArm * gp.rearFy) / geometry.yawInertia) * DT,
        12,
      );
      const sideAfterForce = 0.5 + (gp.rearFy / 245) * DT,
        turn = gp.yawRate * DT;
      expect(gp.lateralSpeed).toBeCloseTo(
        sideAfterForce * Math.cos(turn) - 30 * Math.sin(turn),
        12,
      );
      expect(gp.forwardSpeed).toBeCloseTo(
        30 * Math.cos(turn) + sideAfterForce * Math.sin(turn),
        12,
      );
      // The unloaded wheel is not silently synchronized to road speed.
      expect(gp.frontOmega).toBe(150);
      return gp;
    });
    expect(runs[0].yawRate).toBe(runs[1].yawRate);
    expect(runs[0].lateralSpeed).toBe(runs[1].lateralSpeed);
  });

  it('keeps crest flight and landing consistent across supported physics step sizes', () => {
    const runs = [1 / 120, 1 / 240, 1 / 480].map((dt) => {
      const track = new ProfileTrack(crest),
        bike = machine(GP_R1, track, 30, -22);
      bike.input.throttle = 0.18;
      let height = 0,
        flight = 0,
        landingZ = 0;
      for (let i = 0; i < 3.75 / dt; i++) {
        bike.step(dt, track);
        expect(bike.riding).toBe(true);
        height = Math.max(height, bike.body.position.y);
        if (bike.roadSuspension.airborne) flight += dt;
        else if (flight > 0 && !landingZ) landingZ = bike.dynamics.z;
      }
      return { height, flight, landingZ, finalHeight: bike.body.position.y };
    });
    for (const run of runs.slice(0, 2)) {
      expect(Math.abs(run.height - runs[2].height)).toBeLessThan(0.04);
      expect(Math.abs(run.flight - runs[2].flight)).toBeLessThan(0.025);
      expect(Math.abs(run.landingZ - runs[2].landingZ)).toBeLessThan(0.4);
      expect(Math.abs(run.finalHeight - runs[2].finalHeight)).toBeLessThan(0.01);
    }
  });

  it('loads the fork and unloads the shock under ordinary braking without double-counting transfer', () => {
    const track = new ProfileTrack(flat),
      bike = machine(GP_R1, track, 35);
    bike.input.throttle = 0.05;
    for (let i = 0; i < 120; i++) bike.step(DT, track);
    const frontBefore = bike.fork,
      rearBefore = bike.shock,
      speedBefore = bike.speed;
    bike.input.throttle = 0;
    bike.input.brake = 0.3;
    for (let i = 0; i < 180; i++) {
      bike.step(DT, track);
      const d = bike.dynamics;
      expect(bike.riding).toBe(true);
      expect(d.frontBrakeForce).toBeLessThanOrEqual(
        d.p.mu * (d.frontGrip ?? d.grip) * d.frontLoad + 1e-6,
      );
      expect(d.rearBrakeForce).toBeLessThanOrEqual(
        d.p.mu * (d.rearGrip ?? d.grip) * d.rearLoad + 1e-6,
      );
      expect(d.frontLoad).toBe(bike.roadSuspension.frontLoad);
      expect(d.rearLoad).toBe(bike.roadSuspension.rearLoad);
    }
    expect(bike.speed).toBeLessThan(speedBefore - 3);
    expect(bike.fork).toBeGreaterThan(frontBefore + 0.01);
    expect(bike.shock).toBeLessThan(rearBefore - 0.008);
    expect(bike.dynamics.frontLoad).toBeGreaterThan(1.5 * bike.dynamics.rearLoad);
    expect(bike.body.position.y).toBeGreaterThan(0.5);
  });

  it('resets flight on explicit placement instead of carrying an old landing impulse', () => {
    const track = new ProfileTrack(crest),
      bike = machine(GP_R1, track, 30, -22);
    for (let i = 0; i < 400 && !bike.roadSuspension.airborne; i++) bike.step(DT, track);
    expect(bike.roadSuspension.airborne).toBe(true);
    const runway = new ProfileTrack(flat);
    bike.placeFree(runway, 0, 0, 0, 0);
    bike.step(DT, runway);
    expect(bike.roadSuspension.airborne).toBe(false);
    expect(Math.abs(bike.body.velocity.y)).toBeLessThan(0.001);
    expect(bike.body.position.y).toBeCloseTo(bike.bikeSpec.cgHeight, 4);
  });
});
