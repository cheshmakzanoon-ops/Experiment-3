import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import {
  A33,
  a33Bytes,
  a33Geometry,
  a33GripX,
  a33HalfWidth,
  a33Socket,
  A33WheelBatches,
  A33GarageStorage,
  type A33Level,
  type A33State,
} from '../src/rendering/a33-spare-wheel-set.ts';
import source from '../src/rendering/a33-spare-wheel-set.geometry.json' with { type: 'json' };
import garageManifest from '../src/rendering/hero-garage.manifest.json' with { type: 'json' };
import { PitCrewView, serviceWheelOffset } from '../src/rendering/pit-crew.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const levels = [0, 1, 2] as const;
function frame(clock: number, cars = 1) {
  const f = new Float32Array(HEADER + CAR_STRIDE * cars);
  f[H.CARS] = cars;
  f[H.TIME] = 100 + clock;
  for (let i = 0; i < cars; i++) {
    const o = carBase(i);
    f[o + F.QW] = 1;
    f[o + F.Y] = 0.7;
    f[o + F.X] = i * 7;
    f[o + F.PIT_PHASE] = clock < 0.8 ? 2 : clock < 2.2 ? 3 : clock < 3.5 ? 4 : clock < 5.2 ? 5 : 6;
    f[o + F.PIT_CLOCK] = clock;
    f[o + F.JACK_HEIGHT] = 0.19;
    for (let j = 0; j < 4; j++) f[o + WHEEL_BASE + j * WHEEL_STRIDE + W.LENGTH] = 0.3;
  }
  return f;
}
function disposeCrew(view: PitCrewView) {
  view.dispose();
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  view.root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    gs.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      ms.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) ts.add(v);
    }
    if (o.customDepthMaterial) ms.add(o.customDepthMaterial);
    if (o.customDistanceMaterial) ms.add(o.customDistanceMaterial);
    if (o instanceof T.InstancedMesh) o.dispose();
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  ts.forEach((t) => t.dispose());
}

describe('A33 retained Blender wheel handling contract', () => {
  it('binds source, GLB and compact runtime data to measured integrity receipts', () => {
    const data = readFileSync('src/rendering/a33-spare-wheel-set.geometry.json');
    const glb = readFileSync('public/models/aurel-a33-spare-wheel-set.glb');
    expect(digest(data)).toBe(A33.runtimeSha256);
    expect(data.length).toBe(A33.runtimeBytes);
    expect(digest(glb)).toBe(A33.sha256);
    expect(glb.length).toBe(A33.bytes);
    expect(digest(readFileSync(A33.author))).toBe(A33.sourceSHA256);
    expect(readFileSync(A33.editable).length).toBeGreaterThan(10000);
    expect(glb.toString('ascii', 0, 4)).toBe('glTF');
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    const d = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
    expect(d.meshes).toHaveLength(6);
    expect(d.materials).toHaveLength(1);
    expect(d.images).toHaveLength(2);
    expect(
      d.images.every(
        (i: { uri?: string; bufferView?: number }) => !i.uri && Number.isInteger(i.bufferView),
      ),
    ).toBe(true);
    for (const end of ['FRONT', 'REAR'])
      for (const level of levels) {
        const node = d.nodes.find((n: { name: string }) => n.name === `A33_${end}_LOD${level}`);
        const tris = d.meshes[node.mesh].primitives.reduce(
          (n: number, p: { indices: number }) => n + d.accessors[p.indices].count / 3,
          0,
        );
        expect(tris).toBe(A33.trianglesPerWheel[level]);
      }
    expect(d.nodes.filter((n: { name?: string }) => n.name?.includes('_SOCKET_'))).toHaveLength(16);
    expect(
      d.nodes.some((n: { name?: string }) => /brake|caliper|upright|rotor/i.test(n.name ?? '')),
    ).toBe(false);
    expect(Object.keys(source.states)).toEqual([
      'carry',
      'staged',
      'storedVertical',
      'storedHorizontal',
    ]);
    expect(A33.finalArtApproved).toBe(false);
  });
  it('rejects truncated, oversized and malformed encoded buffers before geometry allocation', () => {
    expect(() => a33Bytes('AAAA', 4)).toThrow();
    expect(() => a33Bytes('!!!!', 3)).toThrow();
    expect(() => a33Bytes('AAAA', 3 * 1024 * 1024)).toThrow();
    expect(() => a33Bytes('AAAA', NaN)).toThrow();
    expect(() => a33Geometry(3 as A33Level)).toThrow();
    expect(() => a33HalfWidth(-1)).toThrow();
    expect(() => a33HalfWidth(4)).toThrow();
    expect(() => a33HalfWidth(0.5)).toThrow();
    expect(() => a33GripX(0, 1)).toThrow();
  });
  it('preserves radius, distinct widths, UVs, normals and exact front/rear topology at every LOD', () => {
    for (const level of levels) {
      const g = a33Geometry(level);
      try {
        expect(g.index!.count / 3).toBe(A33.trianglesPerWheel[level]);
        expect(g.index!.array).toBeInstanceOf(Uint16Array);
        expect(g.index!.count / 3).toBeLessThanOrEqual(A33.triangleCeilings[level]);
        const f = g.getAttribute('position'),
          r = g.morphAttributes.position![0];
        expect(f.count).toBe(r.count);
        let radius = 0;
        for (let i = 0; i < f.count; i++) {
          expect(f.getY(i)).toBeCloseTo(r.getY(i), 6);
          expect(f.getZ(i)).toBeCloseTo(r.getZ(i), 6);
          radius = Math.max(radius, Math.hypot(f.getY(i), f.getZ(i)));
        }
        expect(radius).toBeCloseTo(0.335, 5);
        expect(new T.Box3().setFromBufferAttribute(r as T.BufferAttribute).min.x).toBeCloseTo(
          -0.193,
          5,
        );
        expect(new T.Box3().setFromBufferAttribute(f as T.BufferAttribute).min.x).toBeCloseTo(
          -0.158,
          5,
        );
        expect(g.boundingBox!.max.x).toBeGreaterThan(0.24);
        expect(g.getAttribute('uv').count).toBe(f.count);
      } finally {
        g.dispose();
      }
    }
    expect(a33HalfWidth(2) - a33HalfWidth(0)).toBeCloseTo(0.035, 9);
  });
  it('retains a genuine axial bore in both shapes and all three LODs', () => {
    const ray = new T.Raycaster(new T.Vector3(1, 0, 0), new T.Vector3(-1, 0, 0));
    const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    for (const level of levels) {
      const g = a33Geometry(level),
        mesh = new T.Mesh(g, material);
      for (const end of [0, 1]) {
        mesh.morphTargetInfluences![0] = end;
        mesh.updateMatrixWorld(true);
        expect(ray.intersectObject(mesh)).toHaveLength(0);
        const coverRay = new T.Raycaster(new T.Vector3(1, 0.12, 0), new T.Vector3(-1, 0, 0));
        expect(coverRay.intersectObject(mesh).length).toBeGreaterThan(0);
      }
      g.dispose();
    }
    material.dispose();
  });
  it('uses exported sidewall contact sockets, not hands through the wheel centre', () => {
    const radius = Math.hypot(0.26, 0.12);
    for (let i = 0; i < 4; i++) {
      const left = a33Socket(i, 'GRIP_LEFT');
      const right = a33Socket(i, 'GRIP_RIGHT');
      expect(left.z).toBe(-right.z);
      expect(Math.hypot(left.y, left.z)).toBeCloseTo(radius, 7);
      expect(Math.abs(left.x - a33GripX(i, radius))).toBeLessThan(0.0001);
      expect(a33Socket(i, 'FLOOR_CONTACT').y).toBe(-0.335);
    }
  });
  it('preserves atlas surface separation without baked light or per-wheel material allocation', () => {
    const a = new A33WheelBatches(4);
    try {
      expect(new Set(a.batches.map((b) => b.material)).size).toBe(1);
      const orm = a.material.roughnessMap as T.DataTexture;
      const pixels = orm.image.data as Uint8Array;
      const at = (x: number, c: number) => pixels[(64 * 384 + x) * 4 + c];
      expect(at(64, 2)).toBe(0);
      expect(at(192, 2)).toBe(235);
      expect(at(320, 2)).toBe(16);
      expect(at(64, 1)).toBeGreaterThan(at(192, 1));
      expect(a.material.emissive.getHex()).toBe(0);
      expect(a.material.normalMap?.colorSpace).toBe(T.NoColorSpace);
    } finally {
      a.disposeDetached();
    }
  });
  it('selects front/rear GPU shapes and both sides with positive transforms and bounded buffers', () => {
    const a = new A33WheelBatches(4),
      m = new T.Matrix4();
    try {
      a.begin();
      for (let i = 0; i < 4; i++) a.putCarLocal(i, new T.Vector3(i, 0, 0), m, 0);
      a.finish();
      const b = a.batches[0],
        selector = new T.Mesh(b.geometry, b.material);
      for (let i = 0; i < 4; i++) {
        b.getMorphAt(i, selector);
        expect(selector.morphTargetInfluences![0]).toBe(i < 2 ? 0 : 1);
        b.getMatrixAt(i, m);
        expect(m.determinant()).toBeCloseTo(1, 6);
        const outward = new T.Vector3(1, 0, 0).transformDirection(m);
        expect(outward.x).toBeCloseTo(i % 2 ? 1 : -1, 6);
      }
      expect(a.diagnostics().activeBatches).toBe(1);
      expect(() => a.put(0, new T.Matrix4(), 0)).toThrow('capacity');
      a.begin();
      expect(() => a.put(0, new T.Matrix4().makeScale(-1, 1, 1), 0)).toThrow();
    } finally {
      a.disposeDetached();
    }
  });
  it('places vertical/horizontal states on their actual support surface, with the nut above the floor', () => {
    const a = new A33WheelBatches(4),
      m = new T.Matrix4();
    try {
      for (const state of ['staged', 'storedVertical', 'storedHorizontal'] as A33State[]) {
        a.begin();
        for (let i = 0; i < 4; i++) a.putState(i, state, new T.Matrix4(), 0);
        const batch = a.batches[0];
        for (let i = 0; i < 4; i++) {
          batch.getMatrixAt(i, m);
          const p =
            i < 2
              ? batch.geometry.getAttribute('position')
              : batch.geometry.morphAttributes.position![0];
          const box = new T.Box3().setFromBufferAttribute(p as T.BufferAttribute).applyMatrix4(m);
          expect(box.min.y).toBeCloseTo(0, 5);
          if (state === 'storedHorizontal') expect(box.max.y).toBeGreaterThan(2 * a33HalfWidth(i));
        }
      }
    } finally {
      a.disposeDetached();
    }
  });
  it('attaches storage only to A22 wheel sockets and changes LOD without allocating another wheel', () => {
    const root = new T.Group();
    for (const [name, p] of Object.entries(garageManifest.sockets)) {
      const node = new T.Object3D();
      node.name = name;
      node.position.fromArray(p);
      root.add(node);
    }
    const storage = new A33GarageStorage(root),
      before = storage.wheels.batches.map((b) => b.geometry);
    try {
      expect(storage.wheels.diagnostics().instances).toBe(4);
      storage.setDetail(2);
      storage.setDetail(1);
      storage.setDetail(0);
      expect(storage.wheels.batches.map((b) => b.geometry)).toEqual(before);
      const anchors = ['FL', 'FR', 'RL', 'RR'].map((id) =>
        root.getObjectByName('SOCKET_TYRE_' + id)!.position.clone(),
      );
      const batch = storage.wheels.batches[0],
        matrix = new T.Matrix4();
      for (let i = 0; i < 4; i++) {
        batch.getMatrixAt(i, matrix);
        const position = new T.Vector3().setFromMatrixPosition(matrix);
        expect(position.x).toBeCloseTo(anchors[i].x, 5);
        expect(position.z).toBeCloseTo(anchors[i].z, 5);
        expect(position.y).toBeCloseTo(anchors[i].y + a33HalfWidth(i) + 0.003, 5);
      }
    } finally {
      storage.wheels.disposeDetached();
    }
  });
  it('disposes shared detached resources exactly once and rejects reuse', () => {
    const a = new A33WheelBatches(1);
    let materials = 0,
      textures = 0,
      geometry = 0;
    a.material.addEventListener('dispose', () => materials++);
    a.material.normalMap!.addEventListener('dispose', () => textures++);
    a.material.roughnessMap!.addEventListener('dispose', () => textures++);
    a.batches.forEach((b) => b.geometry.addEventListener('dispose', () => geometry++));
    a.disposeDetached();
    a.disposeDetached();
    expect([materials, textures, geometry]).toEqual([1, 2, 3]);
    expect(() => a.begin()).toThrow('disposed');
  });
});

describe('A33 production service consumers', () => {
  it('uses axle-centred transfer, end-correct spares and unchanged recorded state', () => {
    const view = new PitCrewView(),
      camera = new T.Vector3();
    try {
      const f = frame(2.2),
        before = f.slice();
      view.update(f, camera);
      expect(f).toEqual(before);
      expect(view.summary().unreachableArms).toBe(0);
      const batch = view.spareWheels.batches[0],
        matrix = new T.Matrix4();
      expect(batch.count).toBe(4);
      for (let i = 0; i < 4; i++) {
        batch.getMatrixAt(i, matrix);
        const p = new T.Vector3().setFromMatrixPosition(matrix);
        const side = i % 2 ? -1 : 1;
        // At exchange, the outgoing carry endpoint is the actual axle withdrawal,
        // not the old generic placeholder's extra 21 cm outboard offset.
        expect(p.x).toBeCloseTo(WHEEL_POSITIONS[i][0] - side * 0.48, 5);
      }
      expect(serviceWheelOffset(3, 2, 1000)).toBe(0);
      const first = Array.from(batch.morphTexture!.image.data as Float32Array);
      const version = batch.morphTexture!.version;
      view.update(f, camera);
      expect(batch.morphTexture!.version).toBe(version);
      view.update(frame(4.8), camera);
      view.update(f, camera);
      expect(Array.from(batch.morphTexture!.image.data as Float32Array)).toEqual(first);
      expect(view.summary().maxGripError).toBeLessThan(0.0001);
    } finally {
      disposeCrew(view);
    }
  });
  it('keeps 48 spares for twelve simultaneous crews, with no per-wheel draws or per-frame geometry', () => {
    const view = new PitCrewView();
    try {
      const geometry = view.spareWheels.batches.map((b) => b.geometry);
      view.update(frame(1.8, 12), new T.Vector3());
      expect(view.spareWheels.diagnostics().instances).toBe(48);
      expect(view.spareWheels.diagnostics().activeBatches).toBeLessThanOrEqual(2);
      expect(view.summary().activeDrawBatches).toBeLessThanOrEqual(8);
      view.update(frame(4.8, 12), new T.Vector3());
      expect(view.spareWheels.batches.map((b) => b.geometry)).toEqual(geometry);
      view.update(frame(5.3, 12), new T.Vector3());
      expect(view.spareWheels.diagnostics().instances).toBe(0);
    } finally {
      disposeCrew(view);
    }
  });
});
