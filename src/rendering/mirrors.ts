import * as T from 'three';

/** Preparation borrows the exact upcoming feeds without consuming cadence. */
export interface MirrorRenderPlan {
  readonly owner: MirrorViews;
  readonly root: T.Object3D;
  readonly version: number;
  readonly dt: number;
  readonly mask: number;
  readonly cameras: readonly T.PerspectiveCamera[];
  readonly hiddenRoots: readonly T.Object3D[];
  readonly rootMatrix: readonly number[] | null;
  readonly detail: MirrorViews['detail'];
  readonly detailBefore: ((camera: T.PerspectiveCamera, height: number) => void) | undefined;
  readonly detailAfter: (() => void) | undefined;
}

/** Convex rear-view approximation: two actual rear-facing camera feeds. These
 * are independent of the forward view, not a duplicated screen-space image.
 * +X is the driver's left; mirrored texture coordinates preserve handedness. */
export class MirrorViews {
  readonly cameras = [0, 1].map(() => new T.PerspectiveCamera(42, 8 / 3, 0.03, 280));
  readonly targets = [0, 1].map(() => {
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
  });
  private materials = this.targets.map(
    (t) => new T.MeshBasicMaterial({ map: t.texture, color: 0xeef2f4 }),
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
  /** The feed refreshed by the next steady-state update. */
  private next = 0;
  private version = 0;
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
    this.version++;
  }
  bind(surfaces: readonly T.Mesh[]) {
    if (surfaces.length !== 2) throw new Error('Two mirror surfaces are required');
    this.unbind();
    this.surfaces = [...surfaces];
    this.originals = surfaces.map((s) => s.material);
    this.visible = [true, true];
    surfaces.forEach((s, i) => {
      s.material = this.materials[i];
    });
    this.invalidate();
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
    this.invalidate();
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
  private scheduled(dt: number) {
    const clock = this.clock + dt;
    return clock === Infinity ? 3 : clock < this.period / 2 ? 0 : 1 << this.next;
  }
  prepare(root: T.Object3D, dt: number): MirrorRenderPlan | null {
    if (this.surfaces.length !== 2 || !root.visible) return null;
    const mask = this.scheduled(dt);
    if (mask) this.orient(root);
    return Object.freeze({
      owner: this,
      root,
      version: this.version,
      dt,
      mask,
      cameras: Object.freeze(this.cameras.filter((_, i) => mask & (1 << i))),
      hiddenRoots: Object.freeze([...this.surfaces, ...this.exclusions]),
      rootMatrix: mask ? Object.freeze(root.matrixWorld.elements.slice()) : null,
      detail: this.detail,
      detailBefore: this.detail?.before,
      detailAfter: this.detail?.after,
    });
  }
  render(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    root: T.Object3D,
    dt: number,
    plan?: MirrorRenderPlan | null,
  ) {
    this.passes = 0;
    if (this.surfaces.length !== 2 || !root.visible) return;
    if (
      plan &&
      (plan.owner !== this ||
        plan.root !== root ||
        plan.version !== this.version ||
        plan.dt !== dt ||
        plan.detail !== this.detail ||
        plan.detailBefore !== this.detail?.before ||
        plan.detailAfter !== this.detail?.after ||
        plan.hiddenRoots.length !== this.surfaces.length + this.exclusions.length ||
        plan.hiddenRoots.some(
          (root, i) =>
            root !==
            (i < this.surfaces.length
              ? this.surfaces[i]
              : this.exclusions[i - this.surfaces.length]),
        ))
    )
      throw new Error('Stale mirror preparation plan');
    const mask = plan?.mask ?? this.scheduled(dt);
    if (plan && mask) {
      // Preparation is an exact-pose lease, not permission to reuse a stream
      // after a caller moved its subject. orient updates stale matrix flags too.
      this.orient(root);
      if (
        !plan.rootMatrix ||
        root.matrixWorld.elements.some((value, i) => value !== plan.rootMatrix![i])
      )
        throw new Error('Stale mirror preparation pose');
    }
    this.version++;
    this.clock += dt;
    // After a discontinuity both feeds refresh at once. Otherwise the feeds
    // alternate every half period: each keeps the quality's refresh rate, and
    // one mirror pass per update spreads the cost evenly over frames instead
    // of doubling it on every other frame.
    const both = mask === 3;
    if (!mask) return;
    this.clock = 0;
    // Ordinary frames keep their original pose update with no plan snapshots.
    if (!plan) this.orient(root);
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
      for (let i = 0; i < 2; i++) {
        if (!(mask & (1 << i))) continue;
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
      if (!both) this.next = 1 - this.next;
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
