import { it, expect } from 'vitest';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { updatePit } from '../src/simulation/race.ts';
import { TrafficPlanner, personality } from '../src/simulation/traffic.ts';

it('defers a late request rather than cutting directly into pit lane', () => {
  const track = new Track(),
    car = new Vehicle(0);
  car.place(track, track.length - 32, 2.2);
  car.pitRequested = true;
  updatePit(car, track, 1 / 120);
  expect(car.inPit).toBe(false);
  car.pitLastS = track.length - 211;
  car.s = track.length - 209;
  car.lateral = 6;
  updatePit(car, track, 1 / 120);
  expect(car.inPit).toBe(true);
  expect(car.pitPhase).toBe(1);
});
it('does not enter pits from the far side of the racing surface', () => {
  const track = new Track(),
    car = new Vehicle(0);
  car.pitRequested = true;
  car.pitLastS = track.length - 211;
  car.s = track.length - 209;
  car.lateral = -5;
  updatePit(car, track, 1 / 120);
  expect(car.inPit).toBe(false);
});
it('returns from a completed pass to the racing line when no car conflicts', () => {
  const track = new Track(),
    car = new Vehicle(0),
    planner = new TrafficPlanner();
  car.place(track, 1000, 6);
  car.speed = 50;
  expect(planner.evaluate(car, [car], track, 10, 8, personality(4417, 0), false).offset).toBe(0);
});
it('plans ahead toward a legal pit approach instead of an instantaneous lateral jump', () => {
  const track = new Track(),
    car = new Vehicle(0),
    planner = new TrafficPlanner();
  car.place(track, 2000, 0);
  car.speed = 50;
  const plan = planner.evaluate(car, [car], track, 10, 8, personality(4417, 0), false, 6);
  expect(plan.offset).toBeGreaterThan(3);
  expect(plan.offset).toBeLessThanOrEqual(car.trackPosition.width - 2.4);
});
it('an occupied service-approach corridor never becomes an overtake away from entry', () => {
  const track = new Track(), car = new Vehicle(0), other = new Vehicle(1);
  car.place(track, 2500, 1.4); other.place(track, 2500, 5.6);
  car.speed = other.speed = 25;
  const planner = new TrafficPlanner();
  const plan = planner.evaluate(car, [car, other], track, 10, 4, personality(4417, 0), false, 6, true);
  expect(Math.abs(plan.offset - 6)).toBeLessThanOrEqual(Math.abs(car.lateral - 6) + 0.1);
});
