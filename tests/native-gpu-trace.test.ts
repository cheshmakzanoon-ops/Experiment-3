import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
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
      file: 'trace.pftrace',
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

  it('intersects a fixed GPU category allowlist, rejecting malformed or non-GPU inventories', () => {
    expect(Object.isFrozen(NATIVE_GPU_TRACE.categories)).toBe(true);
    expect(() => Reflect.apply(Array.prototype.push, NATIVE_GPU_TRACE.categories, ['*'])).toThrow();
    expect(nativeGpuTraceCategories(['gpu,viz', 'toplevel', 'unknown', '*'])).toEqual([
      'gpu',
      'viz',
      'toplevel',
    ]);
    for (const input of [null, ['viz'], [12], ['x'.repeat(513)], Array(4097).fill('gpu')])
      expect(() => nativeGpuTraceCategories(input)).toThrow();
  });

  it('retains empty and no-match category inventories without starting or broadening a trace', async () => {
    for (const groups of [[], ['viz', 'unknown', '*']]) {
      const { trace, adapter } = fixture();
      adapter.categories.mockResolvedValue(groups);
      expect(await trace.run(async () => 7)).toBe(7);
      expect(adapter.start).not.toHaveBeenCalled();
      expect(trace.receipt).toMatchObject({
        status: 'incomplete',
        config: null,
        categoryInventory: {
          input: 'array',
          reportedGroups: groups.length,
          sampledGroups: groups.length,
          omittedGroups: 0,
          truncated: false,
          sample: groups,
        },
      });
      expect(trace.receipt.errors.join(' ')).toContain('No supported GPU trace categories');
    }
  });

  it('bounds category receipt count, characters and encoded bytes with honest omissions', () => {
    const limits = NATIVE_GPU_TRACE.categoryInventory;
    expect(Object.isFrozen(limits)).toBe(true);
    const oversized = Array(4097).fill('gpu');
    const receipt = nativeGpuTraceCategoryInventory(oversized);
    expect(receipt).toMatchObject({
      reportedGroups: 4097,
      sampledGroups: 64,
      omittedGroups: 4033,
      truncated: true,
    });
    expect(() => nativeGpuTraceCategories(oversized)).toThrow('Invalid');
    const gpuBeyondSample = [...Array(64).fill('unknown'), 'gpu'];
    expect(nativeGpuTraceCategoryInventory(gpuBeyondSample).sample).not.toContain('gpu');
    expect(nativeGpuTraceCategories(gpuBeyondSample)).toEqual(['gpu']);
    for (const group of ['界'.repeat(600), '\u0000'.repeat(600), '😀'.repeat(600)]) {
      const sampled = nativeGpuTraceCategoryInventory(Array(64).fill(group));
      expect(sampled.truncated).toBe(true);
      expect(sampled.truncatedSampledGroups).toBe(sampled.sampledGroups);
      expect(sampled.sampledGroups + sampled.omittedGroups!).toBe(64);
      expect(sampled.sample.every((name) => name!.length <= limits.maxGroupCharacters)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(sampled), 'utf8')).toBeLessThanOrEqual(
        limits.maxBytes,
      );
      expect(JSON.parse(JSON.stringify(sampled))).toEqual(sampled);
    }
    expect(
      nativeGpuTraceCategoryInventory(Array(64).fill('\u0000'.repeat(600))).omittedGroups,
    ).toBeGreaterThan(0);
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
      sampledGroups: 0,
      sample: [],
    });
    const input = [null, 12, malicious, 'gpu'];
    expect(nativeGpuTraceCategoryInventory(input)).toMatchObject({
      reportedGroups: 4,
      sampledGroups: 4,
      omittedGroups: 0,
      malformedSampledGroups: 3,
      sample: [null, null, null, 'gpu'],
    });
    expect(malicious.toJSON).not.toHaveBeenCalled();
    expect(() => nativeGpuTraceCategories(input)).toThrow('Invalid');
  });

  it('records one bounded window with source/config and removes the first-fault watcher', async () => {
    const { trace, adapter, firstFault } = fixture();
    expect(await trace.run(async () => 'original-result')).toBe('original-result');
    expect(adapter.start).toHaveBeenCalledWith({
      included_categories: ['gpu', 'viz', 'toplevel'],
      recording_mode: 'record-continuously',
      trace_buffer_size_in_kb: 16384,
      enable_argument_filter: true,
    });
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(trace.receipt).toMatchObject({
      source: { commit: 'exact-source', electron: '45.2.1' },
      status: 'recorded',
      format: 'perfetto-protobuf',
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
    expect(trace.receipt.errors.join(' ')).toContain('trace writer failed');
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
    expect(trace.receipt.errors.join(' ')).toContain('snapshot failed');
  });

  it('bounds a never-resolving stop without changing the operation result', async () => {
    vi.useFakeTimers();
    const { trace, adapter } = fixture({ stopMs: 5 });
    adapter.stop.mockImplementation(() => new Promise(() => {}));
    const result = trace.run(async () => 17);
    await vi.advanceTimersByTimeAsync(6);
    expect(await result).toBe(17);
    expect(trace.receipt.status).toBe('incomplete');
    expect(trace.receipt.errors.join(' ')).toContain('stop exceeded 5ms');
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

  it('retains a bounded binary as-is and removes oversized output instead of corrupt truncation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'native-gpu-trace-'));
    try {
      const path = join(dir, 'gpu-trace-raw.pftrace');
      const outputPath = join(dir, 'gpu-trace.pftrace');
      const bytes = Buffer.from([10, 3, 1, 2, 3]);
      await writeFile(path, bytes);
      const { trace } = fixture({ path, outputPath, inspect: undefined });
      await trace.run(async () => {});
      expect(await readFile(path)).toEqual(bytes);
      expect(trace.receipt.output).toMatchObject({
        retained: true,
        bytes: 5,
        sha256: expect.any(String),
      });
      // Collection can be useful after a crash without certifying child tails.
      trace.receipt.completeness = 'partial-or-uncertain';
      const report = { success: false, source: trace.receipt.source, gpuTrace: trace.receipt };
      expect(await validateNativeGpuTraceEvidence(report, dir)).toMatchObject({
        outcome: 'retained-bounded-trace',
        completeness: 'partial-or-uncertain',
      });
      const reportPath = join(dir, 'report.json');
      await writeFile(reportPath, JSON.stringify(report));
      const script = fileURLToPath(new URL('../scripts/native-gpu-trace.mjs', import.meta.url));
      const valid = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(valid.status, valid.stderr.toString()).toBe(0);
      expect(
        JSON.parse(await readFile(join(dir, 'gpu-trace-validation.json'), 'utf8')).outcome,
      ).toBe('retained-bounded-trace');
      // A gameplay PASS must not masquerade as successful trace collection.
      await writeFile(reportPath, JSON.stringify({ success: true }));
      const missing = spawnSync(process.execPath, [script, '--validate', reportPath]);
      expect(missing.status).toBe(1);
      expect(
        JSON.parse(await readFile(join(dir, 'gpu-trace-validation.json'), 'utf8')).outcome,
      ).toBe('trace-evidence-unavailable');
      await expect(validateNativeGpuTraceEvidence({ ...report, source: {} }, dir)).rejects.toThrow(
        'source',
      );
      const wrongPath = {
        ...report,
        gpuTrace: { ...trace.receipt, output: { ...trace.receipt.output, file: '../other' } },
      };
      await expect(validateNativeGpuTraceEvidence(wrongPath, dir)).rejects.toThrow('bounded');
      await writeFile(outputPath, Buffer.from([10, 3, 3, 2, 1]));
      await expect(validateNativeGpuTraceEvidence(report, dir)).rejects.toThrow('digest');
      await truncate(path, NATIVE_GPU_TRACE.maxFileBytes + 1);
      const large = fixture({ path, inspect: undefined }).trace;
      await large.run(async () => {});
      expect(large.receipt.output).toMatchObject({
        retained: false,
        reason: 'oversized-trace-removed',
      });
      await expect(readFile(path)).rejects.toThrow('ENOENT');
      expect(large.receipt.status).toBe('incomplete');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
