import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { pbrVertexShader } from '@babylonjs/core/Shaders/pbr.vertex.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Preserve the original Three projection * (view * world-position) grouping.
 * This exact ordinary branch precedes clip-dependent/log-depth shader work. */
export const A09_CLIP_ORDER_ANCHOR = '#else\ngl_Position=viewProjection*worldPos;\n#endif';
const replacementPoint = '!' + A09_CLIP_ORDER_ANCHOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function assertA09ClipOrderShaderAnchors(source = pbrVertexShader.shader) {
  if (ShaderStore.ShadersStore[pbrVertexShader.name] !== pbrVertexShader.shader)
    throw new Error('A09 clip order: global vertex shader replaced');
  for (const anchor of [A09_CLIP_ORDER_ANCHOR, '#define CUSTOM_VERTEX_DEFINITIONS'])
    if (source.split(anchor).length !== 2)
      throw new Error('A09 clip order: pinned vertex shader anchor changed');
  if (!source.includes('#ifdef MULTIVIEW\nif (gl_ViewID_OVR==0u)'))
    throw new Error('A09 clip order: pinned ordinary projection branch changed');
}

/** Component-local adaptation, not a global camera/shader policy. Both native
 * UBO and standalone materials use these two explicit ordinary uniforms. */
export class A09ClipOrderPlugin extends MaterialPluginBase {
  private dead = false;
  private readonly owned = new Map<Mesh, Mesh['geometry']>();
  constructor(private readonly material: PBRMaterial) {
    assertA09ClipOrderShaderAnchors();
    if (material.shaderLanguage !== 0)
      throw new Error('A09 clip order: only the original GLSL path is supported');
    super(material, 'OriginalA09ClipOrder', 190, { ORIGINAL_A09_CLIP_ORDER: true }, true, false);
    this.registerForExtraEvents = true;
    this.doNotSerialize = true;
    this._enable(true);
  }
  getClassName() {
    return 'A09ClipOrderPlugin';
  }
  get isValid() {
    return !this.dead;
  }
  registerOwnedMesh(mesh: Mesh) {
    if (this.dead || this.owned.has(mesh))
      throw new Error('A09 clip order: invalid mesh registration');
    this.validateMesh(mesh, false);
    this.owned.set(mesh, mesh.geometry);
  }
  private validateMesh(mesh: Mesh, registered = true) {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (
      this.dead ||
      !(mesh instanceof Mesh) ||
      this.material.shaderLanguage !== 0 ||
      this.material.pluginManager?.getPlugin('OriginalA09ClipOrder') !== this ||
      this.material.getScene().isDisposed ||
      mesh.isDisposed() ||
      mesh.getScene() !== this.material.getScene() ||
      mesh.material !== this.material ||
      !mesh.geometry ||
      mesh.geometry.isDisposed() ||
      mesh.parent !== null ||
      !mesh.isWorldMatrixFrozen ||
      mesh.worldMatrixFromCache.m.some((v, i) => v !== identity[i]) ||
      mesh.hasInstances ||
      mesh.hasThinInstances ||
      mesh.skeleton ||
      mesh.morphTargetManager ||
      (registered && (!this.owned.has(mesh) || this.owned.get(mesh) !== mesh.geometry))
    )
      throw new Error('A09 clip order: unsupported or invalidated owned identity-world mesh');
  }
  prepareDefines(defines: MaterialDefines, scene: Scene, mesh: Mesh) {
    this.validateMesh(mesh);
    const variant = defines as MaterialDefines & {
      MULTIVIEW?: boolean;
      INSTANCES?: boolean;
      THIN_INSTANCES?: boolean;
      NUM_BONE_INFLUENCERS?: number;
      NUM_MORPH_INFLUENCERS?: number;
    };
    if (
      scene !== this.material.getScene() ||
      variant.MULTIVIEW ||
      variant.INSTANCES ||
      variant.THIN_INSTANCES ||
      (variant.NUM_BONE_INFLUENCERS ?? 0) !== 0 ||
      (variant.NUM_MORPH_INFLUENCERS ?? 0) !== 0
    )
      throw new Error('A09 clip order: unsupported scene or shader variant');
  }
  isReadyForSubMesh(
    defines: MaterialDefines,
    scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ) {
    this.prepareDefines(defines, scene, subMesh.getMesh() as Mesh);
    return true;
  }
  getUniforms() {
    return { externalUniforms: ['a09OriginalView', 'a09OriginalProjection'] };
  }
  hardBindForSubMesh(
    _buffer: UniformBuffer,
    scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ) {
    const mesh = subMesh.getMesh();
    if (
      !(mesh instanceof Mesh) ||
      subMesh.getRenderingMesh() !== mesh ||
      scene !== this.material.getScene() ||
      !scene.activeCamera ||
      scene.activeCamera.cameraRigMode !== 0 ||
      scene.activeCamera.isRigCamera ||
      !subMesh.effect
    )
      throw new Error('A09 clip order: unsupported draw ownership or camera');
    this.validateMesh(mesh);
    subMesh.effect.setMatrix('a09OriginalView', scene.getViewMatrix());
    subMesh.effect.setMatrix('a09OriginalProjection', scene.getProjectionMatrix());
  }
  getCustomCode(type: string) {
    if (type !== 'vertex') return null;
    assertA09ClipOrderShaderAnchors();
    return {
      CUSTOM_VERTEX_DEFINITIONS:
        'uniform mat4 a09OriginalView; uniform mat4 a09OriginalProjection;',
      [replacementPoint]:
        '#else\ngl_Position=a09OriginalProjection*(a09OriginalView*worldPos);\n#endif',
    };
  }
  invalidate() {
    this.dead = true;
    // Plugin manager can register this object and then throw during super(),
    // before subclass fields initialize. Material teardown must still finish.
    this.owned?.clear();
  }
  dispose() {
    this.invalidate();
  }
}
