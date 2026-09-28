import * as T from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

// Layer 0 is the ordinary scene; layer 1 is reserved for studio reflections.
// This layer is enabled on selected meshes only during the depth submission.
const PLAYER_DEPTH_LAYER = 2;

/** Only surfaces whose ordinary pass unconditionally writes the same depth can
 * occlude later shading. Cutouts, transmission, custom displacement, invisible
 * materials and alternate depth/stencil policies must remain on the old path. */
export function canPrimePlayerDepth(mesh: T.Mesh): boolean {
  const m = mesh.material;
  return (
    m instanceof T.MeshStandardMaterial &&
    m.visible &&
    !m.transparent &&
    m.opacity === 1 &&
    m.colorWrite &&
    m.depthTest &&
    m.depthWrite &&
    m.depthFunc === T.LessEqualDepth &&
    m.side === T.DoubleSide &&
    m.alphaTest === 0 &&
    !m.alphaHash &&
    !m.alphaToCoverage &&
    !m.alphaMap &&
    !m.displacementMap &&
    !m.polygonOffset &&
    !m.stencilWrite &&
    !m.clippingPlanes?.length &&
    !(m instanceof T.MeshPhysicalMaterial && m.transmission > 0) &&
    !(m.vertexColors && mesh.geometry.getAttribute('color')?.itemSize === 4) &&
    !mesh.customDepthMaterial &&
    mesh.onBeforeRender === T.Object3D.prototype.onBeforeRender &&
    mesh.onAfterRender === T.Object3D.prototype.onAfterRender
  );
}

/** Prime only the imported player's opaque depth, using its actual current
 * geometry, skeleton and morphs. No cloned model, alternate pose, colour target
 * or source material is created. All temporary renderer/scene/layer state is
 * restored even when submission throws. The owner clears the target first. */
export class PlayerDepthPrepass {
  private meshes: { mesh: T.Mesh; mask: number }[] = [];
  private registered = new Set<T.Mesh>();
  private material = new T.MeshDepthMaterial({ side: T.DoubleSide });
  private disposed = false;
  eligibleMeshes = 0;
  constructor() {
    this.material.name = 'Supplied player opaque depth';
    this.material.colorWrite = false;
  }
  register(root: T.Object3D) {
    if (this.disposed) return;
    root.traverse((object) => {
      if (!(object instanceof T.Mesh) || this.registered.has(object)) return;
      this.registered.add(object);
      this.meshes.push({ mesh: object, mask: object.layers.mask });
    });
  }
  get size() {
    return this.meshes.length;
  }
  render(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera) {
    this.eligibleMeshes = 0;
    if (this.disposed || !this.size || scene.overrideMaterial) return;
    const cameraMask = camera.layers.mask,
      background = scene.background,
      override = scene.overrideMaterial,
      autoClear = renderer.autoClear,
      shadowAuto = renderer.shadowMap.autoUpdate,
      shadowNeeded = renderer.shadowMap.needsUpdate;
    // Save each invocation's mask, not its registration-time value: photo and
    // inspection tools may legitimately change a mesh's ordinary visibility.
    for (const entry of this.meshes) {
      entry.mask = entry.mesh.layers.mask;
      if (entry.mesh.layers.test(camera.layers) && canPrimePlayerDepth(entry.mesh)) {
        entry.mesh.layers.enable(PLAYER_DEPTH_LAYER);
        this.eligibleMeshes++;
      } else entry.mesh.layers.disable(PLAYER_DEPTH_LAYER);
    }
    try {
      if (!this.eligibleMeshes) return;
      camera.layers.set(PLAYER_DEPTH_LAYER);
      scene.background = null;
      scene.overrideMaterial = this.material;
      renderer.autoClear = false;
      // Main colour rendering retains responsibility for the normal shadow
      // update. A depth-only submission must not redraw the whole shadow map.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.render(scene, camera);
    } finally {
      for (const entry of this.meshes) entry.mesh.layers.mask = entry.mask;
      camera.layers.mask = cameraMask;
      scene.background = background;
      scene.overrideMaterial = override;
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowNeeded;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.material.dispose();
    this.meshes.length = 0;
    this.registered.clear();
    this.eligibleMeshes = 0;
  }
}

/** The normal scene pass with one optional opaque player depth submission.
 * Preserve the existing RenderPass path for overrides, masks and unusual clear
 * policies. Background colours can force a colour clear inside Three.js, so
 * autoClearDepth must remain false until the colour submission completes. */
export class PlayerScenePass extends RenderPass {
  readonly playerDepth = new PlayerDepthPrepass();
  depthEnabled = true;
  override render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    if (
      !this.depthEnabled ||
      !this.playerDepth.size ||
      !this.clear ||
      !renderer.autoClearDepth ||
      maskActive ||
      this.clearDepth ||
      this.clearColor !== null ||
      this.clearAlpha !== null ||
      this.overrideMaterial ||
      this.scene.overrideMaterial
    ) {
      this.playerDepth.eligibleMeshes = 0;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    const autoClear = renderer.autoClear,
      autoClearDepth = renderer.autoClearDepth,
      clear = this.clear;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      renderer.clear(renderer.autoClearColor, autoClearDepth, renderer.autoClearStencil);
      this.playerDepth.render(renderer, this.scene, this.camera);
      renderer.autoClearDepth = false;
      this.clear = false;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.autoClear = autoClear;
      renderer.autoClearDepth = autoClearDepth;
      this.clear = clear;
    }
  }
  override dispose() {
    this.playerDepth.dispose();
  }
}
