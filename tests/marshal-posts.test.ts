import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  MARSHAL_POSTS as M,
  MARSHAL_VARIANTS,
  marshalPostDocument,
  decodeMarshalPosts,
  loadMarshalPosts,
  marshalPostMatrix,
  conformMarshalPostGeometry,
} from '../src/rendering/marshal-posts.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  trackInfrastructurePlan,
  buildTrackInfrastructure,
  updateSafetyPanel,
} from '../src/rendering/track-infrastructure.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { H } from '../src/simulation/protocol.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeMarshalPosts(bytes(), loader());
function disposeTree(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      gs.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) ms.add(m);
    }
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
}
function intersects(g: T.BufferGeometry, box: T.Box3) {
  const p = g.getAttribute('position'),
    idx = g.index!,
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    triangle = new T.Triangle(a, b, c);
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    if (box.intersectsTriangle(triangle)) return true;
  }
  return false;
}
describe('A06 authored marshal shelters and retained signals', () => {
  it('retains exact original source/export, packed atlas, fourteen sockets and bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = marshalPostDocument(bytes());
    expect(d.materials).toHaveLength(1);
    expect(d.images).toHaveLength(3);
    expect(Object.keys(M.sockets)).toHaveLength(14);
    expect(M.staffDatum).toBe(0.18);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(10000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed and changed payloads before resource decoding', async () => {
    expect(() => marshalPostDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => marshalPostDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeMarshalPosts(c)).rejects.toThrow('integrity');
  });
  it('retains finite indexed geometry, normalized normals and padded atlas coordinates in both variants and every tier', async () => {
    const kit = await decode();
    try {
      for (const v of MARSHAL_VARIANTS)
        for (const l of [0, 1, 2]) {
          const ps = kit.templates.get(`${v}:${l}`)!;
          expect(ps).toHaveLength(1);
          const g = ps[0].geometry;
          expect(g.index!.count / 3).toBe(M.triangles[v][l]);
          for (const k of ['position', 'normal', 'uv'])
            expect(Array.from(g.getAttribute(k).array).every(Number.isFinite)).toBe(true);
          const n = g.getAttribute('normal'),
            uv = g.getAttribute('uv');
          for (let i = 0; i < n.count; i++)
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
          for (let i = 0; i < uv.count; i++) {
            const u = uv.getX(i) * 4,
              v = (1 - uv.getY(i)) * 2;
            expect(u - Math.floor(u)).toBeGreaterThanOrEqual(8 / 128 - 1e-5);
            expect(u - Math.floor(u)).toBeLessThanOrEqual(120 / 128 + 1e-5);
            expect(v - Math.floor(v)).toBeGreaterThanOrEqual(8 / 256 - 1e-5);
            expect(v - Math.floor(v)).toBeLessThanOrEqual(248 / 256 + 1e-5);
          }
        }
    } finally {
      kit.dispose();
    }
  });
  it('keeps a clear stair landing, both retained marshal body envelopes and the visible LED window', async () => {
    const kit = await decode();
    try {
      const clear = [
        new T.Box3(new T.Vector3(-0.7, 0.21, 0.95), new T.Vector3(0.1, 1.95, 1.88)),
        ...[-0.525, 0.525].map(
          (z) =>
            new T.Box3(new T.Vector3(-0.6, 0.2, z - 0.25), new T.Vector3(0.08, 2.06, z + 0.25)),
        ),
        new T.Box3(new T.Vector3(-1.51, 1.52, -0.54), new T.Vector3(-1.42, 2.18, 0.54)),
      ];
      for (const v of MARSHAL_VARIANTS)
        for (const l of [0, 1, 2])
          for (const p of kit.templates.get(`${v}:${l}`)!)
            for (const box of clear) expect(intersects(p.geometry, box)).toBe(false);
    } finally {
      kit.dispose();
    }
  });
  it('keeps all twelve sites, protected track offsets, immutable templates and grounded footings on both mirrored sides', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      plan = trackInfrastructurePlan(track),
      root = new T.Group(),
      original = JSON.stringify(plan);
    try {
      for (const [i, site] of plan.marshalPosts.entries()) {
        kit.buildPost(track, root, site, i);
        const template = kit.templates.get('open:0')![0].geometry,
          copy = Array.from(template.getAttribute('position').array),
          g = conformMarshalPostGeometry(template, track, site),
          p = g.getAttribute('position'),
          src = template.getAttribute('position');
        for (let j = 0; j < p.count; j += 11) {
          const q = trackPoint(),
            l = track.nearest(p.getX(j), p.getZ(j), q);
          expect(Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1)).toBeGreaterThan(2.4);
          if (src.getY(j) < 0.02) {
            const ground =
              q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
            expect(p.getY(j)).toBeLessThanOrEqual(ground - 0.024);
          }
          expect(inStandFootprint(track, p.getX(j), p.getZ(j), 0)).toBe(false);
        }
        expect(Array.from(template.getAttribute('position').array)).toEqual(copy);
        const pos = new T.Vector3(-0.18, 0.18, 0.525).applyMatrix4(marshalPostMatrix(site));
        expect(pos.y).toBeCloseTo(site.y + 0.18, 6);
        g.dispose();
      }
      expect(JSON.stringify(plan)).toBe(original);
      expect(kit.diagnostics()).toMatchObject({
        modules: 12,
        sheltered: 4,
        staffDatum: 0.18,
        retainedStaffAndSignals: true,
        physicsChanged: false,
      });
      expect(() => kit.buildPost(track, root, plan.marshalPosts[0], 0)).toThrow('Duplicate');
      for (const c of kit.chunks) {
        expect(c.sphere.radius).toBeLessThan(3.2);
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
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
  it('replaces shelter geometry while retaining exact LED, extinguisher and unrelated infrastructure geometry', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      plan = trackInfrastructurePlan(track),
      old = new T.Group(),
      next = new T.Group(),
      panel = new T.MeshStandardMaterial();
    try {
      buildTrackInfrastructure(track, old, panel, plan);
      buildTrackInfrastructure(track, next, panel, plan, kit);
      for (let i = 0; i < 12; i++) {
        const a = old.getObjectByName(`Marshal shelter ${i + 1}`)!,
          b = next.getObjectByName(`Marshal shelter ${i + 1}`)!;
        expect(b.children).toHaveLength(3);
        const oldRetained = a.children.slice(-3) as T.Mesh[];
        for (const [j, obj] of (b.children as T.Mesh[]).entries()) {
          expect(obj.position.toArray()).toEqual(oldRetained[j].position.toArray());
          expect(Array.from(obj.geometry.getAttribute('position').array)).toEqual(
            Array.from(oldRetained[j].geometry.getAttribute('position').array),
          );
        }
        expect((b.children[0] as T.Mesh).material).toBe(panel);
      }
      for (const a of old.children.filter((o) => !o.name.startsWith('Marshal shelter'))) {
        const b = next.getObjectByName(a.name)!;
        expect(b).toBeDefined();
        expect(a.position.toArray()).toEqual(b.position.toArray());
      }
      const frame = new Float32Array(100);
      frame[H.FLAG] = FLAG.YELLOW;
      updateSafetyPanel(panel, frame);
      expect(panel.emissiveIntensity).toBeGreaterThan(3);
      let disposed = 0;
      panel.addEventListener('dispose', () => disposed++);
      kit.dispose();
      expect(disposed).toBe(0);
    } finally {
      kit.dispose();
      disposeTree(old);
      disposeTree(next);
    }
  });
  it('releases source/template/chunk resources once without taking shared signal ownership', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group();
    kit.buildPost(track, root, trackInfrastructurePlan(track).marshalPosts[0], 0);
    const gs = new Set<T.BufferGeometry>();
    kit.templates.forEach((ps) => ps.forEach((p) => gs.add(p.geometry)));
    kit.root.traverse((o) => {
      if (o instanceof T.Mesh) gs.add(o.geometry);
    });
    let count = 0;
    gs.forEach((g) => g.addEventListener('dispose', () => count++));
    kit.dispose();
    kit.dispose();
    expect(count).toBe(gs.size);
    expect(kit.root.parent).toBeNull();
  });
  it('cancels and rejects missing, truncated and oversized transport', async () => {
    const f = vi.fn();
    await expect(loadMarshalPosts(() => true, 'https://example.invalid', f)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadMarshalPosts(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadMarshalPosts(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadMarshalPosts(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
