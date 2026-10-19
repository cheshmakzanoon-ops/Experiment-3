interface MenuFrameSource {
  canSubmitFrame(): boolean;
}

export type MenuFrameReadiness = 'busy' | 'completed' | 'quiet' | 'ready';

/** A completed showroom frame gets a quiet browser interval before another
 * automatic submission. Real gaps in eligible menu callbacks extend that
 * interval; GPU latency alone does not. Poll once per active menu RAF callback,
 * before drawing, and suspend whenever menu presentation is held or invisible.
 * This only schedules menu presentation; it never advances or samples a race.
 */
export class MenuFramePacing {
  static readonly quietMilliseconds = 1000 / 15;
  private owner: MenuFrameSource | null = null;
  private pending = false;
  private paintPending = false;
  private disposed = false;
  private admittedAt: number | null = null;
  private callbackAt: number | null = null;
  private longestGap = 0;
  private minimumRemaining = 0;
  private recoveryRemaining = 0;
  private recoveryAt: number | null = null;
  private clockAt: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  submittedFrame(source: MenuFrameSource): void {
    if (this.disposed) throw new Error('Menu frame pacing is disposed');
    if (this.owner !== source) this.reset();
    if (this.pending) throw new Error('A menu frame is already pending');
    this.owner = source;
    const submittedAt = this.readClock();
    // Keep the admission callback's entry across a slow query and synchronous
    // draw. Starting at submission's return would lose that occupied interval.
    this.callbackAt = this.admittedAt ?? submittedAt;
    this.longestGap = 0;
    if (submittedAt !== null && this.callbackAt !== null)
      this.observeGap(submittedAt - this.callbackAt);
    this.admittedAt = null;
    this.pending = true;
    this.paintPending = false;
    this.minimumRemaining = 0;
    this.recoveryRemaining = 0;
    this.recoveryAt = null;
  }

  /** Explicit, coalesced redraws may bypass only the extra orbit recovery.
   * They still wait for real completion, the base interval and paint handoff. */
  poll(source: MenuFrameSource, explicitRedraw = false): MenuFrameReadiness {
    if (this.disposed) return 'busy';
    // A replacement renderer cannot acknowledge the abandoned owner's frame.
    if (this.owner !== source) {
      this.reset();
      this.owner = source;
    }
    this.admittedAt = null;
    const enteredAt = this.readClock();
    if (enteredAt !== null) {
      if (this.pending) {
        if (this.callbackAt !== null) this.observeGap(enteredAt - this.callbackAt);
        this.callbackAt = enteredAt;
      } else if (this.recoveryAt !== null) {
        const elapsed = enteredAt - this.recoveryAt;
        this.minimumRemaining = Math.max(0, this.minimumRemaining - elapsed);
        this.recoveryRemaining = Math.max(0, this.recoveryRemaining - elapsed);
      }
    }
    let ready = false;
    let returnedAt: number | null = null;
    try {
      ready = source.canSubmitFrame();
    } finally {
      returnedAt = this.readClock();
      // A completion query can itself block. Include its occupied duration even
      // when this is the final poll and no later pending callback can measure it.
      if (this.pending && enteredAt !== null && returnedAt !== null)
        this.observeGap(returnedAt - enteredAt);
      if (!this.pending) this.recoveryAt = returnedAt;
    }
    if (!ready) return 'busy';
    if (this.pending) {
      this.pending = false;
      this.minimumRemaining = MenuFramePacing.quietMilliseconds;
      this.recoveryRemaining = Math.max(this.minimumRemaining, this.longestGap);
      this.recoveryAt = returnedAt;
      this.callbackAt = null;
      this.paintPending = true;
      return 'completed';
    }
    // Clock discontinuities cannot grant admission or consume the paint handoff.
    if (enteredAt === null || returnedAt === null) return 'quiet';
    // Leave the completion callback and at least one following callback clear
    // for UI painting, even if a slow browser callback exhausted the interval.
    if (this.paintPending) {
      this.paintPending = false;
      return 'quiet';
    }
    if (this.minimumRemaining > 0 || (!explicitRedraw && this.recoveryRemaining > 0))
      return 'quiet';
    this.admittedAt = enteredAt;
    return 'ready';
  }

  /** Hidden/covered/loading/non-menu time is neither an observed active gap nor
   * usable control recovery. Keep the genuine pending receipt and any already
   * measured gap; the next eligible poll starts a fresh observation chain. */
  suspend(): void {
    this.admittedAt = null;
    this.callbackAt = null;
    this.recoveryAt = null;
    this.clockAt = null;
  }

  private observeGap(gap: number): void {
    if (Number.isFinite(gap) && gap >= 0) this.longestGap = Math.max(this.longestGap, gap);
  }

  private readClock(): number | null {
    const now = this.now();
    if (
      !Number.isFinite(now) ||
      (this.clockAt !== null && (now < this.clockAt || !Number.isFinite(now - this.clockAt)))
    ) {
      // Invalidate timing, never the renderer's genuine unfinished submission.
      this.suspend();
      this.longestGap = 0;
      this.clockAt = Number.isFinite(now) ? now : null;
      return null;
    }
    this.clockAt = now;
    return now;
  }

  /** A new renderer must submit and complete its own initial menu frame. */
  reset(): void {
    this.owner = null;
    this.pending = false;
    this.paintPending = false;
    this.longestGap = 0;
    this.minimumRemaining = 0;
    this.recoveryRemaining = 0;
    this.suspend();
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
