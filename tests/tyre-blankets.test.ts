import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  blanketDocument,
  blanketLod,
  blanketPlacements,
  decodeTyreBlankets,
  loadTyreBlankets,
  TYRE_BLANKETS,
} from '../src/rendering/tyre-blankets.ts';
import { HERO_GARAGE } from '../src/rendering/hero-garage.ts';
import { batchScene } from '../src/rendering/geometry.ts';
import { A33GarageStorage } from '../src/rendering/a33-spare-wheel-set.ts';
const bytes = () =>
  new Uint8Array(readFileSync('public/models/aurel-tyre-blankets-and-controllers.glb'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const decode = () =>
  decodeTyreBlankets(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU texture stub',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );
describe('A34 retained thermal-blanket kit', () => {
  it('retains exact source, editable Blender data and a self-contained nine-variant export', () => {
    expect(sha(readFileSync(TYRE_BLANKETS.author))).toBe(TYRE_BLANKETS.sourceSHA256);
    expect(readFileSync(TYRE_BLANKETS.editable).length).toBeGreaterThan(10000);
    expect(sha(bytes())).toBe(TYRE_BLANKETS.sha256);
    const d = blanketDocument(bytes());
    expect(d.images).toHaveLength(1);
    expect(Object.keys(TYRE_BLANKETS.variants)).toHaveLength(9);
    expect(TYRE_BLANKETS.bytes).toBeLessThan(6000000);
    for (const v of Object.values(TYRE_BLANKETS.variants)) {
      expect(v.triangles[0]).toBeGreaterThan(v.triangles[1]);
      expect(v.triangles[1]).toBeGreaterThan(v.triangles[2]);
      expect(v.triangles[2]).toBeGreaterThan(0);
    }
  });
  it('fits APX front/rear stock without modifying supplied car dimensions or floor sockets', () => {
    expect(TYRE_BLANKETS.variants.FRONT_FITTED.fit).toMatchObject({
      radius: 0.335,
      width: 0.31,
      axle: '+X',
    });
    expect(TYRE_BLANKETS.variants.REAR_FITTED.fit).toMatchObject({
      radius: 0.335,
      width: 0.38,
      axle: '+X',
    });
    const saved = JSON.stringify(HERO_GARAGE);
    for (const [i, corner] of ['FL', 'FR', 'RL', 'RR'].entries()) {
      const p = blanketPlacements()[i];
      const socket = HERO_GARAGE.sockets[`SOCKET_TYRE_${corner}` as 'SOCKET_TYRE_FL'];
      expect(p.position).toEqual([socket[0], socket[1] + 0.36, socket[2]]);
      expect(Math.abs(p.yaw)).toBeCloseTo(Math.PI / 2);
    }
    expect(JSON.stringify(HERO_GARAGE)).toBe(saved);
  });
  it('clears the APX outboard locking hub with actual panel geometry at every LOD', async () => {
    const kit = await decode();
    try {
      for (const [variant, half] of [
        ['FRONT_FITTED', 0.155],
        ['REAR_FITTED', 0.19],
      ] as const) {
        for (const lod of [0, 1, 2]) {
          const root = kit.library.getObjectByName(`A34_${variant}_LOD${lod}`)!;
          for (const radius of [0, 0.02, 0.04]) {
            const hits = new T.Raycaster(
              new T.Vector3(0, radius, 0),
              new T.Vector3(1, 0, 0),
            ).intersectObject(root, true);
            expect(hits.length).toBeGreaterThan(0);
            // APX hub reaches half + 0.051 m. Keep a measurable cloth clearance.
            expect(hits[0].point.x).toBeGreaterThan(half + 0.055);
          }
        }
      }
    } finally {
      kit.dispose();
    }
  });
  it('aligns the actual A33 garage wheel batches under the covers across LOD changes', async () => {
    const kit = await decode(),
      garage = new T.Group(),
      parent = new T.Group();
    for (const corner of ['FL', 'FR', 'RL', 'RR'] as const) {
      const socket = new T.Object3D();
      socket.name = `SOCKET_TYRE_${corner}`;
      socket.position.fromArray(HERO_GARAGE.sockets[`SOCKET_TYRE_${corner}`]);
      garage.add(socket);
    }
    const storage = new A33GarageStorage(garage);
    parent.position.set(17, 2, -9);
    parent.rotation.y = 0.8;
    parent.add(garage, kit.root);
    try {
      const matrix = new T.Matrix4();
      for (const level of [0, 1, 2, 0] as const) {
        storage.setDetail(level);
        kit.alignGarageWheels(storage);
        const batch = storage.wheels.batches[level];
        expect(storage.wheels.diagnostics().instances).toBe(4);
        for (const [index, corner] of ['FL', 'FR', 'RL', 'RR'].entries()) {
          batch.getMatrixAt(index, matrix);
          matrix.premultiply(storage.root.matrixWorld);
          const expected = kit.instances.get(corner)!.root.matrixWorld;
          expect(
            Math.max(...matrix.elements.map((v, i) => Math.abs(v - expected.elements[i]))),
          ).toBeLessThan(1e-5);
          expect(matrix.determinant()).toBeGreaterThan(0.999);
        }
        const version = batch.instanceMatrix.version;
        kit.alignGarageWheels(storage);
        expect(batch.instanceMatrix.version).toBe(version);
      }
    } finally {
      kit.dispose();
      storage.wheels.disposeDetached();
    }
  });
  it('validates each runtime LOD, sockets, clone sharing and material batching', async () => {
    const kit = await decode();
    try {
      const a = kit.instances.get('FL')!,
        b = kit.instances.get('FR')!;
      const surfaces = (o: T.Object3D) => {
        const list: T.Mesh[] = [];
        o.traverse((n) => {
          if (n instanceof T.Mesh) list.push(n);
        });
        return list;
      };
      expect(surfaces(a.root)[0].geometry).toBe(surfaces(b.root)[0].geometry);
      expect(kit.instances.size).toBe(9);
      const group = new T.Group();
      group.add(kit.root);
      batchScene(group, new Set([kit.root]));
      for (const [distance, level] of [
        [0, 0],
        [20, 1],
        [80, 2],
        [0, 0],
      ]) {
        kit.setDetail(distance, 'high');
        expect(kit.renderLevels.map((l) => l.visible)).toEqual([0, 1, 2].map((i) => i === level));
        expect(kit.library.visible).toBe(false);
        expect(surfaces(kit.renderLevels[level]).length).toBeLessThanOrEqual(10);
        expect(
          surfaces(kit.renderLevels[level]).reduce((n, m) => n + m.geometry.index!.count / 3, 0),
        ).toBe(kit.diagnostics().triangles);
        expect(kit.diagnostics().triangles).toBeLessThan([45000, 20000, 4500][level]);
      }
      const before = kit.socket('FL', 'BLANKET_POWER', new T.Vector3());
      kit.root.position.set(16, 4, -7);
      kit.root.rotation.y = 0.7;
      expect(kit.socket('FL', 'BLANKET_POWER', new T.Vector3()).distanceTo(before)).toBeLessThan(
        1e-5,
      );
      expect(() => kit.socket('MISSING', 'WHEEL_CENTER', new T.Vector3())).toThrow();
      expect(() => kit.socket('FL', 'MISSING', new T.Vector3())).toThrow();
    } finally {
      kit.dispose();
    }
  });
  it('keeps fitted covers on their floor contacts and routes cables outside the central car aisle', async () => {
    const kit = await decode();
    try {
      for (const name of ['FL', 'FR', 'RL', 'RR']) {
        const instance = kit.instances.get(name)!;
        const box = new T.Box3().setFromObject(instance.levels[0]);
        expect(box.min.y).toBeGreaterThanOrEqual(0.055);
        expect(box.min.y).toBeLessThan(0.075);
      }
      for (const level of kit.harness)
        for (const o of level.children) {
          const g = (o as T.Mesh).geometry;
          const p = g.getAttribute('position');
          for (let i = 0; i < p.count; i++) {
            expect(p.getY(i)).toBeGreaterThanOrEqual(0.066);
            const inCarAisle = p.getX(i) > -3.5 && p.getX(i) < 3.5 && Math.abs(p.getZ(i)) < 1.25;
            expect(inCarAisle).toBe(false);
          }
        }
      for (const name of ['FOLDED_NEAT', 'FOLDED_LOOSE', 'MAIN', 'PORTABLE']) {
        const box = new T.Box3().setFromObject(kit.instances.get(name)!.root);
        expect(box.min.y).toBeGreaterThanOrEqual(0.055);
        expect(box.min.y).toBeLessThan(0.08);
      }
    } finally {
      kit.dispose();
    }
  });
  it('uses lens-aware hysteresis and rejects invalid distances', () => {
    expect(blanketLod(12, 0, 'high')).toBe(0);
    expect(blanketLod(14, 0, 'high')).toBe(1);
    expect(blanketLod(42, 2, 'high')).toBe(2);
    expect(blanketLod(80, 2, 'high', 8)).toBeLessThan(2);
    expect(() => blanketLod(NaN, 0, 'high')).toThrow();
    expect(() => blanketLod(-1, 0, 'high')).toThrow();
  });
  it('reuses static display textures and frees every owned resource exactly once', async () => {
    const kit = await decode();
    const resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
    kit.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      resources.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        resources.add(m);
        for (const t of Object.values(m)) if (t instanceof T.Texture) resources.add(t);
      }
    });
    const calls = new Map<object, number>();
    for (const r of resources) {
      calls.set(r, 0);
      r.addEventListener('dispose', () => calls.set(r, calls.get(r)! + 1));
    }
    const camera = new T.PerspectiveCamera(58, 16 / 9, 0.02, 500);
    camera.position.set(-4, 1.6, 2);
    for (const light of ['day', 'sunset', 'night'] as const) kit.update(camera, 'high', light);
    expect(kit.diagnostics()).toMatchObject({
      display: 'STANDBY',
      heatingSimulation: false,
      finalArtApproved: false,
    });
    kit.dispose();
    kit.dispose();
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
  });
  it('rejects corrupt and truncated GLBs before parser allocation', async () => {
    expect(() => blanketDocument(bytes().slice(0, -1))).toThrow('byte');
    const header = bytes();
    header[0] = 0;
    expect(() => blanketDocument(header)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(decodeTyreBlankets(corrupt)).rejects.toThrow('integrity');
  });
  it('rejects cancellation, network errors, oversize and truncation', async () => {
    const never: typeof fetch = async () => {
      throw new Error('Unexpected request');
    };
    await expect(
      loadTyreBlankets(() => true, 'https://example.test/a34', never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    for (const [body, message] of [
      [new Uint8Array(5), 'Truncated'],
      [new Uint8Array(TYRE_BLANKETS.bytes + 1), 'exceeds'],
    ] as const)
      await expect(
        loadTyreBlankets(
          () => false,
          'https://example.test/a34',
          async () => new Response(body),
        ),
      ).rejects.toThrow(message);
    await expect(
      loadTyreBlankets(
        () => false,
        'https://example.test/a34',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('404');
  });
});
