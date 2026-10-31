import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = (name: string) => {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start < 0) throw new Error(`Missing required CI job: ${name}`);
  return workflow.slice(start + header.length).split(/\n {2}[a-z][a-z-]*:\n/)[0];
};

describe('independent CI diagnostics with strict release gates', () => {
  it('runs native contracts through the asset-generating npm test lifecycle', () => {
    const native = readFileSync(
      new URL('../.github/workflows/desktop-platform.yml', import.meta.url),
      'utf8',
    );
    const contract = native
      .split('name: Validate desktop isolation and engine contracts')[1]
      ?.split('      - name:')[0];
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    expect(contract).toContain('run: npm test -- ');
    expect(contract).toContain('tests/babylon-*.test.ts');
    expect(contract).toContain('tests/circuit-ribbon-data.test.ts');
    expect(contract).not.toMatch(/npx vitest|--ignore-scripts|--exclude|--passWithNoTests/);
    expect(scripts.pretest).toBe('npm run generate:player-lods');
    expect(scripts.test).toBe('vitest run');
    expect(scripts['generate:player-lods']).toBe(
      'node --experimental-strip-types scripts/build-player-lods.mjs',
    );
  });

  it('builds separately while the unfiltered unit suite remains required', () => {
    const build = job('validate'),
      unit = job('unit-tests');
    expect(build).toContain('npm run lint && npm run validate:content && npm run build');
    expect(build).not.toMatch(/npm (?:test|run check)/);
    expect(unit).toContain(
      'scripts/source-stability.ts -- npm test -- --shard=${{ matrix.shard }}/4 --reporter=verbose',
    );
    expect(unit).toContain('shard: [1, 2, 3, 4]');
    expect(unit).toContain('fail-fast: false');
    expect(unit).not.toMatch(/continue-on-error|--exclude|--testNamePattern|--passWithNoTests/);
    expect(build).not.toMatch(/needs:/);
    expect(unit).not.toMatch(/needs:/);
  });

  it('runs both browser gates on the exact build, independently of unit results', () => {
    for (const name of ['browser', 'wet-presentation']) {
      const browser = job(name);
      expect(browser).toContain('needs: validate');
      expect(browser).toContain('name: apex-formula-web');
      expect(browser).not.toContain('needs: unit-tests');
    }
  });

  it('runs the complete original offroad gate with guarded temporary reports', () => {
    const offroad = job('offroad-scenarios');
    expect(offroad).toContain('timeout-minutes: 35');
    expect(offroad).toContain('timeout-minutes: 30');
    expect(offroad).toContain('scripts/source-stability.ts -- bash -c');
    expect(offroad).toContain('unset OFFROAD_RACE');
    expect(offroad).toContain('cd "$RUNNER_TEMP/offroad-gate"');
    expect(offroad).toContain('"$GITHUB_WORKSPACE/scripts/offroad-calibration.ts"');
    expect(offroad).toContain('"$GITHUB_WORKSPACE/scripts/offroad-races.ts"');
    expect(offroad.match(/set -euo pipefail/g)).toHaveLength(2);
    expect(offroad).toContain('tee "$RUNNER_TEMP/offroad-gate/offroad-gate.log"');
    expect(offroad).toContain('if: always()');
    expect(offroad).toContain('${{ runner.temp }}/offroad-gate/docs/offroad-races.json');
    expect(offroad).not.toMatch(/continue-on-error|OFFROAD_RACE=/);
  });

  it('keeps the full strict vehicle registry as a required independent gate', () => {
    const calibration = job('vehicle-calibration');
    expect(calibration).toContain('scripts/vehicle-calibration.ts" --strict');
    expect(calibration).not.toMatch(/continue-on-error|--only/);
    expect(calibration).toContain('scripts/source-stability.ts -- bash -c');
    expect(calibration).toContain('if: always()');
  });

  it('cannot publish unless the unit suite and every other required job succeed', () => {
    const publish = job('publish');
    expect(publish).toContain(
      'needs: [validate, unit-tests, scenarios, vehicle-calibration, offroad-scenarios, browser, wet-presentation]',
    );
    expect(publish).toContain('success() &&');
    expect(publish.split('    steps:')[0]).not.toContain('continue-on-error');
  });
});
