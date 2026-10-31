import { Buffer } from 'node:buffer';
import {
  NATIVE_TRACE_PROCESSOR,
  NATIVE_GPU_WORK_EVENTS,
  NativeGpuTraceSummaryError,
} from './native-gpu-trace-protocol.mjs';

// Chromium 156.0.8078.75 ui/gl/gl_bindings_autogen_gl.cc. These are
// argument-free service API wrappers, not native Mesa/device execution spans.
// Installation requires the separately guarded enable-gpu-service-tracing flag.
export const NATIVE_GPU_SERVICE_API_EVENTS = Object.freeze(
  [
    'TraceGLAPI::glDrawArrays',
    'TraceGLAPI::glDrawArraysInstancedANGLE',
    'TraceGLAPI::glDrawElements',
    'TraceGLAPI::glDrawElementsInstancedANGLE',
    'TraceGLAPI::glClientWaitSync',
    'TraceGLAPI::glWaitSync',
    'TraceGLAPI::glGetSynciv',
    'TraceGLAPI::glFenceSync',
    'TraceGLAPI::glFlush',
    'TraceGLAPI::glFinish',
  ].map((name) => Object.freeze({ category: 'gpu', name })),
);
export const NATIVE_GPU_SERVICE_API_WORK_EVENTS = Object.freeze([
  ...NATIVE_GPU_WORK_EVENTS,
  ...NATIVE_GPU_SERVICE_API_EVENTS,
]);
const eventCount = NATIVE_GPU_SERVICE_API_WORK_EVENTS.length;
const errorRow = eventCount + 1;
const lossRow = eventCount + 2;
const otherRow = eventCount + 3;
const discriminator = (events) =>
  events.slice(4, 9).some((row) => row.unfinishedUnderUnfinishedFlushCount > 0)
    ? 'same-track-open-compile-or-link-under-unfinished-flush-observed'
    : 'inconclusive';
const serviceApiCoverage = (events) =>
  events.slice(9).some((row) => row.count > 0)
    ? 'typed-gpu-service-api-observed'
    : 'no-typed-gpu-service-api-observed';
const serviceApiDiscriminator = (events) =>
  events.slice(9).some((row) => row.unfinishedUnderUnfinishedDecoderFlushCount > 0)
    ? 'same-track-open-service-api-under-unfinished-decoder-and-flush-observed'
    : 'inconclusive';
const fail = (reason) => {
  throw new NativeGpuTraceSummaryError(reason);
};

// Both EXISTS predicates apply to the same child and ordered ancestor chain.
// No event args, freeform names, IDs or parser strings leave this fixed query.
export const NATIVE_GPU_SERVICE_API_QUERY = `
WITH specs(event_id, category, name) AS (VALUES
 ${NATIVE_GPU_SERVICE_API_WORK_EVENTS.map(({ category, name }, index) => `(${index + 1},'${category}','${name}')`).join(',\n ')}
), work AS (
 SELECT specs.event_id, p.upid, s.ts - b.start_ts AS relative_ts, s.dur,
 EXISTS (SELECT 1 FROM ancestor_slice(s.id) a
  WHERE a.track_id = s.track_id AND a.dur = -1
   AND a.name = 'CommandBufferStub::OnAsyncFlush'
   AND instr(',' || a.category || ',', ',gpu,') > 0) AS unfinished_flush_ancestor,
 EXISTS (SELECT 1 FROM ancestor_slice(s.id) d
  WHERE d.track_id = s.track_id AND d.dur = -1
   AND d.name = 'CommandBufferService:PutChanged'
   AND instr(',' || d.category || ',', ',gpu,') > 0
   AND EXISTS (SELECT 1 FROM ancestor_slice(d.id) f
    WHERE f.track_id = d.track_id AND f.dur = -1
     AND f.name = 'CommandBufferStub::OnAsyncFlush'
     AND instr(',' || f.category || ',', ',gpu,') > 0)) AS unfinished_decoder_flush_ancestor
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
 COALESCE(SUM(CASE WHEN w.dur = -1 THEN w.unfinished_flush_ancestor ELSE 0 END),0) AS unfinished_under_unfinished_flush_count,
 COALESCE(SUM(w.unfinished_decoder_flush_ancestor),0) AS unfinished_decoder_flush_ancestor_count,
 COALESCE(SUM(CASE WHEN w.dur = -1 THEN w.unfinished_decoder_flush_ancestor ELSE 0 END),0) AS unfinished_under_unfinished_decoder_flush_count
FROM ids LEFT JOIN work w ON ids.id = 0 OR ids.id = w.event_id GROUP BY ids.id
UNION ALL SELECT ${errorRow},COUNT(*),COALESCE(SUM(value),0),0,0,0,0,0,0,0,0,0,0 FROM stats WHERE severity='error'
UNION ALL SELECT ${lossRow},COUNT(*),COALESCE(SUM(value),0),0,0,0,0,0,0,0,0,0,0 FROM stats WHERE severity='data_loss'
UNION ALL SELECT ${otherRow},0,COUNT(*),0,0,0,0,0,0,0,0,0,0
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

export function decodeNativeGpuServiceApiRows(stdout, captureBytes) {
  if (
    typeof stdout !== 'string' ||
    Buffer.byteLength(stdout) > NATIVE_TRACE_PROCESSOR.maxStdoutBytes
  )
    fail('parser-rows');
  const lines = stdout.trim().split(/\r?\n/);
  const header =
    'event_id,process_count,event_count,completed_count,unfinished_count,first_ns,last_ns,total_ns,max_ns,unfinished_flush_ancestor_count,unfinished_under_unfinished_flush_count,unfinished_decoder_flush_ancestor_count,unfinished_under_unfinished_decoder_flush_count';
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
    if (!/^\d+(,\d+){12}$/.test(line)) fail('parser-rows');
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
    unfinishedDecoderFlushAncestorCount: row[11],
    unfinishedUnderUnfinishedDecoderFlushCount: row[12],
  });
  const summary = {
    version: 3,
    serviceApiMode: 'service-api-boundary-v1',
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
    serviceApiCoverage: serviceApiCoverage(rows.slice(1, errorRow).map(event)),
    serviceApiBoundaryDiscriminator: serviceApiDiscriminator(rows.slice(1, errorRow).map(event)),
    aggregate: event(rows[0]),
    events: rows
      .slice(1, errorRow)
      .map((row) => ({ ...event(row), ...NATIVE_GPU_SERVICE_API_WORK_EVENTS[row[0] - 1] })),
  };
  validateNativeGpuServiceApiSummary(summary);
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
export function validateNativeGpuServiceApiSummary(value) {
  if (
    !exactKeys(value, [
      'version',
      'serviceApiMode',
      'serviceApiCoverage',
      'serviceApiBoundaryDiscriminator',
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
    value.version !== 3 ||
    value.serviceApiMode !== 'service-api-boundary-v1' ||
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
      'unfinishedDecoderFlushAncestorCount',
      'unfinishedUnderUnfinishedDecoderFlushCount',
    ];
    if (index > 0) keys.push('name', 'category');
    if (
      !exactKeys(row, keys) ||
      row.id !== index ||
      (index > 0 &&
        (row.name !== NATIVE_GPU_SERVICE_API_WORK_EVENTS[index - 1].name ||
          row.category !== NATIVE_GPU_SERVICE_API_WORK_EVENTS[index - 1].category)) ||
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
        row.unfinishedDecoderFlushAncestorCount,
        row.unfinishedUnderUnfinishedDecoderFlushCount,
      ]) ||
      row.completed + row.unfinished !== row.count ||
      row.unfinishedFlushAncestorCount > row.count ||
      row.unfinishedUnderUnfinishedFlushCount >
        Math.min(row.unfinished, row.unfinishedFlushAncestorCount) ||
      row.unfinishedUnderUnfinishedFlushCount <
        Math.max(0, row.unfinished + row.unfinishedFlushAncestorCount - row.count) ||
      row.unfinishedDecoderFlushAncestorCount > row.unfinishedFlushAncestorCount ||
      row.unfinishedUnderUnfinishedDecoderFlushCount >
        Math.min(
          row.unfinished,
          row.unfinishedDecoderFlushAncestorCount,
          row.unfinishedUnderUnfinishedFlushCount,
        ) ||
      row.unfinishedUnderUnfinishedDecoderFlushCount <
        Math.max(
          0,
          row.unfinished + row.unfinishedDecoderFlushAncestorCount - row.count,
          row.unfinishedUnderUnfinishedFlushCount +
            row.unfinishedDecoderFlushAncestorCount -
            row.unfinishedFlushAncestorCount,
        ) ||
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
    'unfinishedDecoderFlushAncestorCount',
    'unfinishedUnderUnfinishedDecoderFlushCount',
  ])
    if (value.events.reduce((sum, row) => sum + row[key], 0) !== value.aggregate[key])
      fail('summary-invalid');
  const present = value.events.filter((row) => row.count > 0);
  if (
    (value.events[0].unfinished === 0 && value.aggregate.unfinishedFlushAncestorCount !== 0) ||
    value.compileLinkDiscriminator !== discriminator(value.events) ||
    ((value.events[0].unfinished === 0 ||
      value.events[3].unfinishedUnderUnfinishedFlushCount === 0) &&
      value.aggregate.unfinishedDecoderFlushAncestorCount !== 0) ||
    value.serviceApiCoverage !== serviceApiCoverage(value.events) ||
    value.serviceApiBoundaryDiscriminator !== serviceApiDiscriminator(value.events) ||
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
