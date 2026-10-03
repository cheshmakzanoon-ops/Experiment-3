import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CATCH_FENCE as M,
  FENCE_VARIANTS,
  catchFenceDocument,
  decodeCatchFence,
  loadCatchFence,
  fenceVariant,
} from '../src/rendering/catch-fence.ts';
import { conformTracksideGeometry } from '../src/rendering/trackside-module-conformance.ts';
import { Track } from '../src/simulation/track.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { barrierMaterials, buildBarrierChunk } from '../src/rendering/circuit-barriers.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const decode = () =>
  decodeCatchFence(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU_geometry_only',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );
describe('A03 authored catch-fence supports and retained analytic wire', () => {
  it('retains original source, self-contained PBR textures, sockets and bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = catchFenceDocument(bytes());
    expect(d.images).toHaveLength(3);
    expect(d.materials).toHaveLength(1);
    expect(Object.keys(M.sockets)).toHaveLength(15);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(5000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed headers, truncated data and corruption before resource decoding', async () => {
    expect(() => catchFenceDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => catchFenceDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeCatchFence(c)).rejects.toThrow('integrity');
  });
  it('retains finite indexed metre-space geometry and unit normals in every variant and tier', async () => {
    const kit = await decode();
    try {
      for (const v of FENCE_VARIANTS)
        for (const l of [0, 1, 2]) {
          const parts = kit.templates.get(`${v}:${l}`)!;
          expect(parts).toHaveLength(1);
          const g = parts[0].geometry;
          expect(g.index!.count / 3).toBe(M.triangles[v][l]);
          for (const name of ['position', 'normal', 'uv'])
            expect(Array.from(g.getAttribute(name).array).every(Number.isFinite)).toBe(true);
          const n = g.getAttribute('normal');
          for (let i = 0; i < n.count; i++)
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
        }
    } finally {
      kit.dispose();
    }
  });
  it('keeps the wire vertices, UVs, indices and transparent shadow policy byte-identical', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      old = new T.Group(),
      next = new T.Group(),
      m = barrierMaterials();
    try {
      buildBarrierChunk(track, old, 350, 430, m);
      buildBarrierChunk(track, next, 350, 430, m, null, null, kit);
      for (const name of ['Circuit fence 350-430m', 'Circuit concrete 350-430m']) {
        const a = old.getObjectByName(name) as T.Mesh,
          b = next.getObjectByName(name) as T.Mesh;
        expect(a).toBeInstanceOf(T.Mesh);
        expect(b).toBeInstanceOf(T.Mesh);
        for (const key of ['position', 'normal', 'uv'])
          expect(Array.from(a.geometry.getAttribute(key).array)).toEqual(
            Array.from(b.geometry.getAttribute(key).array),
          );
        expect(Array.from(a.geometry.index!.array)).toEqual(Array.from(b.geometry.index!.array));
      }
      const wire = next.getObjectByName('Circuit fence 350-430m') as T.Mesh;
      expect(wire.castShadow).toBe(false);
      expect(wire.receiveShadow).toBe(false);
      expect(m.fence.depthWrite).toBe(false);
      expect(m.fence.forceSinglePass).toBe(true);
      expect(next.getObjectByName('Circuit steel 350-430m')).toBeUndefined();
      let disposed = 0;
      m.fence.addEventListener('dispose', () => disposed++);
      kit.dispose();
      expect(disposed).toBe(0);
    } finally {
      kit.dispose();
      for (const root of [old, next])
        root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
      Object.values(m).forEach((x) => x.dispose());
    }
  });
  it('uses exactly one closed gate at each retained marshal station across all 1596 spans', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      sites = trackInfrastructurePlan(track).marshalPosts,
      root = new T.Group(),
      spans = Math.ceil(track.length / 80);
    kit.setGateSites(sites);
    try {
      let total = 0;
      for (let i = 0; i < spans; i++) {
        const a = (track.length * i) / spans,
          b = (track.length * (i + 1)) / spans;
        total += Math.ceil((b - a) / 3.8) * 2;
        kit.buildChunk(track, root, a, b);
      }
      expect(kit.diagnostics().modules).toBe(total);
      expect(total).toBe(1596);
      expect(kit.diagnostics().gates).toBe(sites.length);
      expect(sites).toHaveLength(12);
      expect(kit.diagnostics()).toMatchObject({
        retainedAnalyticWire: true,
        gateOperation: false,
        physicsChanged: false,
      });
      expect(() => kit.setGateSites([])).toThrow('already constructed');
      for (const c of kit.chunks) {
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
        expect(c.sphere.radius).toBeLessThan(50);
      }
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(kit.chunks[0].sphere.center);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(0);
      camera.position.addScalar(10000);
      kit.update(camera, 'high');
      expect(kit.chunks.every((c) => c.level === 2)).toBe(true);
    } finally {
      kit.dispose();
    }
  });
  it('owns a stable gate-site snapshot, deterministic variants and explicit invalid-span errors', async () => {
    const kit = await decode(),
      sites = [{ s: 365, side: -1 }];
    kit.setGateSites(sites);
    sites[0].s = 9000;
    kit.buildChunk(new Track('clear'), new T.Group(), 350, 430);
    expect(kit.diagnostics().gates).toBe(1);
    expect(fenceVariant(360, 365, -1, [{ s: 365, side: -1 }]).variant).not.toBe('gate');
    expect(fenceVariant(365, 370, -1, [{ s: 365, side: -1 }]).variant).toBe('gate');
    const template = kit.templates.get('run:0')![0].geometry;
    expect(() => conformTracksideGeometry(template, new Track('clear'), 0, 3.8, 1, 0)).toThrow(
      'span',
    );
    expect(() => conformTracksideGeometry(template, new Track('clear'), 4, 3, 1, 3.8)).toThrow(
      'span',
    );
    kit.dispose();
  });
  it('releases all template and chunk geometries exactly once', async () => {
    const kit = await decode();
    kit.buildChunk(new Track('clear'), new T.Group(), 0, 40);
    const set = new Set<T.BufferGeometry>();
    kit.templates.forEach((ps) => ps.forEach((p) => set.add(p.geometry)));
    kit.root.traverse((o) => {
      if (o instanceof T.Mesh) set.add(o.geometry);
    });
    let count = 0;
    set.forEach((g) => g.addEventListener('dispose', () => count++));
    kit.dispose();
    kit.dispose();
    expect(count).toBe(set.size);
    expect(kit.root.parent).toBeNull();
  });
  it('cancels before transport and rejects missing/truncated/oversized streams', async () => {
    const f = vi.fn();
    await expect(loadCatchFence(() => true, 'https://example.invalid', f)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadCatchFence(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadCatchFence(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadCatchFence(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
