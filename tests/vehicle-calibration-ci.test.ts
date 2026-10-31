import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const calibration = workflow.slice(
  workflow.indexOf('  vehicle-calibration:\n'),
  workflow.indexOf('  offroad-scenarios:\n'),
);
it('requires the whole strict vehicle calibration independently of the scenario budget', () => {
  expect(calibration).toContain('timeout-minutes: 15');
  expect(calibration).toContain('scripts/vehicle-calibration.ts" --strict');
  expect(calibration).not.toContain('--only');
  expect(calibration).toContain('scripts/source-stability.ts -- bash');
  const publication = workflow.slice(workflow.indexOf('  publish:\n'));
  expect(publication).toMatch(/needs: \[[^\]]*vehicle-calibration[^\]]*\]/);
  expect(publication).toContain('success()');
});
it('seeds and retains both generated outputs outside the source tree, including failure logs', () => {
  expect(calibration).toContain('cp docs/production/CONTENT_PIPELINE.md');
  expect(calibration).toContain('cd "$RUNNER_TEMP/vehicle-gate"');
  expect(calibration).toContain('if: always()');
  expect(calibration).toContain('/vehicle-gate/docs/vehicle-calibration.json');
  expect(calibration).toContain('/vehicle-gate/docs/production/CONTENT_PIPELINE.md');
  expect(calibration).toContain('/vehicle-gate/vehicle-calibration.log');
  const scenarios = workflow.slice(
    workflow.indexOf('  scenarios:\n'),
    workflow.indexOf('  vehicle-calibration:\n'),
  );
  expect(scenarios).not.toContain('npm run test:vehicles');
  expect(scenarios).toContain('timeout-minutes: 15');
});
