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
  | 'lost'
  | 'failed'
  | 'disposed';
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
    };
    this.phase = 'lost';
    this.lost = true;
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
      lastLoss: this.lastLoss ? { ...this.lastLoss, queue: { ...this.lastLoss.queue } } : null,
      submitted: this.submitted,
      completed: this.completed,
      lastCompletedSequence: this.lastCompletedSequence,
      abandoned: this.abandoned,
      settled:
        !this.disposed &&
        !this.lost &&
        !this.pending &&
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
