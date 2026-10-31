import { createReadStream } from 'node:fs';
import { stat, lstat, rm, readFile, writeFile, mkdtemp, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summarizeNativeGpuTrace,
  validateNativeGpuTraceSummary,
  NATIVE_TRACE_PROCESSOR,
  NativeGpuTraceSummaryError,
} from './native-gpu-trace-summary.mjs';
import { validateNativeGpuServiceApiSummary } from './native-gpu-service-api-summary.mjs';
import { nativeGpuServiceApiMode } from './native-gpu-service-api-mode.mjs';

export const NATIVE_GPU_TRACE = Object.freeze({
  bufferKiB: 16384,
  scope: 'unchanged-babylon-inspect-through-authored-wheel-check-or-first-gpu-fault',
  maxFileBytes: 64 * 1024 * 1024,
  setupMs: 5000,
  stopMs: 5000,
  categoryInventory: Object.freeze({ maxGroups: 4096, maxGroupCharacters: 512, maxBytes: 16384 }),
  categories: Object.freeze([
    'gpu',
    'gpu.service',
    'gpu.angle',
    'viz',
    'toplevel',
    'disabled-by-default-gpu.service',
    'disabled-by-default-gpu.device',
    'disabled-by-default-gpu.debug',
    'disabled-by-default-angle',
  ]),
});

export function nativeGpuTraceEnabled(value = '0') {
  if (value !== '0' && value !== '1') throw new Error(`Unknown native GPU trace mode: ${value}`);
  return value === '1';
}

/** Discovery is evidence, not support certification. No arbitrary discovered
 * strings leave the private capture path; only fixed allowlist matches do. */
export function nativeGpuTraceCategoryInventory(available) {
  const limits = NATIVE_GPU_TRACE.categoryInventory;
  const array = Array.isArray(available);
  const reportedGroups = array ? available.length : null;
  const scannedGroups = array ? Math.min(available.length, limits.maxGroups) : 0;
  let malformedGroups = 0,
    oversizedGroups = 0;
  const matches = new Set();
  for (let index = 0; index < scannedGroups; index++) {
    const group = available[index];
    if (typeof group !== 'string') {
      malformedGroups++;
      continue;
    }
    if (group.length > limits.maxGroupCharacters) {
      oversizedGroups++;
      continue;
    }
    for (const name of group.split(','))
      if (NATIVE_GPU_TRACE.categories.includes(name.trim())) matches.add(name.trim());
  }
  return {
    input: array ? 'array' : 'not-array',
    reportedGroups,
    scannedGroups,
    omittedGroups: array ? reportedGroups - scannedGroups : null,
    malformedGroups,
    oversizedGroups,
    truncated: array && reportedGroups > scannedGroups,
    limits,
    matchedCategories: NATIVE_GPU_TRACE.categories.filter((name) => matches.has(name)),
  };
}

export function nativeGpuTraceCategories(available) {
  if (!Array.isArray(available) || available.length > 4096)
    throw new Error('Invalid native trace category inventory');
  for (const group of available)
    if (typeof group !== 'string' || group.length > 512)
      throw new Error('Invalid native trace category group');
  // Pinned Electron/Chromium accepts explicit filters independently of discovery.
  // This requests the same fixed names, never claims they were discovered.
  return [...NATIVE_GPU_TRACE.categories];
}

function bounded(operation, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Only validated sanitized bytes enter the evidence directory. Write a
 * private temporary sibling and atomically rename on success; an aborted write
 * removes both its temporary and any prior output, never accepts stale data. */
export async function retainNativeGpuTraceSummary({
  summary,
  source,
  outputPath,
  signal,
  writeSummary = writeFile,
  serviceApiMode = 'off',
}) {
  let directory,
    retained = false;
  try {
    if (nativeGpuServiceApiMode(serviceApiMode) === 'service-api-boundary-v1')
      validateNativeGpuServiceApiSummary(summary);
    else validateNativeGpuTraceSummary(summary);
    const document = { source, summary };
    const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
    if (bytes.length > NATIVE_TRACE_PROCESSOR.maxSummaryBytes)
      throw new Error('Native GPU trace summary exceeds its bound');
    await rm(outputPath, { force: true });
    signal.throwIfAborted();
    directory = await mkdtemp(join(dirname(outputPath), '.gpu-summary-'));
    signal.throwIfAborted();
    const temporary = join(directory, 'sanitized.json');
    await writeSummary(temporary, bytes, { mode: 0o600, flag: 'wx', signal });
    signal.throwIfAborted();
    await rename(temporary, outputPath);
    signal.throwIfAborted();
    retained = true;
    return {
      file: basename(outputPath),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      retained: true,
      rawTraceUploaded: false,
      captureValid: true,
      parsed: true,
      gpuWorkObserved: summary.coverage === 'typed-gpu-work-observed',
    };
  } finally {
    if (!retained) await rm(outputPath, { force: true }).catch(() => {});
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function inspectTrace(
  path,
  outputPath,
  parserPath,
  source,
  budgetMs,
  signal,
  serviceApiMode,
) {
  const summary = await summarizeNativeGpuTrace({
    path,
    parserPath,
    deadlineMs: budgetMs,
    signal,
    serviceApiMode,
  });
  return retainNativeGpuTraceSummary({ summary, source, outputPath, signal, serviceApiMode });
}

/** Harness-only recorder. No app bridge, GL/render hooks, priming or action
 * cancellation. Trace errors never replace the unchanged operation's error.
 * An acknowledged flush is not proof that a crashed child retained its tail. */
export function createNativeGpuTrace({
  enabled,
  source,
  adapter,
  firstFault,
  onOperationFailure,
  path,
  outputPath = `${path}.summary.json`,
  parserPath,
  now = Date.now,
  setupMs = NATIVE_GPU_TRACE.setupMs,
  stopMs = NATIVE_GPU_TRACE.stopMs,
  inspect,
  serviceApiMode = 'off',
}) {
  const serviceApi = nativeGpuServiceApiMode(serviceApiMode) === 'service-api-boundary-v1';
  if (serviceApi && !enabled) throw new Error('Service API tracing requires private GPU tracing');
  const receipt = {
    version: 1,
    enabled,
    diagnosticOnly: enabled,
    ...(serviceApi ? { serviceApiMode } : {}),
    scope: NATIVE_GPU_TRACE.scope,
    omittedGameplayChecks: [],
    source: Object.fromEntries(
      ['commit', 'fingerprint', 'electron'].map((key) => [
        key,
        String(source?.[key] ?? '').slice(0, 128),
      ]),
    ),
    status: enabled ? 'not-started' : 'disabled',
    format: 'private-perfetto-numeric-summary',
    rawTraceUploaded: false,
    categoryPolicy: 'fixed-allowlist-requested-not-discovered',
    config: null,
    setupBudgetMs: setupMs,
    stopBudgetMs: stopMs,
    maxFileBytes: NATIVE_GPU_TRACE.maxFileBytes,
    completeness: 'not-recorded',
    errors: [],
  };
  let used = false;
  const inspections = new Map();
  let cleanupStarted = false;
  const error = (value) => {
    if (receipt.errors.length < 4) receipt.errors.push(String(value).slice(0, 2048));
  };
  return {
    receipt,
    cleanup({ producerClosed = false } = {}) {
      cleanupStarted = true;
      for (const controller of inspections.values()) controller.abort();
      const cleanup = {
        producerClosed,
        pendingInspections: inspections.size,
        rawDeletion: !enabled
          ? 'not-applicable'
          : !producerClosed
            ? 'producer-unconfirmed'
            : inspections.size
              ? 'deferred-inspection-settlement'
              : 'scheduled',
      };
      receipt.cleanup = cleanup;
      // Do not await a stuck inspection/OS operation indefinitely. Its streams
      // and child are aborted, but staging remains until the child closes.
      // A rejected Electron close is never treated as producer termination.
      if (enabled && producerClosed) {
        void Promise.allSettled([...inspections.keys()])
          .then(() => rm(path, { force: true }))
          .then(
            () => {
              cleanup.rawDeletion = 'removed';
            },
            () => {
              cleanup.rawDeletion = 'private-cleanup-failed';
            },
          );
      }
      return { ...cleanup };
    },
    finalize() {
      const fault = firstFault.read()?.message ?? null;
      receipt.finalGraphicsFault = fault;
      receipt.fatalCoverage = !fault
        ? 'no-observed-graphics-fault'
        : receipt.graphicsFaultAtWindowClose
          ? 'observed-during-trace-window'
          : receipt.completeness === 'window-flushed-child-tail-not-certified'
            ? 'observed-after-trace-window-not-explained-by-this-capture'
            : 'trace-window-unavailable-or-uncertain';
    },
    async run(operation) {
      if (!enabled) return operation();
      if (used) throw new Error('Native GPU trace owner already consumed');
      used = true;
      let startSubmitted = false,
        startAcknowledged = false,
        closing = false,
        stopped,
        finishWatch;
      const stop = (reason, lateStart = false) => {
        if (stopped && !lateStart) return stopped;
        const priorStop = stopped;
        closing = true;
        receipt.stopReason ??= reason;
        if (!('stopRequestedAt' in receipt)) {
          receipt.stopRequestedAt = now();
          receipt.graphicsFaultAtWindowClose = firstFault.read()?.message ?? null;
        }
        if (lateStart) receipt.lateStartCleanup = true;
        stopped = (async () => {
          if (lateStart && priorStop) await priorStop;
          if (!startSubmitted) return;
          try {
            await bounded(() => adapter.stop(path), stopMs, 'Native GPU trace stop');
            receipt.stopAcknowledgedAt = now();
            // Inspection is also bounded: a filesystem/stream problem is only
            // missing diagnostic evidence, never a new gameplay failure.
            if (cleanupStarted) return;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), stopMs);
            const inspection = Promise.resolve().then(() =>
              inspect
                ? inspect(path, outputPath, controller.signal)
                : inspectTrace(
                    path,
                    outputPath,
                    parserPath,
                    receipt.source,
                    stopMs,
                    controller.signal,
                    serviceApiMode,
                  ),
            );
            inspections.set(inspection, controller);
            const settled = (failure) => {
              clearTimeout(timer);
              inspections.delete(inspection);
              if (
                failure instanceof NativeGpuTraceSummaryError &&
                failure.parserExitStatus !== null
              )
                receipt.parserExitStatus = failure.parserExitStatus;
            };
            inspection.then(settled, settled);
            receipt.output = await bounded(() => inspection, stopMs, 'Native GPU trace file');
            receipt.status = receipt.output.retained ? 'recorded' : 'incomplete';
            if (receipt.output.parsed) receipt.parserExitStatus = 0;
            receipt.completeness =
              startAcknowledged && !lateStart && !firstFault.read() && receipt.output.retained
                ? 'window-flushed-child-tail-not-certified'
                : 'partial-or-uncertain';
          } catch (failure) {
            if (failure instanceof NativeGpuTraceSummaryError && failure.parserExitStatus !== null)
              receipt.parserExitStatus = failure.parserExitStatus;
            // Native/parser error text may contain private paths or trace data.
            error(
              failure instanceof NativeGpuTraceSummaryError
                ? failure.message
                : 'Native GPU trace stop or inspection failed',
            );
            receipt.status = 'incomplete';
            receipt.completeness = 'partial-or-uncertain';
          }
        })();
        return stopped;
      };
      try {
        const available = await bounded(
          () => adapter.categories(),
          setupMs,
          'Native GPU trace categories',
        );
        receipt.categoryInventory = nativeGpuTraceCategoryInventory(available);
        receipt.config = {
          included_categories: nativeGpuTraceCategories(available),
          recording_mode: 'record-continuously',
          trace_buffer_size_in_kb: NATIVE_GPU_TRACE.bufferKiB,
          enable_argument_filter: true,
        };
        receipt.startRequestedAt = now();
        startSubmitted = true;
        const starting = Promise.resolve().then(() => adapter.start(receipt.config));
        // A timed-out start is not a cancelled native operation. If its ack
        // arrives later, close again and explicitly mark the window uncertain.
        starting.then(
          () => {
            startAcknowledged = true;
            receipt.startAcknowledgedAt = now();
            if (closing) void stop('late-start', true);
          },
          () => {},
        );
        await bounded(() => starting, setupMs, 'Native GPU trace start');
        receipt.status = 'recording';
      } catch {
        error('Native GPU trace setup failed');
        receipt.status = 'incomplete';
        receipt.completeness = 'partial-or-uncertain';
        await stop('setup-failed');
      }
      // This watcher observes the existing sticky fault without racing or
      // cancelling the original authored-model operation. Explicit settlement
      // removes its per-wait listener even when no GPU fault occurs.
      const watch = firstFault
        .wait(() => new Promise((resolve) => (finishWatch = resolve)))
        .catch(() => stop('first-graphics-fault'));
      try {
        return await operation();
      } catch (failure) {
        // Snapshot with the harness's existing precedence before cleanup can
        // delay its outer catch and a *later* GPU fault can arrive. This hook
        // is diagnostic-only and must never replace the operation's error.
        try {
          onOperationFailure?.(failure);
        } catch {
          error('Native GPU trace failure snapshot failed');
        }
        throw failure;
      } finally {
        finishWatch?.();
        await stop('authored-model-operation-ended');
        await watch;
      }
    },
  };
}

/** Separate trace-only evidence gate; required gameplay assertions do not use
 * this. A crashed child may have lost its tail even when a useful bounded file
 * was retained, so partial/uncertain completeness is explicitly accepted. */
export async function validateNativeGpuTraceEvidence(report, directory) {
  const receipt = report?.gpuTrace;
  const output = receipt?.output;
  const serviceApiMode = nativeGpuServiceApiMode(receipt?.serviceApiMode ?? 'off');
  const serviceApi = serviceApiMode === 'service-api-boundary-v1';
  if (serviceApi) {
    const launch = report?.serviceApiLaunch;
    const expected = {
      mode: 'service-api-boundary-v1',
      argument: '--enable-gpu-service-tracing',
      platform: 'linux',
      arch: 'x64',
      graphicsBackend: 'mesa',
      journey: 'full',
      manualNonpublishing: true,
    };
    if (
      !launch ||
      typeof launch !== 'object' ||
      Array.isArray(launch) ||
      Object.keys(launch).sort().join(',') !== Object.keys(expected).sort().join(',') ||
      Object.entries(expected).some(([key, value]) => launch[key] !== value) ||
      report?.source?.electron !== '45.2.1' ||
      report?.runtime?.electron !== '45.2.1' ||
      report?.runtime?.chromium !== '156.0.8078.75' ||
      report?.runtime?.platform !== 'linux' ||
      report?.runtime?.arch !== 'x64' ||
      report?.platform !== 'linux' ||
      report?.arch !== 'x64' ||
      report?.hostArch !== 'x64' ||
      report?.graphicsBackend !== 'mesa' ||
      report?.smokeJourney?.requestedJourney !== 'full' ||
      report?.smokeJourney?.diagnosticOnly !== false ||
      !Array.isArray(report?.smokeJourney?.omittedChecks) ||
      report.smokeJourney.omittedChecks.length !== 0 ||
      receipt.version !== 1
    )
      throw new Error('Invalid service API diagnostic launch receipt');
  } else if (report?.serviceApiLaunch !== undefined || receipt?.serviceApiMode !== undefined) {
    throw new Error('Unexpected service API diagnostic receipt');
  }
  if (
    receipt?.enabled !== true ||
    receipt.diagnosticOnly !== true ||
    receipt.status !== 'recorded' ||
    receipt.format !== 'private-perfetto-numeric-summary' ||
    receipt.rawTraceUploaded !== false ||
    receipt.categoryPolicy !== 'fixed-allowlist-requested-not-discovered' ||
    receipt.scope !== NATIVE_GPU_TRACE.scope ||
    !Array.isArray(receipt.omittedGameplayChecks) ||
    receipt.omittedGameplayChecks.length !== 0 ||
    !receipt.config ||
    Object.keys(receipt.config).sort().join(',') !==
      'enable_argument_filter,included_categories,recording_mode,trace_buffer_size_in_kb' ||
    receipt.config.recording_mode !== 'record-continuously' ||
    receipt.config.trace_buffer_size_in_kb !== NATIVE_GPU_TRACE.bufferKiB ||
    receipt.config.enable_argument_filter !== true ||
    !Array.isArray(receipt.config.included_categories) ||
    receipt.config.included_categories.length !== NATIVE_GPU_TRACE.categories.length ||
    NATIVE_GPU_TRACE.categories.some(
      (name, index) => receipt.config.included_categories[index] !== name,
    ) ||
    output?.retained !== true ||
    Object.keys(output).sort().join(',') !==
      'bytes,captureValid,file,gpuWorkObserved,parsed,rawTraceUploaded,retained,sha256' ||
    output.file !== 'gpu-trace-summary.json' ||
    output.rawTraceUploaded !== false ||
    output.captureValid !== true ||
    output.parsed !== true ||
    !Number.isSafeInteger(output.bytes) ||
    output.bytes <= 0 ||
    output.bytes > NATIVE_TRACE_PROCESSOR.maxSummaryBytes ||
    !/^[a-f0-9]{64}$/.test(output.sha256 ?? '')
  )
    throw new Error('No retained bounded native GPU trace was recorded');
  if (
    !receipt.source ||
    Object.keys(receipt.source).sort().join(',') !== 'commit,electron,fingerprint'
  )
    throw new Error('Unexpected GPU trace source fields');
  if (
    !['not-recorded', 'window-flushed-child-tail-not-certified', 'partial-or-uncertain'].includes(
      receipt.completeness,
    ) ||
    (receipt.fatalCoverage !== undefined &&
      ![
        'no-observed-graphics-fault',
        'observed-during-trace-window',
        'observed-after-trace-window-not-explained-by-this-capture',
        'trace-window-unavailable-or-uncertain',
      ].includes(receipt.fatalCoverage))
  )
    throw new Error('Invalid GPU trace coverage metadata');
  for (const key of ['commit', 'fingerprint', 'electron'])
    if (
      typeof receipt.source[key] !== 'string' ||
      receipt.source[key].length > 128 ||
      !receipt.source?.[key] ||
      receipt.source[key] !== report.source?.[key]
    )
      throw new Error(`GPU trace ${key} does not match the packaged source receipt`);
  const path = join(directory, 'gpu-trace-summary.json');
  const info = await lstat(path);
  if (!info.isFile() || info.size !== output.bytes)
    throw new Error('GPU trace artifact is not the recorded regular file/size');
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > NATIVE_TRACE_PROCESSOR.maxSummaryBytes)
      throw new Error('GPU trace exceeds its artifact bound');
    hash.update(chunk);
  }
  if (bytes !== output.bytes || hash.digest('hex') !== output.sha256)
    throw new Error('GPU trace artifact digest/size does not match the recording');
  let document;
  try {
    document = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Invalid GPU summary JSON');
  }
  if (
    !document ||
    typeof document !== 'object' ||
    Object.keys(document).sort().join(',') !== 'source,summary'
  )
    throw new Error('Unexpected GPU summary fields');
  if (
    !document.source ||
    Object.keys(document.source).sort().join(',') !== 'commit,electron,fingerprint'
  )
    throw new Error('Unexpected GPU summary source fields');
  for (const key of ['commit', 'fingerprint', 'electron'])
    if (
      typeof document.source[key] !== 'string' ||
      document.source[key].length > 128 ||
      document.source?.[key] !== receipt.source[key]
    )
      throw new Error('GPU summary source mismatch');
  const summary = serviceApi
    ? validateNativeGpuServiceApiSummary(document.summary)
    : validateNativeGpuTraceSummary(document.summary);
  if (summary.coverage !== 'typed-gpu-work-observed' || output.gpuWorkObserved !== true)
    throw new Error('No typed GPU work coverage was recorded');
  if (serviceApi && summary.serviceApiCoverage !== 'typed-gpu-service-api-observed')
    throw new Error('No typed GPU service API emission was recorded');
  return {
    outcome: serviceApi
      ? 'retained-typed-gpu-service-api-summary'
      : 'retained-typed-gpu-work-summary',
    completeness: receipt.completeness,
    fatalCoverage: receipt.fatalCoverage ?? 'trace-window-unavailable-or-uncertain',
    source: receipt.source,
    output,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let outcome;
  const reportPath = process.argv[3];
  try {
    if (process.argv[2] !== '--validate' || !reportPath || process.argv.length !== 4)
      throw new Error('Usage: native-gpu-trace.mjs --validate desktop-evidence/report.json');
    if ((await stat(reportPath)).size > 32 * 1024 * 1024)
      throw new Error('Native report exceeds diagnostic validation bound');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    outcome = await validateNativeGpuTraceEvidence(report, dirname(reportPath));
  } catch {
    outcome = { outcome: 'trace-evidence-unavailable', error: 'trace-summary-validation-failed' };
    process.exitCode = 1;
  }
  if (reportPath) {
    try {
      await writeFile(
        join(dirname(reportPath), 'gpu-trace-validation.json'),
        JSON.stringify(outcome, null, 2) + '\n',
      );
    } catch {
      console.error('Trace validation receipt could not be saved');
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(outcome));
}
