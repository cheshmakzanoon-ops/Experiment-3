import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Rider, type RiderPose } from '../src/rendering/rider.ts';
import {
  motocrossGarmentGeometry,
  type MotocrossGarment,
} from '../src/rendering/offroad/motocross-gear.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const colours = { primary: 0xc22c28, secondary: 0x202226, accent: 0xe5e1d6 };
const basePose: RiderPose = {
  lean: 0.6,
  offset: 0.08,
  tuck: 0,
  braking: 0.8,
  steer: -0.4,
  body: -1,
  standing: 1,
};
function garments(rider: Rider) {
  const result: T.SkinnedMesh[] = [];
  rider.root.traverse((object) => {
    if (object instanceof T.SkinnedMesh) result.push(object);
  });
  return result;
}

describe('motocross continuous textile skin', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s cloth has finite closed caps, smooth wrap normals and bounded skin/UV storage',
    (detail) => {
      let triangles = 0;
      for (const kind of ['jersey', 'seat', 'sleeve', 'pants'] as MotocrossGarment[]) {
        const geometry = motocrossGarmentGeometry(kind, detail),
          positions = geometry.getAttribute('position'),
          normals = geometry.getAttribute('normal'),
          uv = geometry.getAttribute('uv'),
          index = geometry.index!,
          a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3();
        triangles += (index.count / 3) * (kind === 'sleeve' || kind === 'pants' ? 2 : 1);
        let minUvArea = Infinity,
          minFaceArea = Infinity,
          maxNormalError = 0,
          minUv = Infinity,
          maxUv = -Infinity;
        try {
          for (const attribute of Object.values(geometry.attributes))
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          for (let i = 0; i < positions.count; i++) {
            maxNormalError = Math.max(
              maxNormalError,
              Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1),
            );
            minUv = Math.min(minUv, uv.getX(i), uv.getY(i));
            maxUv = Math.max(maxUv, uv.getX(i), uv.getY(i));
          }
          for (let i = 0; i < index.count; i += 3) {
            const ia = index.getX(i),
              ib = index.getX(i + 1),
              ic = index.getX(i + 2);
            a.fromBufferAttribute(positions, ia);
            b.fromBufferAttribute(positions, ib);
            c.fromBufferAttribute(positions, ic);
            minFaceArea = Math.min(minFaceArea, b.sub(a).cross(c.sub(a)).lengthSq());
            const determinant =
              (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
              (uv.getY(ib) - uv.getY(ia)) * (uv.getX(ic) - uv.getX(ia));
            minUvArea = Math.min(minUvArea, Math.abs(determinant));
          }
          expect(maxNormalError).toBeLessThan(0.000005);
          expect(minUv).toBeGreaterThanOrEqual(0);
          expect(maxUv).toBeLessThanOrEqual(1);
          expect(minFaceArea).toBeGreaterThan(1e-20);
          expect(minUvArea).toBeGreaterThan(1e-8);
        } finally {
          geometry.dispose();
        }
      }
      expect(triangles).toBeLessThanOrEqual(
        detail === 'high' ? 19200 : detail === 'mid' ? 6300 : 1650,
      );
    },
  );

  it('keeps the posed cuffs attached, the wrap closed and all vertices inside the live rig envelope', () => {
    const rider = new Rider(colours, 'high', 'motocross'),
      skins = garments(rider),
      point = new T.Vector3(),
      expected = new T.Vector3(),
      seam = new T.Vector3();
    expect(skins).toHaveLength(4);
    // Exercise a nonidentity bike frame: double-applying world transforms can
    // look plausible at the origin but tears the garment away on a real track.
    rider.root.position.set(407, 3.2, -180);
    rider.root.rotation.set(0.22, 1.14, -0.38);
    const check = () => {
      rider.root.updateMatrixWorld(true);
      for (const skin of skins) {
        const geometry = skin.geometry,
          positions = geometry.getAttribute('position'),
          uv = geometry.getAttribute('uv'),
          weights = geometry.getAttribute('skinWeight'),
          inverse = skin.matrixWorld.clone().invert(),
          upper = skin.skeleton.boneInverses[1].elements[13] * -1;
        let blended = 0,
          previousWrap = -1,
          maxWeightError = 0,
          maxCuffError = 0,
          maxSeamError = 0,
          inSphere = true,
          inBox = true;
        for (let i = 0; i < positions.count; i++) {
          const w0 = weights.getX(i),
            w1 = weights.getY(i);
          maxWeightError = Math.max(maxWeightError, Math.abs(w0 + w1 - 1));
          if (w0 > 0 && w1 > 0) blended++;
          skin.getVertexPosition(i, point);
          inSphere &&= skin.boundingSphere!.containsPoint(point);
          inBox &&= skin.boundingBox!.containsPoint(point);
          if (w0 === 1 || w1 === 1) {
            expected.fromBufferAttribute(positions, i);
            if (w1 === 1) expected.y -= upper;
            expected
              .applyMatrix4(skin.skeleton.bones[w1 === 1 ? 1 : 0].matrixWorld)
              .applyMatrix4(inverse);
            maxCuffError = Math.max(maxCuffError, point.distanceTo(expected));
          }
          if (uv.getX(i) === 0) previousWrap = i;
          if (uv.getX(i) === 1 && previousWrap >= 0) {
            skin.getVertexPosition(previousWrap, seam);
            maxSeamError = Math.max(maxSeamError, seam.distanceTo(point));
          }
        }
        expect(maxWeightError).toBeLessThan(0.0000005);
        expect(maxCuffError).toBeLessThan(1e-9);
        expect(maxSeamError).toBeLessThan(1e-7);
        expect(inSphere).toBe(true);
        expect(inBox).toBe(true);
        expect(blended).toBeGreaterThan(100);
      }
    };
    try {
      for (const standing of [0, 1])
        for (const body of [-1, 1]) {
          rider.ride({ ...basePose, standing, body });
          check();
          rider.setFirstPerson(true, true);
          check();
          rider.setFirstPerson(false, true);
        }
      rider.separated(0, 2.1, 0);
      check();
      rider.separated(1, 0, 0.53);
      check();
    } finally {
      rider.dispose();
    }
  });

  it('reconstructs the same cloth pose after recovery/onboard views and releases owned skeleton textures', () => {
    const rider = new Rider(colours, 'mid', 'motocross'),
      skins = garments(rider),
      storage = skins.map((skin) => skin.geometry.getAttribute('position').array),
      point = new T.Vector3();
    let disposed = 0;
    for (const skin of skins) {
      skin.skeleton.computeBoneTexture();
      skin.skeleton.boneTexture!.addEventListener('dispose', () => disposed++);
    }
    const sample = () => {
      rider.root.updateMatrixWorld(true);
      return skins.flatMap((skin) => {
        const result: number[] = [];
        for (let i = 0; i < skin.geometry.getAttribute('position').count; i += 17) {
          skin.getVertexPosition(i, point);
          result.push(point.x, point.y, point.z);
        }
        return result;
      });
    };
    try {
      rider.ride(basePose);
      const before = sample();
      rider.ride({ ...basePose, standing: 0, body: 1, lean: -0.6, steer: 0.4 });
      rider.setFirstPerson(true, true);
      sample();
      rider.setFirstPerson(false, true);
      rider.separated(0, 1.7, 0.2);
      sample();
      rider.ride(basePose);
      expect(sample()).toEqual(before);
      for (let i = 0; i < skins.length; i++)
        expect(skins[i].geometry.getAttribute('position').array).toBe(storage[i]);
    } finally {
      rider.dispose();
    }
    expect(disposed).toBe(4);
  });
});
