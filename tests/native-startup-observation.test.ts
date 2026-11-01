import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readNativeBabylonReadiness } from '../scripts/native-readiness-observation.mjs';
const source = readFileSync('scripts/desktop-smoke.mjs', 'utf8');
const require = createRequire(import.meta.url);
const playwrightRoot = dirname(require.resolve('playwright-core/package.json'));
const { Frame } = require(join(playwrightRoot, 'lib/client/frame.js'));
const server = readFileSync(join(playwrightRoot, 'lib/server/frames.js'), 'utf8');
const serverStart = server.indexOf(
  '        let evaledExpression;',
  server.indexOf('async waitForFunctionExpression('),
);
const serverEnd = server.indexOf('        let fulfill;', serverStart);
const serverPredicate = server.slice(serverStart, serverEnd);
interface Wire {
  expression: string;
  isFunction: boolean;
  pollingInterval: number;
  timeout: number;
}

const begin = source.indexOf('`', source.indexOf('page.waitForFunction('));
const end = source.indexOf('`,', begin);
const printer = source.slice(
  source.indexOf('function diagnosticErrorText('),
  source.indexOf('function readinessDiagnosticFailure('),
);
function predicate(
  data: Record<string, string>,
  binding: (gate: number, sample: unknown) => Promise<void>,
  args = { gateId: 1, binding: 'observe', failurePrefix: 'diagnostic:' },
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
  // Build the exact host template, including JSON-serialized gate arguments.
  const expression = runInNewContext(source.slice(begin, end + 1), {
    readinessReaderSource: readNativeBabylonReadiness.toString(),
    diagnosticErrorText: runInNewContext(`(${printer})`),
    gateId: args.gateId,
    readinessBinding: args.binding,
    readinessFailurePrefix: args.failurePrefix,
  });
  const realm = {
    document,
    window: { [args.binding]: binding },
    performance: Object.freeze({ now: () => 25000, timeOrigin: 1000000 }),
    TextEncoder,
    setTimeout: timer,
    setInterval: timer,
    console: { debug: (message: string) => diagnosticErrors.push(message) },
  };
  return {
    run: async () => {
      const result = await Frame.prototype.waitForFunction.call(
        {
          _timeout: (options: { timeout: number }) => options.timeout,
          _channel: {
            waitForFunction: async (wire: Wire) => {
              expect(wire.isFunction).toBe(false);
              expect(wire.pollingInterval).toBe(100);
              expect(wire.timeout).toBe(30000);
              // The real pinned server calls only isFunction:true or unspecified.
              // A string returning a function stays truthy; NEVER auto-invoke it here.
              const value = runInNewContext(
                `(() => { ${serverPredicate} return predicate(); })()`,
                {
                  ...realm,
                  expression2: wire.expression,
                  isFunction2: wire.isFunction,
                  arg2: undefined,
                },
              );
              expect(typeof value).not.toBe('function');
              return { handle: { _object: value } };
            },
          },
        },
        expression,
        undefined,
        { timeout: 30000, polling: 100 },
      );
      return result;
    },
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
  async (data, expected) => {
    const samples: unknown[] = [];
    const h = predicate(data, async (_gate, sample) => {
      samples.push(sample);
    });
    const before = JSON.stringify(h.status);
    expect(await h.run()).toBe(expected);
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
  expect(await h.run()).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(h.diagnosticErrors).toHaveLength(1);
  expect(h.diagnosticErrors[0]).toContain('binding-rejection');
  expect(h.timer).not.toHaveBeenCalled();
});
it.each([undefined, null])(
  'diagnostic synchronous falsy failure %s cannot make a failed gate pass',
  async (error) => {
    const h = predicate(
      { presentationSettled: 'false', renderedFrames: '10', completedFrames: '10' },
      () => {
        throw error;
      },
    );
    expect(await h.run()).toBe(false);
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

it('re-evaluates the string on each pinned server poll and safely embeds gate arguments', async () => {
  let settled = 'false';
  const data = {
    get presentationSettled() {
      return settled;
    },
    renderedFrames: '10',
    completedFrames: '10',
  };
  const samples: number[] = [];
  const args = {
    gateId: 7,
    binding: 'observe"\\\n);throw new Error("injection");//',
    failurePrefix: 'quoted"\n\\prefix:',
  };
  const h = predicate(
    data,
    async (gate) => {
      samples.push(gate);
    },
    args,
  );
  expect(await h.run()).toBe(false);
  expect(samples).toEqual([7]);
  settled = 'true';
  expect(await h.run()).toBe(true);
  expect(samples).toEqual([7, 7]);
  const failedObservation = predicate(
    data,
    () => {
      throw undefined;
    },
    args,
  );
  expect(await failedObservation.run()).toBe(true);
  expect(failedObservation.diagnosticErrors[0].startsWith(args.failurePrefix)).toBe(true);
});
it('pins the server admission semantics and inventories the two harness string sites', () => {
  expect(serverPredicate).toContain('if (isFunction2 === true)');
  expect(serverPredicate).toContain('else if (isFunction2 === false)');
  expect(server.slice(serverEnd)).toContain(
    'const success = predicate();\n            if (success)',
  );
  expect(source.match(/page\.evaluate\(`/g)).toHaveLength(1);
  expect(source.match(/page\.waitForFunction\(\s*`/g)).toHaveLength(1);
  expect(source).toContain('page.evaluate(`(() => ({');
  expect(source).toContain('}))()`),');
});
