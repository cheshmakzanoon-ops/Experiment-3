import { GpuFrameGate } from '../../rendering/gpu-frame-gate.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';

export type PresentationReceipt =
  | { kind: 'completed'; owner: object; ready: boolean; sequence: number }
  | { kind: 'lost' }
  | { kind: 'disposed' };
export interface PresentationCompletions {
  subscribe(listener: (receipt: PresentationReceipt) => void): () => void;
}
/** Own normal scene submissions, not asynchronous asset upload/compilation.
 * Fences cover scene.render commands; Babylon's normal endFrame only notifies
 * observers (and optionally flushes). Do not install drawing endFrame observers
 * outside this owner. No state-binding or private engine API is used here. */
export class BabylonPresentationGpu implements PresentationCompletions {
  private gate: GpuFrameGate;
  private pending: { owner: object; ready: boolean; sequence: number } | null = null;
  private lost = false;
  private disposed = false;
  private readonly listeners = new Set<(receipt: PresentationReceipt) => void>();
  private submitted = 0;
  private completed = 0;
  private lastCompletedSequence = 0;
  private abandoned = 0;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.gate = new GpuFrameGate(gl);
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
    if (this.disposed || this.lost || !this.gate.ready()) return false;
    if (this.pending) {
      const receipt = this.pending;
      this.pending = null;
      this.completed++;
      this.lastCompletedSequence = receipt.sequence;
      this.publish({ kind: 'completed', ...receipt });
    }
    return true;
  }
  frame(schedule: PresentationSchedule, paused: boolean, owner: object, draw: () => boolean) {
    if (!this.ready() || !schedule.shouldRender(paused)) return false;
    const ready = draw();
    this.gate.submittedFrame();
    if (!this.gate.diagnostics().pending) {
      this.contextLost();
      return false;
    }
    this.pending = { owner, ready, sequence: ++this.submitted };
    return true;
  }
  contextLost() {
    if (this.disposed || this.lost) return;
    this.lost = true;
    if (this.pending) this.abandoned++;
    this.pending = null;
    this.gate.dispose();
    this.publish({ kind: 'lost' });
  }
  contextRestored() {
    if (this.disposed || !this.lost) return;
    this.gate = new GpuFrameGate(this.gl);
    this.lost = false;
  }
  diagnostics() {
    return {
      submitted: this.submitted,
      completed: this.completed,
      lastCompletedSequence: this.lastCompletedSequence,
      abandoned: this.abandoned,
      settled:
        !this.disposed &&
        !this.lost &&
        !this.pending &&
        !this.gate.diagnostics().pending &&
        !this.gate.diagnostics().failure &&
        this.lastCompletedSequence === this.submitted,
      lost: this.lost,
      disposed: this.disposed,
      queue: this.gate.diagnostics(),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
