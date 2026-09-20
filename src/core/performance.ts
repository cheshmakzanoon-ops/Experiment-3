/** Frame timings are observations, not a claim about an untested computer.
 * Capture complete intervals without clamping hitches or averaging FPS values. */
export const PROFILE_COLUMNS = [
  'frame_ms', 'render_cpu_ms', 'reported_physics_tick_ms', 'draw_calls', 'triangles', 'gpu_ms',
] as const;
export const PROFILE_LIMIT = 30000;
export type ProfileState = 'idle' | 'warming' | 'recording' | 'complete' | 'interrupted';
export interface ProfileContext {
  machine: string;
  workload: string;
  configuration: string;
  browser: string;
  source: string;
}
export interface FrameMetrics {
  renderCPUms: number;
  physicsMs: number;
  drawCalls: number;
  triangles: number;
  gpuMs: number | null;
  gpuSequence: number;
}
export interface PerformanceReport {
  version: 1;
  context: ProfileContext;
  state: 'complete' | 'interrupted';
  reason: string | null;
  warmupMs: number;
  targetMs: number;
  columns: typeof PROFILE_COLUMNS;
  rows: number[][];
  summary: ReturnType<typeof summarizePerformance>;
}
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const label = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= max && !Array.from(s).some((c) => c.charCodeAt(0) < 32);
function validateContext(c: ProfileContext) {
  if (!c || !label(c.machine, 80) || !label(c.workload, 120) ||
      !label(c.configuration, 32000) || !label(c.browser, 1024) ||
      !/^[a-f0-9]{64}$/.test(c.source)) throw new Error('Invalid performance capture identity');
}
/** Nearest-rank percentile, independently defined from mean of slowest 1%. */
function percentile(sorted: number[], fraction: number) {
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : 0;
}
export function summarizePerformance(rows: readonly (readonly number[])[]) {
  if (rows.length > PROFILE_LIMIT) throw new Error('Performance sample limit exceeded');
  const frames: number[] = [], cpu: number[] = [], gpu: number[] = [];
  let elapsedMs = 0, cpuMs = 0, physicsMs = 0, calls = 0, triangles = 0,
    maximumDrawCalls = 0, maximumTriangles = 0;
  for (const row of rows) {
    if (row.length !== PROFILE_COLUMNS.length || row.some((v) => !Number.isFinite(v)) ||
        row[0] <= 0 || row.slice(1, 5).some((v) => v < 0) ||
        !Number.isInteger(row[3]) || !Number.isInteger(row[4]) ||
        (row[5] < 0 && row[5] !== -1)) throw new Error('Invalid performance sample');
    frames.push(row[0]); cpu.push(row[1]);
    if (row[5] >= 0) gpu.push(row[5]);
    elapsedMs += row[0]; cpuMs += row[1]; physicsMs += row[2];
    calls += row[3]; triangles += row[4];
    maximumDrawCalls = Math.max(maximumDrawCalls, row[3]);
    maximumTriangles = Math.max(maximumTriangles, row[4]);
  }
  if (![elapsedMs, cpuMs, physicsMs, calls, triangles].every(Number.isFinite))
    throw new Error('Performance accumulation overflow');
  frames.sort((a, b) => a - b); cpu.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
  const n = rows.length, slowCount = Math.ceil(n * 0.01);
  let slowSum = 0;
  for (let i = n - slowCount; i < n; i++) slowSum += frames[i];
  return {
    samples: n, elapsedMs,
    averageFPS: elapsedMs ? 1000 * n / elapsedMs : 0,
    onePercentLowFPS: slowSum ? 1000 * slowCount / slowSum : 0,
    p99FrameMs: percentile(frames, 0.99),
    maximumFrameMs: frames[n - 1] ?? 0,
    averageRenderCPUms: n ? cpuMs / n : 0,
    p99RenderCPUms: percentile(cpu, 0.99),
    averageReportedPhysicsTickMs: n ? physicsMs / n : 0,
    averageDrawCalls: n ? calls / n : 0, maximumDrawCalls,
    averageTriangles: n ? triangles / n : 0, maximumTriangles,
    gpuSamples: gpu.length,
    medianGPUms: gpu.length ? percentile(gpu, 0.5) : null,
    p99GPUms: gpu.length ? percentile(gpu, 0.99) : null,
  };
}
/** Opt-in, bounded, allocation-free hot path. A pause invalidates the run rather
 * than silently removing an inconvenient interval from a benchmark. */
export class PerformanceCapture {
  state: ProfileState = 'idle';
  reason: string | null = null;
  count = 0;
  elapsedMs = 0;
  private data: Float64Array | null = null;
  private context: ProfileContext | null = null;
  private startedAt = 0;
  private previousAt = 0;
  private lastGPU = 0;
  constructor(readonly warmupMs = 5000, readonly targetMs = 30000) {
    if (!Number.isFinite(warmupMs) || warmupMs < 0 || warmupMs > 60000 ||
        !Number.isFinite(targetMs) || targetMs < 1000 || targetMs > 120000)
      throw new Error('Invalid performance capture duration');
  }
  get active() { return this.state === 'warming' || this.state === 'recording'; }
  start(context: ProfileContext, now: number) {
    validateContext(context);
    if (!Number.isFinite(now)) throw new Error('Invalid performance clock');
    this.data ??= new Float64Array(PROFILE_LIMIT * PROFILE_COLUMNS.length);
    this.context = { ...context };
    this.startedAt = this.previousAt = now;
    this.state = 'warming'; this.reason = null; this.count = 0; this.elapsedMs = 0;
    this.lastGPU = 0;
  }
  interrupt(reason: string) {
    if (!this.active) return;
    this.state = 'interrupted'; this.reason = reason;
  }
  record(now: number, metrics: FrameMetrics) {
    if (!this.active) return;
    if (!Number.isFinite(now) || now <= this.previousAt) {
      this.interrupt('Non-monotonic frame clock'); return;
    }
    if (this.state === 'warming') {
      this.previousAt = now;
      this.lastGPU = metrics.gpuSequence;
      if (now - this.startedAt >= this.warmupMs) this.state = 'recording';
      return; // Never count an interval which straddles the warm-up boundary.
    }
    const delta = now - this.previousAt;
    if (!nonnegative(metrics.renderCPUms) || !nonnegative(metrics.physicsMs) ||
      !nonnegative(metrics.drawCalls) || !nonnegative(metrics.triangles) ||
      !nonnegative(metrics.gpuSequence) ||
      !Number.isInteger(metrics.drawCalls) || !Number.isInteger(metrics.triangles) ||
      !Number.isInteger(metrics.gpuSequence) ||
      (metrics.gpuMs !== null && (!Number.isFinite(metrics.gpuMs) || metrics.gpuMs < 0))) {
      this.interrupt('Invalid measured frame'); return;
    }
    if (this.count === PROFILE_LIMIT) { this.interrupt('Frame capacity exhausted'); return; }
    const p = this.count * PROFILE_COLUMNS.length, data = this.data!;
    data[p] = delta; data[p + 1] = metrics.renderCPUms; data[p + 2] = metrics.physicsMs;
    data[p + 3] = metrics.drawCalls; data[p + 4] = metrics.triangles;
    // GPU results arrive asynchronously. Count each completed query once, not
    // repeatedly on every RAF while the previous result remains visible.
    data[p + 5] = metrics.gpuMs !== null && metrics.gpuSequence > this.lastGPU ? metrics.gpuMs : -1;
    this.lastGPU = metrics.gpuSequence;
    this.previousAt = now; this.count++; this.elapsedMs += delta;
    if (this.elapsedMs >= this.targetMs) this.state = 'complete';
  }
  report(): PerformanceReport | null {
    if (!this.context || (this.state !== 'complete' && this.state !== 'interrupted')) return null;
    const rows = Array.from({ length: this.count }, (_, i) =>
      Array.from(this.data!.subarray(i * PROFILE_COLUMNS.length, (i + 1) * PROFILE_COLUMNS.length)));
    return {
      version: 1, context: { ...this.context }, state: this.state,
      reason: this.reason, warmupMs: this.warmupMs, targetMs: this.targetMs,
      columns: PROFILE_COLUMNS, rows, summary: summarizePerformance(rows),
    };
  }
}
/** Recompute summaries from original samples. Never trust an edited summary or
 * accept truncated, interrupted or non-finite evidence as a passing benchmark. */
export function readPerformanceReport(value: unknown): PerformanceReport {
  if (!value || typeof value !== 'object') throw new Error('Invalid performance report');
  const r = value as PerformanceReport;
  validateContext(r.context);
  if (r.version !== 1 || !['complete', 'interrupted'].includes(r.state) ||
      (r.reason !== null && !label(r.reason, 500)) ||
      JSON.stringify(r.columns) !== JSON.stringify(PROFILE_COLUMNS) ||
      !Array.isArray(r.rows) || r.rows.some((row) => !Array.isArray(row)))
    throw new Error('Invalid performance report schema');
  if (!Number.isFinite(r.warmupMs) || !Number.isFinite(r.targetMs))
    throw new Error('Missing performance duration');
  new PerformanceCapture(r.warmupMs, r.targetMs); // Validate duration bounds.
  const summary = summarizePerformance(r.rows);
  if (r.state === 'complete' && (r.reason !== null || summary.elapsedMs < r.targetMs))
    throw new Error('Incomplete timing evidence');
  return { ...r, context: { ...r.context }, summary };
}
export function comparePerformance(before: PerformanceReport, after: PerformanceReport) {
  before = readPerformanceReport(before); after = readPerformanceReport(after);
  const reasons: string[] = [];
  for (const key of ['machine', 'workload', 'configuration', 'browser'] as const)
    if (before.context[key] !== after.context[key]) reasons.push(`Different ${key}`);
  if (before.warmupMs !== after.warmupMs || before.targetMs !== after.targetMs)
    reasons.push('Different capture duration');
  for (const [name, report] of [['baseline', before], ['candidate', after]] as const) {
    if (report.state !== 'complete') reasons.push(`${name} was interrupted`);
    if (report.summary.samples < 300 || report.summary.elapsedMs < 10000)
      reasons.push(`${name} has insufficient samples (300 frames and 10 seconds required)`);
  }
  if (reasons.length) return { comparable: false, passed: false, reasons, checks: [] };
  const limits = [
    ['averageFPS', 'minimum', 0.9], ['onePercentLowFPS', 'minimum', 0.85],
    ['averageRenderCPUms', 'maximum', 1.15], ['p99RenderCPUms', 'maximum', 1.2],
    ['averageDrawCalls', 'maximum', 1.1], ['averageTriangles', 'maximum', 1.1],
  ] as const;
  const checks = limits.map(([metric, direction, factor]) => {
    const baseline = before.summary[metric], candidate = after.summary[metric];
    const threshold = baseline * factor;
    // Small absolute CPU tolerance avoids flagging timer-quantization noise at zero.
    const tolerance = metric.endsWith('CPUms') ? 0.05 : 1e-7;
    return { metric, baseline, candidate, threshold, passed: direction === 'minimum'
      ? candidate >= threshold - tolerance : candidate <= threshold + tolerance };
  });
  return { comparable: true, passed: checks.every((c) => c.passed), reasons, checks };
}
