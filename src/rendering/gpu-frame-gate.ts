/** Bound the normal presentation loop to one unfinished GPU submission.
 * Polling never waits: physics, input and the browser compositor keep running
 * while the next draw coalesces to the latest available simulation snapshot.
 */
export class GpuFrameGate {
  private fence: WebGLSync | null = null;
  private disposed = false;
  private submitted = 0;
  private completed = 0;
  private deferred = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  ready(): boolean {
    const gl = this.gl;
    if (this.disposed) return false;
    if (gl.isContextLost()) {
      // Context loss already invalidated the handle; do not use it again.
      this.fence = null;
      return false;
    }
    if (!this.fence) return true;
    const result = gl.clientWaitSync(this.fence, 0, 0);
    if (result === gl.TIMEOUT_EXPIRED) {
      this.deferred++;
      return false;
    }
    if (result !== gl.ALREADY_SIGNALED && result !== gl.CONDITION_SATISFIED) {
      this.release();
      throw new Error('Unable to check GPU frame completion');
    }
    this.release();
    this.completed = this.submitted;
    return true;
  }

  /** Fence all passes of the completed submission, not just its main camera.
   * Explicit warmup/inspection draws may replace the fence; the newer fence
   * includes all preceding commands and still owns only one live GL handle.
   */
  submittedFrame(): void {
    const gl = this.gl;
    if (this.disposed) throw new Error('GPU frame gate is disposed');
    if (gl.isContextLost()) {
      this.fence = null;
      return;
    }
    this.release();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!this.fence) throw new Error('Unable to allocate GPU frame fence');
    this.submitted++;
    // Nonblocking submission is required so later zero-timeout polls can
    // observe completion even when no additional draw is sent to the driver.
    gl.flush();
  }

  diagnostics() {
    return {
      pending: this.fence !== null,
      submitted: this.submitted,
      completed: this.completed,
      deferredCallbacks: this.deferred,
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
