import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { Rumble } from '../src/input/rumble.ts';
import { H } from '../src/simulation/protocol.ts';

/** Execute complete production methods without main.ts's automatic DOM boot.
 * No cleanup operation or lifecycle branch is copied into the test harness. */
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
const methods = ['fail', 'dispose', 'pause', 'suspendPlayback'].map((name) => {
  const member = owner?.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === name,
  );
  if (!member) throw new Error(`GameApp.${name} must exist for the integration check`);
  return member.getText(source);
});
const code = ts.transpileModule(`class Host { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const stages = [
  'startup',
  'timeout',
  'reference',
  'session',
  'tab',
  'performance',
  'review',
  'festival',
  'demo',
  'worker',
  'input',
  'rumble',
  'audio',
  'log',
  'screen',
] as const;
type Stage = (typeof stages)[number];
interface HostMethods {
  fail(error: unknown): void;
  dispose(): void;
  pause(): void;
  suspendPlayback(): void;
}

function fixture() {
  const release = Object.fromEntries(stages.map((name) => [name, vi.fn()])) as Record<
    Stage,
    Mock<(...args: unknown[]) => void>
  >;
  const document = { pointerLockElement: null, exitPointerLock: vi.fn() };
  const dependencies = {
    clearTimeout: release.timeout,
    console: { error: release.log, warn: vi.fn() },
    document,
    H,
    racingSession: () => true,
    window: { removeEventListener: vi.fn() },
    cancelAnimationFrame: vi.fn(),
  };
  const prototype = new Function(...Object.keys(dependencies), `${code}; return Host.prototype;`)(
    ...Object.values(dependencies),
  ) as HostMethods;
  const disposable = () => ({ dispose: vi.fn() });
  const worker = { terminate: release.worker };
  const startup = { close: release.startup };
  const host = Object.assign(Object.create(prototype) as HostMethods, {
    disposed: false,
    errorStopped: false,
    generation: 1,
    circuitStartup: startup as typeof startup | null,
    worker: worker as typeof worker | null,
    initTimeout: 42,
    state: 'driving',
    current: null,
    options: { mode: 'race' },
    referenceSession: { interrupt: release.reference, ...disposable() },
    sessionReview: { stop: release.session },
    tabEvidence: { observe: release.tab, ...disposable() },
    performanceCapture: { interrupt: release.performance },
    interruptReview: release.review,
    festivalOwner: { cancel: release.festival },
    endDemoClock: release.demo,
    input: { setEnabled: release.input, ...disposable() },
    rumble: { stop: release.rumble } as Pick<Rumble, 'stop'>,
    audio: { stop: release.audio, dispose: vi.fn(async () => {}) },
    ui: {
      error: release.screen,
      showMode: vi.fn(),
      pause: vi.fn(),
      setText: vi.fn(),
      gridPresentationAvailable: false,
    },
    post: vi.fn(),
    replayClock: { playing: true },
    gridClock: { pause: vi.fn() },
    gridPanel: null,
    reviewVideo: disposable(),
    exporter: { cancel: vi.fn() },
    replay: null,
    inputPump: disposable(),
    mediaView: null,
    menuFrames: disposable(),
    menuPreviewReceipt: disposable(),
    renderer: null,
    uiSounds: disposable(),
  });
  return { host, release, worker, startup };
}

describe('host fatal cleanup', () => {
  it.each(stages)(
    'finishes the terminal path when %s throws and reports the original error once',
    (stage) => {
      const f = fixture(),
        error = new Error('Physics failed');
      f.release[stage].mockImplementation(() => {
        throw new Error(`${stage} cleanup failed`);
      });

      expect(() => f.host.fail(error)).not.toThrow();
      f.host.fail(new Error('Later failure'));

      expect(f.host.errorStopped).toBe(true);
      expect(f.host.circuitStartup).toBeNull();
      expect(f.host.worker).toBeNull();
      expect(f.host.initTimeout).toBe(0);
      for (const cleanup of Object.values(f.release)) expect(cleanup).toHaveBeenCalledOnce();
      expect(f.release.startup).toHaveBeenCalledWith(error);
      expect(f.release.timeout).toHaveBeenCalledWith(42);
      expect(f.release.input).toHaveBeenCalledWith(false);
      expect(f.release.rumble).toHaveBeenCalledWith(null);
      expect(f.release.log).toHaveBeenCalledWith(error);
      expect(f.release.screen).toHaveBeenCalledWith('Physics failed');
    },
  );

  it.each(['startup', 'festival', 'worker'] as const)(
    'revokes owners before a reentrant %s callback',
    (stage) => {
      const f = fixture(),
        error = new Error('First failure');
      const ownersAtCallback: unknown[] = [];
      f.release[stage].mockImplementation(() => {
        ownersAtCallback.push(f.host.circuitStartup, f.host.worker, f.host.initTimeout);
        f.host.fail(new Error('Reentrant failure'));
      });

      f.host.fail(error);

      expect(ownersAtCallback).toEqual([null, null, 0]);
      for (const cleanup of Object.values(f.release)) expect(cleanup).toHaveBeenCalledOnce();
      expect(f.release.log).toHaveBeenCalledWith(error);
      expect(f.release.screen).toHaveBeenCalledWith(error.message);
    },
  );

  it('terminates the detached worker once when terminate reenters actual host disposal', () => {
    const f = fixture(),
      error = new Error('Worker failed');
    f.release.worker.mockImplementation(() => f.host.dispose());

    expect(() => f.host.fail(error)).not.toThrow();
    f.host.dispose();
    f.host.fail(new Error('Late failure'));

    expect(f.host.disposed).toBe(true);
    expect(f.host.input.dispose).toHaveBeenCalledOnce();
    expect(f.host.uiSounds.dispose).toHaveBeenCalledOnce();
    expect(f.host.worker).toBeNull();
    expect(f.release.worker).toHaveBeenCalledOnce();
    expect(f.release.startup).toHaveBeenCalledOnce();
    expect(f.release.log).toHaveBeenCalledExactlyOnceWith(error);
    expect(f.release.screen).toHaveBeenCalledExactlyOnceWith(error.message);
  });

  it('reports a non-Error rejection and supplies an Error to startup cancellation', () => {
    const f = fixture();
    f.host.fail('Worker unavailable');
    expect(f.release.startup).toHaveBeenCalledWith(new Error('Worker unavailable'));
    expect(f.release.log).toHaveBeenCalledExactlyOnceWith('Worker unavailable');
    expect(f.release.screen).toHaveBeenCalledExactlyOnceWith('Worker unavailable');
  });

  it('ignores errors after the host has been disposed', () => {
    const f = fixture();
    f.host.disposed = true;
    f.host.fail(new Error('Late failure'));
    for (const cleanup of Object.values(f.release)) expect(cleanup).not.toHaveBeenCalled();
  });
});

describe('host haptic suspension without another snapshot', () => {
  it.each([
    ['pause', 'driving'],
    ['suspendPlayback', 'driving'],
    ['suspendPlayback', 'replay'],
    ['suspendPlayback', 'pregame'],
    ['suspendPlayback', 'paused'],
    ['suspendPlayback', 'menu'],
    ['fail', 'driving'],
  ] as const)('%s from %s immediately releases the real owned actuator', (transition, state) => {
    const f = fixture(),
      rumble = new Rumble();
    const actuator = {
      playEffect: vi.fn(() => Promise.resolve('complete' as const)),
      reset: vi.fn(() => Promise.resolve('complete' as const)),
    };
    rumble.update(
      { vibrationActuator: actuator } as unknown as Gamepad,
      { weak: 0.5, strong: 0.3 },
      0,
    );
    f.host.rumble = rumble;
    f.host.state = state;
    const leave = () =>
      transition === 'fail' ? f.host.fail(new Error('Application error')) : f.host[transition]();

    leave();

    // No event, timer, promise turn or accepted snapshot is needed to reset.
    expect(actuator.reset).toHaveBeenCalledOnce();
    leave();
    expect(actuator.reset).toHaveBeenCalledOnce();
    expect(actuator.playEffect).toHaveBeenCalledOnce();
    if (state === 'driving' && transition !== 'fail') {
      expect(f.host.state).toBe('paused');
      expect(f.host.post).toHaveBeenCalledExactlyOnceWith({ type: 'pause', value: true });
      expect(f.release.input).toHaveBeenCalledExactlyOnceWith(false);
    }
  });
});
