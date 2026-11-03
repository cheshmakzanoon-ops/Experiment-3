import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotoboundDesktop } from '../src/desktop/bridge.ts';
import { ACHIEVEMENTS_SAVE_KEY } from '../src/steam/achievements.ts';
import { gameEvents, type GameEvent } from '../src/steam/events.ts';
import {
  FestivalStatusObserver,
  festivalActivityEvent,
  raceContext,
  raceFinishedEvent,
  type FestivalStatusLike,
} from '../src/steam/hooks.ts';
import { AchievementRuntime, presenceFor, statusForMode } from '../src/steam/runtime.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { DesktopMirror, REVISION_KEY, type MirrorKv } from '../src/storage/desktop-mirror.ts';

const options = (o: Partial<SessionOptions> = {}): SessionOptions => ({ ...DEFAULT_OPTIONS, ...o });

describe('race context', () => {
  it('derives discipline from venue (dirt) or vehicle (elsewhere)', () => {
    expect(raceContext({ circuit: 'aurel', vehicles: ['apx01'] })).toMatchObject({
      discipline: 'circuit',
      wildcard: false,
    });
    expect(raceContext({ circuit: 'aurel', vehicles: ['gpr1'] })).toMatchObject({
      discipline: 'gp-bike',
      wildcard: false,
    });
    expect(raceContext({ circuit: 'valley-ridge-mx', vehicles: ['mx450'] })).toMatchObject({
      discipline: 'motocross',
      wildcard: false,
    });
    expect(raceContext({ circuit: 'arena-nord-sx', vehicles: ['mx450'] })).toMatchObject({
      discipline: 'supercross',
      wildcard: false,
    });
    // A supermoto is dirt-capable: not a mismatch on either surface.
    expect(raceContext({ circuit: 'aurel', vehicles: ['sm450'] }).wildcard).toBe(false);
    // No vehicle named: the default Formula car.
    expect(raceContext({ circuit: 'aurel' }).vehicleId).toBe('apx01');
  });

  it('flags deliberately mismatched vehicle and venue as Wildcard', () => {
    expect(raceContext({ circuit: 'valley-ridge-mx', vehicles: ['apx01'] }).wildcard).toBe(true);
    expect(raceContext({ circuit: 'arena-nord-sx', vehicles: ['gpr1'] }).wildcard).toBe(true);
    expect(raceContext({ circuit: 'aurel', vehicles: ['mx450'] })).toMatchObject({
      discipline: 'motocross',
      wildcard: true,
    });
    expect(
      raceContext({ circuit: 'aurel', vehicles: ['apx01'], ruleset: 'Wildcard-night' }).wildcard,
    ).toBe(true);
  });
});

describe('race.finished from a result frame', () => {
  const frame = (set: (o: number, f: Float32Array) => void, cars = 8) => {
    const f = new Float32Array(HEADER + CAR_STRIDE * cars);
    f[H.CARS] = cars;
    const o = carBase(0);
    f[o + F.RANK] = 1;
    f[o + F.FINISH] = 300;
    f[o + F.FRONT_HEALTH] = f[o + F.FLOOR_HEALTH] = f[o + F.REAR_HEALTH] = 1;
    set(o, f);
    return f;
  };

  it('reports position, grid slot, cleanliness and weather', () => {
    const event = raceFinishedEvent(
      options({ circuit: 'aurel', mode: 'race', grid: [3, 1, 0, 2], laps: 5 }),
      frame(() => undefined, 4),
      false,
    );
    expect(event).toMatchObject({
      type: 'race.finished',
      discipline: 'circuit',
      mode: 'race',
      circuitId: 'aurel',
      vehicleId: 'apx01',
      position: 1,
      fieldSize: 4,
      gridSlot: 3,
      classified: true,
      laps: 5,
      clean: true,
      wet: false,
      weather: 'clear',
      demonstration: false,
    });
  });

  it('is not clean with penalties or damage, and not classified when retired', () => {
    const penalised = raceFinishedEvent(
      options(),
      frame((o, f) => (f[o + F.PENALTY] = 5)),
      false,
    );
    expect(penalised.clean).toBe(false);
    expect(penalised.penaltySeconds).toBe(5);
    const damaged = raceFinishedEvent(
      options(),
      frame((o, f) => (f[o + F.FRONT_HEALTH] = 0.5)),
      false,
    );
    expect(damaged.clean).toBe(false);
    const retired = raceFinishedEvent(
      options(),
      frame((o, f) => (f[o + F.RETIRED] = 1)),
      false,
    );
    expect(retired.classified).toBe(false);
    expect(retired.clean).toBe(false);
  });

  it('marks rain at the flag, either from the preset or the live rain level', () => {
    expect(
      raceFinishedEvent(
        options({ weather: 'rain' }),
        frame(() => undefined),
        false,
      ).wet,
    ).toBe(true);
    const live = frame((_o, f) => (f[H.RAIN] = 0.6));
    expect(raceFinishedEvent(options({ weather: 'changeable' }), live, false).wet).toBe(true);
    expect(
      raceFinishedEvent(
        options({ weather: 'changeable' }),
        frame(() => undefined),
        false,
      ).wet,
    ).toBe(false);
  });
});

describe('festival events', () => {
  it('maps a festival-result detail defensively', () => {
    const base = {
      kind: 'festival-result',
      eventKind: 'speed-trap',
      completed: true,
      abandoned: false,
      assisted: false,
      stars: 7,
      position: null,
      entrants: 1,
      trapKmh: 261.5,
      averageKmh: null,
      driftScore: null,
      vehicleId: 'rd2',
    };
    expect(festivalActivityEvent(base)).toEqual({
      type: 'festival.activity',
      eventKind: 'speed-trap',
      completed: true,
      assisted: false,
      stars: 3,
      position: 0,
      entrants: 1,
      trapKmh: 261.5,
      averageKmh: 0,
      driftScore: 0,
      vehicleId: 'rd2',
    });
    expect(festivalActivityEvent({ ...base, abandoned: true })?.completed).toBe(false);
    expect(festivalActivityEvent(null)).toBeNull();
    expect(festivalActivityEvent({ kind: 'other' })).toBeNull();
    expect(festivalActivityEvent('x')).toBeNull();
  });

  const status = (o: {
    places?: string[];
    label?: string;
    sequence?: number;
    phase?: string;
    lastBank?: number;
    air?: { seconds: number; distance: number } | null;
  }): FestivalStatusLike => ({
    discovered: o.places ?? [],
    skills: {
      phase: o.phase ?? 'idle',
      label: o.label ?? '',
      sequence: o.sequence ?? 0,
      lastBank: o.lastBank ?? 0,
      bestChain: o.lastBank ?? 0,
      sessionTotal: o.lastBank ?? 0,
      air: o.air ?? null,
    },
  });

  it('seeds a baseline silently, then emits discoveries, landings, passes and banked chains once', () => {
    const out: GameEvent[] = [];
    const observer = new FestivalStatusObserver((e) => out.push(e));
    observer.observe(status({ places: ['a', 'b'], sequence: 4 })); // returning player's old progress
    expect(out).toEqual([]);

    observer.observe(status({ places: ['a', 'b', 'c'], sequence: 4 }));
    expect(out.map((e) => e.type)).toEqual(['festival.discovered']);
    expect(out[0]).toMatchObject({ id: 'c', total: 3 });

    // A jump: air is sampled while airborne, the landing label then shows for ~1 s.
    observer.observe(
      status({ places: ['a', 'b', 'c'], phase: 'active', air: { seconds: 0.6, distance: 14 } }),
    );
    observer.observe(
      status({ places: ['a', 'b', 'c'], phase: 'active', air: { seconds: 1.4, distance: 31 } }),
    );
    for (let i = 0; i < 5; i++)
      observer.observe(
        status({ places: ['a', 'b', 'c'], phase: 'active', label: 'GREAT AIR · CLEAN LANDING' }),
      );
    expect(out.filter((e) => e.type === 'festival.jump')).toEqual([
      { type: 'festival.jump', airSeconds: 1.4, distance: 31 },
    ]);

    for (let i = 0; i < 4; i++)
      observer.observe(status({ places: ['a', 'b', 'c'], label: 'CLEAN PASS' }));
    expect(out.filter((e) => e.type === 'festival.cleanPass')).toHaveLength(1);

    observer.observe(
      status({ places: ['a', 'b', 'c'], phase: 'banked', sequence: 5, lastBank: 1800 }),
    );
    observer.observe(
      status({ places: ['a', 'b', 'c'], phase: 'banked', sequence: 5, lastBank: 1800 }),
    );
    expect(out.filter((e) => e.type === 'festival.chain')).toEqual([
      { type: 'festival.chain', points: 1800, bestChain: 1800, sessionTotal: 1800 },
    ]);

    // Losing a chain advances the sequence but is not a bank.
    observer.observe(
      status({ places: ['a', 'b', 'c'], phase: 'lost', sequence: 6, lastBank: 1800 }),
    );
    expect(out.filter((e) => e.type === 'festival.chain')).toHaveLength(1);
  });
});

describe('achievement runtime', () => {
  const disposers: (() => void)[] = [];
  afterEach(() => disposers.splice(0).forEach((d) => d()));

  const fakeStore = (initial?: unknown, failRead = false) => {
    const writes: unknown[] = [];
    return {
      writes,
      read: vi.fn(async () => {
        if (failRead) throw new Error('storage unavailable');
        return initial;
      }),
      write: vi.fn(async (key: string, value: unknown) => {
        expect(key).toBe(ACHIEVEMENTS_SAVE_KEY);
        writes.push(structuredClone(value));
      }),
    };
  };
  const fakeBridge = (steam: { available: boolean; onSteam?: string[] }) => {
    const unlocked: string[][] = [];
    const presence: unknown[] = [];
    const bridge = {
      version: 1,
      steam: {
        status: async () => ({
          available: steam.available,
          reason: null,
          appId: null,
          name: 'Tester',
        }),
        unlocked: async () => steam.onSteam ?? [],
        unlock: async (ids: string[]) => {
          unlocked.push(ids);
          return ids;
        },
        presence: async (state: unknown) => {
          presence.push(state);
          return true;
        },
      },
    } as unknown as MotoboundDesktop;
    return { bridge, unlocked, presence };
  };
  const winEvent = (): GameEvent => ({
    type: 'race.finished',
    discipline: 'circuit',
    mode: 'race',
    circuitId: 'aurel',
    vehicleId: 'apx01',
    vehicleClass: 'formula',
    position: 1,
    fieldSize: 8,
    gridSlot: 1,
    classified: true,
    laps: 3,
    penaltySeconds: 0,
    clean: true,
    weather: 'clear',
    wet: false,
    wildcard: false,
    demonstration: false,
  });
  const make = (
    store: ReturnType<typeof fakeStore>,
    bridge: MotoboundDesktop | null,
    toast = vi.fn(),
  ) => {
    const runtime = new AchievementRuntime({ store, toast, now: () => 42, bridge });
    disposers.push(runtime.start());
    return { runtime, toast };
  };

  it('queues events emitted before the save loads, persists, toasts and forwards to Steam', async () => {
    const store = fakeStore();
    const { bridge, unlocked } = fakeBridge({ available: true });
    const { runtime, toast } = make(store, bridge);
    gameEvents.emit(winEvent()); // before whenReady(): must not be lost
    await runtime.whenReady();
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(runtime.snapshot.unlocked)).toEqual(
      expect.arrayContaining([
        'circuit_first_finish',
        'circuit_win',
        'circuit_pole_win',
        'clean_win',
      ]),
    );
    expect(runtime.snapshot.unlocked.circuit_win).toBe(42);
    expect(toast).toHaveBeenCalledWith('Achievement unlocked: First Chequered');
    expect(store.writes.length).toBeGreaterThan(0);
    expect(unlocked.flat()).toEqual(expect.arrayContaining(['circuit_win', 'clean_win']));
    // Each unlock reaches Steam once.
    const flat = unlocked.flat();
    expect(new Set(flat).size).toBe(flat.length);
    // Replaying the same win does not announce anything twice.
    toast.mockClear();
    gameEvents.emit(winEvent());
    expect(toast).not.toHaveBeenCalled();
  });

  it('runs without a bridge (browser) and survives an unreadable save', async () => {
    const store = fakeStore(undefined, true);
    const { runtime, toast } = make(store, null);
    await runtime.whenReady();
    gameEvents.emit({ type: 'photo.taken', context: 'driving' });
    expect(toast).toHaveBeenCalledWith('Achievement unlocked: Shutter Click');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.writes).toHaveLength(1);
  });

  it('merges unlocks from Steam silently and pushes local ones Steam lacks', async () => {
    const store = fakeStore({
      version: 1,
      unlocked: { photo_first: 1 },
      counters: {},
      seen: {},
    });
    const { bridge, unlocked } = fakeBridge({
      available: true,
      onSteam: ['circuit_win', 'not_ours'],
    });
    const { runtime, toast } = make(store, bridge);
    await runtime.whenReady();
    expect(runtime.snapshot.unlocked.circuit_win).toBe(42);
    expect(runtime.snapshot.unlocked.not_ours).toBeUndefined();
    expect(runtime.snapshot.unlocked.photo_first).toBe(1);
    expect(unlocked).toEqual([['photo_first']]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('does nothing toward Steam when Steam is unavailable', async () => {
    const store = fakeStore();
    const { bridge, unlocked, presence } = fakeBridge({ available: false });
    const { runtime } = make(store, bridge);
    await runtime.whenReady();
    gameEvents.emit({ type: 'photo.taken', context: 'driving' });
    await new Promise((r) => setTimeout(r, 0));
    expect(unlocked).toEqual([]);
    expect(presence).toEqual([]);
    expect(runtime.snapshot.unlocked.photo_first).toBe(42);
  });

  it('maps lifecycle events and UI modes to rich-presence statuses', () => {
    expect(
      presenceFor({
        type: 'session.started',
        kind: 'circuit',
        discipline: 'motocross',
        circuitId: 'valley-ridge-mx',
        vehicleId: 'mx450',
        weather: 'rain',
      }),
    ).toEqual({
      status: 'Racing',
      venue: 'valley-ridge-mx',
      vehicle: 'mx450',
      weather: 'rain',
      discipline: 'motocross',
    });
    expect(presenceFor({ type: 'menu.entered' })).toEqual({ status: 'Menu' });
    expect(
      presenceFor({
        type: 'lap.record',
        discipline: 'circuit',
        circuitId: 'a',
        seconds: 1,
        firstOnTrack: true,
      }),
    ).toBeNull();
    expect(statusForMode('driving')).toBe('Racing');
    // The festival has its own status (desktop/STEAM.md "#Status_Festival").
    expect(statusForMode('festival')).toBe('Festival');
    expect(statusForMode('loading')).toBe('Loading');
    expect(statusForMode('results')).toBe('Results');
    expect(statusForMode(undefined)).toBe('Menu');
    expect(statusForMode('something-new')).toBe('Menu');
  });
});

describe('desktop save mirror reconciliation', () => {
  const kvOf = (initial: Record<string, unknown>) => {
    const data = new Map(Object.entries(initial));
    const kv: MirrorKv = {
      keys: async () => [...data.keys()],
      get: async (key) => data.get(key),
      entries: async () => Object.fromEntries(data),
      putMany: async (entries) => {
        for (const [k, v] of Object.entries(entries)) data.set(k, v);
      },
    };
    return { data, kv };
  };
  const bridgeOf = (file: { revision: number; entries: Record<string, unknown> }) => {
    const state = {
      ...file,
      seeded: null as null | { entries: Record<string, unknown>; revision: number },
    };
    const puts: [string, unknown, number][] = [];
    const bridge = {
      version: 1,
      saves: {
        info: async () => ({
          revision: state.revision,
          savedAt: 0,
          source: 'primary',
          keys: Object.keys(state.entries),
          path: '/x',
        }),
        load: async () => ({ revision: state.revision, entries: state.entries }),
        seed: async (entries: Record<string, unknown>, revision: number) => {
          state.seeded = { entries, revision };
          return true;
        },
        put: async (k: string, v: unknown, r: number) => {
          puts.push([k, v, r]);
          return r;
        },
        flush: async () => true,
      },
    } as unknown as MotoboundDesktop;
    return { bridge, state, puts };
  };

  it('is absent in a browser', () => {
    expect(DesktopMirror.detect()).toBeNull();
  });

  it('restores an empty IndexedDB from the mirror file', async () => {
    const { data, kv } = kvOf({});
    const { bridge } = bridgeOf({
      revision: 7,
      entries: { settings: { version: 6 }, career: { c: 1 } },
    });
    const report = await DesktopMirror.forBridge(bridge).reconcile(kv);
    expect(report).toMatchObject({ action: 'restored', keys: 2, revision: 7 });
    expect(data.get('settings')).toEqual({ version: 6 });
    expect(data.get(REVISION_KEY)).toBe(7);
  });

  it('prefers a newer mirror (Steam Cloud from another PC) but keeps local-only keys', async () => {
    const { data, kv } = kvOf({ settings: { version: 6, old: true }, local: 1, [REVISION_KEY]: 3 });
    const { bridge } = bridgeOf({ revision: 9, entries: { settings: { version: 6 } } });
    expect((await DesktopMirror.forBridge(bridge).reconcile(kv)).action).toBe('restored');
    expect(data.get('settings')).toEqual({ version: 6 });
    expect(data.get('local')).toBe(1);
  });

  it('re-seeds the mirror when IndexedDB is newer or the mirror is empty', async () => {
    const newer = kvOf({ a: 1, [REVISION_KEY]: 5 });
    const one = bridgeOf({ revision: 2, entries: { a: 0 } });
    const mirror = DesktopMirror.forBridge(one.bridge);
    expect((await mirror.reconcile(newer.kv)).action).toBe('seeded');
    expect(one.state.seeded).toEqual({ entries: { a: 1 }, revision: 6 });
    expect(newer.data.get(REVISION_KEY)).toBe(6);

    const fresh = kvOf({ settings: { q: 1 } }); // existing web profile, first desktop launch
    const two = bridgeOf({ revision: 0, entries: {} });
    expect((await DesktopMirror.forBridge(two.bridge).reconcile(fresh.kv)).action).toBe('seeded');
    expect(two.state.seeded?.entries).toEqual({ settings: { q: 1 } });
  });

  it('leaves equal copies alone and never throws', async () => {
    const same = kvOf({ a: 1, [REVISION_KEY]: 4 });
    const { bridge } = bridgeOf({ revision: 4, entries: { a: 1 } });
    expect((await DesktopMirror.forBridge(bridge).reconcile(same.kv)).action).toBe('in-sync');
    expect(
      (
        await DesktopMirror.forBridge(bridgeOf({ revision: 0, entries: {} }).bridge).reconcile(
          kvOf({}).kv,
        )
      ).action,
    ).toBe('none');

    const broken = {
      version: 1,
      saves: {
        info: async () => {
          throw new Error('ipc down');
        },
      },
    } as unknown as MotoboundDesktop;
    const report = await DesktopMirror.forBridge(broken).reconcile(kvOf({ a: 1 }).kv);
    expect(report.action).toBe('failed');
    expect(report.detail).toContain('ipc down');
  });

  it('stamps every write with a rising revision and forwards it after commit', async () => {
    const { bridge, puts } = bridgeOf({ revision: 10, entries: { a: 1 } });
    const mirror = DesktopMirror.forBridge(bridge);
    await mirror.reconcile(kvOf({ a: 1, [REVISION_KEY]: 10 }).kv);
    const stamped: [unknown, IDBValidKey][] = [];
    const store = {
      put: (v: unknown, k: IDBValidKey) => stamped.push([v, k]),
    } as unknown as IDBObjectStore;
    const first = mirror.stamp(store);
    const second = mirror.stamp(store);
    expect([first, second]).toEqual([11, 12]);
    expect(stamped).toEqual([
      [11, REVISION_KEY],
      [12, REVISION_KEY],
    ]);
    mirror.written(
      [
        ['career:backup', { o: 1 }],
        ['career', { n: 1 }],
      ],
      second,
    );
    await Promise.resolve();
    expect(puts).toEqual([
      ['career:backup', { o: 1 }, 12],
      ['career', { n: 1 }, 12],
    ]);
  });
});
