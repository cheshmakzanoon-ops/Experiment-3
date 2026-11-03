import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = (name: string) => {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start < 0) throw new Error(`Missing required CI job: ${name}`);
  return workflow.slice(start + header.length).split(/\n {2}[a-z][a-z-]*:\n/)[0];
};

describe('independent CI diagnostics with strict release gates', () => {
  it('builds separately while the unfiltered unit suite remains required', () => {
    const build = job('validate'),
      unit = job('unit-tests');
    expect(build).toContain('npm run lint && npm run validate:content && npm run build');
    expect(build).not.toMatch(/npm (?:test|run check)/);
    expect(unit).toMatch(/scripts\/source-stability\.ts -- npm test(?:\n|$)/);
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

  it('cannot publish unless the unit suite and every other required job succeed', () => {
    const publish = job('publish');
    expect(publish).toContain(
      'needs: [validate, unit-tests, scenarios, offroad-scenarios, browser, wet-presentation, owner-qa]',
    );
    expect(publish).toContain('success() &&');
    expect(publish.split('    steps:')[0]).not.toContain('continue-on-error');
  });
});

/** The steps of a job, without its explanatory comments (which name the commands they forbid). */
const withoutComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('release gate G15: the IP guard is enforced and owner builds are never certified', () => {
  it('certifies the exact uploaded build in the validate job, after building it', () => {
    const build = job('validate');
    expect(build).toContain('node scripts/ip-guard.mjs --dist dist');
    expect(build).not.toMatch(/continue-on-error/);
    const guard = build.indexOf('node scripts/ip-guard.mjs --dist dist');
    expect(build.indexOf('npm run lint && npm run validate:content && npm run build')).toBeLessThan(
      guard,
    );
    expect(guard).toBeLessThan(build.indexOf('name: Static application build'));
  });

  it('certifies the downloaded artifact again before it is prepared for release', () => {
    const publish = job('publish');
    const guard = publish.indexOf('node scripts/ip-guard.mjs --dist dist');
    expect(guard).toBeGreaterThan(publish.indexOf('Require downloaded build before continuing'));
    expect(guard).toBeLessThan(
      publish.indexOf('name: Prepare tested main-branch release artifact'),
    );
    // Publication gates on the QA job but never downloads anything it produced.
    expect(publish).not.toMatch(/name: owner-qa/);
    expect(publish).toContain('name: apex-formula-web');
  });

  it('runs the owner-only and review specs on a separate QA build that is never published', () => {
    const qa = withoutComments(job('owner-qa'));
    expect(qa).toContain('npm run build:qa');
    expect(qa).toContain('needs: validate');
    expect(qa).toContain("MOTOBOUND_SUPPLIED_PLAYER: '1'");
    expect(qa).toContain("MOTOBOUND_REVIEW_TOOLS: '1'");
    for (const spec of [
      'e2e/39-supplied-player.spec.ts',
      'e2e/41-player-render-budget.spec.ts',
      'e2e/p0-cockpit-framing.spec.ts',
      'e2e/24-coupled-driver.spec.ts',
      'e2e/07-reference-tools.spec.ts',
    ])
      expect(qa).toContain(spec);
    // The certifying path and any upload of the build are off limits to the QA job.
    expect(qa).not.toMatch(/npm run build(?!:qa)\b/);
    expect(qa).not.toMatch(/check:ip|check:bundle|ip-guard|continue-on-error/);
    expect(qa).not.toMatch(/path:[^\n]*\bdist\//);
    expect(qa).not.toMatch(/apex-formula-(web|release)/);
    // The product build still reaches the wet-presentation job and the 42 index budget there.
    expect(job('wet-presentation')).toContain('e2e/42-full-scene-index-budget.spec.ts');
    expect(job('wet-presentation')).not.toContain('e2e/41-player-render-budget.spec.ts');
  });

  it('no workflow that makes an owner or review build goes through the certifying path or uploads it', () => {
    const directory = new URL('../.github/workflows/', import.meta.url);
    const owners = readdirSync(directory)
      .filter((name) => name.endsWith('.yml'))
      .map((name) => ({ name, text: readFileSync(new URL(name, directory), 'utf8') }))
      .filter(({ text }) => /MOTOBOUND_(SUPPLIED_PLAYER|REVIEW_TOOLS)|build:qa/.test(text));
    expect(owners.map((file) => file.name).sort()).toEqual(['ci.yml', 'cockpit-framing.yml']);
    const cockpit = withoutComments(
      owners.find((file) => file.name === 'cockpit-framing.yml')!.text,
    );
    expect(cockpit).toContain('npm run build:qa');
    expect(cockpit).not.toMatch(/npm run build(?!:qa)\b|check:ip|ip-guard/);
    expect(cockpit).not.toMatch(/path:[^\n]*\bdist\//);
  });
});
