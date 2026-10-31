import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_GPU_SERVICE_API_WORKFLOW =
  '.github/workflows/desktop-gpu-service-api-review.yml';

/** A fixed harness-only selector, never a source of arbitrary Chromium flags. */
export function nativeGpuServiceApiMode(value = 'off') {
  if (value !== 'off' && value !== 'service-api-boundary-v1')
    throw new Error('Unknown native GPU service API mode');
  return value;
}

/** Reusable jobs inherit their caller's GitHub context. Only the dedicated
 * manual, read-only, nonpublishing workflow is an eligible caller. A manual
 * dispatch of the required release workflow is deliberately insufficient. */
export function nativeGpuServiceApiManualContext(env = {}) {
  return (
    env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    typeof env.GITHUB_REPOSITORY === 'string' &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY) &&
    typeof env.GITHUB_REF === 'string' &&
    /^refs\/(heads|tags)\/[^\r\n]+$/.test(env.GITHUB_REF) &&
    env.GITHUB_WORKFLOW_REF ===
      `${env.GITHUB_REPOSITORY}/${NATIVE_GPU_SERVICE_API_WORKFLOW}@${env.GITHUB_REF}`
  );
}

/** The receipt and launch arguments share this single fail-closed guard. Off
 * adds neither a launch switch nor a receipt, preserving existing lanes. */
export function nativeGpuServiceApiLaunchReceipt({
  mode = 'off',
  traceEnabled,
  platform,
  arch,
  hostArch,
  graphicsBackend,
  journey,
  manualNonpublishing,
} = {}) {
  if (nativeGpuServiceApiMode(mode) === 'off') return undefined;
  if (
    traceEnabled !== true ||
    platform !== 'linux' ||
    arch !== 'x64' ||
    hostArch !== 'x64' ||
    graphicsBackend !== 'mesa' ||
    journey !== 'full' ||
    manualNonpublishing !== true
  )
    throw new Error(
      'GPU service API tracing requires the dedicated manual nonpublishing Linux x64 Mesa full-journey trace diagnostic',
    );
  return Object.freeze({
    mode: 'service-api-boundary-v1',
    argument: '--enable-gpu-service-tracing',
    platform: 'linux',
    arch: 'x64',
    graphicsBackend: 'mesa',
    journey: 'full',
    manualNonpublishing: true,
  });
}

export function nativeGpuServiceApiArguments(options) {
  const receipt = nativeGpuServiceApiLaunchReceipt(options);
  return receipt ? [receipt.argument] : [];
}

/** The source-reviewed wrapper contract is specific to this packaged runtime.
 * These checks reuse existing observations; they make no native API calls. */
export function validateNativeGpuServiceApiSource(mode = 'off', source) {
  if (nativeGpuServiceApiMode(mode) === 'off') return;
  if (source?.electron !== '45.2.1')
    throw new Error('GPU service API tracing requires source Electron 45.2.1');
}

export function validateNativeGpuServiceApiRuntime(mode = 'off', runtime) {
  if (nativeGpuServiceApiMode(mode) === 'off') return;
  if (runtime?.electron !== '45.2.1' || runtime?.chromium !== '156.0.8078.75')
    throw new Error('GPU service API tracing requires Electron 45.2.1 / Chromium 156.0.8078.75');
}

// Early workflow preflight uses the same checks as the launch harness, before
// dependency installation/package creation. No application or parser is run.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--validate')
    throw new Error('Expected --validate for the GPU service API mode guard');
  nativeGpuServiceApiArguments({
    mode: process.env.MOTOBOUND_GPU_SERVICE_API_TRACE ?? 'off',
    traceEnabled: process.env.MOTOBOUND_GPU_TRACE === '1',
    platform: process.platform,
    arch: process.env.MOTOBOUND_TARGET_ARCH ?? process.arch,
    hostArch: process.arch,
    graphicsBackend: process.env.MOTOBOUND_CI_GL || 'native',
    journey: process.env.MOTOBOUND_SMOKE_JOURNEY ?? 'full',
    manualNonpublishing: nativeGpuServiceApiManualContext(process.env),
  });
}
