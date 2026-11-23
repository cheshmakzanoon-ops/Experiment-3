import { expect, it } from 'vitest';
import { BikeVehicle, gpRiderTuck, writeBikeBlock } from '../src/simulation/bike-vehicle.ts';
import { bikeSlipstreamDragScale } from '../src/simulation/bike-slipstream.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { B, BIKE_STRIDE } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const dt = 1 / 240;
class TestBike extends BikeVehicle {
  driveTick(throttle: number) { return this.drive(dt, throttle); }
}

it.each(['gpr1','gpr2'])('%s manual clutch free-revs, slips under bounded torque, and opens independently of the rear pedal', id=>{
  const bike=new TestBike(0,'medium',DEFAULT_SETUP,'sport',VEHICLES[id]);
  const track=new Track('clear');bike.place(track,120,0);
  const {capacity}=bike.bikeSpec.manualClutch!, gp=bike.dynamics.motoGP!;
  bike.autoShift=false;bike.input.manualClutch=true;bike.input.clutch=1;
  for(let i=0;i<360;i++)expect(bike.driveTick(.82)).toBe(0);
  expect(bike.rpm).toBeGreaterThan(10000);
  expect(bike.clutch.engagement).toBe(0);
  expect(gp.rearOmega).toBe(0);
  bike.input.clutch=.72;
  expect(bike.driveTick(.82)).toBeGreaterThan(0);
  expect(bike.clutch.transmittedTorque).toBeCloseTo(capacity*.28,7);
  expect(bike.clutch.slipPower).toBeGreaterThan(0);
  bike.input.clutch=1;bike.input.rearBrake=.44;
  bike.step(dt,track);
  expect(bike.rearBrake).toBeCloseTo(.44,7);
  expect(bike.clutch.transmittedTorque).toBe(0);
  bike.input.rearBrake=0;bike.step(dt,track);
  expect(bike.rearBrake).toBe(0);
  bike.input.manualClutch=false;bike.input.clutch=.63;bike.step(dt,track);
  expect(bike.rearBrake).toBeCloseTo(.63,7);
  expect(bike.clutch.slipPower).toBe(0);
});

it('blends rider crouch through the old thresholds and stays low through a fast corner', () => {
  expect(gpRiderTuck(55, 0, 1, 0)).toBe(1);
  expect(gpRiderTuck(0, 0, 1, 0)).toBe(0);
  expect(gpRiderTuck(55, 0.8, 1, 0)).toBeGreaterThan(0.55);
  expect(gpRiderTuck(55, -0.8, 1, 0)).toBe(gpRiderTuck(55, 0.8, 1, 0));
  expect(gpRiderTuck(55, 0.8, 0, 0.7)).toBe(0);
  const centre = gpRiderTuck(25, 0.2, 0.6, 0.05);
  expect(centre).toBeGreaterThan(0.4);
  for (const sign of [-1, 1])
    expect(Math.abs(gpRiderTuck(25 + sign * 0.05, 0.2 + sign * 0.001,
      0.6 + sign * 0.002, 0.05 + sign * 0.001) - centre)).toBeLessThan(0.01);
});

it.each(['gpr1', 'gpr2'])('%s moves the hips independently while crouched and publishes the same aero pose', (id) => {
  const track = new Track(), bike = new TestBike(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
  bike.place(track, 120);
  bike.dynamics.speed = 43;
  bike.input.throttle = 0.8;
  bike.input.steer = 0.65;
  bike.tuck = 1;
  for (let i = 0; i < 18; i++) bike.step(dt, track);
  expect(bike.tuck).toBeGreaterThan(0.86);
  expect(bike.dynamics.riderOffset).toBeGreaterThan(0.037);
  const snapshot = new Float32Array(BIKE_STRIDE);
  writeBikeBlock(snapshot, 0, bike);
  expect(snapshot[B.TUCK]).toBeCloseTo(bike.tuck, 6);
  expect(snapshot[B.RIDER_OFFSET]).toBeCloseTo(bike.dynamics.riderOffset, 6);
  expect(bike.dynamics.dragScale).toBe(bikeSlipstreamDragScale(bike.tuck, bike.bikeSpec.tuckDrag, bike.slipstream));
  bike.input.throttle = 0;
  bike.input.brake = 1;
  for (let i = 0; i < 95; i++) bike.step(dt, track);
  expect(bike.tuck).toBe(0);
});

it.each(['gpr1', 'gpr2'])('%s couples RPM to rear wheel rotation and guards downshifts on regrip', (id) => {
  const bike = new TestBike(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
  const gp = bike.dynamics.motoGP!, spec = bike.spec;
  bike.dynamics.speed = 44;
  gp.reset(44);
  bike.gear = 4;
  bike.autoShift = false;
  const ratio = spec.gearRatios[5] * spec.finalDrive * bike.gearing;
  const rolling = gp.rearOmega;
  gp.rearOmega = rolling * 1.16;
  for (let i = 0; i < 120; i++) bike.driveTick(0.65);
  expect(bike.rpm).toBeCloseTo(gp.rearOmega * ratio * 30 / Math.PI, 7);
  gp.rearOmega = rolling * 0.82;
  for (let i = 0; i < 120; i++) bike.driveTick(0.65);
  expect(bike.rpm).toBeCloseTo(gp.rearOmega * ratio * 30 / Math.PI, 7);

  bike.dynamics.speed = 95;
  expect(gp.drivenOmegaAt(95)).toBeCloseTo(95 / gp.geometry.rearRadius);
  gp.reset(95);
  gp.rearOmega = 0;
  bike.gear = 3;
  bike.shift(-1);
  expect(bike.gear).toBe(3);
  gp.rearOmega = 390;
  bike.shift(1);
  expect(bike.gear).toBe(4);
  // An unloaded rear can rev against the limiter, even with auto enabled,
  // without cycling through all gears at a low road speed.
  bike.shiftClock = 0;
  bike.autoShift = true;
  bike.dynamics.speed = 24;
  gp.reset(24);
  gp.rearOmega = 420;
  for (let i = 0; i < 160; i++) bike.driveTick(1);
  expect(bike.gear).toBe(4);
  expect(bike.rpm).toBeGreaterThan(spec.limiterRPM);
  expect(bike.engineOutputTorque).toBe(0);
});
