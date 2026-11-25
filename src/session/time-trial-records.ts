import {
  GhostPlayer,
  GhostRecorder,
  ghostKey,
  ghostPose,
  validateGhost,
  type GhostLap,
  type GhostPose,
} from '../core/ghost-lap.ts';
import { recordCategory } from '../core/session-identity.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { F, carBase } from '../simulation/protocol.ts';
import type { Track } from '../simulation/track.ts';
import { insertLeaderboard, leaderboardKey } from '../storage/leaderboard.ts';
import { emitTimeTrialLap } from '../steam/hooks.ts';
import { lapTime } from '../ui/interface.ts';

/** What the records lifecycle needs from the application (WP13). */
export interface RecordsHost {
  store: {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
    /** Atomic read/modify/write; returning the stored reference leaves it unchanged. */
    update?(key: string, update: (stored: unknown) => unknown): Promise<unknown>;
  };
  toast(message: string): void;
  playerName(): string;
}

/** Simple embedding hosts can share a store without providing atomic updates.
 * Serialize their whole operation, per store/key, without retaining idle keys.
 * Cross-tab/independent-store ordering is provided by the atomic store API. */
const pendingUpdates = new WeakMap<RecordsHost['store'], Map<string, Promise<void>>>();
async function updateRecord(
  store: RecordsHost['store'],
  key: string,
  update: (stored: unknown) => unknown,
): Promise<unknown> {
  if (store.update) return store.update(key, update);
  let pending = pendingUpdates.get(store);
  if (!pending) pendingUpdates.set(store, (pending = new Map()));
  const operation = (pending.get(key) ?? Promise.resolve()).then(async () => {
    const stored = await store.read(key);
    const value = update(stored);
    if (value !== stored) await store.write(key, value);
    return value;
  });
  // A failed write must release this key for the next accepted lap as well.
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  pending.set(key, settled);
  void settled.then(() => {
    if (pending.get(key) === settled) pending.delete(key);
  });
  return operation;
}

/** Time-trial ghost and local leaderboard lifecycle, extracted from the
 * application coordinator: load the category's personal best, offer each
 * completed lap, save improvements and pose the ghost for presentation. */
export class TimeTrialRecords {
  private recorder: GhostRecorder | null = null;
  player: GhostPlayer | null = null;
  /** HUD state: personal best and live delta (null outside time trial). */
  trial: { best: number; delta: number | null } | null = null;
  private generation = 0;
  private current: (() => boolean) | null = null;
  private readonly pose = ghostPose();
  constructor(private readonly host: RecordsHost) {}
  clear() {
    this.generation++;
    this.current = null;
    this.recorder = null;
    this.player = null;
    this.trial = null;
  }
  /** Load the saved ghost; `current()` is false once a newer session began. */
  async prepare(options: SessionOptions, track: Track, current: () => boolean) {
    this.clear();
    if (options.mode !== 'time-trial') return;
    const generation = this.generation;
    const ownsSession = () =>
      generation === this.generation && current() && generation === this.generation;
    if (!ownsSession()) return;
    this.current = ownsSession;
    const circuit = track.circuit.id,
      length = track.length,
      category = recordCategory(options);
    this.recorder = new GhostRecorder({
      circuit,
      trackLength: length,
      assist: options.assist,
      compound: options.compound,
      weather: options.weather,
      vehicle: category.vehicle,
    });
    let saved: GhostLap | null = null;
    try {
      saved = validateGhost(
        await this.host.store.read(ghostKey(circuit, category.vehicle)),
        circuit,
        length,
        category,
      );
    } catch (error) {
      if (ownsSession()) this.host.toast(`Saved ghost unavailable: ${String(error)}`);
    }
    // Toasts, store callbacks and event listeners can synchronously replace us.
    if (!ownsSession()) return;
    this.player = saved ? new GhostPlayer(saved) : null;
    this.trial = { best: saved?.lapTime ?? 0, delta: null };
    this.host.toast(
      saved
        ? `TIME TRIAL · PERSONAL BEST ${lapTime(saved.lapTime)} · GHOST LOADED`
        : 'TIME TRIAL · SET A VALID LAP TO SAVE YOUR GHOST',
    );
  }
  /** Offer each accepted snapshot; keep a lap only if it beats the ghost. */
  observe(
    frame: Float32Array,
    driverControlled: boolean,
    options: SessionOptions,
    session: string,
  ) {
    const ownsSession = this.current;
    if (!this.recorder || !ownsSession?.()) return;
    const lap = this.recorder.observe(frame, driverControlled);
    if (this.trial) {
      const o = carBase(0),
        running = frame[o + F.LAP_TIME] > 0 && frame[o + F.IN_PIT] === 0;
      this.trial.delta =
        this.player && running ? this.player.delta(frame[o + F.S], frame[o + F.LAP_TIME]) : null;
    }
    if (!lap) return;
    // Capture accepted data before any application callback (including the lap
    // event) can change options, clear records or expose a new session's state.
    const acceptedOptions = {
      circuit: options.circuit,
      vehicles: options.vehicles?.slice(),
      assist: options.assist,
      compound: options.compound,
      weather: options.weather,
    };
    const store = this.host.store;
    const improves = !this.player || lap.lapTime < this.player.lap.lapTime;
    const improvement = this.player ? this.player.lap.lapTime - lap.lapTime : 0;
    const acceptedGhost: GhostLap | null = improves
      ? { ...lap, sectors: [...lap.sectors], samples: lap.samples.slice() }
      : null;
    this.recordLeaderboard(lap.circuit, lap.lapTime, acceptedOptions, session, store, ownsSession);
    // Accepted persistence survives clear/replacement, but presentation does not.
    if (acceptedGhost) this.recordGhost(acceptedGhost, improvement, store, ownsSession);
    if (improves && ownsSession() && (!this.player || lap.lapTime < this.player.lap.lapTime)) {
      this.player = new GhostPlayer(lap);
      if (this.trial) this.trial.best = lap.lapTime;
    }
  }
  private recordGhost(
    lap: GhostLap,
    improvement: number,
    store: RecordsHost['store'],
    ownsSession: () => boolean,
  ) {
    let saved = false;
    void updateRecord(store, ghostKey(lap.circuit, lap.vehicle), (stored) => {
      const previous = validateGhost(stored, lap.circuit, lap.trackLength, {
        circuit: lap.circuit,
        vehicle: lap.vehicle ?? 'apx01',
        physics: lap.physics ?? 1,
      });
      if (previous && previous.lapTime <= lap.lapTime) return stored;
      saved = true;
      return lap;
    })
      .then(() => {
        if (saved && ownsSession())
          this.host.toast(
            `PERSONAL BEST ${lapTime(lap.lapTime)}${improvement > 0 ? ` · −${improvement.toFixed(3)} S` : ''} · GHOST SAVED`,
          );
      })
      .catch((error) => {
        if (ownsSession()) this.host.toast(`Ghost not saved: ${String(error)}`);
      });
  }
  /** D31: every valid time-trial lap enters its category's local top ten. */
  private recordLeaderboard(
    circuit: string,
    time: number,
    options: Parameters<typeof emitTimeTrialLap>[0],
    session: string,
    store: RecordsHost['store'],
    ownsSession: () => boolean,
  ) {
    const category = recordCategory(options);
    const key = leaderboardKey(circuit, category.vehicle, category.physics);
    const entry = {
      lapTime: time,
      driver: this.host.playerName(),
      assist: options.assist,
      compound: options.compound,
      weather: options.weather,
      session,
    };
    let rank = 0;
    void updateRecord(store, key, (stored) => {
      const inserted = insertLeaderboard(stored, entry);
      rank = inserted.rank;
      return rank ? inserted.board : stored;
    })
      .then(() => {
        if (rank && ownsSession())
          this.host.toast(`P${rank} ON THE LOCAL LEADERBOARD · ${lapTime(time)}`);
      })
      .catch((error) => {
        if (ownsSession()) this.host.toast(`Leaderboard not saved: ${String(error)}`);
      });
    // Steam leaderboards (src/steam/leaderboard-runtime.ts) listen for every valid lap.
    emitTimeTrialLap(options, time);
  }
  /** Ghost pose at the presented lap time (same interpolation as the car). */
  ghostAt(a: Float32Array, b: Float32Array, alpha: number): GhostPose | null {
    const player = this.player;
    if (!player) return null;
    const o = carBase(0),
      from = a[o + F.LAP_TIME],
      to = b[o + F.LAP_TIME];
    // A lap reset between snapshots starts the ghost again at the line.
    const time = to >= from ? from + (to - from) * alpha : to;
    // The ghost is drawn as the machine that set the lap (its record category).
    this.pose.vehicle = player.lap.vehicle;
    return time > 0 && b[o + F.IN_PIT] === 0 && player.poseAt(time, this.pose) ? this.pose : null;
  }
}
