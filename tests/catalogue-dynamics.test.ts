import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { catalogueHardwareFamily } from '../src/simulation/catalogue-dynamics.ts';
import { LEGACY_ENGINE, LEGACY_GEARBOX } from '../src/simulation/powertrain.ts';
import { defaultSuspension } from '../src/simulation/suspension.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { legacyDynamics, vehicleDynamics } from '../src/simulation/vehicle-dynamics.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** The complete production vehicle on an analytic runway. Opening the clutch
 * isolates suspension/shift response from automatic launch or shift decisions. */
function placed(def: VehicleDefinition) {
  const track = new DynamicsTrack();
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
  car.place(track, 0);
  car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(DT, track);
  car.input.brake = 0;
  car.autoShift = false;
  car.input.manualClutch = true;
  car.input.clutch = 1;
  return { car, track };
}

function brakeResponse(def: VehicleDefinition) {
  const { car, track } = placed(def);
  car.body.velocity.set(0, 0, 100 / 3.6);
  for (const tyre of car.tires) tyre.omega = 100 / 3.6 / tyre.radius;
  const startCamber = car.wheelCamber[0];
  car.input.brake = 0.8;
  let peakPitch = 0;
  const forward = new Vec3();
  for (let i = 0; i < 96; i++) {
    car.step(DT, track);
    car.body.orientation.rotate(forward.set(0, 0, 1), forward);
    peakPitch = Math.max(peakPitch, -Math.atan2(forward.y, Math.hypot(forward.x, forward.z)));
    expect(Array.from(car.normalLoads).every((load) => Number.isFinite(load) && load >= 0)).toBe(
      true,
    );
  }
  return {
    peakPitch,
    camberChange: car.wheelCamber[0] - startCamber,
    frontRide: car.frontRideHeight,
    speed: car.speed,
    totalLoad: car.normalLoads.reduce((sum, force) => sum + force, 0),
  };
}

describe('authored catalogue hardware in the production vehicle', () => {
  it.each(['rh3', 'gt8f', 'fx26', 'rp6'])(
    '%s routes braking transfer through links and springs without adding grip',
    (id) => {
      const def = VEHICLES[id],
        suspension = vehicleDynamics(def).suspension;
      // Same car, tyres, mass, torque map and dynamic camber. Removing only
      // anti geometry provides an independent elastic-transfer comparison.
      const elastic: VehicleDefinition = {
        ...def,
        dynamics: {
          ...def.dynamics,
          suspension: {
            front: { ...suspension.front, antiBrake: 0, antiDrive: 0 },
            rear: { ...suspension.rear, antiBrake: 0, antiDrive: 0 },
          },
        },
      };
      const linked = brakeResponse(def),
        baseline = brakeResponse(elastic);
      expect(linked.peakPitch).toBeGreaterThan(0);
      expect(linked.peakPitch).toBeLessThan(baseline.peakPitch);
      expect(linked.frontRide).toBeGreaterThan(baseline.frontRide);
      expect(linked.camberChange).toBeGreaterThan(0);
      // A link path changes dive, not the tire's available friction or weight.
      expect(Math.abs(linked.speed - baseline.speed)).toBeLessThan(0.02);
      expect(Math.abs(linked.totalLoad / baseline.totalLoad - 1)).toBeLessThan(0.01);
    },
  );

  it('retains finite, differentiated intake response and actual torque-cut duration', () => {
    const observations: Record<string, { intake: number; torque: number; shifting: boolean }> = {};
    for (const id of ['rh3', 'gt8f', 'fx26', 'sk125', 'eh3']) {
      const { car, track } = placed(VEHICLES[id]);
      car.input.throttle = 1;
      for (let i = 0; i < 12; i++) car.step(DT, track);
      const intake = car.engine.throttle;
      expect(intake, id).toBeGreaterThan(0);
      expect(intake, id).toBeLessThan(1);
      car.shift(1);
      for (let i = 0; i < 26; i++) car.step(DT, track);
      observations[id] = { intake, torque: car.engineOutputTorque, shifting: car.shiftClock > 0 };
    }
    expect(observations.rh3.intake).toBeLessThan(observations.gt8f.intake);
    expect(observations.gt8f.intake).toBeLessThan(observations.fx26.intake);
    expect(observations.fx26.intake).toBeLessThan(observations.eh3.intake);
    expect(observations.rh3.shifting).toBe(true);
    expect(observations.rh3.torque).toBe(0);
    for (const id of ['gt8f', 'fx26', 'sk125', 'eh3']) {
      expect(observations[id].shifting, id).toBe(false);
      expect(observations[id].torque, id).toBeGreaterThan(0);
    }
  });

  it('keeps kart geometry rigid, single-ratio drives uninterrupted, and anti-drive on driven axles', () => {
    for (const id of ['sk125', 'dk100']) {
      const { suspension } = vehicleDynamics(VEHICLES[id]);
      for (const axle of [suspension.front, suspension.rear]) {
        expect(axle.camberGain).toBe(0);
        expect(axle.rollCentreHeight).toBe(0);
        expect(axle.antiBrake).toBe(0);
        expect(axle.antiDrive).toBe(0);
      }
    }
    for (const id of ['eh3', 'xe1', 'xh3', 'rxe', 'dk100'])
      expect(vehicleDynamics(VEHICLES[id]).gearbox).toEqual({ shiftTime: 0, shiftCut: 0 });
    const front = vehicleDynamics(VEHICLES.rh3).suspension,
      rear = vehicleDynamics(VEHICLES.gt8f).suspension,
      all = vehicleDynamics(VEHICLES.rs5).suspension;
    expect(front.front.antiDrive).toBeGreaterThan(0);
    expect(front.rear.antiDrive).toBe(0);
    expect(rear.front.antiDrive).toBe(0);
    expect(rear.rear.antiDrive).toBeGreaterThan(0);
    expect(all.front.antiDrive).toBeGreaterThan(0);
    expect(all.rear.antiDrive).toBeGreaterThan(0);
  });

  it('preserves explicit hardware, turbo, driveline, bike and legacy-reference contracts', () => {
    const engine = { ...LEGACY_ENGINE, throttleRise: 0.123 },
      gearbox = { shiftTime: 0.31, shiftCut: 0.8 },
      suspension = defaultSuspension({ front: { camberGain: 0.123 } });
    const custom: VehicleDefinition = {
      ...VEHICLES.gt8f,
      dynamics: { engine, gearbox, suspension },
    };
    const resolved = vehicleDynamics(custom);
    expect(resolved.engine).toBe(engine);
    expect(resolved.gearbox).toBe(gearbox);
    expect(resolved.suspension).toBe(suspension);
    expect(custom.driveline).toBe(VEHICLES.gt8f.driveline);
    for (const id of ['hf86', 'pr3', 'gb4', 'rr4'])
      expect(vehicleDynamics(VEHICLES[id]).engine).toBe(VEHICLES[id].dynamics!.engine);
    for (const def of Object.values(VEHICLES).filter((entry) => entry.dynamicsKind === 'bike')) {
      const block = vehicleDynamics(def);
      expect(block.engine).toBe(def.dynamics?.engine ?? LEGACY_ENGINE);
      expect(block.gearbox).toBe(def.dynamics?.gearbox ?? LEGACY_GEARBOX);
      expect(block.suspension).toEqual(def.dynamics?.suspension ?? defaultSuspension());
    }
    expect(legacyDynamics(VEHICLES.fx26).engine).toBe(LEGACY_ENGINE);
    expect(legacyDynamics(VEHICLES.rh3).gearbox).toBe(LEGACY_GEARBOX);
    expect(legacyDynamics(VEHICLES.rh3).suspension).toEqual(defaultSuspension());
  });

  it('selects hardware for broad road/experimental entries without changing their content sheets', () => {
    expect(catalogueHardwareFamily(VEHICLES.rp6)).toBe('utility');
    expect(catalogueHardwareFamily(VEHICLES.rg63)).toBe('historicRoad');
    expect(catalogueHardwareFamily(VEHICLES.sc7)).toBe('roadSport');
    expect(catalogueHardwareFamily(VEHICLES.xe1)).toBe('singleSeater');
    expect(catalogueHardwareFamily(VEHICLES.xf2)).toBe('endurance');
    for (const def of Object.values(VEHICLES).filter(
      (entry) => entry.tireFamily && entry.dynamicsKind !== 'bike',
    )) {
      const before = JSON.stringify(def),
        dynamics = vehicleDynamics(def);
      expect(vehicleDynamics(def)).toBe(dynamics);
      expect(Object.isFrozen(dynamics)).toBe(true);
      expect(Object.isFrozen(dynamics.suspension.front)).toBe(true);
      expect(JSON.stringify(def)).toBe(before);
    }
  });
});
