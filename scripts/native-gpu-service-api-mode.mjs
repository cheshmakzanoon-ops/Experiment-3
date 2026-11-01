import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

export const NATIVE_GPU_SERVICE_API_WORKFLOW =
  '.github/workflows/desktop-gpu-service-api-review.yml';

// Temporary authorization for one child push of this exact main revision.
// Not a credential or a general opt-in. Remove the push path after observation.
export const NATIVE_GPU_SERVICE_API_ONE_SHOT = Object.freeze({
  repository: 'cheshmakzanoon-ops/Experiment-3',
  ref: 'refs/heads/main',
  baseCommit: 'b3a0cc29a78f03ac019e701592b4788d468f124e',
  message: 'diagnostic: authorize gpu-service-api once 2026-11-01-8dc45f7a',
  maxEventBytes: 256 * 1024,
});

const exactCommit = (value) =>
  typeof value === 'string' &&
  value.length === 40 &&
  /^[0-9a-f]{40}$/.test(value) &&
  value !== '0'.repeat(40);

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

function oneShotEnvironment(env) {
  const allowed = NATIVE_GPU_SERVICE_API_ONE_SHOT;
  return (
    env.GITHUB_ACTIONS === 'true' &&
    env.GITHUB_EVENT_NAME === 'push' &&
    env.GITHUB_REPOSITORY === allowed.repository &&
    env.GITHUB_REF === allowed.ref &&
    env.GITHUB_WORKFLOW_REF ===
      `${allowed.repository}/${NATIVE_GPU_SERVICE_API_WORKFLOW}@${allowed.ref}` &&
    env.GITHUB_RUN_ATTEMPT === '1' &&
    exactCommit(env.GITHUB_SHA) &&
    env.GITHUB_SHA !== allowed.baseCommit &&
    env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA
  );
}

/** Case-sensitive counterpart of the preliminary Actions expression. The fixed
 * previous head plus one-commit, non-forced first attempt makes an unrelated
 * later push ineligible, even if it repeats the public authorization message. */
export function nativeGpuServiceApiOneShotPushContext(env = {}, event) {
  const allowed = NATIVE_GPU_SERVICE_API_ONE_SHOT;
  return (
    oneShotEnvironment(env) &&
    event?.repository?.full_name === allowed.repository &&
    event.repository.fork === false &&
    event.ref === allowed.ref &&
    event.before === allowed.baseCommit &&
    event.after === env.GITHUB_SHA &&
    event.created === false &&
    event.deleted === false &&
    event.forced === false &&
    event.head_commit?.id === env.GITHUB_SHA &&
    event.head_commit.message === allowed.message &&
    Array.isArray(event.commits) &&
    event.commits.length === 1 &&
    event.commits[0]?.id === env.GITHUB_SHA &&
    event.commits[0].message === allowed.message
  );
}

/** Only the one-shot push path reads an event file. Keep arbitrary payload,
 * paths and parser/OS errors out of receipts and logs. O_NONBLOCK avoids a FIFO
 * open waiting before fstat rejects it; O_NOFOLLOW rejects the final symlink.
 * This is an input/allocation bound, not a process RSS or OS-latency cap. */
function readOneShotEvent(path) {
  let descriptor;
  try {
    if (
      typeof path !== 'string' ||
      !path ||
      !['linux', 'darwin'].includes(process.platform) ||
      !Number.isInteger(constants.O_NOFOLLOW) ||
      constants.O_NOFOLLOW <= 0 ||
      !Number.isInteger(constants.O_NONBLOCK) ||
      constants.O_NONBLOCK <= 0
    )
      return undefined;
    const entry = lstatSync(path);
    if (
      !entry.isFile() ||
      entry.size < 1 ||
      entry.size > NATIVE_GPU_SERVICE_API_ONE_SHOT.maxEventBytes
    )
      return undefined;
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.dev !== entry.dev ||
      before.ino !== entry.ino ||
      before.size !== entry.size ||
      before.mtimeMs !== entry.mtimeMs ||
      before.size < 1 ||
      before.size > NATIVE_GPU_SERVICE_API_ONE_SHOT.maxEventBytes
    )
      return undefined;
    const buffer = Buffer.alloc(before.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(descriptor, buffer, bytes, buffer.length - bytes, bytes);
      if (!read) break;
      bytes += read;
    }
    const after = fstatSync(descriptor);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      return undefined;
    const event = JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
    closeSync(descriptor);
    descriptor = undefined;
    return event;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // A close error cannot grant authorization or expose the event payload.
      }
    }
  }
}

/** Off and the original manual context do not touch the event file. No caller
 * supplied string becomes an argument, receipt field or diagnostic message. */
export function nativeGpuServiceApiAuthorization(mode = 'off', env = {}) {
  if (nativeGpuServiceApiMode(mode) === 'off') return {};
  if (nativeGpuServiceApiManualContext(env)) return { manualNonpublishing: true };
  if (
    oneShotEnvironment(env) &&
    nativeGpuServiceApiOneShotPushContext(env, readOneShotEvent(env.GITHUB_EVENT_PATH))
  )
    return { oneShotPushNonpublishing: true };
  return {};
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
  oneShotPushNonpublishing,
} = {}) {
  if (nativeGpuServiceApiMode(mode) === 'off') return undefined;
  const manual =
    manualNonpublishing === true &&
    (oneShotPushNonpublishing === undefined || oneShotPushNonpublishing === false);
  const oneShot =
    oneShotPushNonpublishing === true &&
    (manualNonpublishing === undefined || manualNonpublishing === false);
  if (
    traceEnabled !== true ||
    platform !== 'linux' ||
    arch !== 'x64' ||
    hostArch !== 'x64' ||
    graphicsBackend !== 'mesa' ||
    journey !== 'full' ||
    (!manual && !oneShot)
  )
    throw new Error(
      'GPU service API tracing requires the dedicated manual or one-shot nonpublishing Linux x64 Mesa full-journey trace diagnostic',
    );
  return Object.freeze({
    mode: 'service-api-boundary-v1',
    argument: '--enable-gpu-service-tracing',
    platform: 'linux',
    arch: 'x64',
    graphicsBackend: 'mesa',
    journey: 'full',
    ...(manual ? { manualNonpublishing: true } : { oneShotPushNonpublishing: true }),
  });
}

export function nativeGpuServiceApiArguments(options) {
  const receipt = nativeGpuServiceApiLaunchReceipt(options);
  return receipt ? [receipt.argument] : [];
}

/** The source-reviewed wrapper contract is specific to this packaged runtime.
 * These checks reuse existing observations; they make no native API calls. */
export function validateNativeGpuServiceApiSource(
  mode = 'off',
  source,
  { oneShotPushNonpublishing = false, githubSha } = {},
) {
  if (nativeGpuServiceApiMode(mode) === 'off') return;
  if (source?.electron !== '45.2.1')
    throw new Error('GPU service API tracing requires source Electron 45.2.1');
  if (
    oneShotPushNonpublishing === true &&
    (!exactCommit(githubSha) || source?.commit !== githubSha)
  )
    throw new Error('GPU service API tracing requires the exact authorized push source');
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
    ...nativeGpuServiceApiAuthorization(
      process.env.MOTOBOUND_GPU_SERVICE_API_TRACE ?? 'off',
      process.env,
    ),
  });
}
