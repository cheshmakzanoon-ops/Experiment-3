import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { type spawn } from 'node:child_process';
import { type createReadStream } from 'node:fs';
import { mkdtemp, rm, truncate, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeNativeGpuTraceRows,
  validateNativeGpuTraceSummary,
  runBoundedTraceProcessor,
  verifyNativeTraceProcessor,
  summarizeNativeGpuTrace,
  NATIVE_TRACE_PROCESSOR,
  NATIVE_GPU_TRACE_QUERY,
  NATIVE_GPU_WORK_EVENTS,
  NativeGpuTraceSummaryError,
} from '../scripts/native-gpu-trace-summary.mjs';
import {
  createNativeGpuTrace,
  retainNativeGpuTraceSummary,
  type NativeGpuTraceOutput,
} from '../scripts/native-gpu-trace.mjs';
import { createFirstGraphicsFault } from '../scripts/native-smoke-control.mjs';

const csv = [
  '"event_id","process_count","event_count","completed_count","unfinished_count","first_ns","last_ns","total_ns","max_ns","unfinished_flush_ancestor_count","unfinished_under_unfinished_flush_count"',
  '0,1,3,2,1,0,43,12,10,0,0',
  '1,1,1,1,0,0,10,10,10,0,0',
  '2,1,1,1,0,20,22,2,2,0,0',
  '3,1,1,0,1,43,43,0,0,0,0',
  ...Array.from({ length: 6 }, (_, index) => `${index + 4},0,0,0,0,0,0,0,0,0,0`),
  '10,2,0,0,0,0,0,0,0,0,0',
  '11,0,0,0,0,0,0,0,0,0,0',
  '12,0,4,0,0,0,0,0,0,0,0',
].join('\n');
const output: NativeGpuTraceOutput = {
  retained: true,
  file: 'gpu-trace-summary.json',
  bytes: 10,
  sha256: '0'.repeat(64),
  rawTraceUploaded: false,
  captureValid: true,
  parsed: true,
  gpuWorkObserved: true,
};
afterEach(() => vi.useRealTimers());

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  const spawnProcess = vi.fn(() => child) as unknown as typeof spawn;
  return { child, spawnProcess };
}

describe('private constant-labelled trace summary', () => {
  it('retains bounded work, unknown-event count and absent-stat uncertainty separately', () => {
    const summary = decodeNativeGpuTraceRows(csv, 100);
    expect(summary).toMatchObject({
      coverage: 'typed-gpu-work-observed',
      parserErrors: 0,
      parserErrorStatRows: 2,
      reportedDataLoss: 0,
      dataLossStatRows: 0,
      otherGpuEvents: 4,
      childTailCertified: false,
      aggregate: { count: 3, unfinished: 1, totalDurationNs: 12 },
    });
    // A missing statistic is unknown, not evidence of known zero loss.
    const present = decodeNativeGpuTraceRows(csv.replace('11,0,0,', '11,3,0,'), 100);
    expect(present.dataLossStatRows).toBe(3);
    expect(present.reportedDataLoss).toBe(0);
  });

  it.each([
    csv + '\n13,0,0,0,0,0,0,0,0,0',
    csv.replace('12,0,4,', '12,0,PRIVATE_TRACE_SECRET,'),
    csv.replace('12,0,4,', '12,0,9007199254740992,'),
    csv.replace('12,0,4,', '12,0,-1,'),
    csv.replace('12,0,4,', '12,0,1e4,'),
    csv.replace('12,0,4,', '12,1,4,'),
    csv.replace('11,0,0,', '11,0,2,'),
  ])('rejects malformed or inconsistent numeric rows without echoing input', (rows) => {
    expect(() => decodeNativeGpuTraceRows(rows, 100)).toThrow(
      /^Native GPU trace summary: (parser-rows|summary-invalid)$/,
    );
  });

  it('rejects arbitrary summary keys, labels, paths, impossible totals and false tail certainty', () => {
    const valid = decodeNativeGpuTraceRows(csv, 100);
    for (const mutate of [
      (s: Record<string, unknown>) => {
        s.private = '/private/SECRET';
      },
      (s: Record<string, unknown>) => {
        s.childTailCertified = true;
      },
      (s: Record<string, unknown>) => {
        s.parserVersion = 'secret';
      },
      (s: Record<string, unknown>) => {
        s.captureBytes = NATIVE_TRACE_PROCESSOR.maxInputBytes + 1;
      },
    ]) {
      const copy = structuredClone(valid) as unknown as Record<string, unknown>;
      mutate(copy);
      expect(() => validateNativeGpuTraceSummary(copy)).toThrow('summary-invalid');
    }
    for (const key of ['firstNs', 'lastNs', 'maxDurationNs', 'totalDurationNs', 'count'] as const) {
      const copy = structuredClone(valid);
      copy.aggregate[key]++;
      expect(() => validateNativeGpuTraceSummary(copy)).toThrow('summary-invalid');
    }
    const copy = structuredClone(valid);
    copy.events[0].name = '/private/SECRET';
    expect(() => validateNativeGpuTraceSummary(copy)).toThrow('summary-invalid');
  });

  it('pins exactly nine immutable category/name pairs with no input-driven labels', () => {
    expect(NATIVE_GPU_WORK_EVENTS).toEqual([
      { category: 'gpu', name: 'CommandBufferStub::OnAsyncFlush' },
      { category: 'gpu', name: 'CommandBufferStub::PerformWork' },
      { category: 'gpu', name: 'Scheduler::RunTask' },
      { category: 'gpu', name: 'CommandBufferService:PutChanged' },
      { category: 'gpu', name: 'GLES2DecoderPassthroughImpl::DoLinkProgram' },
      { category: 'gpu.angle', name: 'CompileEvent::wait' },
      { category: 'gpu.angle', name: 'Program::MainLinkLoadEvent::wait' },
      { category: 'gpu.angle', name: 'ProgramGL::linkJobImpl' },
      { category: 'gpu.angle', name: 'ProgramGL::postLinkJobImpl' },
    ]);
    expect(Object.isFrozen(NATIVE_GPU_WORK_EVENTS)).toBe(true);
    expect(NATIVE_GPU_WORK_EVENTS.every(Object.isFrozen)).toBe(true);
    const summary = decodeNativeGpuTraceRows(csv, 100);
    expect(summary.version).toBe(2);
    expect(summary.events.map(({ category, name }) => ({ category, name }))).toEqual(
      NATIVE_GPU_WORK_EVENTS,
    );
    expect(summary.compileLinkDiscriminator).toBe('inconclusive');
    expect(summary.aggregate.unfinishedFlushAncestorCount).toBe(0);
  });

  it('requires joint open compile/link ancestry separately from generic coverage or unrelated open instances', () => {
    const rows = Array.from({ length: 13 }, (_, id) => [id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    rows[0] = [0, 1, 3, 1, 2, 0, 20, 5, 5, 2, 1];
    rows[1] = [1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0];
    rows[4] = [4, 1, 1, 1, 0, 10, 15, 5, 5, 1, 0];
    rows[5] = [5, 1, 1, 0, 1, 20, 20, 0, 0, 1, 1];
    const decode = () =>
      decodeNativeGpuTraceRows(
        [csv.split('\n')[0], ...rows.map((row) => row.join(','))].join('\n'),
        100,
      );
    expect(decode()).toMatchObject({
      coverage: 'typed-gpu-work-observed',
      compileLinkDiscriminator: 'same-track-open-compile-or-link-under-unfinished-flush-observed',
      aggregate: { unfinishedFlushAncestorCount: 2, unfinishedUnderUnfinishedFlushCount: 1 },
    });
    rows[5][10] = 0;
    rows[0][10] = 0;
    // One instance cannot be both open and nested with an empty intersection.
    expect(decode).toThrow('summary-invalid');
    // Completed nested link plus an unrelated open link: both marginal counts
    // are positive, but their intersection is zero and remains inconclusive.
    rows[5] = [5, 1, 2, 1, 1, 20, 30, 5, 5, 1, 0];
    rows[0] = [0, 1, 4, 2, 2, 0, 30, 10, 5, 2, 0];
    expect(decode()).toMatchObject({
      coverage: 'typed-gpu-work-observed',
      compileLinkDiscriminator: 'inconclusive',
      aggregate: { unfinishedFlushAncestorCount: 2, unfinishedUnderUnfinishedFlushCount: 0 },
    });
    rows[0][10] = 1;
    expect(decode).toThrow('summary-invalid'); // Joint counts must also sum exactly.
    rows[0][10] = 0;
    rows[5][10] = 2;
    expect(decode).toThrow('summary-invalid'); // No more joint instances than open or nested.
  });

  it('strictly rejects old versions, changed pairs, impossible ancestry and arbitrary discriminator labels', () => {
    const valid = decodeNativeGpuTraceRows(csv, 100);
    const mutations: ((s: typeof valid) => void)[] = [
      (s) => {
        Object.assign(s, { version: 1 });
      },
      (s) => {
        Object.assign(s, { version: 3 });
      },
      (s) => {
        s.events[5].category = 'gpu';
      },
      (s) => {
        s.events[5].name = '/private/SECRET';
      },
      (s) => {
        s.events.reverse();
      },
      (s) => {
        s.events.pop();
      },
      (s) => {
        s.events.push(s.events[0]);
      },
      (s) => {
        Object.assign(s.events[0], { args: 'PRIVATE' });
      },
      (s) => {
        Object.assign(s.events[0], { track_id: 123 });
      },
      (s) => {
        Object.assign(s, { ancestryScope: 'global-overlap' });
      },
      (s) => {
        Object.assign(s, { compileLinkDiscriminator: 'private-result' });
      },
      (s) => {
        s.compileLinkDiscriminator =
          'same-track-open-compile-or-link-under-unfinished-flush-observed';
      },
      (s) => {
        s.events[5].unfinishedFlushAncestorCount = 1;
      },
      (s) => {
        s.aggregate.unfinishedFlushAncestorCount = 1;
      },
      (s) => {
        s.events[0].unfinishedFlushAncestorCount = -1;
      },
      (s) => {
        s.events[0].unfinishedUnderUnfinishedFlushCount = 1;
      },
      (s) => {
        s.events[0].unfinishedUnderUnfinishedFlushCount = -1;
      },
      (s) => {
        s.events[0].unfinishedUnderUnfinishedFlushCount = NaN;
      },
      (s) => {
        s.aggregate.unfinishedUnderUnfinishedFlushCount = 1;
      },
      (s) => {
        s.events[0].unfinishedFlushAncestorCount = NaN;
      },
      (s) => {
        s.events[0].unfinishedFlushAncestorCount = 0.5;
      },
      (s) => {
        s.events[0].unfinishedFlushAncestorCount = Number.MAX_SAFE_INTEGER + 1;
      },
      (s) => {
        // Even otherwise-consistent ancestry needs an unfinished parent.
        s.events[0].unfinishedFlushAncestorCount = 1;
        s.aggregate.unfinishedFlushAncestorCount = 1;
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(valid);
      mutate(copy);
      expect(() => validateNativeGpuTraceSummary(copy)).toThrow(
        /^Native GPU trace summary: summary-invalid$/,
      );
    }
    const legacy = csv
      .split('\n')
      .slice(0, 8)
      .map((line) => line.split(',').slice(0, 9).join(','))
      .join('\n');
    expect(() => decodeNativeGpuTraceRows(legacy, 100)).toThrow('parser-rows');
  });

  it('uses only the fixed SQL and waits for close after timeout before settling', async () => {
    vi.useFakeTimers();
    const { child, spawnProcess } = fakeChild();
    const result = runBoundedTraceProcessor({
      parserPath: '/private/parser',
      path: '/private/trace',
      deadlineAt: Date.now() + 5,
      spawnProcess,
    });
    const caught = result.catch((error: unknown) => error);
    expect(spawnProcess).toHaveBeenCalledWith(
      '/private/parser',
      ['-Q', NATIVE_GPU_TRACE_QUERY, '/private/trace'],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let settled = false;
    void caught.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(6);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    child.emit('error', new Error('/private/SECRET'));
    child.emit('exit', 2);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', 2);
    expect(String(await caught)).toBe(
      'NativeGpuTraceSummaryError: Native GPU trace summary: processing-timeout',
    );
  });

  it.each(['stdout', 'stderr'] as const)(
    'caps %s without returning raw text and awaits process close',
    async (stream) => {
      const { child, spawnProcess } = fakeChild();
      const controller = new AbortController();
      const caught = runBoundedTraceProcessor({
        parserPath: 'parser',
        path: 'private',
        deadlineAt: Date.now() + 5000,
        signal: controller.signal,
        spawnProcess,
      }).catch((e: unknown) => e);
      child[stream].write(Buffer.from('PRIVATE_SECRET'.repeat(2000)));
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      controller.abort(); // The earlier bounded-output reason stays primary.
      child.emit('close', null);
      expect(String(await caught)).toBe(
        'NativeGpuTraceSummaryError: Native GPU trace summary: parser-output-limit',
      );
    },
  );

  it('aborts a live parser, removes listeners only on close and preserves successful bounded output', async () => {
    const { child, spawnProcess } = fakeChild();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const caught = runBoundedTraceProcessor({
      parserPath: 'parser',
      path: 'private',
      deadlineAt: Date.now() + 5000,
      signal: controller.signal,
      spawnProcess,
    }).catch((e: unknown) => e);
    controller.abort();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    child.emit('close', 0);
    expect(String(await caught)).toContain('processing-timeout');
    expect(remove).toHaveBeenCalledOnce();
    const next = fakeChild();
    const healthy = runBoundedTraceProcessor({
      parserPath: 'parser',
      path: 'private',
      deadlineAt: Date.now() + 5000,
      spawnProcess: next.spawnProcess,
    });
    next.child.stdout.write(csv);
    next.child.stderr.write('PRIVATE_SECRET');
    next.child.emit('close', 0);
    expect(await healthy).toBe(csv);
  });

  it('replaces synchronous native spawn failures with fixed reasons and starts nothing after abort', async () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('/private/SECRET');
    }) as unknown as typeof spawn;
    await expect(
      runBoundedTraceProcessor({
        parserPath: 'parser',
        path: 'private',
        deadlineAt: Date.now() + 1000,
        spawnProcess,
      }),
    ).rejects.toThrow('parser-launch-failed');
    const controller = new AbortController();
    controller.abort();
    await expect(
      runBoundedTraceProcessor({
        parserPath: 'parser',
        path: 'private',
        deadlineAt: Date.now() + 1000,
        signal: controller.signal,
        spawnProcess,
      }),
    ).rejects.toThrow('processing-timeout');
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it('destroys a stalled verification stream on shared abort and rejects invalid budgets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'private-trace-abort-'));
    try {
      const path = join(directory, 'parser');
      await writeFile(path, '');
      await truncate(path, NATIVE_TRACE_PROCESSOR.bytes);
      const stream = new PassThrough();
      const openReadStream = vi.fn(() => stream) as unknown as typeof createReadStream;
      const controller = new AbortController();
      const result = verifyNativeTraceProcessor(path, Date.now() + 5000, {
        signal: controller.signal,
        openReadStream,
      });
      const caught = result.catch((e: unknown) => e);
      await vi.waitFor(() => expect(openReadStream).toHaveBeenCalledOnce());
      controller.abort();
      expect(String(await caught)).toContain('processing-timeout');
      expect(stream.destroyed).toBe(true);
      for (const deadlineMs of [NaN, Infinity, 0, -1])
        await expect(summarizeNativeGpuTrace({ path, deadlineMs })).rejects.toThrow(
          'processing-timeout',
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not let an ignored inspection abort hang cleanup or turn late evidence into recorded evidence', async () => {
    vi.useFakeTimers();
    let finish!: (output: NativeGpuTraceOutput) => void;
    let signal!: AbortSignal;
    const trace = createNativeGpuTrace({
      enabled: true,
      path: '/private/unused',
      firstFault: createFirstGraphicsFault(),
      stopMs: 5,
      adapter: {
        categories: async () => [],
        start: async () => {},
        stop: async () => '/private/unused',
      },
      inspect: async (_path, _output, abort) => {
        signal = abort;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const run = trace.run(async () => 27);
    await vi.advanceTimersByTimeAsync(6);
    expect(await run).toBe(27);
    expect(signal.aborted).toBe(true);
    expect(trace.cleanup({ producerClosed: false })).toMatchObject({
      producerClosed: false,
      pendingInspections: 1,
      rawDeletion: 'producer-unconfirmed',
    });
    finish(output);
    await Promise.resolve();
    await Promise.resolve();
    expect(trace.receipt.status).toBe('incomplete');
    expect(trace.receipt.output).toBeUndefined();
  });

  it('retains only bounded numeric parser exit codes with fixed reasons, including the receipt', async () => {
    for (const code of [0, 2, 255, -1, 256, null]) {
      const { child, spawnProcess } = fakeChild();
      const result = runBoundedTraceProcessor({
        parserPath: 'private',
        path: 'private',
        deadlineAt: Date.now() + 5000,
        spawnProcess,
      }).catch((e: unknown) => e);
      child.emit('error', new Error('PRIVATE_STDERR_SECRET'));
      child.emit('close', code);
      expect(await result).toMatchObject({
        reason: 'parser-launch-failed',
        parserExitStatus: code !== null && code >= 0 && code <= 255 ? code : null,
      });
    }
    const trace = createNativeGpuTrace({
      enabled: true,
      path: '/private/unused',
      firstFault: createFirstGraphicsFault(),
      adapter: {
        categories: async () => [],
        start: async () => {},
        stop: async () => '/private/unused',
      },
      inspect: async () => {
        throw new NativeGpuTraceSummaryError('parser-exit', 2);
      },
    });
    expect(await trace.run(async () => 9)).toBe(9);
    expect(trace.receipt).toMatchObject({
      status: 'incomplete',
      parserExitStatus: 2,
      errors: ['Native GPU trace summary: parser-exit'],
    });
  });

  it('atomically retains only complete sanitized JSON and removes the temporary directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sanitized-trace-output-'));
    const outputPath = join(directory, 'gpu-trace-summary.json');
    const controller = new AbortController();
    try {
      await writeFile(outputPath, 'stale prior summary');
      const source = { commit: 'source', fingerprint: 'inputs', electron: '45.2.1' };
      const summary = decodeNativeGpuTraceRows(csv, 100);
      const writeSummary: typeof writeFile = async (path, data, options) => {
        expect(path).not.toBe(outputPath);
        await expect(readFile(outputPath)).rejects.toThrow('ENOENT');
        expect(options).toMatchObject({ mode: 0o600, flag: 'wx', signal: controller.signal });
        return writeFile(path, data, options);
      };
      const retained = await retainNativeGpuTraceSummary({
        summary,
        source,
        outputPath,
        signal: controller.signal,
        writeSummary,
      });
      expect(retained).toMatchObject({
        retained: true,
        file: 'gpu-trace-summary.json',
        rawTraceUploaded: false,
      });
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual({ source, summary });
      expect(await readdir(directory)).toEqual(['gpu-trace-summary.json']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['during-write', 'after-write'] as const)(
    'cleans aborted %s sanitized staging and never accepts a stale output',
    async (when) => {
      const directory = await mkdtemp(join(tmpdir(), 'sanitized-trace-abort-'));
      const outputPath = join(directory, 'gpu-trace-summary.json');
      const controller = new AbortController();
      try {
        await writeFile(outputPath, 'stale prior summary');
        const source = { commit: 'source', fingerprint: 'inputs', electron: '45.2.1' };
        const writeSummary: typeof writeFile = async (path, data, options) => {
          await writeFile(path, when === 'during-write' ? '{"source":' : data, options);
          controller.abort();
          if (when === 'during-write') controller.signal.throwIfAborted();
        };
        await expect(
          retainNativeGpuTraceSummary({
            summary: decodeNativeGpuTraceRows(csv, 100),
            source,
            outputPath,
            signal: controller.signal,
            writeSummary,
          }),
        ).rejects.toThrow();
        expect(await readdir(directory)).toEqual([]);
        await expect(readFile(outputPath)).rejects.toThrow('ENOENT');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
