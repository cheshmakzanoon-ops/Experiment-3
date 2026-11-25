import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RacingAudio } from '../src/audio/engine.ts';
import { validateDrivingAudio } from '../src/audio/driving-cues.ts';
import { InputController } from '../src/input/controller.ts';
import { InputPump } from '../src/input/pump.ts';
import { Rumble } from '../src/input/rumble.ts';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { controls, racingSession, type Controls } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { PauseHandshake } from '../src/workers/diagnostics.ts';
import { FakeContext, asContext } from './fake-audio.ts';

/** These are complete production handlers, registrations and the production
 * sampling callback. Only browser hardware, UI and worker delivery are seams;
 * controller, pump, audio graph and rumble ownership all run together. */
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
const members = ['post', 'action', 'pause', 'resume', 'suspendOnBlur', 'suspendPlayback'].map(
  (name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing GameApp.${name}`);
    return member.getText(source);
  },
);
const pumpAssignments: ts.BinaryExpression[] = [];
function findPump(node: ts.Node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    node.left.getText(source) === 'this.inputPump' &&
    ts.isNewExpression(node.right)
  )
    pumpAssignments.push(node);
  ts.forEachChild(node, findPump);
}
findPump(owner);
if (pumpAssignments.length !== 1) throw new Error('Expected one production input pump');
const listeners = owner.members.filter(ts.isConstructorDeclaration).flatMap((constructor) =>
  constructor
    .body!.statements.filter((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
        return false;
      const call = statement.expression;
      return (
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === 'addEventListener' &&
        ts.isStringLiteral(call.arguments[0]) &&
        ['blur', 'visibilitychange'].includes(call.arguments[0].text)
      );
    })
    .map((statement) => statement.getText(source)),
);
const hostCode = ts.transpileModule(
  `class Host {
    ${members.join('\n')}
    install() {
      ${pumpAssignments[0].getText(source)};
      ${listeners.join('\n')}
    }
  }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

interface Host {
  state: string;
  input: InputController;
  inputPump: InputPump;
  suspendOnBlur(): void;
  install(): void;
  action(name: string): void;
}
interface Message {
  type: string;
  value?: boolean;
  input?: Controls;
}
class LiveContext extends FakeContext {
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}
const button = (value = 0) => ({ pressed: value > 0, touched: value > 0, value });
function pad(id: string) {
  return {
    index: 0,
    id,
    connected: true,
    mapping: 'standard' as GamepadMappingType,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => button()),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ready, failed) => {
    resolve = ready;
    reject = failed;
  });
  return { promise, resolve, reject };
}
const cleanup: (() => Promise<void>)[] = [];
const cueSettings = validateDrivingAudio(null);
function centerTones(context: LiveContext) {
  return context
    .of('oscillator')
    .flatMap((node) =>
      node.frequency.events.filter((event) => event.kind === 'set' && event.value === 800),
    );
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fixture() {
  const window = new EventTarget();
  const modal = { open: false };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    pointerLockElement: null,
    activeElement: null,
    querySelector: () => (modal.open ? {} : null),
  });
  let pads = [pad('Original controller')];
  pads[0].buttons[7] = button(0.4);
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const HostClass = new Function(
    'window',
    'document',
    'InputPump',
    'controls',
    'H',
    'racingSession',
    't',
    `${hostCode}; return Host;`,
  )(
    window,
    document,
    InputPump,
    controls,
    H,
    racingSession,
    (value: string) => value,
  ) as new () => Host;
  const audio = new RacingAudio(),
    context = new LiveContext(),
    rumble = new Rumble();
  const effect = deferred<GamepadHapticsResult>();
  const actuator = {
    playEffect: vi.fn((): Promise<GamepadHapticsResult> => Promise.resolve('complete')),
    reset: vi.fn(() => Promise.resolve('complete' as const)),
  };
  actuator.playEffect.mockReturnValueOnce(effect.promise);
  const messages: Message[] = [];
  const host = Object.assign(new HostClass(), {
    state: 'driving',
    errorStopped: false,
    disposed: false,
    savingSettings: false,
    festival: null,
    current: null,
    renderer: null,
    mediaView: null,
    ers: 1,
    drsPress: false,
    overtakePress: false,
    settings: structuredClone(DEFAULT_SETTINGS),
    audio,
    rumble,
    worker: { postMessage: (message: Message) => messages.push(structuredClone(message)) },
    workerPause: new PauseHandshake(),
    liveFrames: new LiveFrameClock(),
    referenceSession: { interrupt: vi.fn() },
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    sessionReview: { event: vi.fn() },
    tabEvidence: { observe: vi.fn() },
    observeSession: vi.fn(),
    menuFrames: { suspend: vi.fn() },
    ui: {
      modal,
      telemetryModal: { open: false },
      showMode: vi.fn(),
      toast: vi.fn(),
      pause: () => (modal.open = true),
      closeModal: () => (modal.open = false),
    },
  });
  const actions: string[] = [];
  const input = new InputController(host.settings, (name) => {
    actions.push(name);
    host.action(name);
  });
  host.input = input;
  input.setEnabled(true);
  host.install();
  host.inputPump.start();
  await audio.start(asContext(context));
  const hapticPad = { vibrationActuator: actuator } as unknown as Gamepad;
  rumble.update(hapticPad, { weak: 0.5, strong: 0.3 }, 0);
  host.inputPump.poll(); // Establish real controller and button baselines.
  messages.length = 0;
  cleanup.push(async () => {
    host.inputPump.dispose();
    input.dispose();
    window.removeEventListener('blur', host.suspendOnBlur);
    rumble.stop(null);
    await audio.dispose();
  });
  function key(code: string, repeat = false) {
    window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { code, repeat }),
    );
    if (!repeat) window.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  }
  function holdPreview() {
    const resume = deferred<void>();
    context.state = 'suspended';
    context.resume.mockReturnValue(resume.promise);
    const preview = audio.previewDriving(cueSettings);
    return {
      preview,
      release() {
        context.state = 'running';
        resume.resolve();
      },
    };
  }
  return {
    host,
    input,
    audio,
    context,
    rumble,
    actuator,
    effect,
    hapticPad,
    window,
    document,
    actions,
    messages,
    key,
    holdPreview,
    original: pads[0],
    setPad: (value: ReturnType<typeof pad>) => (pads = [value]),
    drive: () =>
      messages.filter((message) => message.type === 'input').map((message) => message.input!),
    sample: () => host.inputPump.poll(),
  };
}

describe('audio, controller and haptics share host focus ownership', () => {
  it.each(['blur', 'hidden'] as const)(
    '%s clears pending input and audio activation, and old haptic completion cannot stop resumed output',
    async (loss) => {
      const f = await fixture();
      const pending = f.holdPreview();
      f.key(f.input.settings.bindings.shiftUp);
      f.key(f.input.settings.bindings.shiftDown);
      f.original.buttons[f.input.settings.mapping.shiftUpButton] = button(1);
      if (loss === 'blur') f.window.dispatchEvent(new Event('blur'));
      else {
        f.document.hidden = true;
        f.document.dispatchEvent(new Event('visibilitychange'));
      }
      expect(f.host.state).toBe('paused');
      expect(f.messages.map(({ type, value }) => ({ type, value }))).toEqual([
        { type: 'pause', value: true },
      ]);
      expect(f.input.state).toMatchObject({ throttle: 0, brake: 0, shift: 0 });
      expect(f.actuator.reset).toHaveBeenCalledOnce();
      f.sample();
      expect(f.drive()).toEqual([]);
      pending.release();
      await pending.preview;
      expect(centerTones(f.context)).toHaveLength(0);
      f.document.hidden = false;
      f.key('Escape', true); // An old repeat is not a deliberate resume.
      expect(f.host.state).toBe('paused');
      f.key('Escape');
      expect(f.host.state).toBe('driving');
      f.sample();
      expect(f.drive().at(-1)).toMatchObject({ throttle: 0.4, shift: 0 });
      f.original.buttons[f.input.settings.mapping.shiftUpButton] = button();
      f.sample();
      f.original.buttons[f.input.settings.mapping.shiftUpButton] = button(1);
      f.sample();
      expect(f.drive().at(-1)?.shift).toBe(1);
      f.sample();
      expect(f.drive().at(-1)?.shift).toBe(0);
      f.rumble.update(f.hapticPad, { weak: 0.7, strong: 0.2 }, 10);
      expect(f.actuator.playEffect).toHaveBeenCalledTimes(2);
      f.effect.reject(new Error('Old effect completed after focus changed'));
      await Promise.resolve();
      expect(f.actuator.reset).toHaveBeenCalledOnce();
      await f.audio.previewDriving(cueSettings);
      expect(centerTones(f.context)).toHaveLength(1);
      expect(f.context.close).not.toHaveBeenCalled();
    },
  );

  it('a replacement controller detected by the production pump pauses all three owners before publishing its held controls', async () => {
    const f = await fixture(),
      pending = f.holdPreview();
    f.key(f.input.settings.bindings.shiftUp);
    f.key(f.input.settings.bindings.shiftDown);
    const replacement = pad('Replacement with held buttons');
    replacement.buttons[7] = button(0.7);
    replacement.buttons[f.input.settings.mapping.shiftUpButton] = button(1);
    replacement.buttons[f.input.settings.mapping.buttonActions.pause] = button(1);
    f.setPad(replacement);
    f.sample();
    expect(f.actions).toEqual(['deviceLost']);
    expect(f.messages.map(({ type, value }) => ({ type, value }))).toEqual([
      { type: 'pause', value: true },
    ]);
    expect(f.host.state).toBe('paused');
    expect(f.actuator.reset).toHaveBeenCalledOnce();
    pending.release();
    await pending.preview;
    expect(centerTones(f.context)).toHaveLength(0);
    f.sample();
    expect(f.host.state).toBe('paused');
    f.key('Escape');
    f.sample();
    expect(f.drive().at(-1)).toMatchObject({ throttle: 0.7, shift: 0 });
    expect(f.actions).toEqual(['deviceLost', 'pause']);
    expect(f.host.state).toBe('driving');
  });

  it('keyboard mute/unmute cancels delayed preview intent while preserving queued shift order and haptic ownership', async () => {
    const f = await fixture(),
      pending = f.holdPreview();
    f.key(f.input.settings.bindings.shiftUp);
    f.key(f.input.settings.bindings.mute);
    f.key(f.input.settings.bindings.shiftDown);
    f.key(f.input.settings.bindings.mute);
    expect(f.audio.muted).toBe(false);
    expect(f.host.state).toBe('driving');
    f.sample();
    f.sample();
    f.sample();
    expect(f.drive().map((input) => input.shift)).toEqual([1, -1, 0]);
    expect(f.actuator.reset).not.toHaveBeenCalled();
    pending.release();
    await pending.preview;
    expect(centerTones(f.context)).toHaveLength(0);
    await f.audio.previewDriving(cueSettings);
    expect(centerTones(f.context)).toHaveLength(1);
  });

  it('paused action polling preserves a deliberate preview until host blur cancels it even with driving input disabled', async () => {
    const f = await fixture();
    f.key('Escape');
    expect(f.host.state).toBe('paused');
    f.original.buttons[f.input.settings.mapping.shiftUpButton] = button(1);
    await f.audio.previewDriving(cueSettings);
    const center = f.context
      .of('oscillator')
      .find((node) =>
        node.frequency.events.some((event) => event.kind === 'set' && event.value === 800),
      )!;
    const envelope = center.outputs[0].gain;
    const before = envelope.events.length;
    f.sample();
    f.sample();
    expect(envelope.events).toHaveLength(before);
    expect(f.drive()).toEqual([]);
    expect(f.input.state.shift).toBe(0);
    f.context.currentTime = 0.1;
    f.window.dispatchEvent(new Event('blur'));
    expect(envelope.events.slice(-2)).toEqual([
      { kind: 'cancel', value: 0, time: 0.1 },
      { kind: 'target', value: 0, time: 0.1 },
    ]);
    expect(f.actions).toEqual(['pause']);
    expect(f.messages.filter((message) => message.type === 'pause')).toHaveLength(1);
    f.context.currentTime = 1;
    await f.audio.previewDriving(cueSettings);
    expect(centerTones(f.context)).toHaveLength(2);
  });
});
