import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  WORKSHOP_EQUIPMENT as manifest,
  decodeWorkshopEquipment,
  loadWorkshopEquipment,
  workshopDocument,
  workshopPlacementBounds,
  type WorkshopPlacement,
} from '../src/rendering/workshop-equipment.ts';
import { decodeHeroGarage } from '../src/rendering/hero-garage.ts';
import { batchScene } from '../src/rendering/geometry.ts';

const bytes = () => new Uint8Array(readFileSync(`public/${manifest.url}`));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const cpuLoader = () =>
  new GLTFLoader().register(() => ({
    name: 'A36_CPU_geometry_only',
    // Native embedded pixels are decoded separately in the browser tests.
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeWorkshopEquipment(bytes(), cpuLoader());
const defaults = manifest.placements as WorkshopPlacement[];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('A36 original workshop equipment', () => {
  it('retains exact author, editable Blender source and a pinned self-contained runtime library', () => {
    expect(sha(manifest.author)).toBe(manifest.sourceSHA256);
    expect(sha(manifest.editable)).toBe(manifest.blendSHA256);
    expect(readFileSync(manifest.editable).length).toBe(manifest.blendBytes);
    expect(manifest.sourceComponents).toBeGreaterThan(250);
    expect(sha(`public/${manifest.url}`)).toBe(manifest.sha256);
    const doc = workshopDocument(bytes());
    expect(doc.meshes).toHaveLength(12);
    expect(doc.materials).toHaveLength(1);
    expect(doc.images).toHaveLength(3);
    expect(manifest.bytes).toBeLessThan(4_500_000);
    expect(manifest.triangles[0]).toBeLessThan(40_000);
    expect(manifest.triangles[1]).toBeLessThan(20_000);
    expect(manifest.triangles[2]).toBeLessThan(6_000);
    for (const variant of Object.values(manifest.variants)) {
      expect(variant.triangles[0]).toBeGreaterThan(variant.triangles[1]);
      expect(variant.triangles[1]).toBeGreaterThan(variant.triangles[2]);
      expect(variant.bounds.min[1]).toBeCloseTo(0, 3);
    }
    expect(manifest.finalArtApproved).toBe(false);
    expect(manifest.collision.enabled).toBe(false);
  });

  it('embeds three actual compact PNG maps, not external texture references', () => {
    const raw = bytes(),
      doc = workshopDocument(raw);
    const jsonLength = new DataView(raw.buffer).getUint32(12, true);
    for (const image of doc.images) {
      const view = doc.bufferViews[image.bufferView];
      const start = 28 + jsonLength + (view.byteOffset ?? 0);
      const png = new DataView(raw.buffer, start, view.byteLength);
      expect(png.getUint32(0)).toBe(0x89504e47);
      expect(png.getUint32(16)).toBe(512);
      expect(png.getUint32(20)).toBe(256);
    }
  });

  it('rejects truncation, bad headers and altered content before decoding', async () => {
    expect(() => workshopDocument(bytes().slice(0, -1))).toThrow('byte count');
    const header = bytes();
    header[0] = 0;
    expect(() => workshopDocument(header)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    const loader = cpuLoader(),
      spy = vi.spyOn(loader, 'parseAsync');
    await expect(decodeWorkshopEquipment(corrupt, loader)).rejects.toThrow('integrity');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an unexpected image contract and duplicate named templates', () => {
    const invalidImage = Buffer.from(bytes());
    const imageOffset = invalidImage.indexOf('image/png');
    invalidImage.write('image/jpg', imageOffset);
    expect(() => workshopDocument(new Uint8Array(invalidImage))).toThrow('contract');
    const duplicate = Buffer.from(bytes());
    const name = 'A36_TOOL_CHEST_LOD1';
    // Change both mesh and node labels without changing the GLB byte count.
    const altered = Buffer.from(
      duplicate.toString('latin1').replaceAll(name, 'A36_TOOL_CHEST_LOD0'),
      'latin1',
    );
    expect(() => workshopDocument(new Uint8Array(altered))).toThrow();
  });

  it('keeps all four placements inside their work zones with no mutual overlap', () => {
    const sites = workshopPlacementBounds();
    expect(sites.map((s) => s.kind)).toEqual([
      'TOOL_CHEST',
      'MEDIUM_CASE',
      'LARGE_CASE',
      'WORKBENCH',
    ]);
    for (const site of sites) {
      expect(site.matrix.determinant()).toBeCloseTo(1, 10);
      expect(site.bounds.min.y).toBeGreaterThan(0.049);
      expect(site.bounds.min.z).toBeGreaterThan(1.25);
      expect(site.bounds.max.x).toBeLessThan(5.92);
    }
    expect(() => workshopPlacementBounds([{ ...defaults[0], position: [0, 0.05, 0] }])).toThrow(
      'A36',
    );
    expect(() => workshopPlacementBounds([{ ...defaults[0], position: [1, 0.05, 3.3] }])).toThrow(
      'cabinets',
    );
    expect(() => workshopPlacementBounds([defaults[0], { ...defaults[0], id: 'overlap' }])).toThrow(
      'Overlapping',
    );
    expect(() => workshopPlacementBounds([defaults[0], defaults[0]])).toThrow('identifiers');
    expect(() => workshopPlacementBounds([{ ...defaults[0], yaw: NaN }])).toThrow('transform');
  });

  it('does not intersect the actual A22 architecture above the floor', async () => {
    const garage = await decodeHeroGarage(
      new Uint8Array(readFileSync('public/models/aurel-hero-garage-bay.glb')),
      cpuLoader(),
    );
    try {
      garage.root.updateMatrixWorld(true);
      const triangle = new T.Triangle();
      for (const site of workshopPlacementBounds()) {
        const envelope = site.bounds.clone();
        envelope.min.y = 0.055; // Exclude intentional contact with the .05 m floor.
        garage.levels[0].traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const g = o.geometry,
            positions = g.getAttribute('position'),
            indices = g.index;
          g.computeBoundingBox();
          if (!envelope.intersectsBox(g.boundingBox!.clone().applyMatrix4(o.matrixWorld))) return;
          expect(indices).not.toBeNull();
          for (let i = 0; i < indices!.count; i += 3) {
            triangle.a.fromBufferAttribute(positions, indices!.getX(i)).applyMatrix4(o.matrixWorld);
            triangle.b
              .fromBufferAttribute(positions, indices!.getX(i + 1))
              .applyMatrix4(o.matrixWorld);
            triangle.c
              .fromBufferAttribute(positions, indices!.getX(i + 2))
              .applyMatrix4(o.matrixWorld);
            expect(envelope.intersectsTriangle(triangle), `${site.id} intersects ${o.name}`).toBe(
              false,
            );
          }
        });
      }
    } finally {
      garage.dispose();
    }
  });

  it('batches four props into one surface per LOD and retains independent placement sockets', async () => {
    const equipment = await decode();
    try {
      for (const level of [0, 1, 2]) {
        const mesh = equipment.levels[level] as T.Mesh;
        expect(mesh.geometry.index!.count / 3).toBe(manifest.triangles[level]);
        expect(mesh.geometry.groups).toHaveLength(0);
        expect(Array.isArray(mesh.material)).toBe(false);
      }
      expect(equipment.diagnostics()).toMatchObject({
        assetId: 'A36',
        loaded: true,
        instances: 4,
        drawBatches: 1,
        finalArtApproved: false,
      });
      const parent = new T.Group();
      parent.position.set(11, 3, -8);
      parent.rotation.y = 0.52;
      parent.add(equipment.root);
      for (const site of equipment.placements) {
        for (const [name, p] of Object.entries(manifest.variants[site.kind].sockets)) {
          const wanted = new T.Vector3().fromArray(p).applyMatrix4(site.matrix);
          parent.localToWorld(wanted);
          expect(equipment.socket(site.id, name, new T.Vector3()).distanceTo(wanted)).toBeLessThan(
            1e-5,
          );
        }
      }
      expect(() => equipment.socket('missing', 'HANDLE', new T.Vector3())).toThrow('socket');
    } finally {
      equipment.dispose();
    }
  });

  it('follows the garage LOD through scene batching and rejects repeated attachment', async () => {
    const garage = await decodeHeroGarage(
      new Uint8Array(readFileSync('public/models/aurel-hero-garage-bay.glb')),
      cpuLoader(),
    );
    const equipment = await decode(),
      scene = new T.Group();
    try {
      garage.workshop = equipment;
      equipment.attachTo(garage.root, garage.levels);
      scene.add(garage.root);
      batchScene(scene, new Set([garage.root]));
      for (const [distance, level] of [
        [0, 0],
        [60, 1],
        [160, 2],
        [0, 0],
      ]) {
        garage.setDetail(distance, 'high');
        expect(garage.levels.map((o) => o.visible)).toEqual([0, 1, 2].map((i) => i === level));
        expect(equipment.levels[level].parent).toBe(garage.levels[level]);
        expect(garage.diagnostics().workshop).toMatchObject({
          loaded: true,
          attached: true,
          lod: level,
        });
      }
      expect(() => equipment.attachTo(garage.root, garage.levels)).toThrow('already');
    } finally {
      garage.dispose();
    }
    expect(equipment.diagnostics().loaded).toBe(false);
  });

  it('disposes each owned geometry, material and shared map once, before garage traversal', async () => {
    const equipment = await decode(),
      resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
    equipment.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      resources.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        resources.add(m);
        for (const value of Object.values(m)) if (value instanceof T.Texture) resources.add(value);
      }
    });
    const counts = [...resources].map((r) => {
      let count = 0;
      r.addEventListener('dispose', () => {
        count++;
      });
      return () => count;
    });
    const garage = new T.Group();
    const levels = [0, 1, 2].map((i) => {
      const g = new T.Group();
      g.name = `GARAGE_LOD${i}`;
      garage.add(g);
      return g;
    });
    equipment.attachTo(garage, levels);
    equipment.dispose();
    equipment.dispose();
    expect(counts.every((read) => read() === 1)).toBe(true);
    expect(levels.every((g) => !g.children.length)).toBe(true);
    expect(equipment.root.parent).toBeNull();
  });
});

describe('A36 bounded loading', () => {
  const url = 'https://example.invalid/a36.glb';
  it('loads the real bytes through the bounded transfer path', async () => {
    const equipment = await loadWorkshopEquipment(
      () => false,
      url,
      async () => new Response(bytes()),
      (raw) => decodeWorkshopEquipment(raw, cpuLoader()),
    );
    expect(equipment.diagnostics().loaded).toBe(true);
    equipment.dispose();
  });
  it('does not fetch an already cancelled request', async () => {
    const fetcher = vi.fn();
    await expect(loadWorkshopEquipment(() => true, url, fetcher)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects HTTP errors, truncated downloads and oversized streams', async () => {
    await expect(
      loadWorkshopEquipment(
        () => false,
        url,
        async () => new Response('', { status: 503 }),
      ),
    ).rejects.toThrow('503');
    await expect(
      loadWorkshopEquipment(
        () => false,
        url,
        async () => new Response(bytes().slice(0, 20)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadWorkshopEquipment(
        () => false,
        url,
        async () => new Response(new Uint8Array(manifest.bytes + 1)),
      ),
    ).rejects.toThrow('byte budget');
  });
  it('cancels a transfer before consuming further chunks', async () => {
    let cancelled = false;
    const fetcher = async () => {
      cancelled = true;
      return new Response(bytes());
    };
    await expect(loadWorkshopEquipment(() => cancelled, url, fetcher)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('cleans up an asset if cancellation arrives during decoding', async () => {
    let cancelled = false,
      releases = 0;
    await expect(
      loadWorkshopEquipment(
        () => cancelled,
        url,
        async () => new Response(bytes()),
        async (raw) => {
          const equipment = await decodeWorkshopEquipment(raw, cpuLoader());
          const original = equipment.dispose.bind(equipment);
          equipment.dispose = () => {
            releases++;
            original();
          };
          cancelled = true;
          return equipment;
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(releases).toBe(1);
  });
  it('aborts a stalled fetch at its deadline and releases timers', async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = async (_input, options) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        });
      });
    const pending = expect(loadWorkshopEquipment(() => false, url, fetcher)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(60_001);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
