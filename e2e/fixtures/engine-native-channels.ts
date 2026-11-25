import { DEFAULT_OPTIONS, controls } from '../../src/simulation/config.ts';
import {
  isEngineeringSample,
  type ClientMessage,
  type EngineeringMessage,
  type WorkerMessage,
} from '../../src/workers/diagnostics.ts';
import type { FromOpenWorld, ToOpenWorld } from '../../src/workers/open-world-protocol.ts';
import type { NativeClockSnapshot } from './engine-worker-clock.ts';

export interface ChannelInspection {
  kind: 'circuit' | 'festival';
  now: number;
  tick: number | null;
  steps: number;
  probes: number;
  statuses: number;
  commands: number;
  playerToken: number;
  throttle: number | null;
  shift: number | null;
}
type Packet = WorkerMessage | FromOpenWorld;
type Status = Extract<FromOpenWorld, { type: 'status' }>;
type Receipt = {
  resolve(value: NativeClockSnapshot | ChannelInspection): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Native messages and structured cloning are never replaced. Test receipts
 * are FIFO barriers after all preceding production worker handlers. */
class ChannelWorker {
  readonly messages: Packet[] = [];
  readonly nativeErrors: string[] = [];
  readonly ready: Promise<{ kind: string; intervals: number }>;
  closed = false;
  private readonly worker: Worker;
  private readonly url: string;
  private readonly pending = new Map<number, Receipt>();
  private serial = 0;
  private readonly readyTimer: ReturnType<typeof setTimeout>;

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
      () => rejectReady(new Error('Native channel boot timed out')),
      30000,
    );
    const fail = (error: Error) => {
      this.nativeErrors.push(error.message);
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
      fail(new Error(event.message));
    };
    this.worker.onmessageerror = () => fail(new Error('Native channel message decoding failed'));
    this.worker.onmessage = ({ data }) => {
      if (data.__engineNative === 'ready') {
        clearTimeout(this.readyTimer);
        resolveReady({ kind: data.kind, intervals: data.intervals });
      } else if (data.__engineNative || data.__engineChannels) {
        const receipt = this.pending.get(data.id);
        if (!receipt) return;
        clearTimeout(receipt.timer);
        this.pending.delete(data.id);
        if (data.__engineNative === 'failure') receipt.reject(new Error(data.message));
        else receipt.resolve(data.inspection ?? data.snapshot);
      } else this.messages.push(data as Packet);
    };
  }
  send(message: ClientMessage | ToOpenWorld) {
    if (this.closed) throw new Error('Native channel worker closed');
    this.worker.postMessage(message);
  }
  private request(fields: Record<string, unknown>) {
    const id = ++this.serial;
    return new Promise<NativeClockSnapshot | ChannelInspection>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Native channel receipt timed out'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...fields, id });
    });
  }
  barrier() {
    return this.request({
      __engineNative: true,
      operation: 'barrier',
    }) as Promise<NativeClockSnapshot>;
  }
  advance(steps: number, milliseconds = 100) {
    return this.request({
      __engineNative: true,
      operation: 'advance',
      steps,
      milliseconds,
    }) as Promise<NativeClockSnapshot>;
  }
  inspect(operation: 'inspect' | 'failNext' | 'jump' = 'inspect', milliseconds = 0) {
    return this.request({
      __engineChannels: true,
      operation,
      milliseconds,
    }) as Promise<ChannelInspection>;
  }
  engineering() {
    return this.messages.filter(
      (message): message is EngineeringMessage => message.type === 'engineering',
    );
  }
  statuses() {
    return this.messages.filter((message): message is Status => message.type === 'status');
  }
  frames() {
    return this.messages.filter((message) => message.type === 'frame');
  }
  errors() {
    return this.messages.filter((message) => message.type === 'error');
  }
  ackEngineering(message: EngineeringMessage) {
    this.send({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
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
      receipt.reject(new Error('Native channel worker terminated'));
    }
    this.pending.clear();
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

const circuitOptions = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0, seed: 72020 };
const festivalOptions = {
  vehicle: 'tc1',
  weather: 'clear' as const,
  assist: 'sport' as const,
  seed: 63033,
  traffic: false,
  discovered: [],
};

export async function engineeringCredits(source: string) {
  const h = new ChannelWorker(source);
  let report;
  try {
    const boot = await h.ready;
    h.send({ type: 'init', options: circuitOptions });
    h.send({ type: 'engineering', enabled: true });
    await h.barrier();
    const first = h.engineering()[0];
    if (!first) throw new Error('No initial native engineering sample');
    const firstJSON = JSON.stringify(first);
    h.send({ type: 'pause', value: false });
    const transfers = await h.advance(30);
    const stalled = { ...(await h.inspect()), packets: h.engineering().length };
    h.ackEngineering(first);
    await h.barrier();
    const second = h.engineering()[1];
    if (!second) throw new Error('No native engineering sample after credit');
    h.ackEngineering(first);
    h.send({ type: 'engineeringAck', epoch: second.epoch + 1, sequence: second.sequence });
    h.send({ type: 'engineeringAck', epoch: second.epoch, sequence: NaN });
    await h.advance(10);
    const forged = { ...(await h.inspect()), packets: h.engineering().length };
    h.ackEngineering(second);
    await h.barrier();
    const third = h.engineering()[2];
    if (!third) throw new Error('No third native engineering sample');
    h.send({ type: 'init', options: circuitOptions });
    for (let i = 0; i < 20; i++) {
      h.send({ type: 'engineering', enabled: false });
      h.send({ type: 'engineering', enabled: true });
    }
    h.send({ type: 'pause', value: false });
    await h.advance(1);
    const resetHeld = { ...(await h.inspect()), packets: h.engineering().length };
    h.ackEngineering(third);
    await h.barrier();
    const afterReset = h.engineering()[3];
    if (!afterReset) throw new Error('No native engineering sample after retained receipt');
    report = {
      boot,
      stalled,
      forged,
      resetHeld,
      ticks: h.engineering().map((message) => message.sample.tick),
      epochs: h.engineering().map((message) => message.epoch),
      sequences: h.engineering().map((message) => message.sequence),
      immutable: JSON.stringify(first) === firstJSON,
      allValid: h.engineering().every((message) => isEngineeringSample(message.sample)),
      final: await h.inspect(),
      transfers,
      errors: h.errors(),
      nativeErrors: h.nativeErrors,
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}

export async function motocrossDiagnostics(source: string) {
  const h = new ChannelWorker(source);
  let report;
  try {
    await h.ready;
    h.send({
      type: 'init',
      options: { ...circuitOptions, circuit: 'valley-ridge-mx' as const, vehicles: ['mx450'] },
    });
    h.send({ type: 'engineering', enabled: true });
    await h.barrier();
    const first = h.engineering()[0];
    if (!first) throw new Error('No native motocross diagnostics at initialization');
    h.send({ type: 'pause', value: false });
    await h.advance(1);
    h.ackEngineering(first);
    await h.barrier();
    report = {
      samples: h.engineering().map(({ sample }) => ({
        tick: sample.tick,
        surfaces: sample.wheels.map((wheel) => wheel.surface),
        valid: isEngineeringSample(sample),
      })),
      state: await h.inspect(),
      errors: h.errors(),
      nativeErrors: h.nativeErrors,
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}

export async function festivalCredits(source: string) {
  const h = new ChannelWorker(source);
  let report;
  try {
    const boot = await h.ready;
    h.send({ type: 'init', options: festivalOptions });
    await h.barrier();
    const first = h.statuses()[0];
    if (!first) throw new Error('No initial native Festival status');
    const firstJSON = JSON.stringify(first);
    h.send({ type: 'pause', value: false });
    await h.advance(100);
    const full = {
      ...(await h.inspect()),
      packets: h.statuses().length,
      frames: h.frames().length,
    };
    for (let i = 0; i < 200; i++) h.send({ type: 'pause', value: true });
    h.send({ type: 'command', command: { type: 'reset' }, requestId: 71 });
    h.send({ type: 'init', options: festivalOptions });
    await h.barrier();
    const overloaded = {
      ...(await h.inspect()),
      packets: h.statuses().length,
      frames: h.frames().length,
    };
    h.send({ type: 'pause', value: false });
    for (const sequence of [0, -1, NaN, 1000000]) h.send({ type: 'statusAck', sequence });
    await h.advance(10);
    const forged = await h.inspect();
    await h.inspect('jump', 10000);
    h.send({ type: 'statusAck', sequence: first.sequence });
    await h.advance(1);
    const resumed = { ...(await h.inspect()), packets: h.statuses().length };
    h.send({ type: 'statusAck', sequence: first.sequence });
    await h.advance(1);
    const duplicate = { ...(await h.inspect()), packets: h.statuses().length };
    h.send({ type: 'statusAck', sequence: h.statuses()[1].sequence });
    h.send({ type: 'init', options: festivalOptions });
    await h.barrier();
    const reset = { ...(await h.inspect()), packets: h.statuses().length };
    h.send({ type: 'statusAck', sequence: h.statuses()[1].sequence });
    h.send({ type: 'command', command: { type: 'traffic', value: true }, requestId: 72 });
    await h.barrier();
    const commandBlocked = await h.inspect();
    h.send({ type: 'statusAck', sequence: h.statuses()[2].sequence });
    const beforeCommand = h.messages.length;
    h.send({ type: 'command', command: { type: 'traffic', value: true }, requestId: 73 });
    await h.barrier();
    const commandOrder = h.messages.slice(beforeCommand).map((message) => message.type);
    const latest = h.statuses().at(-1)!;
    for (const message of h.statuses()) h.send({ type: 'statusAck', sequence: message.sequence });
    await h.barrier();
    const beforeNormal = { ...(await h.inspect()), packets: h.statuses().length };
    h.send({ type: 'pause', value: false });
    let acknowledged = h.statuses().length;
    for (let i = 0; i < 5; i++) {
      await h.advance(20);
      for (const message of h.statuses().slice(acknowledged))
        h.send({ type: 'statusAck', sequence: message.sequence });
      acknowledged = h.statuses().length;
      await h.barrier();
    }
    const normal = { ...(await h.inspect()), packets: h.statuses().length };
    report = {
      boot,
      full,
      overloaded,
      forged,
      resumed,
      duplicate,
      reset,
      commandBlocked,
      commandOrder,
      traffic: latest.status.traffic.enabled,
      receipts: h.messages.filter((message) => message.type === 'command-result'),
      normalTicks: normal.tick! - beforeNormal.tick!,
      normalPackets: normal.packets - beforeNormal.packets,
      normalStatusCalls: normal.statuses - beforeNormal.statuses,
      immutable: JSON.stringify(first) === firstJSON,
      sequences: h.statuses().map((message) => message.sequence),
      errors: h.errors(),
      nativeErrors: h.nativeErrors,
      transfers: await h.barrier(),
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}

export async function circuitTerminal(source: string) {
  const h = new ChannelWorker(source);
  let report;
  try {
    await h.ready;
    h.send({ type: 'init', options: circuitOptions });
    h.send({ type: 'engineering', enabled: true });
    h.send({ type: 'pause', value: false });
    await h.inspect('failNext');
    await h.advance(1);
    const failed = await h.inspect();
    const held = h.engineering()[0];
    if (!held) throw new Error('Expected diagnostics credit before native failure');
    h.send({ type: 'pause', value: false });
    h.send({ type: 'input', input: { ...controls(), throttle: 1, shift: 1 } });
    h.send({ type: 'autopilot', value: true });
    h.send({ type: 'flashback', tick: 0 });
    h.ackEngineering(held);
    await h.advance(10);
    const suppressed = { ...(await h.inspect()), packets: h.engineering().length };
    h.send({ type: 'init', options: circuitOptions });
    h.send({ type: 'engineering', enabled: true });
    await h.advance(1);
    const reset = { ...(await h.inspect()), packets: h.engineering().length };
    h.send({ type: 'pause', value: false });
    await h.advance(1);
    const recovered = await h.inspect();
    report = {
      failed,
      suppressed,
      reset,
      recovered,
      errors: h.errors(),
      nativeErrors: h.nativeErrors,
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}

export async function festivalTerminal(source: string) {
  const h = new ChannelWorker(source);
  let report;
  try {
    await h.ready;
    h.send({ type: 'init', options: festivalOptions });
    await h.barrier();
    const before = await h.inspect();
    h.send({
      type: 'command',
      command: { type: 'start', event: 'missing-native-event' },
      requestId: 40,
    });
    await h.barrier();
    const validation = h.messages.filter((message) => message.type === 'command-result');
    await h.inspect('failNext');
    h.send({ type: 'command', command: { type: 'reset' }, requestId: 41 });
    await h.barrier();
    const failed = await h.inspect();
    h.send({ type: 'pause', value: false });
    h.send({ type: 'input', input: { ...controls(), throttle: 1, shift: 1 } });
    h.send({ type: 'command', command: { type: 'traffic', value: true }, requestId: 42 });
    h.send({ type: 'command', command: { type: 'reset' }, requestId: 43 });
    h.send({ type: 'statusAck', sequence: h.statuses()[0].sequence });
    await h.advance(10);
    const suppressed = await h.inspect();
    h.send({ type: 'init', options: festivalOptions });
    await h.advance(1);
    const reset = await h.inspect();
    h.send({ type: 'pause', value: false });
    await h.advance(1);
    const recovered = await h.inspect();
    report = {
      before,
      validation,
      failed,
      suppressed,
      reset,
      recovered,
      receipts: h.messages.filter((message) => message.type === 'command-result'),
      errors: h.errors(),
      nativeErrors: h.nativeErrors,
      sequences: h.statuses().map((message) => message.sequence),
    };
  } finally {
    h.close();
  }
  return { ...report, closed: h.closed, pending: h.pendingCount };
}
