import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerReadiness } from '../src/session/worker-readiness.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { CAR_STRIDE, HEADER, H } from '../src/simulation/protocol.ts';
import {
  PauseHandshake,
  type ClientMessage,
  type WorkerMessage,
} from '../src/workers/diagnostics.ts';

/** Execute complete production methods, without main.ts's automatic DOM boot.
 * Only the lazy worker import is replaced with an injectable module boundary;
 * no startup branch, readiness settlement or terminal cleanup is copied. */
function hostCode() {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  );
  const names = [
    'disposed',
    'pageWaiters',
    'errorStopped',
    'generation',
    'circuitStartup',
    'initTimeout',
    'worker',
    'workerPause',
    'current',
    'previous',
    'start',
    'post',
    'accept',
    'prepareTimeTrial',
    'fail',
    'dispose',
  ];
  const members = names.map((name) => {
    const member = owner?.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`GameApp.${name} must exist for the integration check`);
    return member.getText(source);
  });
  let imports = 0;
  const result = ts.transpileModule(`class Host { ${members.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: {
      before: [
        (context) => {
          const visit: ts.Visitor = (node) => {
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
              const path = node.arguments[0];
              if (
                !ts.isStringLiteral(path) ||
                path.text !== './workers/physics.worker.ts?worker&inline'
              )
                throw new Error('Unexpected startup import');
              imports++;
              return ts.factory.createCallExpression(
                ts.factory.createIdentifier('loadPhysicsWorker'),
                undefined,
                [],
              );
            }
            return ts.visitEachChild(node, visit, context);
          };
          return (node) => ts.visitNode(node, visit) as ts.SourceFile;
        },
      ],
    },
  });
  if (imports !== 1) throw new Error('Expected the production worker import boundary');
  return result.outputText;
}

const code = hostCode();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Observe each outer promise immediately, just as the application's callers
 * attach their error handler. A stranded start remains visibly pending. */
function observe(work: Promise<void>) {
  const result: { status: 'pending' | 'fulfilled' | 'rejected'; error?: unknown } = {
    status: 'pending',
  };
  const done = work.then(
    () => {
      result.status = 'fulfilled';
    },
    (error: unknown) => {
      result.status = 'rejected';
      result.error = error;
    },
  );
  return { result, done };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

class WorkerDouble {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn((_message: ClientMessage, _transfer?: Transferable[]) => {});
  terminate = vi.fn();

  receive(data: WorkerMessage) {
    this.onmessage?.({ data } as MessageEvent<WorkerMessage>);
  }

  frame(tick = 0) {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    frame[H.TICK] = tick;
    this.receive({ type: 'frame', buffer: frame.buffer });
  }
}

class ReplayDouble {
  recordSurface = vi.fn();
  makeFrame = () => new Float32Array(HEADER + CAR_STRIDE);
  dispose = vi.fn(async () => {});
}

interface HostLifecycle {
  disposed: boolean;
  errorStopped: boolean;
  generation: number;
  circuitStartup: WorkerReadiness | null;
  initTimeout: number;
  worker: WorkerDouble | null;
  current: Float32Array | null;
  previous: Float32Array | null;
  state: string;
  replay: ReplayDouble | null;
  start(options: SessionOptions, programme?: boolean, holdOnGrid?: boolean): Promise<void>;
  fail(error: unknown): void;
  dispose(): void;
  accept(buffer: ArrayBuffer, generation: number): void;
}

function fixture() {
  const workers: WorkerDouble[] = [];
  const constructed = vi.fn();
  class PhysicsWorker extends WorkerDouble {
    constructor() {
      super();
      constructed();
      workers.push(this);
    }
  }
  const loadPhysicsWorker = vi.fn(async () => ({ default: PhysicsWorker }));
  let clockOffset = 0;
  const timers: (() => void)[] = [];
  const dependencies = {
    WorkerReadiness,
    PauseHandshake,
    H,
    loadPhysicsWorker,
    demoSessionLock: () => null,
    t: (message: string) => message,
    circuitDefinition: (id: string) => ({ id }),
    gpGridForVehicles: () => false,
    validateOptions: (options: SessionOptions) => options,
    resolveLighting: () => 'day',
    sessionLight: () => 'day',
    rulesetFor: () => ({ service: { pitStops: false } }),
    racingSession: () => false,
    emitSessionStarted: vi.fn(),
    rumbleFrom: () => ({ weak: 0, strong: 0 }),
    SessionReplay: ReplayDouble,
    TelemetryRecorder: class {},
    Track: class {
      cold = false;
      water = new Float32Array(1);
      rubber = new Float32Array(1);
      marbles = new Float32Array(1);
    },
    performance: { now: () => performance.now() + clockOffset },
    window: {
      setTimeout: (callback: () => void, delay: number) => {
        timers.push(callback);
        return setTimeout(callback, delay);
      },
      removeEventListener: vi.fn(),
    },
    clearTimeout,
    cancelAnimationFrame: vi.fn(),
    document: { activeElement: { blur: vi.fn() } },
    console: { error: vi.fn(), warn: vi.fn() },
  };
  const construct = new Function(...Object.keys(dependencies), `${code}; return new Host();`);
  const host = construct(...Object.values(dependencies)) as HostLifecycle;
  const own = () => ({ dispose: vi.fn() });
  const services = {
    state: 'menu',
    savingSettings: false,
    meetings: { sessionStarting: vi.fn() },
    gridClock: { reset: vi.fn() },
    programme: { start: vi.fn(), stop: vi.fn(), observe: vi.fn() },
    photoStudio: { close: vi.fn() },
    career: {
      begin: vi.fn(),
      sessionSetup: () => null,
      observe: vi.fn(),
      attackFinished: () => null,
    },
    radio: { reset: vi.fn(), observe: () => null },
    radioCaption: { show: vi.fn() },
    ui: {
      dispose: vi.fn(),
      toast: vi.fn(),
      error: vi.fn(),
      loading: vi.fn(),
      loadingSession: vi.fn(),
      loadingScene: vi.fn(),
      closeModal: vi.fn(),
      showMode: vi.fn(),
      telemetryModal: { close: vi.fn() },
      observePractice: vi.fn(),
      get: vi.fn(() => ({ hidden: false })),
      timeTrial: null as unknown,
    },
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    input: { setEnabled: vi.fn(), activePad: () => null, dispose: vi.fn() },
    audio: {
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      dispose: vi.fn(async () => {}),
      locked: false,
    },
    switchCircuit: vi.fn(async () => true),
    applyLight: vi.fn(),
    settings: { setup: {}, quickStart: true, rumble: 0 },
    exporter: { cancel: vi.fn() },
    replay: null as ReplayDouble | null,
    liveFrames: { reset: vi.fn(), observe: vi.fn(), setPaused: vi.fn() },
    renderer: {
      ...own(),
      gridPerformance: { reset: vi.fn() },
      setPhoto: vi.fn(),
      reset: vi.fn(),
      circuit: {},
      prepare: vi.fn(
        async (
          _frame: Float32Array,
          _progress: (message: string) => void,
          _cancelled: () => boolean,
        ) => true,
      ),
      setLivery: vi.fn(),
      setGhost: vi.fn(),
      changeCamera: vi.fn(),
    },
    track: { circuit: { id: 'fixture' } },
    team: { livery: {} },
    records: { prepare: vi.fn(async () => {}), observe: vi.fn(), trial: { label: 'ghost' } },
    referenceSession: { ...own(), interrupt: vi.fn(), beginSession: vi.fn(() => null) },
    observeSession: vi.fn(),
    pause: vi.fn(),
    openRaceBriefing: vi.fn(),
    inputPump: { ...own(), poll: vi.fn() },
    rumble: { stop: vi.fn(), update: vi.fn() },
    sessionReview: { stop: vi.fn() },
    tabEvidence: { ...own(), observe: vi.fn() },
    festivalOwner: { cancel: vi.fn() },
    endDemoClock: vi.fn(),
    reviewVideo: own(),
    menuFrames: own(),
    menuPreviewReceipt: own(),
    uiSounds: own(),
  };
  const app = Object.assign(host, services);
  const options = { ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' as const };
  return {
    app,
    workers,
    constructed,
    loadPhysicsWorker,
    dependencies,
    timers,
    stall: (milliseconds: number) => {
      clockOffset += milliseconds;
    },
    start: () => observe(app.start(options)),
    async worker() {
      await flush();
      const worker = workers.at(-1);
      if (!worker) throw new Error('Startup did not construct its worker');
      return worker;
    },
  };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('circuit first-frame startup settlement', () => {
  it('prepares exactly once after the first frame and continues accepting running frames', async () => {
    const h = fixture(),
      start = h.start(),
      worker = await h.worker();
    const readiness = h.app.circuitStartup!;
    expect(start.result.status).toBe('pending');
    expect(readiness.pending).toBe(true);
    expect(h.app.renderer.prepare).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    worker.frame();
    await start.done;
    expect(start.result.status).toBe('fulfilled');
    expect(readiness.pending).toBe(false);
    expect(h.app.circuitStartup).toBeNull();
    expect(h.app.initTimeout).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.app.state).toBe('driving');
    expect(h.app.renderer.prepare).toHaveBeenCalledOnce();
    expect(h.app.input.setEnabled.mock.calls).toEqual([[false], [true]]);
    expect(h.app.inputPump.poll).toHaveBeenCalledOnce();
    worker.frame(1);
    expect(h.app.current?.[H.TICK]).toBe(1);
    expect(h.app.renderer.prepare).toHaveBeenCalledOnce();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it.each(['native', 'protocol', 'decode'] as const)(
    'rejects startup and ignores queued frames after a %s worker failure',
    async (kind) => {
      const h = fixture(),
        start = h.start(),
        worker = await h.worker();
      const readiness = h.app.circuitStartup!;
      if (kind === 'native') worker.onerror?.({ message: 'boot failed' } as ErrorEvent);
      else if (kind === 'protocol') worker.receive({ type: 'error', message: 'boot failed' });
      else worker.onmessageerror?.();
      await start.done;
      expect(start.result.status).toBe('rejected');
      expect(start.result.error).toBeInstanceOf(Error);
      expect(readiness.pending).toBe(false);
      expect(h.app.circuitStartup).toBeNull();
      expect(h.app.initTimeout).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(worker.terminate).toHaveBeenCalledOnce();
      worker.frame();
      worker.onerror?.({ message: 'late error' } as ErrorEvent);
      expect(h.app.current).toBeNull();
      expect(h.app.renderer.prepare).not.toHaveBeenCalled();
      expect(h.app.ui.error).toHaveBeenCalledOnce();
      expect(h.app.inputPump.poll).not.toHaveBeenCalled();
    },
  );

  it('rejects at the existing 45-second initialization threshold', async () => {
    const h = fixture(),
      start = h.start(),
      worker = await h.worker();
    await vi.advanceTimersByTimeAsync(40000);
    expect(start.result.status).toBe('pending');
    expect(h.app.errorStopped).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await start.done;
    expect(start.result.status).toBe('rejected');
    expect(String(start.result.error)).toContain('Physics worker did not initialize');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(h.app.circuitStartup).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps a delayed timeout check at six seconds of counted initialization time', async () => {
    const h = fixture(),
      start = h.start();
    await h.worker();
    h.stall(60000);
    await vi.advanceTimersByTimeAsync(40000);
    expect(start.result.status).toBe('pending');
    expect(h.app.errorStopped).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await start.done;
    expect(start.result.status).toBe('rejected');
  });

  it('settles disposal before the first frame and makes later callbacks inert', async () => {
    const h = fixture(),
      start = h.start(),
      worker = await h.worker();
    const readiness = h.app.circuitStartup!;
    h.app.dispose();
    await start.done;
    expect(start.result.status).toBe('fulfilled');
    expect(readiness.pending).toBe(false);
    expect(h.app.circuitStartup).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    worker.frame();
    worker.onerror?.({ message: 'after disposal' } as ErrorEvent);
    worker.onmessageerror?.();
    h.app.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(h.app.renderer.prepare).not.toHaveBeenCalled();
    expect(h.app.ui.error).not.toHaveBeenCalled();
    expect(h.app.current).toBeNull();
  });

  it.each(['init', 'engineering'] as const)(
    'handles a synchronous %s post failure without leaving readiness or a timeout',
    async (type) => {
      const h = fixture();
      const error = new Error(`${type} posting failed`);
      class BrokenWorker extends WorkerDouble {
        postMessage = vi.fn((message: ClientMessage) => {
          if (message.type === type) throw error;
        });
      }
      const worker = new BrokenWorker();
      h.loadPhysicsWorker.mockResolvedValue({
        default: class extends WorkerDouble {
          constructor() {
            super();
            return worker;
          }
        },
      });
      const start = h.start();
      await start.done;
      expect(start.result).toEqual({ status: 'rejected', error });
      expect(h.app.circuitStartup).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(h.app.renderer.prepare).not.toHaveBeenCalled();
    },
  );

  it('settles readiness when the worker constructor throws', async () => {
    const h = fixture(),
      error = new Error('Worker construction failed');
    h.constructed.mockImplementation(() => {
      throw error;
    });
    const start = h.start();
    await start.done;
    expect(start.result).toEqual({ status: 'rejected', error });
    expect(h.app.circuitStartup).toBeNull();
    expect(h.app.initTimeout).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.app.ui.error).toHaveBeenCalledOnce();
  });

  it('does not prepare if failure follows the first frame before its continuation', async () => {
    const h = fixture(),
      start = h.start(),
      worker = await h.worker();
    worker.frame();
    worker.receive({ type: 'error', message: 'first-frame failure' });
    await start.done;
    expect(start.result.status).toBe('rejected');
    expect(h.app.renderer.prepare).not.toHaveBeenCalled();
    expect(h.app.inputPump.poll).not.toHaveBeenCalled();
  });

  it('stops posting startup commands if initialization fails reentrantly', async () => {
    const h = fixture();
    const worker = new WorkerDouble();
    worker.postMessage.mockImplementation((message) => {
      if (message.type === 'init')
        worker.receive({ type: 'error', message: 'synchronous initialization failure' });
    });
    h.loadPhysicsWorker.mockResolvedValue({
      default: class extends WorkerDouble {
        constructor() {
          super();
          return worker;
        }
      },
    });
    const start = h.start();
    await start.done;
    expect(start.result.status).toBe('rejected');
    expect(worker.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['init']);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(h.app.circuitStartup).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not apply the first-frame timeout to subsequent renderer preparation', async () => {
    const h = fixture(),
      prepared = deferred<boolean>();
    h.app.renderer.prepare.mockReturnValue(prepared.promise);
    const start = h.start(),
      worker = await h.worker();
    worker.frame();
    await flush();
    expect(h.app.renderer.prepare).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(90000);
    expect(start.result.status).toBe('pending');
    expect(h.app.errorStopped).toBe(false);
    prepared.resolve(true);
    await start.done;
    expect(start.result.status).toBe('fulfilled');
    expect(h.app.state).toBe('driving');
  });
});

describe('circuit startup cancellation across preparation awaits', () => {
  it.each(['audio', 'module', 'circuit', 'renderer', 'records'] as const)(
    'settles failure during %s preparation and consumes late rejection',
    async (stage) => {
      const h = fixture(),
        held = deferred<never>(),
        error = new Error(`${stage} failed`);
      if (stage === 'audio') h.app.audio.start.mockReturnValue(held.promise);
      if (stage === 'module') h.loadPhysicsWorker.mockReturnValue(held.promise);
      if (stage === 'circuit') h.app.switchCircuit.mockReturnValue(held.promise);
      if (stage === 'renderer') h.app.renderer.prepare.mockReturnValue(held.promise);
      if (stage === 'records') h.app.records.prepare.mockReturnValue(held.promise);
      const start = h.start();
      await flush();
      if (stage === 'renderer' || stage === 'records') {
        h.workers[0].frame();
        await flush();
      }
      const readiness = h.app.circuitStartup!;
      expect(start.result.status).toBe('pending');
      h.app.fail(error);
      await flush();
      expect(start.result).toEqual({ status: 'rejected', error });
      expect(readiness.pending).toBe(false);
      expect(h.app.circuitStartup).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      const messages = h.app.ui.loading.mock.calls.length;
      h.app.renderer.prepare.mock.calls[0]?.[1]('late progress');
      expect(h.app.ui.loading).toHaveBeenCalledTimes(messages);
      held.reject(new Error('shared preparation failed after departure'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.app.state).toBe('loading');
      expect(h.app.inputPump.poll).not.toHaveBeenCalled();
      expect(h.app.ui.error).toHaveBeenCalledOnce();
      if (stage === 'audio' || stage === 'module' || stage === 'circuit')
        expect(h.workers).toHaveLength(0);
    },
  );

  it.each(['audio', 'module', 'circuit', 'renderer', 'records'] as const)(
    'settles disposal during %s preparation without resuming startup',
    async (stage) => {
      const h = fixture(),
        held = deferred<never>();
      if (stage === 'audio') h.app.audio.start.mockReturnValue(held.promise);
      if (stage === 'module') h.loadPhysicsWorker.mockReturnValue(held.promise);
      if (stage === 'circuit') h.app.switchCircuit.mockReturnValue(held.promise);
      if (stage === 'renderer') h.app.renderer.prepare.mockReturnValue(held.promise);
      if (stage === 'records') h.app.records.prepare.mockReturnValue(held.promise);
      const start = h.start();
      await flush();
      if (stage === 'renderer' || stage === 'records') {
        h.workers[0].frame();
        await flush();
      }
      h.app.dispose();
      await flush();
      expect(start.result.status).toBe('fulfilled');
      expect(h.app.circuitStartup).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      held.reject(new Error('late disposed preparation failure'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(h.app.ui.error).not.toHaveBeenCalled();
      expect(h.app.inputPump.poll).not.toHaveBeenCalled();
      expect(h.app.renderer.prepare.mock.calls.length).toBe(
        stage === 'renderer' || stage === 'records' ? 1 : 0,
      );
    },
  );

  it('replaces a startup still loading its module without awaiting the abandoned import', async () => {
    const h = fixture(),
      imported = deferred<never>();
    h.loadPhysicsWorker.mockReturnValueOnce(imported.promise);
    const first = h.start();
    await flush();
    const firstReady = h.app.circuitStartup!;
    const second = h.start();
    const worker = await h.worker();
    expect(first.result.status).toBe('fulfilled');
    expect(firstReady.pending).toBe(false);
    expect(firstReady.lifetime.signal.aborted).toBe(true);
    expect(second.result.status).toBe('pending');
    worker.frame();
    await second.done;
    imported.reject(new Error('abandoned module failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.app.state).toBe('driving');
    expect(h.app.ui.error).not.toHaveBeenCalled();
    expect(h.workers).toHaveLength(1);
  });

  it('ignores old frames, errors, readiness receipts and timer callbacks after replacement', async () => {
    const h = fixture(),
      first = h.start(),
      oldWorker = await h.worker();
    const firstReady = h.app.circuitStartup!,
      oldGeneration = h.app.generation;
    const oldCheck = h.timers[0];
    // The surrounding host has returned to its menu before requesting another run.
    h.app.state = 'menu';
    const second = h.start(),
      worker = await h.worker();
    const secondReady = h.app.circuitStartup!,
      timer = h.app.initTimeout;
    expect(first.result.status).toBe('fulfilled');
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    expect(secondReady).not.toBe(firstReady);
    oldWorker.frame();
    oldWorker.onerror?.({ message: 'stale worker failure' } as ErrorEvent);
    oldWorker.onmessageerror?.();
    oldCheck();
    secondReady.accept(oldGeneration);
    h.app.accept(new Float32Array(HEADER + CAR_STRIDE).buffer, oldGeneration);
    await flush();
    expect(second.result.status).toBe('pending');
    expect(secondReady.pending).toBe(true);
    expect(h.app.initTimeout).toBe(timer);
    expect(vi.getTimerCount()).toBe(1);
    expect(h.app.current).toBeNull();
    expect(h.app.errorStopped).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.frame();
    await second.done;
    expect(second.result.status).toBe('fulfilled');
    expect(h.app.renderer.prepare).toHaveBeenCalledOnce();
    expect(h.app.ui.error).not.toHaveBeenCalled();
  });

  it('cancels preparation after a first frame without affecting the replacement startup', async () => {
    const h = fixture(),
      prepared = deferred<boolean>();
    h.app.renderer.prepare.mockReturnValueOnce(prepared.promise);
    const first = h.start(),
      oldWorker = await h.worker();
    oldWorker.frame();
    await flush();
    const firstReady = h.app.circuitStartup!;
    expect(firstReady.pending).toBe(false);
    expect(first.result.status).toBe('pending');
    h.app.state = 'menu';
    const second = h.start(),
      worker = await h.worker();
    const replacement = h.app.circuitStartup!,
      timer = h.app.initTimeout;
    expect(first.result.status).toBe('fulfilled');
    expect(replacement).not.toBe(firstReady);
    expect(firstReady.lifetime.signal.aborted).toBe(true);
    const messages = h.app.ui.loading.mock.calls.length;
    h.app.renderer.prepare.mock.calls[0][1]('old renderer progress');
    prepared.reject(new Error('old renderer failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.app.ui.loading).toHaveBeenCalledTimes(messages);
    expect(h.app.ui.error).not.toHaveBeenCalled();
    expect(h.app.circuitStartup).toBe(replacement);
    expect(h.app.initTimeout).toBe(timer);
    expect(vi.getTimerCount()).toBe(1);
    expect(second.result.status).toBe('pending');
    worker.frame();
    await second.done;
    expect(second.result.status).toBe('fulfilled');
    expect(h.app.state).toBe('driving');
    expect(h.app.inputPump.poll).toHaveBeenCalledOnce();
  });

  it('refuses new startup work after failure or disposal', async () => {
    for (const terminal of ['fail', 'dispose'] as const) {
      const h = fixture();
      if (terminal === 'fail') h.app.fail(new Error('terminal'));
      else h.app.dispose();
      const start = h.start();
      await start.done;
      expect(start.result.status).toBe('fulfilled');
      expect(h.loadPhysicsWorker).not.toHaveBeenCalled();
      expect(h.app.meetings.sessionStarting).not.toHaveBeenCalled();
    }
  });
});
