import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('qualifies migration desktop artifacts only on babylon-js through unchanged supported native gates', () => {
  const source = readFileSync('.github/workflows/babylon-desktop.yml', 'utf8');
  expect(source).toContain('branches: [babylon-js]');
  expect(source).toContain("if: github.ref == 'refs/heads/babylon-js'");
  expect(source).toContain('permissions:\n  contents: read');
  expect(source).toContain('uses: ./.github/workflows/desktop-platform.yml');
  expect([...source.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((match) => match[1])).toEqual([
    'workflow_dispatch',
    'push',
    'build',
  ]);
  expect(
    [...source.matchAll(/- os: ([^\n]+)\n\s+target: ([^\n]+)\n\s+arch: ([^\n]+)/g)].map((match) =>
      match.slice(1),
    ),
  ).toEqual([
    ['ubuntu-22.04', 'linux', 'x64'],
    ['windows-2022', 'win', 'x64'],
    ['macos-15', 'mac', 'arm64'],
  ]);
  expect(source).not.toMatch(
    /contents: write|secrets:|\brun:|\bsteps:|gpu_trace:|gpu_service_api_trace:|smoke_journey:|linux_graphics:/,
  );
});

it('retains the exact GPU selector union in required, non-filtered shards', () => {
  const source = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
  expect([...source.matchAll(/^ {10}- suite: (.+)$/gm)].map((m) => m[1])).toEqual([
    'retained',
    'start-lamps',
    'start-banner',
    'start-finish-stripe',
    'grid-paint',
  ]);
  expect(
    [...source.matchAll(/^ {8}run: npx playwright test (.+)$/gm)].map((m) => m[1].split(' ')),
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
  ]);
  const step = (name: string) => source.split(`      - name: ${name}\n`)[1]?.split('      - ')[0];
  expect(step('Real WebGL engine, model import and mode-switching journeys')).toContain(
    "if: matrix.suite == 'retained'",
  );
  expect(step('Original start lamps GPU qualification')).toContain(
    "if: matrix.suite == 'start-lamps'",
  );
  expect(step('Original start banner GPU qualification')).toContain(
    "if: matrix.suite == 'start-banner'",
  );
  expect(step('Original start finish stripe GPU qualification')).toContain(
    "if: matrix.suite == 'start-finish-stripe'",
  );
  expect(step('Original Formula grid paint GPU qualification')).toContain(
    "if: matrix.suite == 'grid-paint'",
  );
  expect(source).toContain("- 'e2e/babylon-start-finish-stripe.spec.ts'");
  expect(source).toContain("- 'e2e/fixtures/babylon-start-finish-stripe.ts'");
  expect(source).toContain('fail-fast: false');
  expect(source).toContain('timeout-minutes: 20');
  expect(source).toContain('name: babylon-integration-${{ matrix.suite }}-${{ github.sha }}');
  expect(source).not.toMatch(
    /continue-on-error|--exclude|--testNamePattern|--passWithNoTests|--grep|--retries/,
  );
});

it('keeps the original verify check fail-closed over every GPU shard on babylon-js', () => {
  const source = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
  expect(source).toContain('branches: [babylon-js]');
  expect(source).toContain('permissions:\n  contents: read');
  const gpu = source.split('  gpu:\n')[1]?.split('  verify:\n')[0];
  expect(gpu).toContain("if: github.ref == 'refs/heads/babylon-js'");
  const gate = source.split('  verify:\n')[1];
  expect(gate).toContain("if: always() && github.ref == 'refs/heads/babylon-js'");
  expect(gate).toContain('needs: gpu');
  expect(gate).toContain("run: test '${{ needs.gpu.result }}' = success");
  expect(gate.match(/\brun:/g)).toHaveLength(1);
  expect(source).not.toMatch(/contents: write|continue-on-error/);
});

it('triggers isolated grid qualification for every original reference and fixture input', () => {
  const source = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
  for (const path of [
    'src/engine/**',
    'tests/babylon-*.test.ts',
    'src/rendering/grid-paint.ts',
    'src/rendering/geometry.ts',
    'tests/gp-grid-paint.test.ts',
    'e2e/babylon-grid-paint.spec.ts',
    'e2e/fixtures/babylon-grid-paint.ts',
    'e2e/fixtures/babylon-grid-paint-reference.ts',
  ])
    expect(source).toContain(`- '${path}'`);
  const contracts = source
    .split('      - name: Engine component and existing asset geometry contracts\n')[1]
    ?.split('      - ')[0];
  expect(contracts).toContain('tests/babylon-*.test.ts');
  expect(contracts).toContain('tests/gp-grid-paint.test.ts');
});
