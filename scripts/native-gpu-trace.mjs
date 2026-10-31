import { createReadStream, createWriteStream } from 'node:fs';
import { stat, lstat, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const NATIVE_GPU_TRACE = Object.freeze({
  bufferKiB: 16384,
  maxFileBytes: 64 * 1024 * 1024,
  setupMs: 5000,
  stopMs: 5000,
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

export function nativeGpuTraceCategories(available) {
  if (!Array.isArray(available) || available.length > 4096)
    throw new Error('Invalid native trace category inventory');
  const names = new Set();
  for (const group of available) {
    if (typeof group !== 'string' || group.length > 512)
      throw new Error('Invalid native trace category group');
    for (const name of group.split(',')) names.add(name.trim());
  }
  const selected = NATIVE_GPU_TRACE.categories.filter((name) => names.has(name));
  if (!selected.some((name) => /gpu|angle/.test(name)))
    throw new Error('No supported GPU trace categories were reported');
  return selected;
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

async function inspectTrace(path, outputPath) {
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error('Trace file is empty or unavailable');
  if (info.size > NATIVE_GPU_TRACE.maxFileBytes) {
    // This is our own generated diagnostic, never a source/asset path. Do not
    // truncate protobuf and mislabel the corrupt prefix as a complete trace.
    await rm(path);
    return { bytes: info.size, retained: false, reason: 'oversized-trace-removed' };
  }
  const hash = createHash('sha256');
  let bytes = 0,
    oversized = false;
  // Stage outside the uploaded directory too. A late timed-out stop or a
  // growing raw file cannot publish unchecked/unbounded bytes in the artifact.
  const staged = `${path}.bounded`;
  try {
    await pipeline(
      createReadStream(path),
      new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          if (bytes > NATIVE_GPU_TRACE.maxFileBytes) {
            oversized = true;
            done(new Error('Trace grew beyond its artifact bound'));
            return;
          }
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(staged),
    );
    await copyFile(staged, outputPath);
    return { file: basename(outputPath), bytes, sha256: hash.digest('hex'), retained: true };
  } catch (failure) {
    if (!oversized) throw failure;
    await rm(path, { force: true });
    return { bytes, retained: false, reason: 'oversized-trace-removed' };
  } finally {
    await rm(staged, { force: true });
  }
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
  outputPath = `${path}.published`,
  now = Date.now,
  setupMs = NATIVE_GPU_TRACE.setupMs,
  stopMs = NATIVE_GPU_TRACE.stopMs,
  inspect = inspectTrace,
}) {
  const receipt = {
    version: 1,
    enabled,
    diagnosticOnly: enabled,
    scope: 'unchanged-babylon-inspect-through-authored-wheel-check-or-first-gpu-fault',
    omittedGameplayChecks: [],
    source: Object.fromEntries(
      ['commit', 'fingerprint', 'electron'].map((key) => [
        key,
        String(source?.[key] ?? '').slice(0, 128),
      ]),
    ),
    status: enabled ? 'not-started' : 'disabled',
    format: 'perfetto-protobuf',
    config: null,
    setupBudgetMs: setupMs,
    stopBudgetMs: stopMs,
    maxFileBytes: NATIVE_GPU_TRACE.maxFileBytes,
    completeness: 'not-recorded',
    errors: [],
  };
  let used = false;
  const error = (value) => {
    if (receipt.errors.length < 4) receipt.errors.push(String(value).slice(0, 2048));
  };
  return {
    receipt,
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
            receipt.output = await bounded(
              () => inspect(path, outputPath),
              stopMs,
              'Native GPU trace file',
            );
            receipt.status = receipt.output.retained ? 'recorded' : 'incomplete';
            receipt.completeness =
              startAcknowledged && !lateStart && !firstFault.read() && receipt.output.retained
                ? 'window-flushed-child-tail-not-certified'
                : 'partial-or-uncertain';
          } catch (failure) {
            error(failure);
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
      } catch (failure) {
        error(failure);
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
        } catch (snapshotError) {
          error(snapshotError);
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
  if (
    receipt?.enabled !== true ||
    receipt.diagnosticOnly !== true ||
    receipt.status !== 'recorded' ||
    receipt.format !== 'perfetto-protobuf' ||
    output?.retained !== true ||
    output.file !== 'gpu-trace.pftrace' ||
    !Number.isSafeInteger(output.bytes) ||
    output.bytes <= 0 ||
    output.bytes > NATIVE_GPU_TRACE.maxFileBytes ||
    !/^[a-f0-9]{64}$/.test(output.sha256 ?? '')
  )
    throw new Error('No retained bounded native GPU trace was recorded');
  for (const key of ['commit', 'fingerprint', 'electron'])
    if (!receipt.source?.[key] || receipt.source[key] !== report.source?.[key])
      throw new Error(`GPU trace ${key} does not match the packaged source receipt`);
  const path = join(directory, 'gpu-trace.pftrace');
  const info = await lstat(path);
  if (!info.isFile() || info.size !== output.bytes)
    throw new Error('GPU trace artifact is not the recorded regular file/size');
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > NATIVE_GPU_TRACE.maxFileBytes)
      throw new Error('GPU trace exceeds its artifact bound');
    hash.update(chunk);
  }
  if (bytes !== output.bytes || hash.digest('hex') !== output.sha256)
    throw new Error('GPU trace artifact digest/size does not match the recording');
  return {
    outcome: 'retained-bounded-trace',
    completeness: receipt.completeness,
    fatalCoverage: receipt.fatalCoverage,
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
  } catch (failure) {
    outcome = { outcome: 'trace-evidence-unavailable', error: String(failure).slice(0, 2048) };
    process.exitCode = 1;
  }
  if (reportPath) {
    try {
      await writeFile(
        join(dirname(reportPath), 'gpu-trace-validation.json'),
        JSON.stringify(outcome, null, 2) + '\n',
      );
    } catch (failure) {
      console.error(
        `Trace validation receipt could not be saved: ${String(failure).slice(0, 2048)}`,
      );
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(outcome));
}
