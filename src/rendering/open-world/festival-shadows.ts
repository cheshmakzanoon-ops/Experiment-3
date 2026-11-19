import * as T from 'three';
import { lightingDirection, type LightingMode } from '../daylight.ts';
import { FarShadow } from '../far-shadow.ts';
import { skySunKey } from '../sky-light.ts';

export const FESTIVAL_SHADOWS = Object.freeze({
  /** Local far coverage; baking the entire 16 km terrain would waste both
   * precision and work. The ULTRA middle map fits inside this region. */
  halfExtent: 640,
  anchorStep: 128,
  /** Coalesce arriving terrain tiles and ordinary travel into one refresh.
   * Render dt advances while paused, so late tiles still settle in a photo. */
  refreshSeconds: 0.75,
});

interface FestivalShadowFrame {
  subject: T.Vector3;
  lighting: LightingMode;
  terrainRevision: number;
  dt: number;
  terrain: T.Object3D;
  planting: readonly T.Object3D[];
  hidden: readonly (T.Object3D | null | undefined)[];
}

/** Static sun coverage for the streamed world. Sun/far/mid light order is a
 * shader contract; install the far light immediately after the near sun and
 * before constructing UltraPipeline. Only a completed bake is marked usable. */
export class FestivalShadows {
  readonly far = new FarShadow(1024);
  readonly bounds = new T.Box3();
  private readonly tileBounds = new T.Box3();
  private readonly anchor = new T.Vector3();
  private revision = 0;
  private bakedInputs = '';
  private bakedLighting: LightingMode | null = null;
  private age = Infinity;
  private pending = false;
  private disposed = false;

  constructor(
    private readonly renderer: T.WebGLRenderer,
    private readonly scene: T.Scene,
    private readonly sun: T.DirectionalLight,
  ) {
    scene.add(this.far.light, this.far.light.target);
  }

  configure(shadowSize: number) {
    if (this.disposed) return;
    const size = Math.max(
      1,
      Math.min(shadowSize || 1024, this.renderer.capabilities.maxTextureSize),
    );
    this.far.setEnabled(shadowSize > 0, size);
    this.invalidate();
  }

  /** Authored scenery, planting library or graphics quality changed. */
  invalidate() {
    if (this.disposed) return;
    this.revision++;
    this.age = Infinity;
  }

  update(frame: FestivalShadowFrame) {
    if (
      this.disposed ||
      !this.far.enabled ||
      !this.renderer.shadowMap.enabled ||
      !this.sun.castShadow
    )
      return false;
    this.age += Number.isFinite(frame.dt) ? Math.max(0, Math.min(frame.dt, 0.1)) : 0;
    const { anchorStep, halfExtent, refreshSeconds } = FESTIVAL_SHADOWS;
    this.anchor.set(
      Math.round(frame.subject.x / anchorStep) * anchorStep,
      Math.round(frame.subject.y / anchorStep) * anchorStep,
      Math.round(frame.subject.z / anchorStep) * anchorStep,
    );
    const inputs = `${this.anchor.x}:${this.anchor.y}:${this.anchor.z}:${frame.terrainRevision}:${this.revision}:${skySunKey()}`;
    this.pending =
      inputs !== this.bakedInputs || frame.lighting !== this.bakedLighting || !this.far.baked;
    // Relighting and travel outside cached coverage cannot reuse the old map.
    // Normal tile churn and crossing a grid cell are rate limited.
    const immediate =
      !this.far.baked ||
      frame.lighting !== this.bakedLighting ||
      !this.bounds.containsPoint(frame.subject);
    if (!this.pending || (!immediate && this.age < refreshSeconds)) return false;

    this.bounds.min.set(this.anchor.x - halfExtent, this.anchor.y - 96, this.anchor.z - halfExtent);
    this.bounds.max.set(
      this.anchor.x + halfExtent,
      this.anchor.y + 128,
      this.anchor.z + halfExtent,
    );
    const farCasters: T.Object3D[] = [];
    frame.terrain.updateWorldMatrix(true, true);
    frame.terrain.traverseVisible((object) => {
      if (!(object instanceof T.Mesh)) return;
      const box = object.geometry.boundingBox;
      if (!box) return;
      this.tileBounds.copy(box).applyMatrix4(object.matrixWorld);
      if (
        this.tileBounds.max.x < this.bounds.min.x ||
        this.tileBounds.min.x > this.bounds.max.x ||
        this.tileBounds.max.z < this.bounds.min.z ||
        this.tileBounds.min.z > this.bounds.max.z
      )
        return;
      // Actual streamed heights include mountain roads and deep carved valleys.
      this.bounds.min.y = Math.min(this.bounds.min.y, this.tileBounds.min.y);
      this.bounds.max.y = Math.max(this.bounds.max.y, this.tileBounds.max.y + 48);
      farCasters.push(object);
    });
    for (const root of frame.planting)
      root.traverseVisible((object) => {
        if (object instanceof T.Mesh && !object.castShadow) farCasters.push(object);
      });
    // A quality transition can already have requested the middle map. The
    // cache bake hides movers and has its own frustum; let the main scene draw
    // service that request, after UltraPipeline fits it to the current camera.
    const retained: { shadow: T.DirectionalLightShadow; auto: boolean; needs: boolean }[] = [];
    this.scene.traverseVisible((object) => {
      if (
        !(object instanceof T.DirectionalLight) ||
        object === this.sun ||
        object === this.far.light
      )
        return;
      retained.push({
        shadow: object.shadow,
        auto: object.shadow.autoUpdate,
        needs: object.shadow.needsUpdate,
      });
      object.shadow.autoUpdate = false;
      object.shadow.needsUpdate = false;
    });
    let baked = false;
    try {
      baked = this.far.bake(this.renderer, this.scene, {
        direction: lightingDirection(frame.lighting),
        bounds: this.bounds,
        hidden: frame.hidden,
        farCasters,
        sun: this.sun,
      });
    } finally {
      for (const { shadow, auto, needs } of retained) {
        shadow.autoUpdate = auto;
        shadow.needsUpdate = needs;
      }
    }
    if (baked) {
      this.bakedInputs = inputs;
      this.bakedLighting = frame.lighting;
      this.age = 0;
      this.pending = false;
    }
    return baked;
  }

  diagnostics() {
    return {
      ...this.far.diagnostics(),
      halfExtent: FESTIVAL_SHADOWS.halfExtent,
      refreshSeconds: FESTIVAL_SHADOWS.refreshSeconds,
      pending: this.pending,
      bounds: this.bounds.isEmpty()
        ? null
        : { min: this.bounds.min.toArray(), max: this.bounds.max.toArray() },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.far.dispose();
  }
}
