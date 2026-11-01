import catalogue from './electron-runtime-ab-catalogue.json' with { type: 'json' };
import { posix } from 'node:path';

// This is a separate comparison contract. It never qualifies a required lane,
// even when both comparison legs pass. No native executable is launched here.
export const RUNTIME_AB_SCHEMA = 'electron-runtime-comparison-v1';
export const RUNTIME_AB_LEG_SCHEMA = 'electron-runtime-comparison-leg-v1';
export const RUNTIME_AB_LIMITS = Object.freeze({
  sourceFiles: 20000,
  sourceBytes: 512 * 1024 * 1024,
  payloadBytes: 512 * 1024 * 1024,
  fileBytes: 256 * 1024 * 1024,
  reportBytes: 8 * 1024 * 1024,
  legEvidenceBytes: 32 * 1024 * 1024,
  comparisonBytes: 16 * 1024,
});
export const RUNTIME_AB_PINS = Object.freeze(
  catalogue.runtimes.map((runtime) => Object.freeze({ ...runtime })),
);
export const RUNTIME_AB_DECLARED = catalogue.declaredShippedElectron;
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
export function runtimeAbFail(code) {
  // Fixed codes only. Never include paths, environment, arguments or parser text.
  const error = new Error(`Runtime comparison rejected: ${code}`);
  error.code = code;
  throw error;
}
export function exactKeys(value, keys, code = 'schema') {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')
  )
    runtimeAbFail(code);
}
export function runtimeAbPin(leg) {
  const pin = RUNTIME_AB_PINS.find((item) => item.leg === leg);
  if (!pin) runtimeAbFail('leg');
  return pin;
}
export function validateComparisonSource(source) {
  exactKeys(source, [
    'version',
    'commit',
    'fingerprint',
    'electron',
    'platform',
    'arch',
    'hostArch',
  ]);
  if (
    source.version !== 1 ||
    typeof source.commit !== 'string' ||
    !COMMIT.test(source.commit) ||
    typeof source.fingerprint !== 'string' ||
    !SHA.test(source.fingerprint) ||
    source.electron !== RUNTIME_AB_DECLARED ||
    source.platform !== 'linux' ||
    source.arch !== 'x64' ||
    source.hostArch !== 'x64'
  )
    runtimeAbFail('source');
  return { ...source };
}
export function validateComparisonRuntime(leg, actual) {
  const pin = runtimeAbPin(leg);
  if (
    !actual ||
    !['platform', 'arch', 'electron', 'chromium', 'node'].every(
      (key) => actual[key] === pin[key],
    ) ||
    !(actual.translated === undefined || actual.translated === false)
  )
    runtimeAbFail('actual-runtime');
  return {
    platform: actual.platform,
    arch: actual.arch,
    electron: actual.electron,
    chromium: actual.chromium,
    node: actual.node,
  };
}

/** A truthful normal-source qualification requires the actual shipped runtime.
 * This predicate is not installed in, and does not weaken, any required gate.
 * Distinct comparison envelopes intentionally lack the native report shape. */
export function isDeclaredRuntimeNativeEvidence(report) {
  return Boolean(
    report &&
      typeof report === 'object' &&
      !('schema' in report) &&
      report.success === true &&
      report.source?.electron === RUNTIME_AB_DECLARED &&
      report.runtime?.electron === RUNTIME_AB_DECLARED &&
      report.runtime?.chromium === runtimeAbPin('A').chromium &&
      report.runtime?.node === runtimeAbPin('A').node,
  );
}

/** Reject diagnostic/loader/driver overrides before making a fresh environment.
 * HOME/TMP/XDG are re-rooted for both legs, never copied from the source profile.
 * Existing normal Mesa/full/trace-off values are accepted only if exact. */
export function comparisonEnvironment(inherited, { privateRoot, token }) {
  if (
    typeof privateRoot !== 'string' ||
    privateRoot.length > 4096 ||
    posix.normalize(privateRoot) !== privateRoot ||
    !/^\/[\x20-\x7e]+\/runtime-ab-[0-9a-f]{32}\/[AB]$/.test(privateRoot)
  )
    runtimeAbFail('private-path');
  if (typeof token !== 'string' || !SHA.test(token)) runtimeAbFail('owner-token');
  const fixed = {
    MOTOBOUND_TARGET_ARCH: 'x64',
    MOTOBOUND_CI_GL: 'mesa',
    MOTOBOUND_SMOKE_JOURNEY: 'full',
    MOTOBOUND_GPU_TRACE: '0',
    MOTOBOUND_GPU_SERVICE_API_TRACE: 'off',
    LIBGL_ALWAYS_SOFTWARE: '1',
    DEBUG: 'pw:browser',
  };
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined) continue;
    if (name in fixed) {
      if (value !== fixed[name]) runtimeAbFail('inherited-environment');
    } else if (
      /^(?:MOTOBOUND_|ELECTRON_|NODE_OPTIONS$|NODE_PATH$|LD_|GALLIUM_|MESA_|ANGLE_|VK_|__GL|LIBGL_|LIBVA_|DRI_|GBM_|OZONE_)/.test(
        name,
      )
    )
      runtimeAbFail('inherited-environment');
  }
  // No general inheritance of credentials, tracing knobs or executable options.
  const env = {};
  for (const name of ['PATH', 'DISPLAY', 'XAUTHORITY', 'LANG', 'LC_ALL', 'TZ', 'GITHUB_ACTIONS'])
    if (typeof inherited[name] === 'string') env[name] = inherited[name];
  return Object.freeze({
    ...env,
    ...fixed,
    HOME: `${privateRoot}/home`,
    TMPDIR: `${privateRoot}/tmp`,
    XDG_CACHE_HOME: `${privateRoot}/cache`,
    XDG_CONFIG_HOME: `${privateRoot}/config`,
    XDG_DATA_HOME: `${privateRoot}/data`,
    MOTOBOUND_RUNTIME_AB_OWNER: token,
  });
}

export function validateComparisonHost({ platform, arch, uid, osRelease }) {
  if (
    platform !== 'linux' ||
    arch !== 'x64' ||
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !/^ID=ubuntu$/m.test(osRelease) ||
    !/^VERSION_ID="22\.04"$/m.test(osRelease)
  )
    runtimeAbFail('host');
  // Rejecting root is essential: pinned Playwright automatically adds
  // --no-sandbox for UID 0. We do not modify that implementation or privileges.
}

export function validateImmutableReceipt(value) {
  exactKeys(value, [
    'source',
    'sourceTreeSha256',
    'payloadSha256',
    'payloadBytes',
    'smokeSha256',
    'compiledSmokeSha256',
  ]);
  validateComparisonSource(value.source);
  for (const key of ['sourceTreeSha256', 'payloadSha256', 'smokeSha256', 'compiledSmokeSha256'])
    if (typeof value[key] !== 'string' || !SHA.test(value[key])) runtimeAbFail('immutable-receipt');
  if (
    !Number.isSafeInteger(value.payloadBytes) ||
    value.payloadBytes <= 0 ||
    value.payloadBytes > RUNTIME_AB_LIMITS.payloadBytes
  )
    runtimeAbFail('immutable-receipt');
  return value;
}

export function summarizeComparison(immutable, legs) {
  validateImmutableReceipt(immutable);
  if (!Array.isArray(legs) || legs.length !== 2) runtimeAbFail('legs');
  for (let index = 0; index < 2; index++) {
    const leg = legs[index];
    exactKeys(leg, [
      'leg',
      'status',
      'reason',
      'exitCode',
      'actualRuntime',
      'cleanupVerified',
      'evidenceSha256',
    ]);
    if (
      leg.leg !== RUNTIME_AB_PINS[index].leg ||
      !['passed', 'failed', 'unqualified', 'blocked'].includes(leg.status) ||
      ![
        'completed',
        'smoke-failed',
        'spawn-failed',
        'execution-unavailable',
        'missing-runtime',
        'runtime-mismatch',
        'entry-unverified',
        'backend-unverified',
        'preflight-unqualified',
        'failure-unclassified',
        'security-incompatible',
        'invalid-evidence',
        'immutable-unverified',
        'cleanup-uncertain',
        'blocked-after-a',
      ].includes(leg.reason) ||
      !(
        leg.exitCode === null ||
        (Number.isInteger(leg.exitCode) && leg.exitCode >= 0 && leg.exitCode <= 255)
      ) ||
      typeof leg.cleanupVerified !== 'boolean' ||
      !(
        leg.evidenceSha256 === null ||
        (typeof leg.evidenceSha256 === 'string' && SHA.test(leg.evidenceSha256))
      )
    )
      runtimeAbFail('leg-schema');
    if (leg.actualRuntime !== null) validateComparisonRuntime(leg.leg, leg.actualRuntime);
    if (
      leg.status === 'passed' &&
      (leg.reason !== 'completed' ||
        leg.exitCode !== 0 ||
        !leg.cleanupVerified ||
        !leg.actualRuntime ||
        !leg.evidenceSha256)
    )
      runtimeAbFail('false-pass');
    if (
      leg.status === 'failed' &&
      (leg.reason !== 'smoke-failed' ||
        !leg.cleanupVerified ||
        !leg.actualRuntime ||
        !leg.evidenceSha256)
    )
      runtimeAbFail('leg-schema');
    if (
      leg.status === 'unqualified' &&
      ['completed', 'smoke-failed', 'blocked-after-a'].includes(leg.reason)
    )
      runtimeAbFail('leg-schema');
    if (
      leg.status === 'blocked' &&
      (index !== 1 ||
        leg.reason !== 'blocked-after-a' ||
        leg.exitCode !== null ||
        leg.actualRuntime !== null ||
        leg.cleanupVerified ||
        leg.evidenceSha256 !== null ||
        ![
          'cleanup-uncertain',
          'immutable-unverified',
          'preflight-unqualified',
          'execution-unavailable',
        ].includes(legs[0].reason))
    )
      runtimeAbFail('leg-schema');
  }
  if (legs[1].status !== 'blocked' && !legs[0].cleanupVerified) runtimeAbFail('unclean-transition');
  if (
    ['cleanup-uncertain', 'immutable-unverified', 'preflight-unqualified'].includes(
      legs[0].reason,
    ) &&
    legs[1].status !== 'blocked'
  )
    runtimeAbFail('blocked-transition');
  const result = {
    schema: RUNTIME_AB_SCHEMA,
    nonpublishing: true,
    requiredLaneQualification: false,
    declaredShippedElectron: RUNTIME_AB_DECLARED,
    immutable,
    legs,
    success: legs.every((leg) => leg.status === 'passed'),
    comparisonOnly: true,
    traceEnabled: false,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > RUNTIME_AB_LIMITS.comparisonBytes)
    runtimeAbFail('comparison-size');
  return result;
}

export function validateComparisonSummary(value) {
  exactKeys(value, [
    'schema',
    'nonpublishing',
    'requiredLaneQualification',
    'declaredShippedElectron',
    'immutable',
    'legs',
    'success',
    'comparisonOnly',
    'traceEnabled',
  ]);
  if (JSON.stringify(value) !== JSON.stringify(summarizeComparison(value.immutable, value.legs)))
    runtimeAbFail('comparison-summary');
  return value;
}
