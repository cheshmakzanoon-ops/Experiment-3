import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { EventMarkers } from '../src/rendering/open-world/markers.ts';
import { startBoardSite } from '../src/rendering/open-world/festival-start-board.ts';
import { roadCandidates } from '../src/simulation/open-world/road-network.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

const world = openWorld(),
  events = resolveEvents(world);
describe('original Solvane start boards', () => {
  it('finds a distinct installation outside all the same-level carriageways for every start', () => {
    const occupied: { x: number; z: number }[] = [],
      c = roadCandidates(),
      net = world.network;
    for (const e of events) {
      const site = startBoardSite(e, occupied);
      expect(site, e.spec.id).not.toBeNull();
      if (!site) continue;
      const count = net.covering(site.x, site.z, site.y, 1, c);
      for (let k = 0; k < count; k++)
        expect(
          c.distance[k] - net.edges[net.edgeOf[c.segment[k]]].spec.halfWidth,
        ).toBeGreaterThanOrEqual(0.67);
      for (const prior of occupied)
        expect(Math.hypot(prior.x - site.x, prior.z - site.z)).toBeGreaterThanOrEqual(3);
      occupied.push(site);
    }
  });
  it('keeps the physical face in place through a race and submits distant navigation only on approach', () => {
    const marks = new EventMarkers(events, (_x, _z, layer) => layer ?? 0);
    const start = marks.root.getObjectByName('Marker ' + events[0].spec.id)!;
    const known = new Set([events[0].spec.id]),
      eye = start.position.clone().addScalar(1);
    const board = start.getObjectByName('Roadside timing board') as T.Mesh;
    const glow = start.children.find((c) => c !== board)!;
    marks.update(1, known, null, null, () => 0, eye);
    expect(board.visible).toBe(true);
    expect(glow.visible).toBe(false);
    eye.x += 80;
    marks.update(2, known, null, null, () => 0, eye);
    expect(glow.visible).toBe(true);
    marks.update(3, known, events[0].spec.id, null, () => 0, eye);
    expect(board.visible && start.visible).toBe(true);
    expect(glow.visible).toBe(false);
    eye.x += 1300;
    marks.update(4, known, null, null, () => 0, eye);
    expect(start.visible).toBe(false);
    expect(board.material).toBeInstanceOf(T.MeshStandardMaterial);
    expect(board.geometry.index!.count / 3).toBeLessThan(800);
    marks.dispose();
  });
});
