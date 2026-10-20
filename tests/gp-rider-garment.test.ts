import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gpGarmentGeometry } from '../src/rendering/gp-rider-garment.ts';
import { Rider, RIDER, type RiderPose } from '../src/rendering/rider.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());
const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 };
function skins(rider: Rider) {
  const found: T.SkinnedMesh[] = [];
  rider.root.traverse((object) => {
    // This contract concerns the four continuous limb skins. The torso has
    // its own shared three-frame spine and deformation/contact checks.
    if (object instanceof T.SkinnedMesh && object.name.startsWith('GP continuous fitted'))
      found.push(object);
  });
  return found;
}
const pose: RiderPose = { lean: 0.8, offset: 0.18, tuck: 0.7, braking: 0.6, steer: -0.16 };

describe('continuous GP racing suit', () => {
  it.each(['high', 'mid'] as const)(
    '%s has closed, nondegenerate leather surfaces with finite metre UVs and smooth wrap seams',
    (detail) => {
      let triangles = 0;
      for (const kind of ['sleeve', 'pants'] as const) {
        const upper = kind === 'sleeve' ? RIDER.upperArm : RIDER.thigh,
          lower = kind === 'sleeve' ? RIDER.forearm : RIDER.shin,
          geometry = gpGarmentGeometry(kind, detail, upper, lower),
          positions = geometry.getAttribute('position'),
          normals = geometry.getAttribute('normal'),
          weights = geometry.getAttribute('skinWeight'),
          uv = geometry.getAttribute('uv'),
          index = geometry.index!,
          a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3();
        triangles += (index.count / 3) * 2;
        let minFaceArea = Infinity,
          minUvArea = Infinity,
          maxNormalError = 0,
          maxWeightError = 0;
        const edges = new Map<string, number>();
        const key = (i: number) =>
          [positions.getX(i), positions.getY(i), positions.getZ(i)]
            .map((value) => Math.round(value * 1e7))
            .join('/');
        try {
          for (const attribute of Object.values(geometry.attributes))
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          for (let i = 0; i < positions.count; i++) {
            maxNormalError = Math.max(
              maxNormalError,
              Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1),
            );
            maxWeightError = Math.max(
              maxWeightError,
              Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1),
            );
          }
          for (let i = 0; i < index.count; i += 3) {
            const ia = index.getX(i),
              ib = index.getX(i + 1),
              ic = index.getX(i + 2);
            a.fromBufferAttribute(positions, ia);
            b.fromBufferAttribute(positions, ib);
            c.fromBufferAttribute(positions, ic);
            minFaceArea = Math.min(minFaceArea, b.sub(a).cross(c.sub(a)).lengthSq());
            minUvArea = Math.min(
              minUvArea,
              Math.abs(
                (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
                  (uv.getX(ic) - uv.getX(ia)) * (uv.getY(ib) - uv.getY(ia)),
              ),
            );
            for (const [from, to] of [
              [ia, ib],
              [ib, ic],
              [ic, ia],
            ]) {
              const edge = [key(from), key(to)].sort().join('|');
              edges.set(edge, (edges.get(edge) ?? 0) + 1);
            }
          }
          expect(minFaceArea).toBeGreaterThan(1e-20);
          expect(minUvArea).toBeGreaterThan(1e-8);
          expect(maxNormalError).toBeLessThan(1e-6);
          expect(maxWeightError).toBeLessThan(1e-7);
          expect([...edges.values()].every((count) => count === 2)).toBe(true);
        } finally {
          geometry.dispose();
        }
      }
      expect(triangles).toBeLessThanOrEqual(detail === 'high' ? 10000 : 3600);
    },
  );

  it('holds shoulder/hip openings and cuffs on their rig, closes each wrap and retains bend diameter', () => {
    const rider = new Rider(colours, 'high', 'leathers', 2, true),
      garments = skins(rider),
      point = new T.Vector3(),
      expected = new T.Vector3(),
      seam = new T.Vector3(),
      across = new T.Vector3();
    expect(garments).toHaveLength(4);
    rider.root.position.set(317, 4.2, -190);
    rider.root.rotation.set(0.27, 1.12, -0.56);
    const check = () => {
      rider.root.updateMatrixWorld(true);
      for (const mesh of garments) {
        const positions = mesh.geometry.getAttribute('position'),
          uv = mesh.geometry.getAttribute('uv'),
          weights = mesh.geometry.getAttribute('skinWeight'),
          inverse = mesh.matrixWorld.clone().invert(),
          upper = mesh.skeleton.boneInverses[2].elements[13] * -1;
        let wrap = -1,
          bendStart = -1,
          bendOpposite = -1,
          maxAttachmentError = 0,
          maxSeamError = 0,
          insideBounds = true;
        for (let i = 0; i < positions.count; i++) {
          mesh.getVertexPosition(i, point);
          insideBounds &&=
            mesh.boundingSphere!.containsPoint(point) && mesh.boundingBox!.containsPoint(point);
          const bone = weights.getX(i) === 1 ? 0 : weights.getW(i) === 1 ? 3 : -1;
          if (bone >= 0) {
            expected.fromBufferAttribute(positions, i);
            if (bone === 3) expected.y -= upper;
            expected.applyMatrix4(mesh.skeleton.bones[bone].matrixWorld).applyMatrix4(inverse);
            maxAttachmentError = Math.max(maxAttachmentError, point.distanceTo(expected));
          }
          if (uv.getX(i) === 0) wrap = i;
          if (uv.getX(i) === 1 && wrap >= 0) {
            mesh.getVertexPosition(wrap, seam);
            maxSeamError = Math.max(maxSeamError, seam.distanceTo(point));
          }
          if (weights.getZ(i) === 1 && uv.getX(i) === 0) bendStart = i;
          if (weights.getZ(i) === 1 && uv.getX(i) === 0.5) bendOpposite = i;
        }
        expect(insideBounds).toBe(true);
        expect(maxAttachmentError).toBeLessThan(1e-8);
        expect(maxSeamError).toBeLessThan(1e-7);
        expect(bendStart).toBeGreaterThanOrEqual(0);
        expect(bendOpposite).toBeGreaterThanOrEqual(0);
        const bindDiameter = point
          .fromBufferAttribute(positions, bendStart)
          .distanceTo(across.fromBufferAttribute(positions, bendOpposite));
        mesh.getVertexPosition(bendStart, point);
        mesh.getVertexPosition(bendOpposite, across);
        // Volume remains intact through deep GP corner poses, including the
        // outside knee. Ordinary upper/lower matrix blending flattens this ring.
        expect(point.distanceTo(across)).toBeCloseTo(bindDiameter, 8);
      }
    };
    try {
      for (const lean of [-1.1, 0, 1.1])
        for (const tuck of [0, 1])
          for (const braking of [0, 1]) {
            rider.ride({ ...pose, lean, offset: lean * 0.18, tuck, braking });
            check();
            rider.setFirstPerson(true);
            check();
            rider.setFirstPerson(false);
          }
      for (const phase of [0, 1, 2]) {
        rider.separated(phase, 2.1, 0.43);
        check();
      }
    } finally {
      rider.dispose();
    }
  });

  it('reconstructs the same recovery/ride pose without vertex uploads and disposes all skeleton textures', () => {
    const rider = new Rider(colours, 'mid', 'leathers', 2, true),
      garments = skins(rider),
      buffers = garments.map((mesh) => mesh.geometry.getAttribute('position')),
      versions = buffers.map((attribute) => (attribute as T.BufferAttribute).version),
      point = new T.Vector3();
    let disposed = 0;
    for (const mesh of garments) {
      mesh.skeleton.computeBoneTexture();
      mesh.skeleton.boneTexture!.addEventListener('dispose', () => disposed++);
    }
    const sample = () => {
      rider.root.updateMatrixWorld(true);
      return garments.flatMap((mesh) => {
        const result: number[] = [];
        for (let i = 0; i < mesh.geometry.getAttribute('position').count; i += 17) {
          mesh.getVertexPosition(i, point);
          result.push(point.x, point.y, point.z);
        }
        return result;
      });
    };
    try {
      rider.ride(pose);
      const before = sample();
      rider.separated(0, 1.8, 0.2);
      rider.setFirstPerson(true);
      sample();
      rider.separated(1, 0, 0.58);
      sample();
      rider.setFirstPerson(false);
      rider.ride(pose);
      expect(sample()).toEqual(before);
      for (let i = 0; i < garments.length; i++) {
        expect(garments[i].geometry.getAttribute('position')).toBe(buffers[i]);
        expect((buffers[i] as T.BufferAttribute).version).toBe(versions[i]);
      }
    } finally {
      rider.dispose();
    }
    expect(disposed).toBe(4);
    const road = new Rider(colours, 'high'),
      far = new Rider(colours, 'far', 'leathers', 2, true);
    try {
      expect(skins(road)).toHaveLength(0);
      expect(skins(far)).toHaveLength(0);
    } finally {
      road.dispose();
      far.dispose();
    }
  });
});
