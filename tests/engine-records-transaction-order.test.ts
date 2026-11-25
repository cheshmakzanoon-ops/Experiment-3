import { afterEach, describe, expect, it, vi } from 'vitest';
import { GHOST_FIELDS, ghostKey, type GhostLap } from '../src/core/ghost-lap.ts';
import { recordCategory, SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { TimeTrialRecords, type RecordsHost } from '../src/session/time-trial-records.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { gameEvents } from '../src/steam/events.ts';
import {
  insertLeaderboard,
  leaderboardKey,
  type LeaderboardEntry,
} from '../src/storage/leaderboard.ts';

const track = new Track();
const options = (): SessionOptions => ({
  ...DEFAULT_OPTIONS,
  mode: 'time-trial',
  opponents: 0,
  vehicles: ['apx01'],
});
const category = recordCategory(options());
const boardKey = leaderboardKey(track.circuit.id, category.vehicle, category.physics);
const savedGhostKey = ghostKey(track.circuit.id, category.vehicle);
const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function memoryStore(beforeWrite?: (key: string, value: unknown) => Promise<void>) {
  const values = new Map<string, unknown>();
  const store = {
    read: vi.fn(async (key: string) => structuredClone(values.get(key))),
    write: vi.fn(async (key: string, value: unknown) => {
      await beforeWrite?.(key, value);
      values.set(key, structuredClone(value));
    }),
  };
  return { store, values };
}

function fixtureGhost(time: number, vehicle = 'apx01'): GhostLap {
  const samples = new Float32Array(21 * GHOST_FIELDS);
  for (let i = 0; i <= 20; i++) {
    samples[i * GHOST_FIELDS] = i === 0 ? 0.1 : (time * i) / 20;
    samples[i * GHOST_FIELDS + 1] = (track.length * i) / 20;
    samples[i * GHOST_FIELDS + 8] = 1;
  }
  return {
    version: 1,
    circuit: track.circuit.id,
    trackLength: track.length,
    lapTime: time,
    sectors: [time / 3, time / 3, time / 3],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '2026-11-25T00:00:00.000Z',
    samples,
    vehicle,
    physics: SIMULATION_VERSION,
  };
}

/** Prescribed accepted snapshots exercise the real recorder and public lifecycle;
 * storage scheduling is controlled independently of driving/physics timing. */
function lapDriver(records: TimeTrialRecords, settings = options(), session = 'same-session') {
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  const o = carBase(0);
  frame[H.CARS] = frame[o + F.QW] = frame[o + F.LAP_VALID] = 1;
  let laps = 0;
  return (time: number) => {
    for (let i = 0; i <= 20; i++) {
      frame[o + F.LAPS] = laps;
      frame[o + F.LAP_TIME] = 0.1 + ((time - 0.2) * i) / 20;
      frame[o + F.S] = (track.length * frame[o + F.LAP_TIME]) / time;
      records.observe(frame, true, settings, session);
    }
    frame[o + F.LAPS] = ++laps;
    frame[o + F.LAP_TIME] = 0.01;
    frame[o + F.S] = 1;
    frame[o + F.LAST_LAP] = time;
    frame[o + F.LAST_LAP_VALID] = 1;
    frame[o + F.SECTOR_1] = frame[o + F.SECTOR_2] = frame[o + F.SECTOR_3] = time / 3;
    records.observe(frame, true, settings, session);
  };
}

async function prepared(store: RecordsHost['store'], settings = options()) {
  const toast = vi.fn();
  const records = new TimeTrialRecords({ store, toast, playerName: () => 'Driver' });
  await records.prepare(settings, track, () => true);
  toast.mockClear();
  return { records, toast, drive: lapDriver(records, settings) };
}

const entry = (time = 45, driver = 'Driver'): LeaderboardEntry => ({
  lapTime: time,
  driver,
  assist: 'sport',
  compound: 'medium',
  weather: 'clear',
  session: 'same-session',
});

describe('stable leaderboard insertion identity', () => {
  it('ranks a repeated equal lap after its predecessors and excludes the eleventh', () => {
    let board: LeaderboardEntry[] = [];
    for (let rank = 1; rank <= 10; rank++) {
      const inserted = insertLeaderboard(board, entry());
      expect(inserted.rank).toBe(rank);
      board = inserted.board;
    }
    expect(insertLeaderboard(board, entry())).toEqual({ board, rank: 0 });
    const faster = insertLeaderboard(board, entry(44));
    expect(faster.rank).toBe(1);
    expect(faster.board.map((lap) => lap.lapTime)).toEqual([44, ...Array<number>(9).fill(45)]);
  });

  it('preserves insertion rank when the persisted driver name is normalized', () => {
    const inserted = insertLeaderboard([], entry(45, 'a'.repeat(40)));
    expect(inserted.rank).toBe(1);
    expect(inserted.board[0].driver).toBe('a'.repeat(24));
  });
});

describe('accepted record update ordering', () => {
  it('retains overlapping laps across records sharing a simple store without blocking other keys', async () => {
    const gate = deferred<void>();
    let hold = true;
    const { store, values } = memoryStore(async (key) => {
      if (key === boardKey && hold) {
        hold = false;
        await gate.promise;
      }
    });
    const a = await prepared(store);
    const b = await prepared(store);
    const bikeOptions = { ...options(), vehicles: ['gpr1'] };
    const bike = await prepared(store, bikeOptions);
    const bikeBoardKey = leaderboardKey(track.circuit.id, 'gpr1', category.physics);
    a.drive(45);
    b.drive(45);
    a.drive(44);
    bike.drive(50);
    await vi.waitFor(() => expect(values.get(bikeBoardKey)).toHaveLength(1));
    expect(values.has(boardKey)).toBe(false);
    expect(store.read.mock.calls.filter(([key]) => key === boardKey)).toHaveLength(1);
    gate.resolve();
    await vi.waitFor(() => expect(values.get(boardKey)).toHaveLength(3));
    expect((values.get(boardKey) as LeaderboardEntry[]).map((lap) => lap.lapTime)).toEqual([
      44, 45, 45,
    ]);
    await vi.waitFor(() =>
      expect(b.toast.mock.calls.some(([message]) => message.startsWith('P2 ON THE LOCAL'))).toBe(
        true,
      ),
    );
    expect((values.get(savedGhostKey) as GhostLap).lapTime).toBe(44);
  });

  it.each(['read', 'write'] as const)(
    'continues the same key after a rejected %s',
    async (failure) => {
      const { store, values } = memoryStore();
      let fail = true;
      if (failure === 'read') {
        const read = store.read.getMockImplementation()!;
        store.read.mockImplementation(async (key) => {
          if (key === boardKey && fail) {
            fail = false;
            throw new Error('unavailable read');
          }
          return read(key);
        });
      } else {
        const write = store.write.getMockImplementation()!;
        store.write.mockImplementation(async (key, value) => {
          if (key === boardKey && fail) {
            fail = false;
            throw new Error('unavailable write');
          }
          return write(key, value);
        });
      }
      const { drive, toast } = await prepared(store);
      drive(45);
      drive(44);
      await vi.waitFor(() => expect(values.get(boardKey)).toHaveLength(1));
      expect((values.get(boardKey) as LeaderboardEntry[])[0].lapTime).toBe(44);
      await vi.waitFor(() =>
        expect(toast.mock.calls.some(([message]) => message.startsWith('P1 ON THE LOCAL'))).toBe(
          true,
        ),
      );
      expect(
        toast.mock.calls.some(([message]) => message.startsWith('Leaderboard not saved:')),
      ).toBe(true);
    },
  );

  it('uses atomic updates and retains the faster ghost when completion order is reversed', async () => {
    const { store: simple, values } = memoryStore();
    const updates: { key: string; commit(): void }[] = [];
    const update = vi.fn((key: string, change: (stored: unknown) => unknown) => {
      const completion = deferred<unknown>();
      updates.push({
        key,
        commit() {
          const stored = structuredClone(values.get(key));
          const value = change(stored);
          if (value !== stored) values.set(key, structuredClone(value));
          completion.resolve(value);
        },
      });
      return completion.promise;
    });
    const { drive, toast } = await prepared({ ...simple, update });
    drive(45);
    drive(44);
    expect(updates).toHaveLength(4);
    expect(simple.read.mock.calls.every(([key]) => key === savedGhostKey)).toBe(true);
    expect(simple.write).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    for (const operation of updates.filter(({ key }) => key === boardKey)) operation.commit();
    for (const operation of updates.filter(({ key }) => key === savedGhostKey).reverse())
      operation.commit();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(3));
    expect((values.get(boardKey) as LeaderboardEntry[]).map((lap) => lap.lapTime)).toEqual([
      44, 45,
    ]);
    expect((values.get(savedGhostKey) as GhostLap).lapTime).toBe(44);
    expect(
      toast.mock.calls.filter(([message]) => message.startsWith('PERSONAL BEST')),
    ).toHaveLength(1);
  });
});

describe('records session presentation ownership', () => {
  it.each([
    ['clear', 'resolve'],
    ['clear', 'reject'],
    ['replace', 'resolve'],
    ['replace', 'reject'],
  ] as const)(
    'ignores an old prepare after %s when its read will %s',
    async (transition, result) => {
      const late = deferred<unknown>();
      const { store } = memoryStore();
      store.read.mockImplementationOnce(() => late.promise);
      store.read.mockResolvedValue(fixtureGhost(50));
      const toast = vi.fn();
      const records = new TimeTrialRecords({ store, toast, playerName: () => 'Driver' });
      const preparing = records.prepare(options(), track, () => true);
      if (transition === 'clear') records.clear();
      else await records.prepare(options(), track, () => true);
      const activePlayer = records.player;
      const activeTrial = records.trial;
      toast.mockClear();
      if (result === 'resolve') late.resolve(fixtureGhost(35));
      else late.reject(new Error('late read failure'));
      await preparing;
      expect(toast).not.toHaveBeenCalled();
      expect(records.player).toBe(activePlayer);
      expect(records.trial).toBe(activeTrial);
    },
  );

  it('checks the host ownership predicate and rechecks ownership after a load failure toast', async () => {
    const late = deferred<unknown>();
    const { store } = memoryStore();
    store.read.mockImplementationOnce(() => late.promise);
    let live = true;
    const toast = vi.fn();
    const records = new TimeTrialRecords({ store, toast, playerName: () => 'Driver' });
    const preparing = records.prepare(options(), track, () => live);
    live = false;
    late.reject(new Error('departed'));
    await preparing;
    expect(toast).not.toHaveBeenCalled();
    expect(records.trial).toBeNull();
    store.read.mockRejectedValueOnce(new Error('active failure'));
    toast.mockImplementation(() => records.clear());
    await records.prepare(options(), track, () => true);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toContain('Saved ghost unavailable:');
    expect(records.trial).toBeNull();
    expect(records.player).toBeNull();
  });

  it.each([
    ['clear', 'resolve'],
    ['clear', 'reject'],
    ['replace', 'resolve'],
    ['replace', 'reject'],
  ] as const)(
    'keeps accepted saves detached from UI after %s when writes will %s',
    async (transition, result) => {
      const gate = deferred<void>();
      const { store, values } = memoryStore(async () => gate.promise);
      const { records, drive, toast } = await prepared(store);
      drive(45);
      const accepted = structuredClone(records.player!.lap);
      // The public player's buffers are presentation-owned, not a queued save's buffers.
      records.player!.lap.samples[0] = 99;
      records.player!.lap.sectors[0] = 99;
      await vi.waitFor(() => expect(store.write).toHaveBeenCalledTimes(2));
      if (transition === 'clear') records.clear();
      else {
        const bikeOptions = { ...options(), vehicles: ['gpr1'] };
        values.set(ghostKey(track.circuit.id, 'gpr1'), fixtureGhost(50, 'gpr1'));
        await records.prepare(bikeOptions, track, () => true);
      }
      const activePlayer = records.player;
      const activeTrial = records.trial;
      toast.mockClear();
      if (result === 'resolve') gate.resolve();
      else gate.reject(new Error('departed write failure'));
      // Drain the real public write promises and their records completion callbacks.
      await Promise.allSettled(store.write.mock.results.map(({ value }) => value));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(toast).not.toHaveBeenCalled();
      expect(records.player).toBe(activePlayer);
      expect(records.trial).toBe(activeTrial);
      if (result === 'resolve') {
        expect(values.get(savedGhostKey)).toEqual(accepted);
        expect(values.get(boardKey)).toHaveLength(1);
        const reloaded = await prepared(store);
        expect(reloaded.records.player!.lap).toEqual(accepted);
      } else {
        expect(values.has(savedGhostKey)).toBe(false);
        expect(values.has(boardKey)).toBe(false);
      }
    },
  );

  it.each(['lap event', 'player name'] as const)(
    'snapshots accepted inputs and avoids stale HUD mutation when a %s callback clears records',
    async (boundary) => {
      const { store, values } = memoryStore();
      const settings = options();
      const toast = vi.fn();
      let armed = false;
      const clear = () => {
        settings.vehicles![0] = 'gpr1';
        settings.assist = 'raw';
        settings.weather = 'rain';
        settings.compound = 'wet';
        records.clear();
      };
      const records = new TimeTrialRecords({
        store,
        toast,
        playerName: () => {
          if (armed && boundary === 'player name') clear();
          return 'Accepted driver';
        },
      });
      await records.prepare(settings, track, () => true);
      toast.mockClear();
      armed = true;
      releases.push(
        gameEvents.on('timetrial.lap', () => {
          if (boundary === 'lap event') clear();
        }),
      );
      lapDriver(records, settings)(45);
      expect(records.player).toBeNull();
      expect(records.trial).toBeNull();
      await vi.waitFor(() => expect(values.has(savedGhostKey)).toBe(true));
      expect(values.get(boardKey)).toEqual([{ ...entry(), driver: 'Accepted driver' }]);
      expect(values.get(savedGhostKey)).toMatchObject({
        lapTime: 45,
        vehicle: 'apx01',
        assist: 'sport',
        weather: 'clear',
        compound: 'medium',
      });
      expect(toast).not.toHaveBeenCalled();
    },
  );
});
