import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdtemp, rm, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { Transform, addAbortSignal } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const NATIVE_TRACE_PROCESSOR = Object.freeze({
  version: '58.2',
  bytes: 14897560,
  sha256: '58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9',
  maxInputBytes: 64 * 1024 * 1024,
  maxStdoutBytes: 16 * 1024,
  maxStderrBytes: 4 * 1024,
  maxSummaryBytes: 16 * 1024,
  processingMs: 5000,
});
// Source-pinned static pairs only. No trace-derived names enter SQL or output.
export const NATIVE_GPU_WORK_EVENTS = Object.freeze(
  [
    ['gpu', 'CommandBufferStub::OnAsyncFlush'],
    ['gpu', 'CommandBufferStub::PerformWork'],
    ['gpu', 'Scheduler::RunTask'],
    ['gpu', 'CommandBufferService:PutChanged'],
    ['gpu', 'GLES2DecoderPassthroughImpl::DoLinkProgram'],
    ['gpu.angle', 'CompileEvent::wait'],
    ['gpu.angle', 'Program::MainLinkLoadEvent::wait'],
    ['gpu.angle', 'ProgramGL::linkJobImpl'],
    ['gpu.angle', 'ProgramGL::postLinkJobImpl'],
  ].map(([category, name]) => Object.freeze({ category, name })),
);
const eventCount = NATIVE_GPU_WORK_EVENTS.length;
const errorRow = eventCount + 1;
const lossRow = eventCount + 2;
const otherRow = eventCount + 3;
const discriminator = (events) =>
  events.slice(4).some((row) => row.unfinishedUnderUnfinishedFlushCount > 0)
    ? 'same-track-open-compile-or-link-under-unfinished-flush-observed'
    : 'inconclusive';
const reasons = new Set([
  'processing-timeout',
  'parser-unavailable',
  'parser-integrity',
  'trace-unavailable',
  'trace-size',
  'trace-changed',
  'private-staging-failed',
  'parser-launch-failed',
  'parser-output-limit',
  'parser-exit',
  'parser-rows',
  'summary-invalid',
]);
export class NativeGpuTraceSummaryError extends Error {
  constructor(reason, parserExitStatus = null) {
    super(`Native GPU trace summary: ${reasons.has(reason) ? reason : 'summary-invalid'}`);
    this.name = 'NativeGpuTraceSummaryError';
    this.reason = reasons.has(reason) ? reason : 'summary-invalid';
    this.parserExitStatus =
      Number.isInteger(parserExitStatus) && parserExitStatus >= 0 && parserExitStatus <= 255
        ? parserExitStatus
        : null;
  }
}
const fail = (reason) => {
  throw new NativeGpuTraceSummaryError(reason);
};
const active = (deadlineAt, signal) => {
  if (signal?.aborted || !Number.isFinite(deadlineAt) || Date.now() >= deadlineAt)
    fail('processing-timeout');
};

// Only fixed numeric columns leave the parser. GPU identity comes from the
// typed Chrome process descriptor, never a freeform process/thread name.
export const NATIVE_GPU_TRACE_QUERY = `
WITH specs(event_id, category, name) AS (VALUES
 ${NATIVE_GPU_WORK_EVENTS.map(({ category, name }, index) => `(${index + 1},'${category}','${name}')`).join(',\n ')}
), work AS (
 SELECT specs.event_id, p.upid, s.ts - b.start_ts AS relative_ts, s.dur,
 EXISTS (SELECT 1 FROM ancestor_slice(s.id) a
  WHERE a.track_id = s.track_id AND a.dur = -1
   AND a.name = 'CommandBufferStub::OnAsyncFlush'
   AND instr(',' || a.category || ',', ',gpu,') > 0) AS unfinished_flush_ancestor
 FROM slice s JOIN thread_track tt ON s.track_id = tt.id
 JOIN thread t ON tt.utid = t.utid JOIN process p ON t.upid = p.upid
 JOIN specs ON s.name = specs.name
  AND instr(',' || s.category || ',', ',' || specs.category || ',') > 0
 CROSS JOIN trace_bounds b
 WHERE EXTRACT_ARG(p.arg_set_id, 'chrome.process_type') = 'Gpu'
), ids AS (SELECT 0 AS id UNION ALL SELECT event_id FROM specs)
SELECT ids.id AS event_id, COUNT(DISTINCT w.upid) AS process_count,
 COUNT(w.upid) AS event_count,
 COALESCE(SUM(CASE WHEN w.dur >= 0 THEN 1 ELSE 0 END),0) AS completed_count,
 COALESCE(SUM(CASE WHEN w.dur = -1 THEN 1 ELSE 0 END),0) AS unfinished_count,
 COALESCE(MIN(w.relative_ts),0) AS first_ns,
 COALESCE(MAX(w.relative_ts + MAX(w.dur,0)),0) AS last_ns,
 COALESCE(SUM(MAX(w.dur,0)),0) AS total_ns,
 COALESCE(MAX(MAX(w.dur,0)),0) AS max_ns,
 COALESCE(SUM(w.unfinished_flush_ancestor),0) AS unfinished_flush_ancestor_count,
 COALESCE(SUM(CASE WHEN w.dur = -1 THEN w.unfinished_flush_ancestor ELSE 0 END),0) AS unfinished_under_unfinished_flush_count
FROM ids LEFT JOIN work w ON ids.id = 0 OR ids.id = w.event_id GROUP BY ids.id
UNION ALL SELECT ${errorRow},COUNT(*),COALESCE(SUM(value),0),0,0,0,0,0,0,0,0 FROM stats WHERE severity='error'
UNION ALL SELECT ${lossRow},COUNT(*),COALESCE(SUM(value),0),0,0,0,0,0,0,0,0 FROM stats WHERE severity='data_loss'
UNION ALL SELECT ${otherRow},0,COUNT(*),0,0,0,0,0,0,0,0
FROM slice s JOIN thread_track tt ON s.track_id=tt.id
JOIN thread t ON tt.utid=t.utid JOIN process p ON t.upid=p.upid
WHERE EXTRACT_ARG(p.arg_set_id,'chrome.process_type')='Gpu'
AND instr(',' || s.category || ',', ',gpu,')>0
AND NOT EXISTS (SELECT 1 FROM specs WHERE s.name=specs.name
 AND instr(',' || s.category || ',', ',' || specs.category || ',')>0)
ORDER BY event_id;
`;

function rowShape(row) {
  return row.every((value) => Number.isSafeInteger(value) && value >= 0);
}

export function decodeNativeGpuTraceRows(stdout, captureBytes) {
  if (
    typeof stdout !== 'string' ||
    Buffer.byteLength(stdout) > NATIVE_TRACE_PROCESSOR.maxStdoutBytes
  )
    fail('parser-rows');
  const lines = stdout.trim().split(/\r?\n/);
  const header =
    'event_id,process_count,event_count,completed_count,unfinished_count,first_ns,last_ns,total_ns,max_ns,unfinished_flush_ancestor_count,unfinished_under_unfinished_flush_count';
  if (
    lines.length !== eventCount + 5 ||
    (lines[0] !== header &&
      lines[0] !==
        header
          .split(',')
          .map((name) => `"${name}"`)
          .join(','))
  )
    fail('parser-rows');
  const rows = lines.slice(1).map((line, index) => {
    if (!/^\d+(,\d+){10}$/.test(line)) fail('parser-rows');
    const row = line.split(',').map(Number);
    if (!rowShape(row) || row[0] !== index) fail('parser-rows');
    return row;
  });
  if (
    rows
      .slice(errorRow)
      .some((row) =>
        row.some((v, i) => i !== 0 && i !== 2 && !(row[0] < otherRow && i === 1) && v !== 0),
      )
  )
    fail('parser-rows');
  const event = (row) => ({
    id: row[0],
    processCount: row[1],
    count: row[2],
    completed: row[3],
    unfinished: row[4],
    firstNs: row[5],
    lastNs: row[6],
    totalDurationNs: row[7],
    maxDurationNs: row[8],
    unfinishedFlushAncestorCount: row[9],
    unfinishedUnderUnfinishedFlushCount: row[10],
  });
  const summary = {
    version: 2,
    privacy: 'constant-label-numeric-summary-only',
    parserVersion: NATIVE_TRACE_PROCESSOR.version,
    captureBytes,
    parseCompleted: true,
    parserExitStatus: 0,
    parserErrors: rows[errorRow][2],
    parserErrorStatRows: rows[errorRow][1],
    reportedDataLoss: rows[lossRow][2],
    dataLossStatRows: rows[lossRow][1],
    otherGpuEvents: rows[otherRow][2],
    childTailCertified: false,
    durationScope: 'overlapping-cpu-work-spans-not-gpu-execution-time',
    coverage: rows[0][2] > 0 ? 'typed-gpu-work-observed' : 'no-typed-gpu-work-observed',
    ancestryScope: 'same-track-descendants-of-unfinished-flush-not-causation',
    compileLinkDiscriminator: discriminator(rows.slice(1, errorRow).map(event)),
    aggregate: event(rows[0]),
    events: rows
      .slice(1, errorRow)
      .map((row) => ({ ...event(row), ...NATIVE_GPU_WORK_EVENTS[row[0] - 1] })),
  };
  validateNativeGpuTraceSummary(summary);
  return summary;
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.sort().join(',')
  );
}
export function validateNativeGpuTraceSummary(value) {
  if (
    !exactKeys(value, [
      'version',
      'privacy',
      'parserVersion',
      'captureBytes',
      'parseCompleted',
      'parserExitStatus',
      'parserErrors',
      'parserErrorStatRows',
      'reportedDataLoss',
      'dataLossStatRows',
      'otherGpuEvents',
      'childTailCertified',
      'durationScope',
      'coverage',
      'ancestryScope',
      'compileLinkDiscriminator',
      'aggregate',
      'events',
    ]) ||
    value.version !== 2 ||
    value.privacy !== 'constant-label-numeric-summary-only' ||
    value.parserVersion !== NATIVE_TRACE_PROCESSOR.version ||
    value.parseCompleted !== true ||
    value.parserExitStatus !== 0 ||
    value.childTailCertified !== false ||
    value.durationScope !== 'overlapping-cpu-work-spans-not-gpu-execution-time' ||
    value.ancestryScope !== 'same-track-descendants-of-unfinished-flush-not-causation' ||
    !Number.isSafeInteger(value.captureBytes) ||
    value.captureBytes <= 0 ||
    value.captureBytes > NATIVE_TRACE_PROCESSOR.maxInputBytes ||
    !rowShape([
      value.parserErrors,
      value.parserErrorStatRows,
      value.reportedDataLoss,
      value.dataLossStatRows,
      value.otherGpuEvents,
    ]) ||
    (value.parserErrorStatRows === 0 && value.parserErrors !== 0) ||
    (value.dataLossStatRows === 0 && value.reportedDataLoss !== 0) ||
    !Array.isArray(value.events) ||
    value.events.length !== eventCount
  )
    fail('summary-invalid');
  for (const [index, row] of [value.aggregate, ...value.events].entries()) {
    const keys = [
      'id',
      'processCount',
      'count',
      'completed',
      'unfinished',
      'firstNs',
      'lastNs',
      'totalDurationNs',
      'maxDurationNs',
      'unfinishedFlushAncestorCount',
      'unfinishedUnderUnfinishedFlushCount',
    ];
    if (index > 0) keys.push('name', 'category');
    if (
      !exactKeys(row, keys) ||
      row.id !== index ||
      (index > 0 &&
        (row.name !== NATIVE_GPU_WORK_EVENTS[index - 1].name ||
          row.category !== NATIVE_GPU_WORK_EVENTS[index - 1].category)) ||
      !rowShape([
        row.processCount,
        row.count,
        row.completed,
        row.unfinished,
        row.firstNs,
        row.lastNs,
        row.totalDurationNs,
        row.maxDurationNs,
        row.unfinishedFlushAncestorCount,
        row.unfinishedUnderUnfinishedFlushCount,
      ]) ||
      row.completed + row.unfinished !== row.count ||
      row.unfinishedFlushAncestorCount > row.count ||
      row.unfinishedUnderUnfinishedFlushCount >
        Math.min(row.unfinished, row.unfinishedFlushAncestorCount) ||
      row.unfinishedUnderUnfinishedFlushCount <
        Math.max(0, row.unfinished + row.unfinishedFlushAncestorCount - row.count) ||
      row.processCount > row.count ||
      (row.count > 0 && row.processCount === 0) ||
      row.lastNs < row.firstNs ||
      row.maxDurationNs > row.totalDurationNs ||
      (row.completed === 0 && (row.totalDurationNs !== 0 || row.maxDurationNs !== 0)) ||
      (row.count === 0 &&
        Object.entries(row).some(
          ([key, v]) => key !== 'id' && key !== 'name' && key !== 'category' && v !== 0,
        ))
    )
      fail('summary-invalid');
  }
  for (const key of [
    'count',
    'completed',
    'unfinished',
    'totalDurationNs',
    'unfinishedFlushAncestorCount',
    'unfinishedUnderUnfinishedFlushCount',
  ])
    if (value.events.reduce((sum, row) => sum + row[key], 0) !== value.aggregate[key])
      fail('summary-invalid');
  const present = value.events.filter((row) => row.count > 0);
  if (
    (value.events[0].unfinished === 0 && value.aggregate.unfinishedFlushAncestorCount !== 0) ||
    value.compileLinkDiscriminator !== discriminator(value.events) ||
    value.aggregate.firstNs !==
      (present.length ? Math.min(...present.map((row) => row.firstNs)) : 0) ||
    value.aggregate.lastNs !== Math.max(0, ...present.map((row) => row.lastNs)) ||
    value.aggregate.maxDurationNs !== Math.max(0, ...present.map((row) => row.maxDurationNs)) ||
    value.aggregate.processCount < Math.max(...value.events.map((row) => row.processCount)) ||
    value.aggregate.processCount > value.events.reduce((sum, row) => sum + row.processCount, 0) ||
    value.coverage !==
      (value.aggregate.count > 0 ? 'typed-gpu-work-observed' : 'no-typed-gpu-work-observed') ||
    Buffer.byteLength(JSON.stringify(value)) > NATIVE_TRACE_PROCESSOR.maxSummaryBytes
  )
    fail('summary-invalid');
  return value;
}

export async function verifyNativeTraceProcessor(
  parserPath,
  deadlineAt,
  { signal, openReadStream = createReadStream } = {},
) {
  try {
    active(deadlineAt, signal);
    if (typeof parserPath !== 'string' || !parserPath) fail('parser-unavailable');
    const info = await lstat(parserPath);
    active(deadlineAt, signal);
    if (!info.isFile() || info.size !== NATIVE_TRACE_PROCESSOR.bytes) fail('parser-integrity');
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = openReadStream(parserPath, { signal });
    if (signal) addAbortSignal(signal, stream);
    for await (const chunk of stream) {
      active(deadlineAt, signal);
      bytes += chunk.length;
      if (bytes > NATIVE_TRACE_PROCESSOR.bytes) fail('parser-integrity');
      hash.update(chunk);
    }
    active(deadlineAt, signal);
    if (
      bytes !== NATIVE_TRACE_PROCESSOR.bytes ||
      hash.digest('hex') !== NATIVE_TRACE_PROCESSOR.sha256
    )
      fail('parser-integrity');
  } catch (error) {
    if (signal?.aborted) fail('processing-timeout');
    if (error instanceof NativeGpuTraceSummaryError) throw error;
    fail('parser-unavailable');
  }
}

export function runBoundedTraceProcessor({
  parserPath,
  path,
  deadlineAt,
  signal,
  spawnProcess = spawn,
}) {
  return new Promise((resolveResult, reject) => {
    let child,
      timer,
      reason,
      stdout = '',
      stdoutBytes = 0,
      stderrBytes = 0;
    const terminate = (why) => {
      reason ??= why;
      // Failure to signal is not evidence that the process has settled.
      try {
        child?.kill('SIGKILL');
      } catch {
        /* wait for close */
      }
    };
    const aborted = () => terminate('processing-timeout');
    try {
      active(deadlineAt, signal);
      child = spawnProcess(parserPath, ['-Q', NATIVE_GPU_TRACE_QUERY, path], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        error instanceof NativeGpuTraceSummaryError
          ? error
          : new NativeGpuTraceSummaryError('parser-launch-failed'),
      );
      return;
    }
    // Never resolve on error/exit/kill alone: staging remains until close.
    child.on('error', () => {
      reason ??= 'parser-launch-failed';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (reason || code !== 0)
        reject(new NativeGpuTraceSummaryError(reason ?? 'parser-exit', code));
      else if (signal?.aborted || Date.now() >= deadlineAt)
        reject(new NativeGpuTraceSummaryError('processing-timeout', code));
      else resolveResult(stdout);
    });
    timer = setTimeout(aborted, Math.max(1, deadlineAt - Date.now()));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > NATIVE_TRACE_PROCESSOR.maxStdoutBytes) terminate('parser-output-limit');
      else stdout += chunk.toString('utf8');
    });
    // Count/discard only: diagnostics can contain private trace strings.
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > NATIVE_TRACE_PROCESSOR.maxStderrBytes) terminate('parser-output-limit');
    });
  });
}

/** Raw and staging stay private. A single deadline aborts all streams and the
 * parser; staging is removed only after the parser's close, including a kill.
 * A stuck OS metadata operation cannot be cancelled; the outer owner records
 * deferred private cleanup rather than waiting indefinitely or deleting early. */
export async function summarizeNativeGpuTrace({
  path,
  parserPath,
  deadlineMs = NATIVE_TRACE_PROCESSOR.processingMs,
  signal: parentSignal,
}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) fail('processing-timeout');
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  const deadlineAt = Date.now() + Math.min(deadlineMs, NATIVE_TRACE_PROCESSOR.processingMs);
  const timer = setTimeout(abort, Math.max(1, deadlineAt - Date.now()));
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) abort();
  let directory;
  try {
    await verifyNativeTraceProcessor(parserPath, deadlineAt, { signal });
    active(deadlineAt, signal);
    const before = await lstat(path);
    active(deadlineAt, signal);
    if (!before.isFile() || before.size <= 0 || before.size > NATIVE_TRACE_PROCESSOR.maxInputBytes)
      fail('trace-size');
    directory = await mkdtemp(join(dirname(resolve(path)), '.gpu-trace-private-'));
    active(deadlineAt, signal);
    const staged = join(directory, 'trace.pftrace');
    let bytes = 0;
    await pipeline(
      createReadStream(path, { signal }),
      new Transform({
        transform(chunk, _encoding, done) {
          try {
            active(deadlineAt, signal);
            bytes += chunk.length;
            if (bytes > NATIVE_TRACE_PROCESSOR.maxInputBytes) fail('trace-size');
            done(null, chunk);
          } catch (error) {
            done(error);
          }
        },
      }),
      createWriteStream(staged, { flags: 'wx', mode: 0o600, signal }),
      { signal },
    );
    const after = await lstat(path);
    active(deadlineAt, signal);
    if (
      bytes !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    )
      fail('trace-changed');
    await chmod(staged, 0o400);
    active(deadlineAt, signal);
    const stdout = await runBoundedTraceProcessor({
      parserPath: resolve(parserPath),
      path: staged,
      deadlineAt,
      signal,
    });
    try {
      return decodeNativeGpuTraceRows(stdout, bytes);
    } catch (error) {
      if (error instanceof NativeGpuTraceSummaryError)
        throw new NativeGpuTraceSummaryError(error.reason, 0);
      throw error;
    }
  } catch (error) {
    if (error instanceof NativeGpuTraceSummaryError) throw error;
    if (signal.aborted) fail('processing-timeout');
    fail('private-staging-failed');
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
