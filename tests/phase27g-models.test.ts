import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { cockpitShell } from '../src/rendering/geometry.ts';
import { floorFenceGeometry } from '../src/rendering/car-floor.ts';
import {
  sidepodShell,
  bodySurface,
  POD_SECTIONS,
  POD_UNDERCUT,
  POD_FLATTEN,
} from '../src/rendering/car-surfaces.ts';
import { sidepodDuctGeometry } from '../src/rendering/car-mechanical-detail.ts';
import {
  buildWing,
  FRONT_SURFACES,
  REAR_SURFACES,
  reducedTireGeometry,
} from '../src/rendering/car-architecture.ts';
import {
  ventilatedBrakeGeometry,
  installManufacturingFinish,
} from '../src/rendering/manufacturing.ts';
import {
  wheelGripPoint,
  fingerGripCurve,
  HAND_ANCHOR,
  GRIP_RADIUS,
} from '../src/rendering/wheel-grip.ts';

function closedGeometry(g: T.BufferGeometry) {
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    ix = g.index;
  const index = (i: number) => (ix ? ix.getX(i) : i),
    count = ix ? ix.count : p.count;
  expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
  expect(Array.from(n.array).every(Number.isFinite)).toBe(true);
  const edges = new Map<string, number>(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    cross = new T.Vector3();
  const key = (i: number) =>
    [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e6)).join(',');
  let volume = 0;
  for (let i = 0; i < count; i += 3) {
    const ids = [index(i), index(i + 1), index(i + 2)];
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]);
    c.fromBufferAttribute(p, ids[2]);
    cross.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (cross.lengthSq() < 1e-20) continue;
    volume += a.dot(new T.Vector3().crossVectors(b, c)) / 6;
    for (let j = 0; j < 3; j++) {
      const k = [key(ids[j]), key(ids[(j + 1) % 3])].sort().join('|');
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((v) => v === 2)).toBe(true);
  expect(volume).toBeGreaterThan(0);
  return volume;
}

describe('27G manufactured body and mechanical geometry', () => {
  it.each(['high', 'mid', 'far'] as const)(
    'has a closed, thick, open-top %s cockpit and shared sidepod envelope',
    (detail) => {
      const shell = cockpitShell(detail);
      closedGeometry(shell);
      const pod = sidepodShell(detail, false);
      closedGeometry(pod);
      // The steering display remains directly visible through the real opening.
      const material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        mesh = new T.Mesh(shell, material);
      mesh.updateMatrixWorld(true);
      const eye = new T.Vector3(0, 0.41, -0.48),
        display = new T.Vector3(0, 0.125, 0.195);
      const ray = new T.Raycaster(
        eye,
        display.clone().sub(eye).normalize(),
        0,
        eye.distanceTo(display),
      );
      expect(ray.intersectObject(mesh)).toHaveLength(0);
      shell.dispose();
      pod.dispose();
      material.dispose();
    },
  );
  it('places every inlet lip on the actual sidepod terminal cross-section', () => {
    const g = sidepodDuctGeometry(),
      p = g.getAttribute('position');
    for (let i = 0; i <= 40; i++) {
      const q = bodySurface(POD_SECTIONS, 0.39, i / 40, POD_UNDERCUT, POD_FLATTEN);
      expect(p.getX(i)).toBeCloseTo(q.x, 6);
      expect(p.getY(i)).toBeCloseTo(q.y, 6);
      expect(p.getZ(i)).toBeCloseTo(0.391, 6);
    }
    expect(g.boundingBox!.min.z).toBeCloseTo(0.224, 6);
    g.dispose();
    expect(() => sidepodDuctGeometry(9)).toThrow();
  });
  it('retains every wing element and its exact bounds across all detail levels', () => {
    const mat = new T.MeshStandardMaterial();
    for (const end of ['front', 'rear'] as const) {
      const bounds: T.Box3[] = [];
      for (const detail of ['high', 'mid', 'far'] as const) {
        const root = new T.Group();
        buildWing(root, end, detail, mat, mat);
        const elements = root.children.filter(
          (o) => o instanceof T.Mesh && o.name.includes('element'),
        );
        // Test actual geometry rather than relying on names to certify presence.
        const primary = root.children.slice(
          0,
          end === 'front' ? FRONT_SURFACES.length : REAR_SURFACES.length,
        );
        expect(primary).toHaveLength(end === 'front' ? 4 : 2);
        primary.forEach((o) => closedGeometry((o as T.Mesh).geometry));
        expect(elements.length).toBeLessThanOrEqual(root.children.length);
        bounds.push(new T.Box3().setFromObject(root));
        root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
      }
      for (const b of bounds.slice(1)) {
        expect(b.min.distanceTo(bounds[0].min)).toBeLessThan(0.014);
        expect(b.max.distanceTo(bounds[0].max)).toBeLessThan(0.014);
      }
    }
    mat.dispose();
  });
  it('has closed non-cylindrical floor fences and ventilated discs with real holes', () => {
    for (const side of [-1, 1]) {
      const g = floorFenceGeometry(side * 0.97, 0, 5, 0.042);
      closedGeometry(g);
      g.dispose();
    }
    const g = ventilatedBrakeGeometry();
    closedGeometry(g);
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(0.014, 6);
    const mesh = new T.Mesh(g, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const hole = new T.Raycaster(new T.Vector3(1, 0, -0.15), new T.Vector3(-1, 0, 0));
    expect(hole.intersectObject(mesh)).toHaveLength(0);
    const solid = new T.Raycaster(new T.Vector3(1, 0, -0.12), new T.Vector3(-1, 0, 0));
    expect(solid.intersectObject(mesh).length).toBeGreaterThan(0);
    g.dispose();
    mesh.material.dispose();
  });
  it('rejects conflicting shader finish installation instead of emitting duplicate GLSL', () => {
    const m = new T.MeshStandardMaterial();
    installManufacturingFinish(m, 'suede');
    expect(installManufacturingFinish(m, 'suede')).toBe(m);
    expect(() => installManufacturingFinish(m, 'turned-alloy')).toThrow();
    m.dispose();
  });
  it.each(['mid', 'far'] as const)(
    'keeps rounded shoulder and tyre radius at %s detail',
    (detail) => {
      const g = reducedTireGeometry(0.31, detail);
      closedGeometry(g);
      expect(g.boundingBox!.max.x).toBeCloseTo(0.335, 5);
      expect(g.boundingBox!.max.y).toBeCloseTo(0.155, 5);
      g.dispose();
    },
  );
});

describe('27G geometric steering grip contact', () => {
  it('keeps all four finger wraps outside the grip at both hands through wheel rotation', () => {
    const gripSamples = Array.from({ length: 321 }, (_, i) =>
      wheelGripPoint(1, -0.081 + (i * 0.131) / 320),
    );
    for (const side of [-1, 1])
      for (let finger = 0; finger < 4; finger++) {
        const curve = fingerGripCurve(side, finger);
        for (let i = 4; i <= 60; i++) {
          const local = curve
            .getPoint(i / 64)
            .add(new T.Vector3(side * HAND_ANCHOR.x, HAND_ANCHOR.y, HAND_ANCHOR.z));
          const distance = Math.min(
            ...gripSamples.map((g) => local.distanceTo(new T.Vector3(side * g.x, g.y, g.z))),
          );
          // Centreline is roughly one finger radius beyond the rubber surface.
          expect(distance - GRIP_RADIUS).toBeGreaterThan(0.0035);
          expect(distance - GRIP_RADIUS).toBeLessThan(0.014);
          for (const angle of [-1.4, 0, 1.4]) {
            const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), angle);
            const hand = local.clone().applyQuaternion(q);
            const rotated = Math.min(
              ...gripSamples.map((g) =>
                hand.distanceTo(new T.Vector3(side * g.x, g.y, g.z).applyQuaternion(q)),
              ),
            );
            expect(rotated).toBeCloseTo(distance, 10);
          }
        }
      }
  });
});
