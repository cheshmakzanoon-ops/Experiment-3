import { InputController } from '../../src/input/controller.ts';
import { InputPump } from '../../src/input/pump.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  racingSession,
  type Controls,
} from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import type { ClientMessage, WorkerMessage } from '../../src/workers/diagnostics.ts';
import type { AppliedNativeInput } from './engine-native-input.worker.ts';
import type { NativeClockSnapshot } from './engine-worker-clock.ts';

interface Host {
  state: string;
  input: InputController;
  inputPump: InputPump;
  install(): void;
  pause(): void;
  resume(): void;
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
interface NativeKey {
  type: string;
  code: string;
  repeat: boolean;
  trusted: boolean;
  prevented: boolean;
}

let active: NativeInputSession | null = null;

class NativeInputSession {
  readonly worker: Worker;
  readonly host: Host;
  readonly sent: Controls[] = [];
  readonly actions: string[] = [];
  readonly keys: NativeKey[] = [];
  readonly blurTrust: boolean[] = [];
  readonly errors: string[] = [];
  private readonly url: string;
  private readonly pending = new Map<number, Pending>();
  private serial = 0;
  private closed = false;
  private readonly started: Promise<void>;
  private ready!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly readyTimer: ReturnType<typeof setTimeout>;
  private readonly keyObserver = (event: KeyboardEvent) => {
    this.keys.push({
      type: event.type,
      code: event.code,
      repeat: event.repeat,
      trusted: event.isTrusted,
      prevented: event.defaultPrevented,
    });
  };
  private readonly blurObserver = (event: Event) => this.blurTrust.push(event.isTrusted);

  constructor(source: string, hostSource: string) {
    this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    this.started = new Promise((resolve, reject) => {
      this.ready = resolve;
      this.rejectReady = reject;
    });
    this.readyTimer = setTimeout(
      () => this.fail(new Error('Native input worker did not start')),
      30000,
    );
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error(event.message));
    };
    this.worker.onmessageerror = () =>
      this.fail(new Error('Native input message could not be decoded'));
    this.worker.onmessage = ({ data }) => {
      if (data.__engineNative === 'ready') {
        clearTimeout(this.readyTimer);
        this.ready();
        return;
      }
      if (data.__engineNative || data.__nativeInput) {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id);
        clearTimeout(pending.timer);
        if (data.__engineNative === 'failure') pending.reject(new Error(data.message));
        else pending.resolve(data.__nativeInput ? data.applied : data.snapshot);
        return;
      }
      const message = data as WorkerMessage;
      if (message.type === 'error') this.errors.push(message.message);
      else if (message.type === 'frame')
        this.worker.postMessage({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
      else if (message.type === 'surface')
        this.worker.postMessage({
          type: 'surfaceAck',
          epoch: message.epoch,
          sequence: message.sequence,
        });
      else if (message.type === 'telemetry')
        this.worker.postMessage({ type: 'recycleTelemetry', buffer: message.buffer }, [
          message.buffer,
        ]);
      else if (message.type === 'replayFrames')
        this.worker.postMessage({ type: 'recycleReplay', buffer: message.buffer }, [
          message.buffer,
        ]);
    };

    // These complete methods and the pump assignment come from current main.ts.
    // Renderer/audio/UI boundaries are irrelevant to the input ownership under
    // test; browser event dispatch and worker delivery remain native.
    const HostClass = new Function(
      'InputPump',
      'controls',
      'H',
      'racingSession',
      `${hostSource}; return Host;`,
    )(InputPump, controls, H, racingSession) as new () => Host;
    const host = Object.assign(new HostClass(), {
      state: 'driving',
      errorStopped: false,
      savingSettings: false,
      festival: null,
      current: null,
      renderer: null,
      ers: 1,
      drsPress: false,
      overtakePress: false,
      options: { ...DEFAULT_OPTIONS, mode: 'practice' },
      rumble: { stop() {} },
      audio: { stop() {} },
      referenceSession: { interrupt() {} },
      performanceCapture: { interrupt() {} },
      interruptReview() {},
      observeSession() {},
      ui: {
        modal: { open: false },
        telemetryModal: { open: false },
        showMode() {},
        pause() {},
        closeModal() {},
      },
      post: (message: ClientMessage) => {
        if (message.type === 'input') this.sent.push(structuredClone(message.input));
        this.worker.postMessage(message);
      },
    });
    host.input = new InputController(structuredClone(DEFAULT_SETTINGS), (name) => {
      this.actions.push(name);
      if (name === 'blur') host.pause();
    });
    this.host = host;
    host.input.setEnabled(true);
    host.install();
    // Keep a real interval handle, but lengthen only this test's timer. Polling
    // boundaries are explicit so multiple trusted key events precede sampling.
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = ((callback: TimerHandler, _delay?: number, ...args: unknown[]) =>
      nativeInterval(callback, 3600000, ...args)) as typeof window.setInterval;
    try {
      host.inputPump.start();
    } finally {
      window.setInterval = nativeInterval;
    }
    window.addEventListener('keydown', this.keyObserver);
    window.addEventListener('keyup', this.keyObserver);
    window.addEventListener('blur', this.blurObserver);
  }

  private fail(error: Error) {
    clearTimeout(this.readyTimer);
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  private request(message: object): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Native input fixture is closed'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Native input receipt timed out'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id });
    });
  }
  barrier() {
    return this.request({
      __engineNative: true,
      operation: 'barrier',
    }) as Promise<NativeClockSnapshot>;
  }
  async init() {
    await this.started;
    this.worker.postMessage({
      type: 'init',
      options: { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, seed: 72032 },
    } satisfies ClientMessage);
    this.worker.postMessage({ type: 'pause', value: false } satisfies ClientMessage);
    await this.barrier();
    return {
      bindings: { ...this.host.input.settings.bindings },
      automaticSamples: this.host.inputPump.ticks,
    };
  }
  async poll(count: number) {
    for (let i = 0; i < count; i++) this.host.inputPump.poll();
    await this.barrier();
    return this.snapshot();
  }
  async advance(ticks: number) {
    await this.request({
      __engineNative: true,
      operation: 'advance',
      steps: ticks,
      milliseconds: 1000 / 120,
    });
    return this.request({ __nativeInput: 'inspect' }) as Promise<AppliedNativeInput[]>;
  }
  snapshot() {
    return {
      state: this.host.state,
      staged: { ...this.host.input.state },
      samples: this.host.inputPump.ticks,
      sent: structuredClone(this.sent),
      actions: [...this.actions],
      keys: [...this.keys],
      blurTrust: [...this.blurTrust],
      errors: [...this.errors],
      closed: this.closed,
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.host.inputPump.dispose();
    this.host.input.dispose();
    window.removeEventListener('keydown', this.keyObserver);
    window.removeEventListener('keyup', this.keyObserver);
    window.removeEventListener('blur', this.blurObserver);
    this.fail(new Error('Native input fixture closed'));
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

export async function open(source: string, hostSource: string) {
  active?.close();
  active = new NativeInputSession(source, hostSource);
  return active.init();
}
export function snapshot() {
  if (!active) throw new Error('Input fixture is not open');
  return active.snapshot();
}
export function poll(count: number) {
  if (!active) throw new Error('Input fixture is not open');
  return active.poll(count);
}
export function advance(ticks: number) {
  if (!active) throw new Error('Input fixture is not open');
  return active.advance(ticks);
}
export async function resume() {
  if (!active) throw new Error('Input fixture is not open');
  active.host.resume();
  await active.barrier();
  return active.snapshot();
}
export function close() {
  active?.close();
  return active?.snapshot();
}
