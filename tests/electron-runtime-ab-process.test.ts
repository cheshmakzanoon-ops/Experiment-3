import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixture = fileURLToPath(
  new URL('./fixtures/electron-runtime-ab-process-unit.py', import.meta.url),
);

function runCases(cases: string[]): void {
  const result = spawnSync('python3', ['-B', fixture, ...cases], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  expect(result.error, 'Python fixture must finish within its fixed bound').toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toMatch(/\bOK\b/);
}

describe.skipIf(process.platform !== 'linux')('offline Linux runtime A/B process ownership', () => {
  it('rejects unsafe requests/layouts and tests pidfd races, bounds and closure with mocks', () => {
    runCases(['RequestAndLayout', 'MockedProcesses']);
  });

  it('closes only detached copied-sleep children, preserving outside/neighbor/wrong-token processes', () => {
    runCases(['BenignProcesses']);
  });
});
