import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { addTownFootway, footwayStations } from '../src/rendering/open-world/festival-footway.ts';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import { OpenWorldTrack, WORLD_SURFACE } from '../src/simulation/open-world/open-world-track.ts';
import { footwayHeight, townFootways } from '../src/simulation/open-world/town-footways.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { surfaceSample, trackPoint } from '../src/simulation/track.ts';

const world = openWorld(),
  net = world.network,
  track = new OpenWorldTrack(world, 'rain');
const paving = townFootways(net);
const groundHeight = FestivalRenderer.prototype.groundHeight.bind({ world } as FestivalRenderer);

function segmentAt(x: number, z: number) {
  const p = trackPoint();
  net.nearest(x, z, p);
  return { i: net.lastSegment, e: net.edges[net.edgeOf[net.lastSegment]], p };
}

describe('Port Ilse footway and tyre construction', () => {
  it('places the actual rendered flagstones and both shoulders on the same support plane as the tyres and effects', () => {
    const { i, e } = segmentAt(1100, -2600);
    const p = net.pointOnSegment(i, 0, trackPoint()),
      q = net.pointOnSegment(i, 1, trackPoint());
    const mid = net.pointOnSegment(i, 0.5, trackPoint());
    for (const side of [-1, 1]) {
      const pos: number[] = [],
        indices: number[] = [];
      const batch = {
        vertex(x: number, y: number, z: number) {
          pos.push(x, y, z);
          return pos.length / 3 - 1;
        },
        quad(a: number, b: number, c: number, d: number) {
          indices.push(a, c, b, b, c, d);
        },
      };
      addTownFootway(
        batch,
        e,
        p,
        q,
        side,
        net.surfaceHeight(p, side * e.spec.halfWidth, e.spec.halfWidth, e.spec.crown),
        net.surfaceHeight(q, side * e.spec.halfWidth, e.spec.halfWidth, e.spec.crown),
        paving.strength(e, i, 0, side),
        paving.strength(e, i, 1, side),
      );
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setIndex(indices);
      const m = new T.MeshBasicMaterial(),
        mesh = new T.Mesh(g, m);
      for (const d of [0.07, 0.16, 0.205, 0.255, 0.32, 0.4, 1, 1.85, 2.25]) {
        const l = side * (e.spec.halfWidth + d),
          x = mid.x + mid.nx * l,
          z = mid.z + mid.nz * l;
        const hit = new T.Raycaster(
          new T.Vector3(x, mid.y + 1, z),
          new T.Vector3(0, -1, 0),
        ).intersectObject(mesh)[0];
        expect(hit, 'upward winding').toBeDefined();
        const s = track.sample(x, z, surfaceSample(), mid.y + 1);
        expect(track.query.surface).toBe(WORLD_SURFACE.PAVEMENT);
        expect(s.resistance).toBeCloseTo(0.016, 6);
        expect(s.water).toBeGreaterThan(0);
        expect(Math.abs(hit.point.y - s.height)).toBeLessThan(0.001);
        expect(Math.abs(groundHeight(x, z, mid.y + 1) - s.height)).toBeLessThan(0.001);
        expect(
          hit.face!.normal.dot(new T.Vector3(s.normal.x, s.normal.y, s.normal.z)),
        ).toBeGreaterThan(0.999);
      }
      g.dispose();
      m.dispose();
    }
  });

  it('rolls the actual steered tyre crown up the bevel without an impulsive jump or a phantom step', () => {
    const { e, p } = segmentAt(1100, -2600);
    const radius = 0.34,
      half = 0.117,
      down = new Vec3(0, -1, 0);
    for (const side of [-1, 1])
      for (const steering of [0, 0.62, Math.PI / 2]) {
        const axle = new Vec3(
          p.nx * Math.cos(steering) + p.tx * Math.sin(steering),
          0,
          p.nz * Math.cos(steering) + p.tz * Math.sin(steering),
        ).normalize();
        const base = net.surfaceHeight(p, side * e.spec.halfWidth, e.spec.halfWidth, e.spec.crown);
        let last = 0,
          crest = -Infinity,
          advanced = false;
        for (let k = 0; k <= 140; k++) {
          const d = -0.12 + k * 0.005,
            l = side * (e.spec.halfWidth + d);
          const origin = new Vec3(p.x + p.nx * l, base + 0.9, p.z + p.nz * l);
          const s = surfaceSample(),
            contact = new Vec3();
          const length = track.castTire(origin, down, 1.4, radius, half, axle, s, contact);
          const h = origin.y - length - base - radius;
          if (k > 0) expect(Math.abs(h - last), 'travel at each 5 mm step').toBeLessThan(0.006);
          expect(s.normal.length()).toBeCloseTo(1, 6);
          expect(s.normal.y).toBeGreaterThan(0.7);
          expect(
            Math.abs(track.groundHeight(contact.x, contact.z, contact.y + 0.5) - contact.y),
          ).toBeLessThan(0.002);
          if (d < 0.19 && h > footwayHeight(d, 1) + 0.015) advanced = true;
          last = h;
          crest = Math.max(crest, h);
        }
        expect(crest).toBeGreaterThan(0.08);
        expect(crest).toBeLessThan(0.093);
        if (steering === Math.PI / 2) expect(advanced).toBe(true);
      }
  });

  it('holds every rendered kerb station within 2 mm of the full street section while removing redundant spans', () => {
    let source = 0,
      cooked = 0;
    for (const e of net.edges.filter((e) => e.roadClass === 'town'))
      for (const side of [-1, 1]) {
        const retained = footwayStations(net, e, side, 512);
        expect(retained[0]).toBe(e.first);
        expect(retained.at(-1)).toBe(e.last);
        const section = (i: number, d: number) => {
          const j = Math.min(i, e.last - 1),
            t = i - j,
            p = net.pointOnSegment(j, t, trackPoint()),
            l = side * (e.spec.halfWidth + d);
          return new T.Vector3(
            p.x + p.nx * l,
            net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown) +
              footwayHeight(d, paving.strength(e, j, t, side)),
            p.z + p.nz * l,
          );
        };
        for (let k = 1; k < retained.length; k++) {
          const a = retained[k - 1],
            b = retained[k];
          source += b - a;
          cooked++;
          for (const d of [0.07, 0.31, 0.45, 1.56, 2.4]) {
            const begin = section(a, d),
              end = section(b, d);
            for (let i = a + 1; i < b; i++) {
              const t = (net.s[i] - net.s[a]) / (net.s[b] - net.s[a]);
              const ref = section(i, d),
                actual = begin.clone().lerp(end, t);
              expect(Math.abs(actual.y - ref.y)).toBeLessThan(0.00201);
              expect(Math.hypot(actual.x - ref.x, actual.z - ref.z)).toBeLessThan(0.00201);
            }
          }
        }
      }
    expect(cooked / source).toBeLessThan(0.4);
  });

  it('opens the crossing through a joining street and meets unchanged terrain at the return', () => {
    const { e, i, p } = segmentAt(1252, -2600);
    const joinSide = Math.sign(p.nz); // Bell Street leaves Harbour Front to the north (+Z).
    expect(paving.strength(e, i, 0.5, joinSide)).toBe(0);
    const smp = track.sample(1250, -2594, surfaceSample());
    expect([WORLD_SURFACE.ASPHALT, WORLD_SURFACE.MARKING]).toContain(track.query.surface);
    expect(smp.normal.y).toBeGreaterThan(0.99);
    for (const blend of [0, 0.35, 1]) {
      expect(footwayHeight(e.spec.shoulder, blend)).toBeCloseTo(-0.06 - 0.03 * e.spec.shoulder, 8);
    }
  });
});
