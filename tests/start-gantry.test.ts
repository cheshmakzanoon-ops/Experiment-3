import { CircuitScene } from '../src/rendering/circuit.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  START_GANTRY as M,
  GANTRY_VARIANTS,
  startGantryDocument,
  decodeStartGantry,
  loadStartGantry,
  conformStartGantryGeometry,
} from '../src/rendering/start-gantry.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeStartGantry(bytes(), loader());
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
describe('A07 authored start-light gantry and retained signal apertures', () => {
  it('retains exact original source/export, packed atlas, ten sockets and bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = startGantryDocument(bytes());
    expect(d.materials).toHaveLength(1);
    expect(d.images).toHaveLength(3);
    expect(Object.keys(M.sockets)).toHaveLength(10);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(10000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed and changed payloads before resource decoding', async () => {
    expect(() => startGantryDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => startGantryDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeStartGantry(c)).rejects.toThrow('integrity');
  });
  it('retains normalized indexed geometry, padded atlas UVs and four structural parts at every tier', async () => {
    const kit = await decode();
    try {
      for (const v of GANTRY_VARIANTS)
        for (const l of [0, 1, 2]) {
          const parts = kit.templates.get(`${v}:${l}`)!;
          expect(parts).toHaveLength(4);
          expect(parts.reduce((n, p) => n + p.geometry.index!.count / 3, 0)).toBe(
            M.triangles[v][l],
          );
          for (const { geometry: g } of parts) {
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
        }
    } finally {
      kit.dispose();
    }
  });
  it('clears the retained road aperture, banner face and all five original lamp cylinders in every tier', async () => {
    const kit = await decode();
    try {
      const boxes = [
        new T.Box3(new T.Vector3(-8, 0.03, -1), new T.Vector3(8, 4.7, 1.4)),
        new T.Box3(new T.Vector3(-7, 5.5, -0.29), new T.Vector3(7, 6.5, -0.255)),
        ...Array.from(
          { length: 5 },
          (_, i) =>
            new T.Box3(
              new T.Vector3((i - 2) * 0.45 - 0.16, 4.79, -0.341),
              new T.Vector3((i - 2) * 0.45 + 0.16, 5.11, -0.259),
            ),
        ),
      ];
      for (const l of [0, 1, 2])
        for (const part of kit.templates.get(`portal:${l}`)!)
          for (const box of boxes) expect(intersects(part.geometry, box)).toBe(false);
      for (let i = 0; i < 5; i++)
        expect(M.sockets[`A07_SOCKET_LAMP_${i + 1}` as keyof typeof M.sockets]).toEqual([
          (i - 2) * 0.45,
          4.95,
          -0.3,
        ]);
    } finally {
      kit.dispose();
    }
  });
  it('keeps the ladder-to-catwalk opening clear above its connected landing', async () => {
    const kit = await decode();
    try {
      const doorway = new T.Box3(
        new T.Vector3(-11.28, 5.43, 1.53),
        new T.Vector3(-10.75, 7.3, 2.01),
      );
      for (const level of [0, 1, 2])
        for (const part of kit.templates.get(`portal:${level}`)!) {
          expect(intersects(part.geometry, doorway)).toBe(false);
          expect(
            intersects(
              part.geometry,
              new T.Box3(new T.Vector3(-10.6, 5.43, 1.45), new T.Vector3(10.6, 7.3, 2.1)),
            ),
          ).toBe(false);
        }
    } finally {
      kit.dispose();
    }
  });
  it('keeps clear rays from both grid columns to each retained lamp face at all detail levels', async () => {
    const kit = await decode();
    try {
      for (const l of [0, 1, 2]) {
        const meshes = kit.templates
          .get(`portal:${l}`)!
          .map((p) => new T.Mesh(p.geometry, p.material));
        for (const m of meshes) m.updateMatrixWorld(true);
        for (const x of [-2.2, 2.2])
          for (const z of [-32, -80])
            for (let i = 0; i < 5; i++) {
              const from = new T.Vector3(x, 0.64, z),
                to = new T.Vector3((i - 2) * 0.45, 4.95, -0.342),
                distance = from.distanceTo(to);
              const ray = new T.Raycaster(from, to.sub(from).normalize(), 0.01, distance - 0.002);
              expect(ray.intersectObjects(meshes, false)).toHaveLength(0);
            }
      }
    } finally {
      kit.dispose();
    }
  });
  it('grounds original-station footings without moving templates and registers only bounded structural occluders', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      parent = new T.Group(),
      p = track.at(0, trackPoint()),
      sight = new BroadcastSightlines();
    parent.position.set(p.x, p.y, p.z);
    parent.rotation.y = Math.atan2(p.tx, p.tz);
    parent.updateMatrixWorld(true);
    try {
      kit.build(track, parent, sight);
      expect(sight.count).toBe(3);
      expect(() => kit.build(track, parent, sight)).toThrow('Duplicate');
      const at = (x: number, y: number, z: number) =>
        new T.Vector3(x, y, z).applyMatrix4(parent.matrixWorld);
      expect(sight.blocked(at(0, 1, -8), at(0, 1, 8))).toBe(false);
      expect(sight.blocked(at(0, 6, -8), at(0, 6, 8))).toBe(true);
      expect(sight.blocked(at(10.8, 2, -8), at(10.8, 2, 8))).toBe(true);
      for (const part of kit.templates.get('portal:0')!) {
        const copy = Array.from(part.geometry.getAttribute('position').array),
          g = conformStartGantryGeometry(part.geometry, track, parent.matrixWorld),
          a = g.getAttribute('position'),
          src = part.geometry.getAttribute('position');
        for (let i = 0; i < a.count; i++)
          if (src.getY(i) < -0.1) {
            const world = new T.Vector3()
                .fromBufferAttribute(a, i)
                .applyMatrix4(parent.matrixWorld),
              q = trackPoint(),
              l = track.nearest(world.x, world.z, q),
              ground =
                q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
            expect(world.y).toBeLessThanOrEqual(ground - 0.099);
          }
        expect(Array.from(part.geometry.getAttribute('position').array)).toEqual(copy);
        g.dispose();
      }
      expect(kit.diagnostics()).toMatchObject({
        modules: 1,
        retainedStartLamps: 5,
        retainedBanner: true,
        occluders: 3,
        physicsChanged: false,
      });
      expect(kit.chunks[0].sphere.radius).toBeLessThan(25);
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(kit.chunks[0].sphere.center);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(0);
      camera.position.addScalar(10000);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(2);
      expect(kit.chunks[0].levels.filter((l) => l.visible)).toHaveLength(1);
      kit.dispose();
      expect(sight.blocked(at(0, 6, -8), at(0, 6, 8))).toBe(true);
    } finally {
      kit.dispose();
    }
  });
  it('retains the real race countdown and lights-out through the unchanged circuit signal update', async () => {
    const kit = await decode(),
      sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, seed: 1887 });
    const startLamps = Array.from(
      { length: 5 },
      () => new T.MeshStandardMaterial({ emissive: 0xff210c, emissiveIntensity: 0 }),
    );
    const safetyPanel = new T.MeshStandardMaterial(),
      context = { startLamps, safetyPanel } as unknown as CircuitScene;
    let last = -1;
    const states: number[][] = [];
    for (let i = 0; i < 7 * 120; i++) {
      sim.step(1 / 120);
      const snapshot = sim.makeFrame();
      if (snapshot[H.LIGHTS] !== last) {
        last = snapshot[H.LIGHTS];
        CircuitScene.prototype.update.call(context, snapshot);
        states.push(startLamps.map((m) => m.emissiveIntensity));
      }
    }
    expect(states).toEqual(
      [0, 1, 2, 3, 4, 5, 0].map((n) => Array.from({ length: 5 }, (_, i) => (i < n ? 25 : 0))),
    );
    let disposed = 0;
    for (const m of startLamps) m.addEventListener('dispose', () => disposed++);
    kit.dispose();
    expect(disposed).toBe(0);
    for (const m of startLamps) m.dispose();
    safetyPanel.dispose();
  });
  it('releases source/template/chunk resources once without taking shared signal ownership', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group();
    kit.build(track, root, new BroadcastSightlines());
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
    await expect(loadStartGantry(() => true, 'https://example.invalid', f)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadStartGantry(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadStartGantry(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadStartGantry(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
