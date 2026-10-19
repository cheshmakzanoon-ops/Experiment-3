import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { wakeFields } from '../src/simulation/aero.ts';
import { controls } from '../src/simulation/config.ts';
import type { Participant } from '../src/simulation/open-world/festival-events.ts';
import {
  FestivalRacecraft,
  type FestivalRacecraftStatus,
} from '../src/simulation/open-world/racecraft.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { RoutePath, pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { RouteGraph, RouteProgress } from '../src/simulation/route-graph.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { TOURING_TC1 } from '../src/simulation/vehicles.ts';

/** Analytic motion fixture for detector boundaries; physical acceptance is
 * exercised separately below through real controls, aero, tyres and contact. */
function driving(hz = 120) {
  const graph = new RouteGraph({
    id: 'racecraft-straight',
    version: 1,
    closed: false,
    start: '0',
    edges: [
      {
        id: '0',
        kind: 'stage',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 5000 },
        ],
        next: [],
      },
    ],
    checkpoints: [{ edge: '0', s: 4900 }],
  });
  const participants: Participant[] = [0, 1].map((id) => {
    const car = new Vehicle(id, 'medium', undefined, 'sport', TOURING_TC1);
    car.body.position.set(0, 0.62, 100 + id * 24);
    car.body.velocity.set(0, 0, 30);
    car.localVelocity.set(0, 0, 30);
    car.speed = 30;
    car.trackPosition.width = 12;
    for (const tyre of car.tires) tyre.load = 3000;
    const progress = new RouteProgress(graph);
    progress.update(car.body.position, 200);
    return { car, progress, name: id ? 'Nera' : 'YOU', finishTime: null };
  });
  const craft = new FestivalRacecraft(graph),
    player = participants[0].car,
    other = participants[1].car;
  let latest: FestivalRacecraftStatus | null = null;
  const tick = (speed = 30, lane = 0, enabled = true, contacts = 0, move = true) => {
    const nextX =
      player.body.position.x + Math.max(-2 / hz, Math.min(2 / hz, lane - player.body.position.x));
    player.localVelocity.set((nextX - player.body.position.x) * hz, 0, speed);
    player.body.velocity.copy(player.localVelocity);
    player.speed = Math.hypot(player.localVelocity.x, speed);
    if (move) {
      player.body.position.x = nextX;
      player.body.position.z += speed / hz;
      other.body.position.z += other.localVelocity.z / hz;
    }
    player.lateral = player.body.position.x;
    for (const p of participants) p.progress.update(p.car.body.position);
    craft.update(participants, 1 / hz, enabled, contacts);
    latest = craft.status();
    return latest;
  };
  const advance = (seconds: number, speed = 30, lane = 0, enabled = true) => {
    for (let i = 0; i < Math.round(seconds * hz); i++) tick(speed, lane, enabled);
    return latest;
  };
  return { craft, graph, participants, player, other, tick, advance };
}

describe('festival manual tow-and-pass challenge', () => {
  it('prepares in real tow, waits for both bumpers and a held lead, then reports one pass', () => {
    const d = driving();
    expect(d.advance(0.2)).toBeNull();
    expect(d.advance(0.6)).toMatchObject({
      phase: 'following',
      car: 1,
      target: 'Nera',
      passes: 0,
      sequence: 0,
    });
    expect(d.craft.status()!.progress).toBeGreaterThan(0.4);
    expect(d.advance(0.8)).toMatchObject({ phase: 'ready', progress: 1, passes: 0 });
    expect(d.advance(3.3, 40, 3.5)).toMatchObject({ phase: 'passing', passes: 0 });
    expect(d.advance(0.6, 40, 3.5)).toMatchObject({
      phase: 'complete',
      progress: 1,
      passes: 1,
      sequence: 1,
    });
    expect(d.advance(2, 40, 3.5)?.phase).toBe('complete');
    expect(d.advance(1.1, 40, 3.5)).toBeNull();
  });

  it('recognises the same manoeuvre at 30 and 120 Hz without awarding centre crossings', () => {
    for (const hz of [30, 120]) {
      const d = driving(hz);
      d.advance(1.6);
      // Player is ahead by only one metre: bodies still overlap longitudinally.
      expect(d.advance(2.5, 40, 3.5)).toMatchObject({ phase: 'passing', passes: 0 });
      expect(d.advance(1.4, 40, 3.5)).toMatchObject({ phase: 'complete', passes: 1, sequence: 1 });
    }
  });

  it('cannot farm the same rival after a reset, but a new race starts with a new tally', () => {
    const d = driving();
    d.advance(1.6);
    expect(d.advance(3.9, 40, 3.5)?.passes).toBe(1);
    d.craft.reset();
    d.player.body.position.x = 0;
    d.player.body.position.z = d.other.body.position.z - 24;
    expect(d.advance(1.6)).toBeNull();
    expect(d.advance(3.9, 40, 3.5)).toBeNull();
    const retry = driving();
    expect(retry.advance(1.6)).toMatchObject({ phase: 'ready', passes: 0, sequence: 0 });
  });

  it('requires continuous preparation and expires a prepared pass after ten driving seconds', () => {
    const d = driving();
    d.advance(1);
    d.advance(0.05, 30, 0, false);
    expect(d.advance(0.9)?.phase).toBe('following');
    expect(d.advance(0.7)?.phase).toBe('ready');
    d.advance(9.6);
    expect(d.advance(0.7)?.phase).not.toBe('ready');
    expect(d.craft.status()?.passes ?? 0).toBe(0);
  });

  it.each(['speed', 'vertical heading'])(
    'rejects non-finite %s during an existing tow',
    (value) => {
      const d = driving();
      expect(d.advance(0.8)?.phase).toBe('following');
      if (value === 'speed') d.other.speed = NaN;
      else d.other.forward.y = NaN;
      expect(d.advance(1)).toBeNull();
      d.other.speed = 30;
      d.other.forward.y = 0;
      expect(d.advance(0.8)).toMatchObject({ phase: 'following', passes: 0 });
    },
  );

  it.each([
    'player contact',
    'rival contact',
    'overlap',
    'teleport',
    'airborne',
    'reset',
    'assisted',
  ])('discards an uncompleted pass after %s', (reason) => {
    const d = driving();
    d.advance(1.6);
    d.advance(1.7, 40, 3.5);
    if (reason === 'player contact' || reason === 'rival contact')
      d.tick(40, 3.5, true, reason === 'player contact' ? 1 : 2);
    else if (reason === 'overlap') {
      d.player.body.position.x = 0;
      d.other.body.position.z = d.player.body.position.z + 2;
      d.tick(40, 0);
    } else if (reason === 'teleport') {
      d.player.body.position.z += 15;
      d.tick(40, 3.5);
    } else if (reason === 'airborne') {
      for (const tyre of d.player.tires) tyre.load = 0;
      d.tick(40, 3.5);
      for (const tyre of d.player.tires) tyre.load = 3000;
    } else if (reason === 'reset') d.craft.reset();
    else d.tick(40, 3.5, false);
    expect(d.craft.status(), reason).toBeNull();
    expect(d.advance(3, 40, 3.5)?.phase, reason).not.toBe('complete');
  });

  it.each([
    'other deck',
    'opposite direction',
    'stationary telemetry',
    'reverse',
    'finished',
    'off route',
  ])('does not prepare from %s', (reason) => {
    const d = driving();
    if (reason === 'other deck') d.other.body.position.y += 8;
    else if (reason === 'opposite direction') d.other.forward.set(0, 0, -1);
    else if (reason === 'finished') d.participants[1].finishTime = 5;
    else if (reason === 'off route') d.other.body.position.x = 35;
    for (let i = 0; i < 3 * 120; i++)
      d.tick(reason === 'reverse' ? -30 : 30, 0, true, 0, reason !== 'stationary telemetry');
    expect(d.craft.status()).toBeNull();
  });
});

function raceSession(lane = 0, deck = 0, reverse = false) {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
  sim.command({ type: 'start', event: 'runway-showcase' });
  // Existing countdown tests cover its clock. Advance to racing for these
  // focused force/geometry checks, then place both cars on the real runway.
  sim.time = 3.01;
  sim.step(1 / 120);
  const path = sim.events.find((e) => e.spec.id === 'runway-showcase')!.path;
  for (let i = 0; i < sim.cars.length; i++) {
    const car = sim.cars[i],
      p = path.at(200 + i * 25, pathPoint());
    sim.placeAt(
      car,
      p.x + p.nx * lane * i,
      p.z + p.nz * lane * i,
      Math.atan2(p.tx, p.tz) + (i && reverse ? Math.PI : 0),
      p.y + 0.5,
    );
    const direction = i && reverse ? -1 : 1;
    car.body.position.y += i * deck;
    car.forward.set(p.tx * direction, 0, p.tz * direction);
    car.localVelocity.set(0, 0, 45);
    car.body.velocity.set(p.tx * 45 * direction, 0, p.tz * 45 * direction);
    car.speed = 45;
    car.gear = 4;
    for (const tyre of car.tires) tyre.omega = 45 / tyre.radius;
  }
  sim.setInput({ ...controls(), throttle: 0.15 });
  return sim;
}

describe('festival physical race aero integration', () => {
  it('feeds the existing aerodynamic tow into drag, and clears it on cancel and free roam', () => {
    const towed = raceSession(),
      clear = raceSession(12);
    towed.step(1 / 120);
    clear.step(1 / 120);
    expect(towed.player.slipstream).toBeGreaterThan(0.15);
    expect(towed.player.wake).toBeGreaterThan(0);
    expect(clear.player.slipstream).toBe(0);
    expect(towed.player.aero.drag).toBeLessThan(clear.player.aero.drag * 0.97);
    towed.command({ type: 'cancel' });
    expect(towed.player.slipstream).toBe(0);
    expect(towed.player.wake).toBe(0);
    expect(towed.status().event?.racecraft).toBeNull();
    towed.command({ type: 'continue' });
    towed.step(1 / 120);
    expect(towed.player.slipstream).toBe(0);
    expect(towed.status().event).toBeNull();
  });

  it('has no ghost tow from a different bridge deck or an opposite-facing car', () => {
    for (const [deck, reverse] of [
      [8, false],
      [0, true],
    ] as const) {
      const sim = raceSession(0, deck, reverse);
      sim.step(1 / 120);
      expect(sim.player.slipstream).toBe(0);
      expect(sim.player.wake).toBe(0);
      expect(sim.status().event?.racecraft).toBeNull();
    }
  });

  it('removes a finished rival from the physical wake field while its car remains on the road', () => {
    const sim = raceSession();
    sim.step(1 / 120);
    expect(sim.player.slipstream).toBeGreaterThan(0.15);
    // Set the race-control completion flag without moving its physical car.
    // This isolates leader eligibility from the shared wake-volume geometry.
    const run = (sim as unknown as { run: { participants: Participant[] } }).run;
    run.participants[1].finishTime = sim.time;
    sim.step(1 / 120);
    expect(sim.cars).toHaveLength(2);
    expect(sim.player.slipstream).toBe(0);
    expect(sim.player.wake).toBe(0);
  });

  it('records gentle physical brushes and makes an assisted race ineligible until retry', () => {
    const sim = raceSession();
    // Separating, zero-energy contact still counts as a touch for racecraft.
    sim.collisions.touched = 0;
    sim.collisions.impulse(
      sim.player,
      sim.cars[1],
      sim.player.body.position,
      new Vec3(1, 0, 0),
      0.001,
    );
    expect(sim.collisions.touched & 3).toBe(3);
    expect(sim.player.impact).toBe(0);
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'autopilot', value: false });
    sim.step(1 / 120);
    expect(sim.status().event?.racecraft).toBeNull();
    sim.command({ type: 'cancel' });
    expect(sim.status().result?.assisted).toBe(true);
    sim.command({ type: 'start', event: 'runway-showcase' });
    sim.command({ type: 'cancel' });
    expect(sim.status().result?.assisted).toBe(false);
  });

  it('completes a tow-and-pass through real steering, pedals, aero, tyres and contact', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
    const edge = sim.world.network.edges[5];
    const path = new RoutePath(
      sim.world.network,
      [{ edge: 5, dir: 1, from: 0, to: edge.length }],
      false,
    );
    const graph = new RouteGraph(path.routeSpec('racecraft-physical'));
    const craft = new FestivalRacecraft(graph);
    const cars = [sim.player, new Vehicle(1, 'medium', undefined, 'sport', TOURING_TC1)];
    const participants: Participant[] = cars.map((car, i) => {
      const p = path.at(200 + i * 26, pathPoint());
      sim.placeAt(car, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
      car.body.velocity.set(p.tx * 30, 0, p.tz * 30);
      car.forward.set(p.tx, 0, p.tz);
      car.speed = 30;
      car.localVelocity.set(0, 0, 30);
      car.gear = 4;
      for (const tyre of car.tires) tyre.omega = 30 / tyre.radius;
      const progress = new RouteProgress(graph);
      progress.update(car.body.position, 300);
      return { car, progress, name: i ? 'Nera' : 'YOU', finishTime: null };
    });
    const driver = new RouteDriver(cars[0], path, 0.92, 0, 43);
    const lead = new RouteDriver(cars[1], path, 0.9, 0, 29);
    driver.overtake = lead.overtake = false;
    const contacts = vi.spyOn(sim.collisions, 'impulse');
    const observed = new Set<string>();
    let maxTow = 0,
      passed = false;
    for (let tick = 0; tick < 20 * 120; tick++) {
      if (craft.status()?.phase === 'ready') driver.overtake = true;
      driver.update(1 / 120, cars);
      lead.update(1 / 120, cars);
      sim.collisions.touched = 0;
      for (let sub = 0; sub < 2; sub++) {
        for (const car of cars) wakeFields(car, cars);
        sim.collisions.beginStep(cars);
        for (const car of cars) car.step(1 / 240, sim.asTrack);
        sim.collisions.solve(cars, sim.asTrack, 1 / 240);
      }
      maxTow = Math.max(maxTow, cars[0].slipstream);
      for (const p of participants) p.progress.update(p.car.body.position);
      craft.update(participants, 1 / 120, true, sim.collisions.touched);
      const status = craft.status();
      if (status) observed.add(status.phase);
      if (status?.phase === 'complete') {
        passed = true;
        break;
      }
    }
    const physicalContacts = contacts.mock.calls.filter((call) => call[1] !== null).length;
    contacts.mockRestore();
    expect(maxTow).toBeGreaterThan(0.08);
    expect([...observed]).toEqual(['following', 'ready', 'passing', 'complete']);
    expect(passed).toBe(true);
    expect(physicalContacts).toBe(0);
    expect(driver.wantsReset).toBe(false);
    expect(lead.wantsReset).toBe(false);
    expect(craft.status()).toMatchObject({ passes: 1, sequence: 1 });
  });
});
