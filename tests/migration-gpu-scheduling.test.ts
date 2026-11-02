import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const source = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
const gpu = source.split('  gpu:\n')[1]?.split('  verify:\n')[0];
const suites = [
  'retained',
  'start-lamps',
  'start-banner',
  'start-finish-stripe',
  'grid-paint',
  'braking-triplet',
];

it('cancels obsolete GPU jobs only within the same branch and suite, without a workflow lock', () => {
  expect(source).not.toMatch(/^concurrency:/m);
  expect(source.match(/^\s*concurrency:/gm)).toHaveLength(1);
  expect(gpu).toContain(
    '    concurrency:\n      group: babylon-integration-${{ github.ref }}-${{ matrix.suite }}\n      cancel-in-progress: true\n',
  );
  expect([...source.matchAll(/^ {10}- suite: (.+)$/gm)].map((match) => match[1])).toEqual(suites);
  const template = gpu.match(/^ {6}group: (.+)$/m)![1];
  const group = (ref: string, suite: string) =>
    template.replace('${{ github.ref }}', ref).replace('${{ matrix.suite }}', suite).toLowerCase();
  const current = suites.map((suite) => group('refs/heads/babylon-js', suite));
  expect(new Set(current).size).toBe(6);
  expect(current).toEqual(suites.map((suite) => group('refs/heads/babylon-js', suite)));
  expect(
    new Set([...current, ...suites.map((suite) => group('refs/heads/other', suite))]).size,
  ).toBe(12);
  expect(gpu).toContain('fail-fast: false');
  expect(gpu).toContain("if: github.ref == 'refs/heads/babylon-js'");
  expect(gpu).toContain('runs-on: ubuntu-latest\n    timeout-minutes: 20');
});

it('retains the complete six-shard selector union with no optional or filtered cases', () => {
  expect(
    [...gpu.matchAll(/^ {8}run: npx playwright test (.+)$/gm)].map((match) => match[1].split(' ')),
  ).toEqual([
    [
      'e2e/babylon-engine.spec.ts',
      'e2e/discipline-entry.spec.ts',
      'e2e/babylon-player-lods.spec.ts',
      'e2e/babylon-height-parity.spec.ts',
      'e2e/babylon-surface-parity.spec.ts',
      'e2e/babylon-start-gantry.spec.ts',
    ],
    ['e2e/babylon-start-lamps.spec.ts'],
    ['e2e/babylon-start-banner.spec.ts'],
    ['e2e/babylon-start-finish-stripe.spec.ts'],
    ['e2e/babylon-grid-paint.spec.ts'],
    ['e2e/babylon-braking-triplet.spec.ts'],
  ]);
  expect(
    [...gpu.matchAll(/^ {8}if: matrix.suite == '([^']+)'$/gm)].map((match) => match[1]),
  ).toEqual(suites);
  expect(source).not.toMatch(
    /continue-on-error|--exclude|--testNamePattern|--passWithNoTests|--grep|--retries/,
  );
  expect(source).toContain('permissions:\n  contents: read\njobs:');
  expect(gpu).toContain('name: babylon-integration-${{ matrix.suite }}-${{ github.sha }}');
  expect(gpu).toContain('retention-days: 14');
});

it('keeps the verifier exact and fail-closed for failed, cancelled, skipped and missing results', () => {
  const gate = source.split('  verify:\n')[1];
  expect(gate).toBe(`    # Keep the original aggregate check name; every matrix shard is required.
    if: always() && github.ref == 'refs/heads/babylon-js'
    needs: gpu
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Require every GPU shard to pass
        run: test '\${{ needs.gpu.result }}' = success
`);
  const command = gate.match(/^ {8}run: (.+)$/m)![1];
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const actual = spawnSync('sh', ['-c', command.replace('${{ needs.gpu.result }}', result)]);
    expect(actual.status, result || 'missing result').toBe(result === 'success' ? 0 : 1);
  }
});

it('explicitly triggers and runs this CPU contract without triggering native migration builds', () => {
  const path = 'tests/migration-gpu-scheduling.test.ts';
  expect(source).toContain(`      - '${path}'`);
  const contracts = source
    .split('      - name: GPU scheduling contracts\n')[1]
    ?.split('      - ')[0];
  expect(contracts).toContain(` ${path}\n`);
  const native = readFileSync('.github/workflows/babylon-desktop.yml', 'utf8');
  const paths = [...native.matchAll(/^ {6}- '([^']+)'$/gm)].map((match) => match[1]);
  for (const changed of [path, '.github/workflows/babylon-integration.yml']) {
    for (const pattern of paths) {
      const regex = new RegExp(
        `^${pattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      expect(regex.test(changed), `${changed} must not match native trigger ${pattern}`).toBe(
        false,
      );
    }
  }
});
