import { CAR_STRIDE, H, HEADER, R, RACE_BASE, carBase } from '../simulation/protocol.ts';
import { VEHICLE_IDS } from '../simulation/vehicles.ts';
import type { MenuFrameReadiness } from './menu-frame-pacing.ts';

export interface MenuPreviewView {
  readonly circuit: string;
  readonly width: number;
  readonly height: number;
}

export interface MenuPreviewFrameReceipt extends MenuPreviewView {
  readonly generation: number;
  readonly revision: number;
  readonly submission: number;
  readonly machine: string;
  readonly time: number;
  readonly cars: number;
}

interface Capture {
  generation: number;
  revision: number;
  submission: number;
  machine: string;
  time: number;
  cars: number;
  circuit: string;
  width: number;
  height: number;
  length: number;
}

function capture(): Capture {
  return {
    generation: 0,
    revision: -1,
    submission: 0,
    machine: '',
    time: 0,
    cars: 0,
    circuit: '',
    width: 0,
    height: 0,
    length: 0,
  };
}

function describe(value: Capture): MenuPreviewFrameReceipt {
  return {
    generation: value.generation,
    revision: value.revision,
    submission: value.submission,
    machine: value.machine,
    time: value.time,
    cars: value.cars,
    circuit: value.circuit,
    width: value.width,
    height: value.height,
  };
}

/** Identify the menu frame whose owned GPU submission actually completed.
 * Requests never stand in for display evidence. The application supplies only
 * genuine MenuFramePacing observations; this class neither polls GL nor admits
 * rendering through a modal, settings transaction, or unfinished GPU fence.
 *
 * Capture the revision beside the exact display frame before draw(), then call
 * submittedFrame only after draw succeeds. Keep its numeric ticket until the
 * corresponding pacing completion. Reset this receipt and the menu pacing at
 * renderer replacement and non-menu transitions; never reset the real GPU gate
 * to manufacture completion. Two reusable buffers retain submitted/completed
 * values even if the caller later changes or reuses its source array.
 */
export class MenuPreviewReceipt {
  private owner: object | null = null;
  private generation = 0;
  private requestedRevision = 0;
  private requestReason = 'initial';
  private nextSubmission = 0;
  private pending = false;
  private hasCompleted = false;
  private disposed = false;
  private submitted = capture();
  private completed = capture();
  private submittedBuffer = new Float32Array(0);
  private completedBuffer = new Float32Array(0);

  get revision(): number {
    return this.requestedRevision;
  }

  /** Explicit work still needs a submission; pending work remains GPU-owned. */
  get needsSubmission(): boolean {
    if (this.disposed) return false;
    return this.pending
      ? this.submitted.revision !== this.requestedRevision
      : !this.hasCompleted || this.completed.revision !== this.requestedRevision;
  }

  /** Do not deduplicate by machine: a circuit, viewport, or Academy selection
   * can require a fresh frame while the same motorcycle remains selected. */
  request(reason = 'selection'): number {
    if (this.disposed) throw new Error('Menu preview receipt is disposed');
    this.requestReason = reason;
    return ++this.requestedRevision;
  }

  submittedFrame(
    owner: object,
    revision: number,
    frame: Float32Array,
    view: Readonly<MenuPreviewView>,
  ): number {
    if (this.disposed) throw new Error('Menu preview receipt is disposed');
    if (!Number.isInteger(revision) || revision < 0 || revision > this.requestedRevision)
      throw new Error('Invalid menu preview revision');
    const cars = frame[H.CARS];
    const vehicle = frame[carBase(0) + RACE_BASE + R.VEHICLE];
    if (
      !Number.isInteger(cars) ||
      cars < 1 ||
      cars > 12 ||
      frame.length < HEADER + cars * CAR_STRIDE ||
      !Number.isInteger(vehicle) ||
      !VEHICLE_IDS[vehicle] ||
      !Number.isFinite(frame[H.TIME]) ||
      !view.circuit ||
      !Number.isFinite(view.width) ||
      !Number.isFinite(view.height) ||
      view.width <= 0 ||
      view.height <= 0
    )
      throw new Error('Invalid submitted menu preview');
    if (this.owner !== owner) this.changeOwner(owner);
    if (this.pending) throw new Error('A menu preview receipt is already pending');
    if (this.submittedBuffer.length < frame.length) {
      const size = Math.max(frame.length, this.submittedBuffer.length * 2);
      const submitted = new Float32Array(size);
      const completed = new Float32Array(size);
      submitted.set(this.submittedBuffer);
      completed.set(this.completedBuffer);
      this.submittedBuffer = submitted;
      this.completedBuffer = completed;
    }
    this.submittedBuffer.set(frame);
    const value = this.submitted;
    value.generation = this.generation;
    value.revision = revision;
    value.submission = ++this.nextSubmission;
    value.machine = VEHICLE_IDS[vehicle];
    value.time = this.submittedBuffer[H.TIME];
    value.cars = cars;
    value.circuit = view.circuit;
    value.width = view.width;
    value.height = view.height;
    value.length = frame.length;
    this.pending = true;
    return value.submission;
  }

  /** Merely being ready is not evidence of any menu submission. A stale ticket
   * cannot acknowledge a newer frame, including after reset with the same owner. */
  observe(owner: object, readiness: MenuFrameReadiness, ticket: number | null): boolean {
    if (
      this.disposed ||
      readiness !== 'completed' ||
      this.owner !== owner ||
      !this.pending ||
      this.submitted.generation !== this.generation ||
      ticket !== this.submitted.submission
    )
      return false;
    const previousBuffer = this.completedBuffer;
    this.completedBuffer = this.submittedBuffer;
    this.submittedBuffer = previousBuffer;
    const previousCapture = this.completed;
    this.completed = this.submitted;
    this.submitted = previousCapture;
    this.pending = false;
    this.hasCompleted = true;
    return true;
  }

  /** Metadata copies occur only on a diagnostic read, never on orbit submission. */
  report() {
    return {
      generation: this.generation,
      requested: { revision: this.requestedRevision, reason: this.requestReason },
      submitted: this.pending ? describe(this.submitted) : null,
      completed: this.hasCompleted ? describe(this.completed) : null,
      current: this.hasCompleted && this.completed.revision === this.requestedRevision,
      pending: this.pending,
      needsSubmission: this.needsSubmission,
    };
  }

  /** Optional diagnostic copy; normal presentation and report() do not copy it. */
  copyCompletedFrame(): Float32Array | null {
    return this.hasCompleted ? this.completedBuffer.slice(0, this.completed.length) : null;
  }

  private changeOwner(owner: object | null): void {
    this.owner = owner;
    this.generation++;
    this.pending = false;
    this.hasCompleted = false;
  }

  reset(): void {
    if (this.disposed) return;
    this.changeOwner(null);
    this.request('reset');
  }

  dispose(): void {
    if (this.disposed) return;
    this.changeOwner(null);
    this.disposed = true;
  }
}
