import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('persists and prints the failure before suite completion, including later worker errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'browser-progress-'));
  try {
    const reporter = pathToFileURL(resolve('scripts/browser-progress-reporter.mjs')).href;
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import Reporter from ${JSON.stringify(reporter)};
          import { readFileSync } from 'node:fs';
          const reporter = new Reporter();
          const test = { id: 'fixture', titlePath: () => ['render survey'], location: { file: 'survey.spec.ts' } };
          reporter.onBegin();
          reporter.onTestBegin(test);
          reporter.onStepBegin(test, {}, { title: 'Evaluate' });
          const active = JSON.parse(readFileSync('browser-progress.json', 'utf8'));
          reporter.onTestEnd(test, {
            status: 'timedOut', duration: 300000,
            errors: [{ message: 'page.evaluate timed out', stack: 'page.evaluate timed out\\n at survey.spec.ts:42' }],
          });
          const afterTest = JSON.parse(readFileSync('browser-progress.json', 'utf8'));
          reporter.onError({ message: 'Browser process disconnected' });
          const afterError = JSON.parse(readFileSync('browser-progress.json', 'utf8'));
          reporter.onEnd({ status: 'failed' });
          console.log('RESULT ' + JSON.stringify({ active, afterTest, afterError }));
        `,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 10000 },
    );
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.split('RESULT ')[1]);
    expect(result.active.active).toEqual([
      expect.objectContaining({ id: 'fixture', step: 'Evaluate' }),
    ]);
    expect(result.afterTest).toMatchObject({
      event: 'test-end',
      active: [],
      completed: [
        {
          id: 'fixture',
          status: 'timedOut',
          durationMs: 300000,
          errors: [{ message: 'page.evaluate timed out', stack: expect.stringContaining(':42') }],
        },
      ],
    });
    expect(result.afterError.errors).toEqual([{ message: 'Browser process disconnected' }]);
    expect(run.stderr).toContain('[browser-failure] render survey');
    expect(run.stderr).toContain('at survey.spec.ts:42');
    expect(run.stderr).toContain('[browser-error] Browser process disconnected');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
