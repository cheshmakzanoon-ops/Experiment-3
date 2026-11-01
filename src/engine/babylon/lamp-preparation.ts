import {
  createBabylonStartLamps,
  startLampsEligible,
  type BabylonStartLampsOptions,
} from './start-lamps.ts';

type LampOwner = Awaited<ReturnType<typeof createBabylonStartLamps>>;

/** Owns the staged environment across asynchronous preparation and scene teardown.
 * Compilation may yield between leases: only installation releases normal draws.
 * Cancellation never interrupts the adapter's compiler-drain boundary. */
export class LampPreparation {
  private owner: LampOwner | undefined;
  private disposed = false;
  private drawable = false;
  private ready = false;
  readonly eligible: boolean;
  readonly completion: Promise<void>;
  /** Resolves only after every original compiler/upload lease has drained. */
  readonly prepared: Promise<void>;
  private preparedComplete = false;
  private installStarted = false;
  private readonly cancelStaged = () => {
    // Staged resources may share a context with a sibling's active compiler.
    // Reject promptly; the staging coordinator owns drain-before-disposal.
    if (this.preparedComplete && !this.installStarted)
      this.rejectCompletion(this.options.signal.reason);
  };
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: unknown) => void;
  constructor(
    private readonly options: BabylonStartLampsOptions,
    private readonly frame: () => Float32Array,
    load: typeof createBabylonStartLamps = createBabylonStartLamps,
    mode: { staged?: boolean } = {},
  ) {
    this.eligible = startLampsEligible(options.track, options.context);
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    // A staged owner can fail before its caller reaches installation. Retain
    // the rejecting public promise without an unhandled intermediate rejection.
    void this.completion.catch(() => {});
    this.prepared = this.prepare(load);
    void this.prepared
      .then(
        () => {
          if (!mode.staged) this.install();
        },
        (error) => this.rejectCompletion(error),
      )
      .catch((error) => this.rejectCompletion(error));
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
      throw new DOMException('Start lamp preparation ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('Start lamp preparation deadline exceeded');
  }
  get canDraw() {
    return this.current() && this.drawable;
  }
  get completed() {
    return this.current() && this.ready;
  }
  /** Apply only the latest authoritative snapshot; no local clock or simulation writes. */
  apply(frame: Float32Array) {
    if (!this.canDraw) return;
    this.owner?.apply(frame);
  }
  /** Counts reflect the actual bound resources and their original emission values. */
  receipt() {
    if (!this.completed) throw new Error('Start lamp environment is not ready');
    if (!this.eligible)
      return { state: 'ineligible', parts: 0, materials: 0, triangles: 0, lights: 0 };
    const diagnostics = this.owner!.diagnostics();
    const parts = diagnostics.parts.filter(
      ({ mesh, material }) =>
        !mesh.isDisposed() &&
        mesh.isEnabled() &&
        this.options.scene.meshes.includes(mesh) &&
        mesh.material === material &&
        this.options.scene.materials.includes(material),
    );
    const materials = new Set(parts.map(({ material }) => material)).size;
    const triangles = parts.reduce((sum, { mesh }) => sum + mesh.getTotalIndices() / 3, 0);
    if (
      diagnostics.state !== 'ready' ||
      diagnostics.activeParts !== 5 ||
      diagnostics.activeMaterials !== 5 ||
      parts.length !== 5 ||
      materials !== 5 ||
      triangles !== 400 ||
      parts.some(
        ({ material }) => material.emissiveIntensity !== 0 && material.emissiveIntensity !== 25,
      )
    )
      throw new Error('Original start lamp activation incomplete');
    return {
      state: diagnostics.state,
      parts: parts.length,
      materials,
      triangles,
      lights: parts.filter(({ material }) => material.emissiveIntensity === 25).length,
    };
  }
  dispose() {
    this.options.signal.removeEventListener('abort', this.cancelStaged);
    this.disposed = true;
    this.drawable = this.ready = false;
    if (this.preparedComplete && !this.installStarted)
      this.rejectCompletion(new DOMException('Staged environment disposed', 'AbortError'));
    // Explicitly drain even if Scene.dispose skipped its observers or threw.
    this.owner?.dispose();
  }
  private async prepare(load: typeof createBabylonStartLamps) {
    try {
      this.active();
      if (this.eligible) {
        this.owner = await load(this.options);
        this.active();
      }
      this.preparedComplete = true;
      this.options.signal.addEventListener('abort', this.cancelStaged, { once: true });
    } catch (error) {
      this.cleanupFailure(error);
    }
  }
  /** Starts installation/subscription synchronously. No await between batch calls. */
  install(): Promise<void> {
    if (this.installStarted) return this.completion;
    if (!this.preparedComplete)
      throw new Error('Start lamp installation requires one prepared owner');
    this.installStarted = true;
    this.options.signal.removeEventListener('abort', this.cancelStaged);
    void this.present().then(this.resolveCompletion, this.rejectCompletion);
    return this.completion;
  }
  private async present() {
    try {
      this.active();
      if (this.eligible) {
        this.owner!.apply(this.frame());
        // install subscribes synchronously before the next frame can run.
        const installed = this.owner!.install();
        this.drawable = true;
        await installed;
        this.active();
        this.owner!.apply(this.frame());
      }
      this.drawable = this.ready = true;
      this.receipt();
    } catch (error) {
      this.cleanupFailure(error);
    }
  }
  private cleanupFailure(error: unknown): never {
    try {
      this.dispose();
    } catch (cleanupError) {
      try {
        console.error('Start lamp cleanup failed', cleanupError);
      } catch {
        /* Reporting must not replace the primary failure or skip draining. */
      }
    }
    throw error;
  }
}
