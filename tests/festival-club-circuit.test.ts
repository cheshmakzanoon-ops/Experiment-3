import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { controls } from '../src/simulation/config.ts';
import { BoxContact, ChassisBox } from '../src/simulation/obb.ts';
import { RouteProgress, validateRoute } from '../src/simulation/route-graph.ts';
import { SURFACE, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { insideFootprint, regionStructures } from '../src/simulation/open-world/placement.ts';
import { SOLVANE } from '../src/simulation/open-world/region-data.ts';
import {
  sharedPointErrors,
  validateRegionDefinition,
} from '../src/simulation/open-world/region-validation.ts';
import { pathPoint, planRoute } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

const world = openWorld();
const network = world.network;
const club = network.edges.filter((edge) => edge.road.id === 'saltmarsh-club');
const events = resolveEvents(world).filter((event) => event.spec.id.startsWith('saltmarsh-'));
const paved = [SURFACE.ASPHALT, SURFACE.PAINT];

describe('Saltmarsh club course connectivity and legal laps', () => {
  it('joins the public farm road with one access and two distinct loop directions', () => {
    expect(validateRegionDefinition(SOLVANE)).toEqual([]);
    expect(sharedPointErrors(SOLVANE, network)).toEqual([]);
    expect(validateRoute(network.routeSpec())).toEqual([]);
    const loop = club.find((edge) => edge.from === edge.to);
    expect(loop, 'the single access must preserve a closed club loop').toBeDefined();
    const node = network.nodes[loop!.from];
    const exits = network.leaving(node.index);
    expect(node.edges.filter((index) => index === loop!.index)).toHaveLength(2);
    expect(
      exits
        .filter(({ edge }) => edge === loop)
        .map(({ dir }) => dir)
        .sort(),
    ).toEqual([-1, 1]);
    expect(new Set(exits.map(({ edge, dir }) => `${edge.index}:${dir}`)).size).toBe(exits.length);
    expect(exits).toHaveLength(3);
    const access = exits.find(({ edge }) => edge.road.id === 'saltmarsh-access')!.edge;
    const farmNode = access.from === node.index ? access.to : access.from;
    expect(network.leaving(farmNode).some(({ edge }) => edge.road.id === 'farm')).toBe(true);

    // A driver can reach the course on actual graph edges, with no teleport
    // or disconnected visual-only connector.
    const approach = planRoute(
      network,
      [
        [-2350, -1500],
        [-1820, -1520],
      ],
      false,
    );
    const roads = approach.map((leg) => network.edges[leg.edge].road.id);
    expect(roads).toContain('farm');
    expect(roads).toContain('saltmarsh-access');
    expect(roads).toContain('saltmarsh-club');
    for (const edge of network.routeSpec().edges.filter((edge) => edge.id.startsWith('saltmarsh-')))
      expect(new Set(edge.next).size, `${edge.id} successor duplication`).toBe(edge.next.length);
  });

  it.each(['saltmarsh-club-race', 'saltmarsh-practice'])(
    '%s follows one complete, continuous club lap',
    (id) => {
      const event = events.find((candidate) => candidate.spec.id === id)!;
      expect(event).toBeDefined();
      expect(event.path.closed).toBe(true);
      expect(validateRoute(event.path.routeSpec(id))).toEqual([]);
      expect(event.path.legs.length).toBeGreaterThan(0);
      for (const leg of event.path.legs)
        expect(network.edges[leg.edge].road.id, 'access/farm roads cannot shorten a race lap').toBe(
          'saltmarsh-club',
        );
      const circumference = club.reduce((sum, edge) => sum + edge.length, 0);
      expect(event.path.length).toBeCloseTo(circumference, 2);
      expect(event.laps).toBe(id === 'saltmarsh-club-race' ? 2 : 1);
      expect(event.distance).toBeCloseTo(circumference * event.laps, 2);

      // Check actual consecutive route samples and the closing seam. A route
      // that jumps across the infield can have plausible endpoints and length.
      const path = event.path;
      for (let i = 0; i < path.count; i++) {
        const next = (i + 1) % path.count;
        expect(Math.hypot(path.x[next] - path.x[i], path.z[next] - path.z[i])).toBeLessThan(4);
        expect(Number.isFinite(path.y[i])).toBe(true);
      }
      const before = path.at(path.length - 0.05, pathPoint());
      const after = path.at(0.05, pathPoint());
      expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.11);
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.02);
      expect(after.tx * before.tx + after.tz * before.tz).toBeGreaterThan(0.999);
    },
  );

  it('credits the full two-lap checkpoint sequence and refuses an infield rejoin', () => {
    const event = events.find((candidate) => candidate.spec.id === 'saltmarsh-club-race')!;
    const path = event.path;
    const p = pathPoint();
    const progress = new RouteProgress(event.graph, path.maxHalfWidth() + 8);
    for (let lap = 0; lap < 2; lap++) {
      for (let distance = lap === 0 ? 0 : 4; distance < path.length; distance += 4) {
        path.at(distance, p);
        progress.update(p);
        expect(progress.offRoute).toBe(false);
      }
      path.at(2, p);
      progress.update(p);
      expect(progress.laps).toBe(lap + 1);
    }
    const shortcut = new RouteProgress(event.graph, path.maxHalfWidth() + 8);
    for (let distance = 0; distance <= 100; distance += 4) {
      path.at(distance, p);
      shortcut.update(p);
    }
    const legal = shortcut.distance;
    path.at(path.length * 0.55, p);
    shortcut.update(p);
    expect(shortcut.offRoute).toBe(true);
    expect(shortcut.distance).toBe(legal);
    expect(shortcut.laps).toBe(0);
  });
});

describe('Saltmarsh physical driving corridor', () => {
  it('uses bare asphalt at the centre and tyre-readable paint at both authored edge lines', () => {
    const track = new OpenWorldTrack(world, 'clear', undefined, 12);
    const edge = club[0];
    const p = trackPoint();
    const surface = surfaceSample();
    // A sample well away from the access isolates the circuit marking mode.
    network.pointOnSegment(edge.first + 80, 0.5, p);
    for (const [lateral, expected] of [
      [0, SURFACE.ASPHALT],
      [-edge.spec.halfWidth + 0.65, SURFACE.PAINT],
      [edge.spec.halfWidth - 0.65, SURFACE.PAINT],
      [-edge.spec.halfWidth + 0.9, SURFACE.ASPHALT],
      [edge.spec.halfWidth - 0.9, SURFACE.ASPHALT],
    ]) {
      const height = network.surfaceHeight(p, lateral, edge.spec.halfWidth, edge.spec.crown);
      track.sample(p.x + p.nx * lateral, p.z + p.nz * lateral, surface, height + 0.7);
      expect(track.query.onRoad).toBe(true);
      expect(surface.surface, `marking at lateral ${lateral}`).toBe(expected);
    }
  });

  it('keeps the full running width paved with finite, grade-limited banked contact through every corner', () => {
    const track = new OpenWorldTrack(world, 'clear', undefined, 12);
    const p = trackPoint();
    const surface = surfaceSample();
    const down = new Vec3(0, -1, 0);
    const origin = new Vec3();
    let samples = 0;
    let curved = 0;
    let banked = 0;
    let maxHeightError = 0;
    for (const edge of club) {
      expect(edge.spec.halfWidth * 2).toBe(11);
      expect(edge.spec.surface).toBe('asphalt');
      for (let segment = edge.first; segment < edge.last; segment++) {
        const ds = network.s[segment + 1] - network.s[segment];
        const grade = Math.abs(network.y[segment + 1] - network.y[segment]) / ds;
        expect(grade).toBeLessThanOrEqual(edge.spec.maxGrade + 1e-6);
        network.pointOnSegment(segment, 0.5, p);
        expect(Math.abs(p.bank)).toBeLessThanOrEqual(edge.spec.maxBank + 1e-6);
        if (Math.abs(p.curvature) > 0.004) curved++;
        if (Math.abs(p.bank) > 0.02) banked++;
        for (const lateral of [-5.35, -2.6, 0, 2.6, 5.35]) {
          const x = p.x + p.nx * lateral;
          const z = p.z + p.nz * lateral;
          const expected = network.surfaceHeight(p, lateral, edge.spec.halfWidth, edge.spec.crown);
          track.sample(x, z, surface, expected + 0.7);
          expect(track.query.onRoad, `${edge.id}:${segment} lateral ${lateral}`).toBe(true);
          expect(paved).toContain(surface.surface);
          expect(surface.grip).toBeGreaterThan(0.85);
          expect(
            [surface.height, surface.normal.x, surface.normal.y, surface.normal.z].every(
              Number.isFinite,
            ),
          ).toBe(true);
          expect(surface.normal.length()).toBeCloseTo(1, 5);
          expect(surface.normal.y).toBeGreaterThan(0.98);
          maxHeightError = Math.max(maxHeightError, Math.abs(surface.height - expected));
          // Contact rays read the same surface as the tyres. This catches a
          // corner that is visually paved but has no reachable suspension hit.
          origin.set(x, surface.height + 0.7, z);
          expect(track.cast(origin, down, 1.2, surface)).toBeCloseTo(0.7, 3);
          samples++;
        }
      }
    }
    expect(samples).toBeGreaterThan(4000);
    expect(curved).toBeGreaterThan(100);
    expect(banked).toBeGreaterThan(100);
    expect(maxHeightError).toBeLessThan(0.06);
  }, 30000);

  it('keeps every solid structure outside the running corridor, including the access', () => {
    const structures = regionStructures(world);
    const edges = network.edges.filter((edge) => edge.road.id.startsWith('saltmarsh-'));
    const blocked: string[] = [];
    for (const edge of edges)
      for (let segment = edge.first; segment < edge.last; segment++) {
        const x = (network.x[segment] + network.x[segment + 1]) / 2;
        const z = (network.z[segment] + network.z[segment + 1]) / 2;
        const ds = network.s[segment + 1] - network.s[segment];
        // The expanded footprint conservatively encloses this whole sampled
        // road strip, not just its center or a few points on its edges.
        const pad = edge.spec.halfWidth + ds / 2;
        for (const structure of structures) {
          const reach = Math.hypot(structure.hx, structure.hz) + pad * Math.SQRT2;
          if (Math.abs(structure.x - x) > reach || Math.abs(structure.z - z) > reach) continue;
          if (insideFootprint(structure, x, z, pad))
            blocked.push(
              `${edge.id}:${segment} ${structure.kind} at ${structure.x},${structure.z}`,
            );
        }
      }
    expect(blocked).toEqual([]);
  });

  it.each(['rh3', 'sc7'])(
    'places all four %s race-grid chassis on asphalt without overlap',
    (vehicle) => {
      const sim = new OpenWorldSimulation({ vehicle, traffic: false, tileBudget: 12 });
      sim.command({ type: 'start', event: 'saltmarsh-club-race' });
      expect(sim.status().mode).toBe('countdown');
      expect(sim.cars).toHaveLength(4);
      const surface = surfaceSample();
      const corner = new Vec3();
      const boxes = sim.cars.map((car) => {
        for (const side of [-1, 1])
          for (const end of [-1, 1]) {
            car.body.orientation
              .rotate(
                corner.set(
                  side * car.definition.halfExtents[0],
                  0,
                  end * car.definition.halfExtents[2],
                ),
                corner,
              )
              .add(car.body.position);
            sim.track.sample(corner.x, corner.z, surface, corner.y);
            expect(sim.track.query.onRoad, `${car.definition.id} corner ${side},${end}`).toBe(true);
            expect(paved).toContain(surface.surface);
            expect(network.edges[sim.track.query.edge].road.id).toBe('saltmarsh-club');
          }
        const box = new ChassisBox();
        box.half = car.definition.halfExtents;
        return box.update(car.body);
      });
      const contact = new BoxContact();
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          expect(contact.intersect(boxes[i], boxes[j]), `grid slots ${i} and ${j}`).toBe(false);
    },
  );
});

describe('Saltmarsh normal session commands', () => {
  it('starts, retries, returns to the garage and launches solo practice in the selected car', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false, tileBudget: 12 });
    sim.command({ type: 'start', event: 'saltmarsh-club-race' });
    for (let i = 0; i < 120 * 3.25; i++) sim.step(1 / 120);
    expect(sim.status()).toMatchObject({
      mode: 'running',
      autopilot: false,
      event: { id: 'saltmarsh-club-race', entrants: 4, laps: 2, offRoute: false },
    });
    const oldPlayer = sim.player;
    sim.command({ type: 'start', event: 'saltmarsh-club-race' });
    expect(sim.player).not.toBe(oldPlayer);
    expect(sim.status()).toMatchObject({
      mode: 'countdown',
      event: { progress: 0, lap: 1, entrants: 4 },
    });
    expect(sim.takeResult()).toMatchObject({
      eventId: 'saltmarsh-club-race',
      abandoned: true,
      completed: false,
    });
    expect(sim.takeResult()).toBeNull();
    sim.command({ type: 'cancel' });
    sim.command({ type: 'continue' });
    expect(sim.status().mode).toBe('free');
    expect(sim.cars).toHaveLength(1);
    sim.command({ type: 'vehicle', id: 'sc7' });
    expect(sim.player.definition.id).toBe('sc7');
    sim.command({ type: 'start', event: 'saltmarsh-practice' });
    expect(sim.cars).toHaveLength(1);
    for (let i = 0; i < 120 * 3.1; i++) sim.step(1 / 120);
    sim.setInput({ ...controls(), throttle: 0.65 });
    for (let i = 0; i < 120; i++) sim.step(1 / 120);
    expect(sim.status()).toMatchObject({
      mode: 'running',
      vehicleId: 'sc7',
      autopilot: false,
      event: { id: 'saltmarsh-practice', entrants: 1, laps: 1, offRoute: false },
      road: { onRoad: true },
    });
    expect(sim.player.speed).toBeGreaterThan(1);
    expect(sim.player.up.y).toBeGreaterThan(0.95);
  }, 30000);
});
