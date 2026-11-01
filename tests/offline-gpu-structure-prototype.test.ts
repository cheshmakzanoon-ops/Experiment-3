import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import catalogue from '../scripts/offline-gpu-structure-catalogue.json';
import {
  OFFLINE_GPU_STRUCTURE_QUERY,
  OFFLINE_GPU_STRUCTURE_LIMITS as limits,
  decodeOfflineGpuStructureRows,
  validateOfflineGpuStructureSummary,
  type OfflineGpuStructureSummary,
} from '../scripts/offline-gpu-structure-prototype.mjs';
import { NATIVE_GPU_SERVICE_API_EVENTS } from '../scripts/native-gpu-service-api-summary.mjs';
import {
  NATIVE_GPU_TRACE_QUERY,
  summarizeNativeGpuTrace,
} from '../scripts/native-gpu-trace-summary.mjs';
import {
  STRUCTURE_PRIVATE,
  structuralTraceFixture,
  type StructuralOperation as Op,
  type StructuralTraceOptions,
} from './fixtures/offline-gpu-structure-trace';

const parserPath = process.env.MOTOBOUND_TRACE_PROCESSOR;
const required = process.env.MOTOBOUND_TRACE_PARSER_REQUIRED === '1';
const error = 'Offline GPU structural coverage is invalid';
const flush = 'CommandBufferStub::OnAsyncFlush';
const decoder = 'CommandBufferService:PutChanged';
const selected = 'TraceGLAPI::glDrawElements';
const unselected = 'TraceGLAPI::glClear';
const begin = (name: string, track = 2, category = 'gpu', annotation?: string): Op => ({
  kind: 'begin',
  name,
  track,
  category,
  annotation,
});
const end = (track = 2): Op => ({ kind: 'end', track });
const chain = (name = unselected): Op[] => [begin(flush), begin(decoder), begin(name)];

// Synthetic files only. Fixed query, no shell, 5-second process deadline,
// 16KiB stdout, 4KiB discarded stderr. These are not process RSS limits.
function boundedQuery(path: string, sql = OFFLINE_GPU_STRUCTURE_QUERY) {
  return new Promise<string>((resolve, reject) => {
    const deadlineAt = Date.now() + limits.processingMs;
    const child = spawn(parserPath!, ['-Q', sql, path], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      outBytes = 0,
      errBytes = 0,
      failed = false;
    const kill = () => {
      failed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* settle on close */
      }
    };
    const timer = setTimeout(kill, limits.processingMs);
    child.on('error', () => {
      failed = true;
    });
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > limits.maxStdoutBytes) kill();
      else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > limits.maxStderrBytes) kill();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0 || Date.now() >= deadlineAt)
        reject(new Error('Offline synthetic parser failed'));
      else resolve(stdout);
    });
  });
}

describe.skipIf(!parserPath && !required)('pinned real-parser offline structural prototype', () => {
  let directory: string;
  let sequence = 0;
  beforeAll(async () => {
    expect(
      parserPath,
      'The explicit offline fixture invocation requires the pinned parser',
    ).toBeTruthy();
    expect((await stat(parserPath!)).size).toBe(14_897_560);
    expect(
      createHash('sha256')
        .update(await readFile(parserPath!))
        .digest('hex'),
    ).toBe('58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9');
    directory = await mkdtemp(join(tmpdir(), 'gpu-structure-synthetic-'));
  });
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function fixture(ops: Op[], options: StructuralTraceOptions = {}) {
    const bytes = structuralTraceFixture(ops, options);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThanOrEqual(limits.maxInputBytes);
    const path = join(directory, `synthetic-${++sequence}.pftrace`);
    await writeFile(path, bytes, { mode: 0o600 });
    return { path, bytes: bytes.length };
  }
  async function summarize(ops: Op[], options: StructuralTraceOptions = {}) {
    const input = await fixture(ops, options);
    const csv = await boundedQuery(input.path);
    const summary = decodeOfflineGpuStructureRows(csv, input.bytes);
    expect(summary.childTailCertified).toBe(false);
    expect(Buffer.byteLength(csv)).toBeLessThanOrEqual(limits.maxStdoutBytes);
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(limits.maxSummaryBytes);
    expect(JSON.stringify(summary)).not.toMatch(
      /PRIVATE_|TraceGLAPI|CommandBuffer|CrGpuMain|\/private\/|upid|utid|track_id|arg_set_id/,
    );
    return summary;
  }
  it('adds information when all selected wrappers are closed but one omitted wrapper is open under the same chain', async () => {
    const ops = [begin(flush), begin(decoder), begin(selected), end(), begin(unselected)];
    const input = await fixture(ops);
    const original = await summarizeNativeGpuTrace({
      path: input.path,
      parserPath,
      serviceApiMode: 'service-api-boundary-v1',
    });
    expect(original.version).toBe(3);
    if (original.version !== 3) throw new Error('Wrong retained schema');
    expect(original.serviceApiCoverage).toBe('typed-gpu-service-api-observed');
    expect(original.serviceApiBoundaryDiscriminator).toBe('inconclusive');
    expect(original.otherGpuEvents).toBe(1);
    const result = await summarize(ops);
    expect(result.coverageMask).toBe(2);
    expect(result.buckets[0]).toMatchObject({
      count: 1,
      completed: 1,
      unfinished: 0,
      ancestorCount: 1,
      jointOpenCount: 0,
    });
    expect(result.buckets[1]).toMatchObject({
      count: 1,
      completed: 0,
      unfinished: 1,
      ancestorCount: 1,
      jointOpenCount: 1,
    });
    expect(result.decoder).toMatchObject({ count: 1, unfinished: 1, jointOpenCount: 1 });
  });
  it('classifies all403 source-pinned names into exactly10 and393 without emitting any names', async () => {
    const ops: Op[] = catalogue.wrappers.flatMap(({ name }) => [begin(name), end()]);
    const result = await summarize(ops);
    expect(result.aggregate).toMatchObject({ count: 403, completed: 403, unfinished: 0 });
    expect(result.buckets.map((r) => r.count)).toEqual([10, 393, 0]);
    expect(result.coverageMask).toBe(0);
    expect(result.parserErrors).toBe(0);
    expect(result.reportedDataLoss).toBe(0);
  });
  it.each([
    [selected, 1],
    [unselected, 2],
    [STRUCTURE_PRIVATE, 4],
  ] as const)(
    'reports only a numeric joint-coverage bit for an open child in bucket %s',
    async (name, mask) => {
      const result = await summarize(chain(name));
      expect(result.coverageMask).toBe(mask);
      expect(result.aggregate).toMatchObject({
        count: 1,
        unfinished: 1,
        ancestorCount: 1,
        jointOpenCount: 1,
      });
    },
  );
  it('preserves simultaneous bucket evidence rather than choosing a causal winner', async () => {
    const result = await summarize([
      ...chain(selected),
      begin(unselected),
      begin(STRUCTURE_PRIVATE),
    ]);
    expect(result.coverageMask).toBe(7);
    expect(result.buckets.map((r) => r.jointOpenCount)).toEqual([1, 1, 1]);
  });
  it('does not multiply children by duplicate qualifying ancestor pairs', async () => {
    const result = await summarize([
      begin(flush),
      begin(flush),
      begin(decoder),
      begin(decoder),
      begin(unselected),
    ]);
    expect(result.buckets[1].jointOpenCount).toBe(1);
    expect(result.flush.count).toBe(2);
    expect(result.decoder.jointOpenCount).toBe(2);
  });
  it('preserves separate qualified chains in two typed GPU processes', async () => {
    const result = await summarize([
      ...chain(),
      begin(flush, 5),
      begin(decoder, 5),
      begin(unselected, 5),
    ]);
    expect(result.aggregate).toMatchObject({
      count: 2,
      processCount: 2,
      ancestorCount: 2,
      jointOpenCount: 2,
    });
    expect(result.flush.processCount).toBe(2);
    expect(result.decoder.jointOpenCount).toBe(2);
  });
  it('allows one covered process alongside another process with an unrelated completed instance', async () => {
    const result = await summarize([...chain(), begin(unselected, 5), end(5)]);
    expect(result.buckets[1]).toMatchObject({
      count: 2,
      processCount: 2,
      ancestorCount: 1,
      jointOpenCount: 1,
    });
    expect(result.decoder.jointOpenCount).toBe(1);
  });
  it('includes an unnamed gpu scope in otherGPU without exporting its name or identity', async () => {
    const ops: Op[] = [begin(flush), begin(decoder), { kind: 'begin', category: 'gpu' }];
    const input = await fixture(ops);
    expect(
      (
        await boundedQuery(
          input.path,
          "SELECT COUNT(*) AS n FROM slice WHERE name IS NULL AND category='gpu';",
        )
      ).trim(),
    ).toBe('"n"\n1');
    const result = await summarize(ops);
    expect(result.buckets.map((row) => row.count)).toEqual([0, 0, 1]);
    expect(result.coverageMask).toBe(4);
  });
  const negatives: [string, Op[]][] = [
    ['no parents', [begin(unselected)]],
    ['no flush', [begin(decoder), begin(unselected)]],
    ['no decoder', [begin(flush), begin(unselected)]],
    ['reversed ancestry', [begin(decoder), begin(flush), begin(unselected)]],
    ['cross-track child', [begin(flush), begin(decoder), begin(unselected, 3)]],
    ['cross-track decoder', [begin(flush), begin(decoder, 3), begin(unselected, 3)]],
    ['three unrelated tracks', [begin(flush), begin(decoder, 3), begin(unselected, 4)]],
    ['another typed GPU process', [begin(flush), begin(decoder), begin(unselected, 5)]],
    ['closed decoder', [...chain(), end(), end(), begin(unselected)]],
    ['closed flush', [...chain(), end(), end(), end(), begin(unselected)]],
    ['closed child and unrelated open instance', [...chain(), end(), begin(unselected, 3)]],
    [
      'closed ancestor and unrelated open ancestor',
      [begin(flush), begin(decoder), end(), begin(decoder, 3), begin(unselected, 3)],
    ],
  ];
  it.each(negatives)('cannot manufacture an open joint from %s', async (_name, ops) => {
    const result = await summarize(ops);
    expect(result.buckets[1].count).toBeGreaterThan(0);
    expect(result.buckets[1].jointOpenCount).toBe(0);
    expect(result.coverageMask).toBe(0);
  });
  it('distinguishes mixed-instance marginal counts without joining them into a positive', async () => {
    const result = await summarize([...chain(), end(), begin(unselected, 3)]);
    expect(result.buckets[1]).toMatchObject({
      count: 2,
      completed: 1,
      unfinished: 1,
      ancestorCount: 1,
      jointOpenCount: 0,
    });
  });
  it('counts the parents separately without letting either parent be its own child', async () => {
    const result = await summarize([begin(flush), begin(decoder)]);
    expect(result.aggregate.count).toBe(0);
    expect(result.coverageMask).toBe(0);
    expect(result.flush.count).toBe(1);
    expect(result.decoder.jointOpenCount).toBe(1);
  });
  it.each([
    'gpu.angle',
    'gpu.fake',
    'fakegpu',
    ' gpu',
    'GPU',
    'gpu_',
    'gpu;gpu',
    'notgpu,gpu.angle',
  ])('rejects a category-token spoof %s independently at all three levels', async (category) => {
    for (const index of [0, 1, 2]) {
      const ops = chain().map((op, i) => (i === index ? { ...op, category } : op));
      const result = await summarize(ops);
      expect(result.coverageMask).toBe(0);
      if (index === 2) expect(result.aggregate.count).toBe(0);
    }
  });
  it('accepts gpu as an exact token in a multi-category list', async () => {
    const result = await summarize(
      chain().map((op) => ({ ...op, category: 'gpu.angle,gpu,gpu.service' })),
    );
    expect(result.coverageMask).toBe(2);
  });
  it.each([2, null] as const)(
    'ignores misleading process/thread names when typed process identity is %s',
    async (processType) => {
      const result = await summarize(chain(), { processType, processName: 'Gpu' });
      expect(result.aggregate.count).toBe(0);
      expect(result.flush.count).toBe(0);
      expect(result.decoder.count).toBe(0);
    },
  );
  it('does not recognize wrapper names contained only in annotations or unknown suffixes', async () => {
    const result = await summarize([
      begin(flush),
      begin(decoder),
      begin(STRUCTURE_PRIVATE, 2, 'gpu', unselected),
      begin(unselected + 'NotPinned'),
      begin('glClear'),
    ]);
    expect(result.buckets.map((r) => r.count)).toEqual([0, 0, 3]);
    expect(result.coverageMask).toBe(4);
  });
  it('remains noncertifying when every captured scope is closed and all reported stats are zero', async () => {
    const result = await summarize([...chain(), end(), end(), end()], { overwrittenChunks: 0 });
    expect(result.coverageMask).toBe(0);
    expect(result.aggregate.completed).toBe(1);
    expect(result.parserErrors).toBe(0);
    expect(result.reportedDataLoss).toBe(0);
    expect(result.childTailCertified).toBe(false);
  });
  it('cannot distinguish a missing final BEGIN from genuinely absent wrapper work', async () => {
    // Dropping a final packet containing BEGIN leaves exactly the same bytes
    // as a stream where that call had not begun. No query can recover it.
    const result = await summarize(chain().slice(0, -1));
    expect(result.decoder.jointOpenCount).toBe(1);
    expect(result.aggregate.count).toBe(0);
    expect(result.coverageMask).toBe(0);
    expect(result.parserErrors).toBe(0);
    expect(result.reportedDataLoss).toBe(0);
  });
  it('a missing final END yields observed openness, not proof the API remained executing', async () => {
    const result = await summarize(chain());
    expect(result.buckets[1].jointOpenCount).toBe(1);
    expect(result.childTailCertified).toBe(false);
  });
  it('does not mistake zero severity-loss aggregate for absence of buffer overwrite', async () => {
    const ops = [...chain(), end(), end(), end()];
    const input = await fixture(ops, { overwrittenChunks: 7 });
    // The actual pinned parser classifies this buffer counter as informational,
    // not severity=data_loss. This fixed numeric projection proves that the
    // zero aggregate below is NOT evidence of a complete buffer or final tail.
    expect(
      (
        await boundedQuery(
          input.path,
          "SELECT COUNT(*) AS rows,COALESCE(SUM(value),0) AS n,COALESCE(SUM(CASE WHEN severity='data_loss' THEN value ELSE 0 END),0) AS loss FROM stats WHERE name='traced_buf_chunks_overwritten';",
        )
      ).trim(),
    ).toBe('"rows","n","loss"\n1,7,0');
    const result = await summarize(ops, { overwrittenChunks: 7 });
    expect(result.reportedDataLoss).toBe(0);
    expect(result.coverageMask).toBe(0);
    expect(result.childTailCertified).toBe(false);
  });
  it('a real final-flush-success stat still cannot certify an omitted child tail', async () => {
    const ops = [begin(flush), begin(decoder)];
    const input = await fixture(ops, { finalFlush: 1 });
    expect(
      (
        await boundedQuery(
          input.path,
          "SELECT COALESCE(SUM(value),0) AS n FROM stats WHERE name='traced_final_flush_succeeded';",
        )
      ).trim(),
    ).toBe('"n"\n1');
    const result = await summarize(ops, { finalFlush: 1 });
    expect(result.coverageMask).toBe(0);
    expect(result.reportedDataLoss).toBe(0);
    expect(result.childTailCertified).toBe(false);
  });
  it('retains final-flush failure as reported data loss without inventing a boundary', async () => {
    const result = await summarize([begin(flush), begin(decoder)], { finalFlush: 2 });
    expect(result.reportedDataLoss).toBeGreaterThanOrEqual(1);
    expect(result.coverageMask).toBe(0);
  });
  it('does not certify a final truncated packet that this pinned parser silently tolerates', async () => {
    // A valid stream followed by 0x0a,0xff is a physically incomplete final
    // protobuf packet. Pinned58.2 still emits its earlier rows and zero stats.
    // Preserve that limitation instead of claiming every malformed tail fails.
    const result = await summarize(chain(), { truncatePacket: true });
    expect(result.coverageMask).toBe(2);
    expect(result.parserErrors).toBe(0);
    expect(result.reportedDataLoss).toBe(0);
    expect(result.childTailCertified).toBe(false);
  });
  it('does not expose diagnostics when the actual parser rejects a synthetic query', async () => {
    const input = await fixture(chain());
    await expect(
      boundedQuery(input.path, 'SELECT PRIVATE_STRUCTURE_INVALID_SQL FROM;'),
    ).rejects.toThrow(/^Offline synthetic parser failed$/);
  });
});

const header =
  'row_id,process_count,event_count,completed_count,unfinished_count,ancestor_count,joint_open_count';
const validRows = () => [
  [0, 1, 2, 1, 1, 2, 1],
  [1, 1, 1, 1, 0, 1, 0],
  [2, 1, 1, 0, 1, 1, 1],
  [3, 0, 0, 0, 0, 0, 0],
  [4, 1, 1, 0, 1, 0, 0],
  [5, 1, 1, 0, 1, 1, 1],
  [6, 165, 0, 0, 0, 0, 0],
  [7, 22, 0, 0, 0, 0, 0],
];
const csv = (rows = validRows()) =>
  header + '\n' + rows.map((row) => row.join(',')).join('\n') + '\n';
const valid = () => decodeOfflineGpuStructureRows(csv(), 1024);

describe('strict bounded numeric structural schema and isolation', () => {
  it('retains the exact existing limits without claiming an address-space/RSS cap', () => {
    expect(limits).toEqual({
      maxInputBytes: 67108864,
      maxStdoutBytes: 16384,
      maxStderrBytes: 4096,
      maxSummaryBytes: 16384,
      processingMs: 5000,
    });
    expect(Object.isFrozen(limits)).toBe(true);
  });
  it('pins403 unique static wrappers and the exact existing selected ten', () => {
    expect(catalogue.wrappers).toHaveLength(403);
    expect(new Set(catalogue.wrappers.map((r) => r.name)).size).toBe(403);
    expect(catalogue.selected).toEqual(NATIVE_GPU_SERVICE_API_EVENTS.map((row) => row.name));
    expect(catalogue.wrappers.filter((row) => !catalogue.selected.includes(row.name))).toHaveLength(
      393,
    );
    expect(
      createHash('sha256')
        .update(catalogue.wrappers.map((r) => r.name).join('\n') + '\n')
        .digest('hex'),
    ).toBe(catalogue.namesSha256);
    expect(createHash('sha256').update(NATIVE_GPU_TRACE_QUERY).digest('hex')).toBe(
      'b4a1c214b63de669bdf4132826add06aff40e63a38b3de01bde46fea8f56c81e',
    );
  });
  it('accepts only the separate fixed schema and derives the joint coverage mask', () => {
    const result = valid();
    expect(result.coverageMask).toBe(2);
    expect(result.schema).toBe('offline-gpu-structural-coverage-v1');
    expect(validateOfflineGpuStructureSummary(result)).toBe(result);
    expect(
      decodeOfflineGpuStructureRows(
        csv().replace(
          header,
          header
            .split(',')
            .map((x) => '"' + x + '"')
            .join(','),
        ),
        1024,
      ),
    ).toEqual(result);
  });
  it.each([0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER, 67108865, 0.5])(
    'rejects invalid captureBytes %s',
    (value) => {
      expect(() => decodeOfflineGpuStructureRows(csv(), value)).toThrow(error);
    },
  );
  it.each([undefined, null, {}, '', STRUCTURE_PRIVATE, 'x'.repeat(16385)])(
    'does not reflect malformed/oversized CSV',
    (value) => {
      expect(() => decodeOfflineGpuStructureRows(value, 1)).toThrow(error);
    },
  );
  it.each(['-1', '1.5', '1e3', 'NaN', 'Infinity', '9007199254740992', '01', 'PRIVATE_VALUE'])(
    'rejects noncanonical or unsafe numeric output %s',
    (number) => {
      const rows = csv().replace('0,1,2,1,1,2,1', `0,1,${number},1,1,2,1`);
      expect(() => decodeOfflineGpuStructureRows(rows, 1)).toThrow(error);
    },
  );
  it('rejects missing/reordered/duplicate/extra rows and nonzero reserved stat cells', () => {
    for (const mutate of [
      (rows: number[][]) => rows.slice(1),
      (rows: number[][]) => [rows[1], rows[0], ...rows.slice(2)],
      (rows: number[][]) => [...rows, rows[7]],
      (rows: number[][]) =>
        rows.map((row, i) => (i === 6 ? [...row.slice(0, 3), 1, 0, 0, 0] : row)),
    ])
      expect(() => decodeOfflineGpuStructureRows(csv(mutate(validRows())), 1)).toThrow(error);
  });
  const invalidSummary: [string, (x: OfflineGpuStructureSummary) => void][] = [
    [
      'tail certification',
      (x) => {
        (x as unknown as { childTailCertified: boolean }).childTailCertified = true;
      },
    ],
    [
      'another schema',
      (x) => {
        Object.assign(x, { schema: 'native-v3' });
      },
    ],
    [
      'unknown key',
      (x) => {
        Object.assign(x, { name: STRUCTURE_PRIVATE });
      },
    ],
    [
      'unknown nested key',
      (x) => {
        Object.assign(x.buckets[1], { args: STRUCTURE_PRIVATE });
      },
    ],
    [
      'wrong mask',
      (x) => {
        x.coverageMask = 1;
      },
    ],
    [
      'wrong id',
      (x) => {
        x.buckets[1].id = 1;
      },
    ],
    [
      'negative count',
      (x) => {
        x.buckets[1].count = -1;
      },
    ],
    [
      'fractional count',
      (x) => {
        x.buckets[1].count = 0.5;
      },
    ],
    [
      'unsafe count',
      (x) => {
        x.buckets[1].count = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'nonfinite count',
      (x) => {
        x.buckets[1].count = Infinity;
      },
    ],
    [
      'mismatched partition',
      (x) => {
        x.aggregate.count = 3;
      },
    ],
    [
      'joint beyond unfinished',
      (x) => {
        x.buckets[0].jointOpenCount = 1;
      },
    ],
    [
      'joint beyond ancestry',
      (x) => {
        x.buckets[1].ancestorCount = 0;
      },
    ],
    [
      'impossible intersection lower bound',
      (x) => {
        x.buckets[1].jointOpenCount = 0;
      },
    ],
    [
      'no typed process',
      (x) => {
        x.buckets[1].processCount = 0;
      },
    ],
    [
      'process union too small',
      (x) => {
        x.aggregate.processCount = 0;
      },
    ],
    [
      'process union too large',
      (x) => {
        x.aggregate.processCount = 3;
      },
    ],
    [
      'self-parent ancestry',
      (x) => {
        x.flush.ancestorCount = 1;
      },
    ],
    [
      'closed required flush',
      (x) => {
        x.flush.unfinished = 0;
        x.flush.completed = 1;
      },
    ],
    [
      'no open decoder chain',
      (x) => {
        x.decoder.jointOpenCount = 0;
        x.decoder.ancestorCount = 0;
      },
    ],
    [
      'stat sum without rows',
      (x) => {
        x.parserErrors = 1;
        x.parserErrorStatRows = 0;
      },
    ],
    [
      'loss sum without rows',
      (x) => {
        x.reportedDataLoss = 1;
        x.dataLossStatRows = 0;
      },
    ],
    [
      'wrong catalogue cardinality',
      (x) => {
        Object.assign(x.catalogueCounts, { unselected: 392 });
      },
    ],
    [
      'extra bucket',
      (x) => {
        x.buckets.push({ ...x.buckets[0] });
      },
    ],
  ];
  it.each(invalidSummary)(
    'rejects %s instead of emitting private or inconsistent output',
    (_name, mutate) => {
      const value = valid();
      mutate(value);
      expect(() => validateOfflineGpuStructureSummary(value)).toThrow(error);
    },
  );
  it('does not reflect arbitrary getter exceptions', () => {
    const value = valid();
    Object.defineProperty(value, 'captureBytes', {
      get() {
        throw new Error(STRUCTURE_PRIVATE);
      },
      enumerable: true,
    });
    expect(() => validateOfflineGpuStructureSummary(value)).toThrow(
      /^Offline GPU structural coverage is invalid$/,
    );
  });
  it('rejects parent/process impossibilities without exporting process identities', () => {
    const aggregate = valid();
    aggregate.aggregate.processCount = 2;
    expect(() => validateOfflineGpuStructureSummary(aggregate)).toThrow(error);
    const parents = valid();
    Object.assign(parents.decoder, {
      count: 2,
      unfinished: 2,
      ancestorCount: 2,
      jointOpenCount: 2,
      processCount: 2,
    });
    expect(() => validateOfflineGpuStructureSummary(parents)).toThrow(error);
  });
  it('rejects a sparse maximum-length array before iteration or allocation', () => {
    const value = valid();
    value.buckets.length = 4_294_967_295;
    expect(() => validateOfflineGpuStructureSummary(value)).toThrow(error);
  });
  it('rejects required fields hidden from JSON serialization', () => {
    for (const scope of ['root', 'row', 'array'] as const) {
      const value = valid();
      const [object, key] =
        scope === 'root'
          ? [value, 'schema']
          : scope === 'row'
            ? [value.buckets[1], 'count']
            : [value.buckets, '0'];
      Object.defineProperty(object, key, { enumerable: false });
      expect(() => validateOfflineGpuStructureSummary(value)).toThrow(error);
    }
  });
  it('rejects hidden, inherited, symbol and array-side-channel fields', () => {
    const mutations = [
      (value: OfflineGpuStructureSummary) =>
        Object.defineProperty(value, 'hidden', { value: STRUCTURE_PRIVATE }),
      (value: OfflineGpuStructureSummary) =>
        Object.setPrototypeOf(value, { privateName: STRUCTURE_PRIVATE }),
      (value: OfflineGpuStructureSummary) =>
        Object.assign(value, { [Symbol('private')]: STRUCTURE_PRIVATE }),
      (value: OfflineGpuStructureSummary) =>
        Object.assign(value.buckets, { privateName: STRUCTURE_PRIVATE }),
      (value: OfflineGpuStructureSummary) =>
        Object.defineProperty(value.buckets, 'hidden', { value: STRUCTURE_PRIVATE }),
      (value: OfflineGpuStructureSummary) =>
        Object.defineProperty(value.buckets, '0', {
          get() {
            throw new Error(STRUCTURE_PRIVATE);
          },
        }),
      (value: OfflineGpuStructureSummary) => {
        delete (value.buckets as (unknown | undefined)[])[1];
      },
    ];
    for (const mutate of mutations) {
      const value = valid();
      mutate(value);
      expect(() => validateOfflineGpuStructureSummary(value)).toThrow(error);
    }
  });
  it('adds no launcher, raw reader, category, command-line or workflow capability', async () => {
    const source = await readFile(
      new URL('../scripts/offline-gpu-structure-prototype.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(
      /node:(?:child_process|fs)|process\.argv|process\.env|spawn\(|execFile\(|enable-gpu-service-tracing|workflow_dispatch/,
    );
  });
});
