import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SuppliedSkinBounds } from '../src/rendering/supplied-skin-bounds.ts';

function fixture() {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 2, 0], 3));
  geometry.setAttribute(
    'skinIndex',
    new T.Uint16BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new T.Float32BufferAttribute([0.3, 0.7, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0], 4),
  );
  geometry.setIndex([0, 1, 2]);
  const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  const a = new T.Bone(),
    b = new T.Bone();
  a.add(b);
  mesh.add(a);
  mesh.bind(new T.Skeleton([a, b]));
  mesh.frustumCulled = false;
  const root = new T.Group();
  root.add(mesh);
  const original = mesh.computeBoundingSphere;
  return { root, mesh, a, b, geometry, original };
}
function contains(mesh: T.SkinnedMesh) {
  mesh.computeBoundingSphere();
  const v = new T.Vector3();
  for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
    mesh.getVertexPosition(i, v);
    if (!mesh.boundingSphere.containsPoint(v))
      throw new Error(`Missing vertex ${i} of ${mesh.name}`);
  }
}

describe('conservative supplied-player skin bounds', () => {
  it('contains blended motion, rotated/scaled binds, both directions and large world translations', () => {
    const f = fixture(),
      bounds = new SuppliedSkinBounds(f.root);
    expect(bounds.diagnostics()).toEqual({ meshes: 1, jointBoxes: 2, fallbacks: 0 });
    for (const angle of [-1.2, 0, 1.2]) {
      f.root.position.set(2350, 21, -1740);
      f.root.rotation.y = angle;
      f.root.scale.set(1.1, 0.8, 1.3);
      f.b.rotation.z = angle;
      f.b.position.set(1, 2, 0);
      f.root.updateMatrixWorld(true);
      bounds.invalidate();
      contains(f.mesh);
    }
    bounds.dispose();
    bounds.dispose();
    expect(f.mesh.computeBoundingSphere).toBe(f.original);
    expect(f.mesh.frustumCulled).toBe(false);
  });
  it('permits real off-camera culling and contains every subset LOD without allocations on invalidation', () => {
    const f = fixture(),
      bounds = new SuppliedSkinBounds(f.root);
    f.root.position.z = -10;
    f.root.updateMatrixWorld(true);
    contains(f.mesh);
    const first = f.mesh.boundingSphere;
    const camera = new T.PerspectiveCamera(50, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    expect(frustum.intersectsObject(f.mesh)).toBe(true);
    const subset = new T.BufferGeometry();
    for (const [name, attribute] of Object.entries(f.geometry.attributes))
      subset.setAttribute(name, attribute);
    subset.setIndex([1, 2, 1]);
    f.mesh.geometry = subset;
    bounds.invalidate();
    contains(f.mesh);
    expect(f.mesh.boundingSphere).toBe(first);
    f.root.position.x = 500;
    f.root.updateMatrixWorld(true);
    bounds.invalidate();
    expect(frustum.intersectsObject(f.mesh)).toBe(false);
    bounds.dispose();
    subset.dispose();
  });
  it('uses the original exact calculation for changed attributes or new morph targets', () => {
    const f = fixture(),
      bounds = new SuppliedSkinBounds(f.root);
    f.mesh.geometry = f.geometry.clone();
    f.root.updateMatrixWorld(true);
    bounds.invalidate();
    contains(f.mesh);
    f.mesh.geometry.morphAttributes.position = [
      new T.Float32BufferAttribute([8, 0, 0, 8, 0, 0, 8, 0, 0], 3),
    ];
    f.mesh.geometry.morphTargetsRelative = true;
    f.mesh.updateMorphTargets();
    f.mesh.morphTargetInfluences![0] = 1;
    bounds.invalidate();
    contains(f.mesh);
    bounds.dispose();
  });
  it('does not enable convex culling for signed, zero-sum, malformed or morphed skinning', () => {
    for (const bad of [-0.5, NaN, Infinity]) {
      const f = fixture();
      f.geometry.getAttribute('skinWeight').setX(0, bad);
      const bounds = new SuppliedSkinBounds(f.root);
      expect(bounds.diagnostics().fallbacks).toBe(1);
      expect(f.mesh.frustumCulled).toBe(false);
      bounds.dispose();
    }
    const f = fixture();
    f.geometry.morphAttributes.position = [f.geometry.getAttribute('position')];
    expect(new SuppliedSkinBounds(f.root).diagnostics().fallbacks).toBe(1);
  });
  it('invalidates lazily and restores ownership even before the first draw', () => {
    const f = fixture(),
      bounds = new SuppliedSkinBounds(f.root);
    expect(f.mesh.boundingSphere).toBeNull();
    bounds.invalidate();
    bounds.dispose();
    expect(f.mesh.boundingSphere).toBeNull();
    expect(f.mesh.computeBoundingSphere).toBe(f.original);
  });
  it('contains every actual source vertex at both steering locks, neutral, translated and rewound poses', async () => {
    const raw = gunzipSync(
      readFileSync(new URL('../public/models/supplied-player.glb.gz', import.meta.url)),
    );
    const jsonLength = raw.readUInt32LE(12),
      doc = JSON.parse(raw.subarray(20, 20 + jsonLength).toString());
    // Geometry/rig-only CPU fixture: preserve all source accessors, joints,
    // transforms and animation bytes; omit image decoding, not any vertices.
    delete doc.images;
    delete doc.textures;
    delete doc.materials;
    for (const mesh of doc.meshes)
      for (const primitive of mesh.primitives) delete primitive.material;
    const text = Buffer.from(JSON.stringify(doc)),
      json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
    text.copy(json);
    const binary = raw.subarray(20 + jsonLength),
      header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + json.length + binary.length, 8);
    header.writeUInt32LE(json.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    const data = Buffer.concat([header, json, binary]);
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      '',
    );
    const bounds = new SuppliedSkinBounds(gltf.scene);
    expect(bounds.diagnostics().meshes).toBe(61);
    expect(bounds.diagnostics().fallbacks).toBe(0);
    const mixer = new T.AnimationMixer(gltf.scene),
      action = mixer.clipAction(gltf.animations[0]);
    action.play();
    action.paused = true;
    const meshes: T.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => {
      if (o instanceof T.SkinnedMesh) meshes.push(o);
    });
    for (const time of [0, action.getClip().duration / 2, action.getClip().duration, 0]) {
      action.time = time;
      mixer.update(0);
      gltf.scene.position.set(1790, -8, -1320);
      gltf.scene.rotation.y = time * 0.15;
      gltf.scene.updateMatrixWorld(true);
      bounds.invalidate();
      for (const mesh of meshes) contains(mesh);
    }
    bounds.dispose();
    mixer.stopAllAction();
    gltf.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }, 60000);
});
