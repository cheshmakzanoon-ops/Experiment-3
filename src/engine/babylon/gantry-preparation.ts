import {
  loadBabylonStartGantry,
  startGantryEligible,
  type BabylonStartGantryOptions,
} from './start-gantry.ts';
import manifest from '../../rendering/start-gantry.manifest.json' with { type: 'json' };

type GantryOwner = Awaited<ReturnType<typeof loadBabylonStartGantry>>;

/** Owns the staged environment across asynchronous preparation and scene teardown.
 * Compilation may yield between leases: only installation releases normal draws.
 * Cancellation never interrupts the adapter's compiler-drain boundary. */
export class GantryPreparation {
  private owner: GantryOwner | undefined;
  private disposed = false;
  private drawable = false;
  private ready = false;
  readonly eligible: boolean;
  readonly completion: Promise<void>;
  constructor(
    private readonly options: BabylonStartGantryOptions,
    load: typeof loadBabylonStartGantry = loadBabylonStartGantry,
  ) {
    this.eligible = startGantryEligible(options.track, options.context);
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
    if (!this.current()) throw new DOMException('A07 preparation ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('A07 preparation deadline exceeded');
  }
  get canDraw() {
    return this.current() && this.drawable;
  }
  get completed() {
    return this.current() && this.ready;
  }
  /** Only publish counts from resources actually bound to the ready current scene. */
  receipt() {
    if (!this.completed) throw new Error('A07 environment is not ready');
    if (!this.eligible)
      return { state: 'ineligible', parts: 0, materials: 0, textures: 0, triangles: 0, sha256: '' };
    const diagnostics = this.owner!.diagnostics();
    const triangles = diagnostics.parts
      .filter(
        ({ mesh }) =>
          !mesh.isDisposed() && mesh.isEnabled() && this.options.scene.meshes.includes(mesh),
      )
      .reduce((sum, { mesh }) => sum + mesh.getTotalIndices() / 3, 0);
    if (
      diagnostics.state !== 'ready' ||
      diagnostics.activeParts !== manifest.draws.portal[0] ||
      diagnostics.activeMaterials !== manifest.materials ||
      diagnostics.activeTextures !== manifest.images ||
      triangles !== manifest.triangles.portal[0] ||
      diagnostics.sha256 !== manifest.sha256
    )
      throw new Error('Original A07 activation incomplete');
    return {
      state: diagnostics.state,
      parts: diagnostics.activeParts,
      materials: diagnostics.activeMaterials,
      textures: diagnostics.activeTextures,
      triangles,
      sha256: diagnostics.sha256,
    };
  }
  dispose() {
    this.disposed = true;
    this.drawable = this.ready = false;
    // Explicitly drain even if Scene.dispose skipped its observers or threw.
    this.owner?.dispose();
  }
  private async run(load: typeof loadBabylonStartGantry) {
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
        console.error('A07 cleanup failed', cleanupError);
      }
      throw error;
    }
  }
}
