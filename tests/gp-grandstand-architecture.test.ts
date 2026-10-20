import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track } from '../src/simulation/track.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { buildGrandstand, standFrame, standMaterials } from '../src/rendering/grandstand.ts';
import { venuePlan } from '../src/rendering/venue-plan.ts';
import {
  buildGpGrandstandArchitecture,
  gpGrandstandRoofGeometry,
  gpGrandstandStyle,
} from '../src/rendering/venue-kit/gp-grandstand-architecture.ts';

const venues = [
  'poggio-alto',
  'cape-wrenna',
  'haarveld',
  'montejaral',
  'steinhorn',
  'zafra-night',
] as const;
function materials() {
  return Object.fromEntries(
    ['concrete', 'steel', 'roof', 'underside', 'seats', 'people', 'sign'].map((name) => [
      name,
      new T.MeshStandardMaterial(),
    ]),
  ) as ReturnType<typeof standMaterials>;
}
function release(root: T.Object3D) {
  const geometry = new Set<T.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof T.Mesh) {
      geometry.add(object.geometry);
      if (object instanceof T.InstancedMesh) object.dispose();
    }
  });
  geometry.forEach((g) => g.dispose());
}
function instances(root: T.Object3D) {
  const result: { matrices: number[]; colours: number[] }[] = [];
  root.traverse((object) => {
    if (object instanceof T.InstancedMesh)
      result.push({
        matrices: [...object.instanceMatrix.array],
        colours: object.instanceColor ? [...object.instanceColor.array] : [],
      });
  });
  return result;
}

describe('GP spectator-side venue architecture', () => {
  it('replaces Cape Wrenna terraces that intersect their own curved corridor', () => {
    const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']),
      sites = venuePlan(track).grandstands;
    expect(sites.some((site) => site.s === 549 || site.s === 1186)).toBe(false);
    // Rejected sites do not consume the planning budget. One later safe authored
    // location replaces two unsafe terraces, leaving six clear spectator sites.
    expect(sites).toHaveLength(6);
  });
  it.each(venues)('%s has a closed, correctly wound canopy on both sides', (id) => {
    const material = new T.MeshBasicMaterial();
    for (const side of [-1, 1] as const) {
      const geometry = gpGrandstandRoofGeometry(id, 80, side),
        canopy = new T.Mesh(geometry, material);
      canopy.updateMatrixWorld(true);
      for (const u of [-1.2, 1.4, 4.5, 8, 10.2])
        for (const z of [-35, -13, 0, 16, 38]) {
          const down = new T.Raycaster(
              new T.Vector3(side * u, 15, z),
              new T.Vector3(0, -1, 0),
            ).intersectObject(canopy),
            up = new T.Raycaster(
              new T.Vector3(side * u, 4.9, z),
              new T.Vector3(0, 1, 0),
            ).intersectObject(canopy);
          expect(down.length).toBeGreaterThan(0);
          expect(up.length).toBeGreaterThan(0);
          expect(down[0].point.y - up[0].point.y).toBeCloseTo(0.16, 4);
          expect(down[0].face!.normal.y).toBeGreaterThan(0.9);
          expect(up[0].face!.normal.y).toBeLessThan(-0.9);
          expect(up[0].point.y).toBeGreaterThan(5.9);
        }
      for (const attribute of Object.values(geometry.attributes))
        expect([...attribute.array].every(Number.isFinite)).toBe(true);
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < normal.count; i++)
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      geometry.dispose();
    }
    material.dispose();
  });

  it.each(venues)('%s preserves the existing seats, audience and clear riding corridor', (id) => {
    const track = new Track('clear', false, undefined, CIRCUITS[id]),
      original = Object.create(track) as Track,
      m = materials(),
      trackBefore = track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank]);
    // Select the retained generic architecture on an otherwise identical
    // physical track. This tests integration against the unchanged fallback,
    // rather than reimplementing the seating algorithm in an assertion.
    Object.defineProperty(original, 'circuit', { value: { ...track.circuit, id: 'aurel' } });
    for (const site of venuePlan(track).grandstands) {
      const currentProps = new T.Group(),
        oldProps = new T.Group(),
        audience = new T.Group(),
        oldAudience = new T.Group(),
        sight = new BroadcastSightlines(),
        old = buildGrandstand(original, oldProps, oldAudience, site, m),
        current = buildGrandstand(track, currentProps, audience, site, m, undefined, sight),
        seats = current.getObjectByName(`Seats ${site.s}m`) as T.InstancedMesh,
        oldSeats = old.getObjectByName(`Seats ${site.s}m`) as T.InstancedMesh;
      expect(current.position).toEqual(old.position);
      expect(current.quaternion.toArray()).toEqual(old.quaternion.toArray());
      expect(current.userData.corridorClearance).toBe(old.userData.corridorClearance);
      expect(current.userData.corridorClearance).toBeGreaterThan(2);
      expect(seats.count).toBe(oldSeats.count);
      expect(seats.instanceMatrix.array).toEqual(oldSeats.instanceMatrix.array);
      expect(instances(audience)).toEqual(instances(oldAudience));
      expect(sight.count).toBe(1);
      current.updateMatrixWorld(true);
      const architecture = current.children.find((child) => child.userData.gpGrandstand)!;
      expect(architecture).toBeDefined();
      expect(architecture.children).toHaveLength(5);
      let triangles = 0;
      architecture.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const g = object.geometry as T.BufferGeometry,
          position = g.getAttribute('position');
        triangles += (g.index?.count ?? position.count) / 3;
        for (const attribute of Object.values(g.attributes))
          expect([...attribute.array].every(Number.isFinite)).toBe(true);
        // Batches are in the same retained site frame; no new part crosses
        // toward the road or extends into an adjacent stand's longitudinal bay.
        let inner = Infinity,
          outer = -Infinity,
          end = 0;
        const v = new T.Vector3();
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(object.matrix);
          inner = Math.min(inner, v.x * site.side);
          outer = Math.max(outer, v.x * site.side);
          end = Math.max(end, Math.abs(v.z));
        }
        expect(inner).toBeGreaterThanOrEqual(-1.91);
        expect(outer).toBeLessThanOrEqual(11.01);
        expect(end).toBeLessThanOrEqual(site.length / 2 + 0.76);
      });
      expect(triangles).toBeLessThan(site.length * 300 + 2000);
      current.updateMatrixWorld(true);
      // The new canopy must never invent a wall through its seated public.
      expect(
        sight.blocked(
          current.localToWorld(new T.Vector3(-20, 4.9, 0)),
          current.localToWorld(new T.Vector3(20, 4.9, 0)),
        ),
      ).toBe(false);
      for (const root of [currentProps, oldProps, audience, oldAudience]) release(root);
    }
    expect(track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank])).toEqual(trackBefore);
    Object.values(m).forEach((material) => material.dispose());
  });

  it('gives every GP venue a visibly different roof profile without changing other venues', () => {
    const signatures = venues.map((id) => {
      const g = gpGrandstandRoofGeometry(id, 80),
        signature = [...g.getAttribute('position').array].join(',');
      g.dispose();
      return signature;
    });
    expect(new Set(signatures).size).toBe(venues.length);
    for (const id of ['aurel', 'parco-reale', 'valley-ridge-mx'] as const) {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        parent = new T.Group(),
        site = { s: 0, side: 1 as const, length: 80 };
      expect(gpGrandstandStyle(id)).toBeNull();
      expect(
        buildGpGrandstandArchitecture(
          track,
          parent,
          site,
          standFrame(track, site),
          null as unknown as ReturnType<typeof materials>,
        ),
      ).toBeNull();
      expect(parent.children).toHaveLength(0);
    }
    for (const length of [0, -1, NaN, Infinity, 1000])
      expect(() => gpGrandstandRoofGeometry('haarveld', length)).toThrow();
  });
});

describe('GP grandstand naming and shared materials', () => {
  const drawn: string[] = [];
  beforeAll(() =>
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillRect() {}, fillText: (value: string) => drawn.push(value) }),
      }),
    }),
  );
  afterAll(() => vi.unstubAllGlobals());
  it.each(venues)('%s prints its own name once for every shared stand material', (id) => {
    const track = new Track('clear', false, undefined, CIRCUITS[id]),
      m = standMaterials(track);
    expect(drawn.at(-1)).toBe(gpGrandstandStyle(id)!.label);
    expect(drawn.at(-1)).not.toMatch(/AUREL/);
    expect(m.sign.userData.venueLabel).toBe(gpGrandstandStyle(id)!.label);
    expect(m.sign.map!.image.width).toBe(1024);
    expect(m.sign.map!.image.height).toBe(128);
    m.sign.map!.dispose();
    Object.values(m).forEach((material) => material.dispose());
  });
});
