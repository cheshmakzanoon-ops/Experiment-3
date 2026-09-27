import { describe, expect, it } from 'vitest';
import {
  planBrowserShards,
  casePattern,
  verifySelection,
  type BrowserCase,
} from '../scripts/browser-shard-plan.ts';
const example = (
  id: string,
  file = 'normal.spec.ts',
  serialGroup: string | null = null,
): BrowserCase => ({
  id,
  file,
  title: `${file} test ${id} (a+b) [x]`,
  serialGroup,
});
describe('complete duration-weighted browser sharding', () => {
  it('assigns every case once, deterministically, and spreads long race cases across all workers', () => {
    const tests = [
      ...Array.from({ length: 8 }, (_, i) =>
        example(`long-${i}`, '29-populated-race-review.spec.ts'),
      ),
      ...Array.from({ length: 64 }, (_, i) => example(`short-${i}`)),
    ];
    const plan = planBrowserShards(tests, 8);
    expect(plan).toEqual(planBrowserShards([...tests].reverse(), 8));
    expect(plan.flatMap((shard) => shard.tests.map((test) => test.id)).sort()).toEqual(
      tests.map((test) => test.id).sort(),
    );
    for (const shard of plan)
      expect(shard.tests.filter((test) => test.id.startsWith('long'))).toHaveLength(1);
    expect(new Set(plan.map((shard) => shard.weight)).size).toBe(1);
  });
  it('keeps a serial suite on one worker and rejects omissions, duplicates and accidental regex matches', () => {
    const tests = [
      example('a', 'serial.ts', 'serial'),
      example('b', 'serial.ts', 'serial'),
      example('c'),
    ];
    const plan = planBrowserShards(tests, 2);
    expect(
      plan
        .find((shard) => shard.tests.some((test) => test.id === 'a'))!
        .tests.some((test) => test.id === 'b'),
    ).toBe(true);
    const pattern = new RegExp(casePattern(tests));
    tests.forEach((test) => expect(pattern.test(test.title)).toBe(true));
    expect(pattern.test(tests[0].title + ' extra')).toBe(false);
    expect(() => verifySelection(tests, tests.slice(1))).toThrow();
    expect(() => verifySelection(tests, [tests[0], tests[0], tests[1]])).toThrow();
    expect(() => planBrowserShards([tests[0], tests[0]], 2)).toThrow();
    expect(() => planBrowserShards(tests, 0)).toThrow();
    expect(() => casePattern([])).toThrow();
  });
});
