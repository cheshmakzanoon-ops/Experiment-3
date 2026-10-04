import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  TRACK_BOARDS as M,
  BOARD_VARIANTS,
  trackBoardDocument,
  decodeTrackBoards,
  loadTrackBoards,
} from '../src/rendering/track-boards.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  trackBoardPlan,
  trackBoardMatrix,
  conformTrackBoardGeometry,
  BRAKING_CORNERS,
  BRAKING_DISTANCES,
} from '../src/rendering/track-board-plan.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () =>
  decodeTrackBoards(
    bytes(),
    loader(),
    () => new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  );
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
describe('A09 authored braking and sector boards', () => {
  it('retains exact original source/export, packed atlas, nine sockets and bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = trackBoardDocument(bytes());
    expect(d.materials).toHaveLength(1);
    expect(d.images).toHaveLength(3);
    expect(Object.keys(M.sockets)).toHaveLength(9);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(10000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed and changed payloads before resource decoding', async () => {
    expect(() => trackBoardDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => trackBoardDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeTrackBoards(c)).rejects.toThrow('integrity');
  });
  it('retains finite indexed geometry, normalized normals and padded atlas coordinates in all variants and every tier', async () => {
    const kit = await decode();
    try {
      for (const v of BOARD_VARIANTS)
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
  it('leaves the complete printed-face window clear at every LOD', async () => {
    const kit = await decode();
    try {
      for (const v of BOARD_VARIANTS) {
        const f = M.faces[v],
          box = new T.Box3(
            new T.Vector3(-f.width / 2, f.position[1] - f.height / 2, -0.001),
            new T.Vector3(f.width / 2, f.position[1] + f.height / 2, 0.001),
          );
        for (const l of [0, 1, 2])
          for (const p of kit.templates.get(`${v}:${l}`)!)
            expect(intersects(p.geometry, box)).toBe(false);
      }
    } finally {
      kit.dispose();
    }
  });
  it('retains all eighteen braking station/label/offset combinations and points every face toward approaching traffic', () => {
    const track = new Track('clear'),
      sites = trackBoardPlan(track),
      expected = BRAKING_CORNERS.flatMap((c) =>
        BRAKING_DISTANCES.map((d) => ({ s: c - d, lateral: -18, text: String(d) })),
      );
    expect(
      sites
        .filter((s) => s.variant !== 'sector')
        .map(({ s, lateral, text }) => ({ s, lateral, text })),
    ).toEqual(expected);
    expect(sites.filter((s) => s.variant === 'sector').map((s) => s.s)).toEqual([
      track.length / 3,
      (track.length * 2) / 3,
    ]);
    expect(Object.isFrozen(sites)).toBe(true);
    for (const site of sites) {
      expect(Object.isFrozen(site)).toBe(true);
      const p = track.at(site.s, trackPoint()),
        n = new T.Vector3(0, 0, 1).transformDirection(trackBoardMatrix(site));
      expect(n.dot(new T.Vector3(-p.tx, 0, -p.tz))).toBeCloseTo(1, 6);
    }
  });
  it('grounds each weighted foot, preserves templates, keeps road/fence stand-offs and uses bounded LODs', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group(),
      water = track.water.slice();
    try {
      kit.build(track, root);
      expect(kit.diagnostics()).toMatchObject({
        modules: 20,
        brakingBoards: 18,
        sectorBoards: 2,
        labelTextures: 5,
        retainedBrakingStations: true,
        facesApproach: true,
        physicsChanged: false,
      });
      expect(() => kit.build(track, root)).toThrow('Duplicate');
      for (const site of kit.sites) {
        const template = kit.templates.get(`${site.variant}:0`)![0].geometry,
          copy = Array.from(template.getAttribute('position').array),
          g = conformTrackBoardGeometry(template, track, site),
          p = g.getAttribute('position'),
          src = template.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const q = trackPoint(),
            l = track.nearest(p.getX(i), p.getZ(i), q);
          expect(Math.abs(l) - q.width).toBeGreaterThan(6.8);
          if (site.variant !== 'sector')
            expect(track.boundary(q.s, -1) - Math.abs(l)).toBeGreaterThan(0.35);
          else expect(Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1)).toBeGreaterThan(1.7);
          if (src.getY(i) < 0) {
            const ground =
              q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
            expect(p.getY(i)).toBeLessThanOrEqual(ground - 0.019);
          }
        }
        expect(Array.from(template.getAttribute('position').array)).toEqual(copy);
        g.dispose();
      }
      for (const c of kit.chunks) {
        expect(c.sphere.radius).toBeLessThan(1.6);
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
        expect(c.levels.every((l) => l.children.length === 2)).toBe(true);
      }
      expect(track.water).toEqual(water);
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
  it('shares five correctly proportioned print textures and keeps their fronts visible from a driving approach', async () => {
    const calls: { text: string; w: number; h: number }[] = [],
      kit = await decodeTrackBoards(bytes(), loader(), (text, w, h) => {
        calls.push({ text, w, h });
        return new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      }),
      track = new Track('clear'),
      root = new T.Group();
    try {
      kit.build(track, root);
      root.updateMatrixWorld(true);
      expect(calls).toHaveLength(5);
      expect(
        calls.filter((c) => /^\d+$/.test(c.text)).every((c) => c.w === 256 && c.h === 256),
      ).toBe(true);
      expect(
        calls.filter((c) => c.text.startsWith('S')).every((c) => c.w === 512 && c.h === 256),
      ).toBe(true);
      for (const [i, site] of kit.sites.entries()) {
        const f = M.faces[site.variant],
          target = new T.Vector3().fromArray(f.position).applyMatrix4(trackBoardMatrix(site)),
          p = track.at(site.s - 30, trackPoint()),
          from = new T.Vector3(p.x - 2.2 * p.nx, p.y + 0.64, p.z - 2.2 * p.nz),
          dir = target.clone().sub(from),
          distance = dir.length(),
          ray = new T.Raycaster(from, dir.normalize(), 0.01, distance - 0.001);
        for (const level of kit.chunks[i].levels) {
          const structure = level.children[0] as T.Mesh;
          expect(ray.intersectObject(structure, false)).toHaveLength(0);
          const face = level.children[1] as T.Mesh;
          expect(face.castShadow).toBe(false);
          expect(face.material).toBe(kit.labels.get(site.text));
        }
      }
    } finally {
      kit.dispose();
    }
  });
  it('releases printed textures/materials and authored resources exactly once', async () => {
    const kit = await decode();
    kit.build(new Track('clear'), new T.Group());
    const gs = new Set<T.BufferGeometry>(),
      ms = new Set<T.Material>(),
      ts = new Set<T.Texture>();
    kit.templates.forEach((ps) => ps.forEach((p) => gs.add(p.geometry)));
    kit.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        gs.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          ms.add(m);
          for (const t of Object.values(m)) if (t instanceof T.Texture) ts.add(t);
        }
      }
    });
    let ng = 0,
      nm = 0,
      nt = 0;
    gs.forEach((g) => g.addEventListener('dispose', () => ng++));
    ms.forEach((m) => m.addEventListener('dispose', () => nm++));
    ts.forEach((t) => t.addEventListener('dispose', () => nt++));
    kit.dispose();
    kit.dispose();
    expect([ng, nm, nt]).toEqual([gs.size, ms.size, ts.size]);
    expect(kit.root.parent).toBeNull();
    expect(kit.labels.size).toBe(0);
  });
  it('cancels and rejects missing, truncated and oversized transport', async () => {
    const f = vi.fn();
    await expect(loadTrackBoards(() => true, 'https://example.invalid', f)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadTrackBoards(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadTrackBoards(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadTrackBoards(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
