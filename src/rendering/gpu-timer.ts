/** Nonblocking elapsed-time queries. Null is unsupported, pending or invalid;
 * RAF duration is never substituted for GPU execution time. */
export class GpuTimer {
  milliseconds: number | null = null;
  sampleSequence = 0;
  /** Extension capability; a thrown GL operation disables this instance's sampling. */
  readonly supported: boolean;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  private currentBegun = false;
  private disposed = false;
  private disabled = false;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = null;
    try {
      this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    } catch {
      // Optional instrumentation must not prevent renderer construction.
    }
    this.supported = !!this.ext;
  }
  private invalidate(lost: boolean) {
    const current = this.current;
    const begun = this.currentBegun;
    const queries = this.queries;
    this.current = null;
    this.currentBegun = false;
    this.queries = [];
    this.milliseconds = null;
    if (lost) return;
    // Detach ownership first and attempt the rest even if one cleanup throws.
    const failures: unknown[] = [];
    const contextLost = () => {
      try {
        return this.gl.isContextLost();
      } catch (error) {
        failures.push(error);
        // Unknown status must not strand the remaining handles. Cleanup is
        // best effort, but a positively lost context never receives GL calls.
        return false;
      }
    };
    try {
      if (current && begun && this.ext && !contextLost())
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    } catch (error) {
      failures.push(error);
    }
    if (current) queries.push(current);
    for (const query of queries) {
      if (contextLost()) break;
      try {
        this.gl.deleteQuery(query);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }
  private disable() {
    // Do not repeatedly allocate or retry driver calls after an instrumentation
    // failure. A new renderer/context constructs a fresh timer when appropriate.
    this.disabled = true;
    try {
      this.invalidate(false);
    } catch {
      // Live timing cleanup cannot suppress rendering or replace its exception.
    }
  }
  begin() {
    const gl = this.gl,
      ext = this.ext;
    if (this.disposed || this.disabled || !ext) return;
    try {
      if (gl.isContextLost()) {
        this.invalidate(true);
        return;
      }
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.invalidate(false);
        return;
      }
      if (this.current) return; // An unmatched begin must not nest a GL query.
      let sample: number | null | undefined;
      const first = this.queries[0];
      if (first && gl.getQueryParameter(first, gl.QUERY_RESULT_AVAILABLE)) {
        const value: unknown = gl.getQueryParameter(first, gl.QUERY_RESULT);
        // A lost context can return null, which arithmetic would coerce to zero.
        // Recheck validity after reading before publishing a completed sample.
        if (gl.isContextLost()) {
          this.invalidate(true);
          return;
        }
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          this.invalidate(false);
          return;
        }
        sample =
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value / 1e6 : null;
        // Retire before deletion: a thrown delete must never retry this handle.
        this.queries.shift();
        gl.deleteQuery(first);
      }
      if (this.queries.length >= 4) return;
      this.current = gl.createQuery();
      if (this.current) {
        // Own an allocated but not-yet-started query separately so cleanup
        // never ends a query whose begin failed.
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.current);
        this.currentBegun = true;
      }
      // Commit a sample only after this polling/start operation succeeded.
      if (sample !== undefined) {
        this.milliseconds = sample;
        if (sample !== null) this.sampleSequence++;
      }
    } catch {
      this.disable();
    }
  }
  end() {
    if (this.disposed || this.disabled || !this.ext) return;
    try {
      if (this.gl.isContextLost()) {
        this.invalidate(true);
        return;
      }
      if (!this.current) return;
      const current = this.current;
      this.current = null;
      this.currentBegun = false;
      // Ending is attempted once. If it throws, cleanup deletes this handle
      // with the pending set instead of attempting another end.
      this.queries.push(current);
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.invalidate(false);
    } catch {
      this.disable();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate(false);
  }
}
