import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  decodeHeroGarage,
  garageDocument,
  garageLod,
  HERO_GARAGE,
  loadHeroGarage,
} from '../src/rendering/hero-garage.ts';
import { batchScene } from '../src/rendering/geometry.ts';

const bytes = () => new Uint8Array(readFileSync('public/models/aurel-hero-garage-bay.glb'));
const decode = () =>
  decodeHeroGarage(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU_geometry_only_test',
      // Browser tests separately decode the actual embedded image pixels.
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );

describe('A22 authored garage', () => {
  it('retains editable source, exact Blender author provenance and a pinned self-contained GLB', () => {
    expect(createHash('sha256').update(readFileSync(HERO_GARAGE.author)).digest('hex')).toBe(
      HERO_GARAGE.sourceSHA256,
    );
    expect(readFileSync(HERO_GARAGE.editable).length).toBeGreaterThan(10000);
    const raw = bytes(),
      doc = garageDocument(raw);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(HERO_GARAGE.sha256);
    expect(doc.images).toHaveLength(2);
    expect(HERO_GARAGE.triangles[0]).toBeLessThan(50000);
    expect(HERO_GARAGE.triangles[1]).toBeLessThan(25000);
    expect(HERO_GARAGE.triangles[2]).toBeLessThan(5000);
  });
  it('rejects truncation, invalid headers and altered bytes', async () => {
    expect(() => garageDocument(bytes().slice(0, -1))).toThrow();
    const bad = bytes();
    bad[0] = 0;
    expect(() => garageDocument(bad)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(decodeHeroGarage(corrupt)).rejects.toThrow('integrity');
  });
  it('has nine correctly transformed metre-space sockets and stays within its bay', async () => {
    const garage = await decode();
    try {
      const extent = new T.Box3().setFromObject(garage.root);
      expect(extent.min.y).toBeCloseTo(-1.5, 4);
      expect(extent.max.z).toBeLessThan(4.48);
      for (const [name, expected] of Object.entries(HERO_GARAGE.sockets)) {
        const point = garage.socket(name as keyof typeof HERO_GARAGE.sockets, new T.Vector3());
        expected.forEach((n, i) => expect(point.getComponent(i)).toBeCloseTo(n, 5));
      }
      garage.root.position.set(11, 3, -7);
      garage.root.rotation.y = 0.4;
      const wanted = new T.Vector3(...(HERO_GARAGE.sockets.SOCKET_CAR as [number, number, number]));
      garage.root.localToWorld(wanted);
      expect(garage.socket('SOCKET_CAR', new T.Vector3()).distanceTo(wanted)).toBeLessThan(1e-5);
    } finally {
      garage.dispose();
    }
  });
  it('preserves an open central passage and the LOD hierarchy through static scene batching', async () => {
    const garage = await decode(),
      parent = new T.Group();
    parent.add(garage.root);
    try {
      batchScene(parent, new Set([garage.root]));
      parent.updateMatrixWorld(true);
      for (const z of [-1.7, 0, 1.7]) {
        const ray = new T.Raycaster(new T.Vector3(-8, 1.0, z), new T.Vector3(1, 0, 0));
        const hits = ray.intersectObject(garage.levels[0], true);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].point.x).toBeGreaterThan(5.4);
      }
      expect(garage.root.getObjectByName('GARAGE_LOD2')).toBe(garage.levels[2]);
      for (const [distance, level] of [
        [0, 0],
        [60, 1],
        [160, 2],
        [0, 0],
      ]) {
        garage.setDetail(distance, 'high');
        expect(garage.levels.map((o) => o.visible)).toEqual([0, 1, 2].map((i) => i === level));
      }
    } finally {
      garage.dispose();
    }
  });
  it('uses lens-aware hysteresis, including close telephoto views', () => {
    expect(garageLod(38, 0, 'high')).toBe(0);
    expect(garageLod(42, 0, 'high')).toBe(1);
    expect(garageLod(100, 2, 'high')).toBe(2);
    expect(garageLod(150, 1, 'high', 10)).toBe(0);
    expect(() => garageLod(NaN, 0, 'high')).toThrow();
  });
  it('frees every owned resource exactly once on repeated detached disposal', async () => {
    const garage = await decode(),
      events = new Map<object, number>();
    garage.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const resources: (T.BufferGeometry | T.Material)[] = [
        o.geometry,
        ...(Array.isArray(o.material) ? o.material : [o.material]),
      ];
      for (const resource of resources)
        if (!events.has(resource)) {
          events.set(resource, 0);
          resource.addEventListener('dispose', () =>
            events.set(resource, events.get(resource)! + 1),
          );
        }
    });
    garage.dispose();
    garage.dispose();
    expect([...events.values()].every((n) => n === 1)).toBe(true);
  });
  it('cancels before I/O and reports oversized/truncated responses without fallback art', async () => {
    const never: typeof fetch = async () => {
      throw new Error('Must not fetch');
    };
    await expect(
      loadHeroGarage(() => true, 'https://example.test/garage', never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const truncated: typeof fetch = async () => new Response(bytes().slice(0, 50));
    await expect(
      loadHeroGarage(() => false, 'https://example.test/garage', truncated),
    ).rejects.toThrow('Truncated');
    const oversized: typeof fetch = async () => new Response(new Uint8Array(HERO_GARAGE.bytes + 1));
    await expect(
      loadHeroGarage(() => false, 'https://example.test/garage', oversized),
    ).rejects.toThrow('exceeds');
  });
});
