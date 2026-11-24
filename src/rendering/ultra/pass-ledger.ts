/**
 * Per-pass accounting for the ULTRA modules.
 *
 * The frame-level DrawLedger attributes draws to fixed phases (environment,
 * probe, mirrors, wet, shadow, composer, other); the ULTRA passes all run
 * inside `composer` (their shadow cascade inside `shadow`), so its phase totals
 * stay exact and comparable with the pinned baselines. This sub-ledger splits
 * that work per ULTRA pass - draw calls, triangles, frames run - and, where the
 * browser exposes GPU timestamps (EXT_disjoint_timer_query_webgl2 with
 * QUERY_COUNTER_BITS > 0), the GPU milliseconds of each pass, read back
 * asynchronously a few frames later. Without timestamps `gpuMs` stays null:
 * RAF time is never substituted. Frame totals still come from GpuTimer.
 */
export interface RenderInfoLike {
  calls: number;
  triangles: number;
}
interface TimerExtension {
  TIMESTAMP_EXT: number;
  QUERY_COUNTER_BITS_EXT: number;
  GPU_DISJOINT_EXT: number;
  queryCounterEXT(query: WebGLQuery, target: number): void;
}
interface PassRecord {
  calls: number;
  triangles: number;
  frames: number;
  gpuMs: number | null;
  /** Static estimate: texture fetches per frame at the current size (millions). */
  fetchesM: number;
}
interface PendingQuery {
  name: string;
  start: WebGLQuery;
  end: WebGLQuery;
}

export class GpuPassTimer {
  readonly supported: boolean;
  private readonly ext: TimerExtension | null;
  private pending: PendingQuery[] = [];
  private active = new Set<PendingQuery>();
  private disposed = false;
  constructor(private readonly gl: WebGL2RenderingContext | null) {
    let ext: TimerExtension | null = null;
    try {
      if (gl && !gl.isContextLost()) {
        const candidate = gl.getExtension(
          'EXT_disjoint_timer_query_webgl2',
        ) as TimerExtension | null;
        const bits: unknown = candidate
          ? gl.getQuery(candidate.TIMESTAMP_EXT, candidate.QUERY_COUNTER_BITS_EXT)
          : 0;
        if (typeof bits === 'number' && Number.isFinite(bits) && bits > 0) ext = candidate;
      }
    } catch {
      // Timing is optional; probing it must not prevent the pipeline starting.
    }
    this.ext = ext;
    this.supported = !!ext;
  }
  private valid() {
    const gl = this.gl,
      ext = this.ext;
    if (!gl || !ext || this.disposed) return false;
    try {
      return !gl.isContextLost() && !gl.getParameter(ext.GPU_DISJOINT_EXT) && !gl.isContextLost();
    } catch {
      return false;
    }
  }
  private release(query: WebGLQuery | null) {
    if (!query || !this.gl) return;
    try {
      if (!this.gl.isContextLost()) this.gl.deleteQuery(query);
    } catch {
      // Retire ownership even if an optional timing cleanup fails.
    }
  }
  private invalidate() {
    const pending = this.pending,
      active = this.active;
    this.pending = [];
    this.active = new Set();
    for (const q of pending) {
      this.release(q.start);
      this.release(q.end);
    }
    for (const q of active) {
      this.release(q.start);
      this.release(q.end);
    }
  }
  private begin(name: string): PendingQuery | null {
    const gl = this.gl,
      ext = this.ext;
    if (!gl || !ext || this.disposed) return null;
    if (!this.valid()) {
      this.invalidate();
      return null;
    }
    if (this.pending.length + this.active.size >= 48) return null;
    let start: WebGLQuery | null = null,
      end: WebGLQuery | null = null;
    let q: PendingQuery | null = null;
    try {
      start = gl.createQuery();
      if (!start) return null;
      end = gl.createQuery();
      if (!end) {
        this.release(start);
        return null;
      }
      q = { name, start, end };
      this.active.add(q);
      ext.queryCounterEXT(start, ext.TIMESTAMP_EXT);
      if (!this.valid()) {
        this.invalidate();
        return null;
      }
      return q;
    } catch {
      if (q) this.active.delete(q);
      this.release(start);
      this.release(end);
      return null;
    }
  }
  private end(q: PendingQuery | null) {
    // Disposal (including from a nested render) may already have retired it.
    if (!q || !this.active.delete(q)) return;
    if (!this.valid()) {
      this.release(q.start);
      this.release(q.end);
      this.invalidate();
      return;
    }
    try {
      this.ext!.queryCounterEXT(q.end, this.ext!.TIMESTAMP_EXT);
      if (this.valid()) {
        this.pending.push(q);
        return;
      }
      this.invalidate();
    } catch {
      // Do not mask an exception from the actual rendering callback.
    }
    this.release(q.start);
    this.release(q.end);
  }
  /** Bracket `fn` with optional timestamps; rendering always runs once. */
  measure(name: string, fn: () => void) {
    const q = this.begin(name);
    try {
      fn();
    } finally {
      this.end(q);
    }
  }
  /** Collect finished queries without waiting; reports only valid samples. */
  poll(report: (name: string, ms: number) => void) {
    const gl = this.gl;
    if (!gl || !this.ext || this.disposed) return;
    if (!this.valid()) {
      this.invalidate();
      return;
    }
    while (this.pending.length) {
      const q = this.pending[0];
      let start: unknown, end: unknown;
      try {
        if (!gl.getQueryParameter(q.end, gl.QUERY_RESULT_AVAILABLE)) {
          if (!this.valid()) this.invalidate();
          return;
        }
        start = gl.getQueryParameter(q.start, gl.QUERY_RESULT);
        end = gl.getQueryParameter(q.end, gl.QUERY_RESULT);
        if (!this.valid()) {
          this.invalidate();
          return;
        }
      } catch {
        this.invalidate();
        return;
      }
      // A reporting callback may throw, dispose the timer, or poll it again.
      // Retire this sample first so none of those paths can retain/replay it.
      this.pending.shift();
      this.release(q.start);
      this.release(q.end);
      if (
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end >= start
      ) {
        const ns = end - start;
        if (Number.isFinite(ns)) report(q.name, ns / 1e6);
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
  }
}

export class PassLedger {
  private readonly records = new Map<string, PassRecord>();
  constructor(
    private readonly info: RenderInfoLike,
    private readonly timer: GpuPassTimer | null = null,
  ) {}
  private record(name: string) {
    let r = this.records.get(name);
    if (!r) {
      r = { calls: 0, triangles: 0, frames: 0, gpuMs: null, fetchesM: 0 };
      this.records.set(name, r);
    }
    return r;
  }
  /** Run `fn` as pass `name` of this frame (counts replace last frame's). */
  measure<R>(name: string, fn: () => R): R {
    const r = this.record(name);
    const calls = this.info.calls,
      triangles = this.info.triangles;
    let result!: R;
    const run = () => {
      result = fn();
    };
    try {
      if (this.timer) this.timer.measure(name, run);
      else run();
    } finally {
      r.calls = this.info.calls - calls;
      r.triangles = this.info.triangles - triangles;
      r.frames++;
    }
    return result;
  }
  /** Static per-frame fetch estimate (millions of texture fetches). */
  estimate(name: string, fetches: number) {
    this.record(name).fetchesM = Number.isFinite(fetches) ? fetches / 1e6 : 0;
  }
  /** Mark a pass idle this frame (its counts read zero). */
  idle(name: string) {
    const r = this.record(name);
    r.calls = 0;
    r.triangles = 0;
  }
  poll() {
    this.timer?.poll((name, ms) => {
      const r = this.record(name);
      // Exponential average over ~10 samples; null until the first result.
      r.gpuMs = r.gpuMs === null ? ms : r.gpuMs * 0.9 + ms * 0.1;
    });
  }
  snapshot() {
    const out: Record<string, PassRecord> = {};
    for (const [name, r] of this.records) out[name] = { ...r };
    return out;
  }
}

/** Wrap an object's `render` method so every call is measured as `name`. */
export function instrumentRender<O extends { render: (...args: never[]) => unknown }>(
  object: O,
  name: string,
  ledger: PassLedger,
) {
  const original = object.render.bind(object) as (...args: unknown[]) => unknown;
  (object as unknown as { render: (...args: unknown[]) => unknown }).render = (
    ...args: unknown[]
  ) => ledger.measure(name, () => original(...args));
  return object;
}
