import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { decodeHeroGarage } from '../src/rendering/hero-garage.ts';
import { batchScene } from '../src/rendering/geometry.ts';
import {
  OVERHEAD_SERVICE_RIG as M,
  overheadDocument,
  decodeOverheadServiceRig,
  loadOverheadServiceRig,
  OverheadServiceRig,
} from '../src/rendering/overhead-garage-service-rig.ts';
const raw = () => new Uint8Array(readFileSync('public/' + M.url));
const decode = () => decodeOverheadServiceRig(raw());
const garage = () =>
  decodeHeroGarage(
    new Uint8Array(readFileSync('public/models/aurel-hero-garage-bay.glb')),
    new GLTFLoader().register(() => ({
      name: 'CPU_texture_stub',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
  );

describe('A26 overhead garage services', () => {
  it('retains original editable source, source hash, exact export and bounded LODs', () => {
    expect(createHash('sha256').update(readFileSync(M.author)).digest('hex')).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(createHash('sha256').update(raw()).digest('hex')).toBe(M.sha256);
    const d = overheadDocument(raw());
    expect(d.materials.length).toBe(8);
    expect(M.images).toBe(0);
    expect(M.triangles[0]).toBeLessThan(60000);
    expect(M.triangles[1]).toBeLessThan(M.triangles[0]);
    expect(M.triangles[2]).toBeLessThan(5000);
    expect(M.centralPassageIntersections).toBe(0);
    expect(M.lightingHousings).toBe(8);
    expect(M.reels).toBe(3);
  });
  it('rejects bad headers, truncated buffers and tampered binary data before decode', async () => {
    expect(() => overheadDocument(raw().slice(0, -1))).toThrow('byte count');
    const bad = raw();
    bad[0] = 0;
    expect(() => overheadDocument(bad)).toThrow('header');
    const altered = raw();
    altered[altered.length - 1] ^= 1;
    await expect(decodeOverheadServiceRig(altered)).rejects.toThrow('integrity');
  });
  it('rejects missing or duplicate nodes, incorrect hierarchy and external buffers', () => {
    function edit(fn: (s: string) => string) {
      const b = raw(),
        n = new DataView(b.buffer).getUint32(12, true);
      const old = new TextDecoder().decode(b.subarray(20, 20 + n)),
        next = fn(old);
      expect(new TextEncoder().encode(next).length).toBe(n);
      b.set(new TextEncoder().encode(next), 20);
      return b;
    }
    expect(() => overheadDocument(edit((s) => s.replace('A26_LOD0', 'A26_LODx')))).toThrow('node');
    expect(() => overheadDocument(edit((s) => s.replace('A26_LOD1', 'A26_LOD0')))).toThrow(
      'duplicate',
    );
    expect(() => overheadDocument(edit((s) => s.replace('A26_L0_', 'A26_L9_')))).toThrow(
      'hierarchy',
    );
    expect(() =>
      overheadDocument(
        edit((s) => {
          const d = JSON.parse(s);
          d.buffers[0].uri = 'external.bin';
          // Remove nonessential generator metadata to retain the exact JSON chunk size.
          delete d.asset.generator;
          return JSON.stringify(d).padEnd(s.length, ' ');
        }),
      ),
    ).toThrow('self-contained');
  });
  it('all triangles clear the real passage and all vertices have finite UV/normal data', async () => {
    const rig = await decode();
    try {
      const box = new T.Box3(
        new T.Vector3().fromArray(M.protectedOpening.min),
        new T.Vector3().fromArray(M.protectedOpening.max),
      );
      const tri = new T.Triangle();
      for (const level of rig.levels) {
        let count = 0;
        level.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const g = o.geometry,
            p = g.getAttribute('position'),
            ix = g.index!;
          for (const name of ['position', 'normal', 'uv'])
            expect(Array.from(g.getAttribute(name).array).every(Number.isFinite)).toBe(true);
          for (let i = 0; i < ix.count; i += 3) {
            tri.a.fromBufferAttribute(p, ix.getX(i)).applyMatrix4(o.matrixWorld);
            tri.b.fromBufferAttribute(p, ix.getX(i + 1)).applyMatrix4(o.matrixWorld);
            tri.c.fromBufferAttribute(p, ix.getX(i + 2)).applyMatrix4(o.matrixWorld);
            expect(box.intersectsTriangle(tri)).toBe(false);
            expect(tri.getArea()).toBeGreaterThan(1e-12);
            count++;
          }
        });
        expect(count).toBe(M.triangles[rig.levels.indexOf(level) as 0 | 1 | 2]);
      }
    } finally {
      rig.dispose();
    }
  });
  it('clears all three concurrently integrated A35 parked-equipment envelopes', async () => {
    // A35 placement contract inspected at a5f420a88e42fced894dae3f92ffbcad1541333c.
    // Bounding volumes are conservative: a pass guarantees no trolley/rig mesh collision.
    const placements = [
      { p: [-2.2, 0.05, -3.35], yaw: Math.PI / 2 },
      { p: [-4.7, 0.05, -3.35], yaw: Math.PI / 2 },
      { p: [5.5, 0.05, -2.45], yaw: 0 },
    ];
    const volumes = placements.map(({ p, yaw }) =>
      new T.Box3(new T.Vector3(-0.45, -0.005, -1.08), new T.Vector3(0.45, 1.67, 1.08)).applyMatrix4(
        new T.Matrix4().compose(
          new T.Vector3().fromArray(p),
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw),
          new T.Vector3(1, 1, 1),
        ),
      ),
    );
    const rig = await decode();
    try {
      const triangle = new T.Triangle();
      for (const level of rig.levels)
        level.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          const geometry = object.geometry,
            positions = geometry.getAttribute('position'),
            ix = geometry.index!;
          for (let i = 0; i < ix.count; i += 3) {
            triangle.a.fromBufferAttribute(positions, ix.getX(i)).applyMatrix4(object.matrixWorld);
            triangle.b
              .fromBufferAttribute(positions, ix.getX(i + 1))
              .applyMatrix4(object.matrixWorld);
            triangle.c
              .fromBufferAttribute(positions, ix.getX(i + 2))
              .applyMatrix4(object.matrixWorld);
            for (const volume of volumes) expect(volume.intersectsTriangle(triangle)).toBe(false);
          }
        });
    } finally {
      rig.dispose();
    }
  });
  it('rejects a negative scale or translated rig before attachment', async () => {
    for (const invalid of ['scale', 'position']) {
      const r = await decode();
      if (invalid === 'scale') r.root.scale.x = -1;
      else r.root.position.x = 10;
      expect(() => new OverheadServiceRig(r.root)).toThrow();
      r.dispose();
    }
  });
  it('inherits garage placement and all LOD transitions without changing A22 or A33', async () => {
    const r = await decode(),
      g = await garage();
    try {
      g.overhead = r;
      r.attachTo(g.root, g.levels);
      const parent = new T.Group();
      parent.add(g.root);
      batchScene(parent, new Set([g.root]));
      g.root.position.set(11, 3, -7);
      g.root.rotation.y = 0.4;
      parent.updateMatrixWorld(true);
      for (const [name, p] of Object.entries(M.sockets)) {
        const expected = g.root.localToWorld(new T.Vector3().fromArray(p));
        expect(
          g.root.getObjectByName(name)!.getWorldPosition(new T.Vector3()).distanceTo(expected),
        ).toBeLessThan(1e-5);
      }
      for (const [distance, level] of [
        [0, 0],
        [60, 1],
        [160, 2],
        [0, 0],
      ]) {
        g.setDetail(distance, 'high');
        expect(r.levels.map((o) => o.parent!.visible && o.visible)).toEqual(
          [0, 1, 2].map((i) => i === level),
        );
        expect(g.diagnostics().overheadServices?.lod).toBe(level);
      }
      expect(g.spareWheelStorage).toBeDefined();
      expect(() => r.attachTo(g.root, g.levels)).toThrow('already');
      expect(g.diagnostics().overheadServices).toMatchObject({
        loaded: true,
        attached: true,
        assetId: 'A26',
      });
    } finally {
      g.dispose();
    }
  });
  it('changes only diffuser emission across day, sunset and night; adds no lights', async () => {
    const r = await decode();
    try {
      let lights = 0;
      const lamps = new Set<T.MeshStandardMaterial>();
      r.root.traverse((o) => {
        if (o instanceof T.Light) lights++;
        if (
          o instanceof T.Mesh &&
          o.material instanceof T.MeshStandardMaterial &&
          o.material.name === 'A26_LightDiffusers'
        )
          lamps.add(o.material);
      });
      expect(lights).toBe(0);
      expect(lamps.size).toBe(1);
      for (const [state, expected] of [
        ['day', 0.5],
        ['sunset', 1.1],
        ['night', 2.2],
      ] as const) {
        r.updateLighting(state);
        expect([...lamps][0].emissiveIntensity).toBe(expected);
      }
    } finally {
      r.dispose();
    }
  });
  it('disposes attached resources exactly once and keeps the garage valid', async () => {
    const r = await decode(),
      g = await garage(),
      events = new Map<object, number>();
    r.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      for (const resource of [
        o.geometry,
        ...(Array.isArray(o.material) ? o.material : [o.material]),
      ]) {
        if (events.has(resource)) continue;
        events.set(resource, 0);
        resource.addEventListener('dispose', () => events.set(resource, events.get(resource)! + 1));
      }
    });
    g.overhead = r;
    r.attachTo(g.root, g.levels);
    g.dispose();
    r.dispose();
    g.dispose();
    expect([...events.values()].every((n) => n === 1)).toBe(true);
    expect(r.diagnostics().loaded).toBe(false);
  });
  it('bounds network I/O and handles cancellation, HTTP errors, overflow and truncation', async () => {
    let called = 0;
    const fetcher: typeof fetch = async () => {
      called++;
      return new Response(raw());
    };
    await expect(
      loadOverheadServiceRig(() => true, 'https://example.test/a26', fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(called).toBe(0);
    await expect(
      loadOverheadServiceRig(
        () => false,
        'https://example.test/a26',
        async () => new Response('', { status: 404 }),
      ),
    ).rejects.toThrow('404');
    await expect(
      loadOverheadServiceRig(
        () => false,
        'https://example.test/a26',
        async () => new Response(raw().slice(0, 30)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadOverheadServiceRig(
        () => false,
        'https://example.test/a26',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
    const r = await loadOverheadServiceRig(() => false, 'https://example.test/a26', fetcher);
    expect(r.diagnostics().loaded).toBe(true);
    r.dispose();
  });
});
