import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ghostKey } from '../src/core/ghost-lap.ts';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { wildcardKey, wildcardSeries } from '../src/career/wildcard-series.ts';
import { newCareer } from '../src/career/save.ts';
import { createDemoPolicy, DEMO_SLICE, useDemoPolicy } from '../src/release/demo.ts';
import {
  recordScore,
  emptyBoards,
  timeTrialBoardName,
  wildcardBoardName,
  type BoardStore,
} from '../src/steam/leaderboards.ts';
import { insertLeaderboard, leaderboardKey } from '../src/storage/leaderboard.ts';
import { loadRecords, recordsHtml, type RecordsSource } from '../src/ui/records-board.ts';

const P = SIMULATION_VERSION;
const lapEntry = (lapTime: number, driver = 'ALEX RIVER', session = 's') => ({
  lapTime,
  driver,
  assist: 'sport',
  compound: 'medium',
  weather: 'clear',
  session,
});
function board(...times: number[]) {
  let value: unknown = [];
  times.forEach(
    (t, i) => (value = insertLeaderboard(value, lapEntry(t, 'ALEX RIVER', `s${i}`)).board),
  );
  return value;
}
function source(
  initial: Record<string, unknown>,
  overrides: Partial<RecordsSource> = {},
): RecordsSource {
  const data = new Map(Object.entries(initial));
  return {
    store: {
      read: async (key) => data.get(key),
      keys: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    },
    career: null,
    boards: null,
    steam: null,
    ...overrides,
  };
}

describe('the RECORDS screen (local leaderboards)', () => {
  it('lists each circuit and machine with its top ten, best first, in menu order', async () => {
    const view = await loadRecords(
      source({
        [leaderboardKey('vellamar', 'gpr1', P)]: board(95.5, 94.25, 99),
        [leaderboardKey('aurel', 'apx01', P)]: board(81.234),
        [leaderboardKey('aurel', 'fx26', P)]: board(80.1),
        [ghostKey('aurel', 'apx01')]: { lapTime: 81.234 },
        [leaderboardKey('aurel')]: board(70), // legacy physics v1
        [leaderboardKey('aurel', 'apx01', P - 1)]: board(70), // an older physics version
      }),
    );
    expect(view.timeTrial.map((r) => `${r.circuit}/${r.vehicle}`)).toEqual([
      'aurel/apx01',
      'aurel/fx26',
      'vellamar/gpr1',
    ]);
    expect(view.archived).toBe(2);
    const gp = view.timeTrial[2];
    expect(gp.laps.map((l) => l.lapTime)).toEqual([94.25, 95.5, 99]);
    expect(view.timeTrial[0].ghost).toBe(true);
    expect(view.timeTrial[1].ghost).toBe(false);
    const html = recordsHtml(view);
    expect(html).toContain('1:21.234');
    expect(html).toContain('1:34.250');
    expect(html).toContain('GP-R1 PROTOTYPE'.replace('PROTOTYPE', 'PROTOTYPE'));
    expect((html.match(/class="rc-ghost"/g) ?? []).length).toBe(1);
    expect(html).toContain('2 boards from an older physics version');
    expect(html).toContain('data-action="records:tab:wildcard"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('LOCAL RECORDS');
    // Every control is a native button or details: keyboard and controller reach it.
    expect(html).not.toMatch(/onclick=|<a\s/);
  });
  it('says what to do when there is nothing yet', async () => {
    const view = await loadRecords(source({}));
    expect(view.timeTrial).toEqual([]);
    expect(recordsHtml(view)).toContain('NO LAPS YET');
    expect(recordsHtml(view)).toContain('Time trial');
  });
  it('skips an unreadable or corrupt board and never throws', async () => {
    const view = await loadRecords({
      store: {
        read: async (key) => {
          if (key === leaderboardKey('vellamar', 'gpr1', P)) throw new Error('disk');
          return key === leaderboardKey('aurel', 'apx01', P) ? board(80) : 'garbage';
        },
        keys: async (prefix) =>
          prefix === 'leaderboard:'
            ? [
                leaderboardKey('aurel', 'apx01', P),
                leaderboardKey('vellamar', 'gpr1', P),
                leaderboardKey('aurel', 'tc1', P),
                'leaderboard:???',
              ]
            : Promise.reject(new Error('no ghosts')),
      },
      career: null,
      boards: null,
      steam: null,
    });
    expect(view.timeTrial.map((r) => r.vehicle)).toEqual(['apx01']);
  });
  it('lists the Wildcard events with best lap, medal and finish from the career', async () => {
    const career = newCareer();
    career.results[wildcardKey({ id: 'descent-in-the-cloud' })] = {
      bestPosition: 1,
      bestLap: 301.25,
      starts: 2,
    };
    career.results[wildcardKey({ id: 'hypercar-roof-deck-attack' })] = {
      bestPosition: 1,
      bestLap: 40.8,
      starts: 1,
    };
    career.results[wildcardKey({ id: 'karts-after-dark' })] = {
      bestPosition: 7,
      bestLap: 0,
      starts: 1,
    };
    const view = await loadRecords(source({}, { career }));
    expect(view.wildcard).toHaveLength(wildcardSeries().length);
    const byId = Object.fromEntries(view.wildcard.map((r) => [r.id, r]));
    expect(byId['descent-in-the-cloud']).toMatchObject({
      bestLap: 301.25,
      medal: 'gold',
      starts: 2,
    });
    expect(byId['hypercar-roof-deck-attack'].medal).toBe('gold');
    expect(byId['karts-after-dark']).toMatchObject({ starts: 1, medal: null });
    expect(byId['formula-on-the-wall']).toMatchObject({ starts: 0, bestLap: 0 });
    const html = recordsHtml(view, 'wildcard');
    expect(html).toContain('data-tab="wildcard"');
    expect(html).toContain('5:01.250');
    expect(html).toContain('P7');
    expect(html).toContain('NOT RUN');
    expect((html.match(/class="rc-board rc-event"/g) ?? []).length).toBe(wildcardSeries().length);
  });
  it('shows the Steam state of each board, and the status line for every case', async () => {
    let boards: BoardStore = emptyBoards();
    boards = recordScore(
      boards,
      timeTrialBoardName('aurel', 'apx01', P)!,
      81234,
      [0, 1, 0],
      1,
    ).store;
    boards.boards[timeTrialBoardName('aurel', 'apx01', P)!].sent = 81234;
    boards = recordScore(
      boards,
      timeTrialBoardName('aurel', 'fx26', P)!,
      80100,
      [0, 1, 0],
      2,
    ).store;
    boards = recordScore(
      boards,
      wildcardBoardName('descent-in-the-cloud', P)!,
      301250,
      [0, 1, 3],
      3,
    ).store;
    const career = newCareer();
    career.results[wildcardKey({ id: 'descent-in-the-cloud' })] = {
      bestPosition: 1,
      bestLap: 301.25,
      starts: 1,
    };
    const withSteam = (steam: RecordsSource['steam']) =>
      loadRecords(
        source(
          {
            [leaderboardKey('aurel', 'apx01', P)]: board(81.234),
            [leaderboardKey('aurel', 'fx26', P)]: board(80.1),
          },
          { boards, career, steam },
        ),
      );
    const online = await withSteam({
      supported: true,
      online: true,
      reason: null,
      pending: 2,
      sent: 1,
    });
    expect(online.timeTrial.map((r) => r.steam)).toEqual(['sent', 'queued']);
    expect(online.wildcard.find((r) => r.id === 'descent-in-the-cloud')!.steam).toBe('queued');
    const html = recordsHtml(online);
    expect(html).toContain('ON STEAM');
    expect(html).toContain('QUEUED');
    expect(html).toContain('STEAM LEADERBOARDS · 1 BOARD SENT, 2 WAITING');
    const away = recordsHtml(
      await withSteam({
        supported: true,
        online: false,
        reason: 'Steam client not running',
        pending: 3,
        sent: 0,
      }),
    );
    expect(away).toContain('NOT TAKING SCORES (STEAM CLIENT NOT RUNNING)');
    expect(away).toContain('3 WAIT TO BE SENT');
    const none = recordsHtml(
      await withSteam({ supported: false, online: false, reason: null, pending: 0, sent: 0 }),
    );
    expect(none).toContain('LOCAL RECORDS');
    expect(none).not.toContain('QUEUED');
    // Names a viewer could inject are escaped.
    const view = await loadRecords(
      source({
        [leaderboardKey('aurel', 'apx01', P)]: [
          { ...lapEntry(80), driver: '<img src=x onerror=alert(1)>' },
        ],
      }),
    );
    expect(recordsHtml(view)).not.toContain('<img');
  });
  describe('in the Steam demo', () => {
    let restore: () => void;
    beforeEach(() => {
      restore = useDemoPolicy(createDemoPolicy());
    });
    afterEach(() => restore());
    it('lists the demo events first and marks the rest FULL GAME', async () => {
      const view = await loadRecords(source({}));
      expect(
        view.wildcard
          .slice(0, 5)
          .map((r) => r.id)
          .sort(),
      ).toEqual([...DEMO_SLICE.wildcard].sort());
      expect(view.wildcard.slice(5).every((r) => !r.open)).toBe(true);
      const html = recordsHtml(view, 'wildcard');
      expect((html.match(/data-fullgame/g) ?? []).length).toBe(wildcardSeries().length - 5);
    });
  });
});
