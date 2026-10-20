import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { factoryBikeSag, risingRateSag } from '../src/simulation/offroad/suspension-geometry.ts';
import type { SurfaceSample } from '../src/simulation/track.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

class Grade extends DynamicsTrack {
  constructor(readonly gradient = 0) {
    super();
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = z * this.gradient;
    out.normal.set(0, 1, -this.gradient).normalize();
    return out;
  }
}

function bike(definition: VehicleDefinition, preload = 0, fuelFraction = 1) {
  const car = new DirtBikeVehicle(
    0,
    'medium',
    { ...DEFAULT_SETUP, rearPreload: preload },
    'sport',
    definition,
  );
  car.fuel = definition.bike!.fuel * fuelFraction;
  return car;
}

describe('fixed motocross suspension reference geometry', () => {
  it.each(['mx250', 'mx450', 'sm450'])(
    '%s preserves its calibrated progressive spring law and applies preload only to spring travel',
    (id) => {
      const definition = VEHICLES[id],
        b = definition.bike!,
        mass = definition.spec.dryMass + b.fuel,
        load = (mass * G * b.cgToFront) / definition.spec.wheelbase;
      for (const preload of [-0.005, 0, 0.01]) {
        const compression = risingRateSag(
            load,
            b.shockRate,
            b.shockTravel,
            b.offroad!.progression,
            preload,
          ),
          wound = compression + preload,
          springLoad =
            b.shockRate * wound * (1 + b.offroad!.progression * (wound / b.shockTravel) ** 2);
        // The existing six-iteration inverse is a calibrated approximation;
        // independently substitute into the physical spring law.
        expect(Math.abs(springLoad - load) / load).toBeLessThan(0.0002);
        expect(compression + preload).toBeCloseTo(factoryBikeSag(definition).shock, 12);
      }
    },
  );

  it.each(['mx250', 'mx450', 'sm450'])(
    '%s places both current-sag contacts on the road without moving either free-wheel reference',
    (id) => {
      const definition = VEHICLES[id],
        b = definition.bike!,
        reference = factoryBikeSag(definition),
        L = definition.spec.wheelbase;
      for (const gradient of [-0.12, 0, 0.12])
        for (const preload of [-0.005, 0, 0.01])
          for (const fuel of [1, 0.1]) {
            const car = bike(definition, preload, fuel),
              track = new Grade(gradient);
            car.fork = b.forkTravel;
            car.shock = b.shockTravel;
            car.placeFree(track, 0, 0, 0, 0);
            const sin = Math.sin(car.pitch),
              cos = Math.cos(car.pitch),
              frontFree = car.cgY + b.cgToFront * sin - (b.cgHeight + reference.fork) * cos,
              rearFree = car.cgY - b.cgToRear * sin - (b.cgHeight + reference.shock) * cos,
              mass = definition.spec.dryMass + car.fuel;
            // Geometric gaps at fixed mounts equal actual spring travel even
            // when preload or fuel changes the equilibrium body pose.
            expect(gradient * b.cgToFront - frontFree).toBeCloseTo(car.compressionFront, 11);
            expect(-gradient * b.cgToRear - rearFree).toBeCloseTo(car.compressionRear, 11);
            expect(car.body.mass).toBe(mass);
            expect(car.dynamics.mass).toBe(mass);
            expect(car.forceFront + car.forceRear).toBeCloseTo(mass * G, 9);
            expect(car.forceFront * b.cgToFront - car.forceRear * b.cgToRear).toBeCloseTo(0, 9);
            expect(car.forceFront).toBeCloseTo((mass * G * b.cgToRear) / L, 10);
            expect(car.fork).toBe(car.compressionFront);
            expect(car.shock).toBe(car.compressionRear);
            expect(car.vy).toBe(0);
            expect(car.pitchRate).toBe(0);
          }
    },
  );

  it.each(['mx250', 'mx450', 'sm450'])(
    '%s changes ride height and rake when preload or fuel changes its equilibrium',
    (id) => {
      const definition = VEHICLES[id],
        track = new Grade(),
        soft = bike(definition, -0.005),
        factory = bike(definition),
        wound = bike(definition, 0.01),
        light = bike(definition, 0, 0.1);
      for (const car of [soft, factory, wound, light]) car.placeFree(track, 0, 0, 0, 0);
      expect(factory.cgY).toBeCloseTo(definition.bike!.cgHeight, 12);
      expect(factory.pitch).toBeCloseTo(0, 12);
      expect(soft.cgY).toBeLessThan(factory.cgY - 0.002);
      expect(soft.pitch).toBeGreaterThan(factory.pitch);
      expect(wound.cgY).toBeGreaterThan(factory.cgY + 0.004);
      expect(wound.pitch).toBeLessThan(factory.pitch);
      expect(wound.compressionRear).toBeCloseTo(factory.compressionRear - 0.01, 12);
      expect(light.cgY).toBeGreaterThan(factory.cgY + 0.001);
      expect(light.compressionFront).toBeLessThan(factory.compressionFront);
      expect(light.compressionRear).toBeLessThan(factory.compressionRear);
    },
  );

  it('the same physical pose has the same contact gaps after fuel/preload changes', () => {
    const definition = VEHICLES.mx450,
      track = new Grade(),
      factory = bike(definition),
      wound = bike(definition, 0.01, 0.1);
    for (const car of [factory, wound]) {
      car.placeFree(track, 0, 0, 0, 0);
      car.cgY = 0.88;
      car.pitch = 0.02;
      car.vy = car.pitchRate = 0;
      car.step(DT, track);
    }
    expect(wound.compressionFront).toBeCloseTo(factory.compressionFront, 12);
    expect(wound.compressionRear).toBeCloseTo(factory.compressionRear, 12);
    // More wound-in spring travel changes force at that geometry, rather
    // than taking ten millimetres out of the actual free-wheel reach.
    expect(wound.forceRear).toBeGreaterThan(factory.forceRear + 100);
    expect(wound.body.mass).toBeLessThan(factory.body.mass);
  });
});
