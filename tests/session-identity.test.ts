import { describe, expect, it, vi } from 'vitest';
import { GHOST_FIELDS, GHOST_VERSION, ghostKey, validateGhost } from '../src/core/ghost-lap.ts';
import {
  SIMULATION_VERSION,
  circuitHash,
  recordCategory,
  recordIncompatibility,
  sessionIdentity,
} from '../src/core/session-identity.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { BUILD_IDENTITY, identityMismatch } from '../src/net/identity.ts';
import { AuthoritativeWorld } from '../src/net/authority.ts';
import { createRecord, recordDigest, verifyRecord } from '../src/net/records.ts';
import { TimeTrialRecords } from '../src/session/time-trial-records.ts';
import { Track } from '../src/simulation/track.ts';
import {
  CAR_STRIDE,
  HEADER,
  H,
  SNAPSHOT_SCHEMA,
  snapshotIncompatibility,
} from '../src/simulation/protocol.ts';
import { leaderboardKey } from '../src/storage/leaderboard.ts';

const legacyGhost = () => {
  const samples = new Float32Array(GHOST_FIELDS * 40);
  for (let i = 0; i < 40; i++) {
    samples[i * GHOST_FIELDS] = (i / 39) * 80;
    for (let k = 1; k < GHOST_FIELDS; k++) samples[i * GHOST_FIELDS + k] = k === 8 ? 1 : 0;
  }
  return {
    version: GHOST_VERSION,
    circuit: 'aurel',
    trackLength: 3000,
    lapTime: 80,
    sectors: [27, 26, 27],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '2026-01-01',
    samples,
  };
};
describe('WP12 recorded identity and schema policy', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])(
    'keeps physics v%i records out of the current physics category',
    (physics) => {
      expect(SIMULATION_VERSION).toBe(20);
      expect(
        recordIncompatibility(
          { circuit: 'aurel', vehicle: 'apx01', physics },
          { circuit: 'aurel', vehicle: 'apx01', physics: SIMULATION_VERSION },
        ),
      ).toBe(`recorded with physics v${physics}; current physics is v${SIMULATION_VERSION}`);
      expect(leaderboardKey('aurel', 'apx01', physics)).not.toBe(
        leaderboardKey('aurel', 'apx01', SIMULATION_VERSION),
      );
    },
  );
  it.each([18, 19])(
    'rejects an integrity-checked v%i session record without relabelling or re-simulating it',
    (physics) => {
      const world = new AuthoritativeWorld(
        validateOptions({ ...DEFAULT_OPTIONS, opponents: 0, vehicles: ['hf86'] }),
      );
      world.step();
      const current = createRecord(world);
      expect(verifyRecord(current)).toMatchObject({ ok: true, ticks: 1 });
      const previous = structuredClone(current);
      previous.identity.simulationVersion = physics;
      previous.category.physics = physics;
      previous.digest = recordDigest(previous);
      const preserved = structuredClone(previous);
      expect(verifyRecord(previous)).toEqual({
        ok: false,
        stage: 'content',
        reason: `recorded with physics v${physics}; this verifier runs v20`,
      });
      expect(previous).toEqual(preserved);
    },
  );
  it.each(['hf86', 'hf67'])(
    'separates %s records and network identities from v18 and v19 after the upshift rollback',
    (vehicle) => {
      const options = { ...DEFAULT_OPTIONS, opponents: 0, vehicles: [vehicle] };
      const category = recordCategory(options);
      expect(category).toEqual({ circuit: 'aurel', vehicle, physics: 20 });
      const current = sessionIdentity(options);
      expect(BUILD_IDENTITY.simulationVersion).toBe(20);
      expect(identityMismatch(current, current)).toBeNull();
      for (const physics of [18, 19]) {
        const previous = { ...category, physics };
        expect(recordIncompatibility(previous, category)).toBe(
          `recorded with physics v${physics}; current physics is v20`,
        );
        expect(leaderboardKey('aurel', vehicle, physics)).not.toBe(
          leaderboardKey('aurel', vehicle, category.physics),
        );
        const old = { ...current, simulationVersion: physics };
        const preserved = structuredClone(old);
        expect(identityMismatch(current, old)).toBe(
          `simulation version ${physics} does not match the server's version 20`,
        );
        expect(old).toEqual(preserved);
      }
    },
  );
  it.each([18, 19])(
    'rejects v%i ghosts on load without writing or deleting the stored records',
    async (physics) => {
      const track = new Track();
      for (const vehicle of ['hf86', 'hf67']) {
        const options = {
          ...DEFAULT_OPTIONS,
          mode: 'time-trial' as const,
          opponents: 0,
          vehicles: [vehicle],
        };
        const previous = { ...recordCategory(options), physics };
        const oldGhost = { ...legacyGhost(), trackLength: track.length, vehicle, physics };
        const oldBoard = [
          {
            lapTime: 80,
            driver: 'Driver',
            assist: 'sport',
            compound: 'medium',
            weather: 'clear',
            session: `physics-${physics}`,
          },
        ];
        const saved = new Map<string, unknown>([
          [ghostKey('aurel', vehicle), oldGhost],
          [leaderboardKey('aurel', vehicle, physics), oldBoard],
        ]);
        const preserved = structuredClone(saved);
        const write = vi.fn(async (key: string, value: unknown) => void saved.set(key, value));
        const records = new TimeTrialRecords({
          store: { read: async (key) => saved.get(key), write },
          toast: () => undefined,
          playerName: () => 'Driver',
        });
        await records.prepare(options, track, () => true);
        expect(records.player).toBeNull();
        expect(records.trial?.best).toBe(0);
        expect(write).not.toHaveBeenCalled();
        expect(saved).toEqual(preserved);
        // Rejection from v20 is not corruption or conversion of the old recording.
        expect(validateGhost(oldGhost, 'aurel', track.length, previous)).toMatchObject({
          vehicle,
          physics,
        });
        expect(
          validateGhost(
            { ...oldGhost, physics: 20 },
            'aurel',
            track.length,
            recordCategory(options),
          ),
        ).toMatchObject({ vehicle, physics: 20 });
      }
    },
  );
  it.each(['gpr1', 'gpr2'])('separates %s records after GP contact model updates', (vehicle) => {
    const category = recordCategory({ circuit: 'aurel', vehicles: [vehicle] });
    expect(category).toEqual({ circuit: 'aurel', vehicle, physics: SIMULATION_VERSION });
    expect(leaderboardKey(category.circuit, category.vehicle, category.physics)).not.toBe(
      leaderboardKey(category.circuit, category.vehicle, 5),
    );
    expect(
      validateGhost({ ...legacyGhost(), vehicle, physics: 5 }, 'aurel', 3000, category),
    ).toBeNull();
    expect(
      validateGhost({ ...legacyGhost(), vehicle, physics: 6 }, 'aurel', 3000, category),
    ).toBeNull();
    expect(
      validateGhost({ ...legacyGhost(), vehicle, physics: 10 }, 'aurel', 3000, category),
    ).toBeNull();
    expect(
      validateGhost(
        { ...legacyGhost(), vehicle, physics: SIMULATION_VERSION },
        'aurel',
        3000,
        category,
      ),
    ).toMatchObject({ vehicle, physics: SIMULATION_VERSION });
  });
  it('hashes content, not object identity', () => {
    expect(circuitHash(AUREL)).toBe(circuitHash({ ...AUREL }));
    expect(circuitHash(AUREL)).not.toBe(circuitHash(VELLAMAR));
    const id = sessionIdentity({ ...DEFAULT_OPTIONS, opponents: 1, vehicles: ['tc1', 'apx01'] });
    expect(id.vehicles).toEqual(['tc1', 'apx01']);
    expect(id.vehicleHashes[0]).not.toBe(id.vehicleHashes[1]);
    expect(id.simulationVersion).toBe(SIMULATION_VERSION);
  });
  it('reads pre-identity ghosts as Formula physics v1 and rejects others with reasons', () => {
    const category = { circuit: 'aurel', vehicle: 'apx01', physics: 1 };
    expect(validateGhost(legacyGhost(), 'aurel', 3000, category)?.vehicle).toBe('apx01');
    expect(validateGhost(legacyGhost(), 'aurel', 3000, { ...category, vehicle: 'tc1' })).toBeNull();
    expect(recordIncompatibility({ circuit: 'aurel' }, { ...category, physics: 2 })).toMatch(
      /physics v1; current physics is v2/,
    );
    expect(ghostKey('aurel')).toBe('ghost:v1:aurel');
    expect(ghostKey('aurel', 'tc1')).toBe('ghost:v1:aurel:tc1');
    expect(leaderboardKey('aurel')).toBe('leaderboard:aurel');
    expect(leaderboardKey('aurel', 'tc1', 1)).toBe('leaderboard:aurel:tc1:p1');
    expect(leaderboardKey('aurel', 'apx01', 2)).toBe('leaderboard:aurel:apx01:p2');
  });
  it('describes every per-car block inside the stride without overlap', () => {
    const blocks = [...SNAPSHOT_SCHEMA.blocks].sort((a, b) => a.offset - b.offset);
    let end = 0;
    for (const b of blocks) {
      expect(b.offset).toBeGreaterThanOrEqual(end);
      end = b.offset + b.stride * b.count;
    }
    expect(end).toBe(CAR_STRIDE);
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame[H.CARS] = 2;
    expect(snapshotIncompatibility(frame)).toBeNull();
    expect(snapshotIncompatibility(frame, 10)).toMatch(/not supported/);
    frame[H.CARS] = 3;
    expect(snapshotIncompatibility(frame)).toMatch(/length/);
  });
});
