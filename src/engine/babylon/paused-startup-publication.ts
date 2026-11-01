import type { BabylonPresentationGpu, PresentationCompletions } from './presentation-gpu.ts';

export interface StartupSubmissionState {
  component: object;
  paused: boolean;
  tick: number;
  frame: Float32Array;
  visual: string | null;
}
/** One startup generation only. Observes real receipts; never polls the GPU,
 * consumes render demand, calls scene readiness, or changes scene state. */
export class PausedStartupPublication {
  private submitted: StartupSubmissionState | undefined;
  private completed: { state: StartupSubmissionState; sequence: number } | undefined;
  private dead = false;
  private readonly unsubscribe: () => void;
  constructor(
    completions: PresentationCompletions,
    private readonly scene: object,
    private readonly capture: (renderedVisual?: string | null) => StartupSubmissionState,
  ) {
    this.unsubscribe = completions.subscribe((receipt) => {
      this.completed = undefined;
      if (receipt.kind === 'completed' && receipt.owner === this.scene && receipt.ready) {
        if (this.submitted) this.completed = { state: this.submitted, sequence: receipt.sequence };
      }
      this.submitted = undefined;
    });
  }
  /** Called after the owned draw, before its fence is submitted. A capture
   * failure only disables this optional shortcut, never hides draw/GPU errors. */
  drawn(renderedVisual?: string | null) {
    this.submitted = undefined;
    this.completed = undefined;
    if (this.dead) return;
    try {
      const state = this.capture(renderedVisual);
      if (
        state.paused &&
        state.visual !== null &&
        state.visual.length > 0 &&
        state.visual.length <= 262144 &&
        state.frame.length <= 65536 &&
        Number.isSafeInteger(state.tick)
      )
        this.submitted = { ...state, frame: state.frame.slice() };
    } catch {
      // Original rendering succeeded; unproven metadata takes the normal redraw.
    }
  }
  canPublish(graphics: ReturnType<BabylonPresentationGpu['diagnostics']>, eligible: boolean) {
    const receipt = this.completed;
    if (
      this.dead ||
      !eligible ||
      !receipt ||
      graphics.settled !== true ||
      graphics.phase !== 'idle' ||
      graphics.lost !== false ||
      graphics.disposed !== false ||
      graphics.queue.failure !== null ||
      graphics.queue.pending !== false ||
      graphics.preparation.active !== false ||
      graphics.preparation.failure !== null ||
      receipt.sequence !== graphics.submitted ||
      receipt.sequence !== graphics.lastCompletedSequence
    )
      return false;
    try {
      const current = this.capture(),
        previous = receipt.state;
      const bytes = new Uint8Array(
        current.frame.buffer,
        current.frame.byteOffset,
        current.frame.byteLength,
      );
      const previousBytes = new Uint8Array(
        previous.frame.buffer,
        previous.frame.byteOffset,
        previous.frame.byteLength,
      );
      return (
        current.paused &&
        current.component === previous.component &&
        current.tick === previous.tick &&
        current.visual !== null &&
        current.visual === previous.visual &&
        current.frame.length === previous.frame.length &&
        current.frame.every(Number.isFinite) &&
        bytes.every((value, index) => value === previousBytes[index])
      );
    } catch {
      return false;
    }
  }
  dispose() {
    this.dead = true;
    this.submitted = this.completed = undefined;
    this.unsubscribe();
  }
}

/** Attribute cached diagnostic state only to this callback's actual new fenced
 * submission. The pinned frame() leaves even already-signaled fences waiting;
 * ready() observes completion separately. This is not a readiness receipt. */
export function startupVisualSubmissionSequence(
  graphics: ReturnType<BabylonPresentationGpu['diagnostics']>,
  capturedThisCallback: boolean,
  previousSubmitted: number,
): number | null {
  return capturedThisCallback &&
    graphics.submitted > previousSubmitted &&
    graphics.phase === 'waiting' &&
    graphics.queue.pending === true &&
    graphics.queue.failure === null &&
    graphics.lost === false &&
    graphics.disposed === false
    ? graphics.submitted
    : null;
}
