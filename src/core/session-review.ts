import {
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  WHEEL_NAMES,
  carBase,
  HEADER,
  CAR_STRIDE,
} from '../simulation/protocol.ts';

const CHASSIS = [
  'S',
  'LAPS',
  'SPEED',
  'STEER',
  'THROTTLE',
  'BRAKE',
  'GEAR',
  'G_LONG',
  'G_LAT',
  'G_VERT',
  'WAKE',
  'AERO_FRONT',
  'AERO_REAR',
  'FRONT_HEALTH',
  'FLOOR_HEALTH',
  'REAR_HEALTH',
  'IMPACT',
  'COMPOUND',
  'PIT_PHASE',
  'PIT_STOPS',
  'MOTOR_POWER',
  'BATTERY',
  'FINISH',
  'RANK',
  'RETIRED',
] as const;
const WHEELS = [
  'SLIP',
  'ANGLE',
  'LOAD',
  'COMPRESSION',
  'SURFACE_TEMP',
  'WEAR',
  'DIRT',
  'WATER',
  'SURFACE',
] as const;
export const SESSION_REVIEW_COLUMNS = [
  'elapsed_wall_seconds',
  'simulation_time',
  'race_time',
  'phase',
  'rain',
  'cloud',
  'water',
  ...CHASSIS.map((key) => `player_${key.toLowerCase()}`),
  ...WHEEL_NAMES.flatMap((name) => WHEELS.map((key) => `${name}_${key.toLowerCase()}`)),
];
export interface SessionReviewIdentity {
  source: string;
  machine: string;
  reviewer: string;
  startedAt: string;
}
export interface SessionReviewObservation {
  state: string;
  sessionId: string;
  sessionMode: string;
  autopilot: boolean;
  camera: string | null;
  telemetryOpen: boolean;
  visible: boolean;
  frame: Float32Array | null;
}
export interface SessionReviewReport {
  version: 1;
  evidence: 'session-observations-not-section146-acceptance';
  state: 'stopped' | 'interrupted';
  reason: string;
  identity: SessionReviewIdentity;
  sessionId: string | null;
  columns: string[];
  rows: number[][];
  events: { at: number; kind: string; detail: string }[];
  autopilotObserved: boolean;
  integrityWarnings: string[];
  section146Accepted: false;
  humanVerified: false;
  startupCaptured: false;
  audioVideoAttached: false;
}
const label = (v: string, n: number) =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.length <= n &&
  !Array.from(v).some((c) => c.charCodeAt(0) < 32);
/** Whole-session read-only evidence, including menu/results/replay/telemetry.
 * Raw accepted worker snapshots are sampled at up to 2Hz for two hours. These
 * are not every physics tick, a frame-rate benchmark, or a substitute for a
 * human's continuous audiovisual drive. No stage is automatically accepted. */
export class SessionReview {
  static readonly maximumRows = 14400;
  static readonly maximumEvents = 4096;
  state: 'idle' | 'recording' | 'stopped' | 'interrupted' = 'idle';
  reason = '';
  private identity: SessionReviewIdentity | null = null;
  private origin = 0;
  private clock = 0;
  private last = -Infinity;
  private sessionId: string | null = null;
  private rows: number[][] = [];
  private events: SessionReviewReport['events'] = [];
  private previousUi = '';
  private autopilot = false;
  private finalSnapshotObserved = false;
  private warnings = new Set<string>();
  get active() {
    return this.state === 'recording';
  }
  get count() {
    return this.rows.length;
  }
  start(identity: SessionReviewIdentity, now: number, state: string) {
    if (this.active) throw new Error('Session review is already recording');
    if (state !== 'menu')
      throw new Error('Start session evidence from the paddock before choosing the race');
    if (
      !/^[a-f0-9]{64}$/.test(identity.source) ||
      !label(identity.machine, 80) ||
      !label(identity.reviewer, 80) ||
      !label(identity.startedAt, 80) ||
      !Number.isFinite(Date.parse(identity.startedAt)) ||
      !Number.isFinite(now)
    )
      throw new Error('Invalid session review identity');
    this.identity = { ...identity };
    this.origin = this.clock = now;
    this.last = -Infinity;
    this.sessionId = null;
    this.rows = [];
    this.events = [];
    this.previousUi = '';
    this.autopilot = false;
    this.finalSnapshotObserved = false;
    this.warnings.clear();
    this.reason = '';
    this.state = 'recording';
    this.event(now, 'armed', 'Already-open application; startup is not captured');
  }
  event(now: number, kind: string, detail: string) {
    if (!this.active) return;
    if (!Number.isFinite(now) || now < this.clock || !label(kind, 80) || !label(detail, 512)) {
      this.stop('Invalid observation identity', true);
      return;
    }
    if (this.events.length >= SessionReview.maximumEvents) {
      this.stop('Session event capacity reached', true);
      return;
    }
    this.clock = now;
    this.events.push({ at: (now - this.origin) / 1000, kind, detail });
  }
  observe(now: number, o: SessionReviewObservation) {
    if (!this.active) return;
    if (!Number.isFinite(now) || now < this.clock) {
      this.stop('Non-monotonic session clock', true);
      return;
    }
    if (now - this.origin >= 7200000) {
      this.stop('Two-hour observation limit reached', true);
      return;
    }
    this.clock = now;
    const ui = `${o.state}|${o.camera ?? 'none'}|telemetry:${o.telemetryOpen}|visible:${o.visible}`;
    if (ui !== this.previousUi) {
      this.event(now, 'presentation', ui);
      this.previousUi = ui;
      if (!o.visible && this.sessionId) this.warnings.add('visibility-loss');
      if (o.state === 'paused' && o.frame && o.frame[carBase(0) + F.FINISH] === 0 && this.sessionId)
        this.warnings.add('mid-race-pause');
    }
    // The application retains its used-demonstration flag. Observe it even if
    // the reviewer pauses immediately after enabling automation.
    if (o.autopilot && (this.sessionId || o.state === 'driving')) {
      this.autopilot = true;
      this.warnings.add('autopilot-used');
    }
    // finish() can switch the UI before the next animation frame. Preserve that
    // authoritative results snapshot even when it falls inside the 2Hz window.
    const finalSnapshot =
      o.state === 'results' && this.sessionId === o.sessionId && !this.finalSnapshotObserved;
    if ((o.state !== 'driving' && !finalSnapshot) || !o.frame) return;
    if (!this.sessionId) {
      if (!label(o.sessionId, 128)) {
        this.stop('Missing live session identity', true);
        return;
      }
      this.sessionId = o.sessionId;
      this.event(now, 'live-session', `${o.sessionId} / ${o.sessionMode}`);
      if (o.sessionMode !== 'race') this.warnings.add('not-a-race-session');
    } else if (this.sessionId !== o.sessionId) {
      this.stop('Session restarted during the recorded journey', true);
      return;
    }
    if (!finalSnapshot && now - this.last < 500) return;
    if (this.rows.length >= SessionReview.maximumRows) {
      this.stop('Snapshot capacity reached', true);
      return;
    }
    const f = o.frame,
      b = carBase(0);
    if (f.length < HEADER + CAR_STRIDE || !Number.isInteger(f[H.CARS]) || f[H.CARS] < 1) {
      this.stop('Invalid accepted worker snapshot', true);
      return;
    }
    const row = [
      (now - this.origin) / 1000,
      f[H.TIME],
      f[H.RACE_TIME],
      f[H.PHASE],
      f[H.RAIN],
      f[H.CLOUD],
      f[H.WATER],
      ...CHASSIS.map((key) => f[b + F[key]]),
      ...WHEEL_NAMES.flatMap((_, wheel) =>
        WHEELS.map((key) => f[b + WHEEL_BASE + wheel * WHEEL_STRIDE + W[key]]),
      ),
    ];
    if (!row.every(Number.isFinite)) {
      this.stop('Non-finite accepted physics state', true);
      return;
    }
    const previous = this.rows.at(-1);
    if (previous && row[1] < previous[1]) {
      this.stop('Live simulation rewound', true);
      return;
    }
    this.rows.push(row);
    this.last = now;
    if (finalSnapshot) {
      this.finalSnapshotObserved = true;
      this.event(now, 'results-snapshot', 'Final accepted worker state; not human acceptance');
    }
  }
  stop(reason: string, interrupted = false) {
    if (!this.active) return;
    this.state = interrupted ? 'interrupted' : 'stopped';
    this.reason = reason.slice(0, 512);
  }
  report(): SessionReviewReport | null {
    if (!this.identity || this.state === 'recording' || this.state === 'idle') return null;
    return {
      version: 1,
      evidence: 'session-observations-not-section146-acceptance',
      state: this.state,
      reason: this.reason,
      identity: { ...this.identity },
      sessionId: this.sessionId,
      columns: [...SESSION_REVIEW_COLUMNS],
      rows: this.rows.map((row) => [...row]),
      events: this.events.map((e) => ({ ...e })),
      autopilotObserved: this.autopilot,
      integrityWarnings: [...this.warnings],
      section146Accepted: false,
      humanVerified: false,
      startupCaptured: false,
      audioVideoAttached: false,
    };
  }
}
