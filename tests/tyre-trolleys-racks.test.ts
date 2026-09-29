import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  TYRE_EQUIPMENT,
  TyreEquipmentKit,
  tyreLoadSlots,
  tyreEquipmentLod,
  tyreEquipmentDocument,
  decodeTyreEquipment,
  loadTyreEquipment,
  tyreEquipmentPlacements,
  installTyreEquipment,
  A35_GARAGE_PLACEMENTS,
} from '../src/rendering/tyre-trolleys-racks.ts';
import { Track } from '../src/simulation/track.ts';
import { tireProfile } from '../src/rendering/tire-profile.ts';
import { decodeHeroGarage } from '../src/rendering/hero-garage.ts';
import { batchScene } from '../src/rendering/geometry.ts';

const raw = () => new Uint8Array(readFileSync('public/models/aurel-tyre-trolleys-racks.glb'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'A35_CPU_geometry_only',
    // Browser cases separately decode the actual embedded material maps.
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeTyreEquipment(raw(), loader());

function meshes(root: T.Object3D) {
  const result: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh) result.push(o);
  });
  return result;
}

describe('A35 tyre trolleys and garage racks', () => {
  it('retains editable original source and exact source/export receipts', () => {
    expect(hash(readFileSync(TYRE_EQUIPMENT.author))).toBe(TYRE_EQUIPMENT.sourceSHA256);
    const blend = readFileSync(TYRE_EQUIPMENT.editable);
    expect(blend.length).toBe(TYRE_EQUIPMENT.blendBytes);
    expect(hash(blend)).toBe(TYRE_EQUIPMENT.blendSHA256);
    expect(hash(raw())).toBe(TYRE_EQUIPMENT.sha256);
    const doc = tyreEquipmentDocument(raw());
    expect(doc.materials.length).toBeLessThanOrEqual(6);
    expect(doc.images.length).toBeLessThanOrEqual(2);
    expect(TYRE_EQUIPMENT.bytes).toBeLessThan(6 * 1024 * 1024);
    expect(TYRE_EQUIPMENT.capacity).toBe(8);
    expect(TYRE_EQUIPMENT.casterCount).toBe(4);
    expect(TYRE_EQUIPMENT.brakedCasterCount).toBe(2);
    expect(TYRE_EQUIPMENT.visualOnly).toBe(true);
    expect(TYRE_EQUIPMENT.collision.enabled).toBe(false);
    expect(TYRE_EQUIPMENT.finalArtApproved).toBe(false);
  });
  it('rejects invalid GLB headers, truncation and corrupted bytes before using them', async () => {
    expect(() => tyreEquipmentDocument(raw().slice(0, -1))).toThrow('byte count');
    const broken = raw();
    broken[0] = 0;
    expect(() => tyreEquipmentDocument(broken)).toThrow('header');
    const altered = raw();
    altered[altered.length - 1] ^= 1;
    await expect(decodeTyreEquipment(altered, loader())).rejects.toThrow('integrity');
  });
  it('preserves front/rear dimensions and tangent contact with the load-bearing rails', async () => {
    const kit = await decode();
    try {
      for (const kind of ['FRONT', 'REAR'] as const) {
        const halfWidth = TYRE_EQUIPMENT.halfWidths[kind];
        expect(Math.max(...tireProfile(halfWidth).map((p) => p.x))).toBe(TYRE_EQUIPMENT.tyreRadius);
        for (const level of [0, 1, 2]) {
          const node = kit.template.getObjectByName(`A35_${kind}_LOD${level}`)!;
          const bounds = new T.Box3().setFromObject(node);
          expect(bounds.max.x).toBeCloseTo(0.335, 5);
          expect(bounds.min.x).toBeCloseTo(-0.335, 5);
          expect(bounds.max.z).toBeCloseTo(halfWidth, 3);
          expect(bounds.min.z).toBeGreaterThan(-halfWidth - 0.015);
        }
      }
      for (const socket of Object.values(TYRE_EQUIPMENT.sockets)) {
        const tier = socket.slotIndex >= 4 ? 1 : 0;
        const distance = Math.hypot(
          TYRE_EQUIPMENT.railX,
          socket.position[1] - TYRE_EQUIPMENT.railHeights[tier],
        );
        expect(distance).toBeCloseTo(TYRE_EQUIPMENT.tyreRadius + TYRE_EQUIPMENT.railRadius, 7);
      }
      // Adjacent wheels have actual positive axial clearance; rear widths are not shrunk to fit.
      const slots = Object.values(TYRE_EQUIPMENT.sockets).slice(0, 4);
      for (let i = 1; i < slots.length; i++) {
        const a = slots[i - 1],
          b = slots[i];
        const widths = TYRE_EQUIPMENT.halfWidths;
        const gap =
          b.position[2] -
          a.position[2] -
          widths[a.wheelType.toUpperCase() as keyof typeof widths] -
          widths[b.wheelType.toUpperCase() as keyof typeof widths];
        expect(gap).toBeGreaterThanOrEqual(0.0349);
      }
    } finally {
      kit.dispose();
    }
  });
  it('builds both structures, four presets and stable explicit occupancy without duplicating template buffers', async () => {
    const kit = await decode();
    try {
      const first = kit.create('trolley', 'empty'),
        second = kit.create('trolley', 'full');
      expect(first.diagnostics().wheels).toBe(0);
      expect(second.diagnostics().wheels).toBe(8);
      expect(meshes(first.levels[0])[0].geometry).toBe(meshes(second.levels[0])[0].geometry);
      expect(meshes(first.levels[0])[0].material).toBe(meshes(second.levels[0])[0].material);
      const a = meshes(first.levels[0]).find(
        (m) => m instanceof T.InstancedMesh,
      ) as T.InstancedMesh;
      const b = meshes(second.levels[0]).find(
        (m) => m instanceof T.InstancedMesh,
      ) as T.InstancedMesh;
      expect(a.geometry).toBe(b.geometry);
      expect(a.instanceMatrix).not.toBe(b.instanceMatrix);
      for (const state of ['empty', 'partial-left', 'partial-balanced', 'full'] as const) {
        first.setLoadState(state);
        expect(first.diagnostics().occupiedSlots).toEqual(tyreLoadSlots(state));
        expect(second.diagnostics().wheels).toBe(8);
      }
      first.setLoadState([7, 2, 0]);
      expect(first.diagnostics().occupiedSlots).toEqual([0, 2, 7]);
      expect(first.diagnostics().wheels).toBe(3);
      expect(kit.create('rack', 'full').diagnostics().structure).toBe('rack');
      for (const invalid of [[8], [-1], [1, 1], [NaN], [1.5]])
        expect(() => first.setLoadState(invalid)).toThrow('load slots');
      expect(first.diagnostics().occupiedSlots).toEqual([0, 2, 7]);
      expect(() => tyreLoadSlots('invalid' as 'empty')).toThrow();
    } finally {
      kit.dispose();
    }
  });
  it('keeps sockets in metre space under a transformed parent and LOD transitions', async () => {
    const kit = await decode();
    try {
      const instance = kit.create('trolley', [1, 4, 6]);
      kit.root.position.set(13, 2, -8);
      kit.root.rotation.y = 0.4;
      instance.root.position.set(1, 0, 3);
      instance.root.rotation.y = -0.7;
      const sockets = Object.values(TYRE_EQUIPMENT.sockets);
      for (const [d, lod] of [
        [0, 0],
        [28, 1],
        [85, 2],
        [0, 0],
      ]) {
        instance.setDetail(d, 'high');
        expect(instance.levels.map((o) => o.visible)).toEqual([0, 1, 2].map((i) => i === lod));
        expect(instance.diagnostics().occupiedSlots).toEqual([1, 4, 6]);
        sockets.forEach((s, i) => {
          const expected = instance.root.localToWorld(new T.Vector3().fromArray(s.position));
          expect(instance.socket(i, new T.Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
        });
      }
      expect(() => instance.socket(8, new T.Vector3())).toThrow();
    } finally {
      kit.dispose();
    }
  });
  it('meets full-load triangle and main-view submission budgets at all three LODs', async () => {
    const kit = await decode();
    try {
      for (const kind of ['trolley', 'rack'] as const) {
        const instance = kit.create(kind, 'full');
        for (const [distance, ceiling] of [
          [0, 38000],
          [28, 16000],
          [85, 3500],
        ]) {
          instance.setDetail(distance, 'high');
          const d = instance.diagnostics();
          expect(d.triangles).toBeLessThanOrEqual(ceiling);
          expect(d.mainViewSubmissions).toBeLessThanOrEqual(14);
        }
      }
      expect(tyreEquipmentLod(15, 0, 'high')).toBe(0);
      expect(tyreEquipmentLod(17, 0, 'high')).toBe(1);
      expect(tyreEquipmentLod(44, 2, 'high')).toBe(2);
      expect(tyreEquipmentLod(60, 1, 'high', 10)).toBe(0);
      expect(() => tyreEquipmentLod(NaN, 0, 'high')).toThrow();
    } finally {
      kit.dispose();
    }
  });
  it('updates empty/full wheel culling bounds and keeps the LOD hierarchy outside static batching', async () => {
    const kit = await decode();
    try {
      const instance = kit.create('trolley', 'empty');
      const wheel = meshes(instance.levels[0]).find(
        (m) => m instanceof T.InstancedMesh,
      ) as T.InstancedMesh;
      expect(wheel.count).toBe(0);
      instance.setLoadState('full');
      expect(wheel.count).toBe(4);
      expect(wheel.boundingBox!.isEmpty()).toBe(false);
      expect(Number.isFinite(wheel.boundingSphere!.radius)).toBe(true);
      const outer = new T.Group();
      outer.add(kit.root);
      batchScene(outer, new Set([kit.root]));
      expect(instance.root.children).toHaveLength(11);
      instance.setLoadState('empty');
      expect(wheel.count).toBe(0);
      expect(wheel.visible).toBe(false);
    } finally {
      kit.dispose();
    }
  });
  it('stages three non-overlapping units without entering driving, cabinet or crew working space', async () => {
    const kit = await decode();
    const track = new Track();
    try {
      const water = track.water.slice(),
        rubber = track.rubber.slice();
      const placements = tyreEquipmentPlacements(track);
      expect(placements).toHaveLength(3);
      placements.forEach((p) => expect(p.pitClearance).toBeGreaterThan(1));
      for (let i = 0; i < placements.length; i++)
        for (let j = i + 1; j < placements.length; j++)
          expect(placements[i].localBounds.intersectsBox(placements[j].localBounds)).toBe(false);
      installTyreEquipment(kit, track);
      expect(kit.instances.map((i) => i.diagnostics().wheels)).toEqual([4, 0, 8]);
      expect(() => installTyreEquipment(kit, track)).toThrow('already populated');
      expect(track.water).toEqual(water);
      expect(track.rubber).toEqual(rubber);
      expect(tyreEquipmentPlacements(track)).toEqual(placements);
    } finally {
      kit.dispose();
    }
  });
  it('checks real garage mesh rays, not only bounding boxes, through the occupied equipment volumes', async () => {
    const garage = await decodeHeroGarage(
      new Uint8Array(readFileSync('public/models/aurel-hero-garage-bay.glb')),
      loader(),
    );
    try {
      garage.root.updateMatrixWorld(true);
      for (const placement of A35_GARAGE_PLACEMENTS) {
        const matrix = new T.Matrix4().compose(
          new T.Vector3().fromArray(placement.local),
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), placement.yaw),
          new T.Vector3(1, 1, 1),
        );
        const bounds = new T.Box3(
          new T.Vector3(-0.45, 0, -1.08),
          new T.Vector3(0.45, 1.67, 1.08),
        ).applyMatrix4(matrix);
        for (const y of [0.3, 0.8, 1.4])
          for (const fraction of [0.1, 0.5, 0.9]) {
            const z = bounds.min.z + (bounds.max.z - bounds.min.z) * fraction;
            const ray = new T.Raycaster(
              new T.Vector3(bounds.min.x, y, z),
              new T.Vector3(1, 0, 0),
              0.001,
              bounds.max.x - bounds.min.x,
            );
            expect(ray.intersectObject(garage.levels[0], true)).toHaveLength(0);
          }
      }
    } finally {
      garage.dispose();
    }
  });
  it('releases each shared resource and instance buffer once, including detached or empty units', async () => {
    const kit = await decode(),
      events = new Map<object, number>();
    const first = kit.create('trolley', 'empty');
    kit.create('rack', 'full');
    const remember = (r: T.EventDispatcher<{ dispose: object }>) => {
      if (events.has(r)) return;
      events.set(r, 0);
      r.addEventListener('dispose', () => events.set(r, events.get(r)! + 1));
    };
    for (const o of meshes(kit.template)) {
      remember(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        remember(m);
        for (const value of Object.values(m)) if (value instanceof T.Texture) remember(value);
      }
    }
    for (const o of meshes(kit.root)) if (o instanceof T.InstancedMesh) remember(o);
    const parent = new T.Group();
    parent.add(kit.root);
    first.dispose();
    first.dispose();
    kit.dispose();
    kit.dispose();
    expect(parent.children).toHaveLength(0);
    expect([...events.values()].every((count) => count === 1)).toBe(true);
    expect(kit.diagnostics().loaded).toBe(false);
    expect(() => kit.create()).toThrow('disposed');
    expect(() => first.setLoadState('full')).toThrow('disposed');
    expect(() => new TyreEquipmentKit(new T.Group())).toThrow('Missing');
  });
  it('rejects pre-cancelled, truncated, oversized and failed transports with no substitute art', async () => {
    const never: typeof fetch = async () => {
      throw new Error('Must not fetch');
    };
    await expect(
      loadTyreEquipment(() => true, 'https://example.test/a35', never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      loadTyreEquipment(
        () => false,
        'https://example.test/a35',
        async () => new Response(raw().slice(0, 80)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadTyreEquipment(
        () => false,
        'https://example.test/a35',
        async () => new Response(new Uint8Array(TYRE_EQUIPMENT.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
    await expect(
      loadTyreEquipment(
        () => false,
        'https://example.test/a35',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('404');
  });
});
