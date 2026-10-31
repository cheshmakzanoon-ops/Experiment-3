import { describe, expect, it, vi } from 'vitest';
import {
  GHOST_FIELDS,
  GHOST_VERSION,
  ghostCategoryKey,
  ghostKey,
  type GhostLap,
} from '../src/core/ghost-lap.ts';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { TimeTrialRecords } from '../src/session/time-trial-records.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { leaderboardKey } from '../src/storage/leaderboard.ts';

const track = new Track();
const options = {
  ...DEFAULT_OPTIONS,
  mode: 'time-trial' as const,
  opponents: 0,
  vehicles: ['hf86'],
};
const legacyKey = ghostKey('aurel', 'hf86');
const currentKey = ghostCategoryKey('aurel', 'hf86');
function lap(physics = SIMULATION_VERSION, vehicle = 'hf86'): GhostLap {
  const samples = new Float32Array(GHOST_FIELDS * 40);
  for (let i = 0; i < 40; i++)
    samples.set(
      [(i / 39) * 80, (i / 39) * track.length, 0, 0, i, 0, 0, 0, 1, 0, 40],
      i * GHOST_FIELDS,
    );
  return {
    version: GHOST_VERSION,
    circuit: 'aurel',
    trackLength: track.length,
    lapTime: 80,
    sectors: [27, 26, 27],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '2026-01-01',
    samples,
    vehicle,
    physics,
  };
}
function fixture(entries: [string, unknown][] = []) {
  const saved = new Map(entries);
  const read = vi.fn(async (key: string) => saved.get(key));
  const write = vi.fn(async (key: string, value: unknown) => void saved.set(key, value));
  const toast = vi.fn();
  const records = new TimeTrialRecords({
    store: { read, write },
    toast,
    playerName: () => 'Driver',
  });
  return { saved, read, write, toast, records };
}
/** Snapshot-to-storage lifecycle, not a physical driving/handling fixture. */
async function saveLap(records: TimeTrialRecords) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[o + F.QW] = 1;
  frame[o + F.SPEED] = 40;
  for (let i = 0; i < 40; i++) {
    frame[o + F.LAP_TIME] = 0.1 + i * 0.5;
    frame[o + F.S] = ((0.1 + i * 0.5) / 20) * track.length;
    records.observe(frame, true, options, 'physics-20');
  }
  frame[o + F.LAPS] = 1;
  frame[o + F.LAP_TIME] = 0.05;
  frame[o + F.LAST_LAP] = 20;
  frame[o + F.LAST_LAP_VALID] = 1;
  records.observe(frame, true, options, 'physics-20');
  // Flush the store promises used by the public snapshot observer.
  await Promise.resolve();
  await Promise.resolve();
}

describe('physics-scoped time-trial ghost preservation', () => {
  it('retains legacy keys and separates every new physics/vehicle category', () => {
    expect(ghostKey('aurel')).toBe('ghost:v1:aurel');
    expect(legacyKey).toBe('ghost:v1:aurel:hf86');
    expect(currentKey).toBe('ghost:v1:aurel:hf86:p20');
    expect(currentKey).not.toBe(ghostCategoryKey('aurel', 'hf86', 18));
    expect(currentKey).not.toBe(ghostCategoryKey('aurel', 'hf86', 19));
    expect(currentKey).not.toBe(ghostCategoryKey('aurel', 'hf67', 20));
    expect(ghostCategoryKey('aurel')).toBe('ghost:v1:aurel:p20');
  });
  it.each([18, 19])(
    'rejects a v%i legacy ghost, saves/reloads v20, and preserves both v18/v19 scoped archives',
    async (legacyPhysics) => {
      const entries: [string, unknown][] = [[legacyKey, lap(legacyPhysics)]];
      for (const physics of [18, 19]) {
        entries.push(
          [ghostCategoryKey('aurel', 'hf86', physics), lap(physics)],
          [
            leaderboardKey('aurel', 'hf86', physics),
            [
              {
                lapTime: 80,
                driver: 'Driver',
                assist: 'sport',
                compound: 'medium',
                weather: 'clear',
                session: `physics-${physics}`,
              },
            ],
          ],
        );
      }
      const f = fixture(entries);
      const preserved = structuredClone(f.saved);
      const boardBytes = [18, 19].map((physics) =>
        JSON.stringify(f.saved.get(leaderboardKey('aurel', 'hf86', physics))),
      );
      const ghostBytes = [18, 19].map((physics) =>
        new Uint8Array(
          (f.saved.get(ghostCategoryKey('aurel', 'hf86', physics)) as GhostLap).samples.buffer,
        ).slice(),
      );
      await f.records.prepare(options, track, () => true);
      expect(f.records.player).toBeNull();
      expect(f.read.mock.calls).toEqual([[currentKey], [legacyKey]]);
      expect(f.write).not.toHaveBeenCalled();
      await saveLap(f.records);
      expect(f.saved.get(currentKey)).toMatchObject({ physics: 20, vehicle: 'hf86', lapTime: 20 });
      for (const [key, value] of preserved) expect(f.saved.get(key), key).toEqual(value);
      expect(f.write.mock.calls.map(([key]) => key).sort()).toEqual(
        [currentKey, leaderboardKey('aurel', 'hf86', 20)].sort(),
      );
      f.read.mockClear();
      await f.records.prepare(options, track, () => true);
      expect(f.records.player?.lap).toMatchObject({ physics: 20, vehicle: 'hf86', lapTime: 20 });
      expect(f.read.mock.calls).toEqual([[currentKey]]);
      for (const [key, value] of preserved) expect(f.saved.get(key), key).toEqual(value);
      for (const [i, physics] of [18, 19].entries()) {
        expect(JSON.stringify(f.saved.get(leaderboardKey('aurel', 'hf86', physics)))).toBe(
          boardBytes[i],
        );
        const ghost = f.saved.get(ghostCategoryKey('aurel', 'hf86', physics)) as GhostLap;
        expect(new Uint8Array(ghost.samples.buffer)).toEqual(ghostBytes[i]);
      }
    },
  );
  it('reads a compatible legacy fallback without rewriting it, then writes only the versioned key', async () => {
    const original = lap();
    const f = fixture([[legacyKey, original]]),
      preserved = structuredClone(original);
    await f.records.prepare(options, track, () => true);
    expect(f.records.player?.lap.lapTime).toBe(80);
    expect(f.read.mock.calls).toEqual([[currentKey], [legacyKey]]);
    expect(f.write).not.toHaveBeenCalled();
    await saveLap(f.records);
    expect(f.saved.get(legacyKey)).toEqual(preserved);
    expect(f.saved.get(currentKey)).toMatchObject({ lapTime: 20, physics: SIMULATION_VERSION });
  });
  it.each(['corrupt', 'physics v18', 'physics v19', 'wrong vehicle', 'wrong circuit'])(
    'validates the %s current-key value before trying a compatible legacy fallback',
    async (kind) => {
      const invalid =
        kind === 'corrupt'
          ? { broken: true }
          : {
              ...lap(),
              ...(kind === 'physics v18' ? { physics: 18 } : {}),
              ...(kind === 'physics v19' ? { physics: 19 } : {}),
              ...(kind === 'wrong vehicle' ? { vehicle: 'hf67' } : {}),
              ...(kind === 'wrong circuit' ? { circuit: 'vellamar' } : {}),
            };
      const f = fixture([
          [currentKey, invalid],
          [legacyKey, lap()],
        ]),
        preserved = structuredClone(f.saved);
      await f.records.prepare(options, track, () => true);
      expect(f.records.player?.lap).toMatchObject({ physics: SIMULATION_VERSION, vehicle: 'hf86' });
      expect(f.read.mock.calls).toEqual([[currentKey], [legacyKey]]);
      expect(f.write).not.toHaveBeenCalled();
      expect(f.saved).toEqual(preserved);
    },
  );
  it.each(['corrupt', 'physics v18', 'physics v19', 'wrong vehicle'])(
    'never loads or rewrites a %s legacy fallback',
    async (kind) => {
      const invalid =
        kind === 'corrupt'
          ? { broken: true }
          : lap(
              kind === 'physics v18' ? 18 : kind === 'physics v19' ? 19 : SIMULATION_VERSION,
              kind === 'wrong vehicle' ? 'hf67' : 'hf86',
            );
      const f = fixture([[legacyKey, invalid]]),
        preserved = structuredClone(f.saved);
      await f.records.prepare(options, track, () => true);
      expect(f.records.player).toBeNull();
      expect(f.records.trial?.best).toBe(0);
      expect(f.write).not.toHaveBeenCalled();
      expect(f.saved).toEqual(preserved);
    },
  );
  it('falls back on a failed category read without mutating stored content', async () => {
    const f = fixture([[legacyKey, lap()]]),
      preserved = structuredClone(f.saved);
    f.read.mockRejectedValueOnce(new Error('category read failed'));
    await f.records.prepare(options, track, () => true);
    expect(f.records.player?.lap.physics).toBe(SIMULATION_VERSION);
    expect(f.toast).toHaveBeenCalledWith('Saved ghost unavailable: Error: category read failed');
    expect(f.write).not.toHaveBeenCalled();
    expect(f.saved).toEqual(preserved);
  });
  it('does not continue fallback reads or install an obsolete preparation', async () => {
    const f = fixture([[legacyKey, lap()]]);
    await f.records.prepare(options, track, () => false);
    expect(f.read.mock.calls).toEqual([[currentKey]]);
    expect(f.records.player).toBeNull();
    expect(f.records.trial).toBeNull();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
  });
  it('ignores a rejected old read after a newer session owns the ghost and UI', async () => {
    const f = fixture([[currentKey, lap()]]);
    let rejectPrevious!: (reason: Error) => void;
    f.read.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectPrevious = reject)),
    );
    let active = true;
    const previous = f.records.prepare(options, track, () => active);
    active = false;
    await f.records.prepare(options, track, () => true);
    const player = f.records.player;
    const trial = f.records.trial;
    expect(player?.lap.physics).toBe(SIMULATION_VERSION);
    f.toast.mockClear();
    rejectPrevious(new Error('obsolete read failed'));
    await previous;
    expect(f.records.player).toBe(player);
    expect(f.records.trial).toBe(trial);
    expect(f.read.mock.calls).toEqual([[currentKey], [currentKey]]);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
  });
});
