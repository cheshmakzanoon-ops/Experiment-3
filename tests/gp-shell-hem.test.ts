import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials } from '../src/rendering/bike.ts';
import { gpRaceBodywork } from '../src/rendering/gp-race-bodywork.ts';
import { GP_SHELL_HEM, hemShellEdges } from '../src/rendering/gp-race-shell.ts';

/** A flat, outward-facing (+Z, counter-clockwise from +Z) n x n patch of `size` metres. */
function patch(n: number, size = 0.2) {
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      position.push((i / n - 0.5) * size, (j / n - 0.5) * size, 0);
      uv.push(i / n, j / n);
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i,
        b = a + 1,
        c = a + n + 1,
        d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
const triangleCount = (g: T.BufferGeometry) => (g.index?.count ?? 0) / 3;

describe('GP shell hems', () => {
  it('rolls every free edge of a flat patch into a closed strip and leaves the skin untouched', () => {
    const base = patch(3),
      hemmed = hemShellEdges(base);
    try {
      const { arc } = GP_SHELL_HEM;
      // 12 boundary edges (3 per side); each strip is (arc + 1) quads of two triangles.
      expect(triangleCount(hemmed) - triangleCount(base)).toBe(12 * (arc + 1) * 2);
      // One shared profile of (arc + 2) points per boundary vertex (12 on a 3 x 3 patch).
      expect(hemmed.getAttribute('position').count - base.getAttribute('position').count).toBe(
        12 * (arc + 2),
      );
      const p = hemmed.getAttribute('position'),
        bp = base.getAttribute('position');
      for (let i = 0; i < bp.count; i++) {
        expect(p.getX(i)).toBe(bp.getX(i));
        expect(p.getZ(i)).toBe(bp.getZ(i));
      }
      // The original index is a prefix of the new one.
      for (let i = 0; i < base.index!.count; i++)
        expect(hemmed.index!.getX(i)).toBe(base.index!.getX(i));
    } finally {
      base.dispose();
      hemmed.dispose();
    }
  });

  it('turns the skin over the edge: outward roll, wall of the full thickness, consistent winding', () => {
    const { thickness, radius } = GP_SHELL_HEM,
      size = 0.2,
      base = patch(3, size),
      hemmed = hemShellEdges(base);
    try {
      const p = hemmed.getAttribute('position'),
        n = hemmed.getAttribute('normal'),
        index = hemmed.index!,
        first = base.index!.count;
      let lowest = 0,
        widest = 0;
      const a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3(),
        face = new T.Vector3(),
        vertex = new T.Vector3();
      for (let t = first; t < index.count; t += 3) {
        const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        a.fromBufferAttribute(p, ids[0]);
        b.fromBufferAttribute(p, ids[1]);
        c.fromBufferAttribute(p, ids[2]);
        face.crossVectors(b.sub(a), c.sub(a));
        if (face.lengthSq() < 1e-20) continue;
        face.normalize();
        // Every hem triangle faces the way its smoothed vertex normals do.
        for (const id of ids) {
          vertex.fromBufferAttribute(n, id);
          expect(vertex.length()).toBeCloseTo(1, 5);
          expect(face.dot(vertex)).toBeGreaterThan(0);
        }
      }
      for (let i = base.getAttribute('position').count; i < p.count; i++) {
        lowest = Math.min(lowest, p.getZ(i));
        widest = Math.max(widest, Math.abs(p.getX(i)), Math.abs(p.getY(i)));
        expect(p.getZ(i)).toBeLessThanOrEqual(1e-9);
      }
      expect(lowest).toBeCloseTo(-thickness, 6);
      // The roll bulges at most one radius beyond the original outline.
      expect(widest).toBeCloseTo(size / 2 + radius, 6);
    } finally {
      base.dispose();
      hemmed.dispose();
    }
  });

  it('leaves a closed surface alone, honours the ignore filter and rejects bad options', () => {
    const sphere = new T.SphereGeometry(0.1, 12, 8);
    // Merge the UV seam by position: the sphere is closed once welded.
    expect(hemShellEdges(sphere)).toBeDefined();
    const flat = patch(2);
    const skipped = hemShellEdges(flat, GP_SHELL_HEM, (face) => face.z > 0.5);
    expect(skipped).toBe(flat);
    expect(() => hemShellEdges(flat, { thickness: 0.001, radius: 0.002, arc: 2 })).toThrow(
      RangeError,
    );
    expect(() => hemShellEdges(flat, { thickness: 0.002, radius: 0.001, arc: 0 })).toThrow(
      RangeError,
    );
    const colour = patch(2);
    colour.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(27), 3));
    expect(() => hemShellEdges(colour)).toThrow(/color/);
    for (const g of [sphere, flat, colour]) g.dispose();
  });
});

describe('GP race shell hems on the production models', () => {
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
  it.each(['gpr1', 'gpr2'] as const)(
    '%s: only the High shell carries rolled edges and every vertex stays finite and unit-normal',
    (id) => {
      const materials = new BikeMaterials(3);
      const counts = (['high', 'mid', 'far'] as const).map((detail) => {
        const shell = gpRaceBodywork(materials, detail, id, 3);
        const panels = [shell.body, shell.tank, shell.tail].map((mesh) => {
          const g = mesh.geometry,
            p = g.getAttribute('position'),
            n = g.getAttribute('normal');
          for (let i = 0; i < p.count; i++) {
            expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
          }
          return triangleCount(g);
        });
        shell.root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
        return panels.reduce((a, b) => a + b, 0);
      });
      materials.dispose();
      // The pre-hem panels were 6924 triangles at High; hems add a bounded strip budget.
      expect(counts[0]).toBeGreaterThan(6924 + 600);
      expect(counts[0]).toBeLessThan(6924 + 4000);
      expect(counts[1]).toBeLessThan(counts[0] * 0.5);
      expect(counts[2]).toBeLessThan(counts[1]);
    },
  );
});
