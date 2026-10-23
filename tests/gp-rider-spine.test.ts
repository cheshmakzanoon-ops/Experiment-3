import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Rider, type RiderPose } from '../src/rendering/rider.ts';
import { GpRiderPosture } from '../src/rendering/gp-rider-posture.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop: () => undefined })
          : key === 'measureText'
            ? () => ({ width: 10 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 };
const base: RiderPose = { lean: 0, offset: 0, tuck: 0.6, braking: 0, steer: 0, speed: 48 };

function geometrySample(rider: Rider) {
  rider.root.updateMatrixWorld(true);
  const result: number[] = [],
    point = new T.Vector3();
  rider.root.traverse((object) => {
    result.push(...object.matrixWorld.elements);
    if (object instanceof T.SkinnedMesh) {
      const count = object.geometry.getAttribute('position').count;
      for (let i = 0; i < count; i += 23) {
        object.getVertexPosition(i, point);
        result.push(point.x, point.y, point.z);
      }
    }
  });
  return result;
}

describe('GP articulated spine and connected one-piece suit', () => {
  it.each(['high', 'mid'] as const)(
    '%s bends more in a tuck than under upright braking while the seat and pelvis stay planted',
    (detail) => {
      const rider = new Rider(colours, detail, 'leathers', 2, true),
        pelvis = rider.root.getObjectByName('Rider torso')!,
        chest = rider.root.getObjectByName('GP upper chest')!,
        relative = new T.Quaternion();
      try {
        rider.ride({ ...base, tuck: 1 });
        const tuckedAngle = relative
          .copy(pelvis.quaternion)
          .invert()
          .multiply(chest.quaternion)
          .angleTo(new T.Quaternion());
        rider.ride({ ...base, tuck: 0, braking: 1 });
        const brakingAngle = relative
          .copy(pelvis.quaternion)
          .invert()
          .multiply(chest.quaternion)
          .angleTo(new T.Quaternion());
        expect(tuckedAngle).toBeGreaterThan(brakingAngle + 0.15);
        expect(tuckedAngle).toBeLessThan(0.3);
        for (const lean of [-1.1, 0, 1.1])
          for (const tuck of [0, 1])
            for (const braking of [0, 1]) {
              const pose = { ...base, lean, offset: lean * 0.2, tuck, braking };
              rider.ride(pose);
              // The pelvis sits where the GP posture solver places it: on the
              // seat, slid within a hand's breadth (hang-off, tuck, braking).
              const expectedSeat = new GpRiderPosture().solve(pose, rider.seat).pelvis;
              expect(pelvis.position.distanceTo(expectedSeat)).toBeLessThan(1e-12);
              expect(pelvis.position.distanceTo(rider.seat)).toBeLessThan(0.2);
              const angle = relative
                .copy(pelvis.quaternion)
                .invert()
                .multiply(chest.quaternion)
                .angleTo(new T.Quaternion());
              expect(angle).toBeLessThan(0.35);
              expect(chest.position.distanceTo(pelvis.position)).toBeLessThan(0.085);
            }
      } finally {
        rider.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s keeps the collar and shoulder skin on the chest, and the seat skin on the pelvis',
    (detail) => {
      const rider = new Rider(colours, detail, 'leathers', 2, true),
        pelvis = rider.root.getObjectByName('Rider torso')!,
        chest = rider.root.getObjectByName('GP upper chest')!,
        torso = rider.root.getObjectByName('Rider leather torso') as T.SkinnedMesh,
        position = torso.geometry.getAttribute('position'),
        weights = torso.geometry.getAttribute('skinWeight'),
        point = new T.Vector3(),
        expected = new T.Vector3();
      rider.root.position.set(317, 4.2, -190);
      rider.root.rotation.set(0.27, 1.12, -0.56);
      try {
        expect(torso).toBeInstanceOf(T.SkinnedMesh);
        let maxWaistMovement = 0;
        for (const lean of [-1.1, 0, 1.1])
          for (const tuck of [0, 1])
            for (const braking of [0, 1]) {
              rider.ride({ ...base, lean, offset: lean * 0.2, tuck, braking });
              rider.root.updateMatrixWorld(true);
              let pelvisVertices = 0,
                chestVertices = 0;
              for (let i = 0; i < position.count; i++) {
                const y = position.getY(i);
                expect(weights.getX(i) + weights.getY(i)).toBeCloseTo(1, 6);
                expect(weights.getX(i)).toBeGreaterThanOrEqual(0);
                expect(weights.getY(i)).toBeGreaterThanOrEqual(0);
                torso.getVertexPosition(i, point);
                expect(torso.boundingBox!.containsPoint(point)).toBe(true);
                expect(torso.boundingSphere!.containsPoint(point)).toBe(true);
                point.applyMatrix4(torso.matrixWorld);
                if (y <= 0.06 || y >= 0.4) {
                  const frame = y <= 0.06 ? pelvis : chest;
                  expected.fromBufferAttribute(position, i).applyMatrix4(frame.matrixWorld);
                  expect(point.distanceTo(expected)).toBeLessThan(1e-7);
                  if (y <= 0.06) pelvisVertices++;
                  else chestVertices++;
                } else if (y > 0.16 && y < 0.31) {
                  expected.fromBufferAttribute(position, i).applyMatrix4(pelvis.matrixWorld);
                  maxWaistMovement = Math.max(maxWaistMovement, point.distanceTo(expected));
                }
              }
              expect(pelvisVertices).toBeGreaterThan(30);
              expect(chestVertices).toBeGreaterThan(30);
            }
        // A rigid torso under another name cannot satisfy this regression.
        expect(maxWaistMovement).toBeGreaterThan(0.015);
      } finally {
        rider.dispose();
      }
    },
  );

  it('restores the same skin after holds, direction changes and every recovery phase without buffer writes', () => {
    const rider = new Rider(colours, 'high', 'leathers', 2, true),
      torso = rider.root.getObjectByName('Rider leather torso') as T.SkinnedMesh,
      attributes = new Map<T.BufferAttribute, number>(),
      pose = { ...base, lean: 0.85, offset: 0.18, braking: 0.6, rearBraking: 0.5 };
    rider.root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const attribute of Object.values(object.geometry.attributes))
        if (attribute instanceof T.BufferAttribute) attributes.set(attribute, attribute.version);
    });
    let disposed = 0;
    torso.skeleton.computeBoneTexture();
    torso.skeleton.boneTexture!.addEventListener('dispose', () => disposed++);
    try {
      rider.ride(pose);
      const first = geometrySample(rider);
      for (const phase of [0, 1, 2]) {
        rider.ride({ ...pose, lean: -0.95, offset: -0.19, tuck: 0 });
        rider.separated(phase, 1.1, 0.43);
        const recovery = geometrySample(rider);
        rider.ride({ ...pose, tuck: 1, braking: 1 });
        rider.separated(phase, 1.1, 0.43);
        expect(geometrySample(rider)).toEqual(recovery);
        rider.ride(pose);
        expect(geometrySample(rider)).toEqual(first);
      }
      rider.ride(pose);
      expect(geometrySample(rider)).toEqual(first);
      for (const [attribute, version] of attributes) expect(attribute.version).toBe(version);
    } finally {
      rider.dispose();
    }
    expect(disposed).toBe(1);
  });

  it('leaves road, motocross and distant GP riders on their existing rigid torso path', () => {
    for (const [detail, kit, gp] of [
      ['mid', 'leathers', false],
      ['mid', 'motocross', true],
      ['far', 'leathers', true],
    ] as const) {
      const rider = new Rider(colours, detail, kit, 2, gp);
      try {
        expect(rider.root.getObjectByName('GP upper chest')).toBeUndefined();
        rider.ride(base);
        const first = geometrySample(rider);
        rider.separated(0, 1.5, 0.4);
        rider.ride(base);
        expect(geometrySample(rider)).toEqual(first);
      } finally {
        rider.dispose();
      }
    }
  });

  it('treats a non-finite front-brake snapshot as released across the connected torso, head and hands', () => {
    const rider = new Rider(colours, 'high', 'leathers', 2, true);
    try {
      rider.ride({ ...base, braking: 0 });
      const released = geometrySample(rider);
      expect(released.every(Number.isFinite)).toBe(true);
      for (const braking of [NaN, Infinity, -Infinity]) {
        rider.ride({ ...base, braking });
        expect(geometrySample(rider)).toEqual(released);
      }
    } finally {
      rider.dispose();
    }
  });
});
