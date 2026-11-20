/** Keep at most one normal presentation frame in flight without blocking input.
 * TIMEOUT_EXPIRED is not evidence of a stale or completed fence. In particular,
 * gl.finish() has no timeout: putting it behind a one-second timer can still
 * block the browser for the entire remaining GPU workload.
 *
 * Flush once on submission, then poll with a zero timeout across browser tasks.
 * A bounded refresh interval can encourage driver progress, but never releases
 * ownership. Only an observed completion admits the next normal frame. A
 * persistently unresponsive driver fails closed rather than inventing completion.
 */
export class GpuFrameGate {
  private fence: WebGLSync | null = null;
  private disposed = false;
  private failure: string | null = null;
  private submitted = 0;
  private completed = 0;
  private deferred = 0;
  private refreshes = 0;
  private paintPending = false;
  private paintHandoffs = 0;
  private fencedAt = 0;
  private refreshedAt = 0;
  private latency = 0;
  private polledAt = 0;
  private activeWaitMs = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly now: () => number = () => performance.now(),
    readonly minWaitMs = 1000,
    readonly maxWaitMs = 10000,
    readonly stallTimeoutMs = 120000,
  ) {
    if (
      ![minWaitMs, maxWaitMs, stallTimeoutMs].every(Number.isFinite) ||
      minWaitMs <= 0 ||
      maxWaitMs < minWaitMs ||
      stallTimeoutMs <= maxWaitMs
    )
      throw new Error('Invalid GPU frame polling limits');
  }

  /** Smoothed wall time from a submission to an observed GPU completion. */
  get completionLatencyMs() {
    return this.latency;
  }

  /** Refresh cadence only; this is never permission to discard unfinished work. */
  get waitBoundMs() {
    return Math.min(this.maxWaitMs, Math.max(this.minWaitMs, 4 * this.latency));
  }

  ready(reserveSlowPaint = false): boolean {
    const gl = this.gl;
    if (this.disposed || this.failure) return false;
    if (gl.isContextLost()) {
      this.fence = null;
      this.paintPending = false;
      return false;
    }
    if (!this.fence) {
      const handoff = reserveSlowPaint && this.paintPending;
      this.paintPending = false;
      return !handoff;
    }
    const result = gl.clientWaitSync(this.fence, 0, 0);
    const now = this.now();
    const gap = Math.max(0, now - this.polledAt);
    const continuous = gap < 250;
    this.polledAt = now;
    // A hidden tab or a held editor is not evidence of a stalled driver.
    this.activeWaitMs = continuous ? this.activeWaitMs + gap : 0;
    if (result === gl.TIMEOUT_EXPIRED) {
      this.deferred++;
      if (this.activeWaitMs >= this.stallTimeoutMs)
        return this.fail('GPU frame completion stalled; no further frames were submitted');
      if (now - this.refreshedAt >= this.waitBoundMs) {
        gl.flush();
        this.refreshedAt = now;
        this.refreshes++;
      }
      return false;
    }
    if (result !== gl.ALREADY_SIGNALED && result !== gl.CONDITION_SATISFIED)
      return this.fail('Unable to check GPU frame completion');
    const elapsed = now - this.fencedAt;
    if (continuous) this.sample(elapsed);
    this.release();
    this.completed = this.submitted;
    // On a GPU taking a quarter-second or more per frame, let Chromium
    // composite the completed ride before another long WebGL submission.
    // Leave the completion callback and the following RAF free of draws.
    if (reserveSlowPaint && elapsed >= 250) {
      this.paintPending = true;
      this.paintHandoffs++;
      return false;
    }
    return true;
  }

  /** Explicit preparation draws may supersede a fence: the later fence covers
   * all preceding commands. The normal frame loop always calls ready() first. */
  submittedFrame(): void {
    const gl = this.gl;
    if (this.disposed) throw new Error('GPU frame gate is disposed');
    if (this.failure) throw new Error(this.failure);
    this.paintPending = false;
    if (gl.isContextLost()) {
      this.fence = null;
      return;
    }
    this.release();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!this.fence) this.fail('Unable to allocate GPU frame fence');
    this.fencedAt = this.polledAt = this.refreshedAt = this.now();
    this.activeWaitMs = 0;
    this.submitted++;
    gl.flush();
  }

  private fail(message: string): never {
    this.failure = message;
    this.release();
    throw new Error(message);
  }

  private sample(elapsed: number) {
    this.latency = this.latency ? this.latency * 0.8 + elapsed * 0.2 : elapsed;
  }

  diagnostics() {
    return {
      pending: this.fence !== null,
      submitted: this.submitted,
      completed: this.completed,
      deferredCallbacks: this.deferred,
      flushRefreshes: this.refreshes,
      paintHandoffs: this.paintHandoffs,
      pendingMs: this.fence ? Math.max(0, this.now() - this.fencedAt) : 0,
      activeWaitMs: this.fence ? this.activeWaitMs : 0,
      failure: this.failure,
      latencyMs: this.latency,
    };
  }

  private release(): void {
    if (this.fence && !this.gl.isContextLost()) this.gl.deleteSync(this.fence);
    this.fence = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
  }
}
