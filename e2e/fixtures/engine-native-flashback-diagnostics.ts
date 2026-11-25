import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { CAR_STRIDE, H, HEADER } from '../../src/simulation/protocol.ts';
import {
  isEngineeringSample,
  type ClientMessage,
  type EngineeringMessage,
  type PauseReceipt,
  type SurfaceMessage,
  type WorkerMessage,
} from '../../src/workers/diagnostics.ts';

type Frame = { index: number; bytes: number; tick: number; time: number; cars: number };
type Surface = {
  index: number;
  epoch: number;
  sequence: number;
  time: number;
  lengths: number[];
  finite: boolean;
};
type Completion = Extract<WorkerMessage, { type: 'flashback' }> & { index: number };
type ReturnKind = 'frame' | 'telemetry' | 'replayFrames';
type Pending = { check(): void; reject(error: Error): void };

const TARGET_TICK = 60;
const OLD_SAMPLE_MIN_TICK = 180;
const OBSERVATION_TICKS = 24;
const WAIT_LIMIT_MS = 30000;
const CASE_LIMIT_MS = 90000;
const MESSAGE_LIMIT = 10000;

/** This host uses the production worker entry verbatim. No worker globals,
 * timers, clocks, simulation methods or postMessage implementation are replaced.
 * Only engineering ACKs are withheld; unrelated ownership is returned normally. */
class NativeDiagnosticsWorker {
  readonly received: WorkerMessage['type'][] = [];
  readonly frames: Frame[] = [];
  readonly surfaces: Surface[] = [];
  readonly completions: Completion[] = [];
  readonly samples: EngineeringMessage[] = [];
  readonly pauses: PauseReceipt[] = [];
  readonly toggles: boolean[] = [];
  readonly surfaceAcks: Array<Pick<SurfaceMessage, 'epoch' | 'sequence'>> = [];
  readonly returned: Record<ReturnKind, { buffers: number; detached: number; bytes: number }> = {
    frame: { buffers: 0, detached: 0, bytes: 0 },
    telemetry: { buffers: 0, detached: 0, bytes: 0 },
    replayFrames: { buffers: 0, detached: 0, bytes: 0 },
  };
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  closed = false;
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Set<Pending>();
  private readonly deadline: ReturnType<typeof setTimeout>;
  private failure: Error | null = null;
  private sequence = 0;

  constructor(source: string) {
    this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    this.deadline = setTimeout(
      () => this.fail(new Error('Native flashback diagnostics exceeded its failure deadline')),
      CASE_LIMIT_MS,
    );
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error('Native worker error: ' + event.message));
    };
    this.worker.onmessageerror = () =>
      this.fail(new Error('Native worker message decoding failed'));
    this.worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (this.failure || this.closed) return;
      try {
        const index = this.received.length;
        if (index >= MESSAGE_LIMIT)
          throw new Error('Native worker exceeded the message failure bound');
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
              throw new Error('Invalid native one-car frame');
            this.frames.push(frame);
            this.recycle('frame', data.buffer);
            break;
          }
          case 'telemetry':
          case 'replayFrames':
            if (!Number.isSafeInteger(data.rows) || data.rows <= 0)
              throw new Error('Invalid native recording row count');
            this.recycle(data.type, data.buffer);
            break;
          case 'surface': {
            // Consume the actual transferred arrays before returning their ticket.
            const arrays = [data.water, data.rubber, data.marbles];
            if (data.frozen) arrays.push(data.frozen);
            this.surfaces.push({
              index,
              epoch: data.epoch,
              sequence: data.sequence,
              time: data.time,
              lengths: arrays.map((array) => array.length),
              finite: arrays.every(
                (array) =>
                  array instanceof Float32Array && array.length > 0 && array.every(Number.isFinite),
              ),
            });
            this.send({ type: 'surfaceAck', epoch: data.epoch, sequence: data.sequence });
            this.surfaceAcks.push({ epoch: data.epoch, sequence: data.sequence });
            break;
          }
          case 'engineering':
            this.samples.push(data);
            break;
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
            throw new Error('Production worker error: ' + data.message);
        }
        for (const waiter of [...this.pending]) waiter.check();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    };
  }

  send(message: ClientMessage, transfer: Transferable[] = []) {
    if (this.closed) throw new Error('Native diagnostics worker is closed');
    if (this.failure) throw this.failure;
    this.worker.postMessage(message, transfer);
    if (message.type === 'engineering') this.toggles.push(message.enabled);
  }

  private recycle(kind: ReturnKind, buffer: ArrayBuffer) {
    const bytes = buffer.byteLength;
    if (!bytes) throw new Error('Received a detached native ' + kind + ' buffer');
    const type =
      kind === 'frame' ? 'recycle' : kind === 'telemetry' ? 'recycleTelemetry' : 'recycleReplay';
    this.send({ type, buffer }, [buffer]);
    const receipt = this.returned[kind];
    receipt.buffers++;
    receipt.bytes += bytes;
    if (buffer.byteLength === 0) receipt.detached++;
    else throw new Error('Native ' + kind + ' return did not detach its buffer');
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
        () => waiter.reject(new Error('Native worker did not produce ' + label)),
        WAIT_LIMIT_MS,
      );
      this.pending.add(waiter);
    });
  }

  async pause(value: boolean) {
    const sequence = ++this.sequence;
    this.send({ type: 'pause', value, sequence });
    return this.waitFor('pause receipt ' + sequence, () =>
      this.pauses.find((receipt) => receipt.sequence === sequence),
    );
  }

  async runTo(tick: number) {
    const start = this.frames.length;
    await this.pause(false);
    await this.waitFor('a real frame at tick ' + tick, () =>
      this.frames.slice(start).find((frame) => frame.tick >= tick),
    );
    return this.pause(true);
  }

  acknowledge(message: Pick<EngineeringMessage, 'epoch' | 'sequence'>) {
    this.send({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
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
    for (const waiter of [...this.pending]) waiter.reject(new Error('Native worker terminated'));
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

export async function heldDiagnosticAcrossFlashback(source: string) {
  const h = new NativeDiagnosticsWorker(source);
  let report;
  try {
    h.send({
      type: 'init',
      options: { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, seed: 706034 },
    });
    const initial = await h.waitFor('initial frame', () => h.frames[0]);
    const oldPause = await h.runTo(OLD_SAMPLE_MIN_TICK);

    // Enable exactly once, at a tick later than the entire rewound observation.
    h.send({ type: 'engineering', enabled: true });
    const old = await h.waitFor('the original diagnostic', () => h.samples[0]);
    const oldJSON = JSON.stringify(old);
    h.send({ type: 'flashback', tick: TARGET_TICK });
    const completionFrame = await h.waitFor('flashback completion frame', () => {
      const completion = h.completions[0];
      return completion && h.frames.find((frame) => frame.index > completion.index);
    });
    const completion = h.completions[0];
    const completionSurface = h.surfaces.find((surface) => surface.index === completion.index + 1);
    if (!completionSurface) throw new Error('Flashback did not publish its matching surface');
    const completionOrder = h.received.slice(completion.index, completionFrame.index + 1);
    const completionPause = await h.pause(true);
    const atCompletion = {
      diagnostics: h.samples.length,
      order: completionOrder,
      completion,
      surface: completionSurface,
      frame: completionFrame,
      pause: completionPause,
    };

    // Live native timer turns prove that rebasing did not silently replenish the
    // single engineering credit. Frames and recording buffers continue to flow.
    const heldFramesStart = h.frames.length;
    const heldPause = await h.runTo(TARGET_TICK + OBSERVATION_TICKS);
    const held = {
      diagnostics: h.samples.length,
      pause: heldPause,
      advancingFrames: h.frames.slice(heldFramesStart),
    };
    if (held.diagnostics !== 1) throw new Error('Flashback bypassed the held engineering credit');
    if (heldPause.tick + 12 >= old.sample.tick)
      throw new Error('Native observation did not remain below the old diagnostic cadence tick');

    // The old epoch ticket is still the only valid owner. Its ACK must produce a
    // new-timeline sample now, while paused, without another engineering toggle.
    h.acknowledge(old);
    const freshPause = await h.pause(true);
    const fresh = h.samples[1];
    if (!fresh)
      throw new Error('The original ACK did not restore enabled diagnostics after flashback');
    const freshJSON = JSON.stringify(fresh);

    // Test stale ownership while actual physics advances beyond the 12-tick
    // cadence. At the same paused tick, an incorrectly freed credit could hide.
    h.acknowledge(old);
    h.acknowledge({ epoch: fresh.epoch, sequence: old.sequence });
    const duplicateFramesStart = h.frames.length;
    const duplicatePause = await h.runTo(fresh.sample.tick + OBSERVATION_TICKS);
    const duplicate = {
      diagnostics: h.samples.length,
      pause: duplicatePause,
      advancingFrames: h.frames.slice(duplicateFramesStart),
    };
    if (duplicate.diagnostics !== 2)
      throw new Error('A stale ACK released the new engineering credit');
    h.acknowledge(fresh);
    const nextPause = await h.pause(true);
    const next = h.samples[2];
    if (!next) throw new Error('The current ACK did not publish the next diagnostic');

    report = {
      initial,
      oldPause,
      old,
      atCompletion,
      held,
      fresh,
      freshPause,
      duplicate,
      next,
      nextPause,
      toggles: [...h.toggles],
      allSamplesValid: h.samples.every((message) => isEngineeringSample(message.sample)),
      oldImmutable: JSON.stringify(old) === oldJSON,
      freshImmutable: JSON.stringify(fresh) === freshJSON,
      diagnosticCount: h.samples.length,
      surfaceCount: h.surfaces.length,
      surfaceAcks: [...h.surfaceAcks],
      surfacesValid: h.surfaces.every((surface) => surface.finite),
      returned: h.returned,
      warnings: [...h.warnings],
      errors: [...h.errors],
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}
