import { expect, it } from 'vitest';
import * as T from 'three';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';
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

it('selects streetlamp detail from the live road scene without moving the light pool', () => {
  const world = openWorld();
  const roads = new RoadMeshes(world.network, world.field);
  try {
    const fixtures = roads.root.getObjectByName('Port Ilse street luminaires')!;
    const sockets = roads.lampSockets.map((s) => s.position.toArray());
    expect(sockets.length).toBe(240);
    roads.setNight(1, new T.Vector3(560, 7, -2598), 'low');
    const count = (name: string) => fixtures.children.reduce((sum, mesh) =>
      sum + (mesh.name === name && mesh.visible ? (mesh as T.InstancedMesh).count : 0), 0);
    const near = count('Town lamp posts');
    expect(near).toBeGreaterThan(0);
    expect(count('Distant town lamp posts')).toBe(sockets.length - near);
    roads.setNight(0, new T.Vector3(3000, 400, 1200), 'medium');
    expect(count('Town lamp posts')).toBe(0);
    expect(count('Distant town lamp heads')).toBe(sockets.length);
    expect(roads.lampSockets.map((s) => s.position.toArray())).toEqual(sockets);
  } finally {
    roads.dispose();
  }
});
