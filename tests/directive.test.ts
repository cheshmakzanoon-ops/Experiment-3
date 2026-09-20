import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

it('retains the exact Pasted markdown(6) directive and all 148 coverage headings', () => {
  const source = readFileSync('docs/MASTER_DIRECTIVE.md');
  expect(createHash('sha256').update(source).digest('hex')).toBe('f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c');
  const headings = [...source.toString().matchAll(/^# (\d+)\. (.+)$/gm)]
    .map((match) => [Number(match[1]), match[2]]);
  const ledger = readFileSync('docs/IMPLEMENTATION_MATRIX.md', 'utf8');
  const rows = [...ledger.matchAll(/^\| (\d+) \| ([^|]+) \|/gm)]
    .map((match) => [Number(match[1]), match[2].trim()]);
  expect(headings.map(([id]) => id)).toEqual(Array.from({ length: 148 }, (_, i) => i + 1));
  expect(rows).toEqual(headings);
  // This asserts traceability, not that every implementation status is complete.
});
