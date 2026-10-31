import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';

/** Bootstrap/scene-rebuild readiness. The owner aborts on restart immediately,
 * but an active compiler retains its GPU lease until drained or invalidated.
 * Normal scene draws remain forbidden through ALL inter-variant yield gaps. */
export class SurfacePreparation {
  private drawable = false;
  private ready = false;
  readonly completion: Promise<void>;
  get canDraw() {
    if (this.signal.aborted || this.scene.isDisposed || !this.drawable) return false;
    if (!this.ready && performance.now() >= this.deadline)
      throw new Error('Circuit surface presentation exceeded its original readiness budget');
    return true;
  }
  get completed() {
    return !this.signal.aborted && !this.scene.isDisposed && this.ready;
  }
  constructor(
    private readonly scene: Scene,
    meshes: readonly AbstractMesh[],
    gpu: BabylonPresentationGpu,
    schedule: PresentationSchedule,
    private readonly signal: AbortSignal,
    private readonly deadline: number,
    prepare: typeof prepareOriginalMaterials = prepareOriginalMaterials,
  ) {
    this.completion = this.run(meshes, gpu, schedule, deadline, prepare);
  }
  private async run(
    meshes: readonly AbstractMesh[],
    gpu: BabylonPresentationGpu,
    schedule: PresentationSchedule,
    deadline: number,
    prepare: typeof prepareOriginalMaterials,
  ) {
    const finish = schedule.prepare();
    const active = () => {
      this.signal.throwIfAborted();
      if (this.scene.isDisposed) throw new DOMException('Surface scene disposed', 'AbortError');
      if (performance.now() >= deadline)
        throw new Error('Circuit surface presentation exceeded its original readiness budget');
    };
    try {
      active();
      await prepare(
        { scene: this.scene, meshes: [...meshes] },
        gpu,
        this.signal,
        deadline,
        () => {},
      );
      active();
      // Subscribe before releasing draw suppression. Completion receipts exclude
      // earlier submissions and other scenes, including those before restart.
      const budget = new AbortController();
      const deadlineError = new Error(
        'Circuit surface presentation exceeded its original readiness budget',
      );
      // Only the post-compiler presentation wait uses this cancellation. The
      // active compiler above is never abandoned by an ordinary owner timeout.
      const timer = setTimeout(
        () => budget.abort(deadlineError),
        Math.max(0, deadline - performance.now()),
      );
      const presentationSignal = AbortSignal.any([this.signal, budget.signal]);
      try {
        const presented = waitForPresentation(this.scene, presentationSignal, gpu);
        this.drawable = true;
        schedule.request();
        try {
          await presented;
        } catch (error) {
          if (presentationSignal.reason === deadlineError) throw deadlineError;
          throw error;
        }
        active();
        this.ready = true;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      if (!this.ready) this.drawable = false;
      finish();
    }
  }
}

/** Rebuild can acquire a compiler lease after the outer frame-loop ready check.
 * Return false without consuming pending resize until ownership is idle again. */
export function resizePresentationWhenIdle(
  gpu: Pick<BabylonPresentationGpu, 'ready'>,
  resize: () => void,
) {
  if (!gpu.ready()) return false;
  resize();
  return true;
}
