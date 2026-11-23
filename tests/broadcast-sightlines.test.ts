import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { FORMULA_TELEPHOTO, TracksideDirector } from '../src/rendering/trackside.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { GRANDSTANDS, buildGrandstand, standMaterials } from '../src/rendering/grandstand.ts';
import { RaceComposition } from '../src/rendering/race-composition.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, carBase } from '../src/simulation/protocol.ts';
import { serviceSitePlan } from '../src/rendering/venue-service-plan.ts';
import { buildServiceAreas } from '../src/rendering/venue-service.ts';

describe('actual static geometry broadcast sightlines', () => {
  it('uses oriented solid bounds, not an enclosing empty grandstand volume', () => {
    const world = new T.Group(),
      roof = new T.Mesh(new T.BoxGeometry(10, 0.12, 8));
    world.rotation.y = 0.31;
    world.position.set(12, 3, -7);
    roof.position.y = 4;
    roof.rotation.z = 0.16;
    world.add(roof);
    const sight = new BroadcastSightlines();
    sight.add(roof);
    const a = new T.Vector3(0, 3, 0),
      b = new T.Vector3(0, 5, 0);
    world.updateMatrixWorld(true);
    a.applyMatrix4(world.matrixWorld);
    b.applyMatrix4(world.matrixWorld);
    expect(sight.blocked(a, b)).toBe(true);
    expect(sight.blocked(b, a)).toBe(true);
    expect(
      sight.blocked(
        new T.Vector3(-3, 2, 0).applyMatrix4(world.matrixWorld),
        new T.Vector3(3, 2, 0).applyMatrix4(world.matrixWorld),
      ),
    ).toBe(false);
    expect(sight.blocked(a, a)).toBe(false);
    roof.geometry.dispose();
  });
  it('does not mistake an obstruction beyond the subject for a blocked lens', () => {
    const solid = new T.Mesh(new T.BoxGeometry(2, 2, 2));
    solid.position.z = 10;
    const sight = new BroadcastSightlines();
    sight.add(solid);
    expect(sight.blocked(new T.Vector3(), new T.Vector3(0, 0, 5))).toBe(false);
    expect(sight.blocked(new T.Vector3(), new T.Vector3(0, 0, 12))).toBe(true);
    expect(() => sight.blocked(new T.Vector3(NaN, 0, 0), new T.Vector3())).toThrow();
    solid.geometry.dispose();
  });
  it('cuts to an existing visible neighbour and stays there until coverage expires', () => {
    const track = new Track(),
      blocked = new Set([0]);
    let calls = 0;
    const d: TracksideDirector = new TracksideDirector(track, (from): boolean => {
      calls++;
      return blocked.has(d.rigs.findIndex((r) => r.position.equals(from)));
    });
    const point = track.at(0, trackPoint()),
      target = new T.Vector3(point.x, point.y + 0.5, point.z),
      velocity = new T.Vector3();
    d.update(0, target, velocity, 1 / 60);
    expect(d.activeId).not.toBe(0);
    expect(d.occluded).toBe(false);
    expect(d.position.equals(d.rigs[d.activeId].position)).toBe(true);
    expect(calls).toBeLessThanOrEqual(5);
    const original = d.activeId;
    d.update(0, target, velocity, 0);
    expect(d.activeId).toBe(original);
    expect(d.visibilityCuts).toBe(1);
    blocked.clear();
    d.reset();
    d.update(0, target, velocity, 0);
    expect(d.activeId).toBe(0);
  });
  it('reports an unresolved fully blocked shot rather than claiming it fits', () => {
    const t = new Track(),
      d = new TracksideDirector(t, () => true),
      p = t.at(0, trackPoint());
    d.update(0, new T.Vector3(p.x, p.y, p.z), new T.Vector3(), 0);
    expect(d.occluded).toBe(true);
    expect(d.framingFits).toBe(false);
  });
  it('registers actual built shelter solids and stand canopy before geometry batching', () => {
    const track = new Track(),
      props = new T.Group(),
      sight = new BroadcastSightlines(),
      sites = serviceSitePlan(track);
    buildServiceAreas(props, sites, sight);
    expect(sight.count).toBe(
      sites.length * 4 + sites.filter((s) => s.kind === 'maintenance').length,
    );
    // No DOM-dependent sign material is required for this geometric integration.
    const simple = new T.MeshStandardMaterial();
    const m = {
      concrete: simple,
      steel: simple,
      roof: simple,
      underside: simple,
      seats: simple,
      people: simple,
      sign: simple,
    } as ReturnType<typeof standMaterials>;
    const before = sight.count;
    buildGrandstand(track, props, new T.Group(), GRANDSTANDS[0], m, undefined, sight);
    expect(sight.count).toBe(before + 1);
    props.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    simple.dispose();
  });
});

it('moves a Formula battle to a clear physical lens when a support covers only the front corner', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1, vehicles: ['apx01', 'fx26'] });
  const frame = sim.makeFrame(),
    o = carBase(0);
  const shot = new RaceComposition().update(frame, 0, 3.1, true);
  const witness = shot.visibility!;
  expect(witness.points.length).toBe(7);
  const director: TracksideDirector = new TracksideDirector(
    sim.track,
    (from, to) => from.equals(director.rigs[0].position) && to.equals(witness.points[0]),
  );
  const result = director.update(
    frame[o + F.S],
    shot.target,
    shot.velocity,
    0,
    16 / 9,
    shot.radius,
    true,
    witness,
    FORMULA_TELEPHOTO,
  );
  expect(result.activeId).not.toBe(0);
  expect(result.subjectVisibleSamples).toBe(result.subjectSampleCount);
  expect(result.framingFits).toBe(true);
  expect(result.position.toArray()).toEqual(director.rigs[result.activeId].position.toArray());
  const id = result.activeId;
  director.update(
    frame[o + F.S],
    shot.target,
    shot.velocity,
    0,
    16 / 9,
    shot.radius,
    true,
    witness,
    FORMULA_TELEPHOTO,
  );
  expect(result.activeId).toBe(id);
  shot.update(frame, 0);
  expect(shot.visibility).toBeUndefined();
  shot.update(frame, 0, 3.1, true);
  expect(shot.visibility!.points).toHaveLength(7);
  // The bound for a feeder car follows its measured axle locations.
  const p = sim.cars[1].definition.wheelPositions[0];
  shot.update(frame, 1, 3.1, true);
  const v = new T.Vector3(p[0], -0.08, p[2])
    .applyQuaternion(
      new T.Quaternion(
        frame[carBase(1) + F.QX],
        frame[carBase(1) + F.QY],
        frame[carBase(1) + F.QZ],
        frame[carBase(1) + F.QW],
      ).normalize(),
    )
    .add(new T.Vector3(frame[carBase(1) + F.X], frame[carBase(1) + F.Y], frame[carBase(1) + F.Z]));
  expect(shot.visibility!.points[0].distanceTo(v)).toBeLessThan(0.0001);
});
