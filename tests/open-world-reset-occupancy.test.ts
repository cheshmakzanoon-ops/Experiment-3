import { describe, expect, it } from 'vitest';
import { BoxContact, ChassisBox } from '../src/simulation/obb.ts';
import type { Participant } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint, type RoutePath } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';

function place(
  sim: OpenWorldSimulation,
  path: RoutePath,
  car: Vehicle,
  d: number,
  yaw = 0,
  lateral = 0,
) {
  const p = path.at(d, pathPoint());
  sim.placeAt(
    car,
    p.x + p.nx * lateral,
    p.z + p.nz * lateral,
    Math.atan2(p.tx, p.tz) + yaw,
    p.y + 0.5,
  );
}
function box(car: Vehicle) {
  const shape = new ChassisBox();
  shape.half = car.definition.halfExtents;
  return shape.update(car.body);
}
function fixture() {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
  sim.command({ type: 'start', event: 'valley-sprint' });
  const path = sim.events.find((event) => event.spec.id === 'valley-sprint')!.path;
  const at = () => path.locate(sim.player.body.position.x, sim.player.body.position.z, 0, 200);
  // Keep all but the explicitly tested blocker away from the reset window.
  for (const car of sim.cars.slice(1)) place(sim, path, car, 100 + car.id * 10);
  return { sim, path, at };
}

describe('occupied event reset placement', () => {
  it('clears an angled rival with the full chassis footprint without advancing around it', () => {
    const { sim, path, at } = fixture();
    const legal = at(),
      before = sim.status().event!.progress,
      old = sim.player,
      blocker = sim.cars[1];
    // The shortcut bounds the ordinary reset target to legal + 8 m. The
    // rival's centre is beyond that target, but its sideways chassis still
    // intersects the front of a car placed there.
    place(sim, path, blocker, legal + 11, Math.PI / 2);
    place(sim, path, old, legal + 8);
    expect(new BoxContact().intersect(box(old), box(blocker))).toBe(true);
    place(sim, path, old, legal + 90);
    sim.command({ type: 'reset' });
    expect(sim.player).not.toBe(old);
    expect(at()).toBeLessThan(legal + 8 - 0.5);
    expect(at()).toBeGreaterThanOrEqual(Math.max(0, legal - 30));
    expect(sim.status().event!.progress).toBe(before);
    const playerBox = box(sim.player),
      contact = new BoxContact();
    for (const car of sim.cars.slice(1))
      expect(contact.intersect(playerBox, box(car)), `overlap with rival ${car.id}`).toBe(false);
    // A reset should not immediately launch either chassis as the fresh
    // suspension settles. Countdown holds the drivers stationary here.
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    expect(sim.player.impact).toBe(0);
    expect(blocker.impact).toBe(0);
  });

  it('keeps the car and legal progress when the route start is occupied, then accepts a clear retry', () => {
    const { sim, path, at } = fixture();
    const old = sim.player,
      blocker = sim.cars[1];
    place(sim, path, blocker, 0, Math.PI / 2);
    place(sim, path, old, 0, 0, 20);
    old.input.throttle = 0.4;
    old.input.steer = -0.3;
    const position = { ...old.body.position },
      before = sim.status().event!.progress,
      input = { ...old.input };
    const cars = [...sim.cars];
    sim.command({ type: 'reset' });
    expect(sim.player).toBe(old);
    expect(sim.player.body.position).toMatchObject(position);
    expect(sim.player.input).toEqual(input);
    expect(sim.cars).toEqual(cars);
    expect(sim.status().event!.progress).toBe(before);
    expect(sim.status().message).toBe('Road occupied; try reset again');
    // No wrap to the far end and no forward jump around the occupied start.
    place(sim, path, blocker, 100);
    sim.command({ type: 'reset' });
    expect(sim.player).not.toBe(old);
    expect(at()).toBeCloseTo(0, 7);
    expect(sim.status().event!.progress).toBe(before);
    const contact = new BoxContact();
    for (const car of sim.cars.slice(1))
      expect(contact.intersect(box(sim.player), box(car))).toBe(false);
  });
  it('searches behind the closing seam on the final edge without wrapping its legal progress forward', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    sim.command({ type: 'start', event: 'port-ilse-loop' });
    const path = sim.events.find((event) => event.spec.id === 'port-ilse-loop')!.path;
    const run = (sim as unknown as { run: { participants: Participant[] } }).run;
    const progress = run.participants[0].progress;
    // A circuit can be at distance zero while its accepted graph location
    // is still the end of the last edge, before the next update enters edge 0.
    progress.edge = String(path.legs.length - 1);
    progress.s = progress.graph.length(progress.edge);
    progress.distance = path.length;
    progress.laps = 1;
    expect(path.progressDistance(progress.edge, progress.s)).toBeCloseTo(0, 7);
    for (const car of sim.cars.slice(1)) place(sim, path, car, 100 + car.id * 10);
    place(sim, path, sim.cars[1], 0);
    const old = sim.player;
    place(sim, path, old, 0);
    const before = sim.status().event!.progress;
    sim.command({ type: 'reset' });
    expect(sim.player).not.toBe(old);
    const d = path.locate(sim.player.body.position.x, sim.player.body.position.z, 0, 30);
    expect(d).toBeGreaterThanOrEqual(path.length - 30);
    expect(d).toBeLessThan(path.length - 1);
    expect(sim.status().event!.progress).toBe(before);
    expect(progress.edge).toBe(String(path.legs.length - 1));
    expect(progress.laps).toBe(1);
    expect(new BoxContact().intersect(box(sim.player), box(sim.cars[1]))).toBe(false);
  });
});
