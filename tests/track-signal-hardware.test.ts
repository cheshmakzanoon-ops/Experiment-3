import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  TRACK_SIGNAL_HARDWARE as M,
  SIGNAL_VARIANTS,
  trackSignalDocument,
  decodeTrackSignalHardware,
  loadTrackSignalHardware,
  signalHardwareMatrix,
  conformSignalHardwareGeometry,
} from '../src/rendering/track-signal-hardware.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  trackInfrastructurePlan,
  buildTrackInfrastructure,
  updateSafetyPanel,
} from '../src/rendering/track-infrastructure.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { timingSensorPlan } from '../src/rendering/track-signal-plan.ts';
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
const decode = () => decodeTrackSignalHardware(bytes(), loader());
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
function geometrySnapshot(root: T.Object3D) {
  const result: unknown[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o instanceof T.Mesh)
      result.push({
        matrix: o.matrixWorld.elements.slice(),
        attributes: Object.fromEntries(
          ['position', 'normal', 'uv'].map((k) => [
            k,
            Array.from(o.geometry.getAttribute(k)?.array ?? []),
          ]),
        ),
        indices: Array.from(o.geometry.index?.array ?? []),
      });
  });
  return result;
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
describe('A08 authored signal housings and retained live displays', () => {
  it('retains exact original source/export, packed atlas, nine sockets and bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = trackSignalDocument(bytes());
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
    expect(() => trackSignalDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => trackSignalDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeTrackSignalHardware(c)).rejects.toThrow('integrity');
  });
  it('retains finite indexed geometry, normalized normals and padded atlas coordinates in all variants and every tier', async () => {
    const kit = await decode();
    try {
      for (const v of SIGNAL_VARIANTS)
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
  it('keeps the complete retained LED box and staff envelopes clear in all flag housing tiers', async () => {
    const kit = await decode();
    try {
      const boxes = [
        new T.Box3(new T.Vector3(-1.465, 1.49, -0.575), new T.Vector3(-1.375, 2.21, 0.575)),
        ...[-0.525, 0.525].map(
          (z) =>
            new T.Box3(new T.Vector3(-0.6, 0.2, z - 0.25), new T.Vector3(0.08, 2.06, z + 0.25)),
        ),
      ];
      for (const level of [0, 1, 2])
        for (const { geometry: g } of kit.templates.get(`flag_back:${level}`)!)
          for (const box of boxes) expect(intersects(g, box)).toBe(false);
    } finally {
      kit.dispose();
    }
  });
  it('retains exact live LED and unrelated camera/drain geometry while replacing only utility cabinets', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      plan = trackInfrastructurePlan(track),
      old = new T.Group(),
      next = new T.Group(),
      panel = new T.MeshStandardMaterial();
    try {
      buildTrackInfrastructure(track, old, panel, plan);
      buildTrackInfrastructure(track, next, panel, plan, null, kit);
      for (let i = 0; i < 12; i++) {
        const a = old.getObjectByName(`Marshal shelter ${i + 1}`)!,
          b = next.getObjectByName(`Marshal shelter ${i + 1}`)!;
        const x = a.children.find((o) => (o as T.Mesh).material === panel) as T.Mesh,
          y = b.children.find((o) => (o as T.Mesh).material === panel) as T.Mesh;
        expect(x.position.toArray()).toEqual(y.position.toArray());
        expect(x.rotation.toArray()).toEqual(y.rotation.toArray());
        for (const key of ['position', 'normal', 'uv'])
          expect(Array.from(x.geometry.getAttribute(key).array)).toEqual(
            Array.from(y.geometry.getAttribute(key).array),
          );
        expect(Array.from(x.geometry.index!.array)).toEqual(Array.from(y.geometry.index!.array));
        expect(y.material).toBe(panel);
      }
      for (const [i] of plan.utilities.entries())
        expect(next.getObjectByName(`Track utility cabinet ${i + 1}`)!.children).toHaveLength(0);
      for (const a of old.children.filter(
        (o) =>
          o.name.startsWith('Replay camera') ||
          o.name.startsWith('Slotted drainage') ||
          o.name.startsWith('Recessed drain'),
      )) {
        const b = next.getObjectByName(a.name)!;
        expect(b).toBeDefined();
        expect(b.position.toArray()).toEqual(a.position.toArray());
        expect(b.children.length).toBe(a.children.length);
        expect(geometrySnapshot(b)).toEqual(geometrySnapshot(a));
      }
      expect(kit.diagnostics()).toMatchObject({
        modules: 28,
        flagBacks: 12,
        utilities: 13,
        sensors: 3,
        retainedLiveSignals: true,
        timingPhysicsChanged: false,
        physicsChanged: false,
      });
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
  it('uses the three original timing stations with grounded, protected footprints and immutable source templates', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      plan = trackInfrastructurePlan(track),
      original = JSON.stringify(plan),
      sites = timingSensorPlan(track),
      root = new T.Group(),
      water = track.water.slice();
    try {
      expect(sites.map((s) => s.s)).toEqual([0, track.length / 3, (track.length * 2) / 3]);
      expect(Object.isFrozen(sites)).toBe(true);
      for (const site of sites) {
        expect(Object.isFrozen(site)).toBe(true);
        const template = kit.templates.get('sensor:0')![0].geometry,
          copy = Array.from(template.getAttribute('position').array),
          g = conformSignalHardwareGeometry(template, track, site),
          p = g.getAttribute('position'),
          src = template.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const q = trackPoint(),
            l = track.nearest(p.getX(i), p.getZ(i), q);
          expect(Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1)).toBeGreaterThan(1.08);
          expect(inStandFootprint(track, p.getX(i), p.getZ(i), 0.1)).toBe(false);
          if (src.getY(i) < 0.02) {
            const ground =
              q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
            expect(p.getY(i)).toBeLessThanOrEqual(ground - 0.024);
          }
        }
        expect(Array.from(template.getAttribute('position').array)).toEqual(copy);
        g.dispose();
      }
      for (const site of plan.marshalPosts) kit.buildHardware(track, root, site, 'flag_back');
      for (const site of plan.utilities) kit.buildHardware(track, root, site, 'utility');
      kit.buildSensors(track, root);
      expect(() => kit.buildSensors(track, root)).toThrow('Duplicate');
      expect(JSON.stringify(plan)).toBe(original);
      expect(track.water).toEqual(water);
      for (const c of kit.chunks) {
        expect(c.sphere.radius).toBeLessThan(1.5);
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
      }
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(kit.chunks[0].sphere.center);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(0);
      camera.position.addScalar(10000);
      kit.update(camera, 'high');
      expect(kit.chunks.every((c) => c.level === 2)).toBe(true);
      const site = plan.utilities[0],
        at = new T.Vector3(0.2, 0.5, 0.1).applyMatrix4(signalHardwareMatrix(site, false));
      expect(at.y).toBeCloseTo(site.y + 0.5, 6);
    } finally {
      kit.dispose();
    }
  });
  it('releases source/template/chunk resources once without taking shared signal ownership', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group();
    kit.buildHardware(track, root, trackInfrastructurePlan(track).marshalPosts[0], 'flag_back');
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
    await expect(
      loadTrackSignalHardware(() => true, 'https://example.invalid', f),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadTrackSignalHardware(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadTrackSignalHardware(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadTrackSignalHardware(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
