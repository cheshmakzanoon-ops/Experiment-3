import { constants, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NATIVE_TRACE_PROCESSOR } from './native-gpu-trace-protocol.mjs';
import {
  OFFLINE_GPU_STRUCTURE_QUERY,
  OFFLINE_GPU_STRUCTURE_LIMITS as limits,
  decodeOfflineGpuStructureRows,
} from './offline-gpu-structure-prototype.mjs';

// OFFLINE ENGINEERING ONLY: no CLI, recorder, workflow, native launch or V2/V3
// routing. Every path/error from input or parser remains private. The one work
// deadline is not an RSS cap or a guarantee of interruptible OS cleanup.
const reasons = new Set([
  'invalid-options',
  'unsupported-platform',
  'processing-timeout',
  'parser-unavailable',
  'parser-integrity',
  'input-unavailable',
  'input-size',
  'input-changed',
  'private-staging-failed',
  'parser-launch-failed',
  'parser-output-limit',
  'parser-pipe-failed',
  'parser-exit',
  'summary-invalid',
  'selected-wrapper-emission-missing',
  'private-cleanup-failed',
]);

export class OfflineGpuStructureError extends Error {
  constructor(reason) {
    const safe = reasons.has(reason) ? reason : 'summary-invalid';
    super(`Offline GPU structural route: ${safe}`);
    this.name = 'OfflineGpuStructureError';
    this.reason = safe;
  }
}
const fail = (reason) => {
  throw new OfflineGpuStructureError(reason);
};
const active = (deadlineAt, signal) => {
  if (signal?.aborted || !Number.isFinite(deadlineAt) || performance.now() >= deadlineAt)
    fail('processing-timeout');
};
const sameFile = (a, b) =>
  a.isFile() &&
  b.isFile() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;
function readOptions(options) {
  try {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Object.getOwnPropertySymbols(options).length !== 0
    )
      fail('invalid-options');
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (
      Object.entries(descriptors).some(
        ([key, property]) =>
          !['path', 'parserPath', 'deadlineMs', 'signal'].includes(key) ||
          !('value' in property) ||
          !property.enumerable,
      )
    )
      fail('invalid-options');
    const path = descriptors.path?.value;
    const parserPath = descriptors.parserPath?.value;
    const requestedDeadline = descriptors.deadlineMs?.value;
    const deadlineMs = requestedDeadline === undefined ? limits.processingMs : requestedDeadline;
    const signal = descriptors.signal?.value;
    if (
      typeof path !== 'string' ||
      !path ||
      typeof parserPath !== 'string' ||
      !parserPath ||
      !Number.isFinite(deadlineMs) ||
      deadlineMs <= 0
    )
      fail('invalid-options');
    // Call native intrinsics, not caller-overridable signal methods/getters.
    if (signal !== undefined) signalAborted.call(signal);
    return { path, parserPath, deadlineMs, signal };
  } catch {
    fail('invalid-options');
  }
}

// Open once, do not block on a FIFO, and never follow the final symlink. Hash
// the parser while copying its verified fd to the private executable that will
// actually run; a subsequently replaced source path cannot replace that copy.
// O_NOFOLLOW covers the final component only. Workspace parent directories
// must be trusted; this is not a general path sandbox against same-UID writers.
async function stageRegularFile({ source, destination, parser, deadlineAt, signal }) {
  let handle;
  const unavailable = parser ? 'parser-unavailable' : 'input-unavailable';
  const invalid = parser ? 'parser-integrity' : 'input-size';
  const changed = parser ? 'parser-integrity' : 'input-changed';
  try {
    active(deadlineAt, signal);
    handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    // Node 22's ReadStream close helper tests fd by truthiness. Reject valid fd 0
    // before attaching a stream, so explicit FileHandle.close cannot retain a
    // stream reference when the caller happened to have closed standard input.
    if (handle.fd === 0) fail(unavailable);
    active(deadlineAt, signal);
    const before = await handle.stat();
    active(deadlineAt, signal);
    if (
      !before.isFile() ||
      before.size <= 0 ||
      before.size > (parser ? NATIVE_TRACE_PROCESSOR.bytes : limits.maxInputBytes) ||
      (parser && before.size !== NATIVE_TRACE_PROCESSOR.bytes)
    )
      fail(invalid);
    const hash = parser ? createHash('sha256') : null;
    let bytes = 0;
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      new Transform({
        transform(chunk, _encoding, done) {
          try {
            active(deadlineAt, signal);
            bytes += chunk.length;
            if (bytes > before.size) fail(changed);
            hash?.update(chunk);
            done(null, chunk);
          } catch (error) {
            done(error);
          }
        },
      }),
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    active(deadlineAt, signal);
    const after = await handle.stat();
    const named = await lstat(source);
    active(deadlineAt, signal);
    if (bytes !== before.size || !sameFile(before, after) || !sameFile(before, named))
      fail(changed);
    if (parser && hash.digest('hex') !== NATIVE_TRACE_PROCESSOR.sha256) fail('parser-integrity');
    await chmod(destination, parser ? 0o500 : 0o400);
    active(deadlineAt, signal);
    return bytes;
  } catch (error) {
    if (signal?.aborted) fail('processing-timeout');
    if (error instanceof OfflineGpuStructureError) throw error;
    fail(unavailable);
  } finally {
    await handle?.close();
  }
}

// Low-level raw-stdout seam for deterministic lifecycle tests ONLY; this helper
// does not itself pin a parser or sanitize its output. Pin/privacy guarantees
// belong to summarizeOfflineGpuStructure, which always uses actual spawn.
export function runBoundedStructuralProcessor({
  parserPath,
  path,
  deadlineAt,
  signal,
  spawnProcess = spawn,
}) {
  return new Promise((resolveResult, reject) => {
    let child;
    let timer;
    let reason;
    let stdout = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let killRequested = false;
    const terminate = (why) => {
      reason ??= why;
      if (killRequested) return;
      killRequested = true;
      try {
        child?.kill('SIGKILL');
      } catch {
        // A signal failure is not close. Never delete an active child's input.
      }
    };
    const abort = () => terminate('processing-timeout');
    try {
      active(deadlineAt, signal);
      child = spawnProcess(parserPath, ['-Q', OFFLINE_GPU_STRUCTURE_QUERY, path], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        error instanceof OfflineGpuStructureError
          ? error
          : new OfflineGpuStructureError('parser-launch-failed'),
      );
      return;
    }
    child.on('error', () => {
      terminate('parser-launch-failed');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (reason || code !== 0) reject(new OfflineGpuStructureError(reason ?? 'parser-exit'));
      else {
        try {
          active(deadlineAt, signal);
          resolveResult(stdout);
        } catch (error) {
          reject(error);
        }
      }
    });
    timer = setTimeout(abort, Math.max(1, deadlineAt - performance.now()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limits.maxStdoutBytes) terminate('parser-output-limit');
      else if (!reason) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      // Count/discard, never retain or propagate parser diagnostics.
      stderrBytes += chunk.length;
      if (stderrBytes > limits.maxStderrBytes) terminate('parser-output-limit');
    });
    child.stdout.on('error', () => terminate('parser-pipe-failed'));
    child.stderr.on('error', () => terminate('parser-pipe-failed'));
  });
}

export async function summarizeOfflineGpuStructure(options) {
  // One monotonic WORK/ACCEPTANCE budget from entry. Never reset per stage.
  const enteredAt = performance.now();
  const { path, parserPath, deadlineMs, signal: parentSignal } = readOptions(options);
  if (process.platform !== 'linux' || process.arch !== 'x64') fail('unsupported-platform');
  const deadlineAt = enteredAt + Math.min(deadlineMs, limits.processingMs);
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  const timer = setTimeout(abort, Math.max(1, deadlineAt - performance.now()));
  let listening = false;
  let directory;
  let summary;
  let failure;
  try {
    if (parentSignal !== undefined) {
      try {
        listen.call(parentSignal, 'abort', abort, { once: true });
        listening = true;
        if (signalAborted.call(parentSignal)) abort();
      } catch {
        fail('invalid-options');
      }
    }
    active(deadlineAt, signal);
    directory = await mkdtemp(join(dirname(resolve(path)), '.gpu-structure-private-'));
    active(deadlineAt, signal);
    await chmod(directory, 0o700);
    const stagedParser = join(directory, 'parser');
    const stagedTrace = join(directory, 'input.pftrace');
    await stageRegularFile({
      source: parserPath,
      destination: stagedParser,
      parser: true,
      deadlineAt,
      signal,
    });
    const bytes = await stageRegularFile({
      source: path,
      destination: stagedTrace,
      parser: false,
      deadlineAt,
      signal,
    });
    const stdout = await runBoundedStructuralProcessor({
      parserPath: stagedParser,
      path: stagedTrace,
      deadlineAt,
      signal,
    });
    active(deadlineAt, signal);
    try {
      summary = decodeOfflineGpuStructureRows(stdout, bytes);
    } catch {
      fail('summary-invalid');
    }
    active(deadlineAt, signal);
    if (summary.buckets[0].count === 0) fail('selected-wrapper-emission-missing');
    if (Buffer.byteLength(JSON.stringify(summary)) > limits.maxSummaryBytes)
      fail('summary-invalid');
    active(deadlineAt, signal);
  } catch (error) {
    failure =
      error instanceof OfflineGpuStructureError
        ? error
        : new OfflineGpuStructureError(
            signal.aborted ? 'processing-timeout' : 'private-staging-failed',
          );
  } finally {
    // Parser helper settles only on close. No stage can be removed early on
    // timeout/kill/error; uninterruptible metadata/close may outlast the budget.
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        failure = new OfflineGpuStructureError('private-cleanup-failed');
      }
    }
    clearTimeout(timer);
    if (listening) {
      try {
        unlisten.call(parentSignal, 'abort', abort);
      } catch {
        failure = new OfflineGpuStructureError('invalid-options');
      }
    }
  }
  if (failure) throw failure;
  active(deadlineAt, signal);
  return summary;
}
