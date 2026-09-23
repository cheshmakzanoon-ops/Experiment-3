import * as T from 'three';
import { MirrorViews } from './mirrors.ts';
import { STUDIO_REFLECTION_LAYER } from './photo-stage.ts';

/** Coordinates recursive render passes. Mirrors render actual rear-facing camera feeds, and are hidden during other mirror/probe passes to prevent cycles. */
export class ReflectionSystem {
  private views = new MirrorViews();
  private surfaces: T.Mesh[] = [];
  get mirrorUpdates() {
    return this.views.updates;
  }
  get mirrorWidth() {
    return this.views.targets[0].width;
  }
  get mirrors() {
    return this.surfaces;
  }
  probeUpdates = 0;
  private activePass = false;
  private clock = NaN;
  private enabled = false;
  private lastProbe = -Infinity;
  // Alternate completed targets: a scene never samples the cubemap into which
  // it is currently rendering. Material programs stay stable between captures.
  private cubeTargets = [0, 1].map(
    () =>
      new T.WebGLCubeRenderTarget(128, {
        type: T.HalfFloatType,
        generateMipmaps: true,
        minFilter: T.LinearMipmapLinearFilter,
      }),
  );
  private cubes = this.cubeTargets.map((target) => {
    const camera = new T.CubeCamera(0.1, 1600, target);
    // CubeCamera's six face cameras share this Layers object. Preserve layer 0
    // scenery and include lighting cards without exposing them to driving views.
    camera.layers.enable(STUDIO_REFLECTION_LAYER);
    return camera;
  });
  private nextTarget = 0;
  private originalMaps = new Map<T.MeshStandardMaterial, T.Texture | null>();
  private probeActive = false;
  get localProbeActive() {
    return this.probeActive;
  }
  private restoreEnvironment() {
    for (const [material, texture] of this.originalMaps) {
      material.envMap = texture;
      material.needsUpdate = true;
    }
    this.originalMaps.clear();
    this.probeActive = false;
    this.lastProbe = -Infinity;
  }
  attachMirrors(surfaces: readonly T.Mesh[]) {
    this.surfaces = [...surfaces];
    this.views.bind(surfaces);
  }
  quality(value: 'low' | 'medium' | 'high') {
    this.views.quality(value);
  }
  /** A seek invalidates captured scenery without rebuilding material programs.
   * Otherwise a probe from a later lap can remain installed until replay time
   * catches its old timestamp, and mirrors can briefly show the old position. */
  invalidate() {
    this.lastProbe = -Infinity;
    this.views.invalidate();
  }
  beginFrame(time: number, cockpit: boolean) {
    if (!Number.isFinite(time)) throw new Error('Invalid reflection presentation time');
    if (
      !Number.isFinite(this.clock) ||
      time < this.clock ||
      time - this.clock > 2 ||
      cockpit !== this.enabled
    )
      this.invalidate();
    this.clock = time;
    this.enabled = cockpit;
    for (const mirror of this.mirrors) mirror.visible = cockpit;
  }
  renderMirrors(renderer: T.WebGLRenderer, scene: T.Scene, root: T.Object3D, dt: number) {
    if (this.enabled && !this.activePass) this.views.render(renderer, scene, root, dt);
  }
  updateProbe(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    car: T.Object3D,
    materials: readonly T.MeshStandardMaterial[],
    high: boolean,
    intervalSeconds = 1.5,
  ) {
    if (!high) {
      if (this.probeActive) this.restoreEnvironment();
      return;
    }
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0.25 || intervalSeconds > 5)
      throw new Error('Invalid reflection probe interval');
    if (this.activePass || this.clock - this.lastProbe < intervalSeconds) return;
    const cube = this.cubes[this.nextTarget];
    const visible = car.visible;
    const mirrorVisibility = this.mirrors.map((m) => m.visible);
    const shadows = renderer.shadowMap.autoUpdate;
    const target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const mip = renderer.getActiveMipmapLevel();
    const viewport = renderer.getViewport(new T.Vector4());
    const scissor = renderer.getScissor(new T.Vector4());
    const scissorTest = renderer.getScissorTest();
    const xr = renderer.xr.enabled;
    this.activePass = true;
    try {
      this.mirrors.forEach((mirror) => {
        mirror.visible = false;
      });
      car.visible = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setScissorTest(false);
      cube.position.copy(car.position);
      cube.position.y += 1.5;
      cube.update(renderer, scene);
      this.probeUpdates++;
      this.lastProbe = this.clock;
    } finally {
      car.visible = visible;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.xr.enabled = xr;
      renderer.setRenderTarget(target, face, mip);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      this.mirrors.forEach((mirror, i) => {
        mirror.visible = mirrorVisibility[i];
      });
      this.activePass = false;
    }
    // Publish only a completed six-face capture. A thrown GPU pass leaves the
    // last complete reflection and all renderer ownership untouched.
    const texture = this.cubeTargets[this.nextTarget].texture;
    for (const material of materials) {
      if (!this.originalMaps.has(material)) {
        this.originalMaps.set(material, material.envMap);
        material.needsUpdate = true;
      }
      material.envMap = texture;
    }
    this.probeActive = true;
    this.nextTarget = 1 - this.nextTarget;
  }
  diagnostics(renderer: T.WebGLRenderer) {
    return this.mirrors.map((mirror, i) => {
      const target = this.views.targets[i];
      const width = Math.min(48, target.width),
        height = Math.min(32, target.height);
      const pixels = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(
        target,
        Math.floor((target.width - width) / 2),
        Math.floor((target.height - height) / 2),
        width,
        height,
        pixels,
      );
      let min = 255,
        max = 0,
        hash = 2166136261;
      for (let i = 0; i < pixels.length; i++) {
        if (i % 4 === 3) continue;
        min = Math.min(min, pixels[i]);
        max = Math.max(max, pixels[i]);
        hash = Math.imul(hash ^ pixels[i], 16777619);
      }
      return {
        name: mirror.name,
        width: target.width,
        height: target.height,
        range: max - min,
        hash: hash >>> 0,
      };
    });
  }
  dispose() {
    this.views.dispose();
    this.surfaces.length = 0;
    this.restoreEnvironment();
    this.cubeTargets.forEach((target) => target.dispose());
  }
}
