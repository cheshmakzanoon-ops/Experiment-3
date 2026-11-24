/** Nonblocking elapsed-time queries. Null is unsupported, pending or invalid;
 * RAF duration is never substituted for GPU execution time. */
export class GpuTimer {
  milliseconds: number | null = null;
  sampleSequence = 0;
  readonly supported: boolean;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  private disposed = false;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.supported = !!this.ext;
  }
  private invalidate(lost: boolean) {
    const current = this.current;
    const queries = this.queries;
    this.current = null;
    this.queries = [];
    this.milliseconds = null;
    if (lost) return;
    // Detach ownership first and attempt the rest even if one cleanup throws.
    const failures: unknown[] = [];
    try {
      if (current && this.ext && !this.gl.isContextLost())
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    } catch (error) {
      failures.push(error);
    }
    if (current) queries.push(current);
    for (const query of queries) {
      if (this.gl.isContextLost()) break;
      try {
        this.gl.deleteQuery(query);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }
  begin() {
    const gl = this.gl, ext = this.ext;
    if (this.disposed || !ext) return;
    if (gl.isContextLost()) { this.invalidate(true); return; }
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.invalidate(false); return; }
    if (this.current) return; // An unmatched begin must not nest a GL query.
    const first = this.queries[0];
    if (first && gl.getQueryParameter(first, gl.QUERY_RESULT_AVAILABLE)) {
      const value: unknown = gl.getQueryParameter(first, gl.QUERY_RESULT);
      // A lost context can return null, which arithmetic would coerce to zero.
      // Recheck validity after reading before publishing a completed sample.
      if (gl.isContextLost()) { this.invalidate(true); return; }
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.invalidate(false); return; }
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        this.milliseconds = value / 1e6;
        this.sampleSequence++;
      } else this.milliseconds = null;
      this.queries.shift();
      gl.deleteQuery(first);
    }
    if (this.queries.length >= 4) return;
    this.current = gl.createQuery();
    if (this.current) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.current);
  }
  end() {
    if (this.disposed || !this.ext) return;
    if (this.gl.isContextLost()) { this.invalidate(true); return; }
    if (!this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.current);
    this.current = null;
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.invalidate(false);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate(this.gl.isContextLost());
  }
}
