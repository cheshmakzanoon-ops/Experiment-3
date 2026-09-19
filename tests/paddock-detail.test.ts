import { expect, it } from 'vitest';
import * as T from 'three';
import { buildGarageBay, paddockMaterials } from '../src/rendering/paddock-detail.ts';
import { batchScene } from '../src/rendering/geometry.ts';

function release(root: T.Object3D, materials?: ReturnType<typeof paddockMaterials>) {
  const geometries = new Set<T.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof T.Mesh) geometries.add(object.geometry);
    if (object instanceof T.InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  if (materials) Object.values(materials).forEach((material) => material.dispose());
}

it('builds a genuinely open garage with a ray-visible rear wall', () => {
  const root = new T.Group(),
    materials = paddockMaterials();
  buildGarageBay(root, materials, 0);
  root.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(-8, 1.6, 0), new T.Vector3(1, 0, 0));
  const hits = ray.intersectObject(root, true);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].point.x).toBeGreaterThan(6);
  expect(hits[0].distance).toBeGreaterThan(14);
  release(root, materials);
});

it('keeps workbenches and cabinets behind the entrance plane', () => {
  const root = new T.Group(),
    materials = paddockMaterials();
  buildGarageBay(root, materials, 2);
  root.updateMatrixWorld(true);
  for (const z of [-2, 0, 2]) {
    const ray = new T.Raycaster(new T.Vector3(-8, 1, z), new T.Vector3(1, 0, 0), 0, 7);
    expect(ray.intersectObject(root, true)).toHaveLength(0);
  }
  const bounds = new T.Box3().setFromObject(root);
  expect(bounds.min.y).toBe(-1.5);
  expect(bounds.max.y).toBeGreaterThan(7);
  release(root, materials);
});

it('static batching preserves shadow, visibility, layer, order and culling ownership', () => {
  const root = new T.Group(),
    material = new T.MeshStandardMaterial();
  for (let i = 0; i < 4; i++) {
    const object = new T.Mesh(new T.BoxGeometry(), material);
    object.position.x = i * 2;
    object.castShadow = i % 2 === 0;
    object.receiveShadow = i < 2;
    object.renderOrder = i;
    object.layers.mask = 1 << i;
    object.visible = i !== 3;
    object.frustumCulled = i !== 2;
    root.add(object);
  }
  batchScene(root, new Set());
  const batches = root.children as T.Mesh[];
  expect(batches).toHaveLength(4);
  for (const object of batches) {
    const i = object.renderOrder;
    expect(object.castShadow).toBe(i % 2 === 0);
    expect(object.receiveShadow).toBe(i < 2);
    expect(object.layers.mask).toBe(1 << i);
    expect(object.visible).toBe(i !== 3);
    expect(object.frustumCulled).toBe(i !== 2);
  }
  release(root);
  material.dispose();
});

it('does not flatten a hidden ancestor into a visible static batch', () => {
  const root = new T.Group(),
    hidden = new T.Group(),
    material = new T.MeshStandardMaterial(),
    child = new T.Mesh(new T.BoxGeometry(), material);
  hidden.visible = false;
  root.add(hidden);
  hidden.add(child);
  batchScene(root, new Set());
  expect(child.parent).toBe(hidden);
  expect(root.children).toEqual([hidden]);
  hidden.visible = true;
  expect(child.parent!.visible).toBe(true);
  child.geometry.dispose();
  material.dispose();
});

it('preserves the garage aperture after production static batching', () => {
  const root = new T.Group(),
    bay = new T.Group(),
    materials = paddockMaterials();
  root.add(bay);
  buildGarageBay(bay, materials, 0);
  batchScene(root, new Set());
  root.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(-8, 1.6, 0), new T.Vector3(1, 0, 0));
  const hits = ray.intersectObject(root, true);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].point.x).toBeGreaterThan(6);
  release(root, materials);
});
