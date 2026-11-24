import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FestivalSession, type FestivalHost, type FestivalStartOptions } from '../src/session/free-roam.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import type { FestivalCommand, FestivalStatus } from '../src/simulation/open-world/session.ts';
import type { FestivalResult } from '../src/simulation/open-world/festival-events.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

interface WorkerDouble {
  onmessage: ((event: { data: FromOpenWorld }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  terminate: Mock<() => void>;
  postMessage: Mock<(message: ToOpenWorld) => void>;
}

const doubles = vi.hoisted(() => {
  const state = {
    autoFrame: true,
    tileError: null as Error | null,
    onPost: null as ((worker: WorkerDouble, message: ToOpenWorld) => void) | null,
  };
  function worker(): WorkerDouble {
    const instance: WorkerDouble = {
      onmessage: null as ((event: { data: FromOpenWorld }) => void) | null,
      onerror: null as ((event: { message: string }) => void) | null,
      terminate: vi.fn(),
      postMessage: vi.fn((message: ToOpenWorld) => state.onPost?.(instance, message)),
    };
    return instance;
  }
  return {
    state,
    worker,
    workers: [] as WorkerDouble[],
    tiles: [] as WorkerDouble[],
    lazyData: vi.fn<() => Promise<void>>(),
    renderer: vi.fn(),
    traffic: vi.fn(),
    riders: vi.fn(),
    hud: vi.fn(),
    observe: vi.fn(),
    ground: { enabled: false, ready: vi.fn<() => Promise<void>>() },
  };
});

vi.mock('../src/core/lazy-data.ts', () => ({ loadLazyData: doubles.lazyData }));
vi.mock('../src/rendering/ground/scan-store.ts', () => ({ scannedGround: doubles.ground }));
vi.mock('../src/simulation/open-world/festival-events.ts', () => ({
  isRace: (kind: string) => kind === 'sprint',
  resolveEvents: () => [{ spec: { id: 'coast-trap', name: 'Coast trap', kind: 'speed-trap' }, marker: { x: 10, z: 20 } }],
}));
vi.mock('../src/simulation/open-world/placement.ts', () => ({ regionStructures: () => [] }));
vi.mock('../src/simulation/open-world/session.ts', () => ({
  festivalDefaultVehicle: () => 'tc1',
  festivalVehicles: () => [{ id: 'tc1', classId: 'touring' }],
}));
vi.mock('../src/simulation/open-world/festival-machines.ts', () => ({
  festivalDefaultVehicle: () => 'tc1',
  festivalVehicles: () => [{ id: 'tc1', classId: 'touring' }],
}));
vi.mock('../src/simulation/open-world/world.ts', () => ({ openWorld: () => ({}) }));
vi.mock('../src/simulation/vehicles.ts', () => ({ vehicleAt: vi.fn() }));
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
      const worker = doubles.worker();
      doubles.workers.push(worker);
      return worker;
    }
  },
}));
vi.mock('../src/workers/open-world-tiles.worker.ts?worker&inline', () => ({
  default: class {
    constructor() {
      if (doubles.state.tileError) throw doubles.state.tileError;
      const worker = doubles.worker();
      doubles.tiles.push(worker);
      return worker;
    }
  },
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function frame(): FromOpenWorld {
  const data = new Float32Array(HEADER + CAR_STRIDE);
  data[H.CARS] = 1;
  return { type: 'frame', buffer: data.buffer };
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
    refreshVehicleMaterials: vi.fn(),
    ready: vi.fn(() => true),
    prestream: vi.fn(),
    photoSky: { enabled: false, ready: vi.fn(async () => false) },
    prepareGpu: vi.fn(async (_frame: Float32Array, _progress: (message: string) => void) => true),
    draw: vi.fn(),
    dispose: vi.fn(),
    mode: 'cockpit',
    photo: false,
    lighting: 'day',
  };
}

function hostDouble() {
  const canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn<() => Promise<void>>() });
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    renderer: {} as FestivalHost['renderer'],
    element: {} as HTMLElement,
    quality: 'low' as const,
    graphics: {} as FestivalHost['graphics'],
    lighting: 'day' as const,
    loading: vi.fn(), loaded: vi.fn(), toast: vi.fn(), exit: vi.fn(), driving: vi.fn(),
    load: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    onResult: vi.fn(),
    audio: { start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), stop: vi.fn(), update: vi.fn() },
  };
}

let renderer: ReturnType<typeof rendererDouble>;
let hud: { dispose: ReturnType<typeof vi.fn>; recordActivity: ReturnType<typeof vi.fn>; menuOpen: boolean; mapOpen: boolean; cardOpen: boolean; resultsOpen: boolean; showMenu: ReturnType<typeof vi.fn>; showMap: ReturnType<typeof vi.fn> };
let rider: { root: object; shells: { install: () => void }; dispose: ReturnType<typeof vi.fn> };
const cancellations: AbortController[] = [];

function start(host = hostDouble(), options: FestivalStartOptions = {}) {
  const cancellation = new AbortController();
  cancellations.push(cancellation);
  let outcome: { session: FestivalSession } | { error: unknown } | undefined;
  const pending = FestivalSession.start(host, { ...options, signal: cancellation.signal });
  void pending.then(
    (session) => { outcome = { session }; },
    (error: unknown) => { outcome = { error }; },
  );
  return { host, cancellation, get outcome() { return outcome; } };
}

async function advanceUntil(predicate: () => boolean) {
  for (let i = 0; i < 60 && !predicate(); i++) await vi.advanceTimersByTimeAsync(20);
  expect(predicate()).toBe(true);
}

function liveSession(run: ReturnType<typeof start>) {
  expect(run.outcome).toHaveProperty('session');
  if (!run.outcome || !('session' in run.outcome)) throw new Error('Session did not start');
  return run.outcome.session;
}

function commandWait(session: FestivalSession, command: FestivalCommand) {
  return (session as unknown as { commandAndWait(command: FestivalCommand): Promise<void> }).commandAndWait(command);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  doubles.workers.length = doubles.tiles.length = 0;
  doubles.state.autoFrame = true;
  doubles.state.tileError = null;
  doubles.state.onPost = (worker, message) => {
    if (message.type === 'init' && doubles.state.autoFrame)
      queueMicrotask(() => worker.onmessage?.({ data: frame() }));
  };
  doubles.lazyData.mockResolvedValue(undefined);
  doubles.ground.enabled = false;
  doubles.ground.ready.mockResolvedValue(undefined);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16)));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => clearTimeout(id)));
  renderer = rendererDouble();
  hud = { dispose: vi.fn(), recordActivity: vi.fn(), menuOpen: false, mapOpen: false, cardOpen: false, resultsOpen: false, showMenu: vi.fn(), showMap: vi.fn() };
  rider = { root: {}, shells: { install() {} }, dispose: vi.fn() };
  doubles.renderer.mockImplementation(function () { return renderer; });
  doubles.hud.mockImplementation(function () { return hud; });
  doubles.traffic.mockImplementation(function () { return { root: {}, dispose: vi.fn() }; });
  doubles.riders.mockImplementation(function () { return rider; });
});

afterEach(async () => {
  for (const cancellation of cancellations.splice(0)) cancellation.abort();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FestivalSession lifetime', () => {
  it('starts normally only after its initial snapshot and releases its startup timers', async () => {
    doubles.state.autoFrame = false;
    const run = start();
    await advanceUntil(() => doubles.workers[0]?.postMessage.mock.calls.some(([message]) => message.type === 'init'));
    const worker = doubles.workers[0];
    worker.onmessage!({ data: { type: 'ready', buildMs: 1, vehicle: 'tc1' } });
    await vi.advanceTimersByTimeAsync(100);
    expect(run.outcome).toBeUndefined();
    expect(run.host.loaded).not.toHaveBeenCalled();
    worker.onmessage!({ data: frame() });
    await advanceUntil(() => run.outcome !== undefined);
    expect(liveSession(run).drivingInputEnabled).toBe(true);
    expect(run.host.audio.start).toHaveBeenCalledOnce();
    expect(run.host.loaded).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'pause', value: false }, []);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start loading when its signal is already aborted', async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    const host = hostDouble();
    await expect(FestivalSession.start(host, { signal: cancellation.signal })).rejects.toThrow('Festival session closed');
    expect(host.loading).not.toHaveBeenCalled();
    expect(doubles.lazyData).not.toHaveBeenCalled();
    expect(doubles.workers).toHaveLength(0);
  });

  it.each(['data', 'frame', 'save'] as const)('cancels startup during the initial %s wait without allocating workers', async (stage) => {
    const pending = deferred<unknown>();
    const host = hostDouble();
    if (stage === 'data') doubles.lazyData.mockReturnValue(pending.promise as Promise<void>);
    if (stage === 'save') host.load.mockReturnValue(pending.promise);
    const run = start(host);
    if (stage === 'frame') await vi.advanceTimersByTimeAsync(0);
    if (stage === 'save') await advanceUntil(() => host.load.mock.calls.length > 0);
    run.cancellation.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.outcome).toMatchObject({ error: new Error('Festival session closed') });
    expect(vi.getTimerCount()).toBe(0);
    if (stage !== 'frame') pending.reject(new Error('Late load failure'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.workers).toHaveLength(0);
    expect(host.loaded).not.toHaveBeenCalled();
    expect(host.toast).not.toHaveBeenCalled();
  });

  it.each(['vegetation', 'authored', 'street', 'sky', 'ground', 'gpu', 'audio'] as const)(
    'settles cancellation during %s loading and never resumes boot after the loader completes',
    async (stage) => {
      const pending = deferred<boolean>();
      const host = hostDouble();
      const operation = {
        vegetation: renderer.loadPhotoVegetation,
        authored: renderer.loadAuthoredDetails,
        street: renderer.loadStreetDetails,
        sky: renderer.photoSky.ready,
        ground: doubles.ground.ready,
        gpu: renderer.prepareGpu,
        audio: host.audio.start,
      }[stage];
      if (stage === 'sky') renderer.photoSky.enabled = true;
      if (stage === 'ground') doubles.ground.enabled = true;
      if (stage === 'vegetation') renderer.loadPhotoVegetation.mockReturnValue(pending.promise);
      if (stage === 'authored') renderer.loadAuthoredDetails.mockReturnValue(pending.promise);
      if (stage === 'street') renderer.loadStreetDetails.mockReturnValue(pending.promise);
      if (stage === 'sky') renderer.photoSky.ready.mockReturnValue(pending.promise);
      if (stage === 'ground') doubles.ground.ready.mockReturnValue(pending.promise.then(() => undefined));
      if (stage === 'gpu') renderer.prepareGpu.mockReturnValue(pending.promise);
      if (stage === 'audio') host.audio.start.mockReturnValue(pending.promise.then(() => undefined));
      const run = start(host);
      await advanceUntil(() => operation.mock.calls.length > 0);
      run.cancellation.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(run.outcome).toMatchObject({ error: new Error('Festival session closed') });
      const loadingCalls = host.loading.mock.calls.length;
      const hudCreations = doubles.hud.mock.calls.length;
      const prestreams = renderer.prestream.mock.calls.length;
      expect(renderer.dispose).toHaveBeenCalledOnce();
      expect(doubles.workers[0].terminate).toHaveBeenCalledOnce();
      expect(doubles.tiles[0].terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      pending.resolve(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(host.loading).toHaveBeenCalledTimes(loadingCalls);
      expect(doubles.hud).toHaveBeenCalledTimes(hudCreations);
      expect(renderer.prestream).toHaveBeenCalledTimes(prestreams);
      expect(host.loaded).not.toHaveBeenCalled();
      expect(host.toast).not.toHaveBeenCalled();
      expect(host.audio.start).toHaveBeenCalledTimes(stage === 'audio' ? 1 : 0);
    },
  );

  it('rejects startup immediately on an early worker failure, even while an asset loader remains pending', async () => {
    const pending = deferred<boolean>();
    renderer.loadPhotoVegetation.mockReturnValue(pending.promise);
    const run = start();
    await advanceUntil(() => renderer.loadPhotoVegetation.mock.calls.length > 0);
    doubles.workers[0].onerror!({ message: 'Worker crashed during loading' });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.outcome).toMatchObject({ error: new Error('Worker crashed during loading') });
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(run.host.toast).toHaveBeenCalledWith('Festival error: Worker crashed during loading');
    pending.resolve(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.hud).not.toHaveBeenCalled();
    expect(doubles.traffic).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'timeout'] as const)('settles the first-snapshot promise on %s and clears readiness timers', async (reason) => {
    doubles.state.autoFrame = false;
    const run = start();
    await advanceUntil(() => doubles.workers[0]?.postMessage.mock.calls.some(([message]) => message.type === 'init'));
    if (reason === 'cancel') run.cancellation.abort();
    await vi.advanceTimersByTimeAsync(reason === 'timeout' ? 20000 : 0);
    expect(run.outcome).toMatchObject({ error: new Error(reason === 'cancel' ? 'Festival session closed' : 'The festival simulation did not start.') });
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(hud.dispose).toHaveBeenCalledOnce();
    expect(run.host.loaded).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create a readiness wait when the loading callback closes its host', async () => {
    const host = hostDouble();
    const run = start(host);
    host.loading.mockImplementation((message: string) => {
      if (message === 'Starting the festival simulation…') run.cancellation.abort();
    });
    await advanceUntil(() => run.outcome !== undefined);
    expect(run.outcome).toMatchObject({ error: new Error('Festival session closed') });
    expect(doubles.workers[0].postMessage).not.toHaveBeenCalled();
    expect(hud.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles startup if posting worker initialization fails synchronously', async () => {
    doubles.state.onPost = () => { throw new Error('Initialization post failed'); };
    const run = start();
    await advanceUntil(() => run.outcome !== undefined);
    expect(run.outcome).toMatchObject({ error: new Error('Initialization post failed') });
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(hud.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a terrain polling timer and does not continue prestreaming after cancellation', async () => {
    renderer.ready.mockReturnValue(false);
    const run = start();
    await advanceUntil(() => renderer.prestream.mock.calls.length > 0);
    run.cancellation.abort();
    await vi.advanceTimersByTimeAsync(0);
    const streams = renderer.prestream.mock.calls.length;
    expect(run.outcome).toMatchObject({ error: new Error('Festival session closed') });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(renderer.prestream).toHaveBeenCalledTimes(streams);
    expect(renderer.prepareGpu).not.toHaveBeenCalled();
    expect(run.host.loaded).not.toHaveBeenCalled();
  });

  it.each(['dispose', 'protocol', 'worker', 'post'] as const)('settles command waits and clears their timer on %s failure', async (reason) => {
    const run = start();
    await advanceUntil(() => run.outcome !== undefined);
    const session = liveSession(run), worker = doubles.workers[0];
    if (reason === 'post') worker.postMessage.mockImplementationOnce(() => { throw new Error('Post failed'); });
    const rejected = vi.fn();
    void commandWait(session, { type: 'travel', event: 'coast-trap' }).catch(rejected);
    if (reason === 'dispose') session.dispose();
    if (reason === 'protocol') worker.onmessage!({ data: { type: 'error', message: 'Simulation command failed' } });
    if (reason === 'worker') worker.onerror!({ message: 'Worker stopped' });
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
    expect(session.drivingInputEnabled).toBe(reason === 'protocol');
    expect(renderer.dispose).toHaveBeenCalledTimes(reason === 'protocol' ? 0 : 1);
    await vi.advanceTimersByTimeAsync(9000);
    expect(rejected).toHaveBeenCalledOnce();
  });

  it('clears successful command deadlines without changing the worker confirmation contract', async () => {
    const run = start();
    await advanceUntil(() => run.outcome !== undefined);
    const session = liveSession(run), worker = doubles.workers[0];
    const resolved = vi.fn();
    void commandWait(session, { type: 'travel', event: 'coast-trap' }).then(resolved);
    const message = worker.postMessage.mock.calls.at(-1)![0];
    expect(message.type).toBe('command');
    if (message.type !== 'command') throw new Error('Missing command');
    worker.onmessage!({ data: { type: 'command-result', requestId: message.requestId! } });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores queued worker, material-install and GPU progress callbacks after disposal', async () => {
    const run = start();
    await advanceUntil(() => run.outcome !== undefined);
    const session = liveSession(run), worker = doubles.workers[0];
    const receive = worker.onmessage!, failure = worker.onerror!;
    const progress = renderer.prepareGpu.mock.calls[0][1];
    session.dispose();
    session.dispose();
    const loading = run.host.loading.mock.calls.length;
    receive({ data: frame() });
    receive({ data: { type: 'status', status: { discovered: ['coast-trap'] } as FestivalStatus } });
    receive({ data: { type: 'result', result: { completed: true, eventId: 'coast-trap', stars: 3, time: 1 } as FestivalResult } });
    receive({ data: { type: 'error', message: 'Queued error' } });
    failure({ message: 'Queued crash' });
    progress('Late GPU progress');
    rider.shells.install();
    session.frame(100);
    session.setPaused(true);
    expect(session.action('pause')).toBe(false);
    expect(session.drivingInputEnabled).toBe(false);
    expect(run.host.loading).toHaveBeenCalledTimes(loading);
    expect(run.host.toast).not.toHaveBeenCalled();
    expect(run.host.onResult).not.toHaveBeenCalled();
    expect(run.host.save).not.toHaveBeenCalled();
    expect(doubles.observe).not.toHaveBeenCalled();
    expect(renderer.refreshVehicleMaterials).not.toHaveBeenCalled();
    expect(renderer.draw).not.toHaveBeenCalled();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(hud.dispose).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('handles a pointer-lock request that completes with %s after disposal', async (completion) => {
    const run = start();
    await advanceUntil(() => run.outcome !== undefined);
    const pending = deferred();
    vi.mocked(run.host.canvas.requestPointerLock).mockReturnValue(pending.promise);
    run.host.canvas.dispatchEvent(new Event('dblclick'));
    expect(run.host.canvas.requestPointerLock).toHaveBeenCalledOnce();
    liveSession(run).dispose();
    if (completion === 'resolve') {
      Reflect.set(document, 'pointerLockElement', run.host.canvas);
      pending.resolve(undefined);
    } else pending.reject(new Error('Pointer lock rejected'));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.exitPointerLock).toHaveBeenCalledTimes(completion === 'resolve' ? 1 : 0);
    expect(run.host.toast).not.toHaveBeenCalled();
  });

  it('terminates the simulation worker if allocating the tile worker fails', async () => {
    doubles.state.tileError = new Error('Tile worker unavailable');
    const run = start();
    await advanceUntil(() => run.outcome !== undefined);
    expect(run.outcome).toMatchObject({ error: new Error('Tile worker unavailable') });
    expect(doubles.workers[0].terminate).toHaveBeenCalledOnce();
    expect(doubles.renderer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
