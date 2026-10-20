import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  addMotocrossGlove,
  motocrossBootShell,
  motocrossBootSole,
  motocrossGlovePalm,
} from '../src/rendering/offroad/motocross-rider-equipment.ts';
import { motocrossHelmetPeak } from '../src/rendering/offroad/motocross-gear.ts';

/** Inspect the rendered triangles, welding only coincident UV/cap corners.
 * A missing surface, reversed reflection or collapsed tangent cannot pass by
 * exposing a correctly named but geometrically invalid helper object. */
function inspectClosedGeometry(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv'),
    normal = geometry.getAttribute('normal'),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    cross = new T.Vector3(),
    edges = new Map<string, number>();
  let volume = 0,
    minimumArea = Infinity,
    minimumUvArea = Infinity,
    normalError = 0;
  const id = (i: number) =>
    [position.getX(i), position.getY(i), position.getZ(i)]
      .map((v) => Math.round(v * 1e7))
      .join('/');
  for (const attribute of Object.values(geometry.attributes))
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  for (let i = 0; i < position.count; i++)
    normalError = Math.max(
      normalError,
      Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1),
    );
  for (let i = 0; i < geometry.index!.count; i += 3) {
    const ia = geometry.index!.getX(i),
      ib = geometry.index!.getX(i + 1),
      ic = geometry.index!.getX(i + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    volume += a.dot(cross.crossVectors(b, c)) / 6;
    minimumArea = Math.min(minimumArea, cross.subVectors(b, a).cross(c.clone().sub(a)).lengthSq());
    minimumUvArea = Math.min(
      minimumUvArea,
      Math.abs(
        (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
          (uv.getY(ib) - uv.getY(ia)) * (uv.getX(ic) - uv.getX(ia)),
      ),
    );
    for (const [from, to] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ]) {
      const key = [id(from), id(to)].sort().join('|');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((count) => count === 2)).toBe(true);
  expect(volume).toBeGreaterThan(0);
  expect(minimumArea).toBeGreaterThan(1e-20);
  expect(minimumUvArea).toBeGreaterThan(1e-10);
  expect(normalError).toBeLessThan(1e-5);
  return volume;
}

describe('motocross anatomical rider equipment', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s boots have a closed continuous calf-to-toe surface with outward mirrored winding',
    (detail) => {
      const left = motocrossBootShell(detail, 1),
        right = motocrossBootShell(detail, -1),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        ray = new T.Raycaster();
      try {
        expect(inspectClosedGeometry(left)).toBeCloseTo(inspectClosedGeometry(right), 9);
        const mesh = new T.Mesh(left, material);
        // Every intermediate level between calf and shoe has a real front
        // and back surface. This includes the former cylinder/shoe junction.
        for (let y = -0.32; y < 0.019; y += 0.004) {
          ray.set(new T.Vector3(0, y, 0.4), new T.Vector3(0, 0, -1));
          const hits = ray.intersectObject(mesh);
          expect(hits.length).toBeGreaterThanOrEqual(2);
          expect(hits[0].point.z).toBeGreaterThan(0.02);
          expect(hits[hits.length - 1].point.z).toBeLessThan(-0.02);
        }
        expect(left.boundingBox!.min.y).toBeGreaterThan(-0.326);
        expect(left.boundingBox!.max.y).toBeLessThan(0.02);
        expect(left.boundingBox!.max.z).toBeGreaterThan(0.15);
        expect(left.boundingBox!.max.z).toBeLessThan(0.17);
        expect(left.index!.count / 3).toBeLessThan(2700);
      } finally {
        left.dispose();
        right.dispose();
        material.dispose();
      }
    },
  );

  it('retains a tapered sole inside the ankle contact envelope at every detail level', () => {
    const counts: number[] = [];
    for (const detail of ['high', 'mid', 'far'] as const) {
      const left = motocrossBootSole(detail, 1),
        right = motocrossBootSole(detail, -1);
      try {
        counts.push(left.getAttribute('position').count);
        for (const geometry of [left, right]) {
          const bounds = geometry.boundingBox!;
          expect(bounds.max.y).toBeLessThan(0.032);
          expect(bounds.min.y).toBeGreaterThan(0.013);
          expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0.25);
          expect(bounds.max.z - bounds.min.z).toBeLessThan(0.27);
          expect(bounds.max.x - bounds.min.x).toBeLessThan(0.11);
        }
        expect(left.boundingBox!.min.x).toBeCloseTo(-right.boundingBox!.max.x, 6);
        expect(left.boundingBox!.max.x).toBeCloseTo(-right.boundingBox!.min.x, 6);
      } finally {
        left.dispose();
        right.dispose();
      }
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });

  it.each(['high', 'mid', 'far'] as const)(
    '%s gloves preserve closed, tapered palms without changing the wrist frame',
    (detail) => {
      for (const side of [-1, 1]) {
        const geometry = motocrossGlovePalm(detail, side);
        try {
          inspectClosedGeometry(geometry);
          expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeLessThan(0.071);
          expect(geometry.boundingBox!.max.z).toBeCloseTo(0.052, 6);
          expect(geometry.boundingBox!.min.z).toBeCloseTo(-0.024, 6);
        } finally {
          geometry.dispose();
        }
      }
    },
  );

  it('closes each curled fingertip and thumb with finite normal-map UVs', () => {
    const hand = new T.Group(),
      material = new T.MeshStandardMaterial();
    try {
      addMotocrossGlove(hand, 'high', 1, material, material, material);
      const digits = hand.children.filter(
        (object) =>
          object instanceof T.Mesh &&
          object.geometry.name === 'Motocross tapered curled glove digit',
      ) as T.Mesh[];
      expect(digits).toHaveLength(5);
      for (const finger of digits) inspectClosedGeometry(finger.geometry);
      expect(hand.position.toArray()).toEqual([0, 0, 0]);
      expect(hand.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    } finally {
      for (const child of hand.children) if (child instanceof T.Mesh) child.geometry.dispose();
      material.dispose();
    }
  });

  it.each(['high', 'mid'] as const)(
    '%s helmet peak has two through apertures and a thin complete centre ridge',
    (detail) => {
      const geometry = motocrossHelmetPeak(detail),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        mesh = new T.Mesh(geometry, material),
        ray = new T.Raycaster();
      try {
        for (const x of [-0.056, 0.056]) {
          ray.set(new T.Vector3(x, 0.6, 0.116), new T.Vector3(0, -1, 0));
          expect(ray.intersectObject(mesh)).toHaveLength(0);
        }
        ray.set(new T.Vector3(0, 0.6, 0.116), new T.Vector3(0, -1, 0));
        const hits = ray.intersectObject(mesh);
        expect(hits.length).toBeGreaterThanOrEqual(2);
        expect(hits[0].point.y - hits[hits.length - 1].point.y).toBeCloseTo(0.0045, 5);
        expect(geometry.index!.count / 3).toBeLessThan(1100);
      } finally {
        geometry.dispose();
        material.dispose();
      }
    },
  );
});
