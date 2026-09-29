import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  PIT_BUILDING,
  decodePitBuilding,
  loadPitBuildingFrontage,
  pitBuildingDocument,
  pitBuildingLod,
} from '../src/rendering/pit-building-frontage.ts';
import { pitBuildingLayout, PIT_BUILDING_LIMITS } from '../src/rendering/pit-building-layout.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { batchScene } from '../src/rendering/geometry.ts';
import garage from '../src/rendering/hero-garage.manifest.json' with { type: 'json' };
import station from '../src/rendering/pit-wall-station.manifest.json' with { type: 'json' };
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const bytes = () =>
  new Uint8Array(readFileSync('public/models/aurel-hero-pit-building-frontage.glb'));
const decode = () =>
  decodePitBuilding(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU_geometry_only',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );

describe('A21 authored pit-building frontage', () => {
  it('retains exact source provenance, self-contained runtime export and editable source', () => {
    expect(hash(readFileSync(PIT_BUILDING.author))).toBe(PIT_BUILDING.sourceSHA256);
    expect(hash(readFileSync('src/rendering/pit-building-layout.ts'))).toBe(
      PIT_BUILDING.layoutSourceSHA256,
    );
    expect(readFileSync(PIT_BUILDING.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(PIT_BUILDING.sha256);
    const doc = pitBuildingDocument(bytes());
    expect(doc.images).toHaveLength(3);
    expect(PIT_BUILDING.materials).toBeLessThanOrEqual(PIT_BUILDING_LIMITS.materials);
    expect(PIT_BUILDING.bytes).toBeLessThanOrEqual(PIT_BUILDING_LIMITS.bytes);
    PIT_BUILDING.triangles.forEach((n, i) =>
      expect(n).toBeLessThanOrEqual(PIT_BUILDING_LIMITS.triangles[i]),
    );
    for (const counts of Object.values(PIT_BUILDING.chunkTriangles)) {
      expect(counts[0]).toBeGreaterThan(counts[1]);
      expect(counts[1]).toBeGreaterThan(counts[2]);
    }
  });
  it('rejects truncated payloads and corrupt headers before resource loading', () => {
    expect(() => pitBuildingDocument(bytes().slice(0, -1))).toThrow('byte');
    const data = bytes();
    data[0] = 0;
    expect(() => pitBuildingDocument(data)).toThrow('header');
  });
  it('rejects altered geometry bytes with an unchanged valid header', async () => {
    const data = bytes();
    data[data.length - 1] ^= 1;
    await expect(decodePitBuilding(data)).rejects.toThrow('integrity');
  });
  it('preserves finite positions, unit normals, UVs and indexed triangles', async () => {
    const asset = await decode();
    try {
      asset.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const p = o.geometry.getAttribute('position'),
          n = o.geometry.getAttribute('normal'),
          uv = o.geometry.getAttribute('uv');
        expect(p.count).toBe(n.count);
        expect(p.count).toBe(uv.count);
        for (const a of [p, n, uv]) expect(Array.from(a.array).every(Number.isFinite)).toBe(true);
        for (let i = 0; i < n.count; i++)
          expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
        expect(o.geometry.index).not.toBeNull();
        for (const index of o.geometry.index!.array) expect(index).toBeLessThan(p.count);
      });
    } finally {
      asset.dispose();
    }
  });
  it('derives all twelve bay transforms from the unchanged production track', () => {
    const track = new Track(),
      layout = pitBuildingLayout(track);
    expect(layout.map((c) => c.station)).toEqual([79, 106, 133, 160]);
    expect(layout.flatMap((c) => c.bays.map((b) => b.index))).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    );
    for (const c of layout)
      for (const b of c.bays) {
        const p = track.at(b.station, trackPoint());
        const point = new T.Vector3(b.x, b.y, b.z)
          .applyAxisAngle(new T.Vector3(0, 1, 0), c.yaw)
          .add(new T.Vector3(c.x, c.y, c.z));
        expect(
          point.distanceTo(new T.Vector3(p.x + p.nx * 35, p.y + p.bank * 12, p.z + p.nz * 35)),
        ).toBeLessThan(1e-9);
      }
  });
  it('places four independent chunks, clears the pit lane and never modifies track state', async () => {
    const asset = await decode(),
      track = new Track(),
      water = track.water.slice(),
      rubber = track.rubber.slice();
    const solids = new BroadcastSightlines();
    try {
      asset.place(track, solids);
      expect(asset.diagnostics()).toMatchObject({
        placed: true,
        bayCount: 12,
        sockets: 43,
        solidOccluders: 26,
      });
      expect(asset.diagnostics().minimumPitClearance).toBeGreaterThan(0.25);
      expect(track.water).toEqual(water);
      expect(track.rubber).toEqual(rubber);
      expect(() => asset.place(track, solids)).toThrow('already');
      expect(solids.count).toBe(26);
    } finally {
      asset.dispose();
    }
  });
  it('retains exact A22 bay alignment and future sockets after static batching', async () => {
    const asset = await decode(),
      parent = new T.Group(),
      track = new Track();
    parent.add(asset.root);
    try {
      asset.place(track, new BroadcastSightlines());
      batchScene(parent, new Set([asset.root]));
      parent.updateMatrixWorld(true);
      for (let i = 0; i < 12; i++) {
        const name =
          `SOCKET_BAY_${String(i + 1).padStart(2, '0')}` as keyof typeof PIT_BUILDING.sockets;
        const p = track.at(70 + i * 9, trackPoint());
        expect(
          asset
            .socket(name, new T.Vector3())
            .distanceTo(new T.Vector3(p.x + p.nx * 35, p.y + p.bank * 12, p.z + p.nz * 35)),
        ).toBeLessThan(2e-5);
      }
      expect(asset.root.getObjectByName('A21_B_LOD2')).toBe(asset.chunks[1].levels[2]);
      for (const name of Object.keys(PIT_BUILDING.sockets))
        expect(asset.root.getObjectByName(name)).toBeDefined();
    } finally {
      asset.dispose();
    }
  });
  it('leaves every existing garage central mouth clear in all detail levels', async () => {
    const asset = await decode(),
      track = new Track();
    try {
      asset.place(track, new BroadcastSightlines());
      asset.root.updateMatrixWorld(true);
      for (const chunk of asset.chunks)
        for (const level of chunk.levels) {
          for (const bay of pitBuildingLayout(track).find((c) => c.id === chunk.id)!.bays) {
            const p = track.at(bay.station, trackPoint());
            for (const side of [-1.7, 0, 1.7])
              for (const height of [0.55, 1.0, 2.5]) {
                const origin = new T.Vector3(
                  p.x + p.nx * 26 + p.tx * side,
                  p.y + p.bank * 12 + height,
                  p.z + p.nz * 26 + p.tz * side,
                );
                const ray = new T.Raycaster(origin, new T.Vector3(p.nx, 0, p.nz), 0, 14.5);
                expect(ray.intersectObject(level, true)).toHaveLength(0);
              }
          }
        }
    } finally {
      asset.dispose();
    }
  });
  it('registers real slabs and end cores without treating empty garage mouths as solid', async () => {
    const asset = await decode(),
      track = new Track(),
      solids = new BroadcastSightlines();
    try {
      asset.place(track, solids);
      const p = track.at(106, trackPoint());
      const world = (x: number, y: number) =>
        new T.Vector3(p.x + p.nx * (35 + x), p.y + p.bank * 12 + y, p.z + p.nz * (35 + x));
      expect(solids.blocked(world(-9, 1.5), world(5, 1.5))).toBe(false);
      expect(solids.blocked(world(0, 6), world(0, 9))).toBe(true);
    } finally {
      asset.dispose();
    }
  });
  it('sinks each near-tier foundation below its retained bay datum', async () => {
    const asset = await decode();
    try {
      for (const c of asset.chunks) {
        expect(c.localBounds.min.y).toBeLessThan(-0.85);
        expect(c.localBounds.max.y).toBeGreaterThan(10);
      }
    } finally {
      asset.dispose();
    }
  });
  it('keeps A22 and A24 binary payloads byte-identical', () => {
    expect(hash(readFileSync('public/' + garage.url))).toBe(garage.sha256);
    expect(hash(readFileSync('public/' + station.url))).toBe(station.sha256);
    expect(garage.sha256).toBe('653b922595533be6cda5bda1f96b90e738d6eac3f403e0dc37f6437f30383ff0');
    expect(station.sha256).toBe('702497c1a912213fbd5f047dda1b28b7fe4e08ad001c57d34f1d84fbf20c1cf3');
  });
  it('selects exactly one level per chunk, never four near levels for a one-end closeup', async () => {
    const asset = await decode(),
      track = new Track(),
      camera = new T.PerspectiveCamera(58, 16 / 9);
    try {
      asset.place(track, new BroadcastSightlines());
      camera.position.copy(asset.chunks[0].worldBounds.min).add(new T.Vector3(0, 1, 0));
      asset.update(camera, 'high', 'day');
      expect(asset.chunks[0].level).toBe(0);
      expect(asset.chunks[3].level).toBeGreaterThan(0);
      for (const c of asset.chunks) expect(c.levels.filter((o) => o.visible)).toHaveLength(1);
      camera.position.set(5000, 100, 5000);
      asset.update(camera, 'high', 'night');
      expect(asset.chunks.map((c) => c.level)).toEqual([2, 2, 2, 2]);
      expect(asset.diagnostics().triangles).toBe(PIT_BUILDING.triangles[2]);
    } finally {
      asset.dispose();
    }
  });
  it('has lens-aware hysteresis and rejects invalid view distances', () => {
    expect(pitBuildingLod(45, 0, 'high')).toBe(0);
    expect(pitBuildingLod(49, 0, 'high')).toBe(1);
    expect(pitBuildingLod(145, 2, 'high')).toBe(2);
    expect(pitBuildingLod(160, 1, 'high', 8)).toBe(0);
    expect(() => pitBuildingLod(NaN, 0, 'high')).toThrow();
  });
  it('reuses geometry and materials while changing lighting and representation', async () => {
    const asset = await decode(),
      track = new Track(),
      camera = new T.PerspectiveCamera(58, 16 / 9);
    try {
      asset.place(track, new BroadcastSightlines());
      const nodes: T.Object3D[] = [];
      asset.root.traverse((o) => nodes.push(o));
      const geometry = nodes.filter((o) => o instanceof T.Mesh).map((o) => (o as T.Mesh).geometry);
      for (let i = 0; i < 20; i++) {
        camera.position.set(i * 60, 15, i * 20);
        asset.update(camera, 'high', i % 2 ? 'day' : 'night');
      }
      expect(nodes.filter((o) => o instanceof T.Mesh).map((o) => (o as T.Mesh).geometry)).toEqual(
        geometry,
      );
    } finally {
      asset.dispose();
    }
  });
  it('disposes every unique geometry material and texture once', async () => {
    const asset = await decode(),
      events = new Map<T.BufferGeometry | T.Material | T.Texture, number>();
    asset.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const resources: (T.BufferGeometry | T.Material | T.Texture)[] = [o.geometry, ...materials];
      materials.forEach((m) =>
        Object.values(m).forEach((v) => {
          if (v instanceof T.Texture) resources.push(v);
        }),
      );
      for (const r of resources)
        if (!events.has(r)) {
          events.set(r, 0);
          r.addEventListener('dispose', () => events.set(r, events.get(r)! + 1));
        }
    });
    asset.dispose();
    asset.dispose();
    expect([...events.values()].every((n) => n === 1)).toBe(true);
  });
  it('cancels before I/O and refuses oversized, missing and truncated downloads', async () => {
    const never: typeof fetch = async () => {
      throw new Error('Must not fetch');
    };
    await expect(
      loadPitBuildingFrontage(() => true, 'https://example.test/a21', never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const truncated: typeof fetch = async () => new Response(bytes().slice(0, 28));
    await expect(
      loadPitBuildingFrontage(() => false, 'https://example.test/a21', truncated),
    ).rejects.toThrow('Truncated');
    const oversized: typeof fetch = async () =>
      new Response(new Uint8Array(PIT_BUILDING.bytes + 1));
    await expect(
      loadPitBuildingFrontage(() => false, 'https://example.test/a21', oversized),
    ).rejects.toThrow('exceeds');
    const missing: typeof fetch = async () => new Response(null, { status: 404 });
    await expect(
      loadPitBuildingFrontage(() => false, 'https://example.test/a21', missing),
    ).rejects.toThrow('404');
  });
});
