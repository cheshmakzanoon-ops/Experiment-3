import { controls, DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { CAR_STRIDE, H, HEADER } from '../../src/simulation/protocol.ts';
import type {
  ClientMessage,
  PauseReceipt,
  WorkerMessage,
} from '../../src/workers/diagnostics.ts';
import type { IdleObservation } from './engine-native-worker-idle-observer.ts';

type Frame = { index: number; bytes: number; tick: number; time: number; cars: number };
type Completion = Extract<WorkerMessage, { type: 'flashback' }> & { index: number };
type ReturnKind = 'frame' | 'telemetry' | 'replayFrames';
type Pending = { check(): void; reject(error: Error): void };
const OBSERVATION_MS = 80;
const WAIT_LIMIT_MS = 30000;

/** Actual DedicatedWorker and native transfers. The separate worker prelude
 * observes timer calls; this host never changes timer delivery or physics. */
class NativeIdleWorker {
  readonly frames: Frame[] = [];
  readonly completions: Completion[] = [];
  readonly pauses: PauseReceipt[] = [];
  readonly observations: IdleObservation[] = [];
  readonly received: WorkerMessage['type'][] = [];
  readonly terminalErrors: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  readonly returned: Record<ReturnKind, { buffers: number; detached: number; bytes: number }> = {
    frame: { buffers: 0, detached: 0, bytes: 0 },
    telemetry: { buffers: 0, detached: 0, bytes: 0 },
    replayFrames: { buffers: 0, detached: 0, bytes: 0 },
  };
  surfaceCount = 0;
  surfaceAcks = 0;
  surfacesValid = true;
  closed = false;
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Set<Pending>();
  private readonly deadline: ReturnType<typeof setTimeout>;
  private failure: Error | null = null;
  private expectedError: string | null = null;
  private pauseSequence = 0;
  private observationSequence = 0;

  constructor(source: string) {
    this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      this.worker = new Worker(this.url);
    } catch (error) {
      URL.revokeObjectURL(this.url);
      throw error;
    }
    this.deadline = setTimeout(
      () => this.fail(new Error('Native worker idle case exceeded its failure deadline')),
      90000,
    );
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error('Native worker error: ' + event.message));
    };
    this.worker.onmessageerror = () => this.fail(new Error('Native worker message decoding failed'));
    this.worker.onmessage = ({ data }: MessageEvent<WorkerMessage | IdleObservation>) => {
      if (this.failure || this.closed) return;
      try {
        if (data.type === '__engineIdleObservation') this.observations.push(data);
        else {
          const index = this.received.length;
          if (index >= 10000) throw new Error('Native worker exceeded its message bound');
          this.received.push(data.type);
          switch (data.type) {
            case 'frame': {
              const values = new Float32Array(data.buffer);
              const frame = {
                index,
                bytes: data.buffer.byteLength,
                tick: values[H.TICK],
                time: values[H.TIME],
                cars: values[H.CARS],
              };
              if (
                frame.bytes !== (HEADER + CAR_STRIDE) * 4 ||
                frame.cars !== 1 ||
                !Number.isSafeInteger(frame.tick) ||
                !Number.isFinite(frame.time)
              )
                throw new Error('Invalid native idle-test frame');
              this.frames.push(frame);
              this.recycle('frame', data.buffer);
              break;
            }
            case 'telemetry':
            case 'replayFrames':
              if (!Number.isSafeInteger(data.rows) || data.rows <= 0)
                throw new Error('Invalid native recording rows');
              this.recycle(data.type, data.buffer);
              break;
            case 'surface': {
              const arrays = [data.water, data.rubber, data.marbles];
              if (data.frozen) arrays.push(data.frozen);
              this.surfacesValid &&= arrays.every(
                (array) =>
                  array instanceof Float32Array &&
                  array.length > 0 &&
                  array.every(Number.isFinite),
              );
              this.surfaceCount++;
              this.send({ type: 'surfaceAck', epoch: data.epoch, sequence: data.sequence });
              this.surfaceAcks++;
              break;
            }
            case 'pauseState':
              this.pauses.push(data);
              break;
            case 'flashback':
              this.completions.push({ ...data, index });
              break;
            case 'recordingWarning':
              this.warnings.push(data.message);
              break;
            case 'error':
              if (data.message !== this.expectedError)
                throw new Error('Unexpected production worker error: ' + data.message);
              this.expectedError = null;
              this.terminalErrors.push(data.message);
              break;
          }
        }
        for (const waiter of [...this.pending]) waiter.check();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    };
  }

  send(message: ClientMessage, transfer: Transferable[] = []) {
    if (this.closed) throw new Error('Native idle worker is closed');
    if (this.failure) throw this.failure;
    this.worker.postMessage(message, transfer);
  }

  private recycle(kind: ReturnKind, buffer: ArrayBuffer) {
    const bytes = buffer.byteLength;
    if (!bytes) throw new Error('Received detached native ' + kind + ' storage');
    const type =
      kind === 'frame' ? 'recycle' : kind === 'telemetry' ? 'recycleTelemetry' : 'recycleReplay';
    this.send({ type, buffer }, [buffer]);
    const returned = this.returned[kind];
    returned.buffers++;
    returned.bytes += bytes;
    if (buffer.byteLength !== 0) throw new Error('Native ' + kind + ' return did not detach');
    returned.detached++;
  }

  waitFor<T>(label: string, read: () => T | undefined): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const existing = read();
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(waiter);
      };
      const waiter: Pending = {
        check: () => {
          const value = read();
          if (value === undefined) return;
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      };
      const timer = setTimeout(
        () => waiter.reject(new Error('Native idle worker did not produce ' + label)),
        WAIT_LIMIT_MS,
      );
      this.pending.add(waiter);
    });
  }

  observe(duration = 0) {
    if (this.closed) throw new Error('Native idle worker is closed');
    if (this.failure) throw this.failure;
    const sequence = ++this.observationSequence;
    this.worker.postMessage({ type: '__engineIdleObserve', sequence, duration });
    return this.waitFor('timer observation ' + sequence, () =>
      this.observations.find((observation) => observation.sequence === sequence),
    );
  }

  async initialize() {
    const start = this.frames.length;
    this.send({
      type: 'init',
      options: {
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        vehicles: ['apx01'],
        seed: 74040,
      },
    });
    return this.waitFor('fresh initialized frame', () => this.frames[start]);
  }

  async pause(value: boolean) {
    const sequence = ++this.pauseSequence;
    this.send({ type: 'pause', value, sequence });
    return this.waitFor('pause receipt ' + sequence, () =>
      this.pauses.find((receipt) => receipt.sequence === sequence),
    );
  }

  async advanceTo(tick: number) {
    const start = this.frames.length;
    return this.waitFor('running frame at tick ' + tick, () =>
      this.frames.slice(start).find((frame) => frame.tick >= tick),
    );
  }

  async invalidPause() {
    this.expectedError = 'Invalid worker pause sequence';
    const start = this.terminalErrors.length;
    this.send({ type: 'pause', value: true, sequence: 0 });
    return this.waitFor('the deliberate terminal protocol error', () => this.terminalErrors[start]);
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    this.errors.push(error.message);
    for (const waiter of [...this.pending]) waiter.reject(error);
  }

  get pendingCount() {
    return this.pending.size;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.deadline);
    for (const waiter of [...this.pending]) waiter.reject(new Error('Native idle worker terminated'));
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

export async function idleLifecycle(source: string) {
  const h = new NativeIdleWorker(source);
  let report;
  try {
    // No init is sent until the bootstrap turn has had a real native interval
    // callback. A subsequent observation establishes a complete idle window.
    const bootstrap = await h.observe(OBSERVATION_MS);
    const uninitialized = await h.observe(OBSERVATION_MS);
    const initial = await h.initialize();
    const initialized = await h.observe(OBSERVATION_MS);

    await h.pause(false);
    await h.advanceTo(120);
    const running = await h.observe();
    const repeated = [];
    for (let i = 0; i < 3; i++) {
      await h.pause(false);
      repeated.push(await h.observe());
    }
    const pause = await h.pause(true);
    const pauseFrame = h.frames.at(-1)!;
    const paused = await h.observe(OBSERVATION_MS);

    const beforeRewind = h.completions.length;
    h.send({ type: 'flashback', tick: 60 });
    const rewindFrame = await h.waitFor('native rewind completion frame', () => {
      const completion = h.completions[beforeRewind];
      return completion && h.frames.find((frame) => frame.index > completion.index);
    });
    const completion = h.completions[beforeRewind];
    const rewindOrder = h.received.slice(completion.index, rewindFrame.index + 1);
    const rewound = await h.observe(OBSERVATION_MS);
    const rewindPause = await h.pause(true);

    await h.pause(false);
    await h.advanceTo(84);
    const resumed = await h.observe();
    const terminalError = await h.invalidPause();
    const terminal = await h.observe();
    const messagesAfterFailure = h.received.length,
      framesAfterFailure = h.frames.length;
    // A failed owner must not be revived by queued host traffic. No pause
    // receipt is expected until a fresh init admits a new simulation.
    h.send({ type: 'pause', value: false, sequence: 1000000 });
    h.send({ type: 'input', input: { ...controls(), throttle: 1 } });
    h.send({ type: 'flashback', tick: 0 });
    const failed = await h.observe(OBSERVATION_MS);
    const ignored = {
      messagesBefore: messagesAfterFailure,
      messagesAfter: h.received.length,
      framesBefore: framesAfterFailure,
      framesAfter: h.frames.length,
    };

    const recoveredFrame = await h.initialize();
    const recovered = await h.observe(OBSERVATION_MS);
    await h.pause(false);
    const recoveryProgress = await h.advanceTo(24);
    const recoveryPause = await h.pause(true);
    const recoveryPauseFrame = h.frames.at(-1)!;
    const final = await h.observe(OBSERVATION_MS);
    report = {
      bootstrap,
      uninitialized,
      initial,
      initialized,
      running,
      repeated,
      pause,
      pauseFrame,
      paused,
      completion,
      rewindFrame,
      rewindOrder,
      rewindPause,
      rewound,
      resumed,
      terminalError,
      terminal,
      failed,
      ignored,
      recoveredFrame,
      recovered,
      recoveryProgress,
      recoveryPause,
      recoveryPauseFrame,
      final,
      returned: h.returned,
      surfaceCount: h.surfaceCount,
      surfaceAcks: h.surfaceAcks,
      surfacesValid: h.surfacesValid,
      terminalErrors: [...h.terminalErrors],
      warnings: [...h.warnings],
      errors: [...h.errors],
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}
