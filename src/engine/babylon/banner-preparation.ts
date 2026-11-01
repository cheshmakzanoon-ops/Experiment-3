import {
  createBabylonStartBanner,
  startBannerEligible,
  type BabylonStartBannerOptions,
} from './start-banner.ts';

type BannerOwner = Awaited<ReturnType<typeof createBabylonStartBanner>>;

/** Owns the staged environment across asynchronous preparation and scene teardown.
 * Compilation may yield between leases: only installation releases normal draws.
 * Cancellation never interrupts the adapter's compiler-drain boundary. */
export class BannerPreparation {
  private owner: BannerOwner | undefined;
  private disposed = false;
  private drawable = false;
  private ready = false;
  readonly eligible: boolean;
  readonly completion: Promise<void>;
  constructor(
    private readonly options: BabylonStartBannerOptions,
    load: typeof createBabylonStartBanner = createBabylonStartBanner,
  ) {
    this.eligible = startBannerEligible(options.track, options.context);
    this.completion = this.run(load);
  }
  private current() {
    return (
      !this.disposed &&
      !this.options.signal.aborted &&
      !this.options.scene.isDisposed &&
      this.options.isCurrent()
    );
  }
  private active() {
    this.options.signal.throwIfAborted();
    if (!this.current())
      throw new DOMException('Start banner preparation ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('Start banner preparation deadline exceeded');
  }
  get canDraw() {
    return this.current() && this.drawable;
  }
  get completed() {
    return this.current() && this.ready;
  }
  /** Verify the actual installed bindings, original dimensions and hardware allocation. */
  receipt() {
    if (!this.completed) throw new Error('Start banner environment is not ready');
    if (!this.eligible)
      return {
        state: 'ineligible',
        parts: 0,
        materials: 0,
        textures: 0,
        triangles: 0,
        width: 0,
        height: 0,
        hardwareSrgb: 0,
      };
    const diagnostics = this.owner!.diagnostics();
    const { mesh, material, texture } = diagnostics;
    const parts =
      !mesh.isDisposed() && mesh.isEnabled() && this.options.scene.meshes.includes(mesh) ? 1 : 0;
    const materials =
      parts && mesh.material === material && this.options.scene.materials.includes(material)
        ? 1
        : 0;
    const textures =
      materials &&
      material.albedoTexture === texture &&
      this.options.scene.textures.includes(texture)
        ? 1
        : 0;
    const triangles = parts ? mesh.getTotalIndices() / 3 : 0;
    const { width, height } = texture.getSize();
    const hardwareSrgb = Number(diagnostics.hardwareSrgb);
    if (
      diagnostics.state !== 'ready' ||
      diagnostics.activeParts !== 1 ||
      diagnostics.activeMaterials !== 1 ||
      diagnostics.activeTextures !== 1 ||
      parts !== 1 ||
      materials !== 1 ||
      textures !== 1 ||
      triangles !== 2 ||
      width !== 512 ||
      height !== 128 ||
      hardwareSrgb !== 1
    )
      throw new Error('Original start banner activation incomplete');
    return {
      state: diagnostics.state,
      parts,
      materials,
      textures,
      triangles,
      width,
      height,
      hardwareSrgb,
    };
  }
  dispose() {
    this.disposed = true;
    this.drawable = this.ready = false;
    // Explicitly drain even if Scene.dispose skipped its observers or threw.
    this.owner?.dispose();
  }
  private async run(load: typeof createBabylonStartBanner) {
    try {
      this.active();
      if (this.eligible) {
        this.owner = await load(this.options);
        this.active();
        // install subscribes synchronously before the next frame can run.
        const installed = this.owner.install();
        this.drawable = true;
        await installed;
        this.active();
      }
      this.drawable = this.ready = true;
      this.receipt();
    } catch (error) {
      try {
        this.dispose();
      } catch (cleanupError) {
        console.error('Start banner cleanup failed', cleanupError);
      }
      throw error;
    }
  }
}
