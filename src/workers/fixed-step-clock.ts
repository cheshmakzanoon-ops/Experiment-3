export interface FixedStepClockOptions {
  /** Simulation seconds per tick; never stretched to catch up. */
  dt?: number;
  maxSteps?: number;
  /** A batch yields between ticks after this much CPU time. */
  maxWorkMs?: number;
  now?: () => number;
}

/** Worker wall clock with bounded catch-up and bounded work per message turn.
 * Every completed tick uses the same dt. Overload discards whole pending ticks
 * rather than leaving work debt for the next turn; the fractional remainder is
 * preserved. One indivisible simulation tick may exceed the CPU budget. */
export class FixedStepClock {
  readonly dt: number;
  readonly maxSteps: number;
  readonly maxWorkMs: number;
  accumulator = 0;
  ticks = 0;
  droppedSeconds = 0;
  /** Wall time beyond the maximum catch-up window. */
  elapsedDroppedSeconds = 0;
  /** Admitted time discarded because the worker exhausted its CPU budget. */
  budgetDroppedSeconds = 0;
  /** Admitted time discarded by a rebase or a failed step during a batch. */
  interruptedSeconds = 0;
  overloadedBatches = 0;
  rejectedTimestamps = 0;
  private previous: number | null = null;
  private revision = 0;
  private resetRevision = 0;
  private advancing = false;
  private readonly now: () => number;

  constructor(options: FixedStepClockOptions = {}) {
    this.dt = options.dt ?? 1 / 120;
    this.maxSteps = options.maxSteps ?? 24;
    this.maxWorkMs = options.maxWorkMs ?? this.dt * 1000;
    this.now = options.now ?? (() => performance.now());
    if (
      !Number.isFinite(this.dt) ||
      this.dt <= 0 ||
      !Number.isSafeInteger(this.maxSteps) ||
      this.maxSteps < 1 ||
      !Number.isFinite(this.dt * this.maxSteps) ||
      !Number.isFinite(this.maxWorkMs) ||
      this.maxWorkMs <= 0
    )
      throw new Error('Invalid fixed-step clock options');
  }

  /** Exclude paused wall time without losing already admitted fractional time.
   * Also stops a batch if invoked by its step callback. */
  rebase(nowMs: number) {
    this.previous = Number.isFinite(nowMs) ? nowMs : null;
    this.revision++;
  }

  reset(nowMs: number) {
    this.accumulator = this.ticks = this.droppedSeconds = 0;
    this.elapsedDroppedSeconds = this.budgetDroppedSeconds = this.interruptedSeconds = 0;
    this.overloadedBatches = this.rejectedTimestamps = 0;
    this.resetRevision++;
    this.rebase(nowMs);
  }

  /** Advance from an absolute monotonic timestamp in milliseconds. Invalid or
   * backward samples are ignored without moving the last valid time backward. */
  advance(nowMs: number, step: (dt: number) => void) {
    if (this.advancing) throw new Error('Cannot advance a fixed-step clock reentrantly');
    if (!Number.isFinite(nowMs) || (this.previous !== null && nowMs < this.previous)) {
      this.rejectedTimestamps++;
      return this.accumulator / this.dt;
    }
    if (this.previous === null) {
      this.rebase(nowMs);
      return this.accumulator / this.dt;
    }
    // Subtract milliseconds before converting to seconds, retaining precision
    // for short frame intervals even after a long worker uptime.
    const elapsed = (nowMs - this.previous) / 1000;
    if (!Number.isFinite(elapsed)) {
      this.rejectedTimestamps++;
      return this.accumulator / this.dt;
    }
    this.previous = nowMs;
    const admitted = Math.min(elapsed, this.dt * this.maxSteps);
    const droppedBefore = this.droppedSeconds;
    this.elapsedDroppedSeconds += elapsed - admitted;
    this.droppedSeconds += elapsed - admitted;
    this.accumulator += admitted;
    const revision = this.revision,
      resetRevision = this.resetRevision;
    // Match the deterministic stepper's tolerance at a tick boundary.
    const epsilon = Math.min(1e-10, this.dt * 1e-8);
    let count = 0,
      budgetLimited = false;
    this.advancing = true;
    try {
      const start = this.now();
      let lastWorkTime = start;
      while (this.accumulator + epsilon >= this.dt && count < this.maxSteps) {
        if (count > 0) {
          const workTime = this.now();
          // A broken budget clock cannot authorize an unbounded work batch.
          if (
            !Number.isFinite(start) ||
            !Number.isFinite(workTime) ||
            workTime < lastWorkTime ||
            workTime - start >= this.maxWorkMs
          ) {
            budgetLimited = true;
            break;
          }
          lastWorkTime = workTime;
        }
        step(this.dt);
        // A session reset inside a callback owns the new clock state.
        if (resetRevision !== this.resetRevision) return this.accumulator / this.dt;
        this.accumulator = Math.max(0, this.accumulator - this.dt);
        this.ticks++;
        count++;
        if (revision !== this.revision) break;
      }
    } finally {
      if (resetRevision === this.resetRevision) {
        const pending = Math.floor((this.accumulator + epsilon) / this.dt);
        const dropped = Math.min(this.accumulator, pending * this.dt);
        this.accumulator -= dropped;
        this.droppedSeconds += dropped;
        if (budgetLimited) this.budgetDroppedSeconds += dropped;
        else this.interruptedSeconds += dropped;
        if (this.droppedSeconds > droppedBefore) this.overloadedBatches++;
      }
      this.advancing = false;
    }
    return this.accumulator / this.dt;
  }
}
