/** Nonblocking WebGL2 timestamp queries. Null means unsupported/no valid sample,
 * never a fabricated GPU estimate inferred from requestAnimationFrame time. */
export class GpuTimer {
  milliseconds: number | null = null;
  readonly supported: boolean;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.supported = !!this.ext;
  }
  begin() {
    const gl = this.gl,
      ext = this.ext;
    if (!ext || gl.isContextLost()) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const query of this.queries) gl.deleteQuery(query);
      this.queries.length = 0;
      this.milliseconds = null;
    }
    const first = this.queries[0];
    if (first && gl.getQueryParameter(first, gl.QUERY_RESULT_AVAILABLE)) {
      const value = gl.getQueryParameter(first, gl.QUERY_RESULT) / 1e6;
      if (Number.isFinite(value)) this.milliseconds = value;
      gl.deleteQuery(first);
      this.queries.shift();
    }
    if (this.queries.length >= 4 || this.current) return;
    this.current = gl.createQuery();
    if (this.current) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.current);
  }
  end() {
    if (!this.current || !this.ext) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.current);
    this.current = null;
  }
  dispose() {
    if (this.current && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.current);
    }
    for (const query of this.queries) this.gl.deleteQuery(query);
    this.current = null;
    this.queries.length = 0;
  }
}
