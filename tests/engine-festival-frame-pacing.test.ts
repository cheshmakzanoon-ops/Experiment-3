import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { FestivalControls, festivalMenuState } from '../src/session/festival-controls.ts';
import { recordFestivalBest, type FestivalSave } from '../src/session/festival-save.ts';
import { SessionLifetime } from '../src/session/session-lifetime.ts';
import { controls } from '../src/simulation/config.ts';
import { isRace, type FestivalEvent } from '../src/simulation/open-world/festival-events.ts';
import {
  festivalDefaultVehicle,
  type FestivalStatus,
} from '../src/simulation/open-world/session.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleAt } from '../src/simulation/vehicles.ts';
import { FestivalStatusObserver } from '../src/steam/hooks.ts';
import { minimapHeading } from '../src/ui/festival-map.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

// Execute the complete production session, including its real frame method,
// constructor, pause/page lifecycle and failure/disposal paths. The real live
// clock, presented-frame sampler and control owner sit between observable GPU,
// transport and DOM boundaries; no test reimplements its cadence decision.
const source = ts.createSourceFile(
  'free-roam.ts',
  readFileSync(new URL('../src/session/free-roam.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'FestivalSession',
)!;
const compiled = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface Session {
  frame(time: number): void;
  receive(message: FromOpenWorld): void;
  post(message: ToOpenWorld): void;
  action(name: string): boolean;
  setPaused(value: boolean): void;
  setPhoto(value: boolean): void;
  setPageSuspended(value: boolean): void;
  setReducedMotion(value: boolean): void;
  travel(id: string): Promise<void>;
  resize(): void;
  dispose(): void;
  renderer: ReturnType<typeof renderer> | null;
  hud: ReturnType<typeof menus> | null;
  controls: FestivalControls | null;
  riders: { update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  traffic: { update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  liveFrames: LiveFrameClock;
  status: FestivalStatus | null;
  events: readonly FestivalEvent[];
  save: FestivalSave;
  lastTime: number;
  booting: boolean;
  disposed: boolean;
  travelling: boolean;
  pageSuspended: boolean;
  pageEpoch: number;
  isPaused: boolean;
}

function snapshot(time: number, x = time * 12) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[H.TIME] = time;
  frame[H.TICK] = Math.round(time * 120);
  frame[o + F.X] = x;
  frame[o + F.QW] = 1;
  frame[o + F.VX] = 12;
  frame[o + F.SPEED] = 12;
  frame[o + F.GEAR] = 2;
  frame[o + F.RPM] = 3000;
  return frame;
}

function renderer() {
  const presented = new PresentedFrame();
  const submissions: { time: number; x: number; dt: number }[] = [];
  const view = {
    presented,
    submissions,
    canSubmitFrame: vi.fn(() => true),
    draw: vi.fn((a: Float32Array, b: Float32Array, alpha: number, dt: number) => {
      const value = presented.sample(a, b, alpha);
      submissions.push({ time: value[H.TIME], x: value[carBase(0) + F.X], dt });
      return true;
    }),
    camera: {},
    mode: 'cockpit' as 'cockpit' | 'hood' | 'chase',
    night: 0,
    photo: false,
    lighting: 'day' as const,
    reducedMotion: false,
    changeCamera: vi.fn(() => {
      view.mode = view.mode === 'cockpit' ? 'chase' : 'cockpit';
    }),
    setPhoto: vi.fn((value: boolean) => {
      view.photo = value;
    }),
    centreLook: vi.fn(),
    moveCockpitLook: vi.fn(),
    resize: vi.fn(),
    ready: vi.fn(() => true),
    prestream: vi.fn(),
    cars: {
      bodies: { cabinOf: () => ({ navigationPane: {} }) },
      navigation: { update: vi.fn(), detach: vi.fn() },
    },
    guidance: { cue: null },
    driftCue: null,
    audioView: { value: {} },
    dispose: vi.fn(),
  };
  return view;
}

function menus() {
  const hud = {
    menuOpen: false,
    mapOpen: false,
    cardOpen: false,
    resultsOpen: false,
    minimap: {},
    showMenu: vi.fn((open: boolean) => {
      hud.menuOpen = open;
    }),
    showMap: vi.fn((open: boolean) => {
      hud.mapOpen = open;
    }),
    showPhoto: vi.fn(),
    hideResults: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  };
  return hud;
}

let now = 0;
const sessions: Session[] = [],
  controlOwners: FestivalControls[] = [];
beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      hidden: false,
      pointerLockElement: null,
      exitPointerLock: vi.fn(),
    }),
  );
  now = 0;
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const owner of controlOwners.splice(0)) owner.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(options: { paused?: boolean; photo?: boolean } = {}) {
  const view = renderer(),
    hud = menus();
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  const tiles = { terminate: vi.fn(), onerror: null, onmessageerror: null };
  const audio: { time: number; x: number; playing: boolean }[] = [];
  const host = {
    canvas: Object.assign(new EventTarget(), { height: 720 }),
    quality: 'low',
    reducedMotion: false,
    loading: vi.fn(),
    loaded: vi.fn(),
    toast: vi.fn(),
    exit: vi.fn(),
    driving: vi.fn(),
    audio: {
      stop: vi.fn(),
      update: vi.fn((frame: Float32Array, _cockpit: boolean, playing: boolean) => {
        audio.push({ time: frame[H.TIME], x: frame[carBase(0) + F.X], playing });
      }),
    },
  };
  const bindings = {
    OpenWorldWorker: function () {
      return worker;
    },
    TileWorker: function () {
      return tiles;
    },
    LiveFrameClock,
    FestivalStatusObserver,
    emitGameEvent: () => {},
    festivalDefaultVehicle,
    carBase,
    F,
    H,
    R,
    RACE_BASE,
    controls,
    isRace,
    recordFestivalBest,
    vehicleAt,
    minimapHeading,
  };
  const Constructor = new Function(
    ...Object.keys(bindings),
    `${compiled}; return FestivalSession;`,
  )(...Object.values(bindings)) as new (
    host: object,
    save: null,
    lifetime: SessionLifetime,
  ) => Session;
  const session = new Constructor(host, null, new SessionLifetime('Festival session closed'));
  sessions.push(session);
  session.renderer = view;
  session.hud = hud;
  const riders = { update: vi.fn(), dispose: vi.fn() },
    traffic = { update: vi.fn(), dispose: vi.fn() };
  session.riders = riders;
  session.traffic = traffic;
  session.status = { road: 'Coast road', discovered: [] } as unknown as FestivalStatus;
  const owner = new FestivalControls(hud, {
    pause: (value) => session.post({ type: 'pause', value }),
    driving: host.driving,
    menuState: () => festivalMenuState(session.status, session.save, 'day'),
    card: () => null,
    start: vi.fn(),
    continue: vi.fn(),
  });
  controlOwners.push(owner);
  session.controls = owner;
  session.setPaused(options.paused ?? false);
  if (options.photo) session.setPhoto(true);
  session.booting = false;
  const sync = vi.spyOn(owner, 'syncInput');
  const sample = vi.spyOn(session.liveFrames, 'sample');
  const feed = (wall: number, time: number, x = time * 12) => {
    now = wall;
    const frame = snapshot(time, x),
      auxiliary = new Float32Array([0, time]);
    session.receive({ type: 'frame', buffer: frame.buffer, traffic: auxiliary.buffer });
    return { frame, auxiliary };
  };
  const initial = feed(0, 0);
  // Startup has already submitted its warm-up view before the host exposes RAF.
  view.presented.sample(initial.frame, initial.frame, 1);
  const at = (time: number) => {
    now = time;
    session.frame(time);
  };
  return {
    session,
    view,
    hud,
    owner,
    sync,
    sample,
    riders,
    traffic,
    host,
    worker,
    tiles,
    audio,
    at,
    feed,
  };
}

describe('Festival GPU admission and idle cadence', () => {
  it.each([
    { name: 'live driving', paused: false, photo: false, draws: 60 },
    { name: 'pause', paused: true, photo: false, draws: 15 },
    { name: 'photo', paused: true, photo: true, draws: 15 },
  ])('services all 60 callbacks with $draws submitted $name draws', ({ paused, photo, draws }) => {
    const h = fixture({ paused, photo });
    for (let i = 0; i < 60; i++) h.at((i * 1000) / 60);
    expect(h.view.draw).toHaveBeenCalledTimes(draws);
    expect(h.view.canSubmitFrame).toHaveBeenCalledTimes(60);
    expect(h.sample).toHaveBeenCalledTimes(draws);
    expect(h.riders.update).toHaveBeenCalledTimes(draws);
    expect(h.traffic.update).toHaveBeenCalledTimes(draws);
    expect(h.hud.update).toHaveBeenCalledTimes(60);
    expect(h.sync).toHaveBeenCalledTimes(60);
    expect(h.host.audio.update).toHaveBeenCalledTimes(60);
    expect(
      h.view.cars.navigation.update.mock.calls.length +
        h.view.cars.navigation.detach.mock.calls.length,
    ).toBe(draws);
    if (paused) expect(h.audio.every((sample) => !sample.playing)).toBe(true);
    if (draws === 15)
      for (const submitted of h.view.submissions.slice(1))
        expect(submitted.dt).toBeCloseTo(1 / 15, 12);
  });

  it.each([false, true])(
    'keeps all 60 service callbacks while a busy GPU admits zero draws (paused=%s)',
    (paused) => {
      const h = fixture({ paused });
      h.view.canSubmitFrame.mockReturnValue(false);
      for (let i = 0; i < 60; i++) {
        h.feed((i * 1000) / 60, i / 60);
        h.at((i * 1000) / 60);
      }
      expect(h.view.canSubmitFrame).toHaveBeenCalledTimes(60);
      expect(h.view.draw).not.toHaveBeenCalled();
      expect(h.sample).not.toHaveBeenCalled();
      expect(h.riders.update).not.toHaveBeenCalled();
      expect(h.traffic.update).not.toHaveBeenCalled();
      expect(h.view.cars.navigation.update).not.toHaveBeenCalled();
      expect(h.hud.update).toHaveBeenCalledTimes(60);
      expect(h.sync).toHaveBeenCalledTimes(60);
      expect(h.host.audio.update).toHaveBeenCalledTimes(60);
      expect(h.audio.every((sample) => sample.time === 0 && sample.x === 0)).toBe(true);
    },
  );

  it('retains elapsed wall time and the real sampled pair/traffic through GPU deferrals', () => {
    const h = fixture();
    h.at(0);
    h.view.canSubmitFrame.mockReturnValue(false);
    for (let i = 1; i <= 3; i++) {
      const received = h.feed((i * 1000) / 60, i / 60);
      // Recycling the original transferables cannot alter retained live poses.
      received.frame.fill(999);
      received.auxiliary.fill(999);
      h.at((i * 1000) / 60);
    }
    expect(h.session.lastTime).toBe(0);
    expect(h.view.submissions).toHaveLength(1);
    expect(h.audio.at(-1)?.time).toBe(0);
    h.view.canSubmitFrame.mockReturnValue(true);
    h.at((4 * 1000) / 60);
    const [a, b, alpha, dt] = h.view.draw.mock.calls.at(-1)!;
    expect(dt).toBeCloseTo(4 / 60, 12);
    expect(h.view.submissions.at(-1)?.time).toBeCloseTo(2 / 60, 6);
    expect(h.view.submissions.at(-1)?.x).toBeCloseTo((12 * 2) / 60, 6);
    expect(h.riders.update.mock.calls.at(-1)?.slice(0, 3)).toEqual([a, b, alpha]);
    const [trafficA, trafficB, trafficAlpha, , trafficTime] = h.traffic.update.mock.calls.at(-1)!;
    expect(trafficA[1]).toBe(a[H.TIME]);
    expect(trafficB[1]).toBe(b[H.TIME]);
    expect(trafficAlpha).toBe(alpha);
    expect(trafficTime).toBe(b[H.TIME]);
    expect(h.audio.at(-1)?.time).toBe(h.view.submissions.at(-1)?.time);
  });

  it('bounds a long GPU stall without losing absolute simulation time or inventing poses', () => {
    const h = fixture();
    h.at(0);
    h.view.canSubmitFrame.mockReturnValue(false);
    h.at(1_000_000);
    h.feed(1_000_000, 100);
    h.feed(1_000_000 + 1000 / 60, 100 + 1 / 60);
    h.feed(1_000_000 + 2000 / 60, 100 + 2 / 60);
    h.view.canSubmitFrame.mockReturnValue(true);
    h.at(1_000_050);
    expect(h.view.submissions.at(-1)?.dt).toBe(0.08);
    expect(h.view.submissions.at(-1)?.time).toBeCloseTo(100 + 1 / 60, 4);
    expect(h.view.submissions.at(-1)!.time).toBeLessThanOrEqual(100 + 2 / 60);
    h.at(1_000_066);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.016, 12);
  });

  it('draws pause/photo transitions and live resume immediately, preserving the measured pause pose', () => {
    const h = fixture();
    h.at(0);
    h.feed(10, 1);
    h.session.setPaused(true);
    h.at(10);
    expect(h.view.submissions.at(-1)?.time).toBe(1);
    h.at(11);
    expect(h.view.draw).toHaveBeenCalledTimes(2);
    h.session.setPaused(false);
    h.at(12);
    expect(h.view.draw).toHaveBeenCalledTimes(3);
    expect(h.view.submissions.at(-1)?.time).toBe(1);
    h.session.setPhoto(true);
    h.at(13);
    expect(h.view.draw).toHaveBeenCalledTimes(4);
    h.session.setPhoto(false);
    h.at(14);
    expect(h.view.draw).toHaveBeenCalledTimes(5);
    expect(h.audio.at(-1)?.playing).toBe(true);
  });

  it('retains a resize through GPU busy and a declined draw, committing only the successful submission', () => {
    const h = fixture({ paused: true });
    h.at(0);
    h.session.resize();
    h.view.canSubmitFrame.mockReturnValue(false);
    h.at(10);
    expect(h.view.resize).not.toHaveBeenCalled();
    h.view.canSubmitFrame.mockReturnValue(true);
    h.view.draw.mockReturnValueOnce(false);
    h.at(20);
    expect(h.view.resize).toHaveBeenCalledOnce();
    expect(h.session.lastTime).toBe(0);
    expect(h.view.submissions).toHaveLength(1);
    expect(h.audio.at(-1)?.time).toBe(0);
    h.at(30);
    expect(h.view.resize).toHaveBeenCalledTimes(2);
    expect(h.view.submissions).toHaveLength(2);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.03, 12);
    h.at(31);
    expect(h.view.draw).toHaveBeenCalledTimes(3);
    expect(h.view.resize).toHaveBeenCalledTimes(2);
    expect(h.hud.update).toHaveBeenCalledTimes(5);
    expect(h.sync).toHaveBeenCalledTimes(5);
    expect(h.host.audio.update).toHaveBeenCalledTimes(5);
  });

  it('does not consume a newer resize requested during a successful draw', () => {
    const h = fixture({ paused: true });
    h.at(0);
    h.session.resize();
    const draw = h.view.draw.getMockImplementation()!;
    h.view.draw.mockImplementationOnce((...args) => {
      h.session.resize();
      return draw(...args);
    });
    h.at(10);
    h.at(11);
    expect(h.view.resize).toHaveBeenCalledTimes(2);
    expect(h.view.draw).toHaveBeenCalledTimes(3);
    h.at(12);
    expect(h.view.draw).toHaveBeenCalledTimes(3);
  });

  it.each(['camera', 'photo', 'reduced motion'] as const)(
    'retains %s invalidation until GPU admission',
    (change) => {
      const h = fixture({ paused: true });
      h.at(0);
      if (change === 'camera') h.session.action('camera');
      else if (change === 'photo') h.session.setPhoto(true);
      else h.session.setReducedMotion(true);
      h.view.canSubmitFrame.mockReturnValue(false);
      h.at(1);
      expect(h.view.draw).toHaveBeenCalledOnce();
      h.view.canSubmitFrame.mockReturnValue(true);
      h.at(2);
      expect(h.view.draw).toHaveBeenCalledTimes(2);
      h.at(3);
      expect(h.view.draw).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['pointermove', 'wheel'])(
    'allows an active photo %s to request the next GPU-permitted draw',
    (type) => {
      const h = fixture({ photo: true });
      h.at(0);
      const event = Object.assign(new Event(type), { buttons: 1 });
      h.host.canvas.dispatchEvent(event);
      h.view.canSubmitFrame.mockReturnValue(false);
      h.at(1);
      h.view.canSubmitFrame.mockReturnValue(true);
      h.at(2);
      expect(h.view.draw).toHaveBeenCalledTimes(2);
      h.at(3);
      expect(h.view.draw).toHaveBeenCalledTimes(2);
    },
  );
});

describe('Festival deferred-frame lifetime ownership', () => {
  it('services hidden callbacks without GPU work and restarts the visible wall clock after a long gap', () => {
    const h = fixture();
    h.at(0);
    Object.assign(document, { hidden: true });
    h.at(1_000_000);
    h.at(2_000_000);
    expect(h.view.canSubmitFrame).toHaveBeenCalledOnce();
    expect(h.view.draw).toHaveBeenCalledOnce();
    expect(h.sample).toHaveBeenCalledOnce();
    expect(h.hud.update).toHaveBeenCalledTimes(3);
    expect(h.sync).toHaveBeenCalledTimes(3);
    expect(h.audio.slice(1).every((sample) => !sample.playing)).toBe(true);
    Object.assign(document, { hidden: false });
    h.view.canSubmitFrame.mockReturnValue(false);
    h.at(2_000_016);
    h.view.canSubmitFrame.mockReturnValue(true);
    h.at(2_000_032);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.016, 12);
    expect(h.audio.at(-1)?.playing).toBe(true);
  });

  it('does no callback work while the page is retained and returns paused with a fresh clock', () => {
    const h = fixture();
    h.at(0);
    h.session.setPageSuspended(true);
    const controlsAfterPause = h.sync.mock.calls.length;
    h.at(1_000_000);
    expect(h.view.canSubmitFrame).toHaveBeenCalledOnce();
    expect(h.hud.update).toHaveBeenCalledOnce();
    expect(h.sync).toHaveBeenCalledTimes(controlsAfterPause);
    expect(h.host.audio.update).toHaveBeenCalledOnce();
    h.session.setPageSuspended(false);
    h.view.canSubmitFrame.mockReturnValue(false);
    h.at(1_000_016);
    h.view.canSubmitFrame.mockReturnValue(true);
    h.at(1_000_032);
    expect(h.session.isPaused).toBe(true);
    expect(h.view.draw).toHaveBeenCalledTimes(2);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.016, 12);
    expect(h.audio.at(-1)?.playing).toBe(false);
  });

  it('breaks hidden wall time even when the browser delivers no hidden RAF', () => {
    const h = fixture({ paused: true });
    h.at(100);
    Object.assign(document, { hidden: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.assign(document, { hidden: false });
    document.dispatchEvent(new Event('visibilitychange'));
    h.at(1_000_100);
    expect(h.view.draw).toHaveBeenCalledTimes(2);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.016, 12);
  });

  it.each([true, false])(
    'honors HUD exit with GPU readiness=%s before visiting released children',
    (ready) => {
      const h = fixture();
      h.view.canSubmitFrame.mockReturnValue(ready);
      h.hud.update.mockImplementationOnce(() => h.session.dispose());
      h.at(0);
      expect(h.session.disposed).toBe(true);
      expect(h.view.dispose).toHaveBeenCalledOnce();
      expect(h.worker.terminate).toHaveBeenCalledOnce();
      expect(h.tiles.terminate).toHaveBeenCalledOnce();
      expect(h.sync).not.toHaveBeenCalled();
      expect(h.view.cars.navigation.update).not.toHaveBeenCalled();
      expect(h.host.audio.update).not.toHaveBeenCalled();
      h.at(16);
      expect(h.hud.update).toHaveBeenCalledOnce();
      expect(h.view.draw).toHaveBeenCalledTimes(ready ? 1 : 0);
    },
  );

  it('stops after actual HUD-triggered travel and starts its return with a fresh clock', async () => {
    const h = fixture();
    h.session.events = [
      { spec: { id: 'coast', name: 'Coast', kind: 'sprint' }, marker: { x: 1, z: 2 } },
    ] as FestivalEvent[];
    h.at(100);
    h.view.canSubmitFrame.mockReturnValue(false);
    let travelling: Promise<void> | undefined,
      controlsAfterTravel = 0;
    h.hud.update.mockImplementationOnce(() => {
      travelling = h.session.travel('coast');
      controlsAfterTravel = h.sync.mock.calls.length;
    });
    h.at(110);
    expect(h.session.travelling).toBe(true);
    expect(h.session.lastTime).toBe(0);
    expect(h.sync).toHaveBeenCalledTimes(controlsAfterTravel);
    expect(h.host.audio.update).toHaveBeenCalledOnce();
    h.at(1_000_000);
    expect(h.hud.update).toHaveBeenCalledTimes(2);
    const request = h.worker.postMessage.mock.calls.at(-1)![0] as ToOpenWorld;
    expect(request.type).toBe('command');
    if (request.type !== 'command' || request.requestId === undefined)
      throw new Error('Missing travel command receipt');
    h.feed(1_000_000, 100);
    h.session.receive({ type: 'command-result', requestId: request.requestId });
    await travelling;
    expect(h.session.travelling).toBe(false);
    h.view.canSubmitFrame.mockReturnValue(true);
    h.at(1_000_016);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.016, 12);
    expect(h.view.submissions.at(-1)?.time).toBe(100);
  });

  it('rejects the old frame even when the HUD suspends and resumes the page synchronously', () => {
    const h = fixture();
    let controlsAfterNavigation = 0;
    h.hud.update.mockImplementationOnce(() => {
      h.session.setPageSuspended(true);
      h.session.setPageSuspended(false);
      controlsAfterNavigation = h.sync.mock.calls.length;
    });
    h.at(0);
    expect(h.session.pageSuspended).toBe(false);
    expect(h.session.pageEpoch).toBe(1);
    expect(h.sync).toHaveBeenCalledTimes(controlsAfterNavigation);
    expect(h.view.cars.navigation.update).not.toHaveBeenCalled();
    expect(h.host.audio.update).not.toHaveBeenCalled();
    h.at(1_000_000);
    expect(h.view.submissions.at(-1)?.dt).toBeCloseTo(0.016, 12);
    expect(h.host.audio.update).toHaveBeenCalledOnce();
  });

  it('does not visit old navigation/audio after control synchronization disposes the session', () => {
    const h = fixture();
    h.hud.resultsOpen = true;
    h.host.driving.mockImplementationOnce(() => h.session.dispose());
    h.at(0);
    expect(h.hud.update).toHaveBeenCalledOnce();
    expect(h.sync).toHaveBeenCalledOnce();
    expect(h.view.cars.navigation.update).not.toHaveBeenCalled();
    expect(h.host.audio.update).not.toHaveBeenCalled();
    expect(h.view.dispose).toHaveBeenCalledOnce();
  });

  it('stops after the real control callback suspends the page', () => {
    const h = fixture();
    h.hud.resultsOpen = true;
    h.host.driving.mockImplementationOnce(() => h.session.setPageSuspended(true));
    h.at(0);
    expect(h.session.pageSuspended).toBe(true);
    expect(h.view.cars.navigation.update).not.toHaveBeenCalled();
    expect(h.host.audio.update).not.toHaveBeenCalled();
  });

  it('rejects a replaced control owner even if the session itself remains live', () => {
    const h = fixture();
    h.hud.update.mockImplementationOnce(() => {
      h.session.controls = null;
    });
    h.at(0);
    expect(h.session.disposed).toBe(false);
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.view.cars.navigation.update).not.toHaveBeenCalled();
    expect(h.host.audio.update).not.toHaveBeenCalled();
  });

  it.each(['readiness', 'submission'] as const)(
    'releases the session on a failed GPU %s ownership check',
    (stage) => {
      const h = fixture({ paused: true });
      const error = new Error(`GPU ${stage} failed`);
      if (stage === 'readiness')
        h.view.canSubmitFrame.mockImplementationOnce(() => {
          throw error;
        });
      else
        h.view.draw.mockImplementationOnce(() => {
          throw error;
        });
      h.at(0);
      expect(h.session.disposed).toBe(true);
      expect(h.host.toast).toHaveBeenCalledWith(`Festival error: ${error.message}`);
      expect(h.host.exit).toHaveBeenCalledOnce();
      expect(h.view.dispose).toHaveBeenCalledOnce();
      expect(h.worker.terminate).toHaveBeenCalledOnce();
      expect(h.hud.update).not.toHaveBeenCalled();
      expect(h.host.audio.update).not.toHaveBeenCalled();
    },
  );

  it('still propagates an error reporter failure after the failed GPU owner has been released', () => {
    const h = fixture();
    h.view.canSubmitFrame.mockImplementationOnce(() => {
      throw new Error('GPU wait failed');
    });
    h.host.toast.mockImplementationOnce(() => {
      throw new Error('Toast failed');
    });
    expect(() => h.at(0)).toThrow('Toast failed');
    expect(h.session.disposed).toBe(true);
    expect(h.host.exit).toHaveBeenCalledOnce();
    expect(h.view.dispose).toHaveBeenCalledOnce();
  });
});
