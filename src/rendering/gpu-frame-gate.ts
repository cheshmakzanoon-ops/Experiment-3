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
  private fencedAt: number | null = null;
  private refreshedAt: number | null = null;
  private latency = 0;
  private polledAt: number | null = null;
  private activeWaitMs = 0;
  private latencySampleValid = false;

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

  /** Smoothed submission-to-completion wall time with uninterrupted polling. */
  get completionLatencyMs() {
    return this.latency;
  }

  /** Refresh cadence only; this is never permission to discard unfinished work. */
  get waitBoundMs() {
    return Math.min(this.maxWaitMs, Math.max(this.minWaitMs, 4 * this.latency));
  }

  ready(): boolean {
    const gl = this.gl;
    if (this.disposed || this.failure) return false;
    if (this.contextLost()) return false;
    if (!this.fence) return true;
    try {
      const result = gl.clientWaitSync(this.fence, 0, 0);
      if (this.contextLost()) return false;
      const now = this.observeClock();
      if (result === gl.TIMEOUT_EXPIRED) {
        this.deferred++;
        if (this.activeWaitMs >= this.stallTimeoutMs)
          return this.fail('GPU frame completion stalled; no further frames were submitted');
        if (now !== null && this.refreshedAt !== null && now - this.refreshedAt >= this.waitBoundMs) {
          gl.flush();
          this.refreshedAt = now;
          this.refreshes++;
          this.contextLost();
        }
        return false;
      }
      if (result !== gl.ALREADY_SIGNALED && result !== gl.CONDITION_SATISFIED)
        return this.fail('Unable to check GPU frame completion');
      this.release();
      if (this.contextLost()) return false;
      if (this.latencySampleValid && now !== null && this.fencedAt !== null)
        this.sample(now - this.fencedAt);
      this.completed = this.submitted;
      return true;
    } catch (error) {
      return this.fail(this.failure ?? 'Unable to check GPU frame completion', error);
    }
  }

  /** Explicit preparation draws may supersede a fence: the later fence covers
   * all preceding commands. The normal frame loop always calls ready() first. */
  submittedFrame(): void {
    const gl = this.gl;
    if (this.disposed) throw new Error('GPU frame gate is disposed');
    if (this.contextLost()) return;
    if (this.failure) throw new Error(this.failure);
    try {
      this.release();
      this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (this.contextLost()) return;
      if (!this.fence) this.fail('Unable to allocate GPU frame fence');
      const now = this.now();
      this.fencedAt = this.polledAt = this.refreshedAt = Number.isFinite(now) ? now : null;
      this.latencySampleValid = this.fencedAt !== null;
      this.activeWaitMs = 0;
      this.submitted++;
      gl.flush();
      this.contextLost();
    } catch (error) {
      this.fail(this.failure ?? 'Unable to submit GPU frame fence', error);
    }
  }

  private fail(message: string, cause?: unknown): never {
    this.failure = message;
    try {
      this.release();
    } catch (error) {
      cause ??= error;
    }
    throw new Error(message, { cause });
  }

  private contextLost(): boolean {
    if (!this.gl.isContextLost()) return false;
    // A restored context cannot complete work owned by this gate's old context.
    this.failure ??= 'GPU context lost; pending frames cannot be completed';
    this.fence = null;
    this.activeWaitMs = 0;
    return true;
  }

  private observeClock(): number | null {
    const value = this.now();
    const now = Number.isFinite(value) ? value : null;
    const gap = now !== null && this.polledAt !== null ? now - this.polledAt : NaN;
    const continuous = Number.isFinite(gap) && gap >= 0 && gap < 250;
    // An interrupted polling chain invalidates this submission's latency sample,
    // even if polling resumes before completion. Clock resets retain the fence.
    if (!continuous) this.latencySampleValid = false;
    if (!Number.isFinite(gap) || gap < 0) {
      this.fencedAt = null;
      this.refreshedAt = now;
    }
    this.polledAt = now;
    this.activeWaitMs = continuous ? this.activeWaitMs + gap : 0;
    return now;
  }

  private sample(elapsed: number) {
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    this.latency = this.latency ? this.latency * 0.8 + elapsed * 0.2 : elapsed;
  }

  diagnostics() {
    const elapsed = this.fence && this.fencedAt !== null ? this.now() - this.fencedAt : 0;
    return {
      pending: this.fence !== null,
      submitted: this.submitted,
      completed: this.completed,
      deferredCallbacks: this.deferred,
      flushRefreshes: this.refreshes,
      pendingMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
      activeWaitMs: this.fence ? this.activeWaitMs : 0,
      failure: this.failure,
      latencyMs: this.latency,
    };
  }

  private release(): void {
    const fence = this.fence;
    this.fence = null;
    if (fence && !this.gl.isContextLost()) this.gl.deleteSync(fence);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
  }
}
