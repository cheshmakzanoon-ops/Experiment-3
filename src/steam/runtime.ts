import { desktopBridge, type MotoboundDesktop, type SteamPresence } from '../desktop/bridge.ts';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_SAVE_KEY,
  achievementById,
  applyEvent,
  emptyProgress,
  validateProgress,
  type AchievementProgress,
} from './achievements.ts';
import { gameEvents, type GameEvent } from './events.ts';
import { festivalActivityEvent } from './hooks.ts';
import { describePresence } from './presence.ts';

/**
 * Achievement runtime: listens on the game-event bus, folds events through the
 * pure engine, persists progress through the game's own SaveStore (so it is
 * mirrored and Steam-Cloud synced like every other save) and, in the desktop
 * shell, forwards unlocks and rich presence to Steam. In a browser everything
 * except the Steam calls still works; every failure is swallowed.
 */

export interface AchievementHost {
  store: {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
  };
  /** Shown for each unlock (the game's toast). */
  toast?(message: string): void;
  now?(): number;
  /** Injected for tests; defaults to window.motobound?.desktop. */
  bridge?: MotoboundDesktop | null;
}

/** Presence for the lifecycle events; the UI-mode observer covers the rest. */
export function presenceFor(event: GameEvent): SteamPresence | null {
  switch (event.type) {
    case 'session.started': {
      // A Wildcard event and a time trial have their own lines ("Chasing a lap at ...").
      const status =
        event.kind === 'festival'
          ? 'Festival'
          : event.wildcardEvent
            ? 'Wildcard'
            : event.mode === 'time-trial'
              ? 'TimeTrial'
              : 'Racing';
      return {
        status,
        venue: event.circuitId,
        vehicle: event.vehicleId,
        weather: event.weather,
        discipline: event.discipline,
        ...(event.wildcardEvent ? { event: event.wildcardEvent } : {}),
      };
    }
    case 'menu.entered':
      return { status: 'Menu' };
    case 'photo.taken':
      return { status: 'Photo' };
    default:
      return null;
  }
}

const MODE_STATUS: Readonly<Record<string, string>> = {
  menu: 'Menu',
  loading: 'Loading',
  pregame: 'Racing',
  driving: 'Racing',
  paused: 'Paused',
  results: 'Results',
  replay: 'Replay',
  photo: 'Photo',
  // desktop/STEAM.md already lists "#Status_Festival"; nothing set this mode before,
  // so the open world reported "Loading" for the whole session.
  festival: 'Festival',
};

/** Rich-presence status for the game's `data-mode` attribute (src/ui/interface.ts showMode). */
export const statusForMode = (mode: string | undefined) => MODE_STATUS[mode ?? ''] ?? 'Menu';

export class AchievementRuntime {
  private progress: AchievementProgress = emptyProgress();
  private loaded: Promise<void> = Promise.resolve();
  private queue: GameEvent[] = [];
  private ready = false;
  private writing: Promise<void> = Promise.resolve();
  private readonly bridge: MotoboundDesktop | null;
  private steamAvailable = false;
  private presenceStatus = '';
  private lastSession: SteamPresence | null = null;
  private disposers: (() => void)[] = [];

  constructor(private readonly host: AchievementHost) {
    this.bridge = host.bridge === undefined ? desktopBridge() : host.bridge;
  }

  get snapshot(): AchievementProgress {
    return this.progress;
  }

  /** Subscribe and load. Events emitted before the save is read are queued, not lost. */
  start() {
    this.disposers.push(gameEvents.subscribe((event) => this.receive(event)));
    if (typeof window !== 'undefined') {
      const onFestival = (e: Event) => {
        const event = festivalActivityEvent((e as CustomEvent).detail);
        if (event) gameEvents.emit(event);
      };
      window.addEventListener('festival-result', onFestival);
      this.disposers.push(() => window.removeEventListener('festival-result', onFestival));
      this.watchMode();
    }
    this.loaded = this.load();
    return () => this.dispose();
  }

  /** Resolves when the saved progress and Steam state have been merged (tests, shutdown). */
  whenReady() {
    return this.loaded;
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private async load() {
    try {
      this.progress = validateProgress(await this.host.store.read(ACHIEVEMENTS_SAVE_KEY));
    } catch {
      this.progress = emptyProgress();
    }
    await this.reconcileSteam();
    this.ready = true;
    for (const event of this.queue.splice(0)) this.apply(event);
  }

  /** Steam is the cloud copy of the unlock flags: merge both directions, silently. */
  private async reconcileSteam() {
    const steam = this.bridge?.steam;
    if (!steam) return;
    try {
      const status = await steam.status();
      this.steamAvailable = status.available;
      if (!status.available) return;
      const ids = ACHIEVEMENTS.map((a) => a.id);
      const onSteam = new Set(await steam.unlocked(ids));
      let merged = false;
      for (const id of onSteam)
        if (this.progress.unlocked[id] === undefined && achievementById(id)) {
          this.progress = {
            ...this.progress,
            unlocked: { ...this.progress.unlocked, [id]: this.now() },
          };
          merged = true;
        }
      if (merged) this.persist();
      const missing = ids.filter(
        (id) => this.progress.unlocked[id] !== undefined && !onSteam.has(id),
      );
      if (missing.length) await steam.unlock(missing);
      const root = typeof document === 'undefined' ? null : document.getElementById('app');
      this.sendPresence({ status: statusForMode(root?.dataset.mode) });
    } catch {
      /* Steam is optional */
    }
  }

  private now() {
    return this.host.now?.() ?? Date.now();
  }

  private receive(event: GameEvent) {
    const presence = presenceFor(event);
    if (presence) {
      if (event.type === 'session.started') this.lastSession = presence;
      this.sendPresence(presence);
    }
    if (!this.ready) this.queue.push(event);
    else this.apply(event);
  }

  private apply(event: GameEvent) {
    let result;
    try {
      result = applyEvent(this.progress, event, this.now());
    } catch {
      return;
    }
    if (result.progress === this.progress) return;
    this.progress = result.progress;
    this.persist();
    if (result.unlocked.length === 0) return;
    for (const id of result.unlocked) {
      const def = achievementById(id);
      if (def) this.host.toast?.(`Achievement unlocked: ${def.name}`);
    }
    if (this.steamAvailable) void this.bridge?.steam.unlock(result.unlocked).catch(() => undefined);
  }

  /** Writes are serialised so a burst of events cannot interleave two saves. */
  private persist() {
    const snapshot = this.progress;
    this.writing = this.writing
      .then(() => this.host.store.write(ACHIEVEMENTS_SAVE_KEY, snapshot))
      .catch(() => undefined);
  }

  private sendPresence(presence: SteamPresence) {
    if (!this.steamAvailable) return;
    // The ids the game knows become the names a friends list shows (presence.ts).
    void this.bridge?.steam.presence(describePresence(presence)).catch(() => undefined);
  }

  /** The UI publishes its mode on #app[data-mode]; map it to a presence status. */
  private watchMode() {
    const app = document.getElementById('app');
    if (!app || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      let status = statusForMode(app.dataset.mode);
      // A Wildcard run or a time trial keeps its own line while it is being driven.
      const own = this.lastSession?.status;
      if (status === 'Racing' && (own === 'Wildcard' || own === 'TimeTrial')) status = own;
      if (status === this.presenceStatus) return;
      this.presenceStatus = status;
      // Keep venue/vehicle while a session is on screen; drop them in the menu.
      const inSession =
        status === 'Racing' ||
        status === 'TimeTrial' ||
        status === 'Wildcard' ||
        status === 'Paused' ||
        status === 'Results' ||
        status === 'Replay';
      this.sendPresence(
        inSession && this.lastSession ? { ...this.lastSession, status } : { status },
      );
    });
    observer.observe(app, { attributes: true, attributeFilter: ['data-mode'] });
    this.disposers.push(() => observer.disconnect());
  }
}

/** One-call install used by the game shell. */
export function startAchievements(host: AchievementHost) {
  const runtime = new AchievementRuntime(host);
  runtime.start();
  return runtime;
}
