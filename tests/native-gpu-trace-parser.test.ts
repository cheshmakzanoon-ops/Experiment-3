import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeNativeGpuTrace } from '../scripts/native-gpu-trace-summary.mjs';
import {
  nativeGpuTraceFixture,
  PRIVATE_TRACE_SENTINEL,
  TRACE_FIXTURE_EVENTS,
  type NativeGpuTraceFixture,
} from './fixtures/native-gpu-trace';

// Optional in normal/untraced suites, mandatory in the separate diagnostic
// workflow invocation. No browser, Electron, network or runtime download here.
const parserPath = process.env.MOTOBOUND_TRACE_PROCESSOR;
const required = process.env.MOTOBOUND_TRACE_PARSER_REQUIRED === '1';
const execute = promisify(execFile);
const parserSha256 = '58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9';

describe.skipIf(!parserPath && !required)('official pinned offline GPU trace parser', () => {
  let directory: string;

  beforeAll(async () => {
    expect(parserPath, 'Diagnostic fixture step requires the pinned parser').toBeTruthy();
    expect((await stat(parserPath!)).size).toBe(14_897_560);
    const digest = createHash('sha256')
      .update(await readFile(parserPath!))
      .digest('hex');
    expect(digest).toBe(parserSha256);
    directory = await mkdtemp(join(tmpdir(), 'motobound-trace-fixtures-'));
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function fixture(kind: NativeGpuTraceFixture) {
    const path = join(directory, `${kind}.pftrace`);
    await writeFile(path, nativeGpuTraceFixture(kind), { mode: 0o600 });
    return path;
  }

  async function query(kind: NativeGpuTraceFixture, sql: string) {
    // stdout/stderr stay private: assertions only inspect bounded fixture data,
    // and no arbitrary trace strings are included in the returned numeric row.
    const { stdout } = await execute(parserPath!, ['-Q', sql, await fixture(kind)], {
      timeout: 5000,
      maxBuffer: 16 * 1024,
      encoding: 'utf8',
    });
    return stdout.trim().split('\n');
  }

  it('decodes real GPU descriptors and exact three known duration spans', async () => {
    const rows = await query(
      'valid',
      `SELECT COUNT(*) AS event_count, SUM(s.dur) AS total_ns, MAX(s.dur) AS max_ns
       FROM slice s JOIN thread_track tt ON tt.id=s.track_id
       JOIN thread t ON t.utid=tt.utid JOIN process p ON p.upid=t.upid
       WHERE EXTRACT_ARG(p.arg_set_id,'chrome.process_type')='Gpu'
         AND s.category='gpu';`,
    );
    expect(rows).toEqual(['"event_count","total_ns","max_ns"', '3,15000000,10000000']);
  });

  it('distinguishes metadata-only and spoofed process names from actual typed GPU events', async () => {
    for (const kind of ['metadata-only', 'renderer-spoof', 'untyped-spoof'] as const) {
      const rows = await query(
        kind,
        `SELECT COUNT(*) AS event_count
         FROM slice s JOIN thread_track tt ON tt.id=s.track_id
         JOIN thread t ON t.utid=tt.utid JOIN process p ON p.upid=t.upid
         WHERE EXTRACT_ARG(p.arg_set_id,'chrome.process_type')='Gpu';`,
      );
      expect(rows, kind).toEqual(['"event_count"', '0']);
    }
  });

  it('actually decodes private names and annotations in the negative fixture', async () => {
    const rows = await query(
      'privacy-negative',
      `SELECT
       (SELECT COUNT(*) FROM slice WHERE instr(name,'${PRIVATE_TRACE_SENTINEL}')>0) AS private_names,
       (SELECT COUNT(DISTINCT s.id) FROM slice s JOIN args a ON a.arg_set_id=s.arg_set_id
        WHERE instr(a.string_value,'${PRIVATE_TRACE_SENTINEL}')>0) AS private_annotations;`,
    );
    expect(rows[0]).toBe('"private_names","private_annotations"');
    const counts = rows[1].split(',').map(Number);
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(4);
  });

  it('supports fixed numeric parser error/data-loss counters', async () => {
    const rows = await query(
      'valid',
      `SELECT
       COALESCE(SUM(CASE WHEN severity='error' THEN value ELSE 0 END),0) AS parser_errors,
       COALESCE(SUM(CASE WHEN severity='data_loss' THEN value ELSE 0 END),0) AS data_loss
       FROM stats;`,
    );
    expect(rows).toEqual(['"parser_errors","data_loss"', '0,0']);
  });

  it('runs the production summarizer on the real parser with exact duration/count receipts', async () => {
    const summary = await summarizeNativeGpuTrace({ path: await fixture('valid'), parserPath });
    expect(summary).toMatchObject({
      version: 1,
      privacy: 'constant-label-numeric-summary-only',
      parserVersion: '58.2',
      captureBytes: nativeGpuTraceFixture('valid').length,
      parseCompleted: true,
      parserErrors: 0,
      parserErrorStatRows: 165,
      reportedDataLoss: 0,
      dataLossStatRows: 22,
      otherGpuEvents: 0,
      childTailCertified: false,
      coverage: 'typed-gpu-work-observed',
      aggregate: {
        id: 0,
        processCount: 1,
        count: 3,
        completed: 3,
        unfinished: 0,
        firstNs: 0,
        lastNs: 43_000_000,
        totalDurationNs: 15_000_000,
        maxDurationNs: 10_000_000,
      },
    });
    for (const event of TRACE_FIXTURE_EVENTS) {
      expect(summary.events[event.id - 1]).toMatchObject({
        id: event.id,
        name: event.name,
        processCount: 1,
        count: 1,
        completed: 1,
        unfinished: 0,
        totalDurationNs: event.durationNs,
        maxDurationNs: event.durationNs,
      });
    }
    expect(
      (await readdir(directory)).filter((name) => name.startsWith('.gpu-trace-private-')),
    ).toEqual([]);
  });

  it.each([
    'metadata-only',
    'renderer-spoof',
    'untyped-spoof',
    'unknown-only',
    'wrong-category',
  ] as const)('does not certify %s as known typed GPU work', async (kind) => {
    const summary = await summarizeNativeGpuTrace({ path: await fixture(kind), parserPath });
    expect(summary.coverage).toBe('no-typed-gpu-work-observed');
    expect(summary.aggregate.count).toBe(0);
    expect(summary.events.every((event) => event.count === 0)).toBe(true);
    expect(summary.childTailCertified).toBe(false);
    expect(summary.otherGpuEvents).toBe(kind === 'unknown-only' ? 1 : 0);
    expect(summary.parserErrorStatRows).toBeGreaterThan(0);
    expect(summary.dataLossStatRows).toBeGreaterThan(0);
  });

  it('keeps decoded arbitrary names, annotations, labels and paths out of the real summary', async () => {
    const summary = await summarizeNativeGpuTrace({
      path: await fixture('privacy-negative'),
      parserPath,
    });
    expect(summary.coverage).toBe('typed-gpu-work-observed');
    expect(summary.aggregate.count).toBe(3);
    expect(summary.otherGpuEvents).toBe(1);
    expect(summary.events.map((event) => event.name)).toEqual(
      TRACE_FIXTURE_EVENTS.map((event) => event.name),
    );
    const receipt = JSON.stringify(summary);
    expect(receipt).not.toContain(PRIVATE_TRACE_SENTINEL);
    expect(receipt).not.toContain('/private/');
    expect(receipt).not.toContain(directory);
    expect(Buffer.byteLength(receipt)).toBeLessThanOrEqual(16 * 1024);
  });

  it('retains an unfinished real GPU span without inventing a completed duration', async () => {
    const summary = await summarizeNativeGpuTrace({
      path: await fixture('unfinished'),
      parserPath,
    });
    expect(summary.aggregate).toMatchObject({ count: 3, completed: 2, unfinished: 1 });
    expect(summary.events[2]).toMatchObject({
      count: 1,
      completed: 0,
      unfinished: 1,
      totalDurationNs: 0,
      maxDurationNs: 0,
    });
    expect(summary.childTailCertified).toBe(false);
    expect(summary.parserErrorStatRows).toBeGreaterThan(0);
    expect(summary.dataLossStatRows).toBeGreaterThan(0);
  });

  it('does not treat a real truncated metadata-free input as useful or certify its tail', async () => {
    const path = join(directory, 'truncated.pftrace');
    await writeFile(path, Buffer.from([0x0a, 0xff]), { mode: 0o600 });
    // v58.2 accepts this incomplete final packet without a parser error. The
    // positive GPU-work requirement, not process exit or file size, rejects it.
    const summary = await summarizeNativeGpuTrace({ path, parserPath });
    expect(summary.coverage).toBe('no-typed-gpu-work-observed');
    expect(summary.aggregate.count).toBe(0);
    expect(summary.otherGpuEvents).toBe(0);
    expect(summary.childTailCertified).toBe(false);
    expect(
      (await readdir(directory)).filter((name) => name.startsWith('.gpu-trace-private-')),
    ).toEqual([]);
  });

  it('rejects an oversized raw input and a raw symlink before creating parser staging', async () => {
    const large = join(directory, 'oversized.pftrace');
    await writeFile(large, Buffer.alloc(0));
    await truncate(large, 64 * 1024 * 1024 + 1); // Sparse; no oversized allocation/read.
    const link = join(directory, 'linked.pftrace');
    await symlink(await fixture('valid'), link);
    for (const path of [large, link]) {
      await expect(summarizeNativeGpuTrace({ path, parserPath })).rejects.toMatchObject({
        name: 'NativeGpuTraceSummaryError',
        reason: 'trace-size',
      });
    }
    expect(
      (await readdir(directory)).filter((name) => name.startsWith('.gpu-trace-private-')),
    ).toEqual([]);
  });

  it('rejects both wrong parser size and same-size wrong SHA without executing either binary', async () => {
    const path = await fixture('valid');
    const incorrect = join(directory, `${PRIVATE_TRACE_SENTINEL}-not-a-parser`);
    await writeFile(incorrect, Buffer.alloc(0), { mode: 0o600 });
    for (const size of [1, 14_897_560]) {
      await truncate(incorrect, size);
      await expect(summarizeNativeGpuTrace({ path, parserPath: incorrect })).rejects.toMatchObject({
        name: 'NativeGpuTraceSummaryError',
        reason: 'parser-integrity',
        message: 'Native GPU trace summary: parser-integrity',
      });
    }
  });
});
