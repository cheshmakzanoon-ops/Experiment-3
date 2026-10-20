import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { paddockMaterials } from '../src/rendering/paddock-detail.ts';
import {
  buildGpRaceControl,
  gpRaceControlSite,
  GP_CONTROL_STYLES,
} from '../src/rendering/venue-kit/gp-race-control.ts';

const venues = [
  'poggio-alto',
  'cape-wrenna',
  'haarveld',
  'montejaral',
  'steinhorn',
  'zafra-night',
] as const;

// Construction-only canvas. The existing production paddock browser fixture
// checks actual lettering, lighting, weather restoration and GPU disposal.
beforeAll(() =>
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, fillText() {} }),
    }),
  }),
);
afterAll(() => vi.unstubAllGlobals());

describe('GP race-control landmarks', () => {
  it.each(venues)('%s keeps the former footprint and exposes a real observation window', (id) => {
    const track = new Track('clear', false, undefined, CIRCUITS[id]),
      original = track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank, p.curvature]),
      site = gpRaceControlSite(track)!,
      materials = paddockMaterials(),
      root = buildGpRaceControl(track, materials)!,
      bounds = new T.Box3(),
      used = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    let triangles = 0;
    root.updateMatrixWorld(true);
    expect(root.children).toHaveLength(7);
    for (const object of root.children) {
      expect(object).toBeInstanceOf(T.Mesh);
      const mesh = object as T.Mesh<T.BufferGeometry, T.Material>,
        geometry = mesh.geometry;
      bounds.union(geometry.boundingBox!);
      triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
      for (const attribute of Object.values(geometry.attributes))
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      expect(mesh.castShadow && mesh.receiveShadow && mesh.frustumCulled).toBe(true);
      used.add(mesh.material);
      for (const value of Object.values(mesh.material))
        if (value instanceof T.Texture) textures.add(value);
    }
    expect(triangles).toBeLessThan(3500);
    expect(used.size).toBe(7);
    expect(textures.size).toBe(1);
    const atlas = [...textures][0];
    expect([atlas.image.width, atlas.image.height]).toEqual([1024, 256]);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-7);
    expect(bounds.max.x).toBeLessThanOrEqual(7);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-7);
    expect(bounds.max.z).toBeLessThanOrEqual(7);
    expect(bounds.min.y).toBeLessThan(0);
    expect(bounds.max.y).toBeLessThan(21);

    const p = track.at(site.s, trackPoint()),
      lateral = track.pit.side * (track.pit.offset + 13.5);
    // Exact former tower centre: no new placement, pit merge or route edits.
    expect(site.x).toBeCloseTo(p.x + p.nx * lateral, 7);
    expect(site.z).toBeCloseTo(p.z + p.nz * lateral, 7);
    expect(site.y).toBeCloseTo(
      p.y + p.bank * T.MathUtils.clamp(track.pit.side * (track.pit.offset + 6.5), -12, 12) + 0.02,
      7,
    );
    for (const x of [-7, 0, 7])
      for (const z of [-7, 0, 7]) {
        const world = root.localToWorld(new T.Vector3(x, 0, z)),
          near = trackPoint(),
          roadLateral = track.nearest(world.x, world.z, near);
        expect(Math.abs(roadLateral)).toBeGreaterThan(near.width + 5);
      }

    const eye = root.localToWorld(new T.Vector3(-10, GP_CONTROL_STYLES[id].height - 1.75, 0.8)),
      inward = new T.Vector3(1, 0, 0).transformDirection(root.matrixWorld),
      hits = new T.Raycaster(eye, inward, 0, 14).intersectObject(root, true);
    expect(hits.length).toBeGreaterThan(0);
    expect((hits[0].object as T.Mesh).material).toBe(materials.glass);
    expect(track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank, p.curvature])).toEqual(
      original,
    );
    for (const mesh of root.children as T.Mesh[]) mesh.geometry.dispose();
    for (const material of used) material.dispose();
    for (const texture of textures) texture.dispose();
  });

  it.each(['aurel', 'vellamar', 'parco-reale', 'valley-ridge-mx'] as const)(
    'leaves the existing %s control building path unchanged',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      expect(gpRaceControlSite(track)).toBeNull();
      expect(
        buildGpRaceControl(track, null as unknown as ReturnType<typeof paddockMaterials>),
      ).toBeNull();
    },
  );
});
