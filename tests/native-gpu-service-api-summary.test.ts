import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { type spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeNativeGpuServiceApiRows,
  validateNativeGpuServiceApiSummary,
  NATIVE_GPU_SERVICE_API_EVENTS,
  NATIVE_GPU_SERVICE_API_WORK_EVENTS,
  NATIVE_GPU_SERVICE_API_QUERY,
} from '../scripts/native-gpu-service-api-summary.mjs';
import {
  decodeNativeGpuTraceRows,
  validateNativeGpuTraceSummary,
  NATIVE_GPU_WORK_EVENTS,
  NATIVE_GPU_TRACE_QUERY,
  NATIVE_TRACE_PROCESSOR,
  runBoundedTraceProcessor,
} from '../scripts/native-gpu-trace-summary.mjs';
import {
  createNativeGpuTrace,
  retainNativeGpuTraceSummary,
  validateNativeGpuTraceEvidence,
  NATIVE_GPU_TRACE,
  type NativeGpuTraceOutput,
} from '../scripts/native-gpu-trace.mjs';
import { createFirstGraphicsFault } from '../scripts/native-smoke-control.mjs';

const mode = 'service-api-boundary-v1' as const;
const header =
  'event_id,process_count,event_count,completed_count,unfinished_count,first_ns,last_ns,total_ns,max_ns,unfinished_flush_ancestor_count,unfinished_under_unfinished_flush_count,unfinished_decoder_flush_ancestor_count,unfinished_under_unfinished_decoder_flush_count';
function rows(api = true) {
  const values = Array.from({ length: 23 }, (_, id) => [id, ...Array<number>(12).fill(0)]);
  values[1] = [1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  values[4] = [4, 1, 1, 0, 1, 10, 10, 0, 0, 1, 1, 0, 0];
  if (api) values[10] = [10, 1, 1, 0, 1, 20, 20, 0, 0, 1, 1, 1, 1];
  values[20][1] = 165;
  values[21][1] = 48;
  return aggregate(values);
}
function aggregate(values: number[][]) {
  const present = values.slice(1, 20).filter((row) => row[2]);
  values[0] = [0, present.length ? 1 : 0, ...Array<number>(11).fill(0)];
  for (const col of [2, 3, 4, 7, 9, 10, 11, 12])
    values[0][col] = present.reduce((sum, row) => sum + row[col], 0);
  values[0][5] = present.length ? Math.min(...present.map((row) => row[5])) : 0;
  values[0][6] = Math.max(0, ...present.map((row) => row[6]));
  values[0][8] = Math.max(0, ...present.map((row) => row[8]));
  return values;
}
const csv = (values = rows()) => [header, ...values.map((row) => row.join(','))].join('\n');
const summary = (api = true) => decodeNativeGpuServiceApiRows(csv(rows(api)), 100);
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return { child, spawnProcess: vi.fn(() => child) as unknown as typeof spawn };
}
afterEach(() => vi.useRealTimers());

describe('private service API schema and per-instance ancestry', () => {
  it('pins exactly ten immutable source-reviewed pairs after unchanged baseline pairs', () => {
    expect(NATIVE_GPU_SERVICE_API_EVENTS).toEqual(
      [
        'glDrawArrays',
        'glDrawArraysInstancedANGLE',
        'glDrawElements',
        'glDrawElementsInstancedANGLE',
        'glClientWaitSync',
        'glWaitSync',
        'glGetSynciv',
        'glFenceSync',
        'glFlush',
        'glFinish',
      ].map((name) => ({ category: 'gpu', name: `TraceGLAPI::${name}` })),
    );
    expect(Object.isFrozen(NATIVE_GPU_SERVICE_API_EVENTS)).toBe(true);
    expect(NATIVE_GPU_SERVICE_API_EVENTS.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(NATIVE_GPU_SERVICE_API_WORK_EVENTS)).toBe(true);
    expect(NATIVE_GPU_SERVICE_API_WORK_EVENTS.slice(0, 9)).toEqual(NATIVE_GPU_WORK_EVENTS);
    // Frozen V2 query bytes from cee488b: a new mode cannot silently widen it.
    expect(createHash('sha256').update(NATIVE_GPU_TRACE_QUERY).digest('hex')).toBe(
      'b4a1c214b63de669bdf4132826add06aff40e63a38b3de01bde46fea8f56c81e',
    );
    const value = summary();
    expect(value).toMatchObject({
      version: 3,
      serviceApiMode: mode,
      serviceApiCoverage: 'typed-gpu-service-api-observed',
      serviceApiBoundaryDiscriminator:
        'same-track-open-service-api-under-unfinished-decoder-and-flush-observed',
      compileLinkDiscriminator: 'inconclusive',
      childTailCertified: false,
      aggregate: {
        unfinishedDecoderFlushAncestorCount: 1,
        unfinishedUnderUnfinishedDecoderFlushCount: 1,
      },
    });
    expect(value.events).toHaveLength(19);
    expect(value.events[9]).toMatchObject({
      count: 1,
      unfinished: 1,
      unfinishedDecoderFlushAncestorCount: 1,
      unfinishedUnderUnfinishedDecoderFlushCount: 1,
    });
  });

  it('keeps baseline work separate from actual wrapper emission', () => {
    expect(summary(false)).toMatchObject({
      coverage: 'typed-gpu-work-observed',
      serviceApiCoverage: 'no-typed-gpu-service-api-observed',
      serviceApiBoundaryDiscriminator: 'inconclusive',
    });
    const values = rows();
    values[10] = [10, 1, 1, 1, 0, 20, 25, 5, 5, 1, 0, 1, 0];
    expect(decodeNativeGpuServiceApiRows(csv(aggregate(values)), 100)).toMatchObject({
      serviceApiCoverage: 'typed-gpu-service-api-observed',
      serviceApiBoundaryDiscriminator: 'inconclusive',
    });
  });

  it('does not combine completed nested and unrelated open instances into a positive triple', () => {
    const values = rows();
    values[10] = [10, 1, 2, 1, 1, 20, 30, 5, 5, 1, 0, 1, 0];
    const value = decodeNativeGpuServiceApiRows(csv(aggregate(values)), 100);
    expect(value.serviceApiBoundaryDiscriminator).toBe('inconclusive');
    values[10][12] = 1;
    expect(() => decodeNativeGpuServiceApiRows(csv(aggregate(values)), 100)).toThrow(
      'summary-invalid',
    );
  });

  it('strictly rejects version substitution, arbitrary keys, altered labels and impossible joint counts', () => {
    const valid = summary();
    const mutations: ((value: typeof valid) => void)[] = [
      (v) => {
        Object.assign(v, { version: 2 });
      },
      (v) => {
        Object.assign(v, { serviceApiMode: 'private' });
      },
      (v) => {
        Object.assign(v, { private: '/private/SECRET' });
      },
      (v) => {
        v.childTailCertified = true as false;
      },
      (v) => {
        v.events[9].name = 'TraceGLAPI::glUnknown';
      },
      (v) => {
        v.events[9].category = 'gpu.angle';
      },
      (v) => {
        Object.assign(v.events[9], { args: 'SECRET' });
      },
      (v) => {
        Object.assign(v.events[9], { track_id: 2 });
      },
      (v) => {
        v.events.reverse();
      },
      (v) => {
        v.events.pop();
      },
      (v) => {
        v.events[9].unfinishedDecoderFlushAncestorCount = 2;
      },
      (v) => {
        v.events[9].unfinishedUnderUnfinishedDecoderFlushCount = 0;
      },
      (v) => {
        v.events[9].unfinishedUnderUnfinishedDecoderFlushCount = 2;
      },
      (v) => {
        v.events[9].unfinishedUnderUnfinishedDecoderFlushCount = NaN;
      },
      (v) => {
        v.aggregate.unfinishedDecoderFlushAncestorCount = 0;
      },
      (v) => {
        v.aggregate.unfinishedUnderUnfinishedDecoderFlushCount = 0;
      },
      (v) => {
        v.serviceApiCoverage = 'no-typed-gpu-service-api-observed';
      },
      (v) => {
        v.serviceApiBoundaryDiscriminator = 'inconclusive';
      },
      (v) => {
        v.compileLinkDiscriminator =
          'same-track-open-compile-or-link-under-unfinished-flush-observed';
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      expect(() => validateNativeGpuServiceApiSummary(value)).toThrow(
        /^Native GPU trace summary: summary-invalid$/,
      );
    }
    expect(() => validateNativeGpuTraceSummary(valid)).toThrow('summary-invalid');
    expect(() => decodeNativeGpuTraceRows(csv(), 100)).toThrow('parser-rows');
    for (const input of [
      csv() + '\n0',
      csv().replace('20,165,0,', '20,165,SECRET,'),
      csv().replace('20,165,0,', '20,165,-1,'),
      csv().replace('20,165,0,', '20,165,9007199254740992,'),
      'x'.repeat(NATIVE_TRACE_PROCESSOR.maxStdoutBytes + 1),
    ])
      expect(() => decodeNativeGpuServiceApiRows(input, 100)).toThrow(
        /^Native GPU trace summary: (parser-rows|summary-invalid)$/,
      );
  });

  it('enforces the stronger intersection bound inside the unfinished-flush subset', () => {
    const values = rows();
    // N=3,U=1,F=2,J=1,D=2. U+D-N is zero, but J+D-F is one:
    // the two triple-nested instances exhaust F and must contain its open one.
    values[10] = [10, 1, 3, 2, 1, 20, 30, 5, 3, 2, 1, 2, 0];
    expect(() => decodeNativeGpuServiceApiRows(csv(aggregate(values)), 100)).toThrow(
      'summary-invalid',
    );
    values[10][12] = 1;
    expect(
      decodeNativeGpuServiceApiRows(csv(aggregate(values)), 100).events[9]
        .unfinishedUnderUnfinishedDecoderFlushCount,
    ).toBe(1);
  });

  it('enforces the ordered decoder-under-flush relation, not two unrelated marginal ancestors', () => {
    const values = rows();
    values[4][9] = values[4][10] = 0;
    expect(() => decodeNativeGpuServiceApiRows(csv(aggregate(values)), 100)).toThrow(
      'summary-invalid',
    );
    const valid = summary();
    valid.events[9].unfinishedDecoderFlushAncestorCount = 0;
    valid.events[9].unfinishedUnderUnfinishedDecoderFlushCount = 0;
    valid.aggregate.unfinishedDecoderFlushAncestorCount = 0;
    valid.aggregate.unfinishedUnderUnfinishedDecoderFlushCount = 0;
    valid.serviceApiBoundaryDiscriminator = 'inconclusive';
    expect(validateNativeGpuServiceApiSummary(valid)).toBe(valid);
  });

  it('selects only fixed queries and starts no parser for an unknown mode', async () => {
    for (const serviceApiMode of ['off', mode] as const) {
      const { child, spawnProcess } = fakeChild();
      const result = runBoundedTraceProcessor({
        parserPath: 'parser',
        path: 'private',
        deadlineAt: Date.now() + 5000,
        serviceApiMode,
        spawnProcess,
      });
      expect(spawnProcess).toHaveBeenCalledWith(
        'parser',
        [
          '-Q',
          serviceApiMode === 'off' ? NATIVE_GPU_TRACE_QUERY : NATIVE_GPU_SERVICE_API_QUERY,
          'private',
        ],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      child.stdout.write('numeric');
      child.stderr.write('/private/SECRET');
      child.emit('close', 0);
      expect(await result).toBe('numeric');
    }
    const { spawnProcess } = fakeChild();
    await expect(
      runBoundedTraceProcessor({
        parserPath: 'parser',
        path: 'private',
        deadlineAt: Date.now() + 5000,
        serviceApiMode: 'SECRET' as typeof mode,
        spawnProcess,
      }),
    ).rejects.toThrow('summary-invalid');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'stdout', 'stderr', 'abort'] as const)(
    'retains close-before-settlement for service mode %s',
    async (kind) => {
      vi.useFakeTimers();
      const { child, spawnProcess } = fakeChild();
      const controller = new AbortController();
      let settled = false;
      const result = runBoundedTraceProcessor({
        parserPath: 'parser',
        path: 'private',
        deadlineAt: Date.now() + 5,
        serviceApiMode: mode,
        spawnProcess,
        signal: controller.signal,
      })
        .catch((e: unknown) => e)
        .then((e: unknown) => {
          settled = true;
          return e;
        });
      if (kind === 'timeout') await vi.advanceTimersByTimeAsync(6);
      else if (kind === 'abort') controller.abort();
      else child[kind].write('S'.repeat(kind === 'stdout' ? 16 * 1024 + 1 : 4 * 1024 + 1));
      expect(child.kill).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit('exit', 0);
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit('close', 0);
      expect(String(await result)).toBe(
        `NativeGpuTraceSummaryError: Native GPU trace summary: ${kind === 'stdout' || kind === 'stderr' ? 'parser-output-limit' : 'processing-timeout'}`,
      );
    },
  );
});

describe('service API receipt and actual-emission evidence gate', () => {
  it.each(['off', mode] as const)(
    'removes prior sanitized evidence on pre-write failure in %s mode',
    async (serviceApiMode) => {
      const directory = await mkdtemp(join(tmpdir(), 'service-api-stale-'));
      const outputPath = join(directory, 'gpu-trace-summary.json');
      const v2Rows = [...rows(false).slice(0, 10), ...rows(false).slice(20)].map((row, id) => [
        id,
        ...row.slice(1, 11),
      ]);
      const v2 = decodeNativeGpuTraceRows(
        [header.split(',').slice(0, 11).join(','), ...v2Rows.map((row) => row.join(','))].join(
          '\n',
        ),
        100,
      );
      const valid = serviceApiMode === 'off' ? v2 : summary();
      try {
        for (const failure of ['schema', 'serialization', 'size', 'mode', 'abort'] as const) {
          await writeFile(outputPath, 'prior sanitized summary');
          const source = { commit: 'source', fingerprint: 'inputs', electron: '45.2.1' };
          if (failure === 'serialization') Object.assign(source, { circular: source });
          if (failure === 'size') source.commit = 'x'.repeat(20 * 1024);
          const controller = new AbortController();
          if (failure === 'abort') controller.abort();
          await expect(
            retainNativeGpuTraceSummary({
              summary:
                failure === 'schema' ? { ...valid, childTailCertified: true as false } : valid,
              source,
              outputPath,
              signal: controller.signal,
              serviceApiMode: failure === 'mode' ? ('unknown' as typeof mode) : serviceApiMode,
            }),
          ).rejects.toThrow();
          expect(await readdir(directory)).toEqual([]);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('keeps default receipts unchanged and rejects service mode with tracing off', async () => {
    const adapter = {
      categories: vi.fn(async () => []),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => 'private'),
    };
    const trace = createNativeGpuTrace({
      enabled: false,
      adapter,
      firstFault: createFirstGraphicsFault(),
      path: 'private',
    });
    expect(trace.receipt).not.toHaveProperty('serviceApiMode');
    expect(await trace.run(async () => 1)).toBe(1);
    expect(adapter.start).not.toHaveBeenCalled();
    expect(() =>
      createNativeGpuTrace({
        enabled: false,
        serviceApiMode: mode,
        adapter,
        firstFault: createFirstGraphicsFault(),
        path: 'private',
      }),
    ).toThrow('requires');
  });

  it('requires both strict launch facts and actual wrapper emission, never raw artifacts or causal certainty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'service-api-evidence-'));
    const evidence = join(directory, 'evidence');
    await mkdir(evidence);
    const outputPath = join(evidence, 'gpu-trace-summary.json');
    const source = { commit: 'exact-source', fingerprint: 'exact-inputs', electron: '45.2.1' };
    const value = summary();
    const launch = {
      mode,
      argument: '--enable-gpu-service-tracing',
      platform: 'linux',
      arch: 'x64',
      graphicsBackend: 'mesa',
      journey: 'full',
      manualNonpublishing: true,
    };
    const runtime = {
      platform: 'linux',
      arch: 'x64',
      electron: '45.2.1',
      chromium: '156.0.8078.75',
    };
    const retain = (s = value) =>
      retainNativeGpuTraceSummary({
        summary: s,
        source,
        outputPath,
        signal: new AbortController().signal,
        serviceApiMode: mode,
      });
    try {
      const trace = createNativeGpuTrace({
        enabled: true,
        serviceApiMode: mode,
        source,
        path: join(directory, 'private.pftrace'),
        outputPath,
        firstFault: createFirstGraphicsFault(),
        adapter: { categories: async () => [], start: async () => {}, stop: async () => 'private' },
        inspect: () => retain(),
      });
      await trace.run(async () => {});
      const report = {
        success: false,
        platform: 'linux',
        arch: 'x64',
        hostArch: 'x64',
        graphicsBackend: 'mesa',
        smokeJourney: { requestedJourney: 'full', diagnosticOnly: false, omittedChecks: [] },
        source,
        runtime,
        serviceApiLaunch: launch,
        gpuTrace: trace.receipt,
      };
      expect(trace.receipt).toMatchObject({
        serviceApiMode: mode,
        scope: NATIVE_GPU_TRACE.scope,
        config: {
          included_categories: NATIVE_GPU_TRACE.categories,
          trace_buffer_size_in_kb: 16384,
        },
      });
      expect(await validateNativeGpuTraceEvidence(report, evidence)).toMatchObject({
        outcome: 'retained-typed-gpu-service-api-summary',
      });
      expect(await readdir(evidence)).toEqual(['gpu-trace-summary.json']);
      const text = await readFile(outputPath, 'utf8');
      expect(text).not.toContain(directory);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16384);
      await expect(
        retainNativeGpuTraceSummary({
          summary: value,
          source,
          outputPath,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('summary-invalid');
      trace.receipt.output = await retain(); // Invalid-mode retention removed the prior sanitized file.
      for (const field of Object.keys(launch)) {
        const altered = { ...launch, [field]: 'SECRET' };
        await expect(
          validateNativeGpuTraceEvidence({ ...report, serviceApiLaunch: altered }, evidence),
        ).rejects.toThrow('launch receipt');
      }
      for (const changed of [undefined, { ...launch, extra: 'SECRET' }])
        await expect(
          validateNativeGpuTraceEvidence({ ...report, serviceApiLaunch: changed }, evidence),
        ).rejects.toThrow('launch receipt');
      for (const field of ['platform', 'arch', 'hostArch', 'graphicsBackend'])
        await expect(
          validateNativeGpuTraceEvidence({ ...report, [field]: 'unexpected' }, evidence),
        ).rejects.toThrow('launch receipt');
      for (const smokeJourney of [
        undefined,
        { ...report.smokeJourney, requestedJourney: 'compatibility-diagnostic' },
        { ...report.smokeJourney, diagnosticOnly: true },
        { ...report.smokeJourney, omittedChecks: ['original asset'] },
      ])
        await expect(
          validateNativeGpuTraceEvidence({ ...report, smokeJourney }, evidence),
        ).rejects.toThrow('launch receipt');
      for (const field of Object.keys(runtime))
        await expect(
          validateNativeGpuTraceEvidence(
            { ...report, runtime: { ...runtime, [field]: 'unexpected' } },
            evidence,
          ),
        ).rejects.toThrow('launch receipt');
      await expect(
        validateNativeGpuTraceEvidence(
          { ...report, gpuTrace: { ...trace.receipt, serviceApiMode: undefined } },
          evidence,
        ),
      ).rejects.toThrow('Unexpected');
      trace.receipt.output = await retain(summary(false));
      await expect(validateNativeGpuTraceEvidence(report, evidence)).rejects.toThrow(
        'No typed GPU service API emission',
      );
      // Completed wrappers establish instrumentation, not an open-boundary cause.
      const completed = rows();
      completed[10] = [10, 1, 1, 1, 0, 20, 25, 5, 5, 1, 0, 1, 0];
      trace.receipt.output = await retain(
        decodeNativeGpuServiceApiRows(csv(aggregate(completed)), 100),
      );
      await expect(validateNativeGpuTraceEvidence(report, evidence)).resolves.toMatchObject({
        outcome: 'retained-typed-gpu-service-api-summary',
      });
      const reportPath = join(evidence, 'report.json');
      await writeFile(reportPath, JSON.stringify(report));
      const script = fileURLToPath(new URL('../scripts/native-gpu-trace.mjs', import.meta.url));
      const valid = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout.toString()).outcome).toBe(
        'retained-typed-gpu-service-api-summary',
      );
      const bad = Buffer.from('{"PRIVATE_SERVICE_API_SECRET":');
      await writeFile(outputPath, bad);
      trace.receipt.output = {
        ...trace.receipt.output,
        bytes: bad.length,
        sha256: createHash('sha256').update(bad).digest('hex'),
      } as NativeGpuTraceOutput;
      await writeFile(reportPath, JSON.stringify(report));
      const invalid = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(invalid.status).toBe(1);
      expect(JSON.parse(invalid.stdout.toString())).toEqual({
        outcome: 'trace-evidence-unavailable',
        error: 'trace-summary-validation-failed',
      });
      expect(invalid.stdout.toString() + invalid.stderr.toString()).not.toContain(
        'PRIVATE_SERVICE_API_SECRET',
      );
      expect(invalid.stdout.toString() + invalid.stderr.toString()).not.toContain(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
