import { summarizePerformance, type FrameMetrics } from '../core/performance.ts';

export const REVIEW_LIMIT = 30000;
export const REVIEW_COLUMNS = [
  'frame_ms',
  'render_cpu_ms',
  'reported_physics_tick_ms',
  'draw_calls',
  'triangles',
  'gpu_ms',
  'simulation_time',
  'track_s',
  'completed_laps',
  'camera_x',
  'camera_y',
  'camera_z',
  'camera_qx',
  'camera_qy',
  'camera_qz',
  'camera_qw',
  'vertical_fov',
  'broadcast_rig',
  'exposure',
  'texture_resources',
  'geometry_resources',
  'shader_programs',
  'near_cars',
  'mid_cars',
  'far_cars',
  'rain',
  'cloud',
  'water',
  'mirror_updates',
  'probe_updates',
] as const;
export const REVIEW_WORKLOADS = [
  'clear-day',
  'overcast-day',
  'wet-day',
  'wet-night',
  'grid-start',
  'pit-service',
  'other',
] as const;
export type ReviewWorkload = (typeof REVIEW_WORKLOADS)[number];
export type ReviewCamera = 'cockpit' | 'chase' | 'pod' | 'trackside';
export interface ReviewContext {
  source: string;
  machine: string;
  browser: string;
  configuration: string;
  workload: ReviewWorkload;
  camera: ReviewCamera;
  mode: 'full-lap' | 'timed-scene';
  trackLength: number;
  startS: number;
  startLaps: number;
  startTime: number;
  followedCar: number;
  videoRequested: boolean;
}
/** Reused by the renderer; no stats() snapshot or per-frame scene traversal. */
export interface ReviewFrame extends FrameMetrics {
  time: number;
  s: number;
  laps: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  fov: number;
  rig: number;
  exposure: number;
  textures: number;
  geometries: number;
  programs: number;
  nearCars: number;
  midCars: number;
  farCars: number;
  rain: number;
  cloud: number;
  water: number;
  mirrors: number;
  probes: number;
}
export function reviewFrame(): ReviewFrame {
  return {
    renderCPUms: 0,
    physicsMs: 0,
    drawCalls: 0,
    triangles: 0,
    gpuMs: null,
    gpuSequence: 0,
    time: 0,
    s: 0,
    laps: 0,
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    fov: 45,
    rig: -1,
    exposure: 1,
    textures: 0,
    geometries: 0,
    programs: 0,
    nearCars: 0,
    midCars: 0,
    farCars: 0,
    rain: 0,
    cloud: 0,
    water: 0,
    mirrors: 0,
    probes: 0,
  };
}
const CAMERA_MODES = ['cockpit', 'chase', 'pod', 'trackside'];
const label = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.length <= max &&
  !Array.from(v).some((c) => c.charCodeAt(0) < 32);
function validateContext(c: ReviewContext) {
  if (
    !c ||
    !/^[a-f0-9]{64}$/.test(c.source) ||
    !label(c.machine, 80) ||
    !label(c.browser, 1024) ||
    !label(c.configuration, 32000) ||
    !REVIEW_WORKLOADS.includes(c.workload) ||
    !CAMERA_MODES.includes(c.camera) ||
    !['full-lap', 'timed-scene'].includes(c.mode) ||
    !Number.isFinite(c.trackLength) ||
    c.trackLength < 100 ||
    c.trackLength > 100000 ||
    !Number.isFinite(c.startS) ||
    c.startS < 0 ||
    c.startS >= c.trackLength ||
    !Number.isInteger(c.startLaps) ||
    c.startLaps < 0 ||
    c.startLaps > 100000 ||
    !Number.isFinite(c.startTime) ||
    c.startTime < 0 ||
    !Number.isInteger(c.followedCar) ||
    c.followedCar < 0 ||
    c.followedCar >= 12 ||
    typeof c.videoRequested !== 'boolean'
  )
    throw new Error('Invalid presentation review identity');
}
export function matchesReviewWeather(
  workload: ReviewWorkload,
  rain: number,
  cloud: number,
  night: boolean,
) {
  if (![rain, cloud].every(Number.isFinite) || rain < 0 || cloud < 0 || cloud > 1) return false;
  switch (workload) {
    case 'clear-day':
      return !night && rain === 0 && cloud < 0.5;
    case 'overcast-day':
      return !night && rain === 0 && cloud >= 0.5;
    case 'wet-day':
      return !night && rain > 0;
    case 'wet-night':
      return night && rain > 0;
    default:
      return true;
  }
}
export type ReviewState = 'idle' | 'recording' | 'complete' | 'interrupted';
export interface PresentationReport {
  version: 1;
  state: 'complete' | 'interrupted';
  reason: string | null;
  context: ReviewContext;
  columns: typeof REVIEW_COLUMNS;
  rows: number[][];
  progressM: number;
  evidence: 'rendered-frame-observations-not-visual-acceptance';
  summary: ReturnType<typeof summarizePresentation>;
}
const percentile = (values: number[], fraction: number) =>
  values.length ? values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
export function summarizePresentation(rows: readonly (readonly number[])[]) {
  if (rows.length > REVIEW_LIMIT) throw new Error('Presentation sample limit exceeded');
  for (const row of rows) {
    if (
      row.length !== REVIEW_COLUMNS.length ||
      row.some((v) => !Number.isFinite(v)) ||
      row.slice(6, 9).some((v) => v < 0) ||
      row[16] <= 0 ||
      row[16] >= 180 ||
      row[18] <= 0 ||
      row.slice(19).some((v) => v < 0)
    )
      throw new Error('Invalid presentation sample');
  }
  const performance = summarizePerformance(rows.map((r) => r.slice(0, 6)));
  let cuts = 0,
    maximumCameraStepM = 0,
    maximumUncutCameraStepM = 0,
    maximumFovStep = 0,
    maximumExposureStep = 0;
  const maxima = new Array<number>(11).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let n = 19; n < 30; n++) maxima[n - 19] = Math.max(maxima[n - 19], r[n]);
    if (!i) continue;
    const p = rows[i - 1],
      cut = r[17] !== p[17];
    if (cut) cuts++;
    const step = Math.hypot(r[9] - p[9], r[10] - p[10], r[11] - p[11]);
    maximumCameraStepM = Math.max(maximumCameraStepM, step);
    if (!cut) maximumUncutCameraStepM = Math.max(maximumUncutCameraStepM, step);
    maximumFovStep = Math.max(maximumFovStep, Math.abs(r[16] - p[16]));
    maximumExposureStep = Math.max(maximumExposureStep, Math.abs(r[18] - p[18]));
  }
  return {
    ...performance,
    p95FrameMs: percentile(
      rows.map((r) => r[0]),
      0.95,
    ),
    p95RenderCPUms: percentile(
      rows.map((r) => r[1]),
      0.95,
    ),
    cuts,
    maximumCameraStepM,
    maximumUncutCameraStepM,
    maximumFovStep,
    maximumExposureStep,
    maximumTextures: maxima[0],
    maximumGeometries: maxima[1],
    maximumPrograms: maxima[2],
    rainRange: rows.length ? [Math.min(...rows.map((r) => r[25])), maxima[6]] : null,
    gpuVRAMBytes: null, // WebGL resource counts are NOT a measurement of device VRAM.
    visualAccepted: false,
  };
}

/** Records every submitted frame, including stalls. A completed full-lap review
 * requires forward road progress AND an actual completed-lap counter increase.
 * It does not claim the lap was valid, the art was approved, or the video encoder
 * preserved every submitted frame. Pauses/settings/visibility changes interrupt. */
export class PresentationReview {
  state: ReviewState = 'idle';
  reason: string | null = null;
  count = 0;
  progressM = 0;
  elapsedMs = 0;
  private data: Float64Array | null = null;
  private identity: ReviewContext | null = null;
  private previousAt = 0;
  private previousS = 0;
  private previousTime = 0;
  private previousLaps = 0;
  private previousProgressTime = 0;
  private lastGPU = 0;
  get active() {
    return this.state === 'recording';
  }
  get context() {
    return this.identity ? { ...this.identity } : null;
  }
  start(context: ReviewContext, now: number, initialGPUSequence = 0) {
    if (this.active) throw new Error('A presentation review is already recording');
    validateContext(context);
    if (!Number.isFinite(now) || !Number.isInteger(initialGPUSequence) || initialGPUSequence < 0)
      throw new Error('Invalid presentation clock');
    this.identity = { ...context };
    this.data ??= new Float64Array(REVIEW_LIMIT * REVIEW_COLUMNS.length);
    this.previousAt = now;
    this.previousS = context.startS;
    this.previousTime = this.previousProgressTime = context.startTime;
    this.previousLaps = context.startLaps;
    this.state = 'recording';
    this.reason = null;
    this.count = 0;
    this.progressM = 0;
    this.elapsedMs = 0;
    this.lastGPU = initialGPUSequence;
  }
  interrupt(reason: string) {
    if (!this.active) return;
    this.state = 'interrupted';
    this.reason = reason.slice(0, 500);
  }
  record(now: number, frame: ReviewFrame) {
    if (!this.active) return;
    const c = this.identity!,
      data = this.data!;
    if (
      !Number.isFinite(now) ||
      now <= this.previousAt ||
      Object.entries(frame).some(([key, value]) => key !== 'gpuMs' && !Number.isFinite(value)) ||
      (frame.gpuMs !== null && (!Number.isFinite(frame.gpuMs) || frame.gpuMs < 0)) ||
      [
        frame.renderCPUms,
        frame.physicsMs,
        frame.drawCalls,
        frame.triangles,
        frame.gpuSequence,
        frame.time,
        frame.s,
        frame.laps,
        frame.textures,
        frame.geometries,
        frame.programs,
        frame.nearCars,
        frame.midCars,
        frame.farCars,
        frame.rain,
        frame.cloud,
        frame.water,
        frame.mirrors,
        frame.probes,
      ].some((v) => v < 0) ||
      [
        frame.drawCalls,
        frame.triangles,
        frame.gpuSequence,
        frame.laps,
        frame.rig,
        frame.textures,
        frame.geometries,
        frame.programs,
        frame.nearCars,
        frame.midCars,
        frame.farCars,
      ].some((v) => !Number.isInteger(v)) ||
      frame.s >= c.trackLength ||
      frame.rig < -1 ||
      frame.rig >= 20 ||
      frame.cloud > 1 ||
      frame.fov <= 0 ||
      frame.fov >= 180 ||
      frame.exposure <= 0 ||
      Math.abs(Math.hypot(frame.qx, frame.qy, frame.qz, frame.qw) - 1) > 0.01
    ) {
      this.interrupt('Invalid rendered frame observation');
      return;
    }
    const simulationDt = frame.time - this.previousTime;
    let ds = frame.s - this.previousS;
    if (ds > c.trackLength / 2) ds -= c.trackLength;
    if (ds < -c.trackLength / 2) ds += c.trackLength;
    if (
      simulationDt < 0 ||
      frame.laps < this.previousLaps ||
      frame.laps > this.previousLaps + 1 ||
      Math.abs(ds) > 130 * (frame.time - this.previousProgressTime) + 2 ||
      (simulationDt === 0 && Math.abs(ds) > 0.01)
    ) {
      this.interrupt('Discontinuous simulation or circuit progress');
      return;
    }
    if (this.count >= REVIEW_LIMIT) {
      this.interrupt('Review frame capacity exhausted');
      return;
    }
    const delta = now - this.previousAt,
      p = this.count * REVIEW_COLUMNS.length;
    // The first six columns share the existing performance-report contract.
    data[p] = delta;
    data[p + 1] = frame.renderCPUms;
    data[p + 2] = frame.physicsMs;
    data[p + 3] = frame.drawCalls;
    data[p + 4] = frame.triangles;
    data[p + 5] = frame.gpuMs !== null && frame.gpuSequence > this.lastGPU ? frame.gpuMs : -1;
    data[p + 6] = frame.time;
    data[p + 7] = frame.s;
    data[p + 8] = frame.laps;
    data[p + 9] = frame.x;
    data[p + 10] = frame.y;
    data[p + 11] = frame.z;
    data[p + 12] = frame.qx;
    data[p + 13] = frame.qy;
    data[p + 14] = frame.qz;
    data[p + 15] = frame.qw;
    data[p + 16] = frame.fov;
    data[p + 17] = frame.rig;
    data[p + 18] = frame.exposure;
    data[p + 19] = frame.textures;
    data[p + 20] = frame.geometries;
    data[p + 21] = frame.programs;
    data[p + 22] = frame.nearCars;
    data[p + 23] = frame.midCars;
    data[p + 24] = frame.farCars;
    data[p + 25] = frame.rain;
    data[p + 26] = frame.cloud;
    data[p + 27] = frame.water;
    data[p + 28] = frame.mirrors;
    data[p + 29] = frame.probes;
    this.count++;
    this.progressM += ds;
    this.elapsedMs += delta;
    if (Math.abs(ds) > 1e-9) this.previousProgressTime = frame.time;
    this.previousAt = now;
    this.previousS = frame.s;
    this.previousTime = frame.time;
    this.previousLaps = frame.laps;
    this.lastGPU = Math.max(this.lastGPU, frame.gpuSequence);
    if (c.mode === 'full-lap' && this.progressM >= c.trackLength && frame.laps > c.startLaps)
      this.state = 'complete';
    if (c.mode === 'timed-scene' && this.elapsedMs >= 30000) this.state = 'complete';
    if (this.active && this.elapsedMs >= 600000) this.interrupt('Ten-minute review limit reached');
  }
  report(): PresentationReport | null {
    if (!this.identity || (this.state !== 'complete' && this.state !== 'interrupted')) return null;
    const rows = Array.from({ length: this.count }, (_, i) =>
      Array.from(this.data!.subarray(i * REVIEW_COLUMNS.length, (i + 1) * REVIEW_COLUMNS.length)),
    );
    return {
      version: 1,
      state: this.state,
      reason: this.reason,
      context: { ...this.identity },
      columns: REVIEW_COLUMNS,
      rows,
      progressM: this.progressM,
      evidence: 'rendered-frame-observations-not-visual-acceptance',
      summary: summarizePresentation(rows),
    };
  }
}

/** Replay raw observations through the same continuity checks. Edited summaries
 * or a forged `complete` label cannot substitute for the recorded traversal. */
export function readPresentationReport(value: unknown): PresentationReport {
  if (!value || typeof value !== 'object') throw new Error('Invalid presentation report');
  const input = value as PresentationReport;
  if (
    input.version !== 1 ||
    !['complete', 'interrupted'].includes(input.state) ||
    (input.reason !== null && !label(input.reason, 500)) ||
    JSON.stringify(input.columns) !== JSON.stringify(REVIEW_COLUMNS) ||
    !Array.isArray(input.rows)
  )
    throw new Error('Invalid presentation report schema');
  summarizePresentation(input.rows);
  const review = new PresentationReview();
  review.start(input.context, 0);
  let now = 0,
    sequence = 0;
  const f = reviewFrame();
  for (const row of input.rows) {
    if (!review.active) throw new Error('Report contains frames after its terminal state');
    now += row[0];
    f.renderCPUms = row[1];
    f.physicsMs = row[2];
    f.drawCalls = row[3];
    f.triangles = row[4];
    f.gpuMs = row[5] < 0 ? null : row[5];
    f.gpuSequence = row[5] < 0 ? sequence : ++sequence;
    f.time = row[6];
    f.s = row[7];
    f.laps = row[8];
    f.x = row[9];
    f.y = row[10];
    f.z = row[11];
    f.qx = row[12];
    f.qy = row[13];
    f.qz = row[14];
    f.qw = row[15];
    f.fov = row[16];
    f.rig = row[17];
    f.exposure = row[18];
    f.textures = row[19];
    f.geometries = row[20];
    f.programs = row[21];
    f.nearCars = row[22];
    f.midCars = row[23];
    f.farCars = row[24];
    f.rain = row[25];
    f.cloud = row[26];
    f.water = row[27];
    f.mirrors = row[28];
    f.probes = row[29];
    review.record(now, f);
  }
  if (review.count !== input.rows.length)
    throw new Error('Invalid continuity in presentation report');
  if (input.state === 'interrupted' && input.reason) review.interrupt(input.reason);
  if (
    input.state !== review.state ||
    (input.state === 'complete' && input.reason !== null) ||
    (input.state === 'interrupted' && !input.reason)
  )
    throw new Error('Report claims unproven completion');
  return review.report()!;
}

/** Proposed 60Hz art/performance targets, not Steam requirements or measured
 * minimum specifications. Missing GPU evidence is unmeasured, never a zero/pass.
 * The existing pit/venue/CI numerical gates remain independent and unchanged. */
export const REVIEW_TARGETS = Object.freeze({
  p95FrameMs: 20,
  p99FrameMs: 1000 / 30,
  p95RenderCPUms: 8,
  p99GPUms: 12,
});
export function reviewBudget(value: PresentationReport) {
  const report = readPresentationReport(value),
    s = report.summary;
  const enough = report.state === 'complete' && s.samples >= 300 && s.elapsedMs >= 10000;
  const checks = (Object.keys(REVIEW_TARGETS) as (keyof typeof REVIEW_TARGETS)[]).map((key) => {
    const observed = s[key],
      available = enough && observed !== null && (key !== 'p99GPUms' || s.gpuSamples >= 100);
    return {
      metric: key,
      targetMs: REVIEW_TARGETS[key],
      observedMs: observed,
      state: !available ? 'unmeasured' : observed! <= REVIEW_TARGETS[key] ? 'pass' : 'fail',
    };
  });
  return {
    proposedTargetsNotMinimumSpecs: true,
    hardwareIdentity: 'user-declared-not-verified',
    videoEncodingIncludedInFrameIntervals: report.context.videoRequested,
    state: checks.some((c) => c.state === 'fail')
      ? 'fail'
      : checks.some((c) => c.state === 'unmeasured')
        ? 'unmeasured'
        : 'pass',
    checks,
    vram: 'not-measured',
    loading: 'not-measured',
    physicalControls: 'not-certified',
  };
}
