import { expect, it } from 'vitest';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { planRoute } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { trackPoint } from '../src/simulation/track.ts';

it('takes the block in the car’s travel direction when the closest marker lies behind it', () => {
  const world = openWorld(),
    net = world.network;
  const edge = net.edges.find(
    (e) =>
      e.road.id === 'harbour' &&
      net.nodes[e.from].edges.length > 2 &&
      net.nodes[e.to].edges.length > 2 &&
      e.length > 150,
  )!;
  const left = net.at(edge.offset + 0.3 * edge.length, trackPoint()),
    right = net.at(edge.offset + 0.7 * edge.length, trackPoint());
  for (const [from, to, dir] of [
    [left, right, -1],
    [right, left, 1],
  ] as const) {
    const heading = Math.atan2(dir * from.tx, dir * from.tz);
    const legs = planRoute(
      net,
      [
        [from.x, from.z],
        [to.x, to.z],
      ],
      false,
      { heading, height: from.y + 0.5 },
    );
    expect(legs[0].edge).toBe(edge.index);
    expect(legs[0].dir).toBe(dir);
    expect(legs.at(-1)!.edge).toBe(edge.index);
    expect(legs.length).toBeGreaterThan(2);
    expect(legs.at(-1)!.to + edge.offset).toBeCloseTo(to.s, 2);
  }
});
it('resumes a harbour cruise after marker stops without resetting the player into the opposite lane', () => {
  const sim = new OpenWorldSimulation({
    vehicle: 'rh3',
    weather: 'clear',
    assist: 'sport',
    seed: 73335,
    traffic: true,
    tileBudget: 16,
  });
  const original = sim.player;
  let peakTraffic = 0,
    distance = 0,
    x = original.body.position.x,
    z = original.body.position.z;
  sim.command({ type: 'autopilot', value: true });
  for (let i = 0; i < 120 * 120; i++) {
    sim.step(1 / 120);
    if (!sim.autopilot && i % 600 === 0) sim.command({ type: 'autopilot', value: true });
    const p = sim.player.body.position;
    distance += Math.hypot(p.x - x, p.z - z);
    x = p.x;
    z = p.z;
    peakTraffic = Math.max(peakTraffic, sim.traffic.cars.length);
    if (sim.player !== original) throw Error('Cruise required recovery at ' + sim.time);
  }
  expect(distance).toBeGreaterThan(1500);
  expect(peakTraffic).toBeGreaterThan(8);
}, 60000);
