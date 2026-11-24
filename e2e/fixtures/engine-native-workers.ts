import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { CAR_STRIDE, H, HEADER } from '../../src/simulation/protocol.ts';
import type {
  ClientMessage,
  SurfaceMessage,
  WorkerMessage,
} from '../../src/workers/diagnostics.ts';
import type { FromOpenWorld, ToOpenWorld } from '../../src/workers/open-world-protocol.ts';
import type { NativeClockSnapshot } from './engine-worker-clock.ts';

type Message = WorkerMessage | FromOpenWorld;
type Frame = Extract<Message, { type: 'frame' }>;
type Receipt = {
  resolve: (snapshot: NativeClockSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Each instance owns a real isolated native Worker and Blob URL. FIFO control
 * receipts are sent after preceding production message handling, so assertions
 * do not rely on sleeps, guessed frame counts, or main-thread RAF cadence. */
class NativeEngineWorker {
  readonly messages: Message[] = [];
  readonly returned = { buffers: 0, detached: 0 };
  readonly ready: Promise<{ kind: string; intervals: number }>;
  closed = false;
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Receipt>();
  private sequence = 0;
  private readyTimer: ReturnType<typeof setTimeout>;

  constructor(source: string) {
    this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    let resolveReady!: (value: { kind: string; intervals: number }) => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.readyTimer = setTimeout(
      () => rejectReady(new Error('Native worker did not initialize')),
      30000,
    );
    const fail = (error: Error) => {
      clearTimeout(this.readyTimer);
      rejectReady(error);
      for (const receipt of this.pending.values()) {
        clearTimeout(receipt.timer);
        receipt.reject(error);
      }
      this.pending.clear();
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(`Native worker error: ${event.message}`));
    };
    this.worker.onmessageerror = () =>
      fail(new Error('Native worker message could not be decoded'));
    this.worker.onmessage = ({ data }) => {
      if (data.__engineNative === 'ready') {
        clearTimeout(this.readyTimer);
        resolveReady({ kind: data.kind, intervals: data.intervals });
      } else if (data.__engineNative) {
        const receipt = this.pending.get(data.id);
        if (!receipt) return;
        this.pending.delete(data.id);
        clearTimeout(receipt.timer);
        if (data.__engineNative === 'failure') receipt.reject(new Error(data.message));
        else receipt.resolve(data.snapshot);
      } else this.messages.push(data as Message);
    };
  }

  send(message: ClientMessage | ToOpenWorld, transfer: Transferable[] = []) {
    if (this.closed) throw new Error('Native fixture worker is closed');
    this.worker.postMessage(message, transfer);
    for (const buffer of transfer)
      if (buffer instanceof ArrayBuffer) {
        this.returned.buffers++;
        if (buffer.byteLength === 0) this.returned.detached++;
      }
  }

  private control(operation: 'barrier' | 'advance', steps = 0, milliseconds = 0) {
    if (this.closed) return Promise.reject(new Error('Native fixture worker is closed'));
    const id = ++this.sequence;
    return new Promise<NativeClockSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native worker ${operation} receipt timed out`));
      }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ __engineNative: true, id, operation, steps, milliseconds });
    });
  }
  barrier() {
    return this.control('barrier');
  }
  advance(steps: number, milliseconds = 100) {
    return this.control('advance', steps, milliseconds);
  }
  frames() {
    return this.messages.filter((message): message is Frame => message.type === 'frame');
  }
  surfaces() {
    return this.messages.filter((message): message is SurfaceMessage => message.type === 'surface');
  }
  counts() {
    return {
      frames: this.frames().length,
      telemetry: this.messages.filter((message) => message.type === 'telemetry').length,
      replay: this.messages.filter((message) => message.type === 'replayFrames').length,
      surfaces: this.surfaces().length,
    };
  }
  recycle(frame: Frame) {
    this.send({ type: 'recycle', buffer: frame.buffer }, [frame.buffer]);
  }
  get pendingCount() {
    return this.pending.size;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.readyTimer);
    for (const receipt of this.pending.values()) {
      clearTimeout(receipt.timer);
      receipt.reject(new Error('Native fixture worker terminated'));
    }
    this.pending.clear();
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

function frameInfo(frame: Frame | undefined) {
  if (!frame || !frame.buffer.byteLength) throw new Error('Expected an attached native frame');
  const values = new Float32Array(frame.buffer);
  return {
    bytes: frame.buffer.byteLength,
    tick: values[H.TICK],
    time: values[H.TIME],
    cars: values[H.CARS],
  };
}
function types(messages: Message[]) {
  return messages.map((message) => message.type);
}
function surfaceInfo(surface: SurfaceMessage | undefined) {
  if (!surface) throw new Error('Expected a native surface publication');
  return {
    epoch: surface.epoch,
    sequence: surface.sequence,
    time: surface.time,
    captureGap: !!surface.captureGap,
    lengths: [surface.water.length, surface.rubber.length, surface.marbles.length],
    finite: [surface.water, surface.rubber, surface.marbles].every((values) =>
      values.every(Number.isFinite),
    ),
  };
}

export async function circuitTransfers(source: string) {
  const h = new NativeEngineWorker(source);
  let report;
  try {
    const boot = await h.ready;
    const options = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0, seed: 36001 };
    h.send({ type: 'init', options });
    h.send({ type: 'pause', value: false, sequence: 1 });
    const stalledSnapshot = await h.advance(620);
    const stalled = h.counts();
    const heldSurfaces = h.surfaces();
    const first = frameInfo(h.frames()[0]);
    const telemetry = h.messages.find((message) => message.type === 'telemetry');
    const replay = h.messages.find((message) => message.type === 'replayFrames');
    if (!telemetry || telemetry.type !== 'telemetry' || !replay || replay.type !== 'replayFrames')
      throw new Error('Expected both native recording streams before recycling');
    const recordingRows = { telemetry: telemetry.rows, replay: replay.rows };
    h.recycle(h.frames()[0]);
    h.send({ type: 'recycleTelemetry', buffer: telemetry.buffer }, [telemetry.buffer]);
    h.send({ type: 'recycleReplay', buffer: replay.buffer }, [replay.buffer]);
    await h.advance(10);
    const recovered = h.counts();
    await h.advance(10);
    const restalled = h.counts();
    const beforePause = h.messages.length;
    h.send({ type: 'pause', value: true, sequence: 2 });
    await h.barrier();
    const pausedOrder = types(h.messages.slice(beforePause));
    const paused = frameInfo(h.frames().at(-1));
    const pauseReceipt = h.messages.find(
      (message) => message.type === 'pauseState' && message.sequence === 2,
    );
    const beforeCoalesce = h.messages.length;
    h.send({
      type: 'surfaceAck',
      epoch: heldSurfaces[0].epoch,
      sequence: heldSurfaces[0].sequence,
    });
    await h.barrier();
    const coalesced = {
      order: types(h.messages.slice(beforeCoalesce)),
      surface: surfaceInfo(h.surfaces().at(-1)),
    };

    // A new init must retain outstanding surface ownership from the old epoch.
    // Rewinding the short second session keeps this test's resimulation bounded.
    h.send({ type: 'init', options });
    h.send({ type: 'pause', value: false, sequence: 3 });
    await h.advance(10);
    const beforeRewind = h.counts();
    h.send({ type: 'flashback', tick: 60 });
    await h.advance(3);
    const blocked = {
      ...h.counts(),
      completions: h.messages.filter((message) => message.type === 'flashback').length,
    };
    const beforeAck = h.messages.length;
    h.send({
      type: 'surfaceAck',
      epoch: heldSurfaces[1].epoch,
      sequence: heldSurfaces[1].sequence,
    });
    await h.barrier();
    const completion = h.messages.slice(beforeAck);
    const rewoundSurface = h.surfaces().at(-1)!;
    const rewound = {
      order: types(completion),
      result: completion.find((message) => message.type === 'flashback'),
      surface: surfaceInfo(rewoundSurface),
      frame: frameInfo(h.frames().at(-1)),
    };
    h.send({ type: 'pause', value: false, sequence: 4 });
    await h.advance(5);
    const beforeDuplicate = h.surfaces().length;
    h.send({
      type: 'surfaceAck',
      epoch: heldSurfaces[1].epoch,
      sequence: heldSurfaces[1].sequence,
    });
    await h.barrier();
    const afterDuplicate = h.surfaces().length;
    h.send({
      type: 'surfaceAck',
      epoch: heldSurfaces[2].epoch,
      sequence: heldSurfaces[2].sequence,
    });
    const final = await h.barrier();
    report = {
      boot,
      first,
      recordingRows,
      stalled,
      recovered,
      restalled,
      stalledSnapshot,
      pausedOrder,
      paused,
      pauseReceipt,
      coalesced,
      beforeRewind,
      blocked,
      rewound,
      oldSurface: surfaceInfo(heldSurfaces[0]),
      beforeDuplicate,
      afterDuplicate,
      afterSecondAck: h.surfaces().length,
      latestSurface: surfaceInfo(h.surfaces().at(-1)),
      warnings: h.messages
        .filter((message) => message.type === 'recordingWarning')
        .map((message) => message.message),
      errors: h.messages.filter((message) => message.type === 'error'),
      returned: { ...h.returned },
      final,
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pendingControls: h.pendingCount };
}

export async function festivalTransfers(source: string) {
  const h = new NativeEngineWorker(source);
  let report;
  try {
    const boot = await h.ready;
    h.send({
      type: 'init',
      options: {
        vehicle: 'tc1',
        weather: 'clear',
        assist: 'sport',
        seed: 36002,
        traffic: false,
        discovered: [],
      },
    });
    await h.barrier();
    const initialOrder = types(h.messages);
    h.send({ type: 'pause', value: false });
    await h.advance(20, 20);
    const solo = h.frames();
    const soloFrames = solo.map(frameInfo);
    const beforeGrowth = h.messages.length;
    h.send({ type: 'command', command: { type: 'start', event: 'valley-sprint' }, requestId: 11 });
    await h.barrier();
    const growthOrder = types(h.messages.slice(beforeGrowth));
    await h.advance(10, 20);
    const race = h.frames().slice(solo.length);
    const raceFrames = race.map(frameInfo);
    h.recycle(solo[0]);
    await h.advance(10, 20);
    const afterOldReturn = h.frames().length;
    h.recycle(race[0]);
    await h.advance(10, 20);
    const afterCurrentReturn = h.frames().length;
    await h.advance(10, 20);
    const afterRestall = h.frames().length;
    h.send({ type: 'command', command: { type: 'cancel' }, requestId: 12 });
    await h.advance(5, 20);
    const beforeShrink = h.frames().length;
    const beforeContinue = h.messages.length;
    h.send({ type: 'command', command: { type: 'continue' }, requestId: 13 });
    await h.barrier();
    const shrinkOrder = types(h.messages.slice(beforeContinue));
    for (const frame of h.frames().slice(solo.length, beforeShrink))
      if (frame.buffer.byteLength) h.recycle(frame);
    await h.advance(20, 20);
    const shrunk = h.frames().slice(beforeShrink);
    const shrunkFrames = shrunk.map(frameInfo);
    const afterOldRaceReturns = h.frames().length;
    h.recycle(shrunk[0]);
    await h.advance(10, 20);
    const afterShrunkReturn = h.frames().length;
    await h.advance(10, 20);
    const afterShrunkRestall = h.frames().length;
    const beforePause = h.messages.length;
    h.send({ type: 'pause', value: true });
    await h.barrier();
    const pausedOrder = types(h.messages.slice(beforePause));
    const paused = frameInfo(h.frames().at(-1));
    const pausedCount = h.frames().length;
    await h.advance(10, 20);
    const afterPausedAdvance = h.frames().length;
    const final = await h.barrier();
    report = {
      boot,
      soloBytes: (HEADER + CAR_STRIDE) * 4,
      raceBytes: (HEADER + 4 * CAR_STRIDE) * 4,
      initialOrder,
      soloFrames,
      growthOrder,
      raceFrames,
      afterOldReturn,
      afterCurrentReturn,
      afterRestall,
      beforeShrink,
      shrinkOrder,
      shrunkFrames,
      afterOldRaceReturns,
      afterShrunkReturn,
      afterShrunkRestall,
      pausedOrder,
      paused,
      pausedCount,
      afterPausedAdvance,
      results: h.messages.filter((message) => message.type === 'result').length,
      receipts: h.messages.filter((message) => message.type === 'command-result'),
      errors: h.messages.filter((message) => message.type === 'error'),
      returned: { ...h.returned },
      final,
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pendingControls: h.pendingCount };
}
