import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readNativeBabylonReadiness } from '../scripts/native-readiness-observation.mjs';

// Exercise the pinned client wire and its actual function serialization, without a browser.
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('playwright-core/package.json'));
const { Frame } = require(join(root, 'lib/client/frame.js'));
const { parseResult, serializeArgument } = require(join(root, 'lib/client/jsHandle.js'));
const source = readFileSync('scripts/desktop-smoke.mjs', 'utf8');
const health = source.slice(
  source.indexOf('async function observeGraphicsHealth('),
  source.indexOf('async function waitForBabylonPresentation('),
);
const call = health.match(
  /page\.evaluate\(readNativeBabylonReadiness, \{ mode: 'health', submissionObservation: true \}\)/,
)?.[0];
async function evaluate(
  documentQuery: () => unknown,
  babylonQuery: () => unknown,
  metadataFailure = false,
) {
  expect(call).toBeDefined();
  const blockedEval = vi.fn(() => {
    throw new EvalError('CSP blocks unsafe-eval');
  });
  const frame = {
    _channel: {
      evaluateExpression: async (wire: {
        expression: string;
        isFunction: boolean;
        arg: { value: unknown };
      }) => {
        expect(wire.isFunction).toBe(true);
        expect(parseResult(wire.arg.value)).toEqual({
          mode: 'health',
          submissionObservation: true,
        });
        // VM compilation models the one privileged CDP function injection, while
        // renderer eval/Function are forbidden. The callback must be closure-free.
        const callback = runInNewContext(`(${wire.expression})`, {
          window: {
            motoboundGraphicsObservation: documentQuery,
            babylonGraphicsDiagnostics: babylonQuery,
          },
          document: { hidden: false, hasFocus: () => true, querySelector: () => null },
          TextEncoder: metadataFailure
            ? class {
                constructor() {
                  throw undefined;
                }
              }
            : TextEncoder,
          performance: { now: () => 123, timeOrigin: 1000 },
          eval: blockedEval,
          Function: blockedEval,
        });
        const value = callback(parseResult(wire.arg.value));
        expect(blockedEval).not.toHaveBeenCalled();
        return { value: serializeArgument(value).value };
      },
    },
  };
  return runInNewContext(call!, {
    page: { evaluate: Frame.prototype.evaluate.bind(frame) },
    readNativeBabylonReadiness,
  });
}
it('returns the actual document/Babylon/readiness object, not an uninvoked function', async () => {
  const documentReceipt = Object.freeze({ documents: [{ losses: 0 }] });
  const graphics = Object.freeze({ settled: true, submitted: 10, completed: 10 });
  const result = await evaluate(
    () => documentReceipt,
    () => graphics,
  );
  expect(typeof result).toBe('object');
  expect(result.document).toEqual(documentReceipt);
  expect(result.babylon).toEqual(graphics);
  expect(result.readiness).toMatchObject({ renderer: { nowMs: 123, timeOriginMs: 1000 } });
  expect(result.readiness).not.toBeUndefined();
});
it.each(['document', 'babylon'] as const)(
  'propagates original %s query errors including falsy values',
  async (query) => {
    for (const failure of [undefined, null, false, 0, '', new Error('original query failed')]) {
      const fail = () => {
        throw failure;
      };
      let caught = false;
      try {
        await evaluate(
          query === 'document' ? fail : () => ({}),
          query === 'babylon' ? fail : () => ({}),
        );
      } catch (error) {
        caught = true;
        expect(error).toBe(failure);
      }
      expect(caught).toBe(true);
    }
  },
);
it('isolates new metadata errors without hiding original health receipts', async () => {
  const documentQuery = vi.fn(() => ({ documents: [] }));
  const babylonQuery = vi.fn(() => ({ settled: true }));
  const result = await evaluate(documentQuery, babylonQuery, true);
  expect(result.document).toEqual({ documents: [] });
  expect(result.babylon).toEqual({ settled: true });
  expect(result.readiness).toEqual({ observationError: 'undefined' });
  expect(documentQuery).toHaveBeenCalledOnce();
  expect(babylonQuery).toHaveBeenCalledTimes(2);
  expect(babylonQuery).toHaveBeenNthCalledWith(1, { submissionObservation: true });
  expect(babylonQuery).toHaveBeenNthCalledWith(2, { submissionObservation: true });
});
it('keeps the strict health timeout and does not optional-chain away missing health evidence', () => {
  expect(health).toContain("new Error('Graphics health observation exceeded 30000ms')");
  expect(health).toContain('rendererObservations.readiness');
  expect(health).toContain('rendererObservations.document');
  expect(health).not.toContain('rendererObservations?.');
});
it('runs this regression in the native platform gate and triggers on changes', () => {
  const testPath = 'tests/native-graphics-health-expression.test.ts';
  const platform = readFileSync('.github/workflows/desktop-platform.yml', 'utf8');
  const workflow = readFileSync('.github/workflows/babylon-desktop.yml', 'utf8');
  expect(platform.split(/\s+/)).toContain(testPath);
  expect(workflow).toContain(`- '${testPath}'`);
});
