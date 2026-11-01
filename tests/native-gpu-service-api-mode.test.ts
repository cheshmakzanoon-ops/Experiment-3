import { spawnSync } from 'node:child_process';
import { constants, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_GPU_SERVICE_API_WORKFLOW,
  NATIVE_GPU_SERVICE_API_ONE_SHOT,
  nativeGpuServiceApiAuthorization,
  nativeGpuServiceApiOneShotPushContext,
  nativeGpuServiceApiMode,
  nativeGpuServiceApiArguments,
  nativeGpuServiceApiLaunchReceipt,
  nativeGpuServiceApiManualContext,
  validateNativeGpuServiceApiSource,
  validateNativeGpuServiceApiRuntime,
  type NativeGpuServiceApiLaunchOptions,
} from '../scripts/native-gpu-service-api-mode.mjs';

const eligible: NativeGpuServiceApiLaunchOptions = {
  mode: 'service-api-boundary-v1',
  traceEnabled: true,
  platform: 'linux',
  arch: 'x64',
  hostArch: 'x64',
  graphicsBackend: 'mesa',
  journey: 'full',
  manualNonpublishing: true,
};
const pushEligible: NativeGpuServiceApiLaunchOptions = {
  ...eligible,
  manualNonpublishing: undefined,
  oneShotPushNonpublishing: true,
};
const oneShot = {
  repository: 'cheshmakzanoon-ops/Experiment-3',
  ref: 'refs/heads/main',
  baseCommit: 'b3a0cc29a78f03ac019e701592b4788d468f124e',
  message: 'diagnostic: authorize gpu-service-api once 2026-11-01-8dc45f7a',
  maxEventBytes: 262144,
};
const pushSha = 'c'.repeat(40);
const pushContext = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: oneShot.repository,
  GITHUB_REF: oneShot.ref,
  GITHUB_WORKFLOW_REF: `${oneShot.repository}/${NATIVE_GPU_SERVICE_API_WORKFLOW}@${oneShot.ref}`,
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: pushSha,
  GITHUB_WORKFLOW_SHA: pushSha,
};
const pushEvent = (sha = pushSha) => ({
  repository: { full_name: oneShot.repository, fork: false },
  ref: oneShot.ref,
  before: oneShot.baseCommit,
  after: sha,
  head_commit: { id: sha, message: oneShot.message },
  created: false,
  deleted: false,
  forced: false,
  commits: [{ id: sha, message: oneShot.message }],
});
const supportsNoFollow =
  ['linux', 'darwin'].includes(process.platform) &&
  typeof constants.O_NOFOLLOW === 'number' &&
  constants.O_NOFOLLOW !== 0;
const guardPath = fileURLToPath(
  new URL('../scripts/native-gpu-service-api-mode.mjs', import.meta.url),
);
const context = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'owner/repository',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `owner/repository/${NATIVE_GPU_SERVICE_API_WORKFLOW}@refs/heads/main`,
};

describe('fixed default-off native GPU service API launch mode', () => {
  it('keeps default and explicit off entirely absent from arguments and receipts', () => {
    expect(nativeGpuServiceApiMode()).toBe('off');
    expect(nativeGpuServiceApiMode('off')).toBe('off');
    expect(nativeGpuServiceApiArguments()).toEqual([]);
    expect(nativeGpuServiceApiLaunchReceipt()).toBeUndefined();
    for (const options of [
      { mode: 'off' },
      { ...eligible, mode: 'off' },
      {
        mode: 'off',
        platform: 'win32',
        arch: 'arm64',
        graphicsBackend: 'native',
        journey: 'compatibility-diagnostic',
        traceEnabled: false,
        manualNonpublishing: false,
      },
    ]) {
      expect(nativeGpuServiceApiArguments(options)).toEqual([]);
      expect(nativeGpuServiceApiLaunchReceipt(options)).toBeUndefined();
    }
  });

  it('emits exactly one fixed switch and the constant-only guard receipt', () => {
    expect(nativeGpuServiceApiMode('service-api-boundary-v1')).toBe('service-api-boundary-v1');
    expect(nativeGpuServiceApiArguments(eligible)).toEqual(['--enable-gpu-service-tracing']);
    const receipt = nativeGpuServiceApiLaunchReceipt(eligible);
    expect(receipt).toEqual({
      mode: 'service-api-boundary-v1',
      argument: '--enable-gpu-service-tracing',
      platform: 'linux',
      arch: 'x64',
      graphicsBackend: 'mesa',
      journey: 'full',
      manualNonpublishing: true,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(eligible).toEqual({
      mode: 'service-api-boundary-v1',
      traceEnabled: true,
      platform: 'linux',
      arch: 'x64',
      hostArch: 'x64',
      graphicsBackend: 'mesa',
      journey: 'full',
      manualNonpublishing: true,
    });
  });

  it('uses a distinct constant-only push receipt without widening the fixed launch switch', () => {
    const receipt = nativeGpuServiceApiLaunchReceipt(pushEligible);
    expect(receipt).toEqual({
      mode: 'service-api-boundary-v1',
      argument: '--enable-gpu-service-tracing',
      platform: 'linux',
      arch: 'x64',
      graphicsBackend: 'mesa',
      journey: 'full',
      oneShotPushNonpublishing: true,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(receipt).not.toHaveProperty('manualNonpublishing');
    expect(nativeGpuServiceApiArguments(pushEligible)).toEqual(['--enable-gpu-service-tracing']);
    expect(JSON.stringify(nativeGpuServiceApiLaunchReceipt(eligible))).toBe(
      '{"mode":"service-api-boundary-v1","argument":"--enable-gpu-service-tracing","platform":"linux","arch":"x64","graphicsBackend":"mesa","journey":"full","manualNonpublishing":true}',
    );
    expect(JSON.stringify(nativeGpuServiceApiArguments({ ...pushEligible, mode: 'off' }))).toBe(
      '[]',
    );
    expect(nativeGpuServiceApiLaunchReceipt({ ...pushEligible, mode: 'off' })).toBeUndefined();
  });

  it('requires exactly one boolean authorization and never coerces either flag', () => {
    const values = [undefined, false, true, null, 0, 1, '', 'false', 'true', {}, []];
    for (const manualNonpublishing of values) {
      for (const oneShotPushNonpublishing of values) {
        const options = {
          ...eligible,
          manualNonpublishing,
          oneShotPushNonpublishing,
        } as NativeGpuServiceApiLaunchOptions;
        const allowed =
          (manualNonpublishing === true &&
            (oneShotPushNonpublishing === undefined || oneShotPushNonpublishing === false)) ||
          (oneShotPushNonpublishing === true &&
            (manualNonpublishing === undefined || manualNonpublishing === false));
        if (allowed) {
          expect(nativeGpuServiceApiArguments(options)).toEqual(['--enable-gpu-service-tracing']);
          expect(Object.keys(nativeGpuServiceApiLaunchReceipt(options)!)).toHaveLength(7);
        } else {
          for (const call of [
            () => nativeGpuServiceApiArguments(options),
            () => nativeGpuServiceApiLaunchReceipt(options),
          ])
            expect(call).toThrow(
              /^GPU service API tracing requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa full-journey trace diagnostic$/,
            );
        }
      }
    }
  });

  it.each([
    '',
    '0',
    '1',
    'true',
    'on',
    'OFF',
    'service-api-boundary-v2',
    '--enable-gpu-service-tracing',
    'service-api-boundary-v1 --no-sandbox',
  ])('rejects an unknown selector without reflecting its value: %s', (value) => {
    for (const call of [
      () => nativeGpuServiceApiMode(value),
      () => nativeGpuServiceApiArguments({ ...eligible, mode: value }),
      () => nativeGpuServiceApiLaunchReceipt({ ...eligible, mode: value }),
    ])
      expect(call).toThrow(/^Unknown native GPU service API mode$/);
  });

  it.each([
    ['traceEnabled', false],
    ['traceEnabled', undefined],
    ['traceEnabled', 'true'],
    ['platform', 'win32'],
    ['platform', 'darwin'],
    ['platform', undefined],
    ['arch', 'arm64'],
    ['arch', undefined],
    ['hostArch', 'arm64'],
    ['hostArch', undefined],
    ['graphicsBackend', 'swiftshader'],
    ['graphicsBackend', 'native'],
    ['graphicsBackend', undefined],
    ['journey', 'compatibility-diagnostic'],
    ['journey', undefined],
    ['manualNonpublishing', false],
    ['manualNonpublishing', undefined],
    ['manualNonpublishing', 'true'],
  ])('rejects incompatible %s=%s before producing any launch facts', (key, value) => {
    const options = { ...eligible, [key as string]: value };
    for (const call of [
      () => nativeGpuServiceApiArguments(options),
      () => nativeGpuServiceApiLaunchReceipt(options),
    ])
      expect(call).toThrow(
        'requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa',
      );
  });

  it('retains every platform, trace and journey requirement for push authorization', () => {
    for (const [key, value] of [
      ['traceEnabled', false],
      ['traceEnabled', 'true'],
      ['platform', 'win32'],
      ['platform', 'darwin'],
      ['arch', 'arm64'],
      ['hostArch', 'arm64'],
      ['graphicsBackend', 'swiftshader'],
      ['graphicsBackend', 'native'],
      ['journey', 'compatibility-diagnostic'],
    ]) {
      for (const changed of [value, undefined]) {
        const options = { ...pushEligible, [key as string]: changed };
        expect(() => nativeGpuServiceApiArguments(options)).toThrow(
          'requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa',
        );
        expect(() => nativeGpuServiceApiLaunchReceipt(options)).toThrow(
          'requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa',
        );
      }
    }
  });

  it('rejects malformed non-string selectors rather than coercing them', () => {
    for (const value of [null, false, true, 0, 1, {}, ['service-api-boundary-v1']])
      expect(() => nativeGpuServiceApiMode(value as string)).toThrow('Unknown');
  });

  it('does not accept arbitrary flags or raw-upload settings as launch arguments', () => {
    const options = {
      ...eligible,
      flags: ['--no-sandbox', '--trace-startup'],
      rawTraceUploaded: true,
    };
    expect(nativeGpuServiceApiArguments(options)).toEqual(['--enable-gpu-service-tracing']);
    expect(nativeGpuServiceApiLaunchReceipt(options)).not.toHaveProperty('rawTraceUploaded');
    const arguments1 = nativeGpuServiceApiArguments(eligible);
    arguments1.pop();
    expect(nativeGpuServiceApiArguments(eligible)).toEqual(['--enable-gpu-service-tracing']);
  });
});

describe('source-pinned service API runtime contract', () => {
  it('does not impose new source/runtime requirements in the default mode', () => {
    expect(() => validateNativeGpuServiceApiSource()).not.toThrow();
    expect(() => validateNativeGpuServiceApiRuntime()).not.toThrow();
    expect(() => validateNativeGpuServiceApiSource('off', { electron: 'different' })).not.toThrow();
    expect(() =>
      validateNativeGpuServiceApiRuntime('off', { electron: 'different', chromium: 'different' }),
    ).not.toThrow();
  });

  it('accepts exactly the reviewed source Electron and observed Electron/Chromium versions', () => {
    expect(() =>
      validateNativeGpuServiceApiSource('service-api-boundary-v1', { electron: '45.2.1' }),
    ).not.toThrow();
    expect(() =>
      validateNativeGpuServiceApiRuntime('service-api-boundary-v1', {
        electron: '45.2.1',
        chromium: '156.0.8078.75',
      }),
    ).not.toThrow();
  });

  it('requires exact source identity only for the authorized one-shot push', () => {
    const authorization = { oneShotPushNonpublishing: true, githubSha: pushSha };
    expect(() =>
      validateNativeGpuServiceApiSource(
        'service-api-boundary-v1',
        { electron: '45.2.1', commit: pushSha },
        authorization,
      ),
    ).not.toThrow();
    for (const githubSha of [
      undefined,
      '',
      '0'.repeat(40),
      pushSha.toUpperCase(),
      `${pushSha}\n`,
      'private',
    ]) {
      expect(() =>
        validateNativeGpuServiceApiSource(
          'service-api-boundary-v1',
          { electron: '45.2.1', commit: githubSha },
          { ...authorization, githubSha },
        ),
      ).toThrow(/^GPU service API tracing requires the exact authorized push source$/);
    }
    for (const commit of [
      undefined,
      '',
      oneShot.baseCommit,
      pushSha.toUpperCase(),
      `${pushSha}\n`,
      1,
      'PRIVATE_SOURCE_SECRET',
    ]) {
      expect(() =>
        validateNativeGpuServiceApiSource(
          'service-api-boundary-v1',
          { electron: '45.2.1', commit },
          authorization,
        ),
      ).toThrow(/^GPU service API tracing requires the exact authorized push source$/);
    }
    expect(() =>
      validateNativeGpuServiceApiSource(
        'service-api-boundary-v1',
        { electron: '45.2.0', commit: pushSha },
        authorization,
      ),
    ).toThrow(/^GPU service API tracing requires source Electron 45\.2\.1$/);
    for (const options of [{}, { oneShotPushNonpublishing: false, githubSha: 'unrelated' }])
      expect(() =>
        validateNativeGpuServiceApiSource(
          'service-api-boundary-v1',
          { electron: '45.2.1', commit: 'manual-source' },
          options,
        ),
      ).not.toThrow();
    expect(() =>
      validateNativeGpuServiceApiSource('off', { commit: 'unrelated' }, authorization),
    ).not.toThrow();
  });

  it('fails closed for absent or mismatched source/runtime evidence without reflecting it', () => {
    for (const electron of [undefined, '', '45.2.0', '45.2.2', 45]) {
      expect(() =>
        validateNativeGpuServiceApiSource('service-api-boundary-v1', { electron }),
      ).toThrow(/^GPU service API tracing requires source Electron 45\.2\.1$/);
      expect(() =>
        validateNativeGpuServiceApiRuntime('service-api-boundary-v1', {
          electron,
          chromium: '156.0.8078.75',
        }),
      ).toThrow(
        /^GPU service API tracing requires Electron 45\.2\.1 \/ Chromium 156\.0\.8078\.75$/,
      );
    }
    for (const chromium of [undefined, '', '156.0.8078.74', '156.0.8078.76', 156])
      expect(() =>
        validateNativeGpuServiceApiRuntime('service-api-boundary-v1', {
          electron: '45.2.1',
          chromium,
        }),
      ).toThrow('requires Electron 45.2.1 / Chromium 156.0.8078.75');
    expect(() => validateNativeGpuServiceApiSource('service-api-boundary-v1')).toThrow(
      'requires source',
    );
    expect(() => validateNativeGpuServiceApiRuntime('service-api-boundary-v1')).toThrow(
      'requires Electron',
    );
    expect(() => validateNativeGpuServiceApiSource('unknown')).toThrow('Unknown');
    expect(() => validateNativeGpuServiceApiRuntime('unknown')).toThrow('Unknown');
  });
});

describe('dedicated manual nonpublishing workflow context', () => {
  it('recognizes only the exact repository/ref-qualified caller workflow', () => {
    expect(nativeGpuServiceApiManualContext()).toBe(false);
    expect(nativeGpuServiceApiManualContext(context)).toBe(true);
    expect(
      nativeGpuServiceApiManualContext({
        ...context,
        GITHUB_REF: 'refs/heads/review/service-api',
        GITHUB_WORKFLOW_REF: `owner/repository/${NATIVE_GPU_SERVICE_API_WORKFLOW}@refs/heads/review/service-api`,
      }),
    ).toBe(true);
  });

  it.each([
    ['GITHUB_ACTIONS', undefined],
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_ACTIONS', '1'],
    ['GITHUB_EVENT_NAME', 'push'],
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_EVENT_NAME', 'workflow_call'],
    ['GITHUB_EVENT_NAME', undefined],
    ['GITHUB_REPOSITORY', undefined],
    ['GITHUB_REPOSITORY', ''],
    ['GITHUB_REPOSITORY', 'another/repository'],
    ['GITHUB_REF', undefined],
    ['GITHUB_REF', ''],
    ['GITHUB_REF', 'refs/heads/other'],
    ['GITHUB_WORKFLOW_REF', undefined],
    ['GITHUB_WORKFLOW_REF', 'owner/repository/.github/workflows/desktop-build.yml@refs/heads/main'],
    [
      'GITHUB_WORKFLOW_REF',
      'owner/repository/.github/workflows/desktop-linux-driver-review.yml@refs/heads/main',
    ],
    [
      'GITHUB_WORKFLOW_REF',
      'owner/repository/.github/workflows/desktop-platform.yml@refs/heads/main',
    ],
    ['GITHUB_WORKFLOW_REF', `owner/repository/${NATIVE_GPU_SERVICE_API_WORKFLOW}@refs/heads/other`],
    ['GITHUB_WORKFLOW_REF', `other/repository/${NATIVE_GPU_SERVICE_API_WORKFLOW}@refs/heads/main`],
  ])('refuses %s=%s even when the remaining context is eligible', (key, value) => {
    expect(nativeGpuServiceApiManualContext({ ...context, [key as string]: value })).toBe(false);
  });

  it('preflight executes only the guard, succeeds off and fails closed on incompatible input', () => {
    const path = fileURLToPath(
      new URL('../scripts/native-gpu-service-api-mode.mjs', import.meta.url),
    );
    const execute = (mode: string, args = ['--validate']) =>
      spawnSync(process.execPath, [path, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          MOTOBOUND_GPU_SERVICE_API_TRACE: mode,
          MOTOBOUND_GPU_TRACE: '0',
          GITHUB_ACTIONS: 'false',
        },
      });
    const off = execute('off');
    expect(off.status).toBe(0);
    expect(off.stdout).toBe('');
    // Node/executor preloads can warn before the guard runs. Assert the guard's
    // outcomes and fixed diagnostics, not silence from unrelated runtime code.
    expect(off.stderr).not.toMatch(/GPU service API|Expected --validate/);
    const incompatible = execute('service-api-boundary-v1');
    expect(incompatible.status).not.toBe(0);
    expect(incompatible.stderr).toContain(
      'requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa',
    );
    const unknown = execute('unrecognized');
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('Unknown native GPU service API mode');
    for (const args of [['--enable-gpu-service-tracing'], ['--validate', '--extra']]) {
      const invalidArguments = execute('off', args);
      expect(invalidArguments.status).not.toBe(0);
      expect(invalidArguments.stderr).toContain(
        'Expected --validate for the GPU service API mode guard',
      );
    }
  });
});

describe('exact one-shot push authorization context', () => {
  it('pins a frozen repository, ref, parent, authorization message and event byte limit', () => {
    expect(NATIVE_GPU_SERVICE_API_ONE_SHOT).toEqual(oneShot);
    expect(Object.isFrozen(NATIVE_GPU_SERVICE_API_ONE_SHOT)).toBe(true);
    expect(nativeGpuServiceApiOneShotPushContext()).toBe(false);
    expect(nativeGpuServiceApiOneShotPushContext(pushContext, pushEvent())).toBe(true);
    const env = Object.freeze({ ...pushContext });
    const event = pushEvent();
    Object.freeze(event.repository);
    Object.freeze(event.head_commit);
    Object.freeze(event.commits[0]);
    Object.freeze(event.commits);
    Object.freeze(event);
    expect(nativeGpuServiceApiOneShotPushContext(env, event)).toBe(true);
    expect(event).toEqual(pushEvent());
    expect(nativeGpuServiceApiManualContext(pushContext)).toBe(false);
    expect(nativeGpuServiceApiOneShotPushContext(context, pushEvent())).toBe(false);
  });

  it.each([
    ['GITHUB_ACTIONS', undefined],
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_ACTIONS', 'TRUE'],
    ['GITHUB_ACTIONS', 'true\n'],
    ['GITHUB_EVENT_NAME', undefined],
    ['GITHUB_EVENT_NAME', 'workflow_dispatch'],
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_EVENT_NAME', 'push\n'],
    ['GITHUB_EVENT_NAME', 'PUSH'],
    ['GITHUB_REPOSITORY', undefined],
    ['GITHUB_REPOSITORY', 'fork/Experiment-3'],
    ['GITHUB_REPOSITORY', oneShot.repository.toLowerCase()],
    ['GITHUB_REPOSITORY', oneShot.repository.toUpperCase()],
    ['GITHUB_REPOSITORY', `${oneShot.repository}\n`],
    ['GITHUB_REF', undefined],
    ['GITHUB_REF', 'refs/heads/other'],
    ['GITHUB_REF', 'refs/tags/main'],
    ['GITHUB_REF', 'refs/heads/MAIN'],
    ['GITHUB_REF', `${oneShot.ref}\n`],
    ['GITHUB_WORKFLOW_REF', undefined],
    [
      'GITHUB_WORKFLOW_REF',
      `${oneShot.repository}/.github/workflows/desktop-build.yml@${oneShot.ref}`,
    ],
    [
      'GITHUB_WORKFLOW_REF',
      `${oneShot.repository}/.github/workflows/desktop-linux-driver-review.yml@${oneShot.ref}`,
    ],
    [
      'GITHUB_WORKFLOW_REF',
      `${oneShot.repository}/.github/workflows/desktop-platform.yml@${oneShot.ref}`,
    ],
    [
      'GITHUB_WORKFLOW_REF',
      `${oneShot.repository}/${NATIVE_GPU_SERVICE_API_WORKFLOW}@refs/tags/main`,
    ],
    [
      'GITHUB_WORKFLOW_REF',
      `${oneShot.repository}/${NATIVE_GPU_SERVICE_API_WORKFLOW}@refs/heads/other`,
    ],
    ['GITHUB_WORKFLOW_REF', pushContext.GITHUB_WORKFLOW_REF.toUpperCase()],
    ['GITHUB_WORKFLOW_REF', `${pushContext.GITHUB_WORKFLOW_REF}\n`],
    ['GITHUB_RUN_ATTEMPT', undefined],
    ['GITHUB_RUN_ATTEMPT', '0'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_RUN_ATTEMPT', '01'],
    ['GITHUB_RUN_ATTEMPT', '1\n'],
    ['GITHUB_SHA', undefined],
    ['GITHUB_SHA', '0'.repeat(40)],
    ['GITHUB_SHA', oneShot.baseCommit],
    ['GITHUB_SHA', pushSha.toUpperCase()],
    ['GITHUB_SHA', `${pushSha}\n`],
    ['GITHUB_WORKFLOW_SHA', undefined],
    ['GITHUB_WORKFLOW_SHA', oneShot.baseCommit],
    ['GITHUB_WORKFLOW_SHA', pushSha.toUpperCase()],
    ['GITHUB_WORKFLOW_SHA', `${pushSha}\n`],
  ])('denies changed %s=%s without normalizing or falling back to manual', (key, value) => {
    expect(
      nativeGpuServiceApiOneShotPushContext(
        { ...pushContext, [key as string]: value },
        pushEvent(),
      ),
    ).toBe(false);
  });

  it('rejects invalid SHA shape even when every event and workflow SHA agrees', () => {
    for (const sha of [
      '',
      '0'.repeat(40),
      'c'.repeat(39),
      'c'.repeat(41),
      'g'.repeat(40),
      pushSha.toUpperCase(),
      `${pushSha}\n`,
      `${pushSha}\r\n`,
      ` ${pushSha}`,
    ]) {
      expect(
        nativeGpuServiceApiOneShotPushContext(
          { ...pushContext, GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha },
          pushEvent(sha),
        ),
      ).toBe(false);
    }
    expect(
      nativeGpuServiceApiOneShotPushContext(
        { ...pushContext, GITHUB_RUN_ATTEMPT: 1 } as unknown as typeof pushContext,
        pushEvent(),
      ),
    ).toBe(false);
  });

  it.each([
    ['repository missing', { repository: undefined }],
    ['repository null', { repository: null }],
    ['repository name missing', { repository: { fork: false } }],
    ['repository name different', { repository: { full_name: 'fork/Experiment-3', fork: false } }],
    [
      'repository name case changed',
      { repository: { full_name: oneShot.repository.toLowerCase(), fork: false } },
    ],
    [
      'repository name newline',
      { repository: { full_name: `${oneShot.repository}\n`, fork: false } },
    ],
    ['ref missing', { ref: undefined }],
    ['ref different', { ref: 'refs/heads/other' }],
    ['tag', { ref: 'refs/tags/main' }],
    ['ref case changed', { ref: 'refs/heads/MAIN' }],
    ['ref newline', { ref: `${oneShot.ref}\n` }],
    ['parent missing', { before: undefined }],
    ['parent different', { before: pushSha }],
    ['parent zero', { before: '0'.repeat(40) }],
    ['parent case changed', { before: oneShot.baseCommit.toUpperCase() }],
    ['parent newline', { before: `${oneShot.baseCommit}\n` }],
    ['after missing', { after: undefined }],
    ['after different', { after: oneShot.baseCommit }],
    ['after case changed', { after: pushSha.toUpperCase() }],
    ['head missing', { head_commit: undefined }],
    ['head null', { head_commit: null }],
    ['head id missing', { head_commit: { message: oneShot.message } }],
    ['head id different', { head_commit: { id: oneShot.baseCommit, message: oneShot.message } }],
    [
      'head id case changed',
      { head_commit: { id: pushSha.toUpperCase(), message: oneShot.message } },
    ],
    ['head message missing', { head_commit: { id: pushSha } }],
    ['ordinary push', { head_commit: { id: pushSha, message: 'ordinary source maintenance' } }],
    [
      'head token case changed',
      { head_commit: { id: pushSha, message: oneShot.message.toUpperCase() } },
    ],
    ['head token newline', { head_commit: { id: pushSha, message: `${oneShot.message}\n` } }],
    [
      'head token extended',
      { head_commit: { id: pushSha, message: `${oneShot.message}\n\nadditional body` } },
    ],
    ['commits missing', { commits: undefined }],
    ['commits not array', { commits: { 0: pushEvent().commits[0], length: 1 } }],
    ['zero commits', { commits: [] }],
    ['two commits', { commits: [pushEvent().commits[0], pushEvent().commits[0]] }],
    ['null commit', { commits: [null] }],
    ['commit id missing', { commits: [{ message: oneShot.message }] }],
    ['commit id different', { commits: [{ id: oneShot.baseCommit, message: oneShot.message }] }],
    [
      'commit id case changed',
      { commits: [{ id: pushSha.toUpperCase(), message: oneShot.message }] },
    ],
    ['commit token missing', { commits: [{ id: pushSha }] }],
    [
      'commit token different',
      { commits: [{ id: pushSha, message: 'ordinary source maintenance' }] },
    ],
    [
      'commit token case changed',
      { commits: [{ id: pushSha, message: oneShot.message.toUpperCase() }] },
    ],
    ['commit token newline', { commits: [{ id: pushSha, message: `${oneShot.message}\n` }] }],
  ])('denies %s in an otherwise exact push payload', (_label, patch) => {
    expect(nativeGpuServiceApiOneShotPushContext(pushContext, { ...pushEvent(), ...patch })).toBe(
      false,
    );
  });

  it('requires actual false event flags and actual false repository fork status', () => {
    for (const value of [undefined, null, true, 0, 1, '', 'false', 'true', {}, []]) {
      for (const field of ['created', 'deleted', 'forced'])
        expect(
          nativeGpuServiceApiOneShotPushContext(pushContext, { ...pushEvent(), [field]: value }),
        ).toBe(false);
      expect(
        nativeGpuServiceApiOneShotPushContext(pushContext, {
          ...pushEvent(),
          repository: { full_name: oneShot.repository, fork: value },
        }),
      ).toBe(false);
    }
    for (const event of [undefined, null, false, true, 0, 'PRIVATE_EVENT_SECRET', [], {}])
      expect(nativeGpuServiceApiOneShotPushContext(pushContext, event)).toBe(false);
  });
});

describe('bounded private push event authorization reader', () => {
  it('never even inspects the event path for off, invalid selectors or the existing manual context', () => {
    let reads = 0;
    const withUnreadablePath = (env: Record<string, string>) =>
      Object.defineProperty({ ...env }, 'GITHUB_EVENT_PATH', {
        get() {
          reads += 1;
          throw new Error('PRIVATE_EVENT_PATH_MUST_NOT_BE_READ');
        },
      });
    expect(nativeGpuServiceApiAuthorization()).toEqual({});
    expect(nativeGpuServiceApiAuthorization('off', withUnreadablePath(pushContext))).toEqual({});
    expect(nativeGpuServiceApiAuthorization(undefined, withUnreadablePath(pushContext))).toEqual(
      {},
    );
    expect(
      nativeGpuServiceApiAuthorization('service-api-boundary-v1', withUnreadablePath(context)),
    ).toEqual({ manualNonpublishing: true });
    expect(() =>
      nativeGpuServiceApiAuthorization('PRIVATE_UNKNOWN_MODE', withUnreadablePath(pushContext)),
    ).toThrow(/^Unknown native GPU service API mode$/);
    for (const changed of [
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_RUN_ATTEMPT: '2' },
      { GITHUB_REPOSITORY: oneShot.repository.toLowerCase() },
      { GITHUB_REF: 'refs/tags/main' },
      { GITHUB_WORKFLOW_SHA: oneShot.baseCommit },
    ])
      expect(
        nativeGpuServiceApiAuthorization(
          'service-api-boundary-v1',
          withUnreadablePath({ ...pushContext, ...changed }),
        ),
      ).toEqual({});
    expect(reads).toBe(0);
    expect(JSON.stringify(nativeGpuServiceApiAuthorization('off', pushContext))).toBe('{}');
    expect(
      JSON.stringify(nativeGpuServiceApiAuthorization('service-api-boundary-v1', context)),
    ).toBe('{"manualNonpublishing":true}');
  });

  it('fails closed for absent, invalid or missing event paths without exposing OS details', () => {
    for (const GITHUB_EVENT_PATH of [
      undefined,
      '',
      '\0PRIVATE_EVENT_PATH',
      join(tmpdir(), 'PRIVATE_MISSING_SERVICE_API_EVENT', 'event.json'),
    ]) {
      expect(() =>
        nativeGpuServiceApiAuthorization('service-api-boundary-v1', {
          ...pushContext,
          GITHUB_EVENT_PATH,
        }),
      ).not.toThrow();
      expect(
        nativeGpuServiceApiAuthorization('service-api-boundary-v1', {
          ...pushContext,
          GITHUB_EVENT_PATH,
        }),
      ).toEqual({});
    }
  });

  it.skipIf(!supportsNoFollow)(
    'reads only a bounded exact regular-file event and returns no private payload fields',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'service-api-PRIVATE_EVENT-'));
      const path = join(directory, 'PRIVATE_EVENT_PATH.json');
      const env = { ...pushContext, GITHUB_EVENT_PATH: path };
      try {
        const text = JSON.stringify({ ...pushEvent(), private: 'PRIVATE_EVENT_CONTENT é' });
        writeFileSync(path, text);
        const authorization = nativeGpuServiceApiAuthorization('service-api-boundary-v1', env);
        expect(authorization).toEqual({ oneShotPushNonpublishing: true });
        expect(JSON.stringify(authorization)).toBe('{"oneShotPushNonpublishing":true}');
        expect(nativeGpuServiceApiLaunchReceipt({ ...pushEligible, ...authorization })).toEqual(
          nativeGpuServiceApiLaunchReceipt(pushEligible),
        );
        const boundary = text + ' '.repeat(oneShot.maxEventBytes - Buffer.byteLength(text));
        expect(Buffer.byteLength(boundary)).toBe(oneShot.maxEventBytes);
        writeFileSync(path, boundary);
        expect(nativeGpuServiceApiAuthorization('service-api-boundary-v1', env)).toEqual({
          oneShotPushNonpublishing: true,
        });
        writeFileSync(path, boundary + ' ');
        expect(nativeGpuServiceApiAuthorization('service-api-boundary-v1', env)).toEqual({});
        // Characters are not bytes: this payload is short enough in JS code units
        // but exceeds the private reader budget once UTF-8 encoded.
        const unicode = JSON.stringify({
          ...pushEvent(),
          private: 'é'.repeat(oneShot.maxEventBytes / 2),
        });
        expect(unicode.length).toBeLessThan(oneShot.maxEventBytes);
        expect(Buffer.byteLength(unicode)).toBeGreaterThan(oneShot.maxEventBytes);
        writeFileSync(path, unicode);
        expect(nativeGpuServiceApiAuthorization('service-api-boundary-v1', env)).toEqual({});
        for (const body of [
          '',
          '{"PRIVATE_EVENT_CONTENT":',
          'null',
          '[]',
          'true',
          '{}',
          JSON.stringify({ ...pushEvent(), before: pushSha }),
        ]) {
          writeFileSync(path, body);
          expect(() =>
            nativeGpuServiceApiAuthorization('service-api-boundary-v1', env),
          ).not.toThrow();
          expect(nativeGpuServiceApiAuthorization('service-api-boundary-v1', env)).toEqual({});
        }
        writeFileSync(path, text);
        for (const changed of [
          { GITHUB_RUN_ATTEMPT: '2' },
          { GITHUB_EVENT_NAME: 'pull_request' },
          { GITHUB_REPOSITORY: oneShot.repository.toLowerCase() },
          { GITHUB_WORKFLOW_SHA: oneShot.baseCommit },
        ])
          expect(
            nativeGpuServiceApiAuthorization('service-api-boundary-v1', { ...env, ...changed }),
          ).toEqual({});
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!supportsNoFollow)(
    'rejects directories, symlinks and broken symlinks rather than following them',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'service-api-PRIVATE_SPECIAL-'));
      const real = join(directory, 'real.json');
      const link = join(directory, 'PRIVATE_EVENT_LINK');
      const broken = join(directory, 'PRIVATE_BROKEN_LINK');
      const subdirectory = join(directory, 'PRIVATE_DIRECTORY');
      try {
        writeFileSync(real, JSON.stringify(pushEvent()));
        symlinkSync(real, link);
        symlinkSync(join(directory, 'absent.json'), broken);
        mkdirSync(subdirectory);
        for (const GITHUB_EVENT_PATH of [link, broken, subdirectory]) {
          expect(() =>
            nativeGpuServiceApiAuthorization('service-api-boundary-v1', {
              ...pushContext,
              GITHUB_EVENT_PATH,
            }),
          ).not.toThrow();
          expect(
            nativeGpuServiceApiAuthorization('service-api-boundary-v1', {
              ...pushContext,
              GITHUB_EVENT_PATH,
            }),
          ).toEqual({});
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(supportsNoFollow)(
    'fails closed on platforms without supported no-follow file access',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'service-api-unsupported-'));
      const path = join(directory, 'event.json');
      try {
        writeFileSync(path, JSON.stringify(pushEvent()));
        expect(
          nativeGpuServiceApiAuthorization('service-api-boundary-v1', {
            ...pushContext,
            GITHUB_EVENT_PATH: path,
          }),
        ).toEqual({});
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!supportsNoFollow || process.platform !== 'linux' || process.arch !== 'x64')(
    'executes the actual push preflight without launching or exposing private input on failure',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'service-api-PRIVATE_PREFLIGHT-'));
      const path = join(directory, 'PRIVATE_EVENT_PATH.json');
      const execute = (changed: Record<string, string | undefined> = {}) =>
        spawnSync(process.execPath, [guardPath, '--validate'], {
          encoding: 'utf8',
          timeout: 5000,
          env: {
            ...process.env,
            ...pushContext,
            GITHUB_EVENT_PATH: path,
            MOTOBOUND_GPU_SERVICE_API_TRACE: 'service-api-boundary-v1',
            MOTOBOUND_GPU_TRACE: '1',
            MOTOBOUND_TARGET_ARCH: 'x64',
            MOTOBOUND_CI_GL: 'mesa',
            MOTOBOUND_SMOKE_JOURNEY: 'full',
            ...changed,
          },
        });
      const denied = (changed: Record<string, string | undefined> = {}) => {
        const result = execute(changed);
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(
          'GPU service API tracing requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa full-journey trace diagnostic',
        );
        expect(result.stdout + result.stderr).not.toMatch(
          /PRIVATE_|ENOENT|ELOOP|EISDIR|Unexpected token|JSON\.parse/,
        );
        expect(result.stdout + result.stderr).not.toContain(directory);
      };
      try {
        writeFileSync(path, JSON.stringify({ ...pushEvent(), private: 'PRIVATE_PAYLOAD' }));
        const valid = execute();
        expect(valid.error).toBeUndefined();
        expect(valid.status).toBe(0);
        expect(valid.stdout).toBe('');
        expect(valid.stderr).not.toMatch(/GPU service API|PRIVATE_/);
        for (const changed of [
          { GITHUB_RUN_ATTEMPT: '2' },
          { GITHUB_WORKFLOW_SHA: oneShot.baseCommit },
          { GITHUB_EVENT_PATH: join(directory, 'PRIVATE_ABSENT.json') },
          { GITHUB_EVENT_PATH: directory },
          { MOTOBOUND_GPU_TRACE: '0' },
        ])
          denied(changed);
        for (const event of [
          { ...pushEvent(), before: pushSha },
          { ...pushEvent(), forced: true },
          { ...pushEvent(), created: true },
          { ...pushEvent(), deleted: true },
          { ...pushEvent(), repository: { full_name: oneShot.repository, fork: true } },
          { ...pushEvent(), head_commit: { id: pushSha, message: 'PRIVATE_ORDINARY_PUSH' } },
          { ...pushEvent(), commits: [...pushEvent().commits, ...pushEvent().commits] },
        ]) {
          writeFileSync(path, JSON.stringify(event));
          denied();
        }
        for (const body of [
          '{"PRIVATE_MALFORMED_PAYLOAD":',
          JSON.stringify(pushEvent()) + ' '.repeat(oneShot.maxEventBytes),
        ]) {
          writeFileSync(path, body);
          denied();
        }
        const fifo = join(directory, 'PRIVATE_EVENT_FIFO');
        const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 5000 });
        expect(created.error).toBeUndefined();
        expect(created.status).toBe(0);
        denied({ GITHUB_EVENT_PATH: fifo });
        const off = execute({ MOTOBOUND_GPU_SERVICE_API_TRACE: 'off', GITHUB_EVENT_PATH: fifo });
        expect(off.error).toBeUndefined();
        expect(off.status).toBe(0);
        expect(off.stdout).toBe('');
        const manual = execute({ ...context, GITHUB_EVENT_PATH: fifo });
        expect(manual.error).toBeUndefined();
        expect(manual.status).toBe(0);
        expect(manual.stdout).toBe('');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
