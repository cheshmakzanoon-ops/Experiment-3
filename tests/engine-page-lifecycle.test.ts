import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridPresentationClock } from '../src/core/grid-presentation.ts';
import { graphicsSettingsChanged, runSettingsChange, yieldBrowserTask } from '../src/core/settings-transition.ts';
import { InputPump } from '../src/input/pump.ts';
import { InputController } from '../src/input/controller.ts';
import { UiSounds, type UiSoundsOptions } from '../src/audio/ui-sounds.ts';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { ReplayClock } from '../src/session/replay-clock.ts';
import { SessionStartOwner } from '../src/session/session-start-owner.ts';
import { WorkerReadiness } from '../src/session/worker-readiness.ts';
import { FestivalControls } from '../src/session/festival-controls.ts';
import type { FestivalHost, FestivalStartOptions } from '../src/session/free-roam.ts';
import { controls, DEFAULT_OPTIONS, type Controls, type SessionOptions } from '../src/simulation/config.ts';
import { CAR_STRIDE, HEADER, H, F, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/storage/data.ts';
import { PauseHandshake, type ClientMessage, type WorkerMessage } from '../src/workers/diagnostics.ts';
import { FakeContext } from './fake-audio.ts';

/** Execute complete host methods and the actual registered page callbacks.
 * The two lazy imports and platform/rendering boundaries are the only replaced
 * code; production session owners, clocks, pause/input paths and transactions run. */
function productionHost() {
  const source = ts.createSourceFile('main.ts',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const owner = source.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'GameApp')!;
  const names = [
    'disposed', 'errorStopped', 'pageSuspended', 'pageEpoch', 'pageMenuRecovery', 'pageWaiters',
    'generation', 'rendererBuild', 'circuitStartup', 'initTimeout', 'worker', 'workerPause',
    'current', 'previous', 'savingSettings', 'timer', 'previousTime', 'renderedAt', 'renderedState',
    'flashbackPending', 'flashbackResumeEpoch', 'festivalOwner', 'festival', 'festivalStarting',
    'startFestival', 'exitFestival', 'start', 'switchCircuit', 'buildRenderer', 'resetMenuPresentation',
    'post', 'accept', 'prepareTimeTrial', 'applySettings', 'fail', 'dispose',
    'pageHide', 'pageShow', 'waitForPage', 'restorePageMenu', 'scheduleFrame', 'frame',
    'suspendPlayback', 'pause', 'resume', 'action', 'completeFlashback', 'exitReplay', 'replayFloor',
  ];
  const members = names.map((name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing GameApp.${name}`);
    return member.getText(source);
  });
  const registrations = owner.members.filter(ts.isConstructorDeclaration).flatMap((constructor) =>
    constructor.body!.statements.filter((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
      const call = statement.expression;
      return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'addEventListener' &&
        ts.isStringLiteral(call.arguments[0]) && ['pagehide', 'pageshow'].includes(call.arguments[0].text);
    }).map((statement) => statement.getText(source)));
  expect(registrations).toHaveLength(2);
  const pumps: ts.BinaryExpression[] = [];
  function findPump(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.left.getText(source) === 'this.inputPump' &&
      ts.isNewExpression(node.right)) pumps.push(node);
    ts.forEachChild(node, findPump);
  }
  findPump(owner);
  expect(pumps).toHaveLength(1);
  return ts.transpileModule(`class Host { ${members.join('\n')}
    install() { ${registrations.join('\n')} ${pumps[0].getText(source)}; }
  }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    transformers: { before: [(context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const path = node.arguments[0];
          if (!ts.isStringLiteral(path)) throw new Error('Expected a literal module boundary');
          const loader = path.text === './session/free-roam.ts' ? 'loadFestivalModule'
            : path.text === './workers/physics.worker.ts?worker&inline' ? 'loadPhysicsWorker' : null;
          if (!loader) throw new Error(`Unexpected startup import: ${path.text}`);
          return ts.factory.createCallExpression(ts.factory.createIdentifier(loader), undefined, []);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    }] },
  }).outputText;
}
const code = productionHost();

/** Actual retained Festival pause/travel methods, with its real control owner.
 * Rendering and worker transport remain observable boundaries of this fixture. */
function productionFestival() {
  const source = ts.createSourceFile('free-roam.ts',
    readFileSync(new URL('../src/session/free-roam.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const owner = source.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'FestivalSession')!;
  const names = ['disposed', 'pageSuspended', 'pageEpoch', 'lastTime', 'travelling',
    'post', 'input', 'travel', 'setPaused', 'setPageSuspended', 'isPaused', 'drivingInputEnabled'];
  return ts.transpileModule(`class Festival { ${names.map((name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing FestivalSession.${name}`);
    return member.getText(source);
  }).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
const festivalCode = productionFestival();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function snapshot(tick = 0) {
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.TICK] = tick;
  frame[H.TIME] = tick / 120;
  return frame;
}
class CircuitWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn((_message: ClientMessage, _transfer?: Transferable[]) => {});
  terminate = vi.fn();
  frame(tick = 0) {
    const frame = snapshot(tick);
    this.onmessage?.({ data: { type: 'frame', buffer: frame.buffer } } as MessageEvent<WorkerMessage>);
  }
}
class Replay {
  duration = 20;
  recordSurface = vi.fn();
  makeFrame = () => snapshot();
  sample = vi.fn(() => 0);
  truncate = vi.fn();
  surfaceState = { water: new Float32Array(), time: 0 };
  dispose = vi.fn(async () => {});
}
interface Festival {
  pageSuspended: boolean;
  pageEpoch: number;
  lastTime: number;
  travelling: boolean;
  readonly drivingInputEnabled: boolean;
  readonly isPaused: boolean;
  input(sample: Controls): void;
  setPaused(value: boolean): void;
  setPageSuspended(value: boolean): void;
  travel(id: string, retry?: boolean): Promise<void>;
  frame: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
interface Host {
  state: string;
  generation: number;
  disposed: boolean;
  errorStopped: boolean;
  pageSuspended: boolean;
  pageMenuRecovery: boolean;
  pageEpoch: number;
  previousTime: number;
  timer: number | null;
  flashbackPending: boolean;
  flashbackResumeEpoch: number;
  circuitStartup: WorkerReadiness | null;
  worker: CircuitWorker | null;
  current: Float32Array | null;
  previous: Float32Array | null;
  replay: Replay | null;
  inputPump: InputPump;
  festivalOwner: SessionStartOwner<Festival>;
  readonly festival: Festival | null;
  readonly festivalStarting: boolean;
  savingSettings: boolean;
  install(): void;
  start(options: SessionOptions): Promise<void>;
  startFestival(options: SessionOptions): Promise<void>;
  applySettings(settings: Settings): Promise<void>;
  scheduleFrame(): void;
  frame(time: number): void;
  resume(): void;
  action(name: string): void;
  completeFlashback(time: number): void;
  waitForPage(): Promise<boolean>;
  fail(error: unknown): void;
  dispose(): void;
}
const hosts: Host[] = [];
const festivalControls: FestivalControls[] = [];

function fixture(firstFrameId = 1) {
  const window = Object.assign(new EventTarget(), { setTimeout });
  const screen = { hidden: true, setAttribute: vi.fn(), textContent: '', max: '', min: '', value: '' };
  const submit = { disabled: false, textContent: '' };
  const form = {
    isConnected: true, setAttribute: vi.fn(), removeAttribute: vi.fn(), querySelector: () => submit,
  };
  const document = {
    hidden: false, activeElement: { blur: vi.fn() }, pointerLockElement: null,
    exitPointerLock: vi.fn(), querySelector: (selector: string) => selector === '#settingsForm' ? form
      : selector === '#modal [data-action="resume"]' ? {} : null,
    getElementById: () => ({}), documentElement: { style: { setProperty: vi.fn() }, dataset: {} },
  };
  const frames = new Map<number, FrameRequestCallback>();
  const queued = new Map<number, FrameRequestCallback>();
  let serial = firstFrameId;
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = serial++;
    frames.set(id, callback);
    queued.set(id, callback);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id));
  const workers: CircuitWorker[] = [];
  class PhysicsWorker extends CircuitWorker {
    constructor() { super(); workers.push(this); }
  }
  const loadPhysicsWorker = vi.fn(async () => ({ default: PhysicsWorker }));
  const preparing = deferred<Festival>();
  const createFestival = vi.fn((_host: FestivalHost, _options: FestivalStartOptions) => preparing.promise);
  const module = { FestivalSession: { start: createFestival }, FESTIVAL_SAVE_KEY: 'festival' };
  const imported = deferred<typeof module>();
  const loadFestivalModule = vi.fn(() => imported.promise);
  const renderer = () => ({
    renderer: {}, lighting: 'day', canPrepareGrid: () => true,
    dispose: vi.fn(), reset: vi.fn(), gridPerformance: { reset: vi.fn() },
    setPhoto: vi.fn(), circuit: {}, prepare: vi.fn(async () => true),
    prepareQuality: vi.fn(async () => true), setQuality: vi.fn(), setLivery: vi.fn(),
    setGhost: vi.fn(), changeCamera: vi.fn(), canSubmitFrame: () => true,
    setSafetyCar: vi.fn(), draw: vi.fn(), setBroadcastFollow: vi.fn(),
    presented: { value: snapshot() }, audioView: { value: {} },
    guide: { mesh: { count: 0 }, cue: '', targetSpeed: 0 }, gridShot: { caption: '' },
  });
  const createRenderer = vi.fn(async () => renderer());
  const reload = vi.fn();
  const dependencies = {
    WorkerReadiness, SessionStartOwner, PauseHandshake, InputPump, H, F, R, RACE_BASE, carBase, controls,
    loadPhysicsWorker, loadFestivalModule, graphicsSettingsChanged, runSettingsChange, yieldBrowserTask,
    RacingRenderer: { create: createRenderer },
    demoSessionLock: () => null, t: (value: string) => value,
    circuitDefinition: (id = 'aurel') => ({ id, name: id }),
    gpGridForVehicles: () => false, validateOptions: (options: SessionOptions) => options,
    resolveLighting: () => 'day', sessionLight: () => 'day', systemReducedMotion: () => false,
    rulesetFor: () => ({ service: { pitStops: false } }), racingSession: () => false,
    rumbleFrom: () => ({ weak: 0, strong: 0 }), emitSessionStarted: vi.fn(),
    SessionReplay: Replay, TelemetryRecorder: class {},
    Track: class {
      cold = false;
      water = new Float32Array(1); rubber = new Float32Array(1); marbles = new Float32Array(1);
      constructor(_weather: string, _ghost: boolean, _length: unknown, public circuit: { id: string }) {}
    },
    document, window, clearTimeout, requestAnimationFrame, cancelAnimationFrame, location: { reload },
    console: { error: vi.fn(), warn: vi.fn() }, navigator: { languages: ['en'] },
    currentLocale: () => 'en', resolveLocale: () => 'en', applyHudScale: vi.fn(),
    liveSkyPreferred: () => false,
    clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    shouldDrawMenu: () => true, shouldDrawReplay: () => true,
    shortTime: (value: number) => String(value), vehicleAt: () => ({ dynamicsKind: 'car' }),
    FLASHBACK: { perRace: 3, window: 30 },
  };
  const host = new Function(...Object.keys(dependencies), `${code}; return new Host();`)(
    ...Object.values(dependencies),
  ) as Host;
  const own = () => ({ dispose: vi.fn() });
  const app = Object.assign(host, {
    state: 'menu', canvas: {}, renderer: renderer() as ReturnType<typeof renderer> | null,
    track: { circuit: { id: 'aurel', name: 'Aurel' }, length: 1000 },
    settings: { ...structuredClone(DEFAULT_SETTINGS), quickStart: true },
    team: { livery: {} }, lightChoice: 'auto', options: { ...DEFAULT_OPTIONS },
    meetings: { sessionStarting: vi.fn() }, gridClock: new GridPresentationClock(),
    gridAutomatic: false, gridPanel: { update: vi.fn(), caption: vi.fn(), hide: vi.fn() },
    programme: { start: vi.fn(), stop: vi.fn(), observe: vi.fn(), running: false },
    photoStudio: { close: vi.fn() },
    career: {
      begin: vi.fn(), beginFestival: vi.fn(), endFestival: vi.fn(), sessionSetup: () => null,
      observe: vi.fn(), attackFinished: () => null, hudText: () => '',
    },
    radio: { reset: vi.fn(), observe: () => null }, radioCaption: { show: vi.fn() },
    ui: {
      dispose: vi.fn(), toast: vi.fn(), error: vi.fn(), loading: vi.fn(() => { screen.hidden = false; }),
      loadingSession: vi.fn(), loadingScene: vi.fn(), closeModal: vi.fn(), showMode: vi.fn(),
      ready: vi.fn(() => { screen.hidden = true; }), observePractice: vi.fn(), applyBindings: vi.fn(),
      get: vi.fn(() => screen), modal: { open: false }, telemetryModal: { close: vi.fn(), open: false },
      pause: vi.fn(), setText: vi.fn(), setTrack: vi.fn(), update: vi.fn(),
    },
    input: {
      suspendForPage: vi.fn(() => app.input.setEnabled(false)),
      setEnabled: vi.fn(), activePad: () => null, dispose: vi.fn(),
      pollActions: vi.fn(), update: vi.fn(() => ({ ...controls(), throttle: 0.5 })),
    },
    audio: {
      start: vi.fn(async () => {}), stop: vi.fn(), dispose: vi.fn(async () => {}),
      update: vi.fn(), configureDriving: vi.fn(), locked: false,
    },
    applyLight: vi.fn(), applyMotion: vi.fn(), applyAudio: vi.fn(), applyCommunication: vi.fn(),
    store: { write: vi.fn(async () => {}) }, previewSelectedMachine: vi.fn(),
    selectedMachinePreview: vi.fn(() => snapshot()),
    exporter: { cancel: vi.fn() }, liveFrames: new LiveFrameClock(),
    liveSky: { active: false },
    records: { prepare: vi.fn(async () => {}), observe: vi.fn(), trial: null },
    referenceSession: { ...own(), interrupt: vi.fn(), beginSession: () => null, sample: vi.fn() },
    observeSession: vi.fn(), openRaceBriefing: vi.fn(), presentGhost: vi.fn(),
    rumble: { stop: vi.fn(), update: vi.fn() }, sessionReview: { stop: vi.fn(), event: vi.fn() },
    tabEvidence: { ...own(), observe: vi.fn() }, performanceCapture: { interrupt: vi.fn(), active: false },
    interruptReview: vi.fn(), beginDemoClock: vi.fn(), endDemoClock: vi.fn(), tickDemoClock: vi.fn(),
    reviewVideo: own(),
    menuFrames: { ...own(), suspend: vi.fn(), reset: vi.fn(), poll: () => 'ready', submittedFrame: vi.fn() },
    menuPreviewReceipt: {
      ...own(), request: vi.fn(), reset: vi.fn(), observe: vi.fn(), submittedFrame: vi.fn(), revision: 1,
    },
    menuPreviewView: {}, uiSounds: { ...own(), suspend: vi.fn() }, presentationReview: { active: false },
    replayHud: { update: vi.fn() }, replayClock: new ReplayClock(), replayA: snapshot(), replayB: snapshot(),
    replayReturn: 'paused', flashbacks: 0, flashbackPanel: { show: vi.fn() },
  });
  app.current = app.previous = snapshot();
  app.liveFrames.observe(app.current, performance.now());
  app.install();
  app.inputPump.start();
  app.scheduleFrame();
  hosts.push(app);
  const transition = (type: 'pagehide' | 'pageshow', persisted: boolean) =>
    window.dispatchEvent(Object.assign(new Event(type), { persisted }));
  const frame = (time: number) => {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    callback(time);
  };
  const circuitOptions = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0 };
  const festivalOptions = { ...DEFAULT_OPTIONS, mode: 'festival' as SessionOptions['mode'] };
  return {
    app, window, document, submit, screen, frames, queued, frame, transition, workers,
    requestAnimationFrame, cancelAnimationFrame, createRenderer, renderer, reload,
    imported, preparing, module, createFestival, loadPhysicsWorker, loadFestivalModule,
    circuit: () => app.start(circuitOptions).catch((error) => app.fail(error)),
    festivalStart: () => app.startFestival(festivalOptions).catch((error) => app.fail(error)),
    async finishCircuit() {
      await flush();
      expect(workers).toHaveLength(1);
      workers[0].frame();
      await flush();
    },
  };
}

function festivalFixture(app: ReturnType<typeof fixture>['app']) {
  const command = deferred<void>();
  const worker = { postMessage: vi.fn() };
  const menus = {
    menuOpen: false, mapOpen: false, resultsOpen: false, cardOpen: false,
    showMenu: vi.fn(), showMap: vi.fn(), hideResults: vi.fn(),
  };
  const host = { loading: vi.fn(), loaded: vi.fn(), toast: vi.fn(), audio: app.audio };
  const construct = new Function('controls', 'isRace', `${festivalCode}; return new Festival();`);
  const session = Object.assign(construct(controls, () => false) as Festival, {
    worker, host, hud: menus, renderer: { ready: () => true },
    events: [{ spec: { id: 'event', name: 'Event' }, marker: { x: 0, z: 0 } }],
    liveFrames: new LiveFrameClock(), lifetime: { check: vi.fn() },
    commandAndWait: vi.fn(() => command.promise), frame: vi.fn(), dispose: vi.fn(),
  });
  const owner = new FestivalControls(menus, {
    pause: (value) => {
      const transport = session as unknown as { post(message: { type: 'pause'; value: boolean }): void };
      transport.post({ type: 'pause', value });
    },
    driving: (value) => app.input.setEnabled(value && !app.pageSuspended),
    menuState: () => ({}) as never, card: () => null, start: vi.fn(), continue: vi.fn(),
  });
  Object.assign(session, { controls: owner });
  festivalControls.push(owner);
  return { session, owner, worker, command, host };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  for (const owner of festivalControls.splice(0)) owner.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('retained page lifecycle through the production host', () => {
  it('owns RAF identifier zero across repeated scheduling, hide and restoration', () => {
    const h = fixture(0);
    const oldFrame = h.queued.get(0)!;
    expect(h.app.timer).toBe(0);
    h.app.scheduleFrame();
    h.app.scheduleFrame();
    h.transition('pageshow', true);
    expect(h.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(1);
    h.transition('pagehide', true);
    expect(h.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(0);
    expect(h.app.timer).toBeNull();
    expect(h.frames.size).toBe(0);
    oldFrame(1000);
    h.app.scheduleFrame();
    expect(h.requestAnimationFrame).toHaveBeenCalledOnce();
    h.transition('pageshow', true);
    const restoredTimer = h.app.timer;
    expect(restoredTimer).not.toBeNull();
    h.app.scheduleFrame();
    h.transition('pageshow', true);
    oldFrame(2000);
    expect(h.app.timer).toBe(restoredTimer);
    expect(h.requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(h.frames.size).toBe(1);
    h.frame(3000);
    expect(h.requestAnimationFrame).toHaveBeenCalledTimes(3);
    expect(h.frames.size).toBe(1);
  });

  it('cancels RAF identifier zero once on terminal teardown', () => {
    const h = fixture(0);
    const oldFrame = h.queued.get(0)!;
    h.transition('pagehide', false);
    h.app.dispose();
    oldFrame(1000);
    h.app.scheduleFrame();
    expect(h.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(0);
    expect(h.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(h.app.timer).toBeNull();
    expect(h.frames.size).toBe(0);
  });

  it('retains a moving circuit paused, neutral and silent, with one fresh RAF/input owner', async () => {
    const h = fixture();
    const start = h.circuit();
    await h.finishCircuit();
    await start;
    const worker = h.workers[0], renderer = h.app.renderer!;
    const oldFrame = h.queued.get(h.app.timer!)!;
    const generation = h.app.generation;
    h.app.previousTime = 1200;
    h.app.input.update.mockClear();
    h.transition('pagehide', true);
    expect(h.app.disposed).toBe(false);
    expect(h.app.state).toBe('paused');
    expect(h.app.generation).toBe(generation);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(h.app.ui.pause).toHaveBeenCalledOnce();
    expect(h.app.audio.stop).toHaveBeenCalled();
    expect(h.app.input.setEnabled).toHaveBeenLastCalledWith(false);
    expect(worker.postMessage.mock.calls.at(-2)![0]).toEqual({ type: 'input', input: controls() });
    expect(worker.postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'pause', value: true });
    expect(h.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const messages = worker.postMessage.mock.calls.length;
    oldFrame(1_000_000);
    h.app.frame(1_000_000);
    h.app.inputPump.poll();
    h.app.resume();
    h.app.action('resume');
    await h.circuit();
    await h.festivalStart();
    expect(worker.postMessage).toHaveBeenCalledTimes(messages);
    expect(h.loadPhysicsWorker).toHaveBeenCalledOnce();
    expect(h.loadFestivalModule).not.toHaveBeenCalled();
    expect(h.app.input.update).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
    // The retained worker still delivers its authoritative pause snapshot.
    worker.frame(123);
    expect(h.app.current![H.TICK]).toBe(123);
    h.transition('pageshow', true);
    h.transition('pageshow', true);
    expect(h.app.state).toBe('paused');
    expect(h.app.previousTime).toBe(0);
    expect(h.frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    oldFrame(2_000_000); // A cancelled callback delivered after restoration.
    expect(h.frames.size).toBe(1);
    h.frame(2_000_000);
    expect(renderer.draw.mock.calls.at(-1)![6]).toBeCloseTo(0.016);
    expect(h.frames.size).toBe(1);
    expect(worker.postMessage.mock.calls.filter(([m]) => m.type === 'pause' && !m.value)).toHaveLength(1);
    h.app.resume();
    expect(h.app.state).toBe('driving');
    expect(worker.postMessage.mock.calls.at(-2)![0]).toEqual({ type: 'input', input: controls() });
    expect(worker.postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'pause', value: false });
  });

  it.each(['menu', 'paused', 'replay', 'pregame', 'results', 'photo'] as const)(
    'restores %s without playback, grid catch-up or automatic driving', (state) => {
      const h = fixture();
      h.app.state = state;
      h.app.replay = new Replay();
      h.app.replayClock.position = 7;
      h.app.replayClock.playing = true;
      h.app.gridClock.seek(38);
      h.app.gridAutomatic = true;
      h.app.previousTime = 500;
      h.transition('pageshow', false);
      expect(h.frames.size).toBe(1);
      h.transition('pagehide', true);
      const epoch = h.app.pageEpoch;
      h.transition('pagehide', true);
      expect(h.app.pageEpoch).toBe(epoch);
      h.transition('pageshow', true);
      expect(h.app.state).toBe(state);
      expect(h.app.gridAutomatic).toBe(false);
      h.frame(500_000);
      expect(h.app.renderer!.draw.mock.calls.at(-1)![6]).toBeCloseTo(0.016);
      expect(h.app.gridClock.time).toBe(38);
      expect(h.app.gridClock.playing).toBe(false);
      if (state === 'replay') {
        expect(h.app.replayClock.playing).toBe(false);
        expect(h.app.replayClock.position).toBe(7);
        expect(h.app.replay.sample).toHaveBeenCalledWith(7, h.app.replayA, h.app.replayB);
      }
      expect(h.app.audio.update.mock.calls.at(-1)![2]).toBe(false);
      expect(h.frames.size).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it.each(['import', 'preparation'] as const)('revokes Festival %s and suppresses its late host callbacks', async (stage) => {
    const h = fixture();
    const pending = h.festivalStart();
    if (stage === 'preparation') {
      h.imported.resolve(h.module);
      await flush();
    }
    h.transition('pagehide', true);
    expect(h.app.festivalStarting).toBe(false);
    h.transition('pageshow', true);
    await flush();
    const enabled = h.app.input.setEnabled.mock.calls.length;
    const audioStarts = h.app.audio.start.mock.calls.length;
    if (stage === 'import') h.imported.resolve(h.module);
    else {
      const borrowed = h.createFestival.mock.calls[0][0];
      expect(h.createFestival.mock.calls[0][1].signal!.aborted).toBe(true);
      borrowed.loaded();
      borrowed.driving?.(true);
      await borrowed.audio!.start();
      h.preparing.resolve({ dispose: vi.fn() } as unknown as Festival);
    }
    await pending;
    expect(h.app.state).toBe('menu');
    expect(h.app.pageMenuRecovery).toBe(false);
    expect(h.app.input.setEnabled).toHaveBeenCalledTimes(enabled);
    expect(h.app.audio.start).toHaveBeenCalledTimes(audioStarts);
    expect(h.app.festival).toBeNull();
    expect(h.app.ui.error).not.toHaveBeenCalled();
    if (stage === 'import') expect(h.createFestival).not.toHaveBeenCalled();
  });

  it.each(['audio', 'module', 'worker', 'graphics', 'records'] as const)(
    'settles a pending circuit at %s and keeps its late completion from reviving driving', async (stage) => {
      const h = fixture(), held = deferred<void>(), ready = deferred<boolean>();
      if (stage === 'audio') h.app.audio.start.mockReturnValue(held.promise);
      if (stage === 'module') {
        const load = h.loadPhysicsWorker.getMockImplementation()!;
        h.loadPhysicsWorker.mockImplementation(async () => { await held.promise; return load(); });
      }
      if (stage === 'graphics') h.app.renderer!.prepare.mockReturnValue(ready.promise);
      if (stage === 'records') h.app.records.prepare.mockReturnValue(held.promise);
      const pending = h.circuit();
      await flush();
      if (stage === 'graphics' || stage === 'records') {
        h.workers[0].frame();
        await flush();
      }
      h.transition('pagehide', true);
      await pending;
      const existing = h.workers[0];
      expect(h.app.circuitStartup).toBeNull();
      expect(h.app.worker).toBeNull();
      expect(h.frames.size).toBe(0);
      if (existing) expect(existing.terminate).toHaveBeenCalledOnce();
      h.transition('pageshow', true);
      await flush();
      held.resolve();
      ready.resolve(true);
      existing?.frame();
      await flush();
      expect(h.app.state).toBe('menu');
      expect(h.app.pageMenuRecovery).toBe(false);
      expect(h.app.input.setEnabled).not.toHaveBeenCalledWith(true);
      expect(h.app.ui.error).not.toHaveBeenCalled();
      expect(h.workers).toHaveLength(stage === 'audio' || stage === 'module' ? 0 : 1);
    },
  );

  it('rebuilds a cancelled circuit candidate on return without adopting the old renderer', async () => {
    const h = fixture(), build = deferred<ReturnType<typeof h.renderer>>();
    h.app.renderer!.canPrepareGrid = () => false;
    h.createRenderer.mockReturnValueOnce(build.promise);
    const pending = h.circuit();
    await flush();
    // switchCircuit's task yields beside the application's owned animation.
    h.frame(16);
    h.frame(32);
    await flush();
    expect(h.createRenderer).toHaveBeenCalledOnce();
    expect(h.app.renderer).toBeNull();
    h.transition('pagehide', true);
    await pending;
    expect(h.createRenderer).toHaveBeenCalledOnce();
    h.transition('pageshow', true);
    await flush();
    expect(h.createRenderer).toHaveBeenCalledTimes(2);
    const replacement = h.app.renderer;
    const stale = h.renderer();
    build.resolve(stale);
    await flush();
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(h.app.renderer).toBe(replacement);
    expect(h.app.state).toBe('menu');
    expect(h.workers).toHaveLength(0);
  });

  it.each(['preparing', 'saving'] as const)('does not close an editor or resume on late settings %s', async (stage) => {
    const h = fixture(), held = deferred<void>(), prepared = deferred<boolean>();
    h.app.state = 'paused';
    h.app.ui.modal.open = true;
    const settings = structuredClone(h.app.settings);
    settings.quality = 'low';
    if (stage === 'preparing') h.app.renderer!.prepareQuality.mockReturnValue(prepared.promise);
    else h.app.store.write.mockReturnValue(held.promise);
    const pending = h.app.applySettings(settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.app.savingSettings).toBe(true);
    h.transition('pagehide', true);
    h.transition('pageshow', true);
    prepared.resolve(true);
    held.resolve();
    await pending;
    expect(h.app.savingSettings).toBe(false);
    expect(h.app.state).toBe('paused');
    expect(h.app.ui.modal.open).toBe(true);
    expect(h.app.ui.closeModal).not.toHaveBeenCalled();
    expect(h.app.ui.toast).not.toHaveBeenCalled();
    expect(h.app.input.setEnabled).not.toHaveBeenCalledWith(true);
    expect(h.submit.disabled).toBe(false);
    expect(h.app.ui.error).not.toHaveBeenCalled();
  });

  it('keeps the recovery reload action available when restoring a cancelled renderer fails', async () => {
    const h = fixture();
    const held = deferred<void>();
    h.app.audio.start.mockReturnValue(held.promise);
    const pending = h.circuit();
    h.transition('pagehide', true);
    await pending;
    h.app.renderer = null;
    h.createRenderer.mockRejectedValue(new Error('Restored graphics unavailable'));
    h.transition('pageshow', true);
    await flush();
    expect(h.app.errorStopped).toBe(true);
    expect(h.app.ui.error).toHaveBeenCalledWith('Restored graphics unavailable');
    h.app.action('resume');
    expect(h.app.state).toBe('loading');
    h.app.action('reload');
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('retains Festival paused and suppresses a travel resume completed after pageshow', async () => {
    const h = fixture(), festival = festivalFixture(h.app);
    await h.app.festivalOwner.start({
      load: async () => undefined, create: async () => festival.session,
      ready: vi.fn(), failed: vi.fn(),
    });
    festival.session.lastTime = 500;
    const travel = festival.session.travel('event');
    h.transition('pagehide', true);
    expect(festival.session.isPaused).toBe(true);
    expect(festival.session.drivingInputEnabled).toBe(false);
    expect(festival.session.lastTime).toBe(0);
    expect(festival.session.dispose).not.toHaveBeenCalled();
    const posts = festival.worker.postMessage.mock.calls.length;
    festival.session.input({ ...controls(), throttle: 1 });
    festival.session.setPaused(false);
    expect(festival.worker.postMessage.mock.calls.slice(posts).every(([m]) => m.type === 'pause' && m.value)).toBe(true);
    h.transition('pageshow', true);
    festival.command.resolve();
    await travel;
    expect(festival.session.isPaused).toBe(true);
    expect(festival.session.drivingInputEnabled).toBe(false);
    expect(festival.worker.postMessage.mock.calls.some(([m]) => m.type === 'pause' && !m.value)).toBe(false);
    h.frame(1_000_000);
    expect(festival.session.frame).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(1);
    festival.session.setPaused(false); // A fresh explicit action may resume.
    expect(festival.session.drivingInputEnabled).toBe(true);
  });

  it('revokes an in-flight flashback automatic resume even after pageshow', () => {
    const h = fixture();
    h.app.state = 'replay';
    h.app.replay = new Replay();
    h.app.flashbackPending = true;
    h.app.flashbackResumeEpoch = h.app.pageEpoch;
    h.transition('pagehide', true);
    h.transition('pageshow', true);
    h.app.completeFlashback(7);
    expect(h.app.state).toBe('paused');
    expect(h.app.replay.truncate).toHaveBeenCalledWith(7);
    expect(h.app.input.setEnabled).not.toHaveBeenCalledWith(true);
  });

  it('baselines a held real controller pause button even when pageshow precedes visibility restoration', () => {
    const h = fixture();
    const document = Object.assign(new EventTarget(), { hidden: false });
    const pad = {
      id: 'Retained controller', index: 0, mapping: 'standard', connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    vi.stubGlobal('window', h.window);
    vi.stubGlobal('document', document);
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const actions: string[] = [];
    const input = new InputController(h.app.settings, (name) => {
      actions.push(name);
      if (name === 'pause') h.app.resume();
    });
    Object.assign(h.app, { input });
    h.app.state = 'driving';
    input.setEnabled(true);
    input.update(0.016);
    h.window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
    expect(input.update(0.016).throttle).toBe(1);
    h.transition('pagehide', true);
    expect(input.state).toEqual(controls());
    document.hidden = true;
    pad.buttons[9] = { pressed: true, touched: true, value: 1 };
    h.transition('pageshow', true);
    h.app.inputPump.poll();
    document.hidden = false;
    h.app.inputPump.poll();
    expect(actions).toEqual([]);
    expect(h.app.state).toBe('paused');
    expect(input.state).toEqual(controls());
    pad.buttons[9] = { pressed: false, touched: false, value: 0 };
    h.app.inputPump.poll();
    pad.buttons[9] = { pressed: true, touched: true, value: 1 };
    h.app.inputPump.poll();
    expect(actions).toEqual(['pause']);
    expect(h.app.state).toBe('driving');
    h.app.inputPump.poll();
    expect(actions).toEqual(['pause']);
  });

  it.each(['audible', 'pending activation'] as const)(
    'cancels %s menu cues without disposing their reusable owner', async (state) => {
      const h = fixture();
      class Context extends FakeContext {
        resume = vi.fn(async () => { this.state = 'running'; });
        close = vi.fn(async () => { this.state = 'closed'; });
      }
      const contexts: Context[] = [], pending = deferred<void>();
      class Sounds extends UiSounds {
        constructor(options: UiSoundsOptions) {
          super({
            ...options, target: h.window, activated: () => true,
            createContext: () => {
              const context = new Context();
              if (!contexts.length && state === 'pending activation') {
                context.state = 'suspended';
                context.resume.mockImplementation(async () => {
                  await pending.promise;
                  context.state = 'running';
                });
              }
              contexts.push(context);
              return context as unknown as AudioContext;
            },
          });
        }
      }
      const source = ts.createSourceFile('main.ts',
        readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
      const owner = source.statements.find((node): node is ts.ClassDeclaration =>
        ts.isClassDeclaration(node) && node.name?.text === 'GameApp')!;
      const field = owner.members.find((node): node is ts.PropertyDeclaration =>
        ts.isPropertyDeclaration(node) && node.name.getText(source) === 'uiSounds')!;
      const create = new Function('UiSounds', `return function () { return ${field.initializer!.getText(source)}; };`)(Sounds);
      const sounds = create.call(h.app) as UiSounds;
      Object.assign(h.app, { uiSounds: sounds });
      expect(sounds.cue('confirm')).toBe(state === 'audible');
      const context = contexts[0];
      const voices = context.nodes.filter((node) => node.kind === 'oscillator' || node.kind === 'source');
      h.transition('pagehide', true);
      expect(context.close).toHaveBeenCalledOnce();
      for (const voice of voices) {
        expect(voice.stopped.at(-1)).toBeUndefined();
        expect(voice.onended).toBeNull();
      }
      expect(context.nodes.every((node) => node.outputs.length === 0)).toBe(true);
      expect(sounds.cue('confirm')).toBe(false);
      h.transition('pageshow', true);
      pending.resolve();
      await flush();
      expect(contexts).toHaveLength(1);
      expect(sounds.played).toBe(state === 'audible' ? 1 : 0);
      expect(sounds.cue('confirm')).toBe(true);
      expect(contexts).toHaveLength(2);
      expect(context.close).toHaveBeenCalledOnce();
    },
  );

  it('releases a deferred initial-load gate only on restore or terminal disposal', async () => {
    const h = fixture();
    h.transition('pagehide', true);
    const resumed = vi.fn();
    const pending = h.app.waitForPage().then(resumed);
    await flush();
    expect(resumed).not.toHaveBeenCalled();
    h.transition('pageshow', false);
    await flush();
    expect(resumed).not.toHaveBeenCalled();
    h.transition('pageshow', true);
    await pending;
    expect(resumed).toHaveBeenCalledWith(true);
    h.transition('pagehide', true);
    const closed = h.app.waitForPage();
    h.transition('pagehide', false);
    await expect(closed).resolves.toBe(false);
  });

  it.each([false, true])('terminal hide disposes exactly once after retained navigation=%s', (retained) => {
    const h = fixture(), renderer = h.app.renderer!;
    const oldFrame = h.queued.get(h.app.timer!)!;
    if (retained) {
      h.transition('pagehide', true);
      h.transition('pageshow', true);
    }
    h.transition('pagehide', false);
    h.transition('pagehide', false);
    h.transition('pageshow', true);
    oldFrame(1_000_000);
    h.app.frame(1_000_000);
    expect(h.app.disposed).toBe(true);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(h.app.audio.dispose).toHaveBeenCalledOnce();
    expect(h.app.ui.dispose).toHaveBeenCalledOnce();
    expect(h.app.input.dispose).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
