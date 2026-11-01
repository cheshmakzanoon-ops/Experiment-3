import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { lstat, readdir, mkdir, writeFile, copyFile, rm, rename, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  RUNTIME_AB_LEG_SCHEMA,
  RUNTIME_AB_LIMITS,
  RUNTIME_AB_DECLARED,
  comparisonEnvironment,
  runtimeAbFail,
  runtimeAbPin,
  exactKeys,
  validateComparisonRuntime,
  validateComparisonSource,
  validateImmutableReceipt,
  summarizeComparison,
  validateComparisonSummary,
} from './electron-runtime-ab-contract.mjs';
import {
  assertNoSymlinkPath,
  hashRegularFile,
  readRegularJson,
  readBoundedRegularBytes,
  snapshotRegularTree,
} from './electron-runtime-ab-payload.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const JSON_NAMES = ['report.json', 'partial.json', 'preparation.json'];
const PNG_NAMES = [
  'packaged-babylon.png',
  'compatibility-formula.png',
  'compatibility-gp.png',
  'compatibility-mx.png',
  'compatibility-festival.png',
  'failure.png',
];
const PASS_CHECKS = [
  'packaged process architecture matches target',
  'packaged offline Babylon entry started',
  'pause/resume/restart',
  'native keyboard drives the existing simulation',
  'original bundled Formula model imports through the offline protocol',
  'ten source-bound scalar-height materials enabled before presentation',
  'diagnostic panel preserves the central driving view and touch controls',
  'applied authored wheel rotation moves during simulation and freezes during pause',
  'sandbox/context isolation active, Node integration disabled',
  'all four retained disciplines enter, accept real throttle, pause and return in the installed game',
];

/** A plan only: no spawn/exec, native CLI, workflow file or trigger is installed.
 * A future authorized adapter must await the harness child's close event, drain
 * bounded stdout/stderr without exporting arbitrary lines, and not replace any
 * stage timeout. It must report a spawn error separately from an exited child. */
export function unchangedSmokeInvocation(context, leg, inherited, nodeExecutable) {
  const plan = context.legs[leg];
  if (
    !plan ||
    nodeExecutable !== process.execPath ||
    !nodeExecutable.startsWith('/') ||
    resolve(nodeExecutable) !== nodeExecutable
  )
    runtimeAbFail('invocation');
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([join(context.root, 'scripts/desktop-smoke.mjs')]),
    cwd: plan.privateRoot,
    env: comparisonEnvironment(inherited, {
      privateRoot: plan.privateRoot,
      token: plan.ownerToken,
    }),
    shell: false,
    originalStageBudgets: true,
    automaticRetries: 0,
  });
}

export function cleanupIsVerified(value, beforeLaunch = false) {
  try {
    exactKeys(value, [
      'schemaVersion',
      'ok',
      'reason',
      'scanned',
      'owned',
      'signaledTerm',
      'signaledKill',
      'settled',
      'emptyScans',
    ]);
    if (
      value.schemaVersion !== 1 ||
      value.ok !== true ||
      value.reason !== 'quiescent' ||
      value.owned !== 0 ||
      value.emptyScans !== 2
    )
      return false;
    for (const key of ['scanned', 'owned', 'signaledTerm', 'signaledKill', 'settled', 'emptyScans'])
      if (
        !Number.isSafeInteger(value[key]) ||
        value[key] < 0 ||
        value[key] > (key === 'scanned' ? 1000000 : 64)
      )
        return false;
    if (value.signaledKill > value.signaledTerm || value.signaledTerm > value.settled) return false;
    if (beforeLaunch && (value.settled || value.signaledTerm || value.signaledKill)) return false;
    return true;
  } catch {
    return false;
  }
}

export function classifySmokeResult(leg, immutable, execution, report) {
  validateImmutableReceipt(immutable);
  if (execution?.spawned === false)
    return {
      status: 'unqualified',
      reason: report?.runtime ? 'invalid-evidence' : 'spawn-failed',
      actualRuntime: null,
    };
  if (!execution || execution.spawned !== true) {
    let actualRuntime = null;
    try {
      actualRuntime = validateComparisonRuntime(leg, report?.runtime);
    } catch {
      /* Unknown execution is not a claimed runtime observation. */
    }
    return { status: 'unqualified', reason: 'execution-unavailable', actualRuntime };
  }
  if (!report?.runtime)
    return { status: 'unqualified', reason: 'missing-runtime', actualRuntime: null };
  let actualRuntime;
  try {
    actualRuntime = validateComparisonRuntime(leg, report.runtime);
  } catch {
    return { status: 'unqualified', reason: 'runtime-mismatch', actualRuntime: null };
  }
  try {
    validateComparisonSource(report.source);
    if (
      JSON.stringify(report.source) !== JSON.stringify(immutable.source) ||
      report.platform !== 'linux' ||
      report.arch !== 'x64' ||
      report.hostArch !== 'x64' ||
      report.graphicsBackend !== 'mesa' ||
      report.serviceApiLaunch !== undefined ||
      report.gpuTrace?.enabled === true
    )
      runtimeAbFail('report-contract');
    const entryObserved =
      Array.isArray(report.stages) &&
      report.stages.length <= 256 &&
      report.stages.every(
        (stage) =>
          stage &&
          typeof stage.name === 'string' &&
          stage.name.length <= 160 &&
          Number.isSafeInteger(stage.elapsedMs) &&
          stage.elapsedMs >= 0,
      ) &&
      ['electron-connected', 'babylon-ready'].every((name) =>
        report.stages.some((stage) => stage.name === name),
      );
    if (!entryObserved) return { status: 'unqualified', reason: 'entry-unverified', actualRuntime };
    if (
      report.smokeJourney?.requestedJourney !== 'full' ||
      report.smokeJourney.diagnosticOnly !== false ||
      !Array.isArray(report.smokeJourney.omittedChecks) ||
      report.smokeJourney.omittedChecks.length
    )
      runtimeAbFail('report-contract');
    if (report.success !== true) {
      if (report.success !== false) runtimeAbFail('report-contract');
      if (typeof report.renderer !== 'string' || !/llvmpipe/i.test(report.renderer))
        return { status: 'unqualified', reason: 'backend-unverified', actualRuntime };
      if (report.failure === 'Error: Desktop renderer isolation is not active')
        return { status: 'unqualified', reason: 'security-incompatible', actualRuntime };
      const graphicsFaultObserved =
        (typeof report.firstGraphicsFault === 'string' &&
          report.firstGraphicsFault.length > 0 &&
          report.firstGraphicsFault.length <= 4096) ||
        (Array.isArray(report.graphicsFaults) &&
          report.graphicsFaults.some((fault) => typeof fault === 'string' && fault.length > 0)) ||
        (Number.isSafeInteger(report.contextLosses) && report.contextLosses > 0);
      // Protocol/JS error text does not diagnose API incompatibility: target
      // closure after a recorded GPU fault can produce the very same text.
      if (
        !graphicsFaultObserved &&
        typeof report.failure === 'string' &&
        /TypeError|ReferenceError|Protocol error|is not a function|method .*wasn't found/.test(
          report.failure,
        )
      )
        return { status: 'unqualified', reason: 'failure-unclassified', actualRuntime };
    }
    if (report.success !== true || execution.exitCode !== 0 || execution.signal !== null)
      return { status: 'failed', reason: 'smoke-failed', actualRuntime };
    if (
      !Array.isArray(report.checks) ||
      report.checks.some((check) => typeof check !== 'string') ||
      !PASS_CHECKS.every((check) => report.checks.includes(check)) ||
      typeof report.renderer !== 'string' ||
      !/llvmpipe/i.test(report.renderer) ||
      report.gpuTrace?.enabled !== false ||
      report.contextLosses !== 0 ||
      report.firstGraphicsFault !== null ||
      ['errors', 'remoteRequests', 'assetFailures', 'graphicsFaults'].some(
        (key) => !Array.isArray(report[key]) || report[key].length,
      ) ||
      !Array.isArray(report.compatibility) ||
      report.compatibility.length !== 4 ||
      report.compatibility.some(
        (item, index) =>
          item.discipline !== ['formula', 'gp', 'mx', 'festival'][index] ||
          !['ready', 'driving', 'paused', 'resumed', 'pausedAgain', 'returned'].every(
            (key) =>
              item[key] &&
              typeof item[key] === 'object' &&
              !Array.isArray(item[key]) &&
              item[key].failure === null,
          ) ||
          !Number.isSafeInteger(item.completedAt) ||
          item.completedAt < 0,
      )
    )
      runtimeAbFail('report-contract');
    return { status: 'passed', reason: 'completed', actualRuntime };
  } catch {
    return { status: 'unqualified', reason: 'invalid-evidence', actualRuntime };
  }
}

/** Fixed collection only. The original smoke JSON is retained inside a clearly
 * distinct comparison envelope, never as a normal report.json. Its original
 * bounded console/processLog arrays remain inside that envelope. No separate
 * raw-log/trace files, profiles, caches, archives, executables or arbitrary
 * filenames are exported. */
export async function collectComparisonEvidence(context, leg, execution) {
  const root = join(context.legs[leg].privateRoot, 'desktop-evidence');
  try {
    await assertNoSymlinkPath(root);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const available = await readdir(root).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (available.length && (await lstat(root)).isSymbolicLink()) runtimeAbFail('evidence-symlink');
  if (available.some((name) => ![...JSON_NAMES, ...PNG_NAMES].includes(name)))
    runtimeAbFail('evidence-name');
  let bytes = 0;
  const smoke = {};
  const images = [];
  for (const name of available.sort()) {
    const path = join(root, name);
    const identity = await hashRegularFile(path, RUNTIME_AB_LIMITS.reportBytes);
    bytes += identity.bytes;
    if (bytes > RUNTIME_AB_LIMITS.legEvidenceBytes) runtimeAbFail('evidence-size');
    if (JSON_NAMES.includes(name))
      smoke[name.slice(0, -5)] = (await readRegularJson(path, RUNTIME_AB_LIMITS.reportBytes)).value;
    else {
      {
        const image = await readBoundedRegularBytes(path, RUNTIME_AB_LIMITS.reportBytes);
        const imageBytes = image.bytes;
        const header = imageBytes.subarray(0, 24);
        if (
          image.dev !== identity.dev ||
          image.ino !== identity.ino ||
          imageBytes.length !== identity.bytes ||
          sha(imageBytes) !== identity.sha256 ||
          header.length !== 24 ||
          header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          header.toString('ascii', 12, 16) !== 'IHDR' ||
          !header.readUInt32BE(16) ||
          !header.readUInt32BE(20) ||
          header.readUInt32BE(16) > 16384 ||
          header.readUInt32BE(20) > 16384
        )
          runtimeAbFail('png');
        if (['A', 'B'].some((other) => imageBytes.includes(context.legs[other].ownerToken)))
          runtimeAbFail('evidence-sensitive');
      }
      images.push({ name, sha256: identity.sha256, bytes: identity.bytes });
    }
  }
  const classification = classifySmokeResult(
    leg,
    context.immutable,
    execution,
    smoke.report ?? smoke.partial,
  );
  if (
    classification.status === 'passed' &&
    !PNG_NAMES.slice(0, 5).every((name) => images.some((image) => image.name === name))
  )
    runtimeAbFail('missing-images');
  const envelope = {
    schema: RUNTIME_AB_LEG_SCHEMA,
    nonpublishing: true,
    requiredLaneQualification: false,
    leg,
    declaredShippedElectron: RUNTIME_AB_DECLARED,
    expectedRuntime: runtimeAbPin(leg),
    actualRuntime: classification.actualRuntime,
    immutable: context.immutable,
    execution,
    classification,
    images,
    smoke,
  };
  const encoded = Buffer.from(JSON.stringify(envelope) + '\n');
  if (['A', 'B'].some((other) => encoded.includes(context.legs[other].ownerToken)))
    runtimeAbFail('evidence-sensitive');
  if (
    encoded.length + images.reduce((total, image) => total + image.bytes, 0) >
    RUNTIME_AB_LIMITS.legEvidenceBytes
  )
    runtimeAbFail('evidence-size');
  return { classification, envelope, encoded, sha256: sha(encoded), images };
}

export async function assertFreshComparisonLeg(context, leg) {
  const root = context.legs[leg].privateRoot;
  await assertNoSymlinkPath(root);
  try {
    await lstat(join(root, 'desktop-evidence'));
    runtimeAbFail('stale-evidence');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ['tmp', 'home', 'cache', 'config', 'data']) {
    const path = join(root, name);
    await assertNoSymlinkPath(path);
    const identity = await lstat(path, { bigint: true });
    if (
      String(identity.dev) !== context.legs[leg].stateDirectories[name]?.dev ||
      String(identity.ino) !== context.legs[leg].stateDirectories[name]?.ino
    )
      runtimeAbFail('private-state');
    if ((await readdir(path)).length) runtimeAbFail('stale-profile');
  }
}

/** Delete only the five freshly owned private state directories, after exact
 * process closure. A failed pre-release disposer is not a successful cleanup.
 * No retry, broad /tmp scan, host cache clear or global profile removal exists. */
export async function removeComparisonPrivateState(context, leg, cleanup) {
  if (!cleanupIsVerified(cleanup)) runtimeAbFail('cleanup-uncertain');
  const root = context.legs[leg].privateRoot;
  await assertNoSymlinkPath(root);
  for (const name of ['tmp', 'home', 'cache', 'config', 'data']) {
    const path = join(root, name);
    const info = await lstat(path, { bigint: true });
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== BigInt(process.getuid()) ||
      String(info.dev) !== context.legs[leg].stateDirectories[name]?.dev ||
      String(info.ino) !== context.legs[leg].stateDirectories[name]?.ino
    )
      runtimeAbFail('private-state');
    // Chromium may create lock symlinks in its own profile. rm unlinks symlinks;
    // it does not follow them. The directory roots must remain owned originals.
    await rm(path, { recursive: true, force: false, maxRetries: 0 });
    try {
      await lstat(path);
      runtimeAbFail('private-state');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

/** Explicit adapters keep this engineering checkpoint inert. No default spawn
 * adapter or native CLI is supplied. Every leg receives the unchanged smoke
 * invocation; an A failure never short-circuits B if cleanup and inputs qualify.
 * Conversely, uncertain closure/source mutation blocks B, never "best effort". */
export async function runRuntimeComparison({ immutable, adapters }) {
  validateImmutableReceipt(immutable);
  for (const name of [
    'verifyImmutable',
    'assertFresh',
    'verifyEmpty',
    'execute',
    'cleanup',
    'collect',
    'removePrivateState',
  ])
    if (typeof adapters?.[name] !== 'function') runtimeAbFail('adapter');
  const results = [];
  const retained = [];
  let blocked = false;
  for (const leg of ['A', 'B']) {
    const result = {
      leg,
      status: 'blocked',
      reason: 'blocked-after-a',
      exitCode: null,
      actualRuntime: null,
      cleanupVerified: false,
      evidenceSha256: null,
    };
    if (blocked) {
      results.push(result);
      continue;
    }
    let execution = { spawned: null, exitCode: null, signal: null };
    let started = false;
    let phase = 'immutable';
    try {
      if ((await adapters.verifyImmutable()) !== true) runtimeAbFail('immutable-unverified');
      phase = 'preflight';
      await adapters.assertFresh(leg);
      if (!cleanupIsVerified(await adapters.verifyEmpty(leg), true))
        runtimeAbFail('cleanup-uncertain');
      started = true;
      phase = 'execution';
      try {
        execution = await adapters.execute(leg);
      } catch {
        // A rejected adapter may have thrown after spawning. Only an explicit
        // positive adapter receipt can establish that no child started.
        execution = { spawned: null, exitCode: null, signal: null };
      }
      exactKeys(execution, ['spawned', 'exitCode', 'signal']);
      if (
        !(execution.spawned === null || typeof execution.spawned === 'boolean') ||
        (execution.spawned !== true &&
          (execution.exitCode !== null || execution.signal !== null)) ||
        !(
          execution.exitCode === null ||
          (Number.isInteger(execution.exitCode) &&
            execution.exitCode >= 0 &&
            execution.exitCode <= 255)
        ) ||
        !(
          execution.signal === null ||
          ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'SIGILL'].includes(
            execution.signal,
          )
        )
      )
        runtimeAbFail('execution');
      result.exitCode = execution.exitCode;
      let cleanup;
      try {
        cleanup = await adapters.cleanup(leg);
      } catch {
        cleanup = null;
      }
      if (!cleanupIsVerified(cleanup)) {
        result.status = 'unqualified';
        result.reason = 'cleanup-uncertain';
        blocked = true;
      } else {
        try {
          await adapters.removePrivateState(leg, cleanup);
          result.cleanupVerified = true;
        } catch {
          result.status = 'unqualified';
          result.reason = 'cleanup-uncertain';
          blocked = true;
        }
      }
      try {
        if ((await adapters.verifyImmutable()) !== true) runtimeAbFail('immutable-unverified');
      } catch {
        result.status = 'unqualified';
        result.reason = 'immutable-unverified';
        blocked = true;
      }
      try {
        const evidence = await adapters.collect(leg, execution);
        if (!blocked) Object.assign(result, evidence.classification);
        else result.actualRuntime = evidence.classification.actualRuntime;
        if (typeof evidence.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.sha256))
          runtimeAbFail('evidence-hash');
        result.evidenceSha256 = evidence.sha256;
        retained.push(evidence);
      } catch {
        if (!blocked) {
          result.status = 'unqualified';
          result.reason = 'invalid-evidence';
        }
      }
    } catch (error) {
      result.status = 'unqualified';
      result.reason =
        error?.code === 'cleanup-uncertain'
          ? 'cleanup-uncertain'
          : phase === 'immutable'
            ? 'immutable-unverified'
            : phase === 'preflight'
              ? 'preflight-unqualified'
              : 'execution-unavailable';
      blocked = true;
      // Validation exceptions after a spawn still require the same bounded
      // owned cleanup attempt; no profiles are removed on uncertain closure.
      if (started && !result.cleanupVerified) {
        try {
          const cleanup = await adapters.cleanup(leg);
          if (cleanupIsVerified(cleanup)) {
            await adapters.removePrivateState(leg, cleanup);
            result.cleanupVerified = true;
          }
        } catch {
          /* The primary unqualified result is retained. */
        }
      }
    }
    results.push(result);
  }
  return { summary: summarizeComparison(immutable, results), retained };
}

/** Validate a canonical, distinct envelope before it reaches an upload folder.
 * A bare native report or swapped adapter object is never an acceptable item. */
export function validateComparisonEnvelope(item, immutable, leg) {
  if (
    !Buffer.isBuffer(item?.encoded) ||
    item.encoded.length > RUNTIME_AB_LIMITS.legEvidenceBytes ||
    typeof item.sha256 !== 'string' ||
    sha(item.encoded) !== item.sha256
  )
    runtimeAbFail('export-evidence');
  let value;
  try {
    value = JSON.parse(item.encoded.toString('utf8'));
  } catch {
    runtimeAbFail('export-evidence');
  }
  exactKeys(
    value,
    [
      'schema',
      'nonpublishing',
      'requiredLaneQualification',
      'leg',
      'declaredShippedElectron',
      'expectedRuntime',
      'actualRuntime',
      'immutable',
      'execution',
      'classification',
      'images',
      'smoke',
    ],
    'export-envelope',
  );
  if (
    value.schema !== RUNTIME_AB_LEG_SCHEMA ||
    value.nonpublishing !== true ||
    value.requiredLaneQualification !== false ||
    value.leg !== leg ||
    value.declaredShippedElectron !== RUNTIME_AB_DECLARED ||
    JSON.stringify(value.expectedRuntime) !== JSON.stringify(runtimeAbPin(leg)) ||
    JSON.stringify(value.immutable) !== JSON.stringify(immutable) ||
    JSON.stringify(value) !== JSON.stringify(item.envelope) ||
    !item.encoded.equals(Buffer.from(JSON.stringify(value) + '\n'))
  )
    runtimeAbFail('export-envelope');
  exactKeys(value.execution, ['spawned', 'exitCode', 'signal']);
  if (
    !(value.execution.spawned === null || typeof value.execution.spawned === 'boolean') ||
    (value.execution.spawned !== true &&
      (value.execution.exitCode !== null || value.execution.signal !== null)) ||
    !(
      value.execution.exitCode === null ||
      (Number.isInteger(value.execution.exitCode) &&
        value.execution.exitCode >= 0 &&
        value.execution.exitCode <= 255)
    ) ||
    !(
      value.execution.signal === null ||
      ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'SIGILL'].includes(
        value.execution.signal,
      )
    )
  )
    runtimeAbFail('export-execution');
  if (
    !value.smoke ||
    typeof value.smoke !== 'object' ||
    Array.isArray(value.smoke) ||
    Object.keys(value.smoke).some((name) => !['report', 'partial', 'preparation'].includes(name))
  )
    runtimeAbFail('export-smoke');
  for (const name of ['report', 'partial'])
    if (value.smoke[name] !== undefined) {
      const report = value.smoke[name];
      if (
        !report ||
        typeof report !== 'object' ||
        Array.isArray(report) ||
        JSON.stringify(report.source) !== JSON.stringify(immutable.source) ||
        report.serviceApiLaunch !== undefined ||
        report.gpuTrace?.enabled === true
      )
        runtimeAbFail('export-smoke');
    }
  const classification = classifySmokeResult(
    leg,
    immutable,
    value.execution,
    value.smoke.report ?? value.smoke.partial,
  );
  if (
    JSON.stringify(value.classification) !== JSON.stringify(classification) ||
    JSON.stringify(value.actualRuntime) !== JSON.stringify(classification.actualRuntime) ||
    JSON.stringify(item.classification) !== JSON.stringify(classification)
  )
    runtimeAbFail('export-classification');
  if (
    !Array.isArray(value.images) ||
    value.images.length > PNG_NAMES.length ||
    JSON.stringify(value.images) !== JSON.stringify(item.images)
  )
    runtimeAbFail('export-images');
  const names = new Set();
  let bytes = item.encoded.length;
  for (const image of value.images) {
    exactKeys(image, ['name', 'sha256', 'bytes']);
    if (
      !PNG_NAMES.includes(image.name) ||
      names.has(image.name) ||
      typeof image.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(image.sha256) ||
      !Number.isSafeInteger(image.bytes) ||
      image.bytes < 24 ||
      image.bytes > RUNTIME_AB_LIMITS.reportBytes
    )
      runtimeAbFail('export-images');
    names.add(image.name);
    bytes += image.bytes;
  }
  if (
    bytes > RUNTIME_AB_LIMITS.legEvidenceBytes ||
    (classification.status === 'passed' && !PNG_NAMES.slice(0, 5).every((name) => names.has(name)))
  )
    runtimeAbFail('export-size');
  return value;
}

/** The final folder is handed off atomically, with its summary written last.
 * Only this fixed folder may be uploaded, never the private staging/run roots. */
export async function exportComparisonEvidence(context, outcome, destination) {
  validateComparisonSummary(outcome.summary);
  if (
    JSON.stringify(outcome.summary.immutable) !== JSON.stringify(context.immutable) ||
    !Array.isArray(outcome.retained) ||
    outcome.retained.length > 2
  )
    runtimeAbFail('export-summary');
  const expected = outcome.summary.legs.filter((leg) => leg.evidenceSha256 !== null);
  if (expected.length !== outcome.retained.length) runtimeAbFail('export-retained-set');
  const seen = new Set();
  for (const item of outcome.retained) {
    const leg = item.envelope?.leg;
    const commitment = expected.find((entry) => entry.leg === leg);
    if (!commitment || seen.has(leg) || commitment.evidenceSha256 !== item.sha256)
      runtimeAbFail('export-commitment');
    seen.add(leg);
    const envelope = validateComparisonEnvelope(item, context.immutable, leg);
    const primaryOverride =
      commitment.status === 'unqualified' &&
      ['cleanup-uncertain', 'immutable-unverified'].includes(commitment.reason);
    if (
      commitment.exitCode !== envelope.execution.exitCode ||
      JSON.stringify(commitment.actualRuntime) !== JSON.stringify(envelope.actualRuntime) ||
      (!primaryOverride &&
        (commitment.status !== envelope.classification.status ||
          commitment.reason !== envelope.classification.reason))
    )
      runtimeAbFail('export-outcome');
    if (['A', 'B'].some((other) => item.encoded.includes(context.legs[other].ownerToken)))
      runtimeAbFail('evidence-sensitive');
  }
  if (resolve(destination) !== destination) runtimeAbFail('export-path');
  const parent = resolve(destination, '..');
  await assertNoSymlinkPath(parent);
  await mkdir(destination, { mode: 0o700 }); // exclusive reservation, never overwrite stale output
  const reservation = await lstat(destination, { bigint: true });
  const staging = join(parent, `.runtime-ab-export-${randomBytes(16).toString('hex')}`);
  await mkdir(staging, { mode: 0o700 });
  const staged = await lstat(staging, { bigint: true });
  let committed = false;
  try {
    for (const item of outcome.retained) {
      const leg = item.envelope.leg;
      await writeFile(join(staging, `${leg}-comparison-evidence.json`), item.encoded, {
        flag: 'wx',
        mode: 0o600,
      });
      for (const image of item.images) {
        const source = join(context.legs[leg].privateRoot, 'desktop-evidence', image.name);
        await assertNoSymlinkPath(source);
        const before = await readBoundedRegularBytes(source, RUNTIME_AB_LIMITS.reportBytes);
        if (before.sha256 !== image.sha256 || before.bytes.length !== image.bytes)
          runtimeAbFail('evidence-mutated');
        const header = before.bytes.subarray(0, 24);
        if (
          header.length !== 24 ||
          header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          header.toString('ascii', 12, 16) !== 'IHDR' ||
          !header.readUInt32BE(16) ||
          !header.readUInt32BE(20) ||
          header.readUInt32BE(16) > 16384 ||
          header.readUInt32BE(20) > 16384 ||
          ['A', 'B'].some((other) => before.bytes.includes(context.legs[other].ownerToken))
        )
          runtimeAbFail('export-image');
        const output = join(staging, `${leg}-${image.name}`);
        await copyFile(source, output, constants.COPYFILE_EXCL);
        if ((await hashRegularFile(output, RUNTIME_AB_LIMITS.reportBytes)).sha256 !== image.sha256)
          runtimeAbFail('evidence-mutated');
      }
    }
    await writeFile(
      join(staging, 'runtime-comparison.json'),
      JSON.stringify(outcome.summary, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const exported = await snapshotRegularTree(staging);
    if (exported.bytes > 2 * RUNTIME_AB_LIMITS.legEvidenceBytes + RUNTIME_AB_LIMITS.comparisonBytes)
      runtimeAbFail('export-size');
    const current = await lstat(destination, { bigint: true });
    if (
      current.dev !== reservation.dev ||
      current.ino !== reservation.ino ||
      (await readdir(destination)).length
    )
      runtimeAbFail('export-reservation');
    await rename(staging, destination);
    committed = true;
    return { bytes: exported.bytes, files: exported.files.length, sha256: exported.sha256 };
  } finally {
    if (!committed) {
      try {
        const current = await lstat(staging, { bigint: true });
        if (current.dev === staged.dev && current.ino === staged.ino)
          await rm(staging, { recursive: true, force: false, maxRetries: 0 });
      } catch {
        /* Failed private cleanup cannot create a committed final folder. */
      }
      try {
        const current = await lstat(destination, { bigint: true });
        if (
          current.dev === reservation.dev &&
          current.ino === reservation.ino &&
          !(await readdir(destination)).length
        )
          await rmdir(destination);
      } catch {
        /* Never remove a replaced/nonempty destination. */
      }
    }
  }
}
