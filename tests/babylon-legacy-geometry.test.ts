import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import {
  importLegacyMesh,
  legacyVertexData,
  syncLegacyPose,
} from '../src/engine/babylon/legacy-geometry.ts';

describe('existing asset geometry inside Babylon', () => {
  it('preserves original position, normal, UV, index and local transform data without taking ownership', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const geometry = new T.BoxGeometry(1, 2, 3),
      source = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: 0x2858aa }));
    source.position.set(3, 4, 5);
    source.rotation.set(0.1, 0.2, 0.3);
    source.scale.set(2, 3, 4);
    const before = geometry.getAttribute('position').array.slice();
    try {
      const mesh = importLegacyMesh(source, scene);
      expect(Array.from(mesh.getVerticesData('position')!)).toEqual(Array.from(before));
      expect(Array.from(mesh.getVerticesData('normal')!)).toEqual(
        Array.from(geometry.getAttribute('normal').array),
      );
      expect(Array.from(mesh.getVerticesData('uv')!)).toEqual(
        Array.from(geometry.getAttribute('uv').array),
      );
      expect(Array.from(mesh.getIndices()!)).toEqual(Array.from(geometry.index!.array));
      expect(mesh.position.asArray()).toEqual([3, 4, 5]);
      expect(mesh.scaling.asArray()).toEqual([2, 3, 4]);
      expect(mesh.rotationQuaternion!.asArray()).toEqual(source.quaternion.toArray());
      source.position.x = 9;
      source.visible = false;
      syncLegacyPose(source, mesh);
      expect(mesh.position.x).toBe(9);
      expect(mesh.isEnabled()).toBe(false);
      mesh.dispose(false, true);
      expect(geometry.getAttribute('position').array).toEqual(before);
    } finally {
      scene.dispose();
      engine.dispose();
      geometry.dispose();
      source.material.dispose();
    }
  });
  it('preserves six authored material groups rather than collapsing the mesh to one material', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const geometry = new T.BoxGeometry(),
      materials = Array.from({ length: 6 }, () => new T.MeshStandardMaterial());
    try {
      const mesh = importLegacyMesh(new T.Mesh(geometry, materials), scene);
      expect(mesh.material).toBeInstanceOf(MultiMaterial);
      expect(mesh.subMeshes.map((s) => [s.materialIndex, s.indexStart, s.indexCount])).toEqual(
        geometry.groups.map((g) => [g.materialIndex, g.start, g.count]),
      );
    } finally {
      scene.dispose();
      engine.dispose();
      geometry.dispose();
      materials.forEach((m) => m.dispose());
    }
  });
  it('rejects unsupported textures and shader hooks without leaving a partial scene', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const geometry = new T.BoxGeometry(),
      material = new T.MeshStandardMaterial(),
      source = new T.Mesh(geometry, material);
    try {
      material.map = new T.Texture();
      expect(() => importLegacyMesh(source, scene)).toThrow('texture adapter');
      material.map.dispose();
      material.map = null;
      material.onBeforeCompile = () => {};
      expect(() => importLegacyMesh(source, scene)).toThrow('shader port');
      expect(scene.meshes).toHaveLength(0);
      expect(scene.materials).toHaveLength(0);
      geometry.setAttribute(
        'skinIndex',
        new T.BufferAttribute(new Uint16Array(geometry.getAttribute('position').count * 4), 4),
      );
      expect(() => legacyVertexData(geometry)).toThrow('animation adapter');
    } finally {
      scene.dispose();
      engine.dispose();
      geometry.dispose();
      material.dispose();
    }
  });
});

it('retains manually authored static matrices rather than stale position fields', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial(),
    source = new T.Mesh(geometry, material);
  source.matrixAutoUpdate = false;
  source.matrix.compose(
    new T.Vector3(7, 8, 9),
    new T.Quaternion().setFromEuler(new T.Euler(0.2, 0.4, 0.1)),
    new T.Vector3(2, 3, 4),
  );
  try {
    const mesh = importLegacyMesh(source, scene);
    const world = mesh.computeWorldMatrix(true).asArray();
    for (let i = 0; i < 16; i++) expect(world[i]).toBeCloseTo(source.matrix.elements[i], 5);
    const previous = mesh.position.clone();
    source.matrix.elements[12] = NaN;
    expect(() => syncLegacyPose(source, mesh)).toThrow('Invalid legacy matrix');
    expect(mesh.position.equals(previous)).toBe(true);
  } finally {
    scene.dispose();
    engine.dispose();
    geometry.dispose();
    material.dispose();
  }
});
