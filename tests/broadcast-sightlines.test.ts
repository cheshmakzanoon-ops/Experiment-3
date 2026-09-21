import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { TracksideDirector } from '../src/rendering/trackside.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { GRANDSTANDS, buildGrandstand, standMaterials } from '../src/rendering/grandstand.ts';
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
