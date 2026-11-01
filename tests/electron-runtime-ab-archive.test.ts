import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
it.skipIf(process.platform !== 'linux')(
  'qualifies fixed-pin ZIP bounds and privacy without downloading or executing Electron',
  () => {
    const result = spawnSync(
      'python3',
      ['-B', 'tests/fixtures/electron-runtime-ab-archive-unit.py'],
      {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 128 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 11 tests');
  },
);
