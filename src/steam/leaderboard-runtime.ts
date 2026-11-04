import { SIMULATION_VERSION } from '../core/session-identity.ts';
import { desktopBridge, type MotoboundDesktop } from '../desktop/bridge.ts';
import { readLeaderboard } from '../storage/leaderboard.ts';
import { gameEvents, type GameEvent } from './events.ts';
import {
  LEADERBOARD_STORE_KEY,
  emptyBoards,
  encodeDetails,
  formatScore,
  lapScore,
  parseLeaderboardKey,
  pendingBoards,
  recordScore,
  submitPending,
  thaw,
  timeTrialBoardName,
  validateBoards,
  wildcardBoardName,
  type BoardStore,
  type SubmitFn,
} from './leaderboards.ts';

/**
 * Steam leaderboard runtime: listens on the game-event bus for valid time-trial laps and
 * classified Wildcard runs, keeps the player's best per board in the outbox (persisted through
 * the game's own SaveStore, so it survives restarts and travels with Steam Cloud), and sends what
 * Steam has not yet been told through the desktop bridge.
 *
 * Fully optional and fail-closed, like the achievements runtime: in a browser (no bridge), or in a
 * shell without leaderboard support, it is inert and writes nothing. With a shell but no Steam, or
 * a Steam binding with no leaderboard API (steamworks.js 0.4.0 has none: desktop/STEAM.md), the
 * scores wait in the outbox and the game is unaffected.
 */

export interface LeaderboardHost {
  store: {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
    keys?(prefix: string): Promise<string[]>;
  };
  toast?(message: string): void;
  now?(): number;
  /** Injected for tests; defaults to window.motobound?.desktop. */
  bridge?: MotoboundDesktop | null;
}

export interface LeaderboardStatus {
  /** The shell offers leaderboards at all. */
  supported: boolean;
  /** Steam accepted the last send attempt (false until one succeeds). */
  online: boolean;
  /** Why Steam is not taking scores, when it is not. */
  reason: string | null;
  pending: number;
  sent: number;
}

export class LeaderboardRuntime {
  private boards: BoardStore = emptyBoards();
  private ready = false;
  private loaded: Promise<void> = Promise.resolve();
  private queue: GameEvent[] = [];
  private writing: Promise<void> = Promise.resolve();
  private flushing = false;
  private flushAgain = false;
  private online = false;
  private reason: string | null = null;
  private disposer: (() => void) | null = null;
  private readonly bridge: MotoboundDesktop | null;

  constructor(private readonly host: LeaderboardHost) {
    this.bridge = host.bridge === undefined ? desktopBridge() : host.bridge;
  }

  /** The shell offers the leaderboard calls (otherwise the runtime does nothing at all). */
  get supported() {
    return !!this.bridge?.steam?.leaderboards;
  }
  get snapshot(): BoardStore {
    return this.boards;
  }
  status(): LeaderboardStatus {
    const records = Object.values(this.boards.boards);
    return {
      supported: this.supported,
      online: this.online,
      reason: this.reason,
      pending: pendingBoards(this.boards).length,
      sent: records.filter((r) => r.sent !== null).length,
    };
  }

  /** Subscribe and load. Events before the outbox is read are queued, not lost. */
  start() {
    if (!this.supported) return () => undefined;
    this.disposer = gameEvents.subscribe((event) => this.receive(event));
    this.loaded = this.load();
    return () => this.dispose();
  }
  /** Resolves when the outbox is loaded, seeded and the first send attempt has finished (tests). */
  whenReady() {
    return this.loaded;
  }
  dispose() {
    this.disposer?.();
    this.disposer = null;
  }

  private now() {
    return this.host.now?.() ?? Date.now();
  }

  private async load() {
    try {
      this.boards = thaw(validateBoards(await this.host.store.read(LEADERBOARD_STORE_KEY)));
    } catch {
      this.boards = emptyBoards();
    }
    await this.seedFromLocal();
    this.ready = true;
    for (const event of this.queue.splice(0)) this.apply(event);
    await this.flush();
  }

  /** Laps set before Steam was ever available: each local board's best lap, in this physics version. */
  private async seedFromLocal() {
    if (!this.host.store.keys) return;
    try {
      let changed = false;
      for (const key of await this.host.store.keys('leaderboard:')) {
        const id = parseLeaderboardKey(key);
        if (!id || id.physics !== SIMULATION_VERSION) continue;
        const best = readLeaderboard(await this.host.store.read(key))[0];
        const name = timeTrialBoardName(id.circuit, id.vehicle, id.physics);
        const score = best ? lapScore(best.lapTime) : null;
        if (!best || !name || score === null) continue;
        // at 0: laps from before this session drain first.
        const result = recordScore(this.boards, name, score, encodeDetails(best), 0);
        if (result.improved) {
          this.boards = result.store;
          changed = true;
        }
      }
      if (changed) this.persist();
    } catch {
      /* the local boards are a convenience, never a requirement */
    }
  }

  private receive(event: GameEvent) {
    if (event.type !== 'timetrial.lap' && event.type !== 'wildcard.result') return;
    if (!this.ready) this.queue.push(event);
    else this.apply(event);
  }

  private apply(event: GameEvent) {
    let name: string | null = null;
    let score: number | null = null;
    let details: number[] = [];
    if (event.type === 'timetrial.lap') {
      name = timeTrialBoardName(event.circuitId, event.vehicleId, event.physics);
      score = lapScore(event.seconds);
      details = encodeDetails(event);
    } else if (event.type === 'wildcard.result') {
      name = wildcardBoardName(event.eventId, event.physics);
      score = lapScore(event.bestLap);
      details = encodeDetails({ assist: event.assist, compound: 'medium', weather: event.weather });
    }
    if (!name || score === null) return;
    const result = recordScore(this.boards, name, score, details, this.now());
    if (!result.improved) return;
    this.boards = result.store;
    this.persist();
    void this.flush();
  }

  private persist() {
    const snapshot = this.boards;
    this.writing = this.writing
      .then(() => this.host.store.write(LEADERBOARD_STORE_KEY, snapshot))
      .catch(() => undefined);
  }

  /** Send what Steam does not have. Safe to call at any time; overlapping calls collapse into one more pass. */
  async flush() {
    const leaderboards = this.bridge?.steam?.leaderboards;
    if (!leaderboards) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        if (!pendingBoards(this.boards).length) break;
        const status = await leaderboards
          .status()
          .catch(() => ({ available: false, reason: 'bridge error' }));
        if (!status.available) {
          this.online = false;
          this.reason = status.reason ?? 'Steam leaderboards are not available';
          break;
        }
        const submit: SubmitFn = (name, score, details) =>
          leaderboards
            .submit(name, score, details)
            .catch(() => ({ ok: false as const, reason: 'bridge error' }));
        const report = await submitPending(this.boards, submit);
        this.boards = report.store;
        this.persist();
        if (report.unavailable) {
          this.online = false;
          this.reason = report.unavailable;
        } else {
          this.online = report.failed === 0 || report.sent > 0;
          this.reason = report.failed ? 'some scores were refused; they will be retried' : null;
          if (report.sent)
            this.host.toast?.(
              `STEAM LEADERBOARD · ${report.sent} time${report.sent === 1 ? '' : 's'} sent`,
            );
        }
      } while (this.flushAgain);
    } finally {
      this.flushing = false;
    }
  }

  /** "1:23.456" helper for the screens. */
  static format(score: number) {
    return formatScore(score);
  }
}

/** One-call install used by the game shell. */
export function startLeaderboards(host: LeaderboardHost) {
  const runtime = new LeaderboardRuntime(host);
  runtime.start();
  return runtime;
}
