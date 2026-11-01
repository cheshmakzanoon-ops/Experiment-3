import type { BabylonPresentationGpu, PresentationCompletions } from './presentation-gpu.ts';

export type StartupPublicationRejection =
  | 'ineligible-or-invalidated'
  | 'unavailable-completion'
  | 'gpu-unhealthy'
  | 'stale-sequence'
  | 'changed-component'
  | 'changed-snapshot'
  | 'changed-visual'
  | 'capture-exception'
  | 'capture-null';

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
  private rejection: StartupPublicationRejection | null = null;
  get rejectionReason(): StartupPublicationRejection | null {
    return this.rejection;
  }
  private reject(reason: StartupPublicationRejection): false {
    this.rejection = reason;
    return false;
  }
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
    this.rejection = null;
    if (this.dead) {
      this.reject('ineligible-or-invalidated');
      return;
    }
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
      else this.reject(state.visual === null ? 'capture-null' : 'changed-snapshot');
    } catch {
      this.reject('capture-exception');
      // Original rendering succeeded; unproven metadata takes the normal redraw.
    }
  }
  canPublish(graphics: ReturnType<BabylonPresentationGpu['diagnostics']>, eligible: boolean) {
    const receipt = this.completed;
    if (this.dead || !eligible) return this.reject('ineligible-or-invalidated');
    if (!receipt) return this.reject('unavailable-completion');
    if (
      graphics.settled !== true ||
      graphics.phase !== 'idle' ||
      graphics.lost !== false ||
      graphics.disposed !== false ||
      graphics.queue.failure !== null ||
      graphics.queue.pending !== false ||
      graphics.preparation.active !== false ||
      graphics.preparation.failure !== null
    )
      return this.reject('gpu-unhealthy');
    if (
      receipt.sequence !== graphics.submitted ||
      receipt.sequence !== graphics.lastCompletedSequence
    )
      return this.reject('stale-sequence');
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
      if (!current.paused) return this.reject('ineligible-or-invalidated');
      if (current.component !== previous.component) return this.reject('changed-component');
      if (current.tick !== previous.tick) return this.reject('changed-snapshot');
      if (current.visual === null) return this.reject('capture-null');
      if (current.visual !== previous.visual) return this.reject('changed-visual');
      if (
        current.frame.length !== previous.frame.length ||
        !current.frame.every(Number.isFinite) ||
        !bytes.every((value, index) => value === previousBytes[index])
      )
        return this.reject('changed-snapshot');
      this.rejection = null;
      return true;
    } catch {
      return this.reject('capture-exception');
    }
  }
  dispose() {
    this.dead = true;
    this.rejection = null;
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
