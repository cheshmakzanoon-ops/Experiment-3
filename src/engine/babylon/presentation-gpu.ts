import { GpuFrameGate } from '../../rendering/gpu-frame-gate.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';

export type PresentationReceipt =
  | { kind: 'completed'; owner: object; ready: boolean; sequence: number }
  | { kind: 'lost' }
  | { kind: 'disposed' };
export interface PresentationCompletions {
  subscribe(listener: (receipt: PresentationReceipt) => void): () => void;
}
type PresentationPhase =
  | 'idle'
  | 'drawing'
  | 'fencing'
  | 'waiting'
  | 'compiling'
  | 'preparation-wait'
  | 'lost'
  | 'failed'
  | 'disposed';
interface PreparationDiagnostics {
  active: boolean;
  started: number;
  completed: number;
  failure: string | null;
  last: { label: string; startedAtMs: number; elapsedMs: number; state: string } | null;
}
interface GraphicsLossReceipt {
  number: number;
  observedAtMs: number;
  phase: PresentationPhase;
  pendingSequence: number | null;
  pendingSubmittedAtMs: number | null;
  pendingAgeMs: number | null;
  submitted: number;
  completed: number;
  lastCompletedSequence: number;
  lastDrawCpuMs: number | null;
  drawStartedAtMs: number | null;
  queue: ReturnType<GpuFrameGate['diagnostics']>;
  preparation: PreparationDiagnostics;
}
/** Own normal scene submissions, not asynchronous asset upload/compilation.
 * Fences cover scene.render commands; Babylon's normal endFrame only notifies
 * observers (and optionally flushes). Do not install drawing endFrame observers
 * outside this owner. No state-binding or private engine API is used here. */
export class BabylonPresentationGpu implements PresentationCompletions {
  private gate: GpuFrameGate;
  private pending: {
    owner: object;
    ready: boolean;
    sequence: number;
    submittedAtMs: number;
  } | null = null;
  private lost = false;
  private disposed = false;
  private readonly listeners = new Set<(receipt: PresentationReceipt) => void>();
  private submitted = 0;
  private completed = 0;
  private lastCompletedSequence = 0;
  private abandoned = 0;
  private phase: PresentationPhase = 'idle';
  private lastDrawCpuMs: number | null = null;
  private drawStartedAtMs: number | null = null;
  private losses = 0;
  private preparation: AbortController | null = null;
  private preparationStarted = 0;
  private preparationCompleted = 0;
  private preparationFailure: string | null = null;
  private lastPreparation: PreparationDiagnostics['last'] = null;
  // One bounded receipt only; never retain the owner/scene object graph.
  private lastLoss: GraphicsLossReceipt | null = null;
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.gate = new GpuFrameGate(gl, now);
  }
  subscribe(listener: (receipt: PresentationReceipt) => void) {
    // A newly installed asset must not claim a frame submitted before it existed.
    const baseline = this.submitted;
    const future = (receipt: PresentationReceipt) => {
      if (receipt.kind !== 'completed' || receipt.sequence > baseline) listener(receipt);
    };
    if (this.disposed) listener({ kind: 'disposed' });
    else this.listeners.add(future);
    return () => {
      this.listeners.delete(future);
    };
  }
  private publish(receipt: PresentationReceipt) {
    for (const listener of [...this.listeners]) listener(receipt);
  }
  /** Poll even held paused scenes so their final GPU receipt can complete. */
  ready() {
    if (this.preparationFailure) throw new Error(this.preparationFailure);
    if (this.preparation) return false;
    return this.pollReady();
  }
  private pollReady() {
    if (this.disposed || this.lost) return false;
    try {
      if (!this.gate.ready()) return false;
    } catch (error) {
      this.phase = 'failed';
      throw error;
    }
    if (this.pending) {
      const receipt = this.pending;
      this.pending = null;
      this.completed++;
      this.lastCompletedSequence = receipt.sequence;
      this.phase = 'idle';
      this.publish({
        kind: 'completed',
        owner: receipt.owner,
        ready: receipt.ready,
        sequence: receipt.sequence,
      });
    }
    return true;
  }
  /** Exclusive single-variant compiler lane on the same context. Cancellation
   * of an asset does not cancel this lane: only completion, lost context,
   * disposal or a fatal original deadline can end ownership. */
  async prepare(
    label: string,
    deadline: number,
    work: (invalidated: AbortSignal) => Promise<void>,
  ) {
    if (this.preparation || this.preparationFailure)
      throw new Error(this.preparationFailure ?? 'GPU preparation already owns the context');
    if (this.disposed || this.lost)
      throw new DOMException('Graphics ownership unavailable', 'AbortError');
    const controller = new AbortController();
    this.preparation = controller;
    this.preparationStarted++;
    const startedAtMs = this.now();
    this.lastPreparation = {
      label: label.slice(0, 180),
      startedAtMs,
      elapsedMs: 0,
      state: 'waiting-for-prior-frame',
    };
    const check = () => {
      controller.signal.throwIfAborted();
      if (this.now() >= deadline)
        throw new Error('Original model GPU preparation exceeded its 120000ms total budget');
    };
    const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 16));
    let abortListener = () => {};
    const invalidated = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });
    const timeout = setTimeout(
      () => {
        if (this.preparation !== controller) return;
        this.preparationFailure =
          'Original model GPU preparation exceeded its 120000ms total budget';
        this.phase = 'failed';
        controller.abort(new Error(this.preparationFailure));
      },
      Math.max(0, deadline - this.now()),
    );
    try {
      await Promise.race([
        invalidated,
        (async () => {
          check();
          if (this.now() >= deadline)
            throw new Error('Original model GPU preparation exceeded its 120000ms total budget');
          while (!this.pollReady()) {
            check();
            await yieldTask();
          }
          check();
          this.phase = 'compiling';
          this.lastPreparation!.state = 'compiling';
          await work(controller.signal);
          check();
          this.phase = 'preparation-wait';
          this.lastPreparation!.state = 'waiting-for-fence';
          this.gate.submittedFrame();
          if (!this.gate.diagnostics().pending)
            throw new Error('Context lost during original model preparation');
          while (!this.gate.ready()) {
            check();
            await yieldTask();
          }
          check();
        })(),
      ]);
      this.preparationCompleted++;
      this.lastPreparation!.state = 'completed';
      this.phase = 'idle';
    } catch (error) {
      if (this.preparation === controller) {
        if (!this.lost && !this.disposed) {
          this.preparationFailure = (error instanceof Error ? error.message : String(error)).slice(
            0,
            2048,
          );
          this.phase = 'failed';
        }
        this.lastPreparation!.state = 'failed-or-invalidated';
        controller.abort(error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortListener);
      if (this.preparation === controller) {
        this.lastPreparation!.elapsedMs = Math.max(0, this.now() - startedAtMs);
        this.preparation = null;
      }
    }
  }
  private preparationDiagnostics(): PreparationDiagnostics {
    return {
      active: this.preparation !== null,
      started: this.preparationStarted,
      completed: this.preparationCompleted,
      failure: this.preparationFailure,
      last: this.lastPreparation
        ? {
            ...this.lastPreparation,
            elapsedMs: this.preparation
              ? Math.max(0, this.now() - this.lastPreparation.startedAtMs)
              : this.lastPreparation.elapsedMs,
          }
        : null,
    };
  }
  private invalidatePreparation(reason: Error) {
    const controller = this.preparation;
    if (!controller) return;
    this.lastPreparation!.state = 'invalidated';
    this.lastPreparation!.elapsedMs = Math.max(0, this.now() - this.lastPreparation!.startedAtMs);
    this.preparation = null;
    controller.abort(reason);
  }
  frame(schedule: PresentationSchedule, paused: boolean, owner: object, draw: () => boolean) {
    if (!this.ready() || !schedule.shouldRender(paused)) return false;
    this.phase = 'drawing';
    this.drawStartedAtMs = this.now();
    let ready: boolean;
    try {
      ready = draw();
    } catch (error) {
      this.phase = 'failed';
      throw error;
    } finally {
      this.lastDrawCpuMs = Math.max(0, this.now() - this.drawStartedAtMs);
      this.drawStartedAtMs = null;
    }
    this.phase = 'fencing';
    const submittedAtMs = this.now();
    try {
      this.gate.submittedFrame();
    } catch (error) {
      this.phase = 'failed';
      throw error;
    }
    if (!this.gate.diagnostics().pending) {
      this.contextLost();
      return false;
    }
    this.pending = { owner, ready, sequence: ++this.submitted, submittedAtMs };
    this.phase = 'waiting';
    return true;
  }
  contextLost() {
    if (this.disposed || this.lost) return;
    this.lastLoss = {
      number: ++this.losses,
      observedAtMs: this.now(),
      phase: this.phase,
      pendingSequence: this.pending?.sequence ?? null,
      pendingSubmittedAtMs: this.pending?.submittedAtMs ?? null,
      pendingAgeMs: this.pending ? Math.max(0, this.now() - this.pending.submittedAtMs) : null,
      submitted: this.submitted,
      completed: this.completed,
      lastCompletedSequence: this.lastCompletedSequence,
      lastDrawCpuMs: this.lastDrawCpuMs,
      drawStartedAtMs: this.drawStartedAtMs,
      queue: this.gate.diagnostics(),
      preparation: this.preparationDiagnostics(),
    };
    this.phase = 'lost';
    this.lost = true;
    this.invalidatePreparation(new DOMException('WebGL context lost', 'AbortError'));
    if (this.pending) this.abandoned++;
    this.pending = null;
    this.gate.dispose();
    this.publish({ kind: 'lost' });
  }
  contextRestored() {
    if (this.disposed || !this.lost) return;
    this.gate = new GpuFrameGate(this.gl, this.now);
    this.lost = false;
    this.phase = 'idle';
  }
  diagnostics() {
    const queue = this.gate.diagnostics();
    return {
      phase: this.phase,
      lastDrawCpuMs: this.lastDrawCpuMs,
      drawStartedAtMs: this.drawStartedAtMs,
      losses: this.losses,
      lastLoss: this.lastLoss
        ? {
            ...this.lastLoss,
            queue: { ...this.lastLoss.queue },
            preparation: {
              ...this.lastLoss.preparation,
              last: this.lastLoss.preparation.last ? { ...this.lastLoss.preparation.last } : null,
            },
          }
        : null,
      preparation: this.preparationDiagnostics(),
      submitted: this.submitted,
      completed: this.completed,
      lastCompletedSequence: this.lastCompletedSequence,
      abandoned: this.abandoned,
      settled:
        !this.disposed &&
        !this.lost &&
        !this.pending &&
        !this.preparation &&
        !this.preparationFailure &&
        !queue.pending &&
        !queue.failure &&
        this.lastCompletedSequence === this.submitted,
      lost: this.lost,
      disposed: this.disposed,
      queue,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = 'disposed';
    this.invalidatePreparation(new DOMException('Graphics disposed', 'AbortError'));
    this.pending = null;
    this.gate.dispose();
    this.publish({ kind: 'disposed' });
    this.listeners.clear();
  }
}

/** Fatal cleanup must continue even if an individual renderer disposer throws. */
export function cleanupPresentation(actions: readonly (() => void)[]): unknown[] {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}
