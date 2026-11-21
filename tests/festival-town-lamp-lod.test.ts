import { expect, it } from 'vitest';
import * as T from 'three';
import { buildTownLamps } from '../src/rendering/open-world/town-lamps.ts';

it('preserves every mast, cast shadow and optic socket while distant luminaires shed subpixel castings', () => {
  const matrices = Array.from({ length: 24 }, (_, i) =>
    new T.Matrix4().makeRotationY(i * 0.13).setPosition(15 * i, 2, 18),
  );
  const post = new T.MeshStandardMaterial(),
    lens = new T.MeshStandardMaterial(),
    l = buildTownLamps(matrices, post, lens),
    full = l.stats.triangles;
  const lampMeshes = l.root.children as T.InstancedMesh[];
  const socket = l.sockets.map((s) => s.position.toArray());
  const placed = (m: T.Material) => {
    const v = new T.Matrix4(),
      found: number[] = [];
    for (const mesh of lampMeshes.filter((o) => o.material === m && o.visible)) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, v);
        found.push(v.elements[12]);
      }
      if (m === post) expect(mesh.castShadow).toBe(true);
    }
    return found.sort((a, b) => a - b);
  };
  l.update(new T.Vector3(10_000, 0, 0), 'low');
  expect(l.stats).toMatchObject({ near: 0, far: 24, batches: 2 });
  expect(l.stats.triangles).toBeLessThan(full * 0.26);
  for (const camera of [new T.Vector3(45, 6, 18), new T.Vector3(300, 6, 18)]) {
    l.update(camera, 'medium');
    expect(l.stats.near).toBeGreaterThan(0);
    expect(l.stats.far).toBeGreaterThan(0);
    expect(l.stats.batches).toBe(4);
    for (const material of [post, lens])
      expect(placed(material)).toEqual(matrices.map((m) => m.elements[12]));
    const version = lampMeshes.map((m) => m.instanceMatrix.version);
    l.update(camera.clone().addScalar(0.4), 'medium');
    expect(lampMeshes.map((m) => m.instanceMatrix.version)).toEqual(version);
  }
  expect(l.sockets.map((s) => s.position.toArray())).toEqual(socket);
  const geometries = new Set<T.BufferGeometry>();
  for (const m of lampMeshes) {
    geometries.add(m.geometry);
    m.dispose();
  }
  for (const g of geometries) g.dispose();
  post.dispose();
  lens.dispose();
});
