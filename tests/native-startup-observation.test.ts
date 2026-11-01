import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readNativeBabylonReadiness } from '../scripts/native-readiness-observation.mjs';
const source = readFileSync('scripts/desktop-smoke.mjs', 'utf8');
const begin = source.indexOf('`({ gateId, binding, failurePrefix }) => {');
const end = source.indexOf('`,', begin);
const printer = source.slice(
  source.indexOf('function diagnosticErrorText('),
  source.indexOf('function readinessDiagnosticFailure('),
);
function predicate(
  data: Record<string, string>,
  binding: (gate: number, sample: unknown) => Promise<void>,
) {
  const status = Object.freeze({
    textContent: 'PAUSED · physics tick 54',
    dataset: Object.freeze(data),
  });
  const document = Object.freeze({
    hidden: false,
    hasFocus: () => true,
    querySelector: (selector: string) => (selector === '#status' ? status : null),
  });
  const diagnosticErrors: string[] = [];
  const timer = vi.fn(() => {
    throw new Error('observer must not schedule');
  });
  const callbackSource = source
    .slice(begin + 1, end)
    .replace('${readinessReaderSource}', () => readNativeBabylonReadiness.toString())
    .replace('${diagnosticErrorText.toString()}', () => printer);
  const callback = runInNewContext(`(${callbackSource})`, {
    document,
    window: { observe: binding },
    performance: Object.freeze({ now: () => 25000, timeOrigin: 1000000 }),
    TextEncoder,
    setTimeout: timer,
    setInterval: timer,
    console: { debug: (message: string) => diagnosticErrors.push(message) },
  }) as (args: { gateId: number; binding: string; failurePrefix: string }) => boolean;
  return {
    run: () => callback({ gateId: 1, binding: 'observe', failurePrefix: 'diagnostic:' }),
    timer,
    diagnosticErrors,
    status,
  };
}
it.each([
  [{ presentationSettled: 'true', renderedFrames: '10', completedFrames: '10' }, true],
  [{ presentationSettled: 'false', renderedFrames: '10', completedFrames: '10' }, false],
  [{ presentationSettled: 'true', renderedFrames: '10', completedFrames: '9' }, false],
  [{}, false],
] as [Record<string, string>, boolean][])(
  'observes the exact existing predicate without changing outcome or frozen DOM: %o',
  (data, expected) => {
    const samples: unknown[] = [];
    const h = predicate(data, async (_gate, sample) => {
      samples.push(sample);
    });
    const before = JSON.stringify(h.status);
    expect(h.run()).toBe(expected);
    expect(samples).toHaveLength(1);
    expect(JSON.stringify(h.status)).toBe(before);
    expect(h.timer).not.toHaveBeenCalled();
  },
);
it('never awaits transport and records rejection separately from a passing predicate', async () => {
  const h = predicate(
    { presentationSettled: 'true', renderedFrames: '10', completedFrames: '10' },
    () => Promise.reject(new Error('diagnostic transport unavailable')),
  );
  expect(h.run()).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(h.diagnosticErrors).toHaveLength(1);
  expect(h.diagnosticErrors[0]).toContain('binding-rejection');
  expect(h.timer).not.toHaveBeenCalled();
});
it.each([undefined, null])(
  'diagnostic synchronous falsy failure %s cannot make a failed gate pass',
  (error) => {
    const h = predicate(
      { presentationSettled: 'false', renderedFrames: '10', completedFrames: '10' },
      () => {
        throw error;
      },
    );
    expect(h.run()).toBe(false);
    expect(h.diagnosticErrors).toHaveLength(1);
    expect(h.diagnosticErrors[0]).toContain('poll-capture');
  },
);
it('retains budgets and query counts and marks timeout evidence as stale or absent', () => {
  const body = source.slice(
    source.indexOf('async function waitForBabylonPresentation('),
    source.indexOf('async function captureChecked('),
  );
  expect(body.match(/page\.waitForFunction\(/g)).toHaveLength(1);
  expect(body.match(/\.evaluate\(/g)).toHaveLength(1);
  expect(body).toContain('{ timeout: 30000, polling: 100 }');
  expect(body).not.toContain('setTimeout(');
  expect(body).not.toContain('waitForTimeout(');
  expect(body).toContain('last-received-poll-not-fresh-at-failure');
  expect(body).toContain('absent-before-failure');
  expect(body).toContain('return preserveNativeFailureWhileObserving(error, () => {');
  const failure = body.slice(body.indexOf('\n  } catch (error) {'));
  expect(failure.indexOf('activeReadinessGate = null')).toBeLessThan(
    failure.indexOf('preserveNativeFailureWhileObserving'),
  );
  expect(source).toContain("scope: 'simulation-entry-started'");
  expect(source).toContain("environmentReadiness: 'not-asserted'");
  expect(source).toContain("stage('babylon-ready', {");
  const bootstrap = source.slice(
    source.indexOf("await page.waitForURL('motobound://game/babylon.html'"),
    source.indexOf("stage('babylon-ready'"),
  );
  expect(bootstrap).toContain('{ timeout: 120000, polling: 100 }');
});

it('does not attribute late observer errors to another gate clock bracket', () => {
  expect(source).toContain("'late-for-closed-gate'");
  expect(source).toContain(
    'activeReadinessGate?.id === failure.gateId ? activeReadinessGate.hostBefore : null',
  );
  expect(source).toContain('normalizeNativeBabylonReadiness(sample)');
});
