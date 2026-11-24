/// <reference lib="webworker" />

/** Test-only scheduling adapter, evaluated before either actual worker module.
 * Native message dispatch and transfer lists stay intact. Only the monotonic
 * clock and interval trigger are controlled, so a stall need not take a minute
 * of real browser time. This is a protocol/lifetime test, not a CPU benchmark. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = scope.postMessage.bind(scope) as (message: unknown, transfer: Transferable[]) => void;
const intervals = new Map<number, () => void>();
let now = 0;
let nextInterval = 0;
let pumps = 0;

export interface NativeClockSnapshot {
  now: number;
  pumps: number;
  intervals: number;
  transfers: Record<string, { messages: number; buffers: number; detached: number; bytes: number }>;
}
const transfers: NativeClockSnapshot['transfers'] = {};

Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
scope.setInterval = ((callback: TimerHandler) => {
  if (typeof callback !== 'function')
    throw new Error('The native fixture requires callable timers');
  const id = ++nextInterval;
  intervals.set(id, callback as () => void);
  return id;
}) as typeof scope.setInterval;
scope.clearInterval = ((id: number) => intervals.delete(id)) as typeof scope.clearInterval;

scope.postMessage = ((message: { type?: string }, transfer: Transferable[] = []) => {
  const buffers = transfer.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer);
  const bytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  // This is the native transfer. Observe only AFTER it returns; no clone or
  // replacement buffer is supplied by this adapter.
  post(message, transfer);
  const key = message.type ?? 'unknown';
  const sample = (transfers[key] ??= { messages: 0, buffers: 0, detached: 0, bytes: 0 });
  sample.messages++;
  sample.buffers += buffers.length;
  sample.detached += buffers.filter((buffer) => buffer.byteLength === 0).length;
  sample.bytes += bytes;
}) as typeof scope.postMessage;

scope.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as {
    __engineNative?: boolean;
    id: number;
    operation: 'barrier' | 'advance';
    steps?: number;
    milliseconds?: number;
  };
  if (!message?.__engineNative) return;
  // The listener was registered before the production onmessage handler. Test
  // controls never enter the engine's wire protocol; ordinary messages do.
  event.stopImmediatePropagation();
  try {
    if (message.operation === 'advance') {
      const steps = message.steps ?? 0;
      const milliseconds = message.milliseconds ?? 0;
      if (
        !Number.isSafeInteger(steps) ||
        steps < 0 ||
        steps > 1000 ||
        !Number.isFinite(milliseconds) ||
        milliseconds <= 0 ||
        milliseconds > 100
      )
        throw new Error('Invalid controlled worker advance');
      for (let i = 0; i < steps; i++) {
        now += milliseconds;
        for (const callback of intervals.values()) {
          callback();
          pumps++;
        }
      }
    } else if (message.operation !== 'barrier') throw new Error('Unknown native fixture control');
    post(
      {
        __engineNative: 'receipt',
        id: message.id,
        snapshot: { now, pumps, intervals: intervals.size, transfers },
      },
      [],
    );
  } catch (error) {
    post(
      {
        __engineNative: 'failure',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      },
      [],
    );
  }
});

export function announceNativeWorker(kind: 'circuit' | 'festival') {
  post({ __engineNative: 'ready', kind, intervals: intervals.size }, []);
}
