import { afterEach, expect, it, vi } from 'vitest';
import { TelemetryExport } from '../src/storage/telemetry-export.ts';
import { TELEMETRY_STRIDE } from '../src/storage/telemetry-schema.ts';
class WorkerStub {
  static workers: WorkerStub[] = [];
  onmessage: ((event: { data: { id: number; blob?: Blob; error?: string } }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  id = 0;
  constructor() {
    WorkerStub.workers.push(this);
  }
  postMessage(message: { id: number }) {
    this.id = message.id;
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  WorkerStub.workers.length = 0;
});
it('cancels stale results without letting old worker errors kill the new export', async () => {
  vi.stubGlobal('Worker', WorkerStub);
  const exporter = new TelemetryExport();
  const first = exporter
    .export(new Float32Array(TELEMETRY_STRIDE), 1)
    .catch((error: Error) => error.message);
  const old = WorkerStub.workers[0];
  const next = exporter.export(new Float32Array(TELEMETRY_STRIDE), 1);
  const current = WorkerStub.workers[1];
  expect(await first).toContain('cancelled');
  old.onerror?.({ message: 'late old worker error' });
  old.onmessage?.({ data: { id: old.id, blob: new Blob(['old']) } });
  expect(current.terminated).toBe(false);
  current.onmessage?.({ data: { id: current.id, blob: new Blob(['new']) } });
  expect(await (await next).text()).toBe('new');
  expect(current.terminated).toBe(true);
});
it('rejects worker failures and bounds a hung export', async () => {
  vi.stubGlobal('Worker', WorkerStub);
  vi.useFakeTimers();
  const exporter = new TelemetryExport();
  const failed = exporter.export(new Float32Array(0), 0).catch((error: Error) => error.message);
  const worker = WorkerStub.workers[0];
  worker.onmessage?.({ data: { id: worker.id, error: 'invalid record' } });
  expect(await failed).toBe('invalid record');
  const timed = exporter.export(new Float32Array(0), 0).catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(30001);
  expect(await timed).toContain('timed out');
  expect(WorkerStub.workers[1].terminated).toBe(true);
});
