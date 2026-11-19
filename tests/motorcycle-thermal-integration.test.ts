import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { FLASHBACK, InputLog, Resimulation } from '../src/core/flashback.ts';
import type { Vec3 } from '../src/core/math.ts';
import { BikeVehicle, createVehicle } from '../src/simulation/bike-vehicle.ts';
import { COMPOUNDS, DEFAULT_OPTIONS, DEFAULT_SETUP, controls } from '../src/simulation/config.ts';
import { MOTORCYCLE_THERMAL } from '../src/simulation/motorcycle-thermal.ts';
import { stepMotocrossGround } from '../src/simulation/offroad/mx-ground-physics.ts';
import type { SurfaceSample, TrackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;
const fields = [
  'surfaceTemp',
  'carcassTemp',
  'coreTemp',
  'discTemp',
  'pressure',
  'wear',
  'energy',
] as const;
const thermalState = (bike: BikeVehicle) =>
  bike.tires.map((t) => Object.fromEntries(fields.map((k) => [k, t[k]])));
function expectAliases(bike: BikeVehicle) {
  const state = thermalState(bike);
  expect(state[0]).toEqual(state[1]);
  expect(state[2]).toEqual(state[3]);
}
class ThermalTrack extends DynamicsTrack {
  override ambient = 20;
  constructor(readonly drop = false) {
    super();
  }
  private roadHeight(z: number) {
    return this.drop && z < 0 ? 1 : 0;
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.temp = this.ambient;
    out.height = this.roadHeight(z);
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    if (down.x !== 0 || down.z !== 0 || down.y >= 0) return Infinity;
    const distance = (this.roadHeight(origin.z) - origin.y) / down.y;
    if (distance < 0 || distance > maximum) return Infinity;
    this.sample(origin.x, origin.z, out);
    return distance;
  }
  override nearest(x: number, z: number, out: TrackPoint) {
    const lateral = super.nearest(x, z, out);
    out.y = this.roadHeight(z);
    return lateral;
  }
}

describe('production motorcycle thermal ownership', () => {
  it.each(['gpr1', 'sbk1000', 'mx250', 'sm450'])(
    '%s does not heat cold tyres and discs above a cold, flat idle environment',
    (id) => {
      const track = new ThermalTrack(),
        bike = createVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]) as BikeVehicle;
      bike.placeFree(track, 0, 0, 0, 0);
      for (const t of bike.tires) t.surfaceTemp = t.carcassTemp = t.coreTemp = t.discTemp = 20;
      for (let i = 0; i < 10 / DT; i++) bike.step(DT, track);
      expect(bike.speed).toBeLessThan(0.01);
      for (const t of bike.tires) {
        for (const key of ['surfaceTemp', 'carcassTemp', 'coreTemp', 'discTemp'] as const)
          expect(t[key]).toBeCloseTo(20, 8);
        expect(t.energy).toBe(0);
        expect(t.wear).toBe(0);
      }
      expectAliases(bike);
    },
  );

  it.each(['gpr1', 'sbk1000', 'mx250'])(
    '%s retains authored warm starts, replaces both physical tyres and carries heat through pose resets',
    (id) => {
      const track = new ThermalTrack(),
        bike = createVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]) as BikeVehicle;
      expect(bike.tires.every((t) => t.surfaceTemp === COMPOUNDS.medium.ideal - 5)).toBe(true);
      expect(bike.tires.every((t) => t.discTemp === 320)).toBe(true);
      bike.placeFree(track, 0, 0, 0, 0);
      for (let i = 0; i < 120; i++) bike.step(DT, track);
      const before = thermalState(bike);
      bike.placeFree(track, 0, 3, 0, 0);
      expect(thermalState(bike)).toEqual(before);
      bike.replaceTires('wet');
      expect(bike.tires.every((t) => t.surfaceTemp === COMPOUNDS.wet.ideal - 5)).toBe(true);
      expect(bike.tires.every((t) => t.wear === 0)).toBe(true);
      bike.step(DT, track);
      expectAliases(bike);
    },
  );

  it('publishes GP sliding watts once across four mirrored telemetry slots', () => {
    const track = new ThermalTrack(),
      bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1);
    bike.placeFree(track, 0, 0, 0, 0);
    bike.dynamics.speed = 30;
    bike.input.throttle = 0.4;
    bike.input.steer = 0.2;
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      bike.step(DT, track);
      expect(bike.riding).toBe(true);
      const gp = bike.dynamics.motoGP!,
        physical =
          (bike.tires[0].load > 1e-6 ? gp.frontSlidingPower : 0) +
          (bike.tires[2].load > 1e-6 ? gp.rearSlidingPower : 0);
      peak = Math.max(peak, physical);
      expect(bike.tires.reduce((sum, t) => sum + t.energy, 0)).toBeCloseTo(physical, 10);
      expectAliases(bike);
    }
    expect(peak).toBeGreaterThan(100);
  });

  it('has no tyre work or wear while a real road drop separates both contacts', () => {
    const track = new ThermalTrack(true),
      bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1);
    bike.placeFree(track, 0, -4, 0, 1);
    bike.dynamics.speed = 20;
    const heat = () =>
      [0, 2].reduce((sum, i) => {
        const t = bike.tires[i],
          p = i === 0 ? MOTORCYCLE_THERMAL.front : MOTORCYCLE_THERMAL.rear;
        return (
          sum +
          p.tyre.surfaceCapacity * (1 - p.tyre.wearCapacityLoss * t.wear) * t.surfaceTemp +
          p.tyre.carcassCapacity * t.carcassTemp +
          p.tyre.coreCapacity * t.coreTemp +
          p.brake.capacity * t.discTemp
        );
      }, 0);
    let airborneSteps = 0;
    for (let i = 0; i < 360; i++) {
      const wear = bike.tires.map((t) => t.wear),
        before = heat();
      bike.step(DT, track);
      if (!bike.roadSuspension.airborne) continue;
      airborneSteps++;
      expect(bike.tires.every((t) => t.load === 0 && t.energy === 0)).toBe(true);
      expect(bike.tires.map((t) => t.wear)).toEqual(wear);
      expect(heat()).toBeLessThanOrEqual(before + 1e-6);
      expectAliases(bike);
    }
    expect(airborneSteps).toBeGreaterThan(30);
  });

  it('reproduces temperatures, pressure, wear and heat telemetry exactly through flashback', () => {
    const options = {
        ...DEFAULT_OPTIONS,
        mode: 'practice' as const,
        opponents: 0,
        vehicles: ['gpr1'],
      },
      simulation = new Simulation(options),
      log = new InputLog();
    const start = { ...controls(), throttle: 0.75 };
    log.input(0, start);
    simulation.setInput(start);
    for (let i = 0; i < 720; i++) {
      if (i === 480) {
        const braking = { ...controls(), brake: 0.2 };
        log.input(simulation.tick, braking);
        simulation.setInput(braking);
      }
      simulation.step(FLASHBACK.dt);
    }
    const replay = new Resimulation(options, log.entries, simulation.tick);
    while (!replay.run()) {
      /* Reconstruct using the production input log. */
    }
    expect(thermalState(replay.simulation.cars[0] as BikeVehicle)).toEqual(
      thermalState(simulation.cars[0] as BikeVehicle),
    );
    expectAliases(replay.simulation.cars[0] as BikeVehicle);
  });
});

describe('MX rotor work from the actual actuator integration', () => {
  it.each([100, 6000])(
    'converts only finite free-wheel brake work to rotor heat at torque %s',
    (torque) => {
      const state = {
          speed: 20,
          lateralSpeed: 0,
          yawRate: 0,
          heading: 0,
          frontOmega: 50,
          rearOmega: 50,
        },
        dt = 1 / 60,
        p = {
          mass: 185,
          frontArm: 0.75,
          rearArm: 0.73,
          frontRadius: 0.355,
          rearRadius: 0.345,
          frontInertia: 0.6,
          rearInertia: 0.62,
          frontLoad: 0,
          rearLoad: 0,
          frontMu: 1,
          rearMu: 1,
          steer: 0,
          driveTorque: 0,
          frontBrakeTorque: torque,
          rearBrakeTorque: torque,
          rearEngineBrakeTorque: torque,
          drag: 0,
          slope: 0,
          tractionControl: false,
          abs: false,
        },
        result = stepMotocrossGround(state, p, dt);
      expect(result.frontBrakePower * dt).toBeCloseTo(
        0.5 * p.frontInertia * (state.frontOmega ** 2 - result.frontOmega ** 2),
        8,
      );
      expect(result.rearBrakePower).toBe(0);
      expect(result.rearOmega).toBeLessThan(state.rearOmega);
      expect(result.front.slipPower + result.rear.slipPower).toBe(0);
    },
  );
});
