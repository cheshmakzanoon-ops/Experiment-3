import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createNativeGpuTrace,
  nativeGpuTraceEnabled,
  nativeGpuTraceCategories,
  nativeGpuTraceCategoryInventory,
  NATIVE_GPU_TRACE,
  validateNativeGpuTraceEvidence,
  type NativeGpuTraceOptions,
  type NativeGpuTraceOutput,
} from '../scripts/native-gpu-trace.mjs';
import {
  decodeNativeGpuTraceRows,
  NATIVE_TRACE_PROCESSOR,
} from '../scripts/native-gpu-trace-summary.mjs';
import {
  createFirstGraphicsFault,
  retainNativeSmokeFailure,
} from '../scripts/native-smoke-control.mjs';

afterEach(() => vi.useRealTimers());

function fixture(overrides: Partial<NativeGpuTraceOptions> = {}) {
  const firstFault = createFirstGraphicsFault();
  const adapter = {
    categories: vi.fn(async () => [
      'gpu',
      'viz',
      'toplevel',
      'secret',
      'disabled-by-default-memory-infra',
    ]),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => '/owned/trace.pftrace'),
  };
  const inspect = vi.fn(
    async (): Promise<NativeGpuTraceOutput> => ({
      retained: true,
      bytes: 42,
      file: 'gpu-trace-summary.json',
      rawTraceUploaded: false,
      captureValid: true,
      parsed: true,
      gpuWorkObserved: true,
      sha256: '0'.repeat(64),
    }),
  );
  const trace = createNativeGpuTrace({
    enabled: true,
    source: { commit: 'exact-source', fingerprint: 'exact-inputs', electron: '45.2.1' },
    firstFault,
    adapter,
    inspect,
    path: '/owned/trace.pftrace',
    ...overrides,
  });
  return { trace, adapter, firstFault, inspect };
}

describe('bounded native GPU trace diagnostic', () => {
  it('defaults off, rejects unknown modes, and adds no API calls around unchanged actions', async () => {
    expect(nativeGpuTraceEnabled()).toBe(false);
    expect(nativeGpuTraceEnabled('1')).toBe(true);
    expect(() => nativeGpuTraceEnabled('true')).toThrow('Unknown');
    const onOperationFailure = vi.fn();
    const { trace, adapter, inspect } = fixture({ enabled: false, onOperationFailure });
    const operation = vi.fn(async () => 37);
    expect(await trace.run(operation)).toBe(37);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(adapter.categories).not.toHaveBeenCalled();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(trace.receipt).toMatchObject({ status: 'disabled', diagnosticOnly: false });
    expect(trace.receipt.categoryInventory).toBeUndefined();
    const original = new Error('default original error');
    await expect(
      trace.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(onOperationFailure).not.toHaveBeenCalled();
  });

  it('requests only the fixed allowlist independently of discovery, rejecting malformed inventories', () => {
    expect(Object.isFrozen(NATIVE_GPU_TRACE.categories)).toBe(true);
    expect(() => Reflect.apply(Array.prototype.push, NATIVE_GPU_TRACE.categories, ['*'])).toThrow();
    expect(nativeGpuTraceCategories(['gpu,viz', 'toplevel', 'unknown', '*'])).toEqual(
      NATIVE_GPU_TRACE.categories,
    );
    expect(nativeGpuTraceCategories([])).toEqual(NATIVE_GPU_TRACE.categories);
    expect(nativeGpuTraceCategories(['viz'])).toEqual(NATIVE_GPU_TRACE.categories);
    for (const input of [null, [12], ['x'.repeat(513)], Array(4097).fill('gpu')])
      expect(() => nativeGpuTraceCategories(input)).toThrow();
  });

  it('retains empty and no-match discovery honestly while requesting the same nine fixed filters', async () => {
    for (const groups of [[], ['unknown', '*']]) {
      const { trace, adapter } = fixture();
      adapter.categories.mockResolvedValue(groups);
      expect(await trace.run(async () => 7)).toBe(7);
      expect(adapter.start).toHaveBeenCalledOnce();
      expect(adapter.start.mock.calls[0]).toEqual([
        {
          included_categories: NATIVE_GPU_TRACE.categories,
          recording_mode: 'record-continuously',
          trace_buffer_size_in_kb: 16384,
          enable_argument_filter: true,
        },
      ]);
      expect(trace.receipt).toMatchObject({
        status: 'recorded',
        categoryPolicy: 'fixed-allowlist-requested-not-discovered',
        categoryInventory: {
          input: 'array',
          reportedGroups: groups.length,
          scannedGroups: groups.length,
          omittedGroups: 0,
          truncated: false,
          matchedCategories: [],
        },
      });
      expect(trace.receipt.errors).toEqual([]);
    }
  });

  it('bounds discovery inspection and encoded receipt without exposing arbitrary group strings', () => {
    const limits = NATIVE_GPU_TRACE.categoryInventory;
    expect(Object.isFrozen(limits)).toBe(true);
    const oversized = Array(4097).fill('gpu');
    const receipt = nativeGpuTraceCategoryInventory(oversized);
    expect(receipt).toMatchObject({
      reportedGroups: 4097,
      scannedGroups: 4096,
      omittedGroups: 1,
      truncated: true,
      matchedCategories: ['gpu'],
    });
    expect(() => nativeGpuTraceCategories(oversized)).toThrow('Invalid');
    const gpuBeyondScan = [...Array(limits.maxGroups).fill('private-unknown'), 'gpu'];
    expect(nativeGpuTraceCategoryInventory(gpuBeyondScan).matchedCategories).toEqual([]);
    for (const group of ['界'.repeat(600), '\u0000'.repeat(600), '😀'.repeat(600)]) {
      const observed = nativeGpuTraceCategoryInventory(Array(64).fill(group));
      expect(observed).toMatchObject({
        scannedGroups: 64,
        omittedGroups: 0,
        oversizedGroups: 64,
        matchedCategories: [],
      });
      expect(Buffer.byteLength(JSON.stringify(observed), 'utf8')).toBeLessThanOrEqual(
        limits.maxBytes,
      );
      expect(JSON.stringify(observed)).not.toContain(group);
      expect(JSON.parse(JSON.stringify(observed))).toEqual(observed);
    }
    const unknown = nativeGpuTraceCategoryInventory(['private-unknown', 'gpu,viz']);
    expect(unknown.matchedCategories).toEqual(['gpu', 'viz']);
    expect(JSON.stringify(unknown)).not.toContain('private-unknown');
  });

  it('describes malformed inventory entries without coercing or serializing their contents', () => {
    const malicious = {
      toJSON: vi.fn(() => {
        throw new Error('must not serialize');
      }),
    };
    expect(nativeGpuTraceCategoryInventory(null)).toMatchObject({
      input: 'not-array',
      reportedGroups: null,
      scannedGroups: 0,
      matchedCategories: [],
    });
    const input = [null, 12, malicious, 'gpu'];
    expect(nativeGpuTraceCategoryInventory(input)).toMatchObject({
      reportedGroups: 4,
      scannedGroups: 4,
      omittedGroups: 0,
      malformedGroups: 3,
      matchedCategories: ['gpu'],
    });
    expect(malicious.toJSON).not.toHaveBeenCalled();
    expect(() => nativeGpuTraceCategories(input)).toThrow('Invalid');
  });

  it('records one bounded window with source/config and removes the first-fault watcher', async () => {
    const { trace, adapter, firstFault } = fixture();
    expect(await trace.run(async () => 'original-result')).toBe('original-result');
    expect(adapter.start).toHaveBeenCalledWith({
      included_categories: NATIVE_GPU_TRACE.categories,
      recording_mode: 'record-continuously',
      trace_buffer_size_in_kb: 16384,
      enable_argument_filter: true,
    });
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(trace.receipt).toMatchObject({
      source: { commit: 'exact-source', electron: '45.2.1' },
      status: 'recorded',
      format: 'private-perfetto-numeric-summary',
      rawTraceUploaded: false,
      omittedGameplayChecks: [],
      completeness: 'window-flushed-child-tail-not-certified',
    });
    firstFault.record('later Three cockpit failure');
    await Promise.resolve();
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    trace.finalize();
    expect(trace.receipt.fatalCoverage).toBe(
      'observed-after-trace-window-not-explained-by-this-capture',
    );
    await expect(trace.run(async () => {})).rejects.toThrow('already consumed');
  });

  it('stops on the first GPU fault without cancelling or replacing the original operation', async () => {
    const { trace, adapter, firstFault } = fixture();
    let finish!: (value: number) => void;
    const operation = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    const running = trace.run(operation);
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    firstFault.record('GPU exit512');
    await vi.waitFor(() => expect(adapter.stop).toHaveBeenCalledOnce());
    let finished = false;
    void running.then(() => (finished = true));
    await Promise.resolve();
    expect(finished).toBe(false);
    finish(9);
    expect(await running).toBe(9);
    trace.finalize();
    expect(trace.receipt).toMatchObject({
      stopReason: 'first-graphics-fault',
      completeness: 'partial-or-uncertain',
      fatalCoverage: 'observed-during-trace-window',
    });
    expect(adapter.stop).toHaveBeenCalledOnce();
  });

  it('preserves operation errors when stop fails and retains explicit missing evidence', async () => {
    const { trace, adapter, firstFault } = fixture();
    adapter.stop.mockRejectedValue(new Error('trace writer failed'));
    const original = new Error('original readiness failed');
    await expect(
      trace.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(trace.receipt.status).toBe('incomplete');
    expect(trace.receipt.errors).toContain('Native GPU trace stop or inspection failed');
    expect(trace.receipt.errors.join(' ')).not.toContain('trace writer failed');
    firstFault.record('later loss with unavailable trace');
    trace.finalize();
    expect(trace.receipt.fatalCoverage).toBe('trace-window-unavailable-or-uncertain');
  });

  it('retains the original failure before a later GPU fault arrives during stop cleanup', async () => {
    const report = {};
    const firstFault = createFirstGraphicsFault();
    const snapshot = vi.fn((error: unknown) => retainNativeSmokeFailure(report, error, firstFault));
    const { trace, adapter } = fixture({ firstFault, onOperationFailure: snapshot });
    let stopped!: (value: string) => void;
    adapter.stop.mockImplementation(() => new Promise<string>((resolve) => (stopped = resolve)));
    const original = new Error('Original 120000ms readiness deadline');
    const running = trace
      .run(async () => {
        throw original;
      })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledWith(original));
    expect(report).toMatchObject({ success: false, failure: String(original) });
    firstFault.record('later GPU exit512 during trace stop');
    stopped('/owned/trace.pftrace');
    expect(await running).toBe(original);
    // The real outer catch repeats this after trace cleanup; it stays sticky.
    retainNativeSmokeFailure(report, original, firstFault);
    expect(report).toMatchObject({ failure: String(original) });
    trace.finalize();
    expect(trace.receipt.finalGraphicsFault).toContain('later GPU exit512');
  });

  it('does not let a failed synchronous failure snapshot replace the original error', async () => {
    const original = new Error('Original operation failure');
    const { trace } = fixture({
      onOperationFailure: () => {
        throw new Error('snapshot failed');
      },
    });
    await expect(
      trace.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(trace.receipt.errors).toContain('Native GPU trace failure snapshot failed');
    expect(trace.receipt.errors.join(' ')).not.toContain('Error: snapshot failed');
  });

  it('bounds a never-resolving stop without changing the operation result', async () => {
    vi.useFakeTimers();
    const { trace, adapter } = fixture({ stopMs: 5 });
    adapter.stop.mockImplementation(() => new Promise(() => {}));
    const result = trace.run(async () => 17);
    await vi.advanceTimersByTimeAsync(6);
    expect(await result).toBe(17);
    expect(trace.receipt.status).toBe('incomplete');
    expect(trace.receipt.errors).toContain('Native GPU trace stop or inspection failed');
  });

  it('closes a late start acknowledgement after bounded setup and marks uncertain coverage', async () => {
    vi.useFakeTimers();
    const { trace, adapter } = fixture({ setupMs: 5 });
    let acknowledge!: () => void;
    adapter.start.mockImplementation(() => new Promise<void>((resolve) => (acknowledge = resolve)));
    const result = trace.run(async () => 23);
    await vi.advanceTimersByTimeAsync(6);
    expect(await result).toBe(23);
    expect(adapter.stop).toHaveBeenCalledOnce();
    acknowledge();
    await vi.runAllTimersAsync();
    expect(adapter.stop).toHaveBeenCalledTimes(2);
    expect(trace.receipt).toMatchObject({
      lateStartCleanup: true,
      completeness: 'partial-or-uncertain',
    });
  });

  it('bounds category failure without starting a trace or omitting gameplay', async () => {
    vi.useFakeTimers();
    const { trace, adapter } = fixture({ setupMs: 5 });
    adapter.categories.mockImplementation(() => new Promise(() => {}));
    const operation = vi.fn(async () => 2);
    const result = trace.run(operation);
    await vi.advanceTimersByTimeAsync(6);
    expect(await result).toBe(2);
    expect(operation).toHaveBeenCalledOnce();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(trace.receipt.status).toBe('incomplete');
  });

  it('publishes only strict bounded summary evidence, verifies coverage/source/digest and keeps raw bytes private', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'native-gpu-trace-'));
    try {
      const profile = join(dir, 'private');
      const evidence = join(dir, 'evidence');
      await mkdir(profile);
      await mkdir(evidence);
      const path = join(profile, 'gpu-trace-raw.pftrace');
      const outputPath = join(evidence, 'gpu-trace-summary.json');
      const rawBytes = Buffer.from([10, 3, 1, 2, 3]);
      await writeFile(path, rawBytes);
      const summary = decodeNativeGpuTraceRows(
        [
          'event_id,process_count,event_count,completed_count,unfinished_count,first_ns,last_ns,total_ns,max_ns',
          '0,1,1,1,0,0,10,10,10',
          '1,1,1,1,0,0,10,10,10',
          '2,0,0,0,0,0,0,0,0',
          '3,0,0,0,0,0,0,0,0',
          '4,1,0,0,0,0,0,0,0',
          '5,1,0,0,0,0,0,0,0',
          '6,0,0,0,0,0,0,0,0',
        ].join('\n'),
        rawBytes.length,
      );
      const source = { commit: 'exact-source', fingerprint: 'exact-inputs', electron: '45.2.1' };
      const publish = async (document: unknown): Promise<NativeGpuTraceOutput> => {
        const bytes = Buffer.from(JSON.stringify(document));
        await writeFile(outputPath, bytes);
        return {
          retained: true,
          file: 'gpu-trace-summary.json',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          rawTraceUploaded: false,
          captureValid: true,
          parsed: true,
          gpuWorkObserved: true,
        };
      };
      const { trace } = fixture({ path, outputPath, inspect: () => publish({ source, summary }) });
      await trace.run(async () => {});
      expect(await readFile(path)).toEqual(rawBytes);
      expect(await readdir(evidence)).toEqual(['gpu-trace-summary.json']);
      expect(trace.receipt.output).toMatchObject({
        retained: true,
        rawTraceUploaded: false,
        parsed: true,
        captureValid: true,
        gpuWorkObserved: true,
        file: 'gpu-trace-summary.json',
        sha256: expect.any(String),
      });
      trace.receipt.completeness = 'partial-or-uncertain';
      const report = { success: false, source: trace.receipt.source, gpuTrace: trace.receipt };
      expect(await validateNativeGpuTraceEvidence(report, evidence)).toMatchObject({
        outcome: 'retained-typed-gpu-work-summary',
        completeness: 'partial-or-uncertain',
      });
      const exactConfig = {
        included_categories: [
          'gpu',
          'gpu.service',
          'gpu.angle',
          'viz',
          'toplevel',
          'disabled-by-default-gpu.service',
          'disabled-by-default-gpu.device',
          'disabled-by-default-gpu.debug',
          'disabled-by-default-angle',
        ],
        recording_mode: 'record-continuously',
        trace_buffer_size_in_kb: 16384,
        enable_argument_filter: true,
      };
      expect(trace.receipt.config).toEqual(exactConfig);
      expect(trace.receipt.scope).toBe(
        'unchanged-babylon-inspect-through-authored-wheel-check-or-first-gpu-fault',
      );
      expect(trace.receipt.omittedGameplayChecks).toEqual([]);
      const tamperedConfigs: [string, unknown][] = [
        ['missing config', undefined],
        ['null config', null],
        ['sparse categories', { ...exactConfig, included_categories: Array(9) }],
        [
          'reordered categories',
          { ...exactConfig, included_categories: [...exactConfig.included_categories].reverse() },
        ],
        [
          'missing category',
          { ...exactConfig, included_categories: exactConfig.included_categories.slice(1) },
        ],
        [
          'extra category',
          { ...exactConfig, included_categories: [...exactConfig.included_categories, '*'] },
        ],
        [
          'duplicate category',
          {
            ...exactConfig,
            included_categories: ['gpu', ...exactConfig.included_categories.slice(0, -1)],
          },
        ],
        [
          'replaced category',
          {
            ...exactConfig,
            included_categories: ['private-category', ...exactConfig.included_categories.slice(1)],
          },
        ],
        [
          'nonarray categories',
          { ...exactConfig, included_categories: exactConfig.included_categories.join(',') },
        ],
        ['larger buffer', { ...exactConfig, trace_buffer_size_in_kb: 16385 }],
        ['smaller buffer', { ...exactConfig, trace_buffer_size_in_kb: 16383 }],
        ['string buffer', { ...exactConfig, trace_buffer_size_in_kb: '16384' }],
        ['different recording mode', { ...exactConfig, recording_mode: 'record-until-full' }],
        ['disabled argument filter', { ...exactConfig, enable_argument_filter: false }],
        ['coerced argument filter', { ...exactConfig, enable_argument_filter: 1 }],
        ['extra config key', { ...exactConfig, excluded_categories: [] }],
        ...Object.keys(exactConfig).map((key): [string, unknown] => [
          `missing config key ${key}`,
          Object.fromEntries(Object.entries(exactConfig).filter(([entry]) => entry !== key)),
        ]),
      ];
      for (const [label, config] of tamperedConfigs) {
        await expect(
          validateNativeGpuTraceEvidence(
            { ...report, gpuTrace: { ...trace.receipt, config } },
            evidence,
          ),
          label,
        ).rejects.toThrow();
      }
      for (const scope of [undefined, '', 'inspect-only', `${trace.receipt.scope} `]) {
        await expect(
          validateNativeGpuTraceEvidence(
            { ...report, gpuTrace: { ...trace.receipt, scope } },
            evidence,
          ),
          'altered or missing fixed scope',
        ).rejects.toThrow();
      }
      for (const omittedGameplayChecks of [undefined, null, '', {}, ['authored-wheel-check']]) {
        await expect(
          validateNativeGpuTraceEvidence(
            { ...report, gpuTrace: { ...trace.receipt, omittedGameplayChecks } },
            evidence,
          ),
          'omitted gameplay checks must be exactly an empty array',
        ).rejects.toThrow();
      }
      // Tampered reports never mutate the one valid receipt or its retained summary.
      await expect(validateNativeGpuTraceEvidence(report, evidence)).resolves.toMatchObject({
        outcome: 'retained-typed-gpu-work-summary',
      });
      const reportPath = join(evidence, 'report.json');
      await writeFile(reportPath, JSON.stringify(report));
      const script = fileURLToPath(new URL('../scripts/native-gpu-trace.mjs', import.meta.url));
      const valid = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(valid.status, valid.stderr.toString()).toBe(0);
      expect(
        JSON.parse(await readFile(join(evidence, 'gpu-trace-validation.json'), 'utf8')).outcome,
      ).toBe('retained-typed-gpu-work-summary');
      // A gameplay PASS must not masquerade as useful GPU-work evidence.
      await writeFile(reportPath, JSON.stringify({ success: true }));
      const missing = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(missing.status).toBe(1);
      expect(
        JSON.parse(await readFile(join(evidence, 'gpu-trace-validation.json'), 'utf8')).outcome,
      ).toBe('trace-evidence-unavailable');
      await expect(
        validateNativeGpuTraceEvidence({ ...report, source: {} }, evidence),
      ).rejects.toThrow('source');
      const wrongPath = {
        ...report,
        gpuTrace: { ...trace.receipt, output: { ...trace.receipt.output, file: '../other' } },
      };
      await expect(validateNativeGpuTraceEvidence(wrongPath, evidence)).rejects.toThrow('bounded');
      const noCoverage = {
        ...report,
        gpuTrace: { ...trace.receipt, output: { ...trace.receipt.output, gpuWorkObserved: false } },
      };
      await expect(validateNativeGpuTraceEvidence(noCoverage, evidence)).rejects.toThrow(
        'coverage',
      );
      const oversized = {
        ...report,
        gpuTrace: {
          ...trace.receipt,
          output: { ...trace.receipt.output, bytes: NATIVE_TRACE_PROCESSOR.maxSummaryBytes + 1 },
        },
      };
      await expect(validateNativeGpuTraceEvidence(oversized, evidence)).rejects.toThrow('bounded');
      const original = await readFile(outputPath);
      await writeFile(outputPath, Buffer.alloc(original.length, 32));
      await expect(validateNativeGpuTraceEvidence(report, evidence)).rejects.toThrow('digest');
      trace.receipt.output = await publish({
        source,
        summary: { ...summary, secret: 'must not publish' },
      });
      await expect(validateNativeGpuTraceEvidence(report, evidence)).rejects.toThrow(
        'summary-invalid',
      );
      trace.receipt.output = await publish({
        source: { ...source, secret: 'must not publish' },
        summary,
      });
      await expect(validateNativeGpuTraceEvidence(report, evidence)).rejects.toThrow();
      const malformed = Buffer.from('{"PRIVATE_TRACE_PARSE_ERROR_SENTINEL":');
      await writeFile(outputPath, malformed);
      trace.receipt.output = {
        ...trace.receipt.output!,
        bytes: malformed.length,
        sha256: createHash('sha256').update(malformed).digest('hex'),
      };
      await writeFile(reportPath, JSON.stringify(report));
      const invalid = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(invalid.status).toBe(1);
      expect(JSON.parse(invalid.stdout.toString())).toEqual({
        outcome: 'trace-evidence-unavailable',
        error: 'trace-summary-validation-failed',
      });
      expect(invalid.stdout.toString() + invalid.stderr.toString()).not.toContain(
        'PRIVATE_TRACE_PARSE_ERROR_SENTINEL',
      );
      expect(invalid.stdout.toString() + invalid.stderr.toString()).not.toContain(dir);
      trace.cleanup({ producerClosed: true });
      await vi.waitFor(async () => {
        await expect(readFile(path)).rejects.toThrow('ENOENT');
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
