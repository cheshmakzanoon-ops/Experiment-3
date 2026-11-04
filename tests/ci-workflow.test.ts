import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// js-yaml is in the lockfile (a dependency of eslint): a real parse, not a regexp, is the dry run
// of a workflow file that cannot be executed outside GitHub.
const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string): unknown };

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
/** The text of one job of a workflow file (up to the next job header). */
const jobOf = (text: string, name: string) => {
  const header = `  ${name}:\n`;
  const start = text.indexOf(header);
  if (start < 0) throw new Error(`Missing required CI job: ${name}`);
  return text.slice(start + header.length).split(/\n {2}[a-z][a-z-]*:\n/)[0];
};
const job = (name: string) => jobOf(workflow, name);

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

  it('gives the scenario job room for the vehicle calibration that runs last', () => {
    // Run 41879845721: the job hit its 15-minute cap during `npm run test:vehicles` and ended
    // cancelled. Its steps before that already take about 12.7 minutes on a GitHub runner.
    const scenarios = job('scenarios');
    const cap = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(scenarios)?.[1]);
    expect(scenarios).toContain('run: npm run test:vehicles');
    expect(cap).toBeGreaterThanOrEqual(25);
    // Nothing outside the job may cancel it: no concurrency group, no fail-fast matrix.
    expect(withoutComments(scenarios)).not.toMatch(
      /concurrency:|cancel-in-progress|fail-fast|continue-on-error/,
    );
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
    // The path-triggered validation workflows that ran owner- or review-gated specs on a product
    // build (where those specs skip) were split: each now has a QA job, checked below.
    expect(owners.map((file) => file.name).sort()).toEqual([
      'ci.yml',
      'cockpit-framing.yml',
      'settings-validation.yml',
      'tyre-blankets-validation.yml',
    ]);
    const cockpit = withoutComments(
      owners.find((file) => file.name === 'cockpit-framing.yml')!.text,
    );
    expect(cockpit).toContain('npm run build:qa');
    expect(cockpit).not.toMatch(/npm run build(?!:qa)\b|check:ip|ip-guard/);
    expect(cockpit).not.toMatch(/path:[^\n]*\bdist\//);
  });

  const workflows = new URL('../.github/workflows/', import.meta.url);
  const qaJob = (file: string, name: string) =>
    withoutComments(jobOf(readFileSync(new URL(file, workflows), 'utf8'), name));
  const splits: [string, string, string, string[]][] = [
    [
      'settings-validation.yml',
      'qa',
      'settings',
      ['e2e/08-reference-implementation.spec.ts', 'e2e/07-reference-tools.spec.ts:243'],
    ],
    [
      'tyre-blankets-validation.yml',
      'replay-qa',
      'build',
      [
        'e2e/07-reference-tools.spec.ts',
        "--grep 'race and replay photo transitions'",
        '--repeat-each=3',
        '--retries=0',
      ],
    ],
  ];
  for (const [file, name, needs, specs] of splits)
    it(`${file}: the review-only specs run on their own QA build (job ${name}) that is never published`, () => {
      const qa = qaJob(file, name);
      expect(qa).toContain(`needs: ${needs}`);
      expect(qa).toContain('npm run build:qa');
      expect(qa).toContain("MOTOBOUND_SUPPLIED_PLAYER: '1'");
      expect(qa).toContain("MOTOBOUND_REVIEW_TOOLS: '1'");
      for (const spec of specs) expect(qa, spec).toContain(spec);
      // Same rules as the owner-qa job: no certifying path, no upload of the build.
      expect(qa).not.toMatch(/npm run build(?!:qa)\b/);
      expect(qa).not.toMatch(/check:ip|check:bundle|ip-guard|continue-on-error/);
      expect(qa).not.toMatch(/path:[^\n]*\bdist\//);
      expect(qa).not.toMatch(/dist-demo|apex-formula-(web|release)|publish|deploy/);
      expect(qa).not.toMatch(/download-artifact/);
    });
  it('the product-build jobs of those workflows still run what they ran (nothing was removed)', () => {
    const settings = readFileSync(new URL('settings-validation.yml', workflows), 'utf8');
    expect(jobOf(settings, 'settings')).toContain(
      'e2e/30-menu-access.spec.ts e2e/settings-transition.spec.ts e2e/08-reference-implementation.spec.ts e2e/07-reference-tools.spec.ts:243',
    );
    const tyre = readFileSync(new URL('tyre-blankets-validation.yml', workflows), 'utf8');
    expect(jobOf(tyre, 'integration')).toContain('replay)');
    expect(jobOf(tyre, 'build')).toContain('npm run check');
  });
});

describe('every workflow is well-formed YAML (the dry parse: they cannot run outside GitHub)', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  type Job = {
    'runs-on'?: unknown;
    uses?: unknown;
    needs?: string | string[];
    steps?: Record<string, unknown>[];
  };
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.yml'))) {
    it(`${name} parses, and its jobs, steps and needs are consistent`, () => {
      const text = readFileSync(new URL(name, directory), 'utf8');
      expect(text, 'a tab is not YAML indentation').not.toMatch(/\t/);
      const doc = yaml.load(text) as { jobs?: Record<string, Job> };
      expect(doc && typeof doc === 'object').toBe(true);
      const jobs = doc.jobs ?? {};
      expect(Object.keys(jobs).length).toBeGreaterThan(0);
      for (const [id, entry] of Object.entries(jobs)) {
        expect(entry['runs-on'] ?? entry.uses, `${name}:${id} needs runs-on or uses`).toBeTruthy();
        for (const need of [entry.needs ?? []].flat())
          expect(Object.keys(jobs), `${name}:${id} needs ${need}`).toContain(need);
        for (const [i, step] of (entry.steps ?? []).entries())
          expect(
            Boolean(step.run) !== Boolean(step.uses),
            `${name}:${id} step ${i} has exactly one of run / uses`,
          ).toBe(true);
      }
    });
  }
});

describe('desktop packaging matrix: native runners, smoke where it can run, never published', () => {
  const file = readFileSync(
    new URL('../.github/workflows/desktop-packages.yml', import.meta.url),
    'utf8',
  );
  interface Step {
    name?: string;
    run?: string;
    uses?: string;
    if?: string;
    'continue-on-error'?: boolean;
    with?: Record<string, unknown>;
  }
  interface Leg {
    edition: string;
    platform: string;
    os: string;
    script: string;
    unpacked: string;
    web: string;
  }
  const doc = yaml.load(file) as {
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        needs?: string;
        steps: Step[];
        strategy?: { 'fail-fast'?: boolean; matrix: { include: Leg[] } };
      }
    >;
  };
  const desktop = (
    JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  const legs = doc.jobs.package.strategy!.matrix.include;
  const code = withoutComments(file);

  it('packages both editions on Windows, Linux and macOS runners of their own', () => {
    expect(legs.map((leg) => `${leg.edition}/${leg.platform}`).sort()).toEqual([
      'demo/linux',
      'demo/macos',
      'demo/windows',
      'full/linux',
      'full/macos',
      'full/windows',
    ]);
    const runner: Record<string, string> = {
      linux: 'ubuntu-24.04',
      windows: 'windows-latest',
      macos: 'macos-latest',
    };
    for (const leg of legs) {
      expect(leg.os, `${leg.edition}/${leg.platform}`).toBe(runner[leg.platform]);
      expect(leg.web).toBe(leg.edition === 'demo' ? 'dist-demo' : 'dist');
      // The leg runs a script that exists, with the right edition's staging.
      expect(desktop[leg.script], leg.script).toBeTruthy();
      expect(desktop[leg.script].includes('--demo'), leg.script).toBe(leg.edition === 'demo');
    }
    expect(doc.jobs.package.strategy!['fail-fast']).toBe(false);
    expect(doc.jobs.package.needs).toBe('web');
    // Windows ships the installer AND the portable exe (plus the zip); Linux the AppImage.
    expect(desktop['dist:win']).toContain('nsis portable zip');
    expect(desktop['dist:demo:win']).toContain('nsis portable zip');
    expect(desktop['dist:linux']).toContain('AppImage');
  });
  it('builds the web editions once, certifies them, and packages exactly those', () => {
    const web = doc.jobs.web.steps.map((step) => step.run ?? '').join('\n');
    expect(web).toContain('npm run build\n');
    expect(web).toContain('npm run build:demo');
    expect(web).toContain('node scripts/ip-guard.mjs --dist dist\n');
    expect(web).toContain('node scripts/ip-guard.mjs --dist dist-demo');
    expect(web).toContain("i.edition!=='full'");
    expect(web).toContain("i.edition!=='demo'");
    const uploads = doc.jobs.web.steps.filter((step) =>
      step.uses?.startsWith('actions/upload-artifact'),
    );
    expect(uploads.map((step) => step.with?.name).sort()).toEqual([
      'desktop-web-demo',
      'desktop-web-full',
    ]);
    // The package job re-checks the edition of what it downloaded.
    const pkg = doc.jobs.package.steps.map((step) => step.run ?? '').join('\n');
    expect(pkg).toContain("i.variant!=='product'");
    expect(pkg).toContain('npm --prefix desktop ci');
    expect(pkg).toContain('npm --prefix desktop run ${{ matrix.script }}');
  });
  it('runs the desktop smoke on Linux as a gate and on Windows as information only', () => {
    const steps = doc.jobs.package.steps;
    const linux = steps.find((step) => step.name?.startsWith('Desktop smoke, Linux'))!;
    expect(linux.if).toBe("matrix.platform == 'linux'");
    expect(linux.run).toContain('desktop/scripts/smoke.cjs --app');
    expect(linux['continue-on-error']).toBeUndefined();
    const windows = steps.find((step) => step.name?.startsWith('Desktop smoke, Windows'))!;
    expect(windows['continue-on-error']).toBe(true);
    expect(windows.run).toContain('--no-xvfb');
    // The harness supports that flag, and the launch paths are the ones the packager writes.
    expect(
      readFileSync(new URL('../desktop/scripts/smoke.cjs', import.meta.url), 'utf8'),
    ).toContain('no-xvfb');
    const unpacked = (edition: string, platform: string) =>
      legs.find((leg) => leg.edition === edition && leg.platform === platform)!.unpacked;
    expect(unpacked('full', 'linux')).toBe('desktop/release/linux-unpacked/motobound');
    expect(unpacked('demo', 'linux')).toBe('desktop/release-demo/linux-unpacked/motobound-demo');
  });
  it('uploads installers and archives only, and never publishes or builds a QA variant', () => {
    expect(doc.permissions).toEqual({ contents: 'read' });
    expect(code).not.toMatch(/MOTOBOUND_(SUPPLIED_PLAYER|REVIEW_TOOLS|QA_BUILD)|build:qa/);
    expect(code).not.toMatch(
      /action-gh-release|gh release|deploy-pages|upload-pages|npm publish|steamcmd|contents:\s*write/,
    );
    expect(code).not.toMatch(/apex-formula-(web|release)/);
    const upload = doc.jobs.package.steps.find((step) =>
      step.name?.startsWith('Installers and archives'),
    )!;
    const paths = String(upload.with?.path);
    expect(paths).not.toMatch(/(^|\s)(dist|dist-demo|desktop\/web)\//);
    for (const dir of ['release', 'release-demo'])
      for (const ext of ['*.exe', '*.AppImage', '*.zip'])
        expect(paths).toContain(`desktop/${dir}/${ext}`);
    expect(upload.with?.['if-no-files-found']).toBe('error');
    // Staging re-certifies every build it packages (a QA build would be refused there too).
    expect(
      readFileSync(new URL('../desktop/scripts/stage-web.cjs', import.meta.url), 'utf8'),
    ).toContain('ip-guard.mjs');
  });
  it('is triggered by the files that change a package, not by every commit', () => {
    const on = (
      yaml.load(file) as { on: { push: { paths: string[] }; pull_request: { paths: string[] } } }
    ).on;
    expect(on.push.paths).toContain('desktop/**');
    expect(on.push.paths).toContain('.github/workflows/desktop-packages.yml');
    expect(on.pull_request.paths).toContain('desktop/**');
  });
  it('the main workflow also builds and certifies the demo, in its own directory and never as the published artifact', () => {
    const validate = withoutComments(job('validate'));
    expect(validate).toContain('npm run build:demo && node scripts/ip-guard.mjs --dist dist-demo');
    expect(validate).not.toMatch(/path:[^\n]*dist-demo/);
    expect(job('publish')).not.toContain('dist-demo');
  });
});
