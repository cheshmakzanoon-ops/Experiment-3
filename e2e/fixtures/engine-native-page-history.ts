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
import {
  PauseHandshake,
  type ClientMessage,
  type WorkerMessage,
} from '../../src/workers/diagnostics.ts';
import { LiveFrameClock } from '../../src/rendering/live-frame-clock.ts';
import { acquireGpuFrameGate } from '../../src/rendering/shared-gpu-frame-gate.ts';

interface Host {
  state: string;
  disposed: boolean;
  pageSuspended: boolean;
  pageEpoch: number;
  generation: number;
  timer: number | null;
  previousTime: number;
  renderedAt: number;
  demoClockAt: number;
  liveSkyChecked: number;
  current: Float32Array | null;
  previous: Float32Array | null;
  input: InputController;
  inputPump: InputPump;
  workerPause: PauseHandshake;
  install(): void;
  post(message: ClientMessage, transfer?: Transferable[]): void;
  pause(): void;
  resume(): void;
  scheduleFrame(): void;
  dispose(): void;
}

export interface WorkerInspection {
  instance: string;
  steps: number;
  tick: number;
  paused: boolean;
  inputMessages: number;
  positiveShifts: number;
  negativeShifts: number;
  lastInput: Controls | null;
  applied: { tick: number; throttle: number; shift: number }[];
}
interface Pending {
  resolve(value: WorkerInspection): void;
  reject(error: Error): void;
  timer: number;
}
interface FrameRequest {
  sequence: number;
  nativeId: number;
  epoch: number;
  generation: number;
  requestedAt: number;
  cancelled: boolean;
  delivered: boolean;
  frameCalls: number;
}
interface FrameObservation {
  kind: 'request' | 'cancel' | 'deliver' | 'frame' | 'return';
  request: FrameRequest | null;
  epoch: number;
  generation: number;
  observedAt: number;
  timestamp?: number;
}

const STORAGE_KEY = 'engine-native-page-history-last-hide';
let active: RetainedPage | null = null;

/** Native browser owners around complete current main.ts methods. The scene
 * and non-input UI/audio services are explicit small boundaries; this is not
 * the complete game or a frame-rate measurement. */
class RetainedPage {
  readonly instance = crypto.randomUUID();
  readonly host: Host;
  readonly worker: Worker;
  readonly canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  readonly gl: WebGL2RenderingContext;
  readonly errors: string[] = [];
  readonly events: ReturnType<RetainedPage['transition']>[] = [];
  readonly keys: { code: string; repeat: boolean; trusted: boolean; epoch: number }[] = [];
  readonly resumeClicks: { trusted: boolean; epoch: number }[] = [];
  readonly resumeCommands: { epoch: number; sequence: number | undefined }[] = [];
  readonly counters = {
    frames: 0,
    draws: 0,
    maxPendingFrames: 0,
    maxCallbacksAtOneTimestamp: 0,
    frameRequests: 0,
    cancelledFrameRequests: 0,
    liveFrameDeliveries: 0,
    cancelledFrameDeliveries: 0,
    duplicateFrameDeliveries: 0,
    untrackedFrameDeliveries: 0,
    pendingFrameIdCollisions: 0,
    maxFrameCallsPerRequest: 0,
    framesWithoutRequest: 0,
    startupFramesWithoutRequest: 0,
    staleOwnerFrames: 0,
    maxInputIntervals: 0,
    rendererResets: 0,
    rendererDisposals: 0,
    workerTerminations: 0,
    inputDisposals: 0,
    uiDisposals: 0,
    audioStops: 0,
    audioDisposals: 0,
    cueSuspensions: 0,
    cueDisposals: 0,
  };
  workerInstance = '';
  private readonly url: string;
  private readonly frames = new Map<number, FrameRequest>();
  private readonly frameEvents: FrameObservation[] = [];
  private readonly timestampRepeats: { previous: FrameObservation; current: FrameObservation }[] =
    [];
  private activeFrameRequest: FrameRequest | null = null;
  private lastFrameObservation: FrameObservation | null = null;
  private readonly intervals = new Set<number>();
  private readonly nativeInterval = window.setInterval;
  private readonly nativeClearInterval = window.clearInterval;
  private readonly pending = new Map<number, Pending>();
  private serial = 0;
  private lastFrameTimestamp = -1;
  private sameTimestampCallbacks = 0;
  private readonly started: Promise<void>;
  private ready!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly startupTimer: number;
  private closed = false;

  private readonly key = (event: KeyboardEvent) => {
    this.keys.push({
      code: event.code,
      repeat: event.repeat,
      trusted: event.isTrusted,
      epoch: this.host.pageEpoch,
    });
  };
  private readonly show = (event: PageTransitionEvent) => this.events.push(this.transition(event));
  private readonly hide = (event: PageTransitionEvent) => {
    const observation = this.transition(event);
    this.events.push(observation);
    // Synchronous same-origin observation survives a terminal reload. No
    // unload listener, network beacon or external observer prevents caching.
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(observation));
  };
  private readonly resume = (event: MouseEvent) => {
    this.resumeClicks.push({ trusted: event.isTrusted, epoch: this.host.pageEpoch });
    this.host.resume();
  };

  constructor(workerSource: string, hostSource: string) {
    const gl = this.canvas.getContext('webgl2', { alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Native page-history fixture requires WebGL2');
    this.gl = gl;
    const gate = acquireGpuFrameGate(gl);
    const frame = (callback: FrameRequestCallback) => {
      const request: FrameRequest = {
        sequence: ++this.counters.frameRequests,
        nativeId: 0,
        epoch: this.host.pageEpoch,
        generation: this.host.generation,
        requestedAt: performance.now(),
        cancelled: false,
        delivered: false,
        frameCalls: 0,
      };
      request.nativeId = window.requestAnimationFrame((time) => {
        const tracked = this.frames.get(request.nativeId) === request;
        if (request.delivered) this.counters.duplicateFrameDeliveries++;
        else if (request.cancelled) this.counters.cancelledFrameDeliveries++;
        else {
          this.counters.liveFrameDeliveries++;
          if (!tracked) this.counters.untrackedFrameDeliveries++;
        }
        if (tracked) this.frames.delete(request.nativeId);
        request.delivered = true;
        this.observeFrame('deliver', request, time);
        const outer = this.activeFrameRequest;
        this.activeFrameRequest = request;
        try {
          callback(time);
        } finally {
          this.observeFrame('return', request, time);
          this.activeFrameRequest = outer;
        }
      });
      if (this.frames.has(request.nativeId)) this.counters.pendingFrameIdCollisions++;
      this.frames.set(request.nativeId, request);
      this.observeFrame('request', request);
      this.counters.maxPendingFrames = Math.max(this.counters.maxPendingFrames, this.frames.size);
      return request.nativeId;
    };
    const cancelFrame = (id: number) => {
      const request = this.frames.get(id);
      if (request) {
        request.cancelled = true;
        this.counters.cancelledFrameRequests++;
        this.observeFrame('cancel', request);
      }
      this.frames.delete(id);
      window.cancelAnimationFrame(id);
    };
    // Observe real timer handles without changing their callback, delay, clock
    // or dispatch. This document has only the production InputPump interval.
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = Reflect.apply(this.nativeInterval, window, [handler, delay, ...args]) as number;
      this.intervals.add(id);
      this.counters.maxInputIntervals = Math.max(
        this.counters.maxInputIntervals,
        this.intervals.size,
      );
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id: number | undefined) => {
      if (id !== undefined) this.intervals.delete(id);
      this.nativeClearInterval.call(window, id);
    }) as typeof window.clearInterval;

    this.started = new Promise((resolve, reject) => {
      this.ready = resolve;
      this.rejectReady = reject;
    });
    this.startupTimer = window.setTimeout(
      () => this.fail('History physics worker did not start'),
      30000,
    );
    this.url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    const terminate = this.worker.terminate.bind(this.worker);
    this.worker.terminate = () => {
      this.counters.workerTerminations++;
      terminate();
    };
    const send = this.worker.postMessage.bind(this.worker);
    this.worker.postMessage = ((message: ClientMessage, transfer: Transferable[] = []) => {
      if (message.type === 'pause' && !message.value)
        this.resumeCommands.push({ epoch: this.host.pageEpoch, sequence: message.sequence });
      send(message, transfer);
    }) as typeof this.worker.postMessage;
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(event.message);
    };
    this.worker.onmessageerror = () => this.fail('Native history worker message decoding failed');
    this.worker.onmessage = ({ data }) => this.receive(data);

    const HostClass = new Function(
      'InputPump',
      'PauseHandshake',
      'controls',
      'H',
      'racingSession',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      `${hostSource}; return Host;`,
    )(InputPump, PauseHandshake, controls, H, racingSession, frame, cancelFrame) as new () => Host;
    const nothing = () => {};
    const disposable = () => ({ dispose: nothing });
    const host = Object.assign(new HostClass(), {
      state: 'paused',
      worker: this.worker,
      festival: null,
      festivalStarting: false,
      festivalOwner: { cancel: nothing },
      replay: null,
      options: { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 },
      ers: 1,
      drsPress: false,
      overtakePress: false,
      liveFrames: new LiveFrameClock(),
      referenceSession: { interrupt: nothing, dispose: nothing },
      performanceCapture: { interrupt: nothing },
      sessionReview: { stop: nothing },
      tabEvidence: disposable(),
      reviewVideo: disposable(),
      exporter: { cancel: nothing },
      mediaView: null,
      reviewKeyboard: nothing,
      interruptReview: nothing,
      observeSession: nothing,
      endDemoClock: nothing,
      rumble: { stop: nothing },
      menuFrames: { suspend: nothing, dispose: nothing },
      menuPreviewReceipt: { request: nothing, dispose: nothing },
      audio: {
        stop: () => this.counters.audioStops++,
        dispose: async () => {
          this.counters.audioDisposals++;
        },
      },
      uiSounds: {
        suspend: () => this.counters.cueSuspensions++,
        dispose: () => this.counters.cueDisposals++,
      },
      renderer: {
        circuit: { offroad: null },
        reset: () => this.counters.rendererResets++,
        dispose: () => {
          this.counters.rendererDisposals++;
          gate.dispose();
        },
      },
      ui: {
        modal: { open: false },
        telemetryModal: { open: false },
        showMode: (mode: string) => {
          document.body.dataset.mode = mode;
        },
        pause: nothing,
        closeModal: nothing,
        dispose: () => this.counters.uiDisposals++,
      },
      frame: (time: number) => {
        this.counters.frames++;
        const request = this.activeFrameRequest;
        if (request) {
          request.frameCalls++;
          this.counters.maxFrameCallsPerRequest = Math.max(
            this.counters.maxFrameCallsPerRequest,
            request.frameCalls,
          );
          if (
            request.cancelled ||
            request.epoch !== host.pageEpoch ||
            request.generation !== host.generation ||
            host.disposed ||
            host.pageSuspended
          )
            this.counters.staleOwnerFrames++;
        } else {
          // Count direct startup calls separately; neither startup nor later
          // unscheduled calls are excluded from the ownership assertions.
          this.counters.framesWithoutRequest++;
          if (this.counters.frameRequests === 0) this.counters.startupFramesWithoutRequest++;
        }
        const observation = this.observeFrame('frame', request, time);
        this.sameTimestampCallbacks =
          this.lastFrameTimestamp === time ? this.sameTimestampCallbacks + 1 : 1;
        if (
          this.sameTimestampCallbacks > 1 &&
          this.lastFrameObservation &&
          this.timestampRepeats.length < 8
        )
          this.timestampRepeats.push({ previous: this.lastFrameObservation, current: observation });
        this.lastFrameObservation = observation;
        this.lastFrameTimestamp = time;
        this.counters.maxCallbacksAtOneTimestamp = Math.max(
          this.counters.maxCallbacksAtOneTimestamp,
          this.sameTimestampCallbacks,
        );
        host.previousTime = time;
        if (gate.ready()) {
          gl.viewport(0, 0, this.canvas.width, this.canvas.height);
          gl.clearColor(host.state === 'driving' ? 1 : 0, host.state === 'paused' ? 1 : 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gate.submittedFrame();
          this.counters.draws++;
        }
        host.scheduleFrame();
      },
    });
    host.input = new InputController(structuredClone(DEFAULT_SETTINGS), (name) => {
      if (name === 'blur') host.pause();
      else if (name === 'pause') {
        if (host.state === 'driving') host.pause();
        else host.resume();
      }
    });
    const disposeInput = host.input.dispose.bind(host.input);
    host.input.dispose = () => {
      this.counters.inputDisposals++;
      disposeInput();
    };
    this.host = host;
    host.install();
    host.inputPump.start();
    host.scheduleFrame();
    // These observers run after the actual production callbacks, recording
    // their settled synchronous ownership state and the native event trust.
    window.addEventListener('pagehide', this.hide);
    window.addEventListener('pageshow', this.show);
    window.addEventListener('keydown', this.key);
    document.querySelector('#resume')!.addEventListener('click', this.resume as EventListener);
  }

  private observeFrame(
    kind: FrameObservation['kind'],
    request: FrameRequest | null,
    timestamp?: number,
  ): FrameObservation {
    const observation = {
      kind,
      request: request ? { ...request } : null,
      epoch: this.host.pageEpoch,
      generation: this.host.generation,
      observedAt: performance.now(),
      timestamp,
    };
    this.frameEvents.push(observation);
    if (this.frameEvents.length > 96) this.frameEvents.shift();
    return observation;
  }
  private frameOwnership() {
    return {
      accountingBalance:
        this.counters.frameRequests -
        this.counters.cancelledFrameRequests -
        this.counters.liveFrameDeliveries -
        this.frames.size,
      currentHandle: this.host.timer,
      pending: Array.from(this.frames.values(), (request) => ({ ...request })),
    };
  }
  private fail(message: string) {
    this.errors.push(message);
    clearTimeout(this.startupTimer);
    this.rejectReady(new Error(message));
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
  private receive(data: WorkerMessage | { __pageHistory: string; id?: number; instance: string }) {
    if ('__pageHistory' in data) {
      if (data.__pageHistory === 'ready') {
        this.workerInstance = data.instance;
        this.host.post({
          type: 'init',
          options: { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 },
        });
      } else if (data.__pageHistory === 'inspection') {
        const request = this.pending.get(data.id!);
        if (!request) return;
        this.pending.delete(data.id!);
        clearTimeout(request.timer);
        request.resolve(data as unknown as WorkerInspection);
      }
      return;
    }
    if (data.type === 'error') this.fail(data.message);
    else if (data.type === 'frame') {
      this.host.previous = this.host.current;
      this.host.current = new Float32Array(data.buffer).slice();
      this.worker.postMessage({ type: 'recycle', buffer: data.buffer }, [data.buffer]);
      clearTimeout(this.startupTimer);
      this.ready();
    } else if (data.type === 'pauseState')
      this.host.workerPause.accept(data, this.host.current?.[H.TICK]);
    else if (data.type === 'surface')
      this.worker.postMessage({ type: 'surfaceAck', epoch: data.epoch, sequence: data.sequence });
    else if (data.type === 'telemetry')
      this.worker.postMessage({ type: 'recycleTelemetry', buffer: data.buffer }, [data.buffer]);
    else if (data.type === 'replayFrames')
      this.worker.postMessage({ type: 'recycleReplay', buffer: data.buffer }, [data.buffer]);
  }
  private transition(event: PageTransitionEvent) {
    return {
      kind: event.type,
      persisted: event.persisted,
      trusted: event.isTrusted,
      instance: this.instance,
      workerInstance: this.workerInstance,
      state: this.host.state,
      disposed: this.host.disposed,
      suspended: this.host.pageSuspended,
      epoch: this.host.pageEpoch,
      generation: this.host.generation,
      pendingFrames: this.frames.size,
      inputIntervals: this.intervals.size,
      input: { ...this.host.input.state },
      clocks: {
        previousTime: this.host.previousTime,
        renderedAt: this.host.renderedAt,
        demoClockAt: this.host.demoClockAt,
        liveSkyChecked: this.host.liveSkyChecked,
      },
      counters: { ...this.counters },
      raf: this.frameOwnership(),
    };
  }
  async start() {
    await this.started;
    return this.snapshot();
  }
  inspectWorker() {
    if (this.host.disposed) return Promise.reject(new Error('History owner is disposed'));
    return new Promise<WorkerInspection>((resolve, reject) => {
      const id = ++this.serial;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Native history worker inspection timed out'));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ __pageHistory: 'inspect', id });
    });
  }
  snapshot() {
    const debug = this.gl.getExtension('WEBGL_debug_renderer_info');
    const pixels = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    const navigation = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming & { notRestoredReasons?: unknown };
    return {
      instance: this.instance,
      workerInstance: this.workerInstance,
      state: this.host.state,
      disposed: this.host.disposed,
      suspended: this.host.pageSuspended,
      epoch: this.host.pageEpoch,
      generation: this.host.generation,
      pendingFrames: this.frames.size,
      inputIntervals: this.intervals.size,
      inputPolls: this.host.inputPump.ticks,
      input: { ...this.host.input.state },
      pause: this.host.workerPause.status(),
      counters: { ...this.counters },
      raf: {
        ...this.frameOwnership(),
        events: this.frameEvents.slice(),
        timestampRepeats: this.timestampRepeats.slice(),
      },
      events: this.events.slice(),
      keys: this.keys.slice(),
      resumeClicks: this.resumeClicks.slice(),
      resumeCommands: this.resumeCommands.slice(),
      backend: String(this.gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? this.gl.RENDERER)),
      pixels: Array.from(pixels),
      contextLost: this.gl.isContextLost(),
      glError: this.gl.getError(),
      navigationType: navigation?.type,
      notRestoredReasons: JSON.parse(
        JSON.stringify(navigation?.notRestoredReasons ?? null),
      ) as unknown,
      priorHide: JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as unknown,
      errors: this.errors.slice(),
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.host.dispose();
    clearTimeout(this.startupTimer);
    window.removeEventListener('pagehide', this.hide);
    window.removeEventListener('pageshow', this.show);
    window.removeEventListener('keydown', this.key);
    document.querySelector('#resume')?.removeEventListener('click', this.resume as EventListener);
    window.setInterval = this.nativeInterval;
    window.clearInterval = this.nativeClearInterval;
    URL.revokeObjectURL(this.url);
  }
}

export async function open(workerSource: string, hostSource: string) {
  if (active) throw new Error('Duplicate native history fixture owner');
  active = new RetainedPage(workerSource, hostSource);
  return active.start();
}
export const snapshot = () => active!.snapshot();
export const inspectWorker = () => active!.inspectWorker();
export function close() {
  active?.close();
}
