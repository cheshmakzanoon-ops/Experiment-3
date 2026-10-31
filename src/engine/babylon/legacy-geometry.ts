import * as T from 'three';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Preserve authored procedural buffers while Babylon becomes the renderer.
 * Unsupported animation/material features fail explicitly, rather than
 * silently producing a visually incomplete replacement for the original. */
export function legacyVertexData(geometry: T.BufferGeometry) {
  if (
    geometry.getAttribute('skinIndex') ||
    Object.values(geometry.morphAttributes).some((a) => a?.length)
  )
    throw new Error('Skinned/morph geometry requires an animation adapter');
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Expected three-component positions');
  const copy = (name: string, size: number) => {
    const attribute = geometry.getAttribute(name);
    if (!attribute) return null;
    if (attribute.itemSize !== size || attribute.count !== position.count)
      throw new Error(`Invalid legacy ${name} attribute`);
    const result = new Float32Array(attribute.count * size);
    for (let i = 0; i < attribute.count; i++) {
      result[i * size] = attribute.getX(i);
      result[i * size + 1] = attribute.getY(i);
      if (size > 2) result[i * size + 2] = attribute.getZ(i);
      if (size > 3) result[i * size + 3] = attribute.getW(i);
    }
    if (!result.every(Number.isFinite)) throw new Error(`Non-finite legacy ${name}`);
    return result;
  };
  const data = new VertexData();
  data.positions = copy('position', 3)!;
  data.normals = copy('normal', 3);
  data.uvs = copy('uv', 2);
  data.uvs2 = copy('uv1', 2);
  data.tangents = copy('tangent', 4);
  const index = geometry.getIndex();
  const indices = index
    ? Array.from({ length: index.count }, (_, i) => index.getX(i))
    : Array.from({ length: position.count }, (_, i) => i);
  if (
    indices.length % 3 ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i >= position.count)
  )
    throw new Error('Invalid legacy triangle indices');
  data.indices = indices;
  if (!data.normals) {
    const normals: number[] = [];
    VertexData.ComputeNormals(data.positions, indices, normals, { useRightHandedSystem: true });
    data.normals = normals;
  }
  const color = geometry.getAttribute('color');
  if (color) {
    if (color.count !== position.count || ![3, 4].includes(color.itemSize))
      throw new Error('Invalid legacy vertex colors');
    const colors = new Float32Array(color.count * 4);
    for (let i = 0; i < color.count; i++)
      colors.set(
        [color.getX(i), color.getY(i), color.getZ(i), color.itemSize === 4 ? color.getW(i) : 1],
        i * 4,
      );
    if (!colors.every(Number.isFinite)) throw new Error('Non-finite legacy vertex colors');
    data.colors = colors;
  }
  return data;
}

function assertMaterial(source: T.Material) {
  if (!(source instanceof T.MeshStandardMaterial) && !(source instanceof T.MeshBasicMaterial))
    throw new Error(`Material ${source.type} needs a dedicated Babylon adapter`);
  if (
    source.side === T.BackSide ||
    source.wireframe ||
    source.clippingPlanes?.length ||
    !source.depthTest ||
    source.polygonOffset
  )
    throw new Error('Back-face-only, wireframe or clipped material needs an adapter');
  if (source.onBeforeCompile !== T.Material.prototype.onBeforeCompile)
    throw new Error('Custom shader hooks require a Babylon shader port');
  for (const value of Object.values(source))
    if (value instanceof T.Texture)
      throw new Error('Textured legacy material requires a texture adapter');
  if (
    source instanceof T.MeshPhysicalMaterial &&
    (source.transmission > 0 || source.iridescence > 0 || source.anisotropy > 0 || source.sheen > 0)
  )
    throw new Error('Advanced optical material requires a dedicated Babylon adapter');
}

function material(source: T.MeshStandardMaterial | T.MeshBasicMaterial, scene: Scene) {
  const result = new PBRMaterial(source.name || 'legacy-material', scene);
  result.albedoColor = new Color3(source.color.r, source.color.g, source.color.b);
  result.alpha = source.opacity;
  result.disableDepthWrite = !source.depthWrite;
  result.backFaceCulling = source.side !== T.DoubleSide;
  result.unlit = source instanceof T.MeshBasicMaterial;
  result.metallic = source instanceof T.MeshStandardMaterial ? source.metalness : 0;
  result.roughness = source instanceof T.MeshStandardMaterial ? source.roughness : 1;
  if (source instanceof T.MeshStandardMaterial)
    result.emissiveColor = new Color3(
      source.emissive.r,
      source.emissive.g,
      source.emissive.b,
    ).scale(source.emissiveIntensity);
  if (source.transparent) result.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  else if (source.alphaTest > 0) {
    result.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    result.alphaCutOff = source.alphaTest;
  }
  if (source instanceof T.MeshPhysicalMaterial) {
    result.clearCoat.isEnabled = source.clearcoat > 0;
    result.clearCoat.intensity = source.clearcoat;
    result.clearCoat.roughness = source.clearcoatRoughness;
    result.indexOfRefraction = source.ior;
  }
  return result;
}

export function importLegacyMesh(source: T.Mesh, scene: Scene) {
  if (!scene.useRightHandedSystem)
    throw new Error('Legacy geometry requires a right-handed Babylon scene');
  if (source instanceof T.SkinnedMesh || source instanceof T.InstancedMesh)
    throw new Error('Skin/instance transforms require their own adapter');
  const materials = Array.isArray(source.material) ? source.material : [source.material];
  materials.forEach(assertMaterial);
  if (materials.some((m) => m.vertexColors !== materials[0].vertexColors))
    throw new Error('Mixed vertex-color policies require separate Babylon meshes');
  const data = legacyVertexData(source.geometry);
  const { start, count } = source.geometry.drawRange;
  const end = Math.min(data.indices!.length, start + count);
  if (!Number.isInteger(start) || start < 0 || start % 3 || end % 3 || end < start)
    throw new Error('Invalid legacy draw range');
  for (const group of source.geometry.groups) {
    if (
      group.start % 3 ||
      group.count % 3 ||
      group.start < 0 ||
      group.start + group.count > data.indices!.length ||
      !Number.isInteger(group.materialIndex ?? 0) ||
      (group.materialIndex ?? 0) < 0 ||
      (Array.isArray(source.material) && (group.materialIndex ?? 0) >= materials.length)
    )
      throw new Error('Invalid legacy material group');
  }
  const mesh = new Mesh(source.name || 'legacy-mesh', scene);
  try {
    data.applyToMesh(mesh);
    mesh.useVertexColors = materials[0].vertexColors;
    mesh.hasVertexAlpha =
      materials[0].vertexColors && source.geometry.getAttribute('color')?.itemSize === 4;
    const converted = materials.map((m) =>
      material(m as T.MeshStandardMaterial | T.MeshBasicMaterial, scene),
    );
    if (Array.isArray(source.material)) {
      const multi = new MultiMaterial(`${mesh.name}-materials`, scene);
      multi.subMaterials = converted;
      mesh.material = multi;
      mesh.releaseSubMeshes();
      for (const group of source.geometry.groups) {
        const from = Math.max(start, group.start),
          to = Math.min(end, group.start + group.count);
        if (to > from)
          new SubMesh(group.materialIndex ?? 0, 0, mesh.getTotalVertices(), from, to - from, mesh);
      }
    } else {
      mesh.material = converted[0];
      mesh.releaseSubMeshes();
      if (end > start) new SubMesh(0, 0, mesh.getTotalVertices(), start, end - start, mesh);
    }
    syncLegacyPose(source, mesh);
    return mesh;
  } catch (error) {
    mesh.dispose(false, true);
    throw error;
  }
}

const manualMatrix = Matrix.Identity();
const manualPosition = new Vector3(),
  manualScale = new Vector3(),
  manualRotation = new Quaternion();

/** Source asset/animation code owns the pose. Babylon owns only presentation. */
export function syncLegacyPose(source: T.Object3D, target: Mesh) {
  if (!source.matrixAutoUpdate) {
    if (!source.matrix.elements.every(Number.isFinite)) throw new Error('Invalid legacy matrix');
    Matrix.FromArrayToRef(source.matrix.elements, 0, manualMatrix);
    if (!manualMatrix.decompose(manualScale, manualRotation, manualPosition))
      throw new Error('Singular legacy matrix');
    target.position.copyFrom(manualPosition);
    target.scaling.copyFrom(manualScale);
    target.rotationQuaternion ??= new Quaternion();
    target.rotationQuaternion.copyFrom(manualRotation);
    target.setEnabled(source.visible);
    return;
  }
  if (
    ![
      source.position.x,
      source.position.y,
      source.position.z,
      source.scale.x,
      source.scale.y,
      source.scale.z,
      source.quaternion.x,
      source.quaternion.y,
      source.quaternion.z,
      source.quaternion.w,
    ].every(Number.isFinite) ||
    source.quaternion.lengthSq() < 1e-16
  )
    throw new Error('Invalid legacy transform');
  target.position.set(source.position.x, source.position.y, source.position.z);
  target.scaling.set(source.scale.x, source.scale.y, source.scale.z);
  target.rotationQuaternion ??= new Quaternion();
  target.rotationQuaternion.set(
    source.quaternion.x,
    source.quaternion.y,
    source.quaternion.z,
    source.quaternion.w,
  );
  target.setEnabled(source.visible);
}
