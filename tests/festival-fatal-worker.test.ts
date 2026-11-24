import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FestivalHost, FestivalSession } from '../src/session/free-roam.ts';
import type { FestivalCommand } from '../src/simulation/open-world/session.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

interface WorkerDouble {
  onmessage: ((event: { data: FromOpenWorld }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: Mock<(message: ToOpenWorld, transfer?: Transferable[]) => void>;
  terminate: Mock<() => void>;
}

const doubles = vi.hoisted(() => {
  const state = {
    send: null as ((message: ToOpenWorld, transfer: Transferable[]) => void) | null,
    holdCommands: false,
  };
  function worker(simulation: boolean): WorkerDouble {
    return {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: vi.fn((message: ToOpenWorld, transfer: Transferable[] = []) => {
        if (simulation && !(state.holdCommands && message.type === 'command'))
          state.send?.(message, transfer);
      }),
      terminate: vi.fn(),
    };
  }
  return {
    state,
    worker,
    workers: [] as WorkerDouble[],
    tiles: [] as WorkerDouble[],
    renderer: vi.fn(),
    traffic: vi.fn(),
    riders: vi.fn(),
    hud: vi.fn(),
    observe: vi.fn(),
  };
});

// The real worker, simulation, session controller and controls run together.
// Only rendering, persistent assets and the browser worker transport are doubled.
vi.mock('../src/core/lazy-data.ts', () => ({ loadLazyData: async () => undefined }));
vi.mock('../src/rendering/ground/scan-store.ts', () => ({ scannedGround: { enabled: false } }));
vi.mock('../src/rendering/open-world/festival-renderer.ts', () => ({ FestivalRenderer: doubles.renderer }));
vi.mock('../src/rendering/traffic-cars.ts', () => ({ TrafficCars: doubles.traffic }));
vi.mock('../src/rendering/festival-riders.ts', () => ({ FestivalRiders: doubles.riders }));
vi.mock('../src/ui/festival-hud.ts', () => ({ FestivalHud: doubles.hud }));
vi.mock('../src/ui/festival-map.ts', () => ({ minimapHeading: vi.fn() }));
vi.mock('../src/steam/events.ts', () => ({ emitGameEvent: vi.fn() }));
vi.mock('../src/steam/hooks.ts', () => ({
  FestivalStatusObserver: class { observe = doubles.observe; },
}));
vi.mock('../src/workers/open-world.worker.ts?worker&inline', () => ({
  default: class {
    constructor() {
      const worker = doubles.worker(true);
      doubles.workers.push(worker);
      return worker;
    }
  },
}));
vi.mock('../src/workers/open-world-tiles.worker.ts?worker&inline', () => ({
  default: class {
    constructor() {
      const worker = doubles.worker(false);
      doubles.tiles.push(worker);
      return worker;
    }
  },
}));

function hostDouble() {
  return {
    canvas: new EventTarget() as HTMLCanvasElement,
    renderer: {} as FestivalHost['renderer'],
    element: {} as HTMLElement,
    quality: 'low' as const,
    graphics: {} as FestivalHost['graphics'],
    lighting: 'day' as const,
    loading: vi.fn(),
    loaded: vi.fn(),
    toast: vi.fn(),
    exit: vi.fn(),
    driving: vi.fn(),
    onResult: vi.fn(),
    audio: { start: vi.fn(async () => undefined), stop: vi.fn(), update: vi.fn() },
  };
}

function rendererDouble() {
  return {
    cars: { bodies: { setPlayerLivery: vi.fn() } },
    scene: { add: vi.fn() },
    discovered: new Set<string>(),
    setQuality: vi.fn(),
    loadPhotoVegetation: vi.fn(async () => false),
    loadAuthoredDetails: vi.fn(async () => false),
    loadStreetDetails: vi.fn(async () => false),
    registerVehicleRoot: vi.fn(),
    ready: vi.fn(() => true),
    prestream: vi.fn(),
    photoSky: { enabled: false },
    prepareGpu: vi.fn(async () => true),
    dispose: vi.fn(),
    mode: 'cockpit',
    photo: false,
    lighting: 'day',
  };
}

let renderer: ReturnType<typeof rendererDouble>;
let hud: { dispose: Mock; showMenu: Mock; showMap: Mock; menuOpen: boolean; mapOpen: boolean; resultsOpen: boolean };
const cancellations: AbortController[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  doubles.state.send = null;
  doubles.state.holdCommands = false;
  doubles.workers.length = doubles.tiles.length = 0;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  renderer = rendererDouble();
  hud = { dispose: vi.fn(), showMenu: vi.fn(), showMap: vi.fn(), menuOpen: false, mapOpen: false, resultsOpen: false };
  doubles.renderer.mockImplementation(function () { return renderer; });
  doubles.hud.mockImplementation(function () { return hud; });
  doubles.traffic.mockImplementation(function () { return { root: {}, dispose: vi.fn() }; });
  doubles.riders.mockImplementation(function () { return { root: {}, shells: { install() {} }, dispose: vi.fn() }; });
});

afterEach(async () => {
  for (const cancellation of cancellations.splice(0)) cancellation.abort();
  await vi.advanceTimersByTimeAsync(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const runtime = {
  now: 0,
  pump: undefined as (() => void) | undefined,
  failedPost: null as FromOpenWorld['type'] | null,
  messages: [] as FromOpenWorld[],
};
const scope = {
  onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
  postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
    if (message.type === runtime.failedPost) {
      runtime.failedPost = null;
      throw new Error(`Injected ${message.type} transport failure`);
    }
    const received = structuredClone(message, { transfer });
    runtime.messages.push(received);
    const receiver = doubles.workers[0]?.onmessage;
    if (receiver) queueMicrotask(() => receiver({ data: received }));
  },
};

/** Execute the actual worker module with real transfer detachment. Outbound
 * messages reach the real FestivalSession receive callback on a later turn.
 * Each case initializes a fresh simulation through the existing init command;
 * keeping the module loaded avoids duplicating the authored world data graph. */
async function worker() {
  runtime.now = 0;
  runtime.failedPost = null;
  runtime.messages.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => runtime.now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    runtime.pump = callback;
    return 1;
  });
  const { OpenWorldSimulation } = await import('../src/simulation/open-world/session.ts');
  const steps = vi.spyOn(OpenWorldSimulation.prototype, 'step');
  const writes = vi.spyOn(OpenWorldSimulation.prototype, 'writeFrame');
  const statuses = vi.spyOn(OpenWorldSimulation.prototype, 'status');
  const placement = vi.spyOn(OpenWorldSimulation.prototype, 'placeAt');
  await import('../src/workers/open-world.worker.ts');
  const send = (message: ToOpenWorld, transfer: Transferable[] = []) =>
    scope.onmessage!({ data: structuredClone(message, { transfer }) });
  doubles.state.send = send;
  return {
    messages: runtime.messages,
    steps,
    writes,
    statuses,
    placement,
    send,
    init() {
      send({ type: 'init', options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 73021, traffic: false } });
    },
    advance(milliseconds: number) {
      runtime.now += milliseconds;
      runtime.pump!();
    },
    failPost(type: FromOpenWorld['type']) { runtime.failedPost = type; },
    errors() { return runtime.messages.filter((message) => message.type === 'error'); },
  };
}

async function start() {
  const { FestivalSession } = await import('../src/session/free-roam.ts');
  const host = hostDouble(), cancellation = new AbortController();
  cancellations.push(cancellation);
  const resolved = vi.fn(), rejected = vi.fn();
  let session: FestivalSession | undefined;
  const pending = FestivalSession.start(host, { signal: cancellation.signal, vehicle: 'tc1' });
  void pending.then((value) => { session = value; resolved(value); }, rejected);
  for (let i = 0; i < 60 && !resolved.mock.calls.length && !rejected.mock.calls.length; i++)
    await vi.advanceTimersByTimeAsync(20);
  expect(resolved.mock.calls.length + rejected.mock.calls.length).toBe(1);
  return { host, pending, resolved, rejected, session };
}

function commandWait(session: FestivalSession, command: FestivalCommand) {
  return (session as unknown as { commandAndWait(command: FestivalCommand): Promise<void> }).commandAndWait(command);
}

function expectReleased() {
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(hud.dispose).toHaveBeenCalledOnce();
  expect(doubles.workers[0].terminate).toHaveBeenCalledOnce();
  expect(doubles.tiles[0].terminate).toHaveBeenCalledOnce();
  expect(doubles.workers[0].onmessage).toBeNull();
  expect(doubles.workers[0].onerror).toBeNull();
  expect(doubles.workers[0].onmessageerror).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

describe('Festival worker failure classification', () => {
  it.each(['step', 'frame', 'status', 'transport'] as const)('marks an interval %s failure fatal and holds simulation until its host closes it', async (kind) => {
    const engine = await worker();
    engine.init();
    const failure = new Error(`Injected ${kind} failure`);
    if (kind === 'step') engine.steps.mockImplementationOnce(() => { throw failure; });
    if (kind === 'frame') engine.writes.mockImplementationOnce(() => { throw failure; });
    if (kind === 'status') engine.statuses.mockImplementationOnce(() => { throw failure; });
    if (kind === 'transport') engine.failPost('frame');
    engine.send({ type: 'pause', value: false });
    engine.advance(100);
    expect(engine.errors()).toHaveLength(1);
    expect(engine.errors()[0]).toMatchObject({ type: 'error', fatal: true, message: expect.stringContaining('Injected') });
    const steps = engine.steps.mock.calls.length, messages = engine.messages.length;
    engine.advance(1000);
    expect(engine.steps).toHaveBeenCalledTimes(steps);
    expect(engine.messages).toHaveLength(messages);
  });

  it.each(['frame', 'status', 'transport', 'receipt'] as const)('marks command %s publication failures fatal rather than returning a recoverable command error', async (kind) => {
    const engine = await worker();
    engine.init();
    if (kind === 'frame') engine.writes.mockImplementationOnce(() => { throw new Error('Frame failed'); });
    if (kind === 'status') engine.statuses.mockImplementationOnce(() => { throw new Error('Status failed'); });
    if (kind === 'transport') engine.failPost('frame');
    if (kind === 'receipt') engine.failPost('command-result');
    const before = engine.messages.length;
    engine.send({ type: 'command', command: { type: 'traffic', value: false }, requestId: 7 });
    const sent = engine.messages.slice(before);
    expect(sent.at(-1)).toMatchObject({ type: 'error', fatal: true });
    expect(sent.some((message) => message.type === 'command-result')).toBe(false);
  });

  it('promotes failed delivery of a recoverable command rejection to a fatal transport error', async () => {
    const engine = await worker();
    engine.init();
    engine.failPost('command-result');
    engine.send({ type: 'command', command: { type: 'start', event: 'unknown-event' }, requestId: 8 });
    expect(engine.errors()).toEqual([{ type: 'error', fatal: true, message: 'Injected command-result transport failure' }]);
  });
});

describe('Festival worker failures through the session receiver', () => {
  it.each(['construction', 'frame', 'status'] as const)('rejects startup once for an actual init %s failure and releases readiness ownership', async (kind) => {
    const engine = await worker();
    const fail = () => { throw new Error(`Init ${kind} failed`); };
    if (kind === 'construction') engine.placement.mockImplementationOnce(fail);
    if (kind === 'frame') engine.writes.mockImplementationOnce(fail);
    if (kind === 'status') engine.statuses.mockImplementationOnce(fail);
    const run = await start();
    expect(engine.errors()).toEqual([{ type: 'error', message: `Init ${kind} failed`, fatal: true }]);
    expect(run.rejected).toHaveBeenCalledExactlyOnceWith(new Error(`Init ${kind} failed`));
    expect(run.resolved).not.toHaveBeenCalled();
    expect(run.host.loaded).not.toHaveBeenCalled();
    expect(run.host.exit).not.toHaveBeenCalled();
    expect(run.host.audio.stop).toHaveBeenCalledOnce();
    expectReleased();
    engine.advance(30000);
    await vi.advanceTimersByTimeAsync(30000);
    expect(run.rejected).toHaveBeenCalledOnce();
    expect(run.host.toast).toHaveBeenCalledOnce();
    expectReleased();
  });

  it('closes the running host once for an actual step failure, rejects all pending commands and ignores queued work', async () => {
    const engine = await worker();
    const run = await start();
    const session = run.session!;
    expect(session.drivingInputEnabled).toBe(true);
    const receive = doubles.workers[0].onmessage!, nativeError = doubles.workers[0].onerror!;
    const messageError = doubles.workers[0].onmessageerror!;
    doubles.state.holdCommands = true;
    const rejected = [vi.fn(), vi.fn()];
    for (const reject of rejected)
      void commandWait(session, { type: 'travel', event: 'valley-sprint' }).catch(reject);
    const commandIds = doubles.workers[0].postMessage.mock.calls
      .flatMap(([message]) => message.type === 'command' && message.requestId !== undefined ? [message.requestId] : []);
    engine.steps.mockImplementationOnce(() => { throw new Error('Fatal step failure'); });
    engine.advance(20);
    await vi.advanceTimersByTimeAsync(0);
    const fatal = engine.errors().at(-1)!;
    expect(fatal).toMatchObject({ fatal: true, message: expect.stringContaining('Fatal step failure') });
    for (const reject of rejected) expect(reject).toHaveBeenCalledExactlyOnceWith(new Error(fatal.message));
    expect(session.drivingInputEnabled).toBe(false);
    expect(session.action('pause')).toBe(false);
    expect(run.host.audio.stop).toHaveBeenCalledOnce();
    expect(run.host.exit).toHaveBeenCalledOnce();
    expectReleased();

    receive({ data: fatal });
    nativeError({ message: 'Queued native error' });
    messageError();
    for (const requestId of commandIds) receive({ data: { type: 'command-result', requestId } });
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    receive({ data: { type: 'frame', buffer: frame.buffer } });
    const lastStatus = engine.messages.find((message) => message.type === 'status')!;
    const observed = doubles.observe.mock.calls.length;
    receive({ data: lastStatus });
    session.command({ type: 'reset' });
    session.dispose();
    await vi.advanceTimersByTimeAsync(30000);
    for (const reject of rejected) expect(reject).toHaveBeenCalledOnce();
    expect(run.host.toast).toHaveBeenCalledOnce();
    expect(run.host.exit).toHaveBeenCalledOnce();
    expect(doubles.observe).toHaveBeenCalledTimes(observed);
    expectReleased();
  });

  it.each(['native', 'decode'] as const)('keeps %s worker errors terminal and settles command deadlines once', async (kind) => {
    await worker();
    const run = await start();
    const session = run.session!;
    doubles.state.holdCommands = true;
    const reject = vi.fn();
    void commandWait(session, { type: 'travel', event: 'valley-sprint' }).catch(reject);
    if (kind === 'native') doubles.workers[0].onerror!({ message: 'Native worker crash' });
    else doubles.workers[0].onmessageerror!();
    await vi.advanceTimersByTimeAsync(0);
    expect(reject).toHaveBeenCalledExactlyOnceWith(new Error(kind === 'native' ? 'Native worker crash' : 'Festival message could not be decoded'));
    expect(run.host.exit).toHaveBeenCalledOnce();
    expect(session.drivingInputEnabled).toBe(false);
    expect(run.host.audio.stop).toHaveBeenCalledOnce();
    expectReleased();
  });

  it('keeps actual correlated and uncorrelated command validation errors recoverable, including legacy error messages', async () => {
    const engine = await worker();
    const run = await start();
    const session = run.session!;
    const reject = vi.fn();
    void commandWait(session, { type: 'start', event: 'unknown-event' }).catch(reject);
    await vi.advanceTimersByTimeAsync(0);
    expect(reject).toHaveBeenCalledExactlyOnceWith(new Error('Unknown festival event unknown-event'));
    expect(engine.messages.at(-1)).toMatchObject({ type: 'command-result', error: 'Unknown festival event unknown-event' });
    expect(run.host.toast).not.toHaveBeenCalled();
    session.command({ type: 'vehicle', id: 'unknown-vehicle' });
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.errors().at(-1)).toEqual({ type: 'error', message: 'Vehicle unknown-vehicle cannot run in the festival', fatal: false });
    doubles.workers[0].onmessage!({ data: { type: 'error', message: 'Legacy command error' } });
    expect(run.host.toast).toHaveBeenCalledTimes(2);
    expect(run.host.exit).not.toHaveBeenCalled();
    expect(doubles.workers[0].terminate).not.toHaveBeenCalled();
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(run.host.audio.stop).not.toHaveBeenCalled();
    expect(session.drivingInputEnabled).toBe(true);
    const resolve = vi.fn();
    void commandWait(session, { type: 'traffic', value: false }).then(resolve);
    engine.advance(20);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolve).toHaveBeenCalledOnce();
    expect(engine.steps).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
