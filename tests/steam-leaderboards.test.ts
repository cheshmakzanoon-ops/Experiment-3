import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';
import type { MotoboundDesktop, SteamLeaderboardReply } from '../src/desktop/bridge.ts';
import { GameEventBus } from '../src/steam/events.ts';
import { timeTrialLapEvent } from '../src/steam/hooks.ts';
import {
  LEADERBOARD_STORE_KEY,
  MAX_BOARDS,
  MAX_TRIES,
  decodeDetails,
  emptyBoards,
  encodeDetails,
  formatScore,
  lapScore,
  parseBoardName,
  parseLeaderboardKey,
  pendingBoards,
  recordScore,
  submitPending,
  thaw,
  timeTrialBoardName,
  validateBoards,
  wildcardBoardName,
  type BoardStore,
} from '../src/steam/leaderboards.ts';
import { LeaderboardRuntime } from '../src/steam/leaderboard-runtime.ts';
import { wildcardSeries } from '../src/career/wildcard-series.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { insertLeaderboard, leaderboardKey } from '../src/storage/leaderboard.ts';
import { ghostKey } from '../src/core/ghost-lap.ts';

const P = SIMULATION_VERSION;

describe('board names', () => {
  it('are built from plain slugs and parse back', () => {
    expect(timeTrialBoardName('alpine-pass', 'apx01', 21)).toBe('tt.alpine-pass.apx01.p21');
    expect(wildcardBoardName('descent-in-the-cloud', 21)).toBe('wc.descent-in-the-cloud.p21');
    expect(parseBoardName('tt.alpine-pass.apx01.p21')).toEqual({
      kind: 'time-trial',
      circuit: 'alpine-pass',
      vehicle: 'apx01',
      physics: 21,
    });
    expect(parseBoardName('wc.karts-after-dark.p3')).toEqual({
      kind: 'wildcard',
      event: 'karts-after-dark',
      physics: 3,
    });
    expect(timeTrialBoardName('aurel', 'apx01')).toBe(`tt.aurel.apx01.p${P}`);
  });
  it('are made for every real circuit, machine and Wildcard event, within Steam limits', () => {
    for (const circuit of Object.keys(CIRCUITS))
      for (const vehicle of Object.keys(VEHICLES)) {
        const name = timeTrialBoardName(circuit, vehicle)!;
        expect(name, `${circuit}/${vehicle}`).toBeTruthy();
        expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(128);
        expect(parseBoardName(name)).toMatchObject({ circuit, vehicle });
      }
    for (const entry of wildcardSeries())
      expect(wildcardBoardName(entry.id), entry.id).toBeTruthy();
  });
  it('refuse anything that is not a slug, and names the game did not make', () => {
    for (const bad of ['', 'Aurel', 'a b', 'a.b', '../x', 'x'.repeat(60), 'a_b'])
      expect(timeTrialBoardName(bad, 'apx01'), bad).toBeNull();
    expect(timeTrialBoardName('aurel', 'apx01', 0)).toBeNull();
    expect(timeTrialBoardName('aurel', 'apx01', 1.5)).toBeNull();
    for (const bad of [
      null,
      42,
      'tt.aurel.p21',
      'tt.aurel.apx01',
      'tt.aurel.apx01.p0',
      'tt.aurel.apx01.p21.extra',
      'xx.aurel.apx01.p21',
      'wc.a.b.p21',
      `tt.${'a'.repeat(60)}.apx01.p21`,
      'tt.Aurel.apx01.p21',
    ])
      expect(parseBoardName(bad), String(bad)).toBeNull();
  });
});

describe('scores', () => {
  it('are whole milliseconds within a plausible lap, else nothing', () => {
    expect(lapScore(83.4567)).toBe(83457);
    expect(lapScore(3)).toBe(3000);
    for (const bad of [0, -1, 2.99, 1800.001, Number.NaN, Number.POSITIVE_INFINITY])
      expect(lapScore(bad), String(bad)).toBeNull();
  });
  it('are shown as m:ss.mmm', () => {
    expect(formatScore(83457)).toBe('1:23.457');
    expect(formatScore(59999)).toBe('0:59.999');
    expect(formatScore(600000)).toBe('10:00.000');
    expect(formatScore(-5)).toBe('0:00.000');
  });
  it('carry stable detail codes, never indexes', () => {
    const details = encodeDetails({ assist: 'raw', compound: 'wet', weather: 'snow' });
    expect(details).toEqual([1, 4, 6]);
    expect(decodeDetails(details)).toEqual({ assist: 'raw', compound: 'wet', weather: 'snow' });
    expect(encodeDetails({ assist: 'x', compound: 'y', weather: 'z' })).toEqual([255, 255, 255]);
    expect(decodeDetails([255])).toMatchObject({ assist: 'unknown' });
  });
});

describe('the outbox', () => {
  const name = 'tt.aurel.apx01.p21';
  it('keeps only the best, remembers what Steam has, and refuses invalid input', () => {
    let store = emptyBoards();
    let result = recordScore(store, name, 90000, [0, 1, 0], 10);
    expect(result.improved).toBe(true);
    store = result.store;
    expect(store.boards[name]).toMatchObject({ score: 90000, sent: null, tries: 0, at: 10 });
    expect(recordScore(store, name, 91000, [], 20).improved).toBe(false);
    expect(recordScore(store, name, 90000, [], 20).improved).toBe(false);
    store = {
      ...store,
      boards: { [name]: { ...store.boards[name], sent: 90000, tries: 2 } },
    };
    result = recordScore(store, name, 88000, [], 30);
    expect(result.improved).toBe(true);
    // A better score resets the tries and is pending again; the old acknowledgement is kept.
    expect(result.store.boards[name]).toMatchObject({ score: 88000, sent: 90000, tries: 0 });
    expect(pendingBoards(result.store)).toEqual([name]);
    // Invalid names and scores never enter.
    expect(recordScore(store, 'nope', 90000, [], 1).improved).toBe(false);
    expect(recordScore(store, name, 12, [], 1).improved).toBe(false);
    expect(recordScore(store, name, 90000.5, [], 1).improved).toBe(false);
  });
  it('is bounded', () => {
    let store = emptyBoards();
    for (let i = 0; i < MAX_BOARDS + 20; i++)
      store = recordScore(store, `tt.c${i}.apx01.p21`, 90000, [], i).store;
    expect(Object.keys(store.boards)).toHaveLength(MAX_BOARDS);
    // An existing board can still improve at the cap.
    expect(recordScore(store, 'tt.c0.apx01.p21', 80000, [], 1).improved).toBe(true);
  });
  it('lists the oldest best first and gives a new launch another chance', () => {
    let store: BoardStore = emptyBoards();
    store = recordScore(store, 'tt.b.apx01.p21', 90000, [], 200).store;
    store = recordScore(store, 'tt.a.apx01.p21', 90000, [], 100).store;
    store = recordScore(store, 'wc.x.p21', 90000, [], 0).store;
    expect(pendingBoards(store)).toEqual(['wc.x.p21', 'tt.a.apx01.p21', 'tt.b.apx01.p21']);
    store.boards['tt.a.apx01.p21'] = { ...store.boards['tt.a.apx01.p21'], tries: MAX_TRIES };
    expect(pendingBoards(store)).not.toContain('tt.a.apx01.p21');
    expect(pendingBoards(thaw(store))).toContain('tt.a.apx01.p21');
    expect(thaw(emptyBoards())).toEqual(emptyBoards());
  });
  it('reads a stored outbox entry by entry and never throws', () => {
    expect(validateBoards(undefined)).toEqual(emptyBoards());
    expect(validateBoards({ version: 2, boards: {} })).toEqual(emptyBoards());
    expect(validateBoards({ version: 1, boards: 'x' })).toEqual(emptyBoards());
    const stored = {
      version: 1,
      boards: {
        [name]: { score: 90000, details: [1, 2, 999, 'x'], at: 5, sent: 91000, tries: 99 },
        'tt.bad': { score: 90000 },
        'tt.b.apx01.p21': { score: 5 },
        'tt.c.apx01.p21': { score: 90000.5 },
        'tt.d.apx01.p21': null,
      },
    };
    const store = validateBoards(stored);
    expect(Object.keys(store.boards)).toEqual([name]);
    expect(store.boards[name]).toEqual({
      score: 90000,
      details: [1, 2],
      at: 5,
      sent: 91000,
      tries: MAX_TRIES,
    });
  });
});

describe('submitPending', () => {
  const seeded = () => {
    let store = emptyBoards();
    store = recordScore(store, 'tt.a.apx01.p21', 91000, [0], 1).store;
    store = recordScore(store, 'tt.b.apx01.p21', 92000, [0], 2).store;
    store = recordScore(store, 'wc.c.p21', 93000, [0], 3).store;
    return store;
  };
  it('sends every pending board in order and marks it sent', async () => {
    const seen: string[] = [];
    const report = await submitPending(seeded(), async (n, score) => {
      seen.push(`${n}=${score}`);
      return { ok: true, rank: 7 };
    });
    expect(seen).toEqual(['tt.a.apx01.p21=91000', 'tt.b.apx01.p21=92000', 'wc.c.p21=93000']);
    expect(report).toMatchObject({ sent: 3, failed: 0, unavailable: null });
    expect(pendingBoards(report.store)).toEqual([]);
    expect(report.store.boards['wc.c.p21'].sent).toBe(93000);
  });
  it('stops at "unavailable" without counting a failure', async () => {
    let calls = 0;
    const report = await submitPending(seeded(), async () => {
      calls++;
      return { ok: false, unavailable: true, reason: 'no Steam' };
    });
    expect(calls).toBe(1);
    expect(report).toMatchObject({ sent: 0, failed: 0, unavailable: 'no Steam' });
    expect(pendingBoards(report.store)).toHaveLength(3);
    expect(Object.values(report.store.boards).every((r) => r.tries === 0)).toBe(true);
  });
  it('counts a refusal or a thrown error against that board only', async () => {
    const report = await submitPending(seeded(), async (n) => {
      if (n.startsWith('tt.a')) return { ok: false, reason: 'refused' };
      if (n.startsWith('tt.b')) throw new Error('boom');
      return { ok: true };
    });
    expect(report).toMatchObject({ sent: 1, failed: 2, unavailable: null });
    expect(report.store.boards['tt.a.apx01.p21'].tries).toBe(1);
    expect(report.store.boards['tt.b.apx01.p21'].tries).toBe(1);
    expect(report.store.boards['wc.c.p21'].sent).toBe(93000);
    // After MAX_TRIES the board waits for the next launch.
    let store = report.store;
    for (let i = 0; i < MAX_TRIES; i++)
      store = (await submitPending(store, async () => ({ ok: false }))).store;
    expect(pendingBoards(store)).toEqual([]);
  });
});

describe('local board keys', () => {
  it('reads the keys storage/leaderboard.ts writes', () => {
    expect(parseLeaderboardKey(leaderboardKey('aurel'))).toEqual({
      circuit: 'aurel',
      vehicle: 'apx01',
      physics: 1,
    });
    expect(parseLeaderboardKey(leaderboardKey('aurel', 'apx01', P))).toEqual({
      circuit: 'aurel',
      vehicle: 'apx01',
      physics: P,
    });
    expect(parseLeaderboardKey(leaderboardKey('alpine-pass', 'gpr1', 5))).toEqual({
      circuit: 'alpine-pass',
      vehicle: 'gpr1',
      physics: 5,
    });
    for (const bad of ['ghost:v1:aurel', 'leaderboard:', 'leaderboard:A', 'leaderboard:a:b', 'x'])
      expect(parseLeaderboardKey(bad), bad).toBeNull();
  });
});

// ---- The runtime, with a fake bridge and a fake save store ------------------------------------------
function fakeStore(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    read: async (key: string) => data.get(key),
    write: async (key: string, value: unknown) => void data.set(key, structuredClone(value)),
    keys: async (prefix: string) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}
function fakeBridge(options: {
  available?: boolean;
  reason?: string | null;
  reply?: (name: string, score: number) => SteamLeaderboardReply | Promise<SteamLeaderboardReply>;
}) {
  const sent: { name: string; score: number; details: number[] }[] = [];
  const bridge = {
    version: 1,
    steam: {
      status: async () => ({ available: true, reason: null, appId: null, name: null }),
      unlocked: async () => [],
      unlock: async () => [],
      presence: async () => true,
      leaderboards: {
        status: async () => ({
          available: options.available ?? true,
          reason: options.reason ?? null,
        }),
        submit: async (name: string, score: number, details: number[]) => {
          sent.push({ name, score, details });
          return options.reply ? options.reply(name, score) : { ok: true as const, rank: 3 };
        },
      },
    },
  } as unknown as MotoboundDesktop;
  return { bridge, sent };
}
const lap = (seconds: number, extra: Partial<ReturnType<typeof timeTrialLapEvent>> = {}) => ({
  ...timeTrialLapEvent(
    {
      circuit: 'aurel',
      vehicles: ['apx01'],
      assist: 'sport',
      compound: 'medium',
      weather: 'clear',
    },
    seconds,
  ),
  ...extra,
});

describe('the leaderboard runtime', () => {
  const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const withBus = (host: ConstructorParameters<typeof LeaderboardRuntime>[0]) => {
    // The runtime listens on the process-wide bus; tests drive the same bus.
    const runtime = new LeaderboardRuntime(host);
    return runtime;
  };
  it('is inert in a browser and in a shell without leaderboard support (writes nothing)', async () => {
    const store = fakeStore();
    const none = withBus({ store, bridge: null });
    expect(none.supported).toBe(false);
    none.start();
    await none.whenReady();
    expect(store.data.size).toBe(0);
    const old = withBus({
      store,
      bridge: { version: 1, steam: { presence: async () => true } } as unknown as MotoboundDesktop,
    });
    expect(old.supported).toBe(false);
    old.start();
    expect(store.data.size).toBe(0);
    expect(none.status()).toMatchObject({ supported: false, online: false, pending: 0 });
  });
  it('records valid laps and Wildcard runs, sends them, and persists what Steam acknowledged', async () => {
    const { emitGameEvent } = await import('../src/steam/events.ts');
    const store = fakeStore();
    const { bridge, sent } = fakeBridge({});
    const runtime = withBus({ store, bridge, now: () => 1000 });
    const stop = runtime.start();
    await runtime.whenReady();
    emitGameEvent(lap(83.456));
    emitGameEvent({
      type: 'wildcard.result',
      eventId: 'descent-in-the-cloud',
      physics: P,
      bestLap: 301.2,
      position: 2,
      medal: 'silver',
      assist: 'sport',
      weather: 'fog',
    });
    await sleep(20);
    expect(sent.map((s) => `${s.name}=${s.score}`)).toEqual([
      `tt.aurel.apx01.p${P}=83456`,
      `wc.descent-in-the-cloud.p${P}=301200`,
    ]);
    expect(sent[0].details).toEqual([0, 1, 0]);
    expect(sent[1].details).toEqual([0, 1, 3]);
    const saved = validateBoards(store.data.get(LEADERBOARD_STORE_KEY));
    expect(Object.values(saved.boards).every((r) => r.sent === r.score)).toBe(true);
    expect(runtime.status()).toMatchObject({ supported: true, online: true, pending: 0, sent: 2 });
    // A slower lap is not sent again; a faster one is.
    emitGameEvent(lap(84.0));
    await sleep(20);
    expect(sent).toHaveLength(2);
    emitGameEvent(lap(82.5));
    await sleep(20);
    expect(sent.at(-1)).toMatchObject({ score: 82500 });
    // An invalid lap never enters.
    emitGameEvent(lap(1.2));
    emitGameEvent(lap(Number.NaN));
    await sleep(10);
    expect(sent).toHaveLength(3);
    stop();
  });
  it('keeps the scores and says why when Steam is not taking them, then sends later', async () => {
    const { emitGameEvent } = await import('../src/steam/events.ts');
    const store = fakeStore();
    let available = false;
    const { bridge, sent } = fakeBridge({});
    bridge.steam.leaderboards!.status = async () => ({
      available,
      reason: available ? null : 'Steam client not running',
    });
    const runtime = withBus({ store, bridge });
    const stop = runtime.start();
    await runtime.whenReady();
    emitGameEvent(lap(80));
    await sleep(20);
    expect(sent).toHaveLength(0);
    expect(runtime.status()).toMatchObject({
      online: false,
      reason: 'Steam client not running',
      pending: 1,
    });
    expect(
      validateBoards(store.data.get(LEADERBOARD_STORE_KEY)).boards[`tt.aurel.apx01.p${P}`].sent,
    ).toBeNull();
    available = true;
    await runtime.flush();
    expect(sent).toHaveLength(1);
    expect(runtime.status()).toMatchObject({ online: true, pending: 0 });
    stop();
  });
  it('treats a binding without a leaderboard API like Steam being away (unavailable, no failures)', async () => {
    const { emitGameEvent } = await import('../src/steam/events.ts');
    const store = fakeStore();
    const { bridge } = fakeBridge({
      reply: () => ({ ok: false, unavailable: true, reason: 'no leaderboard API' }),
    });
    const runtime = withBus({ store, bridge });
    const stop = runtime.start();
    await runtime.whenReady();
    emitGameEvent(lap(80));
    await sleep(20);
    const board = validateBoards(store.data.get(LEADERBOARD_STORE_KEY)).boards[
      `tt.aurel.apx01.p${P}`
    ];
    expect(board).toMatchObject({ score: 80000, sent: null, tries: 0 });
    expect(runtime.status()).toMatchObject({
      online: false,
      reason: 'no leaderboard API',
      pending: 1,
    });
    stop();
  });
  it('seeds laps set before Steam from the local boards, this physics version only', async () => {
    const mine = insertLeaderboard([], {
      lapTime: 91.234,
      driver: 'A',
      assist: 'raw',
      compound: 'soft',
      weather: 'rain',
      session: 's1',
    }).board;
    const better = insertLeaderboard(mine, {
      lapTime: 90.5,
      driver: 'A',
      assist: 'sport',
      compound: 'medium',
      weather: 'clear',
      session: 's2',
    }).board;
    const store = fakeStore({
      [leaderboardKey('aurel', 'apx01', P)]: better,
      [leaderboardKey('vellamar', 'gpr1', P)]: mine,
      [leaderboardKey('aurel', 'apx01', P - 1)]: mine, // an older physics version: not ranked
      [leaderboardKey('aurel')]: mine, // the legacy v1 key: not ranked
      [ghostKey('aurel')]: { not: 'a board' },
    });
    const { bridge, sent } = fakeBridge({});
    const runtime = withBus({ store, bridge });
    const stop = runtime.start();
    await runtime.whenReady();
    expect(sent.map((s) => `${s.name}=${s.score}`).sort()).toEqual([
      `tt.aurel.apx01.p${P}=90500`,
      `tt.vellamar.gpr1.p${P}=91234`,
    ]);
    expect(sent.find((s) => s.name.includes('vellamar'))!.details).toEqual([1, 0, 2]);
    stop();
  });
  it('restores the outbox after a restart and gives unsent boards another chance', async () => {
    let seeded = emptyBoards();
    seeded = recordScore(seeded, `tt.aurel.apx01.p${P}`, 85000, [0, 1, 0], 5).store;
    seeded.boards[`tt.aurel.apx01.p${P}`].tries = MAX_TRIES;
    const store = fakeStore({ [LEADERBOARD_STORE_KEY]: seeded });
    const { bridge, sent } = fakeBridge({});
    const runtime = withBus({ store, bridge });
    const stop = runtime.start();
    await runtime.whenReady();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ score: 85000 });
    stop();
  });
  it('survives an unreadable save and a failing store', async () => {
    const broken = {
      read: async () => {
        throw new Error('disk');
      },
      write: async () => {
        throw new Error('disk');
      },
    };
    const { bridge, sent } = fakeBridge({});
    const runtime = withBus({ store: broken, bridge });
    const stop = runtime.start();
    await expect(runtime.whenReady()).resolves.toBeUndefined();
    const { emitGameEvent } = await import('../src/steam/events.ts');
    emitGameEvent(lap(80));
    await sleep(20);
    expect(sent).toHaveLength(1);
    stop();
  });
  it('queues events that arrive before the save is read', async () => {
    const { emitGameEvent } = await import('../src/steam/events.ts');
    const store = fakeStore();
    const { bridge, sent } = fakeBridge({});
    const runtime = withBus({ store, bridge });
    const stop = runtime.start();
    emitGameEvent(lap(79));
    await runtime.whenReady();
    await sleep(20);
    expect(sent.map((s) => s.score)).toEqual([79000]);
    stop();
  });
});

describe('the event bus carries the two new events', () => {
  it('delivers them to a subscriber and to nobody else by accident', () => {
    const bus = new GameEventBus();
    const seen: string[] = [];
    bus.on('timetrial.lap', (e) => seen.push(`lap ${e.seconds}`));
    bus.on('wildcard.result', (e) => seen.push(`wc ${e.eventId}`));
    bus.emit(lap(80));
    bus.emit({
      type: 'wildcard.result',
      eventId: 'x',
      physics: P,
      bestLap: 40,
      position: 1,
      medal: null,
      assist: 'sport',
      weather: 'clear',
    });
    bus.emit({ type: 'menu.entered' });
    expect(seen).toEqual(['lap 80', 'wc x']);
  });
  it('are emitted where the laps and results are recorded', () => {
    const root = new URL('../', import.meta.url);
    const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
    expect(read('src/session/time-trial-records.ts')).toMatch(/emitTimeTrialLap\(options, time\)/);
    expect(read('src/career/controller.ts')).toMatch(
      /!outcome\.demonstration && outcome\.classified && outcome\.bestLap > 0\)\s+emitWildcardResult/,
    );
    expect(read('src/main.ts')).toContain('startLeaderboards(');
  });
});

// ---- The shell side ---------------------------------------------------------------------------------
const load = createRequire(import.meta.url);
const steam = load('../desktop/src/steam.cjs') as {
  loadSteam(o?: { env?: Record<string, string>; requireFn?: (id: string) => unknown }): {
    available: boolean;
    leaderboards: {
      available: boolean;
      reason: string | null;
      submit(name: unknown, score: unknown, details: unknown): Promise<Record<string, unknown>>;
    };
  };
  makeLeaderboards(
    client: unknown,
    log?: (m: string) => void,
  ): {
    available: boolean;
    reason: string | null;
    submit(name: unknown, score: unknown, details: unknown): Promise<Record<string, unknown>>;
  };
  BOARD_NAME: RegExp;
};
const fakeClient = (api: unknown) => ({
  localplayer: { getName: () => 'tester', setRichPresence: () => {} },
  achievement: { activate: () => true, isActivated: () => false },
  leaderboard: api,
});

describe('the shell adapter (desktop/src/steam.cjs)', () => {
  it('is unavailable, with the reason, when the Steam binding has no leaderboard API (steamworks.js 0.4.0)', async () => {
    const lb = steam.makeLeaderboards({ achievement: {}, stats: {} });
    expect(lb.available).toBe(false);
    expect(lb.reason).toMatch(/no leaderboard API/);
    await expect(lb.submit('tt.a.b.p1', 90000, [])).resolves.toMatchObject({
      ok: false,
      unavailable: true,
    });
    expect(steam.makeLeaderboards(null).available).toBe(false);
    expect(steam.makeLeaderboards({ leaderboard: { findOrCreate() {} } }).available).toBe(false);
  });
  it('is unavailable everywhere Steam itself is (no package, no client, disabled)', async () => {
    const none = steam.loadSteam({
      requireFn: () => {
        throw new Error('missing');
      },
    });
    expect(none.available).toBe(false);
    expect(none.leaderboards.available).toBe(false);
    await expect(none.leaderboards.submit('x', 1, [])).resolves.toMatchObject({
      unavailable: true,
    });
    const off = steam.loadSteam({ env: { MOTOBOUND_STEAM: '0' }, requireFn: () => ({}) });
    expect(off.leaderboards.available).toBe(false);
  });
  it('finds or creates each board once and uploads keep-best, milliseconds, ascending', async () => {
    const calls: unknown[][] = [];
    const api = {
      findOrCreate: async (...a: unknown[]) => {
        calls.push(['find', ...a]);
        return { handle: a[0] };
      },
      uploadScore: async (...a: unknown[]) => {
        calls.push(['upload', ...a]);
        return { scoreChanged: true, globalRank: 12 };
      },
    };
    const loaded = steam.loadSteam({
      requireFn: () => ({ init: () => fakeClient(api), electronEnableSteamOverlay: () => {} }),
    });
    expect(loaded.available).toBe(true);
    expect(loaded.leaderboards.available).toBe(true);
    const name = 'tt.aurel.apx01.p21';
    await expect(loaded.leaderboards.submit(name, 83456, [0, 1, 0])).resolves.toEqual({
      ok: true,
      changed: true,
      rank: 12,
    });
    await loaded.leaderboards.submit(name, 82000, [0, 1, 0]);
    // SDK enums: ascending = 1, time in milliseconds = 3, keep best = 1.
    expect(calls).toEqual([
      ['find', name, 1, 3],
      ['upload', { handle: name }, 83456, 1, [0, 1, 0]],
      ['upload', { handle: name }, 82000, 1, [0, 1, 0]],
    ]);
  });
  it('validates what the page sends and contains every failure', async () => {
    let finds = 0;
    const lb = steam.makeLeaderboards(
      fakeClient({
        findOrCreate: async () => {
          finds++;
          if (finds === 1) throw new Error('network down');
          return 7;
        },
        uploadScore: async () => ({ scoreChanged: false }),
      }),
    );
    expect(await lb.submit('../x', 90000, [])).toMatchObject({
      ok: false,
      reason: 'invalid board name',
    });
    expect(await lb.submit('tt.a.b.p1', 5, [])).toMatchObject({
      ok: false,
      reason: 'invalid score',
    });
    expect(await lb.submit('tt.a.b.p1', 2_000_000, [])).toMatchObject({ ok: false });
    expect(await lb.submit('tt.a.b.p1', 90000.5, [])).toMatchObject({ ok: false });
    expect(await lb.submit({}, 90000, [])).toMatchObject({ ok: false });
    // A failed lookup is not cached: the next send tries again and succeeds.
    expect(await lb.submit('tt.a.b.p1', 90000, [])).toMatchObject({
      ok: false,
      reason: 'network down',
    });
    expect(await lb.submit('tt.a.b.p1', 90000, [1, 999, -1, 2.5, 'x'])).toEqual({
      ok: true,
      changed: false,
    });
    expect(finds).toBe(2);
  });
  it('accepts exactly the board names the game makes', () => {
    for (const name of [
      timeTrialBoardName('alpine-pass', 'apx01')!,
      wildcardBoardName('karts-after-dark')!,
    ])
      expect(steam.BOARD_NAME.test(name), name).toBe(true);
    for (const bad of ['tt.a.p1', 'wc.a.b.p1', 'tt.A.b.p1', 'tt.a.b.p0', 'x'])
      expect(steam.BOARD_NAME.test(bad), bad).toBe(false);
  });
  it('is exposed through the preload and handled in main with the Steam-away answers', () => {
    const root = new URL('../desktop/', import.meta.url);
    const main = readFileSync(new URL('main.cjs', root), 'utf8');
    const preload = readFileSync(new URL('preload.cjs', root), 'utf8');
    expect(main).toContain("handle('steam:lb:status'");
    expect(main).toContain("handle('steam:lb:submit'");
    expect(main).toMatch(/if \(!steam\.available\) return \{ ok: false, unavailable: true/);
    expect(preload).toContain("status: () => call('steam:lb:status')");
    expect(preload).toContain("submit: (name, score, details) => call('steam:lb:submit'");
  });
});
