import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  graphicsSettingsChanged,
  runSettingsChange,
  yieldBrowserTask,
} from '../src/core/settings-transition.ts';
import { InputPump } from '../src/input/pump.ts';
import type { FestivalHost, FestivalStartOptions } from '../src/session/free-roam.ts';
import { SessionStartOwner } from '../src/session/session-start-owner.ts';
import { WorkerReadiness } from '../src/session/worker-readiness.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  type Controls,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { CAR_STRIDE, HEADER, H } from '../src/simulation/protocol.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/storage/data.ts';
import { gameEvents } from '../src/steam/events.ts';
import { emitSessionStarted } from '../src/steam/hooks.ts';
import {
  PauseHandshake,
  type ClientMessage,
  type WorkerMessage,
} from '../src/workers/diagnostics.ts';

/** Run complete production admission, preparation, recovery and input dispatch.
 * Only the two lazy module imports are replaced. The real session/readiness
 * owners and settings transaction retain their asynchronous ordering. */
function productionHost() {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  )!;
  const names = [
    'disposed',
    'errorStopped',
    'pageWaiters',
    'generation',
    'rendererBuild',
    'circuitStartup',
    'initTimeout',
    'worker',
    'workerPause',
    'current',
    'previous',
    'savingSettings',
    'festivalOwner',
    'festival',
    'festivalStarting',
    'startFestival',
    'exitFestival',
    'start',
    'switchCircuit',
    'post',
    'accept',
    'prepareTimeTrial',
    'applySettings',
    'fail',
    'dispose',
  ];
  const members = names.map((name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing GameApp.${name}`);
    return member.getText(source);
  });
  const pumps: ts.BinaryExpression[] = [];
  function findPump(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(source) === 'this.inputPump' &&
      ts.isNewExpression(node.right)
    )
      pumps.push(node);
    ts.forEachChild(node, findPump);
  }
  findPump(owner);
  if (pumps.length !== 1) throw new Error('Expected the production input callback');
  const imports: string[] = [];
  const code = ts.transpileModule(
    `class Host { ${members.join('\n')} install() { ${pumps[0].getText(source)}; } }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      transformers: {
        before: [
          (context) => {
            const visit: ts.Visitor = (node) => {
              if (
                ts.isCallExpression(node) &&
                node.expression.kind === ts.SyntaxKind.ImportKeyword
              ) {
                const path = node.arguments[0];
                if (!ts.isStringLiteral(path))
                  throw new Error('Expected a literal module boundary');
                const loader =
                  path.text === './session/free-roam.ts'
                    ? 'loadFestivalModule'
                    : path.text === './workers/physics.worker.ts?worker&inline'
                      ? 'loadPhysicsWorker'
                      : null;
                if (!loader) throw new Error(`Unexpected startup import: ${path.text}`);
                imports.push(loader);
                return ts.factory.createCallExpression(
                  ts.factory.createIdentifier(loader),
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
    },
  ).outputText;
  expect(imports.sort()).toEqual(['loadFestivalModule', 'loadPhysicsWorker']);
  return code;
}
const code = productionHost();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
class CircuitWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn((_message: ClientMessage, _transfer?: Transferable[]) => {});
  terminate = vi.fn();
  frame() {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    this.onmessage?.({
      data: { type: 'frame', buffer: frame.buffer },
    } as MessageEvent<WorkerMessage>);
  }
}
class Festival {
  drivingInputEnabled = true;
  input = vi.fn<(sample: Controls) => void>();
  dispose = vi.fn();
}
class Replay {
  recordSurface = vi.fn();
  makeFrame = () => new Float32Array(HEADER + CAR_STRIDE);
  dispose = vi.fn(async () => {});
}
interface Host {
  state: string;
  generation: number;
  disposed: boolean;
  errorStopped: boolean;
  circuitStartup: WorkerReadiness | null;
  worker: CircuitWorker | null;
  inputPump: InputPump;
  festivalOwner: SessionStartOwner<Festival>;
  readonly festival: Festival | null;
  readonly festivalStarting: boolean;
  savingSettings: boolean;
  install(): void;
  start(options: SessionOptions): Promise<void>;
  startFestival(options: SessionOptions): Promise<void>;
  exitFestival(): void;
  switchCircuit(id: string, gpGrid?: boolean): Promise<boolean>;
  applySettings(settings: Settings): Promise<void>;
  fail(error: unknown): void;
  dispose(): void;
}
const hosts: Host[] = [];
const unsubscribeEvents: (() => void)[] = [];
function fixture() {
  const workers: CircuitWorker[] = [];
  class PhysicsWorker extends CircuitWorker {
    constructor() {
      super();
      workers.push(this);
    }
  }
  const loadPhysicsWorker = vi.fn(async () => ({ default: PhysicsWorker }));
  const festival = new Festival();
  const preparing = deferred<Festival>();
  const createFestival = vi.fn(
    (_host: FestivalHost, _options: FestivalStartOptions) => preparing.promise,
  );
  const module = { FestivalSession: { start: createFestival }, FESTIVAL_SAVE_KEY: 'festival' };
  const imported = deferred<typeof module>();
  const loadFestivalModule = vi.fn(() => imported.promise);
  const screen = { hidden: true, setAttribute: vi.fn() };
  const document = {
    hidden: false,
    activeElement: { blur: vi.fn() },
    querySelector: () => null,
    getElementById: () => ({}),
    documentElement: { style: { setProperty: vi.fn() }, dataset: {} },
  };
  const dependencies = {
    WorkerReadiness,
    SessionStartOwner,
    PauseHandshake,
    InputPump,
    H,
    loadPhysicsWorker,
    loadFestivalModule,
    graphicsSettingsChanged,
    runSettingsChange,
    yieldBrowserTask,
    demoSessionLock: () => null,
    t: (value: string) => value,
    circuitDefinition: (id = 'aurel') => ({ id, name: id }),
    gpGridForVehicles: () => false,
    validateOptions: (options: SessionOptions) => options,
    resolveLighting: () => 'day',
    sessionLight: () => 'day',
    systemReducedMotion: () => false,
    rulesetFor: () => ({ service: { pitStops: false } }),
    racingSession: () => false,
    rumbleFrom: () => ({ weak: 0, strong: 0 }),
    emitSessionStarted: vi.fn(emitSessionStarted),
    SessionReplay: Replay,
    TelemetryRecorder: class {},
    Track: class {
      cold = false;
      water = new Float32Array(1);
      rubber = new Float32Array(1);
      marbles = new Float32Array(1);
      constructor(
        _weather: string,
        _ghost: boolean,
        _length: unknown,
        public circuit: { id: string },
      ) {}
    },
    document,
    window: { setTimeout, removeEventListener: vi.fn() },
    clearTimeout,
    requestAnimationFrame: (callback: (time: number) => void) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
    console: { error: vi.fn(), warn: vi.fn() },
    navigator: { languages: ['en'] },
    currentLocale: () => 'en',
    resolveLocale: () => 'en',
    applyHudScale: vi.fn(),
  };
  const host = new Function(...Object.keys(dependencies), `${code}; return new Host();`)(
    ...Object.values(dependencies),
  ) as Host;
  const own = () => ({ dispose: vi.fn() });
  const renderer = () => {
    const gl = { disposed: false };
    return {
      renderer: gl,
      lighting: 'day',
      canPrepareGrid: () => true,
      dispose: vi.fn(() => {
        gl.disposed = true;
      }),
      gridPerformance: { reset: vi.fn() },
      setPhoto: vi.fn(),
      reset: vi.fn(),
      circuit: {},
      prepare: vi.fn(async () => true),
      prepareQuality: vi.fn(async () => true),
      setQuality: vi.fn(),
      setLivery: vi.fn(),
      setGhost: vi.fn(),
      changeCamera: vi.fn(),
    };
  };
  const app = Object.assign(host, {
    state: 'menu',
    canvas: {},
    renderer: renderer(),
    track: { circuit: { id: 'aurel' } },
    settings: { ...structuredClone(DEFAULT_SETTINGS), quickStart: true },
    team: { livery: {} },
    lightChoice: 'auto',
    meetings: { sessionStarting: vi.fn() },
    gridClock: { reset: vi.fn() },
    programme: { start: vi.fn(), stop: vi.fn(), observe: vi.fn() },
    photoStudio: { close: vi.fn() },
    career: {
      begin: vi.fn(),
      beginFestival: vi.fn(),
      endFestival: vi.fn(),
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
      loading: vi.fn(() => {
        screen.hidden = false;
      }),
      loadingSession: vi.fn(),
      loadingScene: vi.fn(),
      closeModal: vi.fn(),
      showMode: vi.fn(),
      ready: vi.fn(() => {
        screen.hidden = true;
      }),
      observePractice: vi.fn(),
      applyBindings: vi.fn(),
      get: vi.fn(() => screen),
      modal: { open: false },
      telemetryModal: { close: vi.fn(), open: false },
    },
    input: {
      setEnabled: vi.fn(),
      activePad: () => null,
      dispose: vi.fn(),
      pollActions: vi.fn(),
      update: vi.fn(() => ({ ...controls(), throttle: 0.5 })),
    },
    audio: {
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      dispose: vi.fn(async () => {}),
      update: vi.fn(),
      configureDriving: vi.fn(),
      locked: false,
    },
    applyLight: vi.fn(),
    applyMotion: vi.fn(),
    applyAudio: vi.fn(),
    applyCommunication: vi.fn(),
    buildRenderer: vi.fn(async (): Promise<boolean> => {
      app.renderer = renderer();
      return true;
    }),
    store: { write: vi.fn(async () => {}) },
    action: vi.fn(),
    previewSelectedMachine: vi.fn(),
    selectedMachinePreview: vi.fn(() => new Float32Array(HEADER + CAR_STRIDE)),
    exporter: { cancel: vi.fn() },
    liveFrames: { reset: vi.fn(), observe: vi.fn(), setPaused: vi.fn() },
    records: { prepare: vi.fn(async () => {}), observe: vi.fn(), trial: null },
    referenceSession: { ...own(), interrupt: vi.fn(), beginSession: () => null },
    observeSession: vi.fn(),
    pause: vi.fn(),
    openRaceBriefing: vi.fn(),
    rumble: { stop: vi.fn(), update: vi.fn() },
    sessionReview: { stop: vi.fn() },
    tabEvidence: { ...own(), observe: vi.fn() },
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    beginDemoClock: vi.fn(),
    endDemoClock: vi.fn(),
    reviewVideo: own(),
    menuFrames: own(),
    menuPreviewReceipt: { ...own(), request: vi.fn() },
    uiSounds: own(),
  });
  const switchCircuit = vi.spyOn(app, 'switchCircuit');
  app.install();
  app.inputPump.start();
  hosts.push(app);
  const circuitOptions = {
    ...DEFAULT_OPTIONS,
    circuit: 'vellamar' as const,
    mode: 'practice' as const,
    opponents: 0,
  };
  const festivalOptions = { ...DEFAULT_OPTIONS, mode: 'festival' as SessionOptions['mode'] };
  return {
    app,
    workers,
    imported,
    preparing,
    module,
    festival,
    createFestival,
    screen,
    switchCircuit,
    loadPhysicsWorker,
    loadFestivalModule,
    document,
    emitted: dependencies.emitSessionStarted,
    // Match the production UI caller's terminal error handler.
    circuit: () => app.start(circuitOptions).catch((error) => app.fail(error)),
    festivalStart: () => app.startFestival(festivalOptions).catch((error) => app.fail(error)),
    async finishFestival() {
      imported.resolve(module);
      await flush();
      createFestival.mock.calls.at(-1)![0].loaded();
      preparing.resolve(festival);
      await flush();
    },
    async finishCircuit() {
      await flush();
      expect(workers).toHaveLength(1);
      workers[0].frame();
      await flush();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const unsubscribe of unsubscribeEvents.splice(0)) unsubscribe();
  for (const host of hosts.splice(0)) host.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cross-mode renderer startup admission', () => {
  it('claims Festival before its lazy import and rejects circuit/duplicate submits through readiness', async () => {
    const h = fixture(),
      original = h.app.renderer;
    const pending = h.festivalStart();
    expect(h.app.festivalStarting).toBe(true);
    expect(h.app.state).toBe('loading');
    expect(h.screen.hidden).toBe(false);
    expect(h.app.ui.showMode).toHaveBeenLastCalledWith('loading');
    expect(h.app.input.setEnabled).toHaveBeenLastCalledWith(false);
    h.app.inputPump.poll();
    await h.circuit();
    await h.festivalStart();
    expect(h.app.generation).toBe(0);
    expect(h.loadPhysicsWorker).not.toHaveBeenCalled();
    expect(h.switchCircuit).not.toHaveBeenCalled();
    h.imported.resolve(h.module);
    await flush();
    await h.circuit();
    await h.festivalStart();
    expect(h.createFestival).toHaveBeenCalledOnce();
    expect(h.createFestival.mock.calls[0][0].renderer).toBe(original.renderer);
    expect(original.renderer.disposed).toBe(false);
    await h.finishFestival();
    await pending;
    await h.circuit();
    await h.festivalStart();
    h.app.inputPump.poll();
    expect(h.app.festival).toBe(h.festival);
    expect(h.festival.input).toHaveBeenCalledOnce();
    expect(h.workers).toHaveLength(0);
    expect(h.loadFestivalModule).toHaveBeenCalledOnce();
    expect(h.app.state).toBe('menu');
    expect(h.app.ui.showMode).toHaveBeenLastCalledWith('festival');
    expect(h.screen.hidden).toBe(true);
  });

  it.each(['audio', 'module', 'renderer', 'records'] as const)(
    'rejects Festival while circuit %s preparation owns the renderer',
    async (stage) => {
      const h = fixture(),
        held = deferred<never>();
      if (stage === 'audio') h.app.audio.start.mockReturnValueOnce(held.promise);
      if (stage === 'module') h.loadPhysicsWorker.mockReturnValueOnce(held.promise);
      if (stage === 'renderer') {
        const build = h.app.buildRenderer.getMockImplementation()!;
        h.app.buildRenderer.mockImplementationOnce(async () => {
          const built = await build();
          h.app.renderer.prepare.mockReturnValueOnce(held.promise);
          return built;
        });
      }
      if (stage === 'records') h.app.records.prepare.mockReturnValueOnce(held.promise);
      const pending = h.circuit();
      await flush();
      if (stage === 'renderer' || stage === 'records') {
        h.workers[0].frame();
        await flush();
      }
      expect(h.app.circuitStartup).not.toBeNull();
      await h.festivalStart();
      expect(h.loadFestivalModule).not.toHaveBeenCalled();
      expect(h.app.festivalStarting).toBe(false);
      expect(h.app.ui.showMode).toHaveBeenLastCalledWith('loading');
      h.app.dispose();
      await pending;
      held.reject(new Error('late departed preparation'));
      await flush();
      expect(h.app.ui.error).not.toHaveBeenCalled();
    },
  );

  it('keeps circuit input exclusive after startup and admits Festival after return to the paddock', async () => {
    const h = fixture(),
      pending = h.circuit();
    await h.finishCircuit();
    await pending;
    expect(h.app.state).toBe('driving');
    await h.festivalStart();
    expect(h.loadFestivalModule).not.toHaveBeenCalled();
    expect(h.workers[0].postMessage.mock.calls.some(([message]) => message.type === 'input')).toBe(
      true,
    );
    // The normal menu action parks the previous circuit worker and disables input.
    h.app.state = 'menu';
    h.app.input.setEnabled(false);
    const festivalPending = h.festivalStart();
    await h.finishFestival();
    await festivalPending;
    h.workers[0].postMessage.mockClear();
    h.app.inputPump.poll();
    expect(h.festival.input).toHaveBeenCalledOnce();
    expect(h.workers[0].postMessage).not.toHaveBeenCalled();
    expect(h.app.renderer.renderer.disposed).toBe(false);
  });
});

describe('startup and settings renderer ownership', () => {
  it('rejects both modes throughout quality preparation and durable saving, then permits startup', async () => {
    const h = fixture(),
      prepared = deferred<boolean>(),
      saved = deferred<void>();
    h.app.renderer.prepareQuality.mockReturnValue(prepared.promise);
    h.app.store.write.mockReturnValue(saved.promise);
    const settings = { ...h.app.settings, quality: 'low' as const };
    const saving = h.app.applySettings(settings);
    expect(h.app.savingSettings).toBe(true);
    await h.festivalStart();
    await h.circuit();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.app.renderer.prepareQuality).toHaveBeenCalledOnce();
    await h.festivalStart();
    await h.circuit();
    prepared.resolve(true);
    await flush();
    expect(h.app.store.write).toHaveBeenCalledOnce();
    await h.festivalStart();
    await h.circuit();
    expect(h.loadFestivalModule).not.toHaveBeenCalled();
    expect(h.loadPhysicsWorker).not.toHaveBeenCalled();
    saved.resolve();
    await saving;
    expect(h.app.savingSettings).toBe(false);
    const pending = h.festivalStart();
    await h.finishFestival();
    await pending;
    expect(h.createFestival.mock.calls[0][0].quality).toBe('low');
    expect(h.app.ui.error).not.toHaveBeenCalled();
  });

  it.each(['festival', 'circuit'] as const)(
    'rejects a settings submission after %s admission',
    async (mode) => {
      const h = fixture(),
        pending = mode === 'festival' ? h.festivalStart() : h.circuit();
      const settings = { ...h.app.settings, quality: 'low' as const };
      await h.app.applySettings(settings);
      expect(h.app.savingSettings).toBe(false);
      expect(h.app.renderer.prepareQuality).not.toHaveBeenCalled();
      expect(h.app.store.write).not.toHaveBeenCalled();
      if (mode === 'festival') {
        await h.finishFestival();
        await h.app.applySettings(settings);
        expect(h.app.renderer.prepareQuality).not.toHaveBeenCalled();
      } else await h.finishCircuit();
      await pending;
      expect(h.app.ui.error).not.toHaveBeenCalled();
    },
  );
});

describe('Festival startup recovery and cancellation', () => {
  it.each(['import', 'prepare', 'ready'] as const)(
    'restores the menu after %s failure and admits the next circuit launch',
    async (stage) => {
      const h = fixture(),
        error = new Error(`${stage} failure`),
        pending = h.festivalStart();
      if (stage === 'import') h.imported.reject(error);
      else {
        h.imported.resolve(h.module);
        await flush();
        if (stage === 'prepare') h.preparing.reject(error);
        else {
          h.app.beginDemoClock.mockImplementationOnce(() => {
            throw error;
          });
          h.preparing.resolve(h.festival);
        }
      }
      await pending;
      expect(h.app.festivalStarting).toBe(false);
      expect(h.app.festival).toBeNull();
      expect(h.app.state).toBe('menu');
      expect(h.screen.hidden).toBe(true);
      expect(h.app.ui.toast).toHaveBeenCalledExactlyOnceWith(error.message);
      expect(h.app.ui.error).not.toHaveBeenCalled();
      expect(h.app.renderer.setQuality).toHaveBeenCalledOnce();
      expect(h.app.input.setEnabled).toHaveBeenLastCalledWith(false);
      const circuit = h.circuit();
      await h.finishCircuit();
      await circuit;
      expect(h.app.state).toBe('driving');
      expect(h.app.errorStopped).toBe(false);
      expect(h.festival.input).not.toHaveBeenCalled();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'lets circuit startup replace a cancelled import and ignores its late %s',
    async (outcome) => {
      const h = fixture(),
        pending = h.festivalStart();
      h.app.exitFestival();
      expect(h.app.state).toBe('menu');
      expect(h.screen.hidden).toBe(true);
      const circuit = h.circuit();
      await h.finishCircuit();
      await circuit;
      if (outcome === 'resolve') h.imported.resolve(h.module);
      else h.imported.reject(new Error('departed import'));
      await pending;
      expect(h.createFestival).not.toHaveBeenCalled();
      expect(h.app.state).toBe('driving');
      expect(h.app.ui.showMode).toHaveBeenLastCalledWith('driving');
      expect(h.app.ui.toast).not.toHaveBeenCalled();
      expect(h.app.ui.error).not.toHaveBeenCalled();
    },
  );

  it('revokes stale preparation callbacks before a new Festival takes ownership', async () => {
    const h = fixture(),
      pending = h.festivalStart();
    h.imported.resolve(h.module);
    await flush();
    const [oldHost, oldOptions] = h.createFestival.mock.calls[0];
    h.app.exitFestival();
    expect(oldOptions.signal?.aborted).toBe(true);
    const next = new Festival();
    h.createFestival.mockResolvedValueOnce(next);
    const replacement = h.festivalStart();
    await flush();
    h.createFestival.mock.calls[1][0].loaded();
    await replacement;
    const modes = h.app.ui.showMode.mock.calls.length;
    const enablements = h.app.input.setEnabled.mock.calls.length;
    oldHost.loaded();
    oldHost.loading('stale progress');
    oldHost.exit();
    oldHost.driving?.(true);
    h.preparing.resolve(h.festival);
    await pending;
    expect(h.festival.dispose).toHaveBeenCalledOnce();
    expect(h.app.festival).toBe(next);
    expect(h.app.ui.showMode).toHaveBeenCalledTimes(modes);
    expect(h.app.input.setEnabled).toHaveBeenCalledTimes(enablements);
    expect(h.app.ui.loading).not.toHaveBeenCalledWith('stale progress');
    expect(h.app.ui.error).not.toHaveBeenCalled();
    h.app.inputPump.poll();
    expect(next.input).toHaveBeenCalledOnce();
    expect(h.festival.input).not.toHaveBeenCalled();
  });

  it('keeps failed renderer restoration terminal instead of reporting a recovered start', async () => {
    const h = fixture(),
      recoveryError = new Error('renderer restoration failed');
    h.app.renderer.setQuality.mockImplementation(() => {
      throw recoveryError;
    });
    const pending = h.festivalStart();
    h.imported.reject(new Error('module failed'));
    await pending;
    expect(h.app.errorStopped).toBe(true);
    expect(h.app.ui.error).toHaveBeenCalledExactlyOnceWith(recoveryError.message);
    expect(h.app.ui.toast).not.toHaveBeenCalled();
    await h.circuit();
    expect(h.loadPhysicsWorker).not.toHaveBeenCalled();
  });

  it.each(['fail', 'dispose'] as const)(
    'keeps %s terminal while a cancelled Festival import rejects later',
    async (terminal) => {
      const h = fixture(),
        pending = h.festivalStart();
      if (terminal === 'fail') h.app.fail(new Error('context lost'));
      else h.app.dispose();
      h.imported.reject(new Error('late import'));
      await pending;
      await h.circuit();
      expect(h.loadPhysicsWorker).not.toHaveBeenCalled();
      expect(h.app.ui.ready).not.toHaveBeenCalled();
      expect(h.app.ui.toast).not.toHaveBeenCalled();
      expect(h.app.ui.error).toHaveBeenCalledTimes(terminal === 'fail' ? 1 : 0);
    },
  );
});

describe('final startup callbacks retain their original host owner', () => {
  it.each(['fail', 'dispose'] as const)(
    'does not activate circuit input after a session-start subscriber calls %s',
    async (terminal) => {
      const h = fixture();
      let inputCallsAtRevocation = -1;
      unsubscribeEvents.push(
        gameEvents.on('session.started', (event) => {
          if (event.kind !== 'circuit') return;
          if (terminal === 'fail') h.app.fail(new Error('Subscriber revoked the host'));
          else h.app.dispose();
          inputCallsAtRevocation = h.app.input.setEnabled.mock.calls.length;
        }),
      );
      const pending = h.circuit();
      await h.finishCircuit();
      await pending;
      expect(h.emitted).toHaveBeenCalledOnce();
      expect(inputCallsAtRevocation).toBeGreaterThan(0);
      expect(h.app.input.setEnabled).toHaveBeenCalledTimes(inputCallsAtRevocation);
      expect(
        h.workers[0].postMessage.mock.calls.some(
          ([message]) => message.type === 'pause' && !message.value,
        ),
      ).toBe(false);
    },
  );

  it('does not release the departed worker after a session-start subscriber replaces the circuit', async () => {
    const h = fixture(),
      held = deferred<void>();
    let replacement: Promise<void> | null = null;
    let inputCallsAtReplacement = -1;
    const unsubscribe = gameEvents.on('session.started', (event) => {
      if (event.kind !== 'circuit') return;
      unsubscribe();
      h.app.audio.start.mockReturnValueOnce(held.promise);
      replacement = h.circuit();
      inputCallsAtReplacement = h.app.input.setEnabled.mock.calls.length;
    });
    unsubscribeEvents.push(unsubscribe);
    const pending = h.circuit();
    await h.finishCircuit();
    await pending;
    expect(h.app.generation).toBe(2);
    expect(h.app.state).toBe('loading');
    expect(h.app.circuitStartup?.pending).toBe(true);
    expect(h.app.input.setEnabled).toHaveBeenCalledTimes(inputCallsAtReplacement);
    expect(
      h.workers[0].postMessage.mock.calls.some(
        ([message]) => message.type === 'pause' && !message.value,
      ),
    ).toBe(false);
    h.app.dispose();
    await replacement;
    held.resolve();
  });

  it('does not unpause the circuit after launch focus disposal', async () => {
    const h = fixture();
    h.document.activeElement.blur.mockImplementationOnce(() => h.app.dispose());
    const pending = h.circuit();
    await h.finishCircuit();
    await pending;
    expect(h.app.disposed).toBe(true);
    expect(
      h.workers[0].postMessage.mock.calls.some(
        ([message]) => message.type === 'pause' && !message.value,
      ),
    ).toBe(false);
  });

  it.each(['exit', 'dispose'] as const)(
    'does not publish Festival readiness after launch focus %s',
    async (terminal) => {
      const h = fixture();
      h.document.activeElement.blur.mockImplementationOnce(() => {
        if (terminal === 'exit') h.app.exitFestival();
        else h.app.dispose();
      });
      const pending = h.festivalStart();
      await h.finishFestival();
      await pending;
      expect(h.app.festival).toBeNull();
      expect(h.festival.dispose).toHaveBeenCalledOnce();
      expect(h.app.beginDemoClock).not.toHaveBeenCalled();
      expect(h.emitted).not.toHaveBeenCalled();
    },
  );
});
