import * as T from 'three';

/** Convex rear-view approximation: two actual rear-facing camera feeds. These
 * are independent of the forward view, not a duplicated screen-space image.
 * +X is the driver's left; mirrored texture coordinates preserve handedness. */
export class MirrorViews {
  readonly cameras = [0, 1].map(() => new T.PerspectiveCamera(42, 8 / 3, 0.03, 280));
  readonly targets = [0, 1].map(() => {
    const target = new T.WebGLRenderTarget(256, 96, {
      type: T.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
    });
    target.texture.colorSpace = T.LinearSRGBColorSpace;
    target.texture.repeat.x = -1;
    target.texture.offset.x = 1;
    target.texture.generateMipmaps = false;
    return target;
  });
  private materials = this.targets.map(
    (t) => new T.MeshBasicMaterial({ map: t.texture, color: 0xd4dde0 }),
  );
  private surfaces: T.Mesh[] = [];
  private originals: (T.Material | T.Material[])[] = [];
  private visible: boolean[] = [];
  private direction = new T.Vector3();
  private quaternion = new T.Quaternion();
  private viewport = new T.Vector4();
  private scissor = new T.Vector4();
  private clock = Infinity;
  private period = 1 / 15;
  updates = 0;
  passes = 0;

  bind(surfaces: readonly T.Mesh[]) {
    if (surfaces.length !== 2) throw new Error('Two mirror surfaces are required');
    this.unbind();
    this.surfaces = [...surfaces];
    this.originals = surfaces.map((s) => s.material);
    this.visible = [true, true];
    surfaces.forEach((s, i) => {
      s.material = this.materials[i];
    });
    this.clock = Infinity;
  }
  private unbind() {
    this.surfaces.forEach((s, i) => {
      s.material = this.originals[i];
    });
    this.surfaces = [];
    this.originals = [];
  }
  quality(value: 'low' | 'medium' | 'high') {
    const width = value === 'high' ? 512 : value === 'medium' ? 256 : 128;
    this.period = 1 / (value === 'high' ? 30 : value === 'medium' ? 15 : 10);
    this.targets.forEach((t) => t.setSize(width, (width * 3) / 8));
    this.clock = Infinity;
  }
  orient(root: T.Object3D) {
    root.updateWorldMatrix(true, true);
    root.getWorldQuaternion(this.quaternion);
    this.surfaces.forEach((s, i) => {
      const c = this.cameras[i];
      s.getWorldPosition(c.position);
      // The near plane clears the housing. A modest outward toe includes the
      // adjacent lane while keeping the rearward horizon readable.
      this.direction.set(i === 0 ? -0.16 : 0.16, 0.015, -1).applyQuaternion(this.quaternion);
      c.up.set(0, 1, 0).applyQuaternion(this.quaternion);
      c.lookAt(this.direction.add(c.position));
      c.updateMatrixWorld();
    });
  }
  render(renderer: T.WebGLRenderer, scene: T.Scene, root: T.Object3D, dt: number) {
    this.passes = 0;
    if (this.surfaces.length !== 2 || !root.visible) return;
    this.clock += dt;
    if (this.clock < this.period) return;
    this.clock = 0;
    this.orient(root);
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    renderer.getViewport(this.viewport);
    renderer.getScissor(this.scissor);
    const scissorTest = renderer.getScissorTest();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowNeeded = renderer.shadowMap.needsUpdate;
    this.surfaces.forEach((s, i) => {
      this.visible[i] = s.visible;
      s.visible = false;
    });
    // Hide both mirror planes for both passes: no texture feedback or recursion.
    // Reuse the main-view shadow map rather than rendering it twice more.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try {
      for (let i = 0; i < 2; i++) {
        renderer.setRenderTarget(this.targets[i]);
        renderer.setScissorTest(false);
        renderer.clear();
        renderer.render(scene, this.cameras[i]);
        this.passes++;
      }
      this.updates++;
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.setViewport(this.viewport);
      renderer.setScissor(this.scissor);
      renderer.setScissorTest(scissorTest);
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowNeeded;
      this.surfaces.forEach((s, i) => {
        s.visible = this.visible[i];
      });
    }
  }
  dispose() {
    this.unbind();
    this.materials.forEach((m) => m.dispose());
    this.targets.forEach((t) => t.dispose());
  }
}
