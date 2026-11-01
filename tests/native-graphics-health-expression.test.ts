import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readNativeBabylonReadiness } from '../scripts/native-readiness-observation.mjs';

// Execute the exact string sent to Playwright. Evaluating an uninvoked arrow
// returns a function, which cannot be transported as the required health object.
const source = readFileSync('scripts/desktop-smoke.mjs', 'utf8');
const health = source.slice(
  source.indexOf('async function observeGraphicsHealth('),
  source.indexOf('async function waitForBabylonPresentation('),
);
const begin = health.indexOf('page.evaluate(`') + 'page.evaluate(`'.length;
const template = health.slice(begin, health.indexOf('`)', begin));
const printer = source.slice(
  source.indexOf('function diagnosticErrorText('),
  source.indexOf('function readinessDiagnosticFailure('),
);
function evaluate(
  documentQuery: () => unknown,
  babylonQuery: () => unknown,
  reader: () => unknown = readNativeBabylonReadiness,
) {
  const expression = template
    .replace('${readinessReaderSource}', () => reader.toString())
    .replace('${diagnosticErrorText.toString()}', () => printer);
  return runInNewContext(expression, {
    window: {
      motoboundGraphicsObservation: documentQuery,
      babylonGraphicsDiagnostics: babylonQuery,
    },
    document: { hidden: false, hasFocus: () => true, querySelector: () => null },
    TextEncoder,
    performance: { now: () => 123, timeOrigin: 1000 },
  });
}
it('returns the actual document/Babylon/readiness object, not an uninvoked function', () => {
  const documentReceipt = Object.freeze({ documents: [{ losses: 0 }] });
  const graphics = Object.freeze({ settled: true, submitted: 10, completed: 10 });
  const result = evaluate(
    () => documentReceipt,
    () => graphics,
  );
  expect(typeof result).toBe('object');
  expect(result.document).toBe(documentReceipt);
  expect(result.babylon).toBe(graphics);
  expect(result.readiness).toMatchObject({ renderer: { nowMs: 123, timeOriginMs: 1000 } });
  expect(result.readiness).not.toBeUndefined();
});
it.each(['document', 'babylon'] as const)(
  'propagates original %s query errors including falsy values',
  (query) => {
    for (const failure of [undefined, null, false, 0, '', new Error('original query failed')]) {
      const fail = () => {
        throw failure;
      };
      let caught = false;
      try {
        evaluate(query === 'document' ? fail : () => ({}), query === 'babylon' ? fail : () => ({}));
      } catch (error) {
        caught = true;
        expect(error).toBe(failure);
      }
      expect(caught).toBe(true);
    }
  },
);
it('isolates new metadata errors without hiding original health receipts', () => {
  const documentQuery = vi.fn(() => ({ documents: [] }));
  const babylonQuery = vi.fn(() => ({ settled: true }));
  const result = evaluate(documentQuery, babylonQuery, () => {
    throw undefined;
  });
  expect(result.document).toEqual({ documents: [] });
  expect(result.babylon).toEqual({ settled: true });
  expect(result.readiness).toEqual({ observationError: 'undefined' });
  expect(documentQuery).toHaveBeenCalledOnce();
  expect(babylonQuery).toHaveBeenCalledOnce();
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
