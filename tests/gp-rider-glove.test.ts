import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addGpRacingGlove } from '../src/rendering/gp-rider-glove.ts';
import { batchBikeRigidMeshes } from '../src/rendering/bike-rigid-batch.ts';
import { GP_GLOVE_GRIP } from '../src/rendering/gp-rider-contact.ts';
import { Rider } from '../src/rendering/rider.ts';

const materials = {
  leather: new T.MeshStandardMaterial(),
  panel: new T.MeshPhysicalMaterial(),
  armour: new T.MeshStandardMaterial(),
};
const disposeGeometry = (root: T.Object3D) =>
  root.traverse((object) => {
    if (object instanceof T.Mesh) object.geometry.dispose();
  });
afterAll(() => Object.values(materials).forEach((material) => material.dispose()));

function glove(detail: 'high' | 'mid', side: -1 | 1) {
  const root = new T.Group();
  addGpRacingGlove(root, detail, side, materials);
  root.updateMatrixWorld(true);
  return root;
}
function inventory(root: T.Object3D) {
  let triangles = 0,
    meshes = 0;
  const used = new Set<T.Material>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    meshes++;
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      used.add(material);
  });
  return { triangles, meshes, materials: used.size };
}

describe('GP fitted gauntlets on the existing grip frame', () => {
  it.each(['high', 'mid'] as const)(
    '%s uses closed finite geometry and outward-wound mirrored hands',
    (detail) => {
      const left = glove(detail, 1),
        right = glove(detail, -1);
      try {
        expect(left.children.length).toBe(right.children.length);
        let smallestArea = Infinity,
          largestNormalError = 0,
          mirrorError = 0;
        for (let part = 0; part < left.children.length; part++) {
          const a = left.children[part] as T.Mesh,
            b = right.children[part] as T.Mesh,
            pa = a.geometry.getAttribute('position'),
            pb = b.geometry.getAttribute('position'),
            normal = a.geometry.getAttribute('normal'),
            ia = a.geometry.index!,
            ib = b.geometry.index!;
          expect(a.material).toBe(b.material);
          expect(Array.from(pa.array).every(Number.isFinite)).toBe(true);
          for (let i = 0; i < pa.count; i++) {
            mirrorError = Math.max(
              mirrorError,
              Math.abs(pa.getX(i) + pb.getX(i)),
              Math.abs(pa.getY(i) - pb.getY(i)),
              Math.abs(pa.getZ(i) - pb.getZ(i)),
            );
            largestNormalError = Math.max(
              largestNormalError,
              Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1),
            );
          }
          for (let i = 0; i < ia.count; i += 3) {
            const p = new T.Vector3().fromBufferAttribute(pa, ia.getX(i)),
              q = new T.Vector3().fromBufferAttribute(pa, ia.getX(i + 1)),
              r = new T.Vector3().fromBufferAttribute(pa, ia.getX(i + 2));
            smallestArea = Math.min(smallestArea, q.sub(p).cross(r.sub(p)).length() / 2);
            expect([ib.getX(i), ib.getX(i + 1), ib.getX(i + 2)]).toEqual([
              ia.getX(i), ia.getX(i + 2), ia.getX(i + 1),
            ]);
          }
        }
        expect(mirrorError).toBe(0);
        expect(largestNormalError).toBeLessThan(1e-6);
        expect(smallestArea).toBeGreaterThan(1e-10);
        const thumb = left.getObjectByName('GP medial thumb wrapped below grip')!;
        expect(new T.Box3().setFromObject(thumb).max.x).toBeLessThan(0);
        expect(
          new T.Box3().setFromObject(right.getObjectByName(thumb.name)!).min.x,
        ).toBeGreaterThan(0);
        const bounds = new T.Box3().setFromObject(left);
        expect(bounds.min.x).toBeGreaterThan(-0.056);
        expect(bounds.max.x).toBeLessThan(0.039);
        expect(bounds.min.y).toBeGreaterThan(-0.043);
        expect(bounds.max.y).toBeLessThan(0.043);
        expect(bounds.min.z).toBeGreaterThan(-0.063);
        expect(bounds.max.z).toBeLessThan(0.091);
      } finally {
        disposeGeometry(left);
        disposeGeometry(right);
      }
    },
  );

  it.each(
    (['high', 'mid'] as const).flatMap((detail) =>
      ([1, -1] as const).map((side) => ({ detail, side })),
    ),
  )('$detail hand $side wraps the physical 17 mm grip without a floating mitten', ({ detail, side }) => {
    const root = glove(detail, side);
    try {
      const fingerX = [-0.0245, -0.008, 0.0085, 0.025];
      for (let finger = 0; finger < 4; finger++)
        for (let step = 0; step <= 48; step++) {
          const angle = -0.4 + (2.7 * step) / 48,
            origin = new T.Vector3(...GP_GLOVE_GRIP);
          origin.x += side * fingerX[finger];
          const ray = new T.Raycaster(origin, new T.Vector3(0, Math.cos(angle), Math.sin(angle))),
            hits = ray.intersectObject(root, true);
          expect(hits.length).toBeGreaterThan(0);
          // Rays originate at the actual grip cylinder, not an arbitrary glove
          // bounding box. Permit up to 4.5 mm of leather/padding clearance.
          expect(hits[0].distance).toBeGreaterThanOrEqual(0.017);
          expect(hits[0].distance).toBeLessThan(0.0215);
        }
      batchBikeRigidMeshes(root);
      const result = inventory(root);
      expect(result.materials).toBe(detail === 'high' ? 3 : 1);
      expect(result.meshes).toBe(detail === 'high' ? 3 : 1);
      // Previous road glove: 1,912 / 1,212 triangles per high / mid hand.
      expect(result.triangles).toBeLessThanOrEqual(detail === 'high' ? 1912 : 1212);
    } finally {
      disposeGeometry(root);
    }
  });
});

describe('production rider glove selection', () => {
  beforeAll(() => {
    const context = new Proxy(
      {},
      {
        get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
        set: () => true,
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  it.each(['high', 'mid', 'far'] as const)(
    '%s preserves contacts and the existing per-hand render budget',
    (detail) => {
      const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 },
        road = new Rider(colours, detail),
        gp = new Rider(colours, detail, 'leathers', 2, true);
      try {
        const hand = gp.root.getObjectByName('GP left hand')!;
        expect(inventory(hand).triangles).toBe(detail === 'high' ? 1752 : detail === 'mid' ? 820 : 108);
        const frames = (rider: Rider) => [rider.seat, ...rider.grips, ...rider.pegs].map((p) => p.toArray());
        expect(frames(gp)).toEqual(frames(road));
      } finally {
        gp.dispose();
        road.dispose();
      }
    },
  );
});
