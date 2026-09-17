import * as T from 'three';
import { MirrorViews } from './mirrors.ts';

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
  private clock = 0;
  private enabled = false;
  private lastProbe = -Infinity;
  private cubeTarget = new T.WebGLCubeRenderTarget(128, {
    type: T.HalfFloatType,
    generateMipmaps: true,
    minFilter: T.LinearMipmapLinearFilter,
  });
  private cube = new T.CubeCamera(0.1, 1600, this.cubeTarget);
  private fallbackEnvironment: T.Texture | null = null;
  attachMirrors(surfaces: readonly T.Mesh[]) {
    this.surfaces = [...surfaces];
    this.views.bind(surfaces);
  }
  quality(value: 'low' | 'medium' | 'high') {
    this.views.quality(value);
  }
  beginFrame(time: number, cockpit: boolean) {
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
  ) {
    if (!high || this.activePass || this.clock - this.lastProbe < 1.5) return;
    this.lastProbe = this.clock;
    this.fallbackEnvironment = scene.environment;
    const maps = materials.map((material) => material.envMap);
    const visible = car.visible;
    const mirrorVisibility = this.mirrors.map((m) => m.visible);
    const shadows = renderer.shadowMap.autoUpdate;
    this.activePass = true;
    try {
      // Never sample the cube texture while rendering into the same target.
      materials.forEach((material) => {
        material.envMap = this.fallbackEnvironment;
        material.needsUpdate = true;
      });
      this.mirrors.forEach((mirror) => (mirror.visible = false));
      car.visible = false;
      renderer.shadowMap.autoUpdate = false;
      this.cube.position.copy(car.position).add(new T.Vector3(0, 1.5, 0));
      this.cube.update(renderer, scene);
      this.probeUpdates++;
    } finally {
      car.visible = visible;
      renderer.shadowMap.autoUpdate = shadows;
      this.mirrors.forEach((mirror, i) => (mirror.visible = mirrorVisibility[i]));
      materials.forEach((material, i) => {
        material.envMap = maps[i];
        material.needsUpdate = true;
      });
      this.activePass = false;
    }
    materials.forEach((material) => {
      material.envMap = this.cubeTarget.texture;
      material.needsUpdate = true;
    });
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
    this.cubeTarget.dispose();
  }
}
