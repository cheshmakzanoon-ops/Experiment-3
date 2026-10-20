import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { paddockMaterials } from '../src/rendering/paddock-detail.ts';
import {
  buildGpPaddockArchitecture,
  gpPaddockPlan,
  gpPaddockRoofGeometry,
} from '../src/rendering/venue-kit/gp-paddock-architecture.ts';

const venues = [
  'poggio-alto',
  'cape-wrenna',
  'haarveld',
  'montejaral',
  'steinhorn',
  'zafra-night',
] as const;

describe('GP layered pit architecture', () => {
  it.each(venues)('%s fits the garage row, keeps the lane open and bounds resources', (id) => {
    const track = new Track('clear', false, undefined, CIRCUITS[id]),
      before = track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank, p.curvature]),
      plan = gpPaddockPlan(track),
      materials = paddockMaterials(),
      root = buildGpPaddockArchitecture(track, materials)!;
    expect(plan).toHaveLength(12);
    expect(gpPaddockPlan(track)).toEqual(plan);
    root.updateMatrixWorld(true);
    expect(root.children).toHaveLength(6);
    const geometries = new Set<T.BufferGeometry>(),
      used = new Set<T.Material>();
    let triangles = 0;
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const geometry = object.geometry as T.BufferGeometry;
      geometries.add(geometry);
      used.add(object.material as T.Material);
      const position = geometry.getAttribute('position');
      triangles += (geometry.index?.count ?? position.count) / 3;
      for (const attribute of Object.values(geometry.attributes))
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      expect(object.castShadow && object.receiveShadow).toBe(true);
    });
    expect(triangles).toBeLessThan(10000);
    expect(used.size).toBe(6);
    for (const material of used)
      expect(Object.values(material).some((value) => value instanceof T.Texture)).toBe(false);

    for (const site of plan) {
      const p = track.at(site.s, trackPoint()),
        rotation = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), site.yaw),
        position = new T.Vector3(site.x, site.y, site.z),
        localToWorld = (point: T.Vector3) => point.applyQuaternion(rotation).add(position),
        direction = new T.Vector3(1, 0, 0).applyQuaternion(rotation);
      // The upper floor attaches to each existing garage, including the
      // sloping Tuscan row and the mirrored left-hand island paddock.
      expect(site.y).toBeCloseTo(
        p.y + p.bank * T.MathUtils.clamp(track.pit.side * (track.pit.offset + 6.5), -12, 12) + 0.02,
        7,
      );
      const face = localToWorld(new T.Vector3(-6.5, 0, 0));
      const lateral = (face.x - p.x) * p.nx + (face.z - p.z) * p.nz;
      expect(lateral).toBeCloseTo(track.pit.side * (track.pit.offset + 6.5), 6);

      // Real recessed glazing is visible through the overhang, and the new
      // upper layer adds no wall or upright to the garage access corridor.
      const eye = localToWorld(new T.Vector3(-10, 8.4, 1.1)),
        windowHits = new T.Raycaster(eye, direction, 0, 15).intersectObject(root, true);
      expect(windowHits.length).toBeGreaterThan(0);
      expect(windowHits[0].distance).toBeCloseTo(3.58, 2);
      for (const y of [0.5, 2, 4.5]) {
        const ray = new T.Raycaster(localToWorld(new T.Vector3(-12, y, 1.1)), direction, 0, 18);
        expect(ray.intersectObject(root, true)).toHaveLength(0);
      }
      if (site.index === 0 || site.index === plan.length - 1) {
        const end = (site.index === 0 ? -1 : 1) * track.pit.side,
          outside = localToWorld(new T.Vector3(0, 8.4, end * (site.width / 2 + 2))),
          inward = new T.Vector3(0, 0, -end).applyQuaternion(rotation),
          hits = new T.Raycaster(outside, inward, 0, 4).intersectObject(root, true);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].distance).toBeCloseTo(1.95, 2);
      }
    }
    expect(track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank, p.curvature])).toEqual(before);
    // Resources are all attached to the root, so the ordinary scene traversal
    // releases them; no detached material/texture cache survives a venue swap.
    expect([...geometries].every((g) => g.boundingSphere !== null)).toBe(true);
    for (const geometry of geometries) geometry.dispose();
    for (const material of used) material.dispose();
  });

  it.each(venues)('%s has a closed roof with upward and downward faces', (id) => {
    const geometry = gpPaddockRoofGeometry(id, 9),
      material = new T.MeshBasicMaterial(),
      roof = new T.Mesh(geometry, material);
    roof.updateMatrixWorld(true);
    for (const x of [-8.5, -4, 3.5]) {
      const top = new T.Raycaster(new T.Vector3(x, 30, 0), new T.Vector3(0, -1, 0)).intersectObject(
          roof,
        ),
        bottom = new T.Raycaster(new T.Vector3(x, 5, 0), new T.Vector3(0, 1, 0)).intersectObject(
          roof,
        );
      expect(top.length).toBeGreaterThan(0);
      expect(bottom.length).toBeGreaterThan(0);
      expect(top[0].point.y - bottom[0].point.y).toBeCloseTo(0.18, 5);
      expect(top[0].face!.normal.y).toBeGreaterThan(0.9);
      expect(bottom[0].face!.normal.y).toBeLessThan(-0.9);
    }
    geometry.dispose();
    material.dispose();
  });

  it('keeps every venue's roof silhouette distinct and rejects invalid dimensions', () => {
    const signatures = venues.map((id) => {
      const geometry = gpPaddockRoofGeometry(id, 9),
        signature = [...geometry.getAttribute('position').array].join(',');
      geometry.dispose();
      return signature;
    });
    expect(new Set(signatures).size).toBe(venues.length);
    for (const width of [0, -1, NaN, Infinity])
      expect(() => gpPaddockRoofGeometry('haarveld', width)).toThrow();
  });

  it.each(['aurel', 'vellamar', 'parco-reale', 'valley-ridge-mx'] as const)(
    'allocates no GP architecture for %s',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      expect(gpPaddockPlan(track)).toEqual([]);
      expect(
        buildGpPaddockArchitecture(track, null as unknown as ReturnType<typeof paddockMaterials>),
      ).toBeNull();
    },
  );
});
