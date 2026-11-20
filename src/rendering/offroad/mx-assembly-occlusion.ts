import * as T from 'three';
import { voxelizeGpOcclusion, type GpOcclusionGrid } from '../gp-occlusion.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

interface Part {
  mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  geometry: T.BufferGeometry;
  matrix: T.Matrix4;
}

// Baked bytes live with their geometries. Disposing the last model also
// makes its data collectible, including in the showroom and replay.
const designs = new Map<string, { signature: number; bytes: WeakRef<Uint8Array>[] }>();
// Weather and local atmosphere wrap onBeforeCompile between the construction
// of two LODs. The shared alloy still owns the first hook after that wrap.
const litMaterials = new WeakSet<T.Material>();
const sampleRing = Array.from({ length: 8 }, (_, i) => {
  const angle = ((i + 0.5) * Math.PI) / 4;
  return [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8] as const;
});

/** Team colours can change the material batches. Reuse only an identical
 * ordered set of surfaces, normals and relative transforms. */
function layoutSignature(parts: readonly Part[], cell: number, reach: number) {
  let hash = 2166136261;
  const mix = (bits: number) => {
    hash = Math.imul(hash ^ bits, 16777619);
  };
  mix(Math.round(cell * 1e6));
  mix(Math.round(reach * 1e6));
  for (const { geometry, matrix } of parts) {
    for (const value of matrix.elements) mix(Math.round(value * 1e6));
    for (const name of ['position', 'normal']) {
      const values = geometry.getAttribute(name);
      if (values instanceof T.BufferAttribute && values.array instanceof Float32Array) {
        const words = new Uint32Array(
          values.array.buffer,
          values.array.byteOffset,
          values.array.length,
        );
        for (let i = 0; i < words.length; i++) mix(words[i]);
      } else {
        for (let i = 0; i < values.count; i++) {
          mix(Math.round(values.getX(i) * 1e6));
          mix(Math.round(values.getY(i) * 1e6));
          mix(Math.round(values.getZ(i) * 1e6));
        }
      }
    }
    if (geometry.index) for (const index of geometry.index.array) mix(index);
  }
  return hash;
}

/** Examine actual triangle occupancy rather than darkening creases painted
 * into a team livery. Rays start clear of their own voxelized surface. */
function bakePart(part: Part, grid: GpOcclusionGrid, reach: number) {
  const position = part.geometry.getAttribute('position'),
    normal = part.geometry.getAttribute('normal');
  const output = new Uint8Array(position.count);
  const p = new T.Vector3(),
    n = new T.Vector3(),
    t = new T.Vector3(),
    b = new T.Vector3();
  const normalMatrix = new T.Matrix3().getNormalMatrix(part.matrix);
  const [nx, ny, nz] = grid.dims,
    inv = 1 / grid.voxel;
  const stride = 0.85,
    steps = Math.ceil((reach * inv) / stride);
  // Work in cells throughout each short ray and weight nearby hits more.
  const trace = (dx: number, dy: number, dz: number) => {
    let x = p.x,
      y = p.y,
      z = p.z;
    for (let j = 1; j <= steps; j++) {
      x += dx * stride;
      y += dy * stride;
      z += dz * stride;
      const ix = Math.floor(x),
        iy = Math.floor(y),
        iz = Math.floor(z);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) break;
      if (grid.data[ix + nx * (iy + ny * iz)]) {
        const distance = (j - 1) / steps;
        return 1 - distance * distance;
      }
    }
    return 0;
  };
  for (let i = 0; i < position.count; i++) {
    n.fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix);
    p.fromBufferAttribute(position, i)
      .applyMatrix4(part.matrix)
      .sub(grid.min)
      .multiplyScalar(inv)
      .addScaledVector(n, 1.6);
    t.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0)
      .cross(n)
      .normalize();
    b.crossVectors(n, t);
    let blocked = 0.2 * trace(n.x, n.y, n.z);
    for (const [u, v] of sampleRing)
      blocked +=
        0.1 *
        trace(
          0.6 * n.x + u * t.x + v * b.x,
          0.6 * n.y + u * t.y + v * b.y,
          0.6 * n.z + u * t.z + v * b.z,
        );
    output[i] = Math.round(255 * blocked);
  }
  return output;
}

function install(material: T.MeshStandardMaterial) {
  if (litMaterials.has(material)) return;
  // Three's binding state uses these constants for meshes without this
  // attribute. A lever or wheel can share an alloy with the static frame.
  const vertexMaterial = material as T.MeshStandardMaterial & {
    defaultAttributeValues?: Record<string, number[]>;
  };
  vertexMaterial.defaultAttributeValues ??= {};
  vertexMaterial.defaultAttributeValues.mxAssemblyCavity ??= [0];
  chainShaderHook(material, 'mx-assembly-occlusion-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute float mxAssemblyCavity; varying float vMxCavity;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxCavity = mxAssemblyCavity;', 'vertex');
    injectDeclarations(shader, 'common', 'varying float vMxCavity;', 'fragment');
    injectAfter(
      shader,
      'aomap_fragment',
      /* glsl */ `
      reflectedLight.indirectDiffuse *= 1.0 - 0.82 * vMxCavity;
      float mxEnvVisibility = 1.0 - vMxCavity * mix(0.64, 0.82, material.roughness);
      reflectedLight.indirectSpecular *= mxEnvVisibility;
      #ifdef USE_CLEARCOAT
        clearcoatSpecularIndirect *= mxEnvVisibility;
      #endif
      #ifdef USE_SHEEN
        sheenSpecularIndirect *= 1.0 - 0.82 * vMxCavity;
      #endif
    `,
      'fragment',
    );
  });
  litMaterials.add(material);
}

/** A rigid assembly carries its own local sky visibility as it turns. A
 * fork, rider or brake pedal moving independently must be omitted from a
 * chassis bake. Each distinct detail mesh gets one byte per vertex, with
 * no render targets, extra draw calls or per-frame tracing. */
export function applyMxAssemblyOcclusion(
  design: string,
  root: T.Object3D,
  omit: readonly (T.Object3D | undefined)[],
  cell: number,
  reach: number,
) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const parts: Part[] = [];
  const visit = (node: T.Object3D) => {
    if (omit.includes(node) || !node.visible) return;
    if (
      node instanceof T.Mesh &&
      !(node instanceof T.InstancedMesh) &&
      !(node instanceof T.SkinnedMesh) &&
      node.material instanceof T.MeshStandardMaterial &&
      node.material.colorWrite &&
      !node.material.transparent &&
      node.geometry.hasAttribute('normal') &&
      !Object.keys(node.geometry.morphAttributes).length
    ) {
      parts.push({
        mesh: node,
        geometry: node.geometry,
        matrix: inverse.clone().multiply(node.matrixWorld),
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  if (!parts.length) return;
  const signature = layoutSignature(parts, cell, reach);
  const cached = designs.get(design);
  const prior =
    cached?.signature === signature ? cached.bytes.map((ref) => ref.deref()) : undefined;
  const hit =
    prior?.length === parts.length &&
    parts.every((part, i) => prior[i]?.length === part.geometry.getAttribute('position').count);
  const grid = hit ? undefined : voxelizeGpOcclusion(parts, cell, cell * 3);
  const refs: WeakRef<Uint8Array>[] = [];
  const attached = new Set<T.BufferGeometry>();
  for (const [i, part] of parts.entries()) {
    const data = grid ? bakePart(part, grid, reach) : prior![i]!;
    if (attached.has(part.geometry)) part.mesh.geometry = part.geometry.clone();
    attached.add(part.geometry);
    part.mesh.geometry.setAttribute('mxAssemblyCavity', new T.BufferAttribute(data, 1, true));
    install(part.mesh.material);
    refs.push(new WeakRef(data));
  }
  designs.set(design, { signature, bytes: refs });
}
