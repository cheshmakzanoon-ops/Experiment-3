import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  runRuntimeComparison,
  classifySmokeResult,
  type ComparisonAdapters,
  type Execution,
  type Evidence,
} from '../scripts/electron-runtime-ab-coordinator.mjs';
import type { Leg } from '../scripts/electron-runtime-ab-contract.mjs';
import { immutable, clean, exited, smoke } from './fixtures/electron-runtime-ab-fixtures.ts';

function rig(
  options: {
    aFail?: boolean;
    spawnFail?: boolean;
    dirtyAt?: number;
    cleanupFail?: boolean;
    removalFail?: boolean;
    stale?: boolean;
    badRuntime?: boolean;
    collectFail?: boolean;
  } = {},
) {
  const events: string[] = [];
  let verification = 0;
  const adapters: ComparisonAdapters = {
    async verifyImmutable() {
      events.push('verify');
      if (++verification === options.dirtyAt) throw new Error('input changed');
      return true;
    },
    async assertFresh(leg) {
      events.push(`fresh:${leg}`);
      if (options.stale && leg === 'A') throw new Error('stale');
    },
    async verifyEmpty(leg) {
      events.push(`empty:${leg}`);
      return clean;
    },
    async execute(leg) {
      events.push(`execute:${leg}`);
      if (options.spawnFail && leg === 'A') return { spawned: false, exitCode: null, signal: null };
      return { ...exited, exitCode: options.aFail && leg === 'A' ? 1 : 0 };
    },
    async cleanup(leg) {
      events.push(`cleanup:${leg}`);
      return { ...clean, ok: !(options.cleanupFail && leg === 'A') };
    },
    async removePrivateState(leg) {
      events.push(`remove:${leg}`);
      if (options.removalFail && leg === 'A') throw new Error('not removed');
    },
    async collect(leg: Leg, execution: Execution): Promise<Evidence> {
      events.push(`collect:${leg}`);
      if (options.collectFail && leg === 'A') throw new Error('oversized evidence');
      const report = smoke(leg);
      if (options.aFail && leg === 'A') report.success = false;
      if (options.badRuntime && leg === 'A') report.runtime.electron = '44.10.1';
      const classification = classifySmokeResult(
        leg,
        immutable,
        execution,
        execution.spawned === false ? undefined : report,
      );
      const envelope = { leg, report };
      const encoded = Buffer.from(JSON.stringify(envelope));
      return {
        classification,
        envelope,
        encoded,
        sha256: createHash('sha256').update(encoded).digest('hex'),
        images: [],
      };
    },
  };
  return { events, adapters };
}

it('runs both original-budget legs serially despite A failure; never promotes B to aggregate pass', async () => {
  const { events, adapters } = rig({ aFail: true });
  const outcome = await runRuntimeComparison({ immutable, adapters });
  expect(outcome.summary.success).toBe(false);
  expect(outcome.summary.legs.map((leg) => leg.status)).toEqual(['failed', 'passed']);
  expect(outcome.summary.legs[0]).toMatchObject({
    exitCode: 1,
    cleanupVerified: true,
    actualRuntime: { electron: '45.2.1' },
  });
  expect(events).toEqual([
    'verify',
    'fresh:A',
    'empty:A',
    'execute:A',
    'cleanup:A',
    'remove:A',
    'verify',
    'collect:A',
    'verify',
    'fresh:B',
    'empty:B',
    'execute:B',
    'cleanup:B',
    'remove:B',
    'verify',
    'collect:B',
  ]);
});
it('A spawn failure remains unqualified but permits B only after positive cleanup', async () => {
  const { adapters, events } = rig({ spawnFail: true });
  const outcome = await runRuntimeComparison({ immutable, adapters });
  expect(outcome.summary.legs.map((leg) => leg.status)).toEqual(['unqualified', 'passed']);
  expect(outcome.summary.legs[0]).toMatchObject({ reason: 'spawn-failed', exitCode: null });
  expect(events.indexOf('remove:A')).toBeLessThan(events.indexOf('execute:B'));
});
it('a post-spawn adapter exception retains unknown execution and still cleans before B', async () => {
  const { adapters, events } = rig();
  const execute = adapters.execute;
  adapters.execute = async (leg) => {
    if (leg === 'A') {
      events.push('execute:A');
      throw new Error('post-spawn stream error');
    }
    return execute(leg);
  };
  const outcome = await runRuntimeComparison({ immutable, adapters });
  expect(outcome.summary.legs[0]).toMatchObject({
    status: 'unqualified',
    reason: 'execution-unavailable',
    exitCode: null,
    cleanupVerified: true,
  });
  expect(outcome.summary.legs[1].status).toBe('passed');
  expect(events.indexOf('cleanup:A')).toBeLessThan(events.indexOf('execute:B'));
  expect(outcome.summary.success).toBe(false);
});
it.each(['cleanupFail', 'removalFail'] as const)(
  'uncertain %s blocks B, without a retry',
  async (failure) => {
    const { adapters, events } = rig({ [failure]: true });
    const outcome = await runRuntimeComparison({ immutable, adapters });
    expect(outcome.summary.legs[0]).toMatchObject({
      status: 'unqualified',
      reason: 'cleanup-uncertain',
      cleanupVerified: false,
    });
    expect(outcome.summary.legs[1]).toMatchObject({ status: 'blocked', reason: 'blocked-after-a' });
    expect(events.filter((event) => event === 'cleanup:A')).toHaveLength(1);
    expect(events).not.toContain('execute:B');
  },
);
it.each([1, 2, 3, 4])(
  'input/payload mutation at immutable check %i is fail-closed',
  async (dirtyAt) => {
    const { adapters, events } = rig({ dirtyAt });
    const outcome = await runRuntimeComparison({ immutable, adapters });
    expect(outcome.summary.success).toBe(false);
    expect(outcome.summary.legs[dirtyAt <= 2 ? 0 : 1].reason).toBe('immutable-unverified');
    if (dirtyAt <= 3) expect(events).not.toContain('execute:B');
    if (dirtyAt === 2) expect(events).toContain('cleanup:A');
  },
);
it('stale output/profile cannot become fresh evidence or permit B', async () => {
  const { adapters, events } = rig({ stale: true });
  const outcome = await runRuntimeComparison({ immutable, adapters });
  expect(outcome.summary.legs.map((leg) => leg.status)).toEqual(['unqualified', 'blocked']);
  expect(outcome.summary.legs[0].reason).toBe('preflight-unqualified');
  expect(events.filter((event) => event.startsWith('execute:'))).toEqual([]);
});
it.each(['badRuntime', 'collectFail'] as const)(
  'unqualified %s is retained without hiding B',
  async (failure) => {
    const { adapters } = rig({ [failure]: true });
    const outcome = await runRuntimeComparison({ immutable, adapters });
    expect(outcome.summary.success).toBe(false);
    expect(outcome.summary.legs.map((leg) => leg.status)).toEqual(['unqualified', 'passed']);
  },
);
it('an invalid execution receipt still attempts owned cleanup once and never launches B', async () => {
  const { adapters, events } = rig();
  adapters.execute = async () => ({ spawned: true, exitCode: NaN, signal: null });
  const outcome = await runRuntimeComparison({ immutable, adapters });
  expect(outcome.summary.success).toBe(false);
  expect(outcome.summary.legs[0].reason).toBe('execution-unavailable');
  expect(events.filter((event) => event === 'cleanup:A')).toHaveLength(1);
  expect(events).not.toContain('execute:B');
});

it.each([false, undefined, null, 1])(
  'requires positive immutable verification, not %s',
  async (value) => {
    const { adapters, events } = rig();
    adapters.verifyImmutable = async () => value as boolean;
    const outcome = await runRuntimeComparison({ immutable, adapters });
    expect(outcome.summary.legs[0].reason).toBe('immutable-unverified');
    expect(outcome.summary.legs[1].status).toBe('blocked');
    expect(events).not.toContain('execute:A');
  },
);
it('requires positive immutable verification again after execution and cleanup', async () => {
  const { adapters, events } = rig();
  let checks = 0;
  adapters.verifyImmutable = async () => ++checks === 1;
  const outcome = await runRuntimeComparison({ immutable, adapters });
  expect(outcome.summary.legs[0]).toMatchObject({
    reason: 'immutable-unverified',
    cleanupVerified: true,
  });
  expect(outcome.summary.legs[1].status).toBe('blocked');
  expect(events).toContain('cleanup:A');
  expect(events).not.toContain('execute:B');
});
