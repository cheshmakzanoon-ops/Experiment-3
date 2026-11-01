import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import {
  comparisonEnvironment,
  validateComparisonHost,
  validateComparisonSource,
  validateImmutableReceipt,
  validateComparisonRuntime,
  isDeclaredRuntimeNativeEvidence,
  RUNTIME_AB_PINS,
  RUNTIME_AB_SCHEMA,
  summarizeComparison,
  validateComparisonSummary,
} from '../scripts/electron-runtime-ab-contract.mjs';
import {
  classifySmokeResult,
  cleanupIsVerified,
} from '../scripts/electron-runtime-ab-coordinator.mjs';
import { immutable, smoke, exited, clean } from './fixtures/electron-runtime-ab-fixtures.ts';

describe('fixed official comparison provenance, never a shipped downgrade', () => {
  it('pins exact independent release asset digests and expected embedded runtimes', () => {
    expect(
      RUNTIME_AB_PINS.map((pin) => [pin.electron, pin.chromium, pin.bytes, pin.sha256]),
    ).toEqual([
      [
        '45.2.1',
        '156.0.8078.75',
        123777540,
        '616efc1ae4784af1a4f3f0e8774e73e7030e7bd1708da9d09bcf543dfa499beb',
      ],
      [
        '44.10.1',
        '152.0.7977.169',
        123103802,
        '2be868b71b0aa71f30e6b5567a106a35a049385e963183c074aad1975ead5167',
      ],
    ]);
    const python = readFileSync('scripts/electron-runtime-ab-archive.py', 'utf8');
    for (const pin of RUNTIME_AB_PINS) {
      expect(python).toContain(pin.sha256);
      expect(python).toContain(String(pin.bytes));
    }
  });
  it('accepts the comparison B identity while explicitly rejecting normal shipped-pin qualification', () => {
    const b = smoke('B');
    expect(b.source.electron).toBe('45.2.1');
    expect(b.runtime.electron).toBe('44.10.1');
    expect(classifySmokeResult('B', immutable, exited, b).status).toBe('passed');
    expect(isDeclaredRuntimeNativeEvidence(b)).toBe(false);
    expect(() => validateComparisonRuntime('A', b.runtime)).toThrow();
    expect(isDeclaredRuntimeNativeEvidence(smoke('A'))).toBe(true);
  });
  it.each(['electron', 'chromium', 'node', 'platform', 'arch'])(
    'missing or mismatched actual %s cannot qualify',
    (key) => {
      const b = smoke('B');
      const runtime = b.runtime as Record<string, unknown>;
      delete runtime[key];
      expect(classifySmokeResult('B', immutable, exited, b).reason).toBe('runtime-mismatch');
      runtime[key] = 'wrong';
      expect(classifySmokeResult('B', immutable, exited, b).status).toBe('unqualified');
    },
  );
  it('treats missing connection/runtime and spawn failure as unqualified, not native failure diagnosis', () => {
    const report = smoke('A') as Record<string, unknown>;
    delete report.runtime;
    expect(classifySmokeResult('A', immutable, exited, report).reason).toBe('missing-runtime');
    expect(
      classifySmokeResult('A', immutable, { spawned: false, exitCode: null, signal: null }, report)
        .reason,
    ).toBe('spawn-failed');
  });
  it.each(['source', 'trace', 'omitted', 'isolation', 'journey', 'fault', 'exit'])(
    'fails closed on %s inconsistency',
    (kind) => {
      const report = smoke('A');
      const execution = { ...exited };
      if (kind === 'source') report.source.fingerprint = '7'.repeat(64);
      if (kind === 'trace') report.gpuTrace.enabled = true;
      if (kind === 'omitted') report.smokeJourney.omittedChecks.push('model');
      if (kind === 'isolation') report.checks.splice(8, 1);
      if (kind === 'journey') report.compatibility.pop();
      if (kind === 'fault') report.graphicsFaults.push('GPU exit 512');
      if (kind === 'exit') execution.exitCode = 1;
      expect(classifySmokeResult('A', immutable, execution, report).status).not.toBe('passed');
    },
  );
  it('retains an explicit runtime-observed failed leg without diagnosing 512', () => {
    const report = smoke('A');
    report.success = false;
    report.graphicsFaults.push('GPU exit 512');
    expect(classifySmokeResult('A', immutable, { ...exited, exitCode: 1 }, report)).toMatchObject({
      status: 'failed',
      reason: 'smoke-failed',
      actualRuntime: { electron: '45.2.1' },
    });
  });
  it.each([
    ['TypeError: app.getGPUFeatureStatus is not a function', 'failure-unclassified'],
    ['Protocol error: method was not found', 'failure-unclassified'],
    ['Error: Desktop renderer isolation is not active', 'security-incompatible'],
  ])('leaves %s unqualified without relaxing protections', (failure, reason) => {
    const report = { ...smoke('B'), success: false, failure };
    expect(classifySmokeResult('B', immutable, { ...exited, exitCode: 1 }, report)).toMatchObject({
      status: 'unqualified',
      reason,
    });
  });
  it('does not qualify pre-Mesa startup as a usable native comparison leg', () => {
    const report = { ...smoke('B'), success: false, renderer: null };
    expect(classifySmokeResult('B', immutable, { ...exited, exitCode: 1 }, report).reason).toBe(
      'backend-unverified',
    );
    for (const value of [undefined, null, 1, 'pass'])
      expect(isDeclaredRuntimeNativeEvidence(value)).toBe(false);
  });
  it('never replaces an authoritative GPU fault with a guessed protocol/API cause', () => {
    const report = {
      ...smoke('B'),
      success: false,
      failure: 'Protocol error: Target closed',
      firstGraphicsFault: 'GPU health failed: GPU process exit 512',
      contextLosses: 1,
    };
    expect(classifySmokeResult('B', immutable, { ...exited, exitCode: 1 }, report)).toMatchObject({
      status: 'failed',
      reason: 'smoke-failed',
    });
    expect(
      classifySmokeResult(
        'B',
        immutable,
        { ...exited, exitCode: 1 },
        { ...report, firstGraphicsFault: null, contextLosses: 0 },
      ),
    ).toMatchObject({ status: 'unqualified', reason: 'failure-unclassified' });
    expect(
      classifySmokeResult('B', immutable, { ...exited, exitCode: 1 }, { ...report, stages: [] }),
    ).toMatchObject({ status: 'unqualified', reason: 'entry-unverified' });
  });
  it('requires exact source keys, shipped pin and finite immutable counts', () => {
    expect(validateComparisonSource(immutable.source)).toEqual(immutable.source);
    expect(() => validateComparisonSource({ ...immutable.source, electron: '44.10.1' })).toThrow();
    expect(() => validateComparisonSource({ ...immutable.source, commit: null })).toThrow();
    expect(() => validateComparisonSource({ ...immutable.source, runtime: '44.10.1' })).toThrow();
    expect(() => summarizeComparison({ ...immutable, payloadBytes: Infinity }, [])).toThrow();
  });
  it('does not coerce array hashes, tokens or malformed successful-report fields', () => {
    expect(() =>
      validateComparisonSource({ ...immutable.source, commit: [immutable.source.commit] }),
    ).toThrow();
    expect(() =>
      validateComparisonSource({
        ...immutable.source,
        fingerprint: [immutable.source.fingerprint],
      }),
    ).toThrow();
    expect(() =>
      validateImmutableReceipt({ ...immutable, payloadSha256: [immutable.payloadSha256] }),
    ).toThrow();
    for (const change of [
      { checks: smoke('A').checks.join(' ') },
      { renderer: ['llvmpipe'] },
      { compatibility: smoke('A').compatibility.map((item) => ({ ...item, paused: true })) },
      { compatibility: smoke('A').compatibility.map((item) => ({ ...item, completedAt: -1 })) },
    ])
      expect(classifySmokeResult('A', immutable, exited, { ...smoke('A'), ...change }).status).toBe(
        'unqualified',
      );
  });
  it('rejects impossible cross-leg histories even when each leg is individually shaped', () => {
    const legs = (['A', 'B'] as const).map((leg) => ({
      leg,
      ...classifySmokeResult(leg, immutable, exited, smoke(leg)),
      exitCode: 0,
      cleanupVerified: true,
      evidenceSha256: '6'.repeat(64),
    }));
    for (const reason of ['cleanup-uncertain', 'immutable-unverified', 'preflight-unqualified']) {
      expect(() =>
        summarizeComparison(immutable, [{ ...legs[0], status: 'unqualified', reason }, legs[1]]),
      ).toThrow();
    }
    expect(() =>
      summarizeComparison(immutable, [
        { ...legs[0], status: 'unqualified', reason: 'invalid-evidence', cleanupVerified: false },
        legs[1],
      ]),
    ).toThrow();
    expect(() =>
      summarizeComparison(immutable, [
        legs[0],
        {
          leg: 'B',
          status: 'blocked',
          reason: 'blocked-after-a',
          exitCode: null,
          actualRuntime: null,
          cleanupVerified: false,
          evidenceSha256: null,
        },
      ]),
    ).toThrow();
  });
  it('requires a distinct nonpublishing schema even for two successful comparisons', () => {
    const legs = (['A', 'B'] as const).map((leg) => ({
      leg,
      ...classifySmokeResult(leg, immutable, exited, smoke(leg)),
      exitCode: 0,
      cleanupVerified: true,
      evidenceSha256: '6'.repeat(64),
    }));
    const value = summarizeComparison(immutable, legs);
    expect(value).toMatchObject({
      schema: RUNTIME_AB_SCHEMA,
      success: true,
      nonpublishing: true,
      requiredLaneQualification: false,
    });
    expect(isDeclaredRuntimeNativeEvidence(value)).toBe(false);
    expect(validateComparisonSummary(value)).toBe(value);
    expect(() =>
      validateComparisonSummary({ ...value, requiredLaneQualification: true }),
    ).toThrow();
    expect(() => validateComparisonSummary({ ...value, extra: 'private' })).toThrow();
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(16384);
  });
});

describe('unchanged host, security and fresh environment contract', () => {
  const root = `/tmp/runtime-ab-${'a'.repeat(32)}/A`;
  const options = { privateRoot: root, token: 'b'.repeat(64) };
  it('constructs the same fixed Mesa/full/trace-off values and private state directories', () => {
    const env = comparisonEnvironment(
      {
        PATH: '/usr/bin',
        DISPLAY: ':99',
        GITHUB_TOKEN: 'never-copy',
        HOME: '/old',
        XDG_CACHE_HOME: '/old-cache',
      },
      options,
    );
    expect(env).toMatchObject({
      MOTOBOUND_CI_GL: 'mesa',
      MOTOBOUND_SMOKE_JOURNEY: 'full',
      MOTOBOUND_GPU_TRACE: '0',
      MOTOBOUND_GPU_SERVICE_API_TRACE: 'off',
      LIBGL_ALWAYS_SOFTWARE: '1',
      HOME: root + '/home',
      TMPDIR: root + '/tmp',
      XDG_CACHE_HOME: root + '/cache',
    });
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(Object.values(env)).not.toContain('/old');
  });
  it.each([
    'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE',
    'LD_PRELOAD',
    'MESA_GL_VERSION_OVERRIDE',
    'GALLIUM_DRIVER',
    'MOTOBOUND_GPU_TRACE',
    'MOTOBOUND_GPU_SERVICE_API_TRACE',
    'MOTOBOUND_SMOKE_JOURNEY',
    'LIBGL_ALWAYS_SOFTWARE',
  ])('rejects inherited override %s, including empty values', (name) => {
    for (const value of [name === 'LIBGL_ALWAYS_SOFTWARE' ? '0' : '1', '', 'unexpected'])
      expect(() => comparisonEnvironment({ [name]: value }, options)).toThrow();
  });
  it('accepts only Ubuntu22 x64 nonroot; root would make Playwright weaken sandbox launch', () => {
    const host = {
      platform: 'linux',
      arch: 'x64',
      uid: 1001,
      osRelease: 'ID=ubuntu\nVERSION_ID="22.04"\n',
    };
    expect(() => validateComparisonHost(host)).not.toThrow();
    for (const change of [
      { uid: 0 },
      { arch: 'arm64' },
      { platform: 'win32' },
      { osRelease: 'ID=ubuntu\nVERSION_ID="24.04"' },
    ])
      expect(() => validateComparisonHost({ ...host, ...change })).toThrow();
  });
  it('requires descriptor closure plus two empty scans, not a kill attempt', () => {
    expect(cleanupIsVerified(clean)).toBe(true);
    for (const change of [
      { owned: 1 },
      { emptyScans: 1 },
      { signaledTerm: 1 },
      { ok: false },
      { reason: 'deadline' },
      { settled: NaN },
      { pid: 7 },
    ])
      expect(cleanupIsVerified({ ...clean, ...change })).toBe(false);
    expect(cleanupIsVerified({ ...clean, settled: 1, signaledTerm: 1 })).toBe(true);
    expect(cleanupIsVerified({ ...clean, settled: 1, signaledTerm: 1 }, true)).toBe(false);
  });
});

// Execute the actual test-registration wrapper with a private process stub;
// never mutate the real host identity or spawn Python on unsupported hosts.
it.each(['win32', 'darwin', 'freebsd', 'linux'])(
  'runs Linux process helpers only for the supported host: %s',
  (platform) => {
    const url = new URL('./electron-runtime-ab-process.test.ts', import.meta.url);
    const source = readFileSync(url, 'utf8').replaceAll(
      'import.meta.url',
      JSON.stringify(url.href),
    );
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    let spawnAttempts = 0;
    let suites = 0;
    let skipped = false;
    let registeredBodies = 0;
    let executedBodies = 0;
    const describe = Object.assign(
      (_name: string, body: () => void) => {
        suites++;
        body();
      },
      {
        skipIf: (condition: boolean) => (_name: string, body: () => void) => {
          suites++;
          skipped = condition;
          // Vitest 3.2.4 collects skipped suite factories too; only test
          // execution is suppressed. A spawn in the factory must still fail.
          body();
        },
      },
    );
    const noAssertion = () => undefined;
    const fakeVitest = {
      describe,
      it: (_name: string, body: () => void) => {
        registeredBodies++;
        if (!skipped) {
          executedBodies++;
          body();
        }
      },
      expect: () => ({ toBeUndefined: noAssertion, toBe: noAssertion, toMatch: noAssertion }),
    };
    runInNewContext(
      compiled,
      {
        exports: {},
        process: { platform },
        URL,
        require(name: string) {
          if (name === 'vitest') return fakeVitest;
          if (name === 'node:url') return { fileURLToPath };
          if (name === 'node:child_process')
            return {
              spawnSync: () => {
                spawnAttempts++;
                return { error: undefined, status: 0, stdout: '', stderr: 'OK' };
              },
            };
          throw new Error('Unexpected offline wrapper dependency');
        },
      },
      { timeout: 500 },
    );
    expect(spawnAttempts).toBe(platform === 'linux' ? 2 : 0);
    expect(registeredBodies).toBe(2);
    expect(executedBodies).toBe(platform === 'linux' ? 2 : 0);
    expect(suites).toBe(1);
    expect(skipped).toBe(platform !== 'linux');
  },
);
