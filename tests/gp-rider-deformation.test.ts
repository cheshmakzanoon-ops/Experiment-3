import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GpRiderGarment, gpGarmentGeometry } from '../src/rendering/gp-rider-garment.ts';
import { GP_SUIT_MAX_FOLD } from '../src/rendering/gp-rider-suit.ts';
import { Rider, RIDER } from '../src/rendering/rider.ts';

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

describe('GP attachment volume and flex-driven leather', () => {
  it.each(['high', 'mid'] as const)(
    '%s retains the hip and shoulder cross-section through tuck, hang-off, braking and recovery',
    (detail) => {
      const rider = new Rider(colours, detail, 'leathers', 2, true),
        garments: T.SkinnedMesh[] = [],
        points = Array.from({ length: 4 }, () => new T.Vector3()),
        quarter = detail === 'high' ? 5 : 3;
      rider.root.traverse((object) => {
        if (object instanceof T.SkinnedMesh && object.name.startsWith('GP continuous fitted'))
          garments.push(object);
      });
      rider.root.position.set(317, 4.2, -190);
      rider.root.rotation.set(0.27, 1.12, -0.56);
      let smallest = Infinity,
        largest = 0,
        sampled = 0;
      const check = () => {
        rider.root.updateMatrixWorld(true);
        for (const garment of garments) {
          const position = garment.geometry.getAttribute('position'),
            uv = garment.geometry.getAttribute('uv'),
            end = garment.name.endsWith('pants') ? 0.096 : 0.062;
          for (let i = 0; i < position.count; i++) {
            const y = position.getY(i);
            if (y <= 0 || y >= end || uv.getX(i) !== 0) continue;
            const indices = [i, i + quarter, i + quarter * 2, i + quarter * 3];
            for (let k = 0; k < 4; k++) {
              expect(position.getY(indices[k])).toBe(y);
              expect(uv.getX(indices[k])).toBe(k / 4);
              points[k].fromBufferAttribute(position, indices[k]);
            }
            // Checking both perpendicular diameters catches a flattened hip
            // that can retain most of its visible lateral width. The previous
            // two-frame saddle lost over 40% of this area in the riding sweep.
            const bindArea = points[0].sub(points[2]).cross(points[1].sub(points[3])).length();
            for (let k = 0; k < 4; k++) garment.getVertexPosition(indices[k], points[k]);
            const area = points[0].sub(points[2]).cross(points[1].sub(points[3])).length();
            smallest = Math.min(smallest, area / bindArea);
            largest = Math.max(largest, area / bindArea);
            sampled++;
          }
        }
      };
      try {
        for (const lean of [-1.1, 0, 1.1])
          for (const tuck of [0, 1])
            for (const braking of [0, 1]) {
              rider.ride({ lean, offset: lean * 0.18, tuck, braking, steer: -0.16 });
              check();
            }
        for (const phase of [0, 1, 2]) {
          rider.separated(phase, 2.1, 0.43);
          check();
        }
        expect(sampled).toBeGreaterThan(150);
        expect(smallest).toBeGreaterThan(0.94);
        expect(largest).toBeLessThan(1.04);
      } finally {
        rider.dispose();
      }
    },
  );

  it.each(['sleeve', 'pants'] as const)(
    '%s compression remains millimetre scale and leaves sewn, protected and cuff boundaries fixed',
    (kind) => {
      const upper = kind === 'sleeve' ? RIDER.upperArm : RIDER.thigh,
        lower = kind === 'sleeve' ? RIDER.forearm : RIDER.shin,
        bend = kind === 'sleeve' ? 0.052 : 0.074,
        geometry = gpGarmentGeometry(kind, 'high', upper, lower),
        position = geometry.getAttribute('position'),
        normal = geometry.getAttribute('normal'),
        deltas = geometry.morphAttributes.position,
        normalDeltas = geometry.morphAttributes.normal;
      let moving = 0;
      try {
        expect(geometry.morphTargetsRelative).toBe(true);
        if (!deltas) throw new Error(`${kind} garment is missing position morph targets`);
        if (!normalDeltas) throw new Error(`${kind} garment is missing normal morph targets`);
        expect(deltas).toHaveLength(2);
        expect(normalDeltas).toHaveLength(2);
        for (let i = 0; i < position.count; i++) {
          const y = position.getY(i);
          let displacement = 0;
          for (let j = 0; j < deltas.length; j++) {
            const delta = deltas[j],
              normalDelta = normalDeltas[j],
              size = Math.hypot(delta.getX(i), delta.getY(i), delta.getZ(i));
            expect(delta.count).toBe(position.count);
            expect(normalDelta.count).toBe(normal.count);
            expect(Number.isFinite(size)).toBe(true);
            expect(delta.getY(i)).toBe(0);
            const targetNormalLength = Math.hypot(
              normal.getX(i) + normalDelta.getX(i),
              normal.getY(i) + normalDelta.getY(i),
              normal.getZ(i) + normalDelta.getZ(i),
            );
            expect(targetNormalLength).toBeCloseTo(1, 5);
            if (y <= 0 || y >= upper + bend || Math.abs(y - upper) < 1e-7) expect(size).toBe(0);
            displacement += size;
          }
          expect(displacement).toBeLessThan(GP_SUIT_MAX_FOLD);
          if (displacement > 0.0001) moving++;
        }
        expect(moving).toBeGreaterThan(30);
      } finally {
        geometry.dispose();
      }
    },
  );

  it('relaxes and gathers with solved joint flex, replaying identical shapes without buffer writes', () => {
    const parent = new T.Group(),
      torso = new T.Group(),
      upper = new T.Group(),
      lower = new T.Group(),
      material = new T.MeshStandardMaterial();
    parent.add(torso, upper, lower);
    lower.position.y = RIDER.upperArm;
    const garment = new GpRiderGarment(
      parent,
      torso,
      upper,
      lower,
      RIDER.upperArm,
      RIDER.forearm,
      [0.185, 0.44, 0],
      'sleeve',
      'mid',
      material,
    );
    const geometry = garment.mesh.geometry,
      attributes = [
        ...Object.values(geometry.attributes),
        ...Object.values(geometry.morphAttributes).flat(),
      ] as T.BufferAttribute[],
      versions = attributes.map((attribute) => attribute.version),
      point = new T.Vector3();
    const sample = () => {
      parent.updateMatrixWorld(true);
      const result: number[] = [...garment.mesh.morphTargetInfluences!];
      for (let i = 0; i < geometry.getAttribute('position').count; i += 13) {
        garment.mesh.getVertexPosition(i, point);
        result.push(point.x, point.y, point.z);
      }
      return result;
    };
    try {
      garment.updatePose();
      expect(garment.mesh.morphTargetInfluences![0]).toBe(0);
      const relaxed = sample();
      lower.rotation.x = 1.8;
      garment.updatePose();
      expect(garment.mesh.morphTargetInfluences![0]).toBeCloseTo(1, 8);
      const flexed = sample();
      expect(flexed).not.toEqual(relaxed);
      lower.rotation.x = 0;
      garment.updatePose();
      expect(sample()).toEqual(relaxed);
      lower.rotation.x = 1.8;
      garment.updatePose();
      expect(sample()).toEqual(flexed);
      for (let i = 0; i < attributes.length; i++) expect(attributes[i].version).toBe(versions[i]);
    } finally {
      garment.dispose();
      geometry.dispose();
      material.dispose();
    }
  });
});
