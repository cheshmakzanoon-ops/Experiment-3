import { it, expect } from 'vitest';
import { DriverBrain, DriverErrorModel, DefensiveLine } from '../src/simulation/driver-brain.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { personality, TrafficPlanner } from '../src/simulation/traffic.ts';
import { FLAG } from '../src/simulation/marshal.ts';

it('generates repeatable, bounded correlated control mistakes from the seed', () => {
  const a = new DriverErrorModel(99),
    b = new DriverErrorModel(99),
    c = controls();
  let acted = false;
  for (let i = 0; i < 1200; i++) {
    a.sample(0.5, 0.1, 0.8, 0.94, true);
    b.sample(0.5, 0.1, 0.8, 0.94, true);
    for (let tick = 0; tick < 60; tick++) {
      c.throttle = 0.6;
      c.brake = 0.2;
      c.steer = 0;
      a.apply(1 / 120, c, true);
      b.apply(1 / 120, controls(), true);
      acted ||= Math.abs(c.steer) > 0.001;
      expect(Math.abs(a.steer)).toBeLessThan(0.02);
      expect(Math.abs(a.pedal)).toBeLessThan(0.05);
    }
    expect(a.steer).toBe(b.steer);
    expect(a.events).toBe(b.events);
  }
  expect(acted).toBe(true);
  expect(a.events).toBeGreaterThan(10);
  a.sample(0.5, 0.1, 1, 0.9, false);
  a.apply(0.5, c, false);
  expect(a.active).toBe(false);
  expect(a.steer).toBe(0);
});
it('increased stress increases error events without random chassis changes', () => {
  const quiet = new DriverErrorModel(123),
    stressed = new DriverErrorModel(123);
  for (let i = 0; i < 10000; i++) {
    quiet.sample(0.5, 0.005, 0, 0.98, true);
    stressed.sample(0.5, 0.005, 1, 0.98, true);
  }
  expect(stressed.events).toBeGreaterThan(quiet.events * 2);
  expect(() => quiet.sample(NaN, 0, 0, 1, true)).toThrow();
});
it('tire-management and wet skill affect planning, not tire coefficients', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
  const c = sim.cars[0],
    traits = personality(1, 0),
    brain = new DriverBrain({ ...traits, tireManagement: 1, wetSkill: 0.7 }, 1, 0);
  c.place(sim.track, 1000);
  c.speed = 40;
  c.tires.forEach((t) => {
    t.wear = 0.5;
    t.surfaceTemp = 140;
  });
  sim.track.water.fill(0.8);
  const original = c.tires.map((t) => ({ ...t }));
  brain.update(0.5, c, sim.cars, sim.track, sim.race);
  expect(brain.pace).toBeLessThan(1);
  expect(brain.tireCare).toBeGreaterThan(0);
  expect(c.pitRequested).toBe(true);
  expect(c.nextCompound).toBe('intermediate');
  expect(c.tires).toEqual(original);
});
it('battery reserve and an actual passing opportunity control hybrid modes', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
  const [c, other] = sim.cars;
  c.place(sim.track, 1000, 3);
  c.speed = 50;
  c.trackPosition.curvature = 0;
  other.place(sim.track, 1030, 0);
  other.speed = 48;
  const brain = new DriverBrain({ ...personality(2, 0), aggression: 0.9 }, 2, 0);
  c.battery = 3.8e6;
  brain.update(0.5, c, sim.cars, sim.track, sim.race);
  expect(brain.ers).toBe(2);
  c.battery = 1e5;
  brain.update(0.5, c, sim.cars, sim.track, sim.race);
  expect(brain.ers).toBe(0);
  c.battery = 3.8e6;
  sim.race.control.flags[0] = FLAG.YELLOW;
  brain.update(0.5, c, sim.cars, sim.track, sim.race);
  expect(brain.ers).toBe(0);
});
it('makes one early defensive move, never a late side-by-side block or zigzag', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
  const [c, other] = sim.cars;
  const bend = sim.track.points.find((p) => Math.abs(p.curvature) > 0.004)!;
  c.place(sim.track, bend.s - 90);
  c.speed = 35;
  c.brake = 0;
  other.place(sim.track, bend.s - 120);
  other.speed = 40;
  const line = new DefensiveLine();
  const first = line.update(c, sim.cars, sim.track, 10, 0.9, true);
  expect(Math.abs(first)).toBeGreaterThan(1);
  other.s = c.s - 2;
  expect(line.update(c, sim.cars, sim.track, 10.2, 0.9, true)).toBe(first);
  const fresh = new DefensiveLine();
  expect(fresh.update(c, sim.cars, sim.track, 10, 0.9, true)).toBe(0);
  expect(line.update(c, sim.cars, sim.track, 20, 0.9, true)).toBe(0);
  expect(line.update(c, sim.cars, sim.track, 21, 0.9, false)).toBe(0);
});
it('emergency and disabled control paths cannot have braking removed by an error', () => {
  const error = new DriverErrorModel(1),
    request = controls();
  error.sample(0.5, 100, 1, 0.9, true);
  request.brake = 1;
  request.steer = 0;
  request.throttle = 0;
  error.apply(0.1, request, true);
  expect(request.brake).toBe(1);
  const snapshot = { ...request };
  error.apply(0.1, request, false);
  expect(request).toEqual(snapshot);
});
it('a new pit-entry purpose is not postponed by an old racing-lane commitment', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const c = sim.cars[0];
  c.place(sim.track, 2000, -3);
  c.speed = 35;
  const planner = new TrafficPlanner();
  planner.evaluate(c, [c], sim.track, 10, 8, personality(1, 0), false, 0);
  const next = planner.evaluate(c, [c], sim.track, 10.1, 8, personality(1, 0), false, 6);
  expect(next.offset).toBeGreaterThan(4);
});
it('reserves control margin on rainy slicks and releases it only after fitting suitable tires', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, weather: 'rain', compound: 'medium' });
  const c = sim.cars[0], brain = sim.ai[0].brain;
  const tires = c.tires.map((t) => ({ ...t }));
  brain.update(0.5, c, sim.cars, sim.track, sim.race);
  expect(brain.pace).toBeLessThan(0.8);
  expect(c.tires).toEqual(tires);
  c.replaceTires('wet');
  brain.update(0.5, c, sim.cars, sim.track, sim.race);
  expect(brain.pace).toBeGreaterThan(0.96);
});
