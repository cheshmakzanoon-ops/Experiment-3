import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryExport } from '../src/storage/telemetry-export.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import { CHANNELS, TELEMETRY_STRIDE, telemetryCsv } from '../src/storage/telemetry-schema.ts';

interface ExportRequest {
  id: number;
  values: Float32Array;
  count: number;
}

/** Detach the actual transfer list so a passing test cannot hide a borrowed
 * recorder buffer or depend on the sender retaining its disposable snapshot. */
class ExportWorker {
  static workers: ExportWorker[] = [];
  static constructorFailure: Error | null = null;
  static postFailure: Error | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: ExportRequest | null = null;
  terminate = vi.fn();
  constructor() {
    if (ExportWorker.constructorFailure) throw ExportWorker.constructorFailure;
    ExportWorker.workers.push(this);
  }
  postMessage(message: ExportRequest, transfer: Transferable[]) {
    if (ExportWorker.postFailure) throw ExportWorker.postFailure;
    expect(transfer).toEqual([message.values.buffer]);
    this.request = structuredClone(message, { transfer });
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
  fail(message: string) {
    const event = Object.assign(new Event('error', { cancelable: true }), { message });
    this.onerror?.(event as ErrorEvent);
    return event;
  }
}

const exporters: TelemetryExport[] = [];
function exporter() {
  const instance = new TelemetryExport();
  exporters.push(instance);
  return instance;
}
function job(instance: TelemetryExport, values = new Float32Array(0), count = 0) {
  const result = instance.export(values, count).then(
    (blob) => ({ blob, error: null }),
    (error: Error) => ({ blob: null, error }),
  );
  return { result, worker: ExportWorker.workers.at(-1)! };
}
function complete(worker: ExportWorker, text = 'complete') {
  worker.reply({ id: worker.request!.id, blob: new Blob([text]) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', ExportWorker);
});
afterEach(() => {
  for (const instance of exporters.splice(0)) instance.cancel();
  ExportWorker.workers.length = 0;
  ExportWorker.constructorFailure = ExportWorker.postFailure = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('telemetry export worker lifetime', () => {
  it('replaces and explicitly cancels jobs without stale callbacks releasing their successor', async () => {
    const instance = exporter();
    const first = job(instance);
    const second = job(instance);
    expect((await first.result).error?.message).toBe('Telemetry export cancelled');
    expect(first.worker.terminate).toHaveBeenCalledTimes(1);

    first.worker.reply(null);
    first.worker.reply({ id: first.worker.request!.id, blob: new Blob(['stale']) });
    first.worker.fail('late failure');
    first.worker.onmessageerror?.();
    expect(second.worker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    instance.cancel();
    instance.cancel();
    expect((await second.result).error?.message).toBe('Telemetry export cancelled');
    expect(second.worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const next = job(instance);
    complete(next.worker);
    expect(await (await next.result).blob!.text()).toBe('complete');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['active', 'cancelled', 'replaced', 'completed'] as const)(
    'cancels default error reporting when the export is %s',
    async (state) => {
      const instance = exporter();
      const first = job(instance);
      let replacement: ReturnType<typeof job> | undefined;
      if (state === 'cancelled') instance.cancel();
      if (state === 'replaced') replacement = job(instance);
      if (state === 'completed') complete(first.worker);

      const event = first.worker.fail('CSV worker failed');
      expect(event.defaultPrevented).toBe(true);
      if (state === 'active')
        expect((await first.result).error?.message).toBe('CSV worker failed');
      expect(first.worker.terminate).toHaveBeenCalledTimes(1);
      if (replacement) {
        expect(replacement.worker.terminate).not.toHaveBeenCalled();
        complete(replacement.worker);
        expect((await replacement.result).error).toBeNull();
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['timeout', 'messageerror'] as const)(
    'releases the worker and timer after %s and allows another export',
    async (failure) => {
      const instance = exporter();
      const first = job(instance);
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30000);
      else first.worker.onmessageerror?.();
      expect((await first.result).error?.message).toBe(
        failure === 'timeout' ? 'Telemetry export timed out' : 'Telemetry transfer failed',
      );
      expect(first.worker.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      const next = job(instance);
      complete(next.worker);
      expect((await next.result).error).toBeNull();
    },
  );

  it.each(['constructor', 'post'] as const)(
    'recovers from a synchronous worker %s failure without leaving a timer or live worker',
    async (failure) => {
      const instance = exporter();
      const error = new DOMException('Worker unavailable', 'DataCloneError');
      if (failure === 'constructor') ExportWorker.constructorFailure = error;
      else ExportWorker.postFailure = error;
      const failed = job(instance);
      expect((await failed.result).error).toBe(error);
      if (failure === 'constructor') expect(ExportWorker.workers).toHaveLength(0);
      else expect(failed.worker.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      ExportWorker.constructorFailure = ExportWorker.postFailure = null;
      const next = job(instance);
      complete(next.worker);
      expect((await next.result).error).toBeNull();
    },
  );

  it('ignores replies for another job until the matching blob arrives', async () => {
    const current = job(exporter());
    current.worker.reply({ id: current.worker.request!.id + 1, blob: new Blob(['wrong']) });
    current.worker.reply({ id: current.worker.request!.id - 1, error: 'wrong failure' });
    expect(current.worker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    complete(current.worker, 'matching');
    expect(await (await current.result).blob!.text()).toBe('matching');
    expect(current.worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, undefined, false, 42, 'invalid', {}, [], { id: 'invalid' }])(
    'rejects malformed reply %j through the promise without throwing from the event handler',
    async (reply) => {
      const current = job(exporter());
      expect(() => current.worker.reply(reply)).not.toThrow();
      expect(current.worker.terminate).toHaveBeenCalledTimes(1);
      expect((await current.result).error?.message).toBe('Export worker returned invalid data');
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([undefined, null, false, {}, 'CSV text', new Uint8Array([1, 2])])(
    'rejects a non-Blob result %j before it can reach the download caller',
    async (blob) => {
      const current = job(exporter());
      current.worker.reply({ id: current.worker.request!.id, blob });
      expect((await current.result).error?.message).toBe('Export worker returned no data');
      expect(current.worker.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

async function csvWorker() {
  const replies: unknown[] = [];
  const scope = {
    onmessage: null as ((event: { data: ExportRequest }) => void) | null,
    postMessage: (reply: unknown) => replies.push(structuredClone(reply)),
  };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('../src/workers/telemetry.worker.ts');
  return (worker: ExportWorker) => {
    scope.onmessage!({ data: worker.request! });
    for (const reply of replies.splice(0)) worker.reply(reply);
  };
}

describe('telemetry export worker protocol integration', () => {
  it('exports the transferred chronological snapshot byte-for-byte while the recorder keeps recording', async () => {
    const deliver = await csvWorker();
    const recorder = new TelemetryRecorder(1);
    const rows = 65;
    const values = Float32Array.from(
      { length: rows * TELEMETRY_STRIDE },
      (_, index) => index / 8 - 200,
    );
    recorder.appendBatch(values, rows);
    const snapshot = recorder.snapshot();
    const expected = await telemetryCsv(snapshot, recorder.count).text();
    const recorded = recorder.snapshot();
    const current = job(exporter(), snapshot, recorder.count);
    expect(snapshot.byteLength).toBe(0);
    expect(current.worker.request!.values).toEqual(recorded);
    expect(recorder.snapshot()).toEqual(recorded);

    recorder.appendBatch(new Float32Array(TELEMETRY_STRIDE).fill(123), 1);
    expect(recorder.at(recorder.count - 1, 0)).toBe(123);
    deliver(current.worker);
    const result = await current.result;
    expect(result.error).toBeNull();
    expect(result.blob!.type).toBe('text/csv;charset=utf-8');
    expect(await result.blob!.text()).toBe(expected);
    expect(expected.split('\n')[0]).toBe(CHANNELS.join(','));
    expect(expected.split('\n')[1]).toBe(
      Array.from(values.subarray(5 * TELEMETRY_STRIDE, 6 * TELEMETRY_STRIDE)).join(','),
    );
    expect(current.worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['shape', 'non-finite'] as const)(
    'returns the real CSV worker %s validation failure through the export promise',
    async (failure) => {
      const deliver = await csvWorker();
      const values = new Float32Array(TELEMETRY_STRIDE);
      if (failure === 'non-finite') values[3] = NaN;
      const current = job(exporter(), values, failure === 'shape' ? 2 : 1);
      deliver(current.worker);
      const result = await current.result;
      expect(result.blob).toBeNull();
      expect(result.error?.message).toBe(
        failure === 'shape'
          ? 'Invalid telemetry export shape'
          : `Non-finite telemetry at row 0, channel ${CHANNELS[3]}`,
      );
      expect(current.worker.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
