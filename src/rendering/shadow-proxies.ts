import * as T from 'three';

/** Depth side three's shadow pass renders for a material side (the default
 * shadowSide mapping of WebGLShadowMap). */
const SHADOW_SIDE: Record<T.Side, T.Side> = {
  [T.FrontSide]: T.BackSide,
  [T.BackSide]: T.FrontSide,
  [T.DoubleSide]: T.DoubleSide,
};

/** True when three's shadow pass draws `mesh` with its plain depth material,
 * so merged positions reproduce its shadow exactly: no skinning, instancing,
 * morphing, custom depth, alpha test, displacement, clipping, partial draw
 * range, per-shadow hook or CPU-animated vertices. */
export function plainShadowCaster(mesh: T.Object3D): mesh is T.Mesh {
  if (!(mesh instanceof T.Mesh) || !mesh.castShadow || !mesh.visible) return false;
  if (mesh instanceof T.SkinnedMesh || mesh instanceof T.InstancedMesh) return false;
  if (mesh instanceof T.BatchedMesh) return false;
  const material = mesh.material;
  if (Array.isArray(material) || !material.visible || material.wireframe) return false;
  if (mesh.customDepthMaterial || mesh.onBeforeShadow !== T.Object3D.prototype.onBeforeShadow)
    return false;
  if (material.alphaTest > 0 || material.alphaToCoverage || material.clipShadows) return false;
  const standard = material as T.MeshStandardMaterial;
  if (standard.displacementMap && standard.displacementScale !== 0) return false;
  const geometry = mesh.geometry,
    position = geometry.getAttribute('position');
  if (!position || position instanceof T.InterleavedBufferAttribute) return false;
  if (position.usage !== T.StaticDrawUsage) return false;
  if (Object.keys(geometry.morphAttributes).length) return false;
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return false;
  return true;
}

export function shadowSideOf(material: T.Material) {
  return material.shadowSide ?? SHADOW_SIDE[material.side];
}

const local = new T.Matrix4(),
  point = new T.Vector3();

/** Positions and triangles of `meshes` in the frame of `frame`. */
function mergePositions(frame: T.Object3D, meshes: readonly T.Mesh[]) {
  let vertices = 0,
    indices = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    vertices += position.count;
    indices += mesh.geometry.index?.count ?? position.count;
  }
  const positions = new Float32Array(vertices * 3);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0,
    k = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position'),
      source = mesh.geometry.index;
    if (mesh === frame) local.identity();
    else {
      if (mesh.matrixAutoUpdate) mesh.updateMatrix();
      local.copy(mesh.matrix);
    }
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(local);
      positions[(v + i) * 3] = point.x;
      positions[(v + i) * 3 + 1] = point.y;
      positions[(v + i) * 3 + 2] = point.z;
    }
    if (source) for (let i = 0; i < source.count; i++) index[k++] = v + source.getX(i);
    else for (let i = 0; i < position.count; i++) index[k++] = v + i;
    v += position.count;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setIndex(new T.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** One depth-only caster per rigid frame and shadow side, replacing the
 * frame's per-material shadow draws. A frame's own mesh (if any) and its
 * direct mesh children merge; their transforms relative to the frame must
 * not change afterwards (batched bodywork, wheel carriers, rims, wings).
 * Sources stop casting and keep receiving, so self-shadowing is unchanged;
 * the casters are the same triangles, so the shadow map is too.
 *
 * Casters stay hidden except inside the shadow pass (see `install`), so they
 * never cost a draw in any camera view. */
export class ShadowProxies {
  private readonly casters: T.Mesh[] = [];
  private readonly sources = new Map<T.Mesh, T.Mesh[]>();
  private renderer: T.WebGLRenderer | null = null;
  private original: T.WebGLShadowMap['render'] | null = null;
  get count() {
    return this.casters.length;
  }
  /** Merge the plain casters of each frame; returns the casters created. */
  add(...frames: T.Object3D[]) {
    const created: T.Mesh[] = [];
    for (const frame of frames) {
      const bySide = new Map<T.Side, T.Mesh[]>();
      const candidates = [frame, ...frame.children];
      for (const object of candidates) {
        if (!plainShadowCaster(object)) continue;
        const side = shadowSideOf(object.material as T.Material);
        const list = bySide.get(side);
        if (list) list.push(object);
        else bySide.set(side, [object]);
      }
      for (const [side, meshes] of bySide) {
        // A single draw gains nothing.
        if (meshes.length < 2) continue;
        const material = new T.MeshBasicMaterial({ colorWrite: false });
        material.shadowSide = side;
        const caster = new T.Mesh(mergePositions(frame, meshes), material);
        caster.name = 'Shadow caster (depth only)';
        caster.castShadow = true;
        caster.receiveShadow = false;
        caster.visible = false;
        caster.matrixAutoUpdate = false;
        caster.updateMatrix();
        frame.add(caster);
        for (const mesh of meshes) mesh.castShadow = false;
        this.casters.push(caster);
        this.sources.set(caster, meshes);
        created.push(caster);
      }
    }
    return created;
  }
  /** Run `render` with every caster shown (shadow passes and the shadow census). */
  withCasters<R>(render: () => R): R {
    for (const caster of this.casters) caster.visible = true;
    try {
      return render();
    } finally {
      for (const caster of this.casters) caster.visible = false;
    }
  }
  /** Show the casters only while `renderer` renders shadow maps. WebGLRenderer
   * builds its view's draw list before it renders shadows, so the casters are
   * never in a view's draw list. */
  install(renderer: T.WebGLRenderer) {
    if (this.renderer) throw new Error('Shadow casters already installed');
    const shadowMap = renderer.shadowMap,
      original = shadowMap.render;
    this.renderer = renderer;
    this.original = original;
    shadowMap.render = (lights, scene, camera) =>
      this.withCasters(() => original.call(shadowMap, lights, scene, camera));
  }
  /** Remove the casters made for frames under `root`, restoring their sources. */
  remove(root: T.Object3D) {
    for (let i = this.casters.length - 1; i >= 0; i--) {
      const caster = this.casters[i];
      let under = false;
      for (let o: T.Object3D | null = caster; o; o = o.parent) if (o === root) under = true;
      if (!under) continue;
      for (const mesh of this.sources.get(caster)!) mesh.castShadow = true;
      caster.removeFromParent();
      caster.geometry.dispose();
      (caster.material as T.Material).dispose();
      this.sources.delete(caster);
      this.casters.splice(i, 1);
    }
  }
  dispose() {
    if (this.renderer && this.original) this.renderer.shadowMap.render = this.original;
    this.renderer = null;
    this.original = null;
    for (const caster of [...this.casters]) this.remove(caster);
  }
}
