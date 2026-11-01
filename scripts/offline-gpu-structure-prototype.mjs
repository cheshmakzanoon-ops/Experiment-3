import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import catalogue from './offline-gpu-structure-catalogue.json' with { type: 'json' };
import { NATIVE_TRACE_PROCESSOR } from './native-gpu-trace-protocol.mjs';

// OFFLINE PROTOTYPE ONLY. No launcher, recorder, CLI, file reader or integration
// with the existing V2/V3 paths. These limits bound input/output, not parser RSS.
export const OFFLINE_GPU_STRUCTURE_LIMITS = Object.freeze({
  maxInputBytes: NATIVE_TRACE_PROCESSOR.maxInputBytes,
  maxStdoutBytes: NATIVE_TRACE_PROCESSOR.maxStdoutBytes,
  maxStderrBytes: NATIVE_TRACE_PROCESSOR.maxStderrBytes,
  maxSummaryBytes: NATIVE_TRACE_PROCESSOR.maxSummaryBytes,
  processingMs: NATIVE_TRACE_PROCESSOR.processingMs,
});

const fail = () => {
  throw new Error('Offline GPU structural coverage is invalid');
};
const names = catalogue.wrappers.map(({ name }) => name);
const hashNames = (values) =>
  createHash('sha256')
    .update(values.join('\n') + '\n')
    .digest('hex');
if (
  catalogue.source !==
    'https://github.com/chromium/chromium/blob/156.0.8078.75/ui/gl/gl_bindings_autogen_gl.cc' ||
  catalogue.sourceSha256 !== 'bd48608bfbede328cec4fbb1afb320df72530940d3f69b22e86e3cecbf7e7916' ||
  catalogue.sourceBytes !== 605856 ||
  catalogue.wrapperCount !== 403 ||
  catalogue.selectedCount !== 10 ||
  catalogue.unselectedCount !== 393 ||
  names.length !== 403 ||
  new Set(names).size !== 403 ||
  names.some((name) => !/^TraceGLAPI::gl[A-Za-z0-9_]+$/.test(name)) ||
  hashNames(names) !== 'a0c7838d4eeacdec96300c1f4352a044d4c3866f4ace417f6f65b0481eb1df3c' ||
  hashNames(catalogue.selected) !==
    '2458f3a46be0846c05cc5baa4faf7985c0e81c7b45c5814faf0ed26b84bcd463' ||
  catalogue.selected.some((name) => !names.includes(name))
)
  fail();
const selected = new Set(catalogue.selected);

// Bucket 1 = selected ten; 2 = remaining 393 source-pinned wrappers;
// 3 = other gpu-token scopes, excluding the two separately counted parents.
// EXISTS joins apply to ONE child and ONE ordered decoder -> flush chain;
// aggregate timestamps, process names and event annotations are never used.
export const OFFLINE_GPU_STRUCTURE_QUERY = `
WITH catalogue(name,bucket_id) AS (VALUES
 ${names.map((name) => `('${name}',${selected.has(name) ? 1 : 2})`).join(',\n ')}
), gpu AS (
 SELECT s.id,s.track_id,s.name,s.dur,p.upid
 FROM slice s JOIN thread_track tt ON s.track_id=tt.id
 JOIN thread t ON tt.utid=t.utid JOIN process p ON t.upid=p.upid
 WHERE EXTRACT_ARG(p.arg_set_id,'chrome.process_type')='Gpu'
 AND instr(',' || s.category || ',', ',gpu,')>0
), work AS (
 SELECT COALESCE(c.bucket_id,3) AS bucket_id,s.upid,s.dur,
 EXISTS (SELECT 1 FROM ancestor_slice(s.id) d
  WHERE d.track_id=s.track_id AND d.dur=-1
   AND d.name='CommandBufferService:PutChanged'
   AND instr(',' || d.category || ',', ',gpu,')>0
   AND EXISTS (SELECT 1 FROM ancestor_slice(d.id) f
    WHERE f.track_id=d.track_id AND f.dur=-1
     AND f.name='CommandBufferStub::OnAsyncFlush'
     AND instr(',' || f.category || ',', ',gpu,')>0)) AS under_open_chain
 FROM gpu s LEFT JOIN catalogue c ON s.name=c.name
 WHERE s.name IS NULL OR s.name NOT IN ('CommandBufferStub::OnAsyncFlush','CommandBufferService:PutChanged')
), parents AS (
 SELECT CASE s.name WHEN 'CommandBufferStub::OnAsyncFlush' THEN 4 ELSE 5 END AS row_id,
 s.upid,s.dur,
 CASE WHEN s.name='CommandBufferService:PutChanged' THEN
 EXISTS (SELECT 1 FROM ancestor_slice(s.id) f
  WHERE f.track_id=s.track_id AND f.dur=-1
   AND f.name='CommandBufferStub::OnAsyncFlush'
   AND instr(',' || f.category || ',', ',gpu,')>0) ELSE 0 END AS under_open_flush
 FROM gpu s WHERE s.name IN ('CommandBufferStub::OnAsyncFlush','CommandBufferService:PutChanged')
), ids(row_id) AS (VALUES(0),(1),(2),(3)), parent_ids(row_id) AS (VALUES(4),(5))
SELECT ids.row_id,COUNT(DISTINCT w.upid) AS process_count,COUNT(w.upid) AS event_count,
 COALESCE(SUM(CASE WHEN w.dur>=0 THEN 1 ELSE 0 END),0) AS completed_count,
 COALESCE(SUM(CASE WHEN w.dur=-1 THEN 1 ELSE 0 END),0) AS unfinished_count,
 COALESCE(SUM(w.under_open_chain),0) AS ancestor_count,
 COALESCE(SUM(CASE WHEN w.dur=-1 THEN w.under_open_chain ELSE 0 END),0) AS joint_open_count
FROM ids LEFT JOIN work w ON ids.row_id=0 OR ids.row_id=w.bucket_id GROUP BY ids.row_id
UNION ALL
SELECT ids.row_id,COUNT(DISTINCT p.upid),COUNT(p.upid),
 COALESCE(SUM(CASE WHEN p.dur>=0 THEN 1 ELSE 0 END),0),
 COALESCE(SUM(CASE WHEN p.dur=-1 THEN 1 ELSE 0 END),0),
 COALESCE(SUM(p.under_open_flush),0),
 COALESCE(SUM(CASE WHEN p.dur=-1 THEN p.under_open_flush ELSE 0 END),0)
FROM parent_ids ids LEFT JOIN parents p ON ids.row_id=p.row_id GROUP BY ids.row_id
UNION ALL SELECT 6,COUNT(*),COALESCE(SUM(value),0),0,0,0,0 FROM stats WHERE severity='error'
UNION ALL SELECT 7,COUNT(*),COALESCE(SUM(value),0),0,0,0,0 FROM stats WHERE severity='data_loss'
ORDER BY row_id;
`;

const numericKeys = [
  'processCount',
  'count',
  'completed',
  'unfinished',
  'ancestorCount',
  'jointOpenCount',
];
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  Object.getOwnPropertySymbols(value).length === 0 &&
  Object.getOwnPropertyNames(value).sort().join(',') === [...keys].sort().join(',') &&
  Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (property) => 'value' in property && property.enumerable,
  );
const exactBuckets = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  Object.getPrototypeOf(value) === Array.prototype &&
  Object.getOwnPropertySymbols(value).length === 0 &&
  Object.getOwnPropertyNames(value).sort().join(',') === '0,1,2,length' &&
  Object.entries(Object.getOwnPropertyDescriptors(value)).every(
    ([key, property]) => 'value' in property && (key === 'length' || property.enumerable),
  );
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const sum = (values) => {
  const value = values.reduce((a, b) => a + b, 0);
  if (!integer(value)) fail();
  return value;
};
const coverageMask = (rows) =>
  rows.reduce((mask, row, index) => mask | (row.jointOpenCount > 0 ? 1 << index : 0), 0);

function validRow(row, id) {
  if (
    !exactKeys(row, ['id', ...numericKeys]) ||
    row.id !== id ||
    !numericKeys.every((key) => integer(row[key])) ||
    sum([row.completed, row.unfinished]) !== row.count ||
    row.processCount > row.count ||
    (row.count > 0 && row.processCount === 0) ||
    row.ancestorCount > row.count ||
    row.jointOpenCount > Math.min(row.unfinished, row.ancestorCount) ||
    row.jointOpenCount < Math.max(0, row.unfinished - (row.count - row.ancestorCount)) ||
    (row.count === 0 && numericKeys.some((key) => row[key] !== 0))
  )
    fail();
}

/** Accepts no per-event labels, durations, timestamps, IDs, paths or arguments.
 * Open descendants are captured structure, not proof of a driver stall. Even a
 * fully closed stream and zero error/loss statistics cannot certify its tail. */
export function validateOfflineGpuStructureSummary(value) {
  try {
    if (
      !exactKeys(value, [
        'schema',
        'privacy',
        'parserVersion',
        'captureBytes',
        'parseCompleted',
        'parserExitStatus',
        'catalogueCounts',
        'childTailCertified',
        'ancestryScope',
        'bucketScope',
        'coverageMask',
        'parserErrors',
        'parserErrorStatRows',
        'reportedDataLoss',
        'dataLossStatRows',
        'aggregate',
        'buckets',
        'flush',
        'decoder',
      ]) ||
      value.schema !== 'offline-gpu-structural-coverage-v1' ||
      value.privacy !== 'fixed-numeric-structure-only' ||
      value.parserVersion !== '58.2' ||
      value.parseCompleted !== true ||
      value.parserExitStatus !== 0 ||
      value.childTailCertified !== false ||
      value.ancestryScope !== 'same-instance-ordered-same-track-open-decoder-flush-not-causation' ||
      value.bucketScope !== 'gpu-token-scopes-excluding-parent-pairs' ||
      !integer(value.captureBytes) ||
      value.captureBytes < 1 ||
      value.captureBytes > OFFLINE_GPU_STRUCTURE_LIMITS.maxInputBytes ||
      !exactKeys(value.catalogueCounts, ['selected', 'unselected', 'total']) ||
      value.catalogueCounts.selected !== 10 ||
      value.catalogueCounts.unselected !== 393 ||
      value.catalogueCounts.total !== 403 ||
      !exactBuckets(value.buckets) ||
      !['parserErrors', 'parserErrorStatRows', 'reportedDataLoss', 'dataLossStatRows'].every(
        (key) => integer(value[key]),
      ) ||
      (value.parserErrorStatRows === 0 && value.parserErrors !== 0) ||
      (value.dataLossStatRows === 0 && value.reportedDataLoss !== 0)
    )
      fail();
    [value.aggregate, ...value.buckets, value.flush, value.decoder].forEach(validRow);
    // One uncovered event can account for at most one uncovered process. The
    // remaining covered processes each require their own qualified parents.
    // This is a feasibility bound, never an exported process identity/join.
    const coveredProcessLowerBound = (row) =>
      Math.max(0, row.processCount - (row.count - row.ancestorCount));
    const flushProcessCapacity = Math.min(value.flush.processCount, value.flush.unfinished);
    const chainProcessCapacity = Math.min(
      flushProcessCapacity,
      value.decoder.processCount,
      value.decoder.jointOpenCount,
    );
    if (
      value.flush.ancestorCount !== 0 ||
      value.flush.jointOpenCount !== 0 ||
      (value.decoder.ancestorCount > 0 && value.flush.unfinished === 0) ||
      (value.aggregate.ancestorCount > 0 && value.decoder.jointOpenCount === 0) ||
      coveredProcessLowerBound(value.decoder) > flushProcessCapacity ||
      [value.aggregate, ...value.buckets].some(
        (row) => coveredProcessLowerBound(row) > chainProcessCapacity,
      ) ||
      value.coverageMask !== coverageMask(value.buckets)
    )
      fail();
    for (const key of numericKeys.filter((key) => key !== 'processCount'))
      if (value.aggregate[key] !== sum(value.buckets.map((row) => row[key]))) fail();
    if (
      value.aggregate.processCount < Math.max(...value.buckets.map((row) => row.processCount)) ||
      value.aggregate.processCount > sum(value.buckets.map((row) => row.processCount)) ||
      Buffer.byteLength(JSON.stringify(value)) > OFFLINE_GPU_STRUCTURE_LIMITS.maxSummaryBytes
    )
      fail();
    return value;
  } catch {
    // Never reflect malformed schema, raw values or getter/parser messages.
    fail();
  }
}

export function decodeOfflineGpuStructureRows(stdout, captureBytes) {
  try {
    if (
      typeof stdout !== 'string' ||
      Buffer.byteLength(stdout) > OFFLINE_GPU_STRUCTURE_LIMITS.maxStdoutBytes
    )
      fail();
    const lines = stdout.trim().split(/\r?\n/);
    const header =
      'row_id,process_count,event_count,completed_count,unfinished_count,ancestor_count,joint_open_count';
    if (
      lines.length !== 9 ||
      (lines[0] !== header &&
        lines[0] !==
          header
            .split(',')
            .map((part) => `"${part}"`)
            .join(','))
    )
      fail();
    const rows = lines.slice(1).map((line, index) => {
      if (!/^(0|[1-9]\d*)(,(0|[1-9]\d*)){6}$/.test(line)) fail();
      const row = line.split(',').map(Number);
      if (!row.every(integer) || row[0] !== index) fail();
      return row;
    });
    if (rows.slice(6).some((row) => row.slice(3).some((value) => value !== 0))) fail();
    const event = (row) =>
      Object.fromEntries(['id', ...numericKeys].map((key, index) => [key, row[index]]));
    const buckets = rows.slice(1, 4).map(event);
    return validateOfflineGpuStructureSummary({
      schema: 'offline-gpu-structural-coverage-v1',
      privacy: 'fixed-numeric-structure-only',
      parserVersion: '58.2',
      captureBytes,
      parseCompleted: true,
      parserExitStatus: 0,
      catalogueCounts: { selected: 10, unselected: 393, total: 403 },
      childTailCertified: false,
      ancestryScope: 'same-instance-ordered-same-track-open-decoder-flush-not-causation',
      bucketScope: 'gpu-token-scopes-excluding-parent-pairs',
      coverageMask: coverageMask(buckets),
      parserErrors: rows[6][2],
      parserErrorStatRows: rows[6][1],
      reportedDataLoss: rows[7][2],
      dataLossStatRows: rows[7][1],
      aggregate: event(rows[0]),
      buckets,
      flush: event(rows[4]),
      decoder: event(rows[5]),
    });
  } catch {
    fail();
  }
}
