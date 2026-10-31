import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_GPU_SERVICE_API_WORKFLOW,
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
      expect(call).toThrow('requires the dedicated manual nonpublishing Linux x64 Mesa');
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
      'requires the dedicated manual nonpublishing Linux x64 Mesa',
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
