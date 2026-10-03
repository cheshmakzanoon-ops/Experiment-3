import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  CONCRETE_BARRIERS as M,
  BARRIER_VARIANTS,
  concreteBarrierDocument,
  concreteBarrierLod,
  barrierVariant,
  decodeConcreteBarriers,
  loadConcreteBarriers,
} from '../src/rendering/concrete-barriers.ts';
import { barrierMaterials, buildBarrierChunk } from '../src/rendering/circuit-barriers.ts';
const bytes = () => new Uint8Array(readFileSync('public/models/aurel-concrete-barriers.glb'));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const decode = () =>
  decodeConcreteBarriers(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU_geometry_only',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );
describe('A01 authored concrete race barriers', () => {
  it('retains editable source, exact provenance and three self-contained PBR maps', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = concreteBarrierDocument(bytes());
    expect(d.images).toHaveLength(3);
    expect(d.materials).toHaveLength(1);
    for (const counts of Object.values(M.triangles)) {
      expect(counts[0]).toBeLessThan(1600);
      expect(counts[0]).toBeGreaterThan(counts[1]);
      expect(counts[1]).toBeGreaterThan(counts[2]);
    }
    expect(M.bytes).toBeLessThan(2 * 1024 * 1024);
  });
  it('rejects corruption and malformed payloads before texture allocation', async () => {
    expect(() => concreteBarrierDocument(bytes().slice(0, -1))).toThrow('byte');
    const header = bytes();
    header[0] = 0;
    expect(() => concreteBarrierDocument(header)).toThrow('header');
    const changed = bytes();
    changed[changed.length - 1] ^= 1;
    await expect(decodeConcreteBarriers(changed)).rejects.toThrow('integrity');
  });
  it('preserves finite, correctly scaled indexed templates, normals, UVs and colour variation', async () => {
    const kit = await decode();
    try {
      expect(kit.templates.size).toBe(9);
      for (const variant of BARRIER_VARIANTS)
        for (const level of [0, 1, 2]) {
          const g = kit.templates.get(`${variant}:${level}`)!;
          g.computeBoundingBox();
          expect(g.index!.count / 3).toBe(M.triangles[variant][level]);
          const extent = g.boundingBox!.getSize(new T.Vector3());
          expect(extent.x).toBeCloseTo(0.55, 4);
          expect(extent.y).toBeCloseTo(0.995, 4);
          expect(extent.z).toBeCloseTo(3.8, 4);
          for (const name of ['position', 'normal', 'uv', 'color'])
            expect(Array.from(g.getAttribute(name).array).every(Number.isFinite)).toBe(true);
          const n = g.getAttribute('normal');
          for (let i = 0; i < n.count; i++)
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
        }
    } finally {
      kit.dispose();
    }
  });
  it('conforms both endpoints to the retained cambered boundary and keeps footings embedded', async () => {
    const kit = await decode(),
      track = new Track('clear');
    try {
      for (const start of [30, 715, 1200, 1800])
        for (const side of [-1, 1])
          for (const level of [0, 1, 2]) {
            const end = start + 3.6,
              template = kit.templates.get(`clean:${level}`)!,
              g = kit.conform(track, start, end, side, 'clean', level),
              p = g.getAttribute('position'),
              src = template.getAttribute('position');
            for (let i = 0; i < p.count; i++) {
              const t = src.getZ(i) / 3.8;
              if (t > 1e-5 && t < 1 - 1e-5) continue;
              const point = track.at(t < 0.5 ? start : end, trackPoint()),
                l = side * track.boundary(point.s, side) + src.getX(i);
              expect(p.getY(i)).toBeCloseTo(
                point.y + point.bank * Math.max(-12, Math.min(12, l)) + src.getY(i),
                4,
              );
              expect(
                Math.hypot(
                  p.getX(i) - (point.x + point.nx * l),
                  p.getZ(i) - (point.z + point.nz * l),
                ),
              ).toBeLessThan(0.0002);
            }
            g.dispose();
          }
    } finally {
      kit.dispose();
    }
  });
  it('replaces only concrete, with one material draw per bounded chunk and one selected LOD', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group(),
      m = barrierMaterials();
    try {
      buildBarrierChunk(track, root, 30, 70, m, kit);
      expect(root.children).toHaveLength(3);
      expect(
        root.children
          .filter((o) => o instanceof T.Mesh)
          .map((o) => o.name)
          .sort(),
      ).toEqual(['Circuit fence 30-70m', 'Circuit steel 30-70m']);
      expect(kit.chunks).toHaveLength(1);
      expect(kit.chunks[0].sphere.radius).toBeLessThan(45);
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(kit.chunks[0].sphere.center);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(0);
      expect(kit.chunks[0].levels.filter((l) => l.visible)).toHaveLength(1);
      camera.position.addScalar(1000);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(2);
      expect(kit.diagnostics().physicsChanged).toBe(false);
      expect(kit.diagnostics().modules).toBe(22);
    } finally {
      kit.dispose();
      root.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      Object.values(m).forEach((v) => v.dispose());
    }
  });
  it('uses stable deterministic variants and lens-aware LOD hysteresis', () => {
    expect(concreteBarrierLod(41, 0, 'high')).toBe(0);
    expect(concreteBarrierLod(41, 1, 'high')).toBe(1);
    expect(concreteBarrierLod(140, 2, 'high')).toBe(2);
    expect(concreteBarrierLod(140, 1, 'high')).toBe(1);
    for (const s of [0, 3.8, 40, 715]) expect(barrierVariant(s, -1)).toBe(barrierVariant(s, -1));
    expect(new Set(Array.from({ length: 100 }, (_, i) => barrierVariant(i * 3.8, 1))).size).toBe(3);
  });
  it('owns and releases each source/runtime resource once, including repeated disposal', async () => {
    const kit = await decode();
    kit.buildChunk(new Track('clear'), new T.Group(), 30, 40);
    const owned = [
      ...kit.templates.values(),
      ...kit.chunks.flatMap((c) => c.levels.map((l) => l.geometry)),
    ];
    let disposed = 0;
    owned.forEach((g) => g.addEventListener('dispose', () => disposed++));
    kit.dispose();
    kit.dispose();
    expect(disposed).toBe(owned.length);
    expect(kit.root.parent).toBeNull();
    expect(kit.diagnostics().loaded).toBe(false);
  });
  it('cancels before transport and rejects missing, truncated or oversized downloads', async () => {
    const fetcher = vi.fn();
    await expect(
      loadConcreteBarriers(() => true, 'https://example.invalid', fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      loadConcreteBarriers(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadConcreteBarriers(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadConcreteBarriers(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
