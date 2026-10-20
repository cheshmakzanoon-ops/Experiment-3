import { describe, expect, it, vi } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { RoutePath, pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { rivalGaps } from '../src/simulation/open-world/rival-gap.ts';
import { RouteProgress } from '../src/simulation/route-graph.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { TOURING_TC1 } from '../src/simulation/vehicles.ts';

function scenario(width = 7.6, edgeId = 24) {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
  const edge = sim.world.network.edges[edgeId];
  const path = new RoutePath(
    sim.world.network,
    [{ edge: edgeId, dir: 1, from: 0, to: edge.length }],
    false,
  );
  // Isolate the lane planner's road-width scenarios on a real sampled route.
  path.halfWidth.fill(width);
  path.line.fill(0);
  const car = sim.player;
  const lead = new Vehicle(1, 'medium', undefined, 'sport', TOURING_TC1);
  const neighbour = new Vehicle(2, 'medium', undefined, 'sport', TOURING_TC1);
  const point = pathPoint();
  const place = (vehicle: Vehicle, station: number, lane: number, speed: number, deck = 0) => {
    path.at(station, point);
    sim.placeAt(
      vehicle,
      point.x + point.nx * lane,
      point.z + point.nz * lane,
      Math.atan2(point.tx, point.tz),
      point.y + 0.5,
    );
    vehicle.body.position.y += deck;
    vehicle.forward.set(point.tx, 0, point.tz);
    vehicle.speed = speed;
    vehicle.body.velocity.set(point.tx * speed, 0, point.tz * speed);
    vehicle.localVelocity.set(0, 0, speed);
    for (const tyre of vehicle.tires) tyre.omega = speed / vehicle.spec.wheelRadius;
  };
  place(car, 200, 0, 24);
  place(lead, 225, 0, 18);
  place(neighbour, 200, 3.3, 24);
  const driver = new RouteDriver(car, path, 0.9);
  const plan = (cars = [car, lead], frames = 15) => {
    for (let i = 0; i < frames; i++) driver.update(1 / 12 + 1e-6, cars);
  };
  return { sim, path, car, lead, neighbour, driver, place, plan };
}

describe('festival rivals leave room for real cars', () => {
  it('holds its chosen passing side while alongside and until the rear bumper clears', () => {
    const s = scenario();
    s.plan();
    const side = Math.sign(s.car.aiOffset);
    expect(Math.abs(s.car.aiOffset)).toBeGreaterThan(2.5);
    expect(s.driver.decision).toBe(side > 0 ? 'PASS LEFT' : 'PASS RIGHT');
    // Both centres draw level; then the passing car's nose moves in front.
    // Neither case permits cutting across the car's still-overlapping body.
    for (const gap of [1, 0, -2, -4]) {
      s.place(s.car, 230, side * 3.3, 24);
      s.place(s.lead, 230 + gap, 0, 18);
      s.plan();
      expect(Math.sign(s.car.aiOffset), `gap ${gap}`).toBe(side);
      expect(Math.abs(s.car.aiOffset), `gap ${gap}`).toBeGreaterThan(2.5);
    }
    s.place(s.lead, 211, 0, 18);
    s.plan();
    expect(s.car.aiOffset).toBeCloseTo(0, 2);
    expect(s.driver.decision).toBe('RACE LINE');
  });

  it('uses the free side when another car owns the preferred passing corridor', () => {
    const s = scenario();
    s.plan([s.car, s.lead, s.neighbour]);
    expect(s.driver.decision).toBe('PASS RIGHT');
    expect(s.car.aiOffset).toBeLessThan(-2.5);
  });

  it('keeps its passing corridor when the lead weaves away, while leaving room if it moves closer', () => {
    const s = scenario();
    s.plan();
    expect(s.driver.decision).toBe('PASS LEFT');
    const lane = s.car.aiOffset;
    s.place(s.car, 230, lane, 30);
    // The lead is still ahead. Chasing its rightward movement would keep
    // reversing this car's desired lane before it has cleared the pass.
    for (const leadLane of [-3, 0, -2.5, 0]) {
      s.place(s.lead, 255, leadLane, 22);
      s.plan();
      expect(s.driver.decision).toBe('PASS LEFT');
      expect(s.car.aiOffset).toBeGreaterThanOrEqual(lane - 0.1);
      expect(s.car.aiOffset).toBeLessThan(lane + 0.3);
    }
    // Commitment must not stop the driver giving a closing rival room.
    s.place(s.lead, 255, 1.5, 22);
    s.plan();
    expect(s.car.aiOffset).toBeGreaterThan(lane + 1.2);
    // Once safely passed, ordinary return to the race line still works.
    s.place(s.lead, 210, 0, 22);
    s.plan([s.car, s.lead], 20);
    expect(s.driver.decision).toBe('RACE LINE');
    expect(s.car.aiOffset).toBeCloseTo(0, 2);
  });

  it('does not merge across a car alongside or a faster car arriving from behind', () => {
    for (const [gap, speed] of [
      [0, 24],
      [-17, 42],
      // This fast closing car crosses between the former 0.3 s prediction
      // samples: the continuous corridor still protects its occupied lane.
      [-36, 104],
    ]) {
      const s = scenario();
      s.place(s.car, 230, 3.3, 24);
      s.place(s.neighbour, 230 + gap, 0, speed);
      s.plan([s.car, s.neighbour]);
      expect(s.driver.decision).toBe('HOLD LINE');
      expect(s.car.aiOffset).toBeGreaterThan(2.5);
      // Once the car has gone, the normal line becomes available again.
      s.plan([s.car]);
      expect(s.car.aiOffset).toBeCloseTo(0, 2);
    }
  });

  it('follows instead of proposing an impossible pass on a narrow or narrowing road', () => {
    for (const narrowing of [false, true]) {
      const s = scenario(narrowing ? 7.6 : 2.5);
      if (narrowing)
        for (let i = 0; i < s.path.count; i++) if (s.path.d[i] > 230) s.path.halfWidth[i] = 2.5;
      s.plan();
      expect(s.driver.decision).toBe('FOLLOW');
      expect(s.car.aiOffset).toBeCloseTo(0, 2);
      expect(s.car.aiTarget).toBeLessThan(s.car.speed);
    }
  });

  it('ignores another bridge deck and resumes decisions when the car returns to this road', () => {
    const s = scenario();
    s.place(s.lead, 225, 0, 0, 8);
    s.plan();
    expect(s.driver.decision).toBe('RACE LINE');
    expect(s.car.aiOffset).toBeCloseTo(0, 2);
    // Restoring the car to the actual road restores following/overtaking.
    s.place(s.lead, 225, 0, 18);
    s.plan();
    expect(s.driver.decision).toMatch(/^PASS/);
  });

  it('uses actual width and length rather than treating a wide sideways car as a point', () => {
    const s = scenario(3.7);
    const p = s.path.at(225, pathPoint());
    s.lead.forward.set(p.nx, 0, p.nz);
    s.lead.body.orientation.yaw(Math.atan2(p.nx, p.nz));
    s.lead.speed = 0;
    s.lead.body.velocity.set(0, 0, 0);
    s.plan();
    expect(s.driver.decision).toBe('FOLLOW');
    expect(s.car.aiOffset).toBeCloseTo(0, 2);
    expect(s.car.aiTarget).toBeLessThan(s.car.speed);
  });

  it('clears passing on relocation, countdown and finish, and never forces a finished car to race', () => {
    const s = scenario();
    s.plan();
    expect(s.driver.decision).toMatch(/^PASS/);
    s.driver.relocate();
    s.driver.update(1 / 120, [s.car], true);
    expect(s.driver.decision).toBe('HOLD');
    expect(s.car.input).toMatchObject({ throttle: 0, brake: 1 });
    s.plan();
    s.driver.update(1 / 120, [s.car, s.lead], false, true);
    expect(s.driver.decision).toBe('FINISHED');
    expect(s.car.aiOffset).toBeLessThan(0);
    expect(s.car.aiTarget).toBeLessThanOrEqual(16);
    expect(s.car.input.throttle).toBe(0);
  });

  it('keeps free-roam cruise in its right-hand lane with overtaking disabled', () => {
    const s = scenario();
    s.place(s.car, 200, -1.9, 24);
    s.place(s.lead, 225, -1.9, 18);
    const driver = new RouteDriver(s.car, s.path, 0.85, -1.9, 30);
    driver.overtake = false;
    for (let i = 0; i < 15; i++) driver.update(1 / 12 + 1e-6, [s.car, s.lead]);
    expect(driver.decision).toBe('FOLLOW');
    expect(s.car.aiOffset).toBeCloseTo(-1.9, 2);
  });

  it('reserves extra edge room for passes without moving an unoccupied racing line', () => {
    const s = scenario(5.5);
    s.path.line.fill(3.6);
    s.place(s.car, 200, 3.6, 60);
    s.plan([s.car]);
    expect(s.driver.decision).toBe('RACE LINE');
    expect(s.car.aiOffset).toBeCloseTo(3.6, 2);
  });
});

describe('festival route gap feedback', () => {
  function grid() {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1' });
    const event = sim.events.find((e) => e.spec.id === 'valley-sprint')!;
    return [900, 925, 890, 1040].map((distance, i) => {
      const progress = new RouteProgress(event.graph);
      progress.distance = distance;
      return {
        car: new Vehicle(i, 'medium', undefined, 'sport', TOURING_TC1),
        name: ['YOU', 'Nera', 'Ivo', 'Mara'][i],
        progress,
        finishTime: null as number | null,
      };
    });
  }

  it('selects nearest rivals in legal progress even when world positions are colocated', () => {
    const cars = grid();
    const gaps = rivalGaps(cars)!;
    expect(gaps.ahead).toMatchObject({ name: 'Nera', metres: 25 });
    expect(gaps.behind).toMatchObject({ name: 'Ivo', metres: 10 });
    cars[0].progress.distance = 930;
    expect(rivalGaps(cars)).toMatchObject({
      ahead: { name: 'Mara', metres: 110 },
      behind: { name: 'Nera', metres: 5 },
    });
  });

  it('retains full-lap distance and omits finishers, off-route opponents and invalid progress', () => {
    const cars = grid();
    cars[1].finishTime = 50;
    cars[2].progress.offRoute = true;
    cars[3].progress.distance = 5900;
    expect(rivalGaps(cars)).toEqual({
      ahead: { car: 3, name: 'Mara', metres: 5000 },
      behind: null,
    });
    cars[3].progress.distance = NaN;
    expect(rivalGaps(cars)).toBeNull();
    cars[0].progress.offRoute = true;
    expect(rivalGaps(grid().map((p, i) => (i === 0 ? cars[0] : p)))).toBeNull();
  });

  it('posts live gaps only during an active race and clears them on cancel/finish/passive activity', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
    sim.command({ type: 'start', event: 'valley-sprint' });
    expect(sim.status().event?.rivals).toBeNull();
    for (let i = 0; i < 120 * 3.4; i++) sim.step(1 / 120);
    expect(sim.status().mode).toBe('running');
    expect(sim.status().event?.rivals).not.toBeNull();
    sim.command({ type: 'cancel' });
    expect(sim.status().event?.rivals).toBeNull();
    sim.command({ type: 'continue' });
    expect(sim.status().event).toBeNull();
    sim.command({ type: 'start', event: 'coast-trap' });
    expect(sim.status().event?.rivals).toBeNull();
  });
});

describe('festival rival physical manoeuvre', () => {
  it('keeps the SC7 rear tyres loaded through the Saltmarsh opening pass and bend', () => {
    const sim = new OpenWorldSimulation({
      vehicle: 'sc7',
      weather: 'clear',
      assist: 'sport',
      seed: 73021,
      traffic: false,
      tileBudget: 12,
      session: 'sc7-saltmarsh-opening-pass-regression',
    });
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'start', event: 'saltmarsh-club-race' });
    const event = sim.events.find((candidate) => candidate.spec.id === 'saltmarsh-club-race')!;
    const initial = sim.cars.slice();
    const player = sim.player;
    const contact = vi.spyOn(sim.collisions, 'impulse');
    let offRoute = false,
      replaced = false,
      minimumRearLoad = Infinity,
      peakSpeed = 0;
    try {
      // This ordinary grid launch previously put one rear tyre beyond
      // the asphalt at ~14.3 s, spun across the road and hit a structure
      // at 16.7 s. Real contacts and the authored grip remain active.
      for (let tick = 0; tick < 25 * 120; tick++) {
        sim.step(1 / 120);
        peakSpeed = Math.max(peakSpeed, sim.player.speed);
        replaced ||= initial.some((car, index) => sim.cars[index] !== car);
        if (tick >= 10 * 120 && tick < 18 * 120)
          minimumRearLoad = Math.min(
            minimumRearLoad,
            sim.player.normalLoads[2],
            sim.player.normalLoads[3],
          );
        if (tick % 12 === 0) offRoute ||= sim.status().event?.offRoute === true;
      }
      expect(sim.status()).toMatchObject({
        mode: 'running',
        event: { id: 'saltmarsh-club-race', entrants: 4, offRoute: false },
      });
      expect(contact.mock.calls.filter(([a, b]) => a === player || b === player)).toHaveLength(0);
      expect(offRoute).toBe(false);
      expect(replaced).toBe(false);
      expect(minimumRearLoad).toBeGreaterThan(0);
      // Require racing pace and actual progress beyond the failed bend.
      expect(peakSpeed).toBeGreaterThan(50);
      expect(
        event.path.locate(player.body.position.x, player.body.position.z, 0, event.path.length),
      ).toBeGreaterThan(650);
    } finally {
      contact.mockRestore();
    }
  }, 60_000);

  it('overtakes a slower moving car through the real pedals, steering, tyres and contact solver', () => {
    const s = scenario(7.6, 5);
    // Physical acceptance uses the authored race line and road widths.
    const edge = s.sim.world.network.edges[5];
    const path = new RoutePath(
      s.sim.world.network,
      [{ edge: 5, dir: 1, from: 0, to: edge.length }],
      false,
    );
    const driver = new RouteDriver(s.car, path, 0.9, 0, 28);
    const lead = new RouteDriver(s.lead, path, 0.85, 0, 17);
    lead.overtake = false;
    const cars = [s.car, s.lead];
    const contact = vi.spyOn(s.sim.collisions, 'impulse');
    let sideBySide = 0,
      maxGap = -Infinity,
      resets = 0,
      passingSide = 0,
      sideChanges = 0;
    for (let tick = 0; tick < 120 * 18; tick++) {
      driver.update(1 / 120, cars);
      lead.update(1 / 120, cars);
      for (let sub = 0; sub < 2; sub++) {
        for (const car of cars) car.step(1 / 240, s.sim.asTrack);
        s.sim.collisions.solve(cars, s.sim.asTrack);
      }
      const gap = driver.d - lead.d;
      maxGap = Math.max(maxGap, gap);
      if (Math.abs(gap) < 4) {
        sideBySide++;
        if (!passingSide) passingSide = Math.sign(s.car.aiOffset);
        if (Math.sign(s.car.aiOffset) !== passingSide) sideChanges++;
      }
      if (driver.wantsReset || lead.wantsReset) resets++;
      if (gap > 30 && sideBySide > 0) break;
    }
    const physicalContacts = contact.mock.calls.filter((call) => call[1] !== null).length;
    contact.mockRestore();
    expect(sideBySide).toBeGreaterThan(0);
    expect(maxGap).toBeGreaterThan(25);
    expect(physicalContacts).toBe(0);
    expect(resets).toBe(0);
    expect(sideChanges).toBe(0);
    expect(s.car.up.y).toBeGreaterThan(0.9);
    expect(s.lead.up.y).toBeGreaterThan(0.9);
    Object.assign(s.car.input, controls());
  });

  it('brakes behind a stopping car on a narrow country road without contact or a reset', () => {
    const s = scenario(3.7, 17);
    const edge = s.sim.world.network.edges[17];
    const path = new RoutePath(
      s.sim.world.network,
      [{ edge: 17, dir: 1, from: 0, to: edge.length }],
      false,
    );
    s.place(s.car, 200, 0, 22);
    s.place(s.lead, 255, 0, 10);
    const follower = new RouteDriver(s.car, path, 0.9, 0, 28);
    const stopping = new RouteDriver(s.lead, path, 0.85, 0, 0);
    stopping.overtake = false;
    const cars = [s.car, s.lead];
    const contacts = vi.spyOn(s.sim.collisions, 'impulse');
    let smallestGap = Infinity;
    for (let tick = 0; tick < 25 * 120; tick++) {
      follower.update(1 / 120, cars);
      stopping.update(1 / 120, cars);
      for (let sub = 0; sub < 2; sub++) {
        for (const car of cars) car.step(1 / 240, s.sim.asTrack);
        s.sim.collisions.solve(cars, s.sim.asTrack);
      }
      smallestGap = Math.min(smallestGap, stopping.d - follower.d);
    }
    const contactCount = contacts.mock.calls.length;
    contacts.mockRestore();
    expect(contactCount).toBe(0);
    expect(
      smallestGap - s.car.definition.halfExtents[2] - s.lead.definition.halfExtents[2],
    ).toBeGreaterThan(2);
    expect(s.car.speed).toBeLessThan(0.2);
    expect(s.lead.speed).toBeLessThan(0.2);
    expect(follower.wantsReset).toBe(false);
    expect(stopping.wantsReset).toBe(false);
    expect(follower.decision).toBe('FOLLOW');
  });
});
