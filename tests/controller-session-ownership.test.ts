import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller.ts';
import { InputPump } from '../src/input/pump.ts';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { FestivalControls, festivalMenuState } from '../src/session/festival-controls.ts';
import { SessionLifetime } from '../src/session/session-lifetime.ts';
import { SessionStartOwner } from '../src/session/session-start-owner.ts';
import { controls, racingSession, type Controls } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { PauseHandshake } from '../src/workers/diagnostics.ts';

/** Run complete production methods and the actual callback installed by the
 * application, without main.ts's automatic DOM boot or renderer/asset imports.
 * Branches and publication guards are not copied into fixture implementations.
 * Rendering, UI, browser hardware and worker delivery are explicit boundaries. */
function sourceOwner(path: string, name: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  if (!owner) throw new Error(`Missing integration owner ${name}`);
  return {
    member(name: string) {
      const member = owner.members.find((node) => node.name?.getText(source) === name);
      if (!member) throw new Error(`Missing ${owner.name?.text}.${name}`);
      return member.getText(source);
    },
    assignment(property: string) {
      const found: ts.BinaryExpression[] = [];
      const visit = (node: ts.Node) => {
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
          node.left.name.text === property &&
          ts.isNewExpression(node.right)
        )
          found.push(node);
        ts.forEachChild(node, visit);
      };
      visit(owner);
      if (found.length !== 1) throw new Error(`Expected one ${property} constructor assignment`);
      return found[0].getText(source);
    },
  };
}

function prototype(code: string, dependencies: Record<string, unknown>): object {
  const compiled = ts.transpileModule(`class Owner { ${code} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}; return Owner.prototype;`)(
    ...Object.values(dependencies),
  ) as object;
}

const main = sourceOwner('../src/main.ts', 'GameApp');
const mainPrototype = prototype(
  ['festival', 'post', 'action', 'suspendPlayback', 'pause', 'resume', 'exitFestival']
    .map((name) => main.member(name))
    .concat(`installInputPump() { ${main.assignment('inputPump')}; }`)
    .join('\n'),
  { InputPump, controls, H, racingSession },
);
const festival = sourceOwner('../src/session/free-roam.ts', 'FestivalSession');
const festivalPrototype = prototype(
  [
    'post',
    'input',
    'action',
    'setPaused',
    'isPaused',
    'drivingInputEnabled',
    'dispose',
    'settleReady',
    'rejectCommands',
    'fail',
    'releaseMouseLook',
  ]
    .map((name) => festival.member(name))
    .concat(`installControls(host, hud) { ${festival.assignment('controls')}; }`)
    .join('\n'),
  { FestivalControls, festivalMenuState },
);

interface Message {
  type: string;
  input?: Controls;
  value?: boolean;
  sequence?: number;
}
interface Session extends Record<string, unknown> {
  disposed: boolean;
  controls: FestivalControls | null;
  lifetime: SessionLifetime;
  readonly isPaused: boolean;
  readonly drivingInputEnabled: boolean;
  input(value: Controls): void;
  action(name: string): boolean;
  setPaused(value: boolean): void;
  dispose(): void;
  installControls(host: object, hud: object): void;
}
interface App extends Record<string, unknown> {
  state: string;
  errorStopped: boolean;
  disposed: boolean;
  input: InputController;
  inputPump: InputPump;
  festivalOwner: SessionStartOwner<Session>;
  readonly festival: Session | null;
  installInputPump(): void;
  action(name: string): void;
  exitFestival(): void;
}

class InputTarget extends EventTarget {
  matches() {
    return false;
  }
}
const button = (value = 0) => ({ pressed: value > 0, touched: value > 0, value });
const gamepad = (index: number, id = `Session controller ${index}`) => ({
  index,
  id,
  connected: true,
  mapping: 'standard' as GamepadMappingType,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => button()),
});
type Pad = ReturnType<typeof gamepad>;
const cleanup: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fixture(mode: 'circuit' | 'festival') {
  const window = new InputTarget();
  const modal = { open: false };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    pointerLockElement: null,
    activeElement: null,
    querySelector: () => (modal.open ? {} : null),
  });
  const first = gamepad(0);
  first.buttons[7] = button(0.4);
  let pads: (Pad | null)[] = [first];
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const interval = vi.spyOn(globalThis, 'setInterval');
  const messages: Message[] = [];
  let failPause = false;
  const pauseFailure = new Error('Pause transport unavailable');
  const sessionToast = vi.fn();
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(),
    postMessage: vi.fn((message: Message) => {
      if (failPause && message.type === 'pause') throw pauseFailure;
      // A real Worker receives a structured clone. In particular, resetting
      // InputController.state must not mutate already published commands.
      messages.push(structuredClone(message));
    }),
  };
  const app = Object.assign(Object.create(mainPrototype) as App, {
    state: 'driving',
    errorStopped: false,
    disposed: false,
    settings: structuredClone(DEFAULT_SETTINGS),
    savingSettings: false,
    worker,
    workerPause: new PauseHandshake(),
    liveFrames: new LiveFrameClock(),
    festivalOwner: new SessionStartOwner<Session>(),
    ers: 1,
    drsPress: false,
    overtakePress: false,
    renderer: null,
    current: null,
    mediaView: null,
    audio: { stop: vi.fn() },
    referenceSession: { interrupt: vi.fn() },
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    sessionReview: { event: vi.fn() },
    tabEvidence: { observe: vi.fn() },
    observeSession: vi.fn(),
    endDemoClock: vi.fn(),
    career: { endFestival: vi.fn() },
    selectedMachinePreview: vi.fn(),
    menuPreviewReceipt: { request: vi.fn() },
    replayClock: { playing: true },
    ui: {
      modal,
      telemetryModal: { open: false },
      showMode: vi.fn(),
      setText: vi.fn(),
      ready: vi.fn(),
      toast: vi.fn(),
      pause: () => (modal.open = true),
      closeModal: () => (modal.open = false),
    },
  });
  const actions: string[] = [];
  const input = new InputController(structuredClone(DEFAULT_SETTINGS), (name) => {
    actions.push(name);
    app.action(name);
  });
  app.input = input;
  input.setEnabled(true);
  let session: Session | null = null;
  if (mode === 'festival') {
    app.state = 'festival';
    await app.festivalOwner.start({
      load: async () => null,
      create: async (_module, scope) => {
        const lifetime = new SessionLifetime('Fixture Festival closed', scope.signal);
        const hud = {
          menuOpen: false,
          mapOpen: false,
          cardOpen: false,
          resultsOpen: false,
          showMenu(value: boolean) {
            this.menuOpen = value;
          },
          showMap(value: boolean) {
            this.mapOpen = value;
          },
          dispose: vi.fn(),
        };
        const host = {
          canvas: {},
          driving: scope.guard((value: boolean) => input.setEnabled(value)),
          exit: scope.guard(() => app.exitFestival()),
          toast: scope.guard(sessionToast),
          audio: { stop: vi.fn() },
        };
        session = Object.assign(Object.create(festivalPrototype) as Session, {
          lifetime,
          disposed: false,
          booting: false,
          travelling: false,
          controls: null,
          host,
          worker,
          tiles: { onerror: null, onmessageerror: null, terminate: vi.fn() },
          liveFrames: new LiveFrameClock(),
          hud,
          renderer: null,
          traffic: null,
          riders: null,
          status: null,
          save: { vehicle: 'tc1', discovered: [], traffic: false },
          readyTimer: null,
          readyResolve: null,
          readyReject: null,
          commandRequests: new Map(),
          photoKeys: () => undefined,
        });
        lifetime.signal.addEventListener('abort', () => session?.dispose(), { once: true });
        session.installControls(host, hud);
        session.controls!.syncInput();
        return session;
      },
      ready: (value) => input.setEnabled(value.drivingInputEnabled),
      failed: () => {
        throw new Error('Unexpected fixture startup failure');
      },
    });
  }
  app.installInputPump();
  const pump = app.inputPump;
  pump.start();
  cleanup.push(() => {
    pump.dispose();
    app.festivalOwner.cancel();
    input.dispose();
  });
  const driveMessages = () => messages.filter((message) => message.type === 'input');
  const key = (code: string) =>
    window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false }),
    );
  return {
    app,
    input,
    pump,
    session: session as Session | null,
    interval,
    actions,
    first,
    document,
    window,
    worker,
    pauseFailure,
    sessionToast,
    messages,
    driveMessages,
    key,
    setPads: (value: (Pad | null)[]) => (pads = value),
    failPause: () => (failPause = true),
    disconnect: (pad: Pad) =>
      window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: pad })),
  };
}

function heldReplacement(index: number) {
  const pad = gamepad(index, 'New controller with held controls');
  pad.axes[0] = 0.9;
  for (const id of [3, 5, 6, 7, 9]) pad.buttons[id] = button(1);
  return pad;
}

function neutralState(mode: 'circuit' | 'festival') {
  // The main circuit publisher adds these optional false action fields before
  // the first send. InputController.reset() retains their neutral values.
  return mode === 'circuit' ? { ...controls(), drs: false, overtake: false } : controls();
}

describe('controller and session publication ownership', () => {
  for (const mode of ['circuit', 'festival'] as const) {
    it.each([
      'automatic replacement',
      'same-slot replacement',
      'disconnect first',
      'blur',
      'hidden',
    ])(
      `${mode}: %s during a pump run publishes pause before any further drive command`,
      async (loss) => {
        const f = await fixture(mode);
        f.pump.poll();
        const initial = f.driveMessages().at(-1)!;
        expect(initial.input?.throttle).toBe(0.4);
        f.key(f.input.settings.bindings.shiftUp);
        expect(f.input.state.shift).toBe(1);
        const replacement = heldReplacement(loss === 'same-slot replacement' ? 0 : 1);
        f.setPads(replacement.index === 0 ? [replacement] : [null, replacement]);
        const start = f.messages.length;
        if (loss === 'disconnect first') f.disconnect(f.first);
        else if (loss === 'blur') f.window.dispatchEvent(new Event('blur'));
        else if (loss === 'hidden') {
          f.document.hidden = true;
          f.document.dispatchEvent(new Event('visibilitychange'));
        }
        f.pump.poll();
        expect(f.input.state).toEqual(neutralState(mode));
        expect(f.actions).toEqual([loss === 'blur' || loss === 'hidden' ? 'blur' : 'deviceLost']);
        expect(f.messages.slice(start).map(({ type, value }) => ({ type, value }))).toEqual([
          { type: 'pause', value: true },
        ]);
        if (mode === 'circuit') expect(f.app.state).toBe('paused');
        else expect(f.session!.drivingInputEnabled).toBe(false);
        f.document.hidden = false;
        vi.advanceTimersByTime(500);
        f.disconnect(f.first);
        expect(f.driveMessages()).toHaveLength(1);
        expect(initial.input?.throttle).toBe(0.4);
        expect(f.input.state).toEqual(neutralState(mode));

        // A deliberate resume is the first point at which the replacement's
        // analog input may drive. Its held pause/camera/shift buttons stay a
        // baseline rather than causing an implicit second action.
        f.app.action('pause');
        const resumed = f.driveMessages().length;
        f.pump.poll();
        expect(f.driveMessages()).toHaveLength(resumed + 1);
        expect(f.driveMessages().at(-1)!.input).toMatchObject({ throttle: 1, brake: 1, shift: 0 });
        expect(f.actions).toHaveLength(1);
      },
    );

    it(`${mode}: canceled timer callbacks cannot publish into a resumed pump generation`, async () => {
      const f = await fixture(mode);
      f.pump.poll();
      const oldTick = f.interval.mock.calls.at(-1)![0] as () => void;
      f.window.dispatchEvent(new Event('blur'));
      f.pump.dispose();
      f.pump.start();
      f.app.action('pause');
      const before = f.driveMessages().length;
      oldTick();
      expect(f.driveMessages()).toHaveLength(before);
      vi.advanceTimersByTime(20);
      expect(f.driveMessages()).toHaveLength(before + 1);
    });
  }

  it('circuit replay action-only polling cannot publish a held replacement or resume playback', async () => {
    const f = await fixture('circuit');
    f.pump.poll();
    f.app.state = 'replay';
    f.setPads([heldReplacement(0)]);
    f.pump.poll();
    expect(f.actions).toEqual(['deviceLost']);
    expect(f.app.replayClock).toEqual({ playing: false });
    expect(f.input.state).toEqual(neutralState('circuit'));
    expect(f.driveMessages()).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(f.app.state).toBe('replay');
    expect(f.app.replayClock).toEqual({ playing: false });
    expect(f.actions).toEqual(['deviceLost']);
    expect(f.driveMessages()).toHaveLength(1);
  });

  it('Festival terminal ownership cancels pending work and leaves later pump callbacks without a drive target', async () => {
    const f = await fixture('festival');
    f.pump.poll();
    const session = f.session!;
    const pending = session.lifetime
      .wait(new Promise<void>(() => undefined))
      .catch((error) => error);
    f.app.exitFestival();
    expect(await pending).toBe(session.lifetime.signal.reason);
    expect(session.disposed).toBe(true);
    expect(session.controls).toBeNull();
    expect(f.app.festival).toBeNull();
    expect(f.app.state).toBe('menu');
    f.pump.poll();
    vi.advanceTimersByTime(500);
    session.input({ ...controls(), throttle: 1 });
    expect(f.driveMessages()).toHaveLength(1);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['device loss', 'pause button'] as const)(
    'Festival %s can exit synchronously on a pause transport failure without dereferencing the departed session',
    async (cause) => {
      const f = await fixture('festival');
      f.pump.poll();
      f.failPause();
      if (cause === 'device loss') f.setPads([heldReplacement(0)]);
      else f.first.buttons[9] = button(1);
      expect(() => f.pump.poll()).not.toThrow();
      expect(f.app.festival).toBeNull();
      expect(f.app.state).toBe('menu');
      expect(f.session!.disposed).toBe(true);
      expect(f.session!.lifetime.signal.reason).toBe(f.pauseFailure);
      expect(f.sessionToast).toHaveBeenCalledExactlyOnceWith(
        'Festival error: Pause transport unavailable',
      );
      expect(f.driveMessages()).toHaveLength(1);
      vi.advanceTimersByTime(500);
      expect(f.driveMessages()).toHaveLength(1);
    },
  );
});
