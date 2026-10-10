import { describe, expect, it } from 'vitest';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import { CHANNELS } from '../src/storage/telemetry-schema.ts';
import { FLASHBACK, flashbackFloor } from '../src/core/flashback.ts';
import { flashbackAllowed } from '../src/ui/flashback.ts';
import {
  LEADERBOARD_SIZE,
  insertLeaderboard,
  leaderboardKey,
  readLeaderboard,
} from '../src/storage/leaderboard.ts';

class MemoryPages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error('missing');
    return structuredClone(page);
  }
  async dispose() {
    this.pages.clear();
  }
}
function pose(i: number) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.TIME] = 5 + i / 15;
  f[H.TICK] = i * 8;
  f[H.CARS] = 1;
  f[carBase(0) + F.X] = i;
  f[carBase(0) + F.QW] = 1;
  return f;
}

describe('flashback recordings', () => {
  it('cuts the replay back to a moment and records the new timeline after it', async () => {
    const store = new MemoryPages(),
      replay = new SessionReplay(1, store, undefined, 4);
    replay.recordSurface(new Float32Array([0.1, 1]), new Float32Array([0.2, 0.3]), 0);
    for (let i = 0; i < 30; i++) {
      replay.append(pose(i));
      if (i === 20)
        replay.recordSurface(
          new Float32Array([2, 2]),
          new Float32Array([0.5, 0.5]),
          pose(i)[H.TIME],
        );
      await replay.settle();
    }
    expect(replay.count).toBe(30);
    // Back into an earlier, already sealed page (held in the page cache).
    const cut = pose(17)[H.TIME];
    expect(replay.canTruncate(cut)).toBe(true);
    expect(replay.truncate(cut)).toBe(true);
    expect(replay.count).toBe(18);
    expect(replay.end).toBeCloseTo(cut, 6);
    expect(replay.canTruncate(pose(0)[H.TIME] - 1)).toBe(false);
    // The resumed session appends from the cut; times keep increasing.
    for (let i = 18; i < 26; i++) {
      const f = pose(i);
      f[carBase(0) + F.X] = 100 + i;
      replay.append(f);
      await replay.settle();
    }
    expect(replay.count).toBe(26);
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    for (let j = 0; j < 4 && replay.sample(20.5 / 15, a, b) === null; j++) await replay.settle();
    expect(replay.sample(20.5 / 15, a, b)).not.toBeNull();
    expect(a[carBase(0) + F.X]).toBe(120);
    expect(replay.error).toBeNull();
    await replay.dispose();
  });

  it('drops telemetry rows newer than the flashback time', () => {
    const t = new TelemetryRecorder(1);
    const row = new Float32Array(CHANNELS.length);
    for (let i = 0; i < 90; i++) {
      row[0] = i / 60;
      t.appendBatch(row, 1);
    }
    expect(t.count).toBe(60);
    expect(t.truncate(0.805)).toBe(89 - 48);
    expect(t.at(t.count - 1, 0)).toBeCloseTo(0.8, 5);
    row[0] = 0.9;
    t.appendBatch(row, 1);
    expect(t.at(t.count - 1, 0)).toBeCloseTo(0.9, 5);
  });

  it('limits flashbacks to 30 s back and 5 per race or practice session', () => {
    expect(flashbackFloor(10 * 120)).toBe(0);
    expect(flashbackFloor(100 * 120)).toBe(70 * 120);
    expect(flashbackAllowed('race', FLASHBACK.perRace - 1)).toBe(true);
    expect(flashbackAllowed('race', FLASHBACK.perRace)).toBe(false);
    expect(flashbackAllowed('practice', 0)).toBe(true);
    expect(flashbackAllowed('time-trial', 0)).toBe(false);
    expect(flashbackAllowed('qualifying', 0)).toBe(false);
  });
});

describe('local time-trial leaderboard', () => {
  it('keeps the ten fastest valid laps per circuit and ranks a new one', () => {
    const lap = (lapTime: number, session = 's') => ({
      lapTime,
      driver: 'YOU',
      assist: 'sport',
      compound: 'soft',
      weather: 'clear',
      session,
    });
    let board: unknown = 'corrupt';
    expect(readLeaderboard(board)).toEqual([]);
    for (let i = 0; i < 12; i++) board = insertLeaderboard(board, lap(60 + i, `s${i}`)).board;
    expect(readLeaderboard(board)).toHaveLength(LEADERBOARD_SIZE);
    expect(insertLeaderboard(board, lap(75)).rank).toBe(0);
    const fast = insertLeaderboard(board, lap(59.5, 'new'));
    expect(fast.rank).toBe(1);
    expect(fast.board[0].lapTime).toBe(59.5);
    expect(insertLeaderboard(board, lap(61.5, 'mid')).rank).toBe(3);
    expect(() => insertLeaderboard(board, lap(NaN))).toThrow();
    expect(leaderboardKey('AUREL')).toBe('leaderboard:AUREL');
  });
});
