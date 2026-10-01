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
  /** Layer mask used by the local probe's cube cameras. */
  get probeLayers() {
    return this.cubes[0].layers;
  }
  /** The actual rear-facing mirror cameras (profiling and census). */
  get mirrorCameras(): readonly T.Camera[] {
    return this.views.cameras;
  }
  probeUpdates = 0;
  /** Roots omitted from the local probe (other cars, people, particles, small
   * props): at 128 px per face they are a few texels but cost one draw each
   * per face. Visibility is restored even if a face throws. */
  probeExclusions: T.Object3D[] = [];
  private exclusionVisibility: boolean[] = [];
  private activePass = false;
  private clock = NaN;
  private enabled = false;
  private lastProbe = -Infinity;
  private capturedEnvironment: object | null = null;
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
  private originalMaps = new Map<
    T.MeshStandardMaterial,
    {
      texture: T.Texture | null;
      intensity: number;
    }
  >();
  private capturedCar: T.Object3D | null = null;
  private probeActive = false;
  get localProbeActive() {
    return this.probeActive;
  }
  private restoreEnvironment() {
    for (const [material, original] of this.originalMaps) {
      material.envMap = original.texture;
      material.envMapIntensity = original.intensity;
      material.needsUpdate = true;
    }
    this.originalMaps.clear();
    this.probeActive = false;
    this.capturedCar = null;
    this.lastProbe = -Infinity;
  }
  /** Sky-only IBL uses the authored gain. A completed local cubemap already
   * contains lit scene radiance, so applying that gain again also darkens every
   * lamp and lit building (by 12.5x on an overcast night). Keep the fallback gain
   * current while a probe owns the map, and restore it on disable/subject change. */
  setSkyIntensity(materials: readonly T.MeshStandardMaterial[], intensity: number) {
    if (!Number.isFinite(intensity) || intensity < 0)
      throw new Error('Invalid sky environment intensity');
    for (const material of materials) {
      const original = this.originalMaps.get(material);
      if (original) original.intensity = intensity;
      material.envMapIntensity = original ? 1 : intensity;
    }
  }
  attachMirrors(surfaces: readonly T.Mesh[]) {
    for (const mirror of this.surfaces) mirror.visible = false;
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
  /** Roots omitted from the rear-view feeds (spectators, pit people, props). */
  set mirrorExclusions(roots: T.Object3D[]) {
    this.views.exclusions = roots;
  }
  get mirrorExclusions() {
    return this.views.exclusions;
  }
  updateProbe(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    car: T.Object3D,
    materials: readonly T.MeshStandardMaterial[],
    high: boolean,
    intervalSeconds = 1.5,
    skyScale?: { value: number },
  ) {
    if (this.activePass) return;
    if (!high) {
      if (this.probeActive) this.restoreEnvironment();
      return;
    }
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0.25 || intervalSeconds > 5)
      throw new Error('Invalid reflection probe interval');
    if (
      skyScale &&
      (!Number.isFinite(skyScale.value) ||
        !Number.isFinite(scene.environmentIntensity) ||
        scene.environmentIntensity < 0)
    )
      throw new Error('Invalid probe sky radiance');
    // Photo/replay inspection can select another real car at the SAME instant.
    // Never keep the first car's map owners or let cadence retain its location.
    if (this.capturedCar && this.capturedCar !== car) this.restoreEnvironment();
    // A paused lighting/weather-bin change must not retain a daytime cubemap.
    // PMREM identity changes discretely, unlike continuously changing exposure:
    // keying on intensity would force an expensive capture on every wet frame.
    const environmentIdentity: object | null =
      scene.environment?.userData.aurelSkyEpoch ?? scene.environment;
    const environmentChanged = environmentIdentity !== this.capturedEnvironment;
    if (this.activePass || (!environmentChanged && this.clock - this.lastProbe < intervalSeconds))
      return;
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
    const priorSkyScale = skyScale?.value;
    const mipmaps = cube.renderTarget.texture.generateMipmaps;
    // Capture one scene-radiance bounce, not a history of previously captured
    // reflections. In particular, the wet road must not feed the prior probe
    // back into the next one: that made identical replay seeks history-dependent.
    const previousMaps = [...this.originalMaps].map(([material, original]) => ({
      material,
      original,
      texture: material.envMap,
      intensity: material.envMapIntensity,
    }));
    this.activePass = true;
    try {
      this.mirrors.forEach((mirror) => {
        mirror.visible = false;
      });
      car.visible = false;
      this.exclusionVisibility.length = 0;
      for (const root of this.probeExclusions) {
        this.exclusionVisibility.push(root.visible);
        root.visible = false;
      }
      for (const { material, original } of previousMaps) {
        material.envMap = original.texture;
        material.envMapIntensity = original.intensity;
      }
      renderer.shadowMap.autoUpdate = false;
      renderer.setScissorTest(false);
      // Scale only the visible skydome contribution by the sky IBL gain.
      // Lit scenery/emissive objects are already radiance and remain unscaled.
      // The ordinary visible sky is restored even if a cube face throws.
      if (skyScale) skyScale.value = scene.environmentIntensity;
      cube.position.copy(car.position);
      cube.position.y += 1.5;
      cube.update(renderer, scene);
      this.probeUpdates++;
      this.lastProbe = this.clock;
      this.capturedEnvironment = environmentIdentity;
      this.capturedCar = car;
    } finally {
      if (skyScale) skyScale.value = priorSkyScale!;
      cube.renderTarget.texture.generateMipmaps = mipmaps;
      for (const { material, texture, intensity } of previousMaps) {
        material.envMap = texture;
        material.envMapIntensity = intensity;
      }
      car.visible = visible;
      this.probeExclusions.forEach((root, i) => {
        if (i < this.exclusionVisibility.length) root.visible = this.exclusionVisibility[i];
      });
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
        this.originalMaps.set(material, {
          texture: material.envMap,
          intensity: material.envMapIntensity,
        });
        material.needsUpdate = true;
      }
      material.envMap = texture;
      material.envMapIntensity = 1;
    }
    this.probeActive = true;
    this.nextTarget = 1 - this.nextTarget;
  }
  diagnostics(renderer: T.WebGLRenderer) {
    return this.mirrors.map((mirror, i) => {
      const target = this.views.targets[i];
      const width = Math.min(48, target.width),
        height = Math.min(32, target.height);
      // Mirror feeds are half-float (linear HDR). Read them in their own type
      // (a byte read of a float target is a GL error that outlives this call)
      // and quantise the clamped linear values as the former 8-bit target did.
      const half = target.texture.type === T.HalfFloatType;
      const raw = half ? new Uint16Array(width * height * 4) : new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(
        target,
        Math.floor((target.width - width) / 2),
        Math.floor((target.height - height) / 2),
        width,
        height,
        raw,
      );
      const pixels = half
        ? Uint8Array.from(raw, (h) =>
            Math.round(Math.min(1, Math.max(0, T.DataUtils.fromHalfFloat(h))) * 255),
          )
        : (raw as Uint8Array);
      let min = 255,
        max = 0,
        peak = 0,
        hash = 2166136261;
      if (half)
        for (let i = 0; i < raw.length; i++)
          if (i % 4 !== 3) peak = Math.max(peak, T.DataUtils.fromHalfFloat(raw[i]));
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
        /** Largest linear (pre-exposure) value in the sampled centre. */
        peak,
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
