import * as T from 'three';

/** Convex rear-view approximation: two actual rear-facing camera feeds. These
 * are independent of the forward view, not a duplicated screen-space image.
 * +X is the driver's left; mirrored texture coordinates preserve handedness. */
export class MirrorViews {
  readonly cameras = [0, 1].map(() => new T.PerspectiveCamera(42, 8 / 3, 0.03, 280));
  private static makeTarget() {
    // Half-float keeps the mirrored scene in the same linear HDR range as
    // the main view, which tone-maps it once at output. An 8-bit target
    // clipped floodlit or sunlit scenery to flat white rectangles.
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
  }
  readonly targets = [MirrorViews.makeTarget(), MirrorViews.makeTarget()];
  private materials = this.targets.map(
    (t) => new T.MeshBasicMaterial({ map: t.texture, color: 0xeef2f4 }),
  );
  private surfaces: T.Mesh[] = [];
  private readonly local = new T.Vector3();
  private readonly virtualEye = new T.Vector3();
  private readonly inverse = new T.Quaternion();
  private originals: (T.Material | T.Material[])[] = [];
  private visible: boolean[] = [];
  private direction = new T.Vector3();
  private quaternion = new T.Quaternion();
  private readonly faceRotation = new T.Quaternion();
  private readonly normal = new T.Vector3();
  private viewport = new T.Vector4();
  private scissor = new T.Vector4();
  private clock = Infinity;
  private period = 1 / 15;
  /** The feed refreshed by the next steady-state update. */
  private next = 0;
  updates = 0;
  passes = 0;
  /** Roots hidden during both mirror passes (restored afterwards). */
  exclusions: T.Object3D[] = [];
  /** Per-pass representation choice for what a feed shows (restored by
   * `after` even when a pass throws). */
  detail: {
    before(camera: T.PerspectiveCamera, height: number): void;
    after(): void;
  } | null = null;
  private exclusionVisibility: boolean[] = [];

  invalidate() {
    this.clock = Infinity;
  }
  bind(surfaces: readonly T.Mesh[]) {
    if (surfaces.length < 2 || surfaces.length > 3)
      throw new Error('Expected two wing mirrors and an optional interior mirror');
    if (surfaces.length === 3 && this.targets.length === 2) {
      const target = MirrorViews.makeTarget();
      this.targets.push(target);
      this.materials.push(new T.MeshBasicMaterial({ map: target.texture, color: 0xeef2f4 }));
      this.cameras.push(new T.PerspectiveCamera(42, 1, 0.03, 280));
    }
    this.unbind();
    this.surfaces = [...surfaces];
    this.originals = surfaces.map((s) => s.material);
    this.visible = surfaces.map(() => true);
    this.next = 0;
    surfaces.forEach((s, i) => {
      s.material = this.materials[i];
      this.cameras[i].aspect = s.userData.opticalRearViewAspect ?? 8 / 3;
      this.cameras[i].near = 0.03;
      this.cameras[i].updateProjectionMatrix();
      this.resizeFeed(i, this.targets[0].width);
    });
    this.clock = Infinity;
  }
  unbind() {
    this.surfaces.forEach((s, i) => {
      s.material = this.originals[i];
    });
    this.surfaces = [];
    this.originals = [];
  }
  private resizeFeed(i: number, width: number) {
    const aspect = this.surfaces[i]?.userData.opticalRearViewAspect ?? 8 / 3;
    this.targets[i].setSize(width, Math.max(1, Math.round(width / aspect)));
  }
  quality(value: 'low' | 'medium' | 'high') {
    const width = value === 'high' ? 512 : value === 'medium' ? 256 : 128;
    this.period = 1 / (value === 'high' ? 30 : value === 'medium' ? 15 : 10);
    this.targets.forEach((_, i) => this.resizeFeed(i, width));
    this.clock = Infinity;
  }
  orient(root: T.Object3D, eye?: T.Vector3) {
    root.getWorldQuaternion(this.quaternion);
    this.surfaces.forEach((s, i) => {
      const c = this.cameras[i];
      // The near plane clears the housing. A modest outward toe includes the
      // adjacent lane while keeping the rearward horizon readable.
      if (eye && s.userData.opticalRearViewAspect) {
        s.getWorldQuaternion(this.faceRotation);
        c.position.setFromMatrixPosition(s.matrixWorld);
        this.normal.set(0, 0, -1).applyQuaternion(this.faceRotation);
        const plane = s.userData.planeSize as readonly [number, number] | undefined;
        if (plane) {
          // A flat windscreen mirror is a window from the reflected eye. Project
          // its four real edges at the glass and clip everything in front of it.
          const offset = this.local.subVectors(eye, c.position).dot(this.normal);
          this.virtualEye.copy(eye).addScaledVector(this.normal, -2 * offset);
          this.local
            .subVectors(c.position, this.virtualEye)
            .applyQuaternion(this.inverse.copy(this.faceRotation).invert());
          const depth = Math.max(0.015, -this.local.z);
          c.position.copy(this.virtualEye);
          c.quaternion.copy(this.faceRotation);
          c.near = depth + 0.002;
          const scale = c.near / depth;
          c.projectionMatrix.makePerspective(
            (this.local.x - plane[0] / 2) * scale,
            (this.local.x + plane[0] / 2) * scale,
            (this.local.y + plane[1] / 2) * scale,
            (this.local.y - plane[1] / 2) * scale,
            c.near,
            c.far,
          );
          c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
          c.updateMatrixWorld();
          return;
        }
        this.direction.subVectors(c.position, eye).normalize().reflect(this.normal);
        c.up.set(0, 1, 0).applyQuaternion(this.faceRotation);
      } else {
        s.getWorldPosition(c.position);
        this.direction.set(i === 0 ? -0.16 : 0.16, 0.015, -1).applyQuaternion(this.quaternion);
        c.up.set(0, 1, 0).applyQuaternion(this.quaternion);
      }
      c.lookAt(this.direction.add(c.position));
      c.updateMatrixWorld();
    });
  }
  render(renderer: T.WebGLRenderer, scene: T.Scene, root: T.Object3D, dt: number, eye?: T.Vector3) {
    this.passes = 0;
    const count = this.surfaces.length;
    if (count < 2 || !root.visible) return;
    this.clock += dt;
    // After a discontinuity both feeds refresh at once. Otherwise the feeds
    // rotate through the fitted panes: each keeps the quality's refresh rate, and
    // one mirror pass per update spreads the cost evenly over frames instead
    // of doubling it on every other frame.
    const both = this.clock === Infinity;
    if (!both && this.clock < this.period / count) return;
    this.clock = 0;
    this.orient(root, eye);
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
    this.exclusionVisibility.length = 0;
    for (const root of this.exclusions) {
      this.exclusionVisibility.push(root.visible);
      root.visible = false;
    }
    // Hide both mirror planes for both passes: no texture feedback or recursion.
    // Reuse the main-view shadow map rather than rendering it twice more.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try {
      for (let k = 0; k < (both ? count : 1); k++) {
        const i = both ? k : this.next;
        renderer.setRenderTarget(this.targets[i]);
        renderer.setScissorTest(false);
        renderer.clear();
        this.detail?.before(this.cameras[i], this.targets[i].height);
        try {
          renderer.render(scene, this.cameras[i]);
        } finally {
          this.detail?.after();
        }
        this.passes++;
      }
      if (!both) this.next = (this.next + 1) % count;
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
      this.exclusions.forEach((root, i) => {
        if (i < this.exclusionVisibility.length) root.visible = this.exclusionVisibility[i];
      });
    }
  }
  dispose() {
    this.unbind();
    this.materials.forEach((m) => m.dispose());
    this.targets.forEach((t) => t.dispose());
  }
}
