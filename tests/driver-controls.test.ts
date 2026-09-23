import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { fingerGeometry } from '../src/rendering/driver-anatomy.ts';
import { ShiftFinger, shiftPaddleGeometry, PADDLE_PULL } from '../src/rendering/driver-controls.ts';
import { HAND_ANCHOR } from '../src/rendering/wheel-grip.ts';
import {
  conformingBelt,
  seatedTorsoFront,
  HelmetTethers,
  helmetTetherPost,
} from '../src/rendering/driver-restraints.ts';

describe('Coupled cockpit contact surfaces', () => {
  it('keeps distal finger contact with its actual moving paddle, while preserving the proximal grip', () => {
    for (const side of [-1, 1]) {
      const geometry = fingerGeometry(side, 0),
        finger = new ShiftFinger(geometry, side);
      const position = geometry.getAttribute('position'),
        rest = Float32Array.from(position.array);
      const paddle = new T.Mesh(
        shiftPaddleGeometry(),
        new T.MeshBasicMaterial({ side: T.DoubleSide }),
      );
      const pivot = new T.Group();
      pivot.position.set(side * 0.104, 0, 0.041);
      paddle.position.x = side * 0.017;
      pivot.add(paddle);
      const contact = new T.Vector3(),
        normal = new T.Vector3(),
        ray = new T.Raycaster();
      let restGap = NaN;
      for (const pull of [0, 0.25, 0.5, 0.75, 1, 0.1, 0, 1, 0]) {
        finger.pose(pull);
        pivot.rotation.y = side * pull * PADDLE_PULL;
        pivot.updateMatrixWorld(true);
        contact
          .fromBufferAttribute(position, finger.contactVertex)
          .add(new T.Vector3(side * HAND_ANCHOR.x, HAND_ANCHOR.y, HAND_ANCHOR.z));
        normal.set(0, 0, 1).applyQuaternion(pivot.quaternion);
        ray.set(contact.clone().addScaledVector(normal, -0.02), normal);
        const hits = ray.intersectObject(paddle, false);
        expect(hits.length).toBeGreaterThan(0);
        const gap = hits[0].distance - 0.02;
        // A thin glove may compress on a paddle, but must not miss it by centimetres.
        expect(Math.abs(gap)).toBeLessThan(0.001);
        if (Number.isNaN(restGap)) restGap = gap;
        expect(gap).toBeCloseTo(restGap, 6);
        for (let i = 0; i < 7 * 17; i++)
          for (let k = 0; k < 3; k++) expect(position.array[i * 3 + k]).toBe(rest[i * 3 + k]);
        expect(position.array.length).toBe(rest.length);
        const n = geometry.getAttribute('normal');
        for (let i = 0; i < n.count; i++)
          expect(new T.Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 5);
      }
      expect(position.array).toEqual(rest);
      expect(() => finger.pose(NaN)).toThrow();
      expect(() => finger.pose(1.1)).toThrow();
      geometry.dispose();
      paddle.geometry.dispose();
      paddle.material.dispose();
    }
  });
  it('constructs solid outward-facing webbing that clears the authored suit across every edge', () => {
    for (const side of [-1, 1]) {
      const g = conformingBelt(
        [
          new T.Vector2(side * 0.11, 0.05),
          new T.Vector2(side * 0.105, -0.038),
          new T.Vector2(side * 0.076, -0.145),
          new T.Vector2(side * 0.025, -0.228),
        ],
        0.045,
      );
      const p = g.getAttribute('position'),
        idx = g.index!,
        a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3();
      const edges = new Map<string, number>();
      for (let i = 0; i < idx.count; i += 3) {
        for (const [j, k] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ]) {
          const x = idx.getX(i + j),
            y = idx.getX(i + k),
            key = [Math.min(x, y), Math.max(x, y)].join(',');
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every((n) => n === 2)).toBe(true);
      for (let row = 0; row <= 32; row++) {
        for (let j = 0; j < 4; j++) {
          const k = row * 4 + j;
          expect(p.getZ(k) - seatedTorsoFront(p.getX(k), p.getY(k))).toBeGreaterThan(0.0019);
          expect(p.getZ(k) - seatedTorsoFront(p.getX(k), p.getY(k))).toBeLessThan(0.0046);
        }
        if (row < 32) {
          const i = row * 24;
          a.fromBufferAttribute(p, idx.getX(i));
          b.fromBufferAttribute(p, idx.getX(i + 1));
          c.fromBufferAttribute(p, idx.getX(i + 2));
          expect(b.sub(a).cross(c.sub(a)).z).toBeGreaterThan(0);
        }
      }
      g.dispose();
    }
    expect(() => conformingBelt([], 0.04)).toThrow();
    expect(() => seatedTorsoFront(Infinity, 0)).toThrow();
  });
  it('binds both webbing endpoints to the same helmet posts through loads and replay rewinds', () => {
    const material = new T.MeshStandardMaterial(),
      tethers = new HelmetTethers(material);
    const buffers = tethers.root.children.map(
      (o) => (o as T.Mesh).geometry.getAttribute('position').array,
    );
    let before: number[][] = [];
    for (const [pitch, roll] of [
      [0.04, -0.05],
      [-0.054, 0.065],
      [0, 0],
      [0.04, -0.05],
    ]) {
      tethers.update(pitch, roll);
      for (let i = 0; i < 2; i++) {
        const p = (tethers.root.children[i] as T.Mesh).geometry.getAttribute('position');
        expect(p.array).toBe(buffers[i]);
        const centre = new T.Vector3()
          .fromBufferAttribute(p, 16)
          .add(new T.Vector3().fromBufferAttribute(p, 17))
          .multiplyScalar(0.5);
        const expected = helmetTetherPost(i ? 1 : -1)
          .applyEuler(new T.Euler(pitch, 0, roll))
          .add(new T.Vector3(0, 0.17, -0.4));
        expect(centre.distanceTo(expected)).toBeLessThan(1e-7);
      }
      const sample = buffers.map((a) => Array.from(a));
      if (!before.length) before = sample;
      else if (pitch === 0.04) expect(sample).toEqual(before);
    }
    for (const o of tethers.root.children) {
      const m = o as T.Mesh;
      m.geometry.dispose();
      (m.material as T.Material).dispose();
    }
    material.dispose();
  });
});
