import {
  createBabylonStartFinishStripe,
  startFinishStripeEligible,
  type BabylonStartFinishStripeOptions,
} from './start-finish-stripe.ts';

type StripeOwner = Awaited<ReturnType<typeof createBabylonStartFinishStripe>>;

/** Owns the staged environment across asynchronous preparation and scene teardown.
 * Compilation may yield between leases: only installation releases normal draws.
 * Cancellation never interrupts the adapter's compiler-drain boundary. */
export class StripePreparation {
  private owner: StripeOwner | undefined;
  private disposed = false;
  private drawable = false;
  private ready = false;
  readonly eligible: boolean;
  readonly completion: Promise<void>;
  constructor(
    private readonly options: BabylonStartFinishStripeOptions,
    load: typeof createBabylonStartFinishStripe = createBabylonStartFinishStripe,
  ) {
    this.eligible = startFinishStripeEligible(options.track, options.context);
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
      throw new DOMException('Start stripe preparation ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('Start stripe preparation deadline exceeded');
  }
  get canDraw() {
    return this.current() && this.drawable;
  }
  get completed() {
    return this.current() && this.ready;
  }
  /** Verify the actual installed bindings, original dimensions and hardware allocation. */
  receipt() {
    if (!this.completed) throw new Error('Start stripe environment is not ready');
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
      width !== 128 ||
      height !== 32 ||
      hardwareSrgb !== 1
    )
      throw new Error('Original start stripe activation incomplete');
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
  private async run(load: typeof createBabylonStartFinishStripe) {
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
        console.error('Start stripe cleanup failed', cleanupError);
      }
      throw error;
    }
  }
}
