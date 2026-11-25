import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RacingAudio } from '../src/audio/engine.ts';
import { validateDrivingAudio } from '../src/audio/driving-cues.ts';
import { FakeContext, asContext, type FakeNode, type ParamEvent } from './fake-audio.ts';

class LiveContext extends FakeContext {
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

const settings = validateDrivingAudio(null);
const cleanup: (() => Promise<void>)[] = [];

async function audioFixture() {
  const audio = new RacingAudio(),
    context = new LiveContext();
  await audio.start(asContext(context));
  cleanup.push(() => audio.dispose());
  return { audio, context };
}

function holdResume(context: LiveContext) {
  let resolve!: () => void;
  context.state = 'suspended';
  context.resume.mockReturnValue(new Promise<void>((ready) => (resolve = ready)));
  return () => {
    context.state = 'running';
    resolve();
  };
}

function previewGain(context: LiveContext): FakeNode {
  const oscillator = context
    .of('oscillator')
    .find((node) =>
      node.frequency.events.some((event) => event.kind === 'set' && event.value === 800),
    );
  expect(oscillator, 'the real preview oscillator scheduled its center tone').toBeDefined();
  return oscillator!.outputs[0];
}

/** Apply cancellation to the recorded automation, without pretending to render
 * audio. A native OfflineAudioContext covers the resulting waveform separately. */
function scheduled(events: ParamEvent[]) {
  return events.reduce<ParamEvent[]>((pending, event) => {
    if (event.kind === 'cancel') return pending.filter((item) => item.time < event.time);
    return [...pending, event];
  }, []);
}

function expectCancelled(gain: FakeNode, time: number) {
  expect(gain.gain.events.slice(-2)).toEqual([
    { kind: 'cancel', value: 0, time },
    { kind: 'target', value: 0, time },
  ]);
  expect(
    scheduled(gain.gain.events).filter((event) => event.time >= time && event.value > 0),
  ).toEqual([]);
}

function previewTones(context: LiveContext) {
  return context
    .of('oscillator')
    .flatMap((node) =>
      node.frequency.events.filter((event) => event.kind === 'set' && event.value === 800),
    );
}

// Execute the complete production suspension/disposal methods and the actual
// listener registrations. This avoids the application's automatic renderer boot.
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
const members = ['suspendOnBlur', 'suspendPlayback', 'dispose'].map((name) => {
  const member = owner.members.find((node) => node.name?.getText(source) === name);
  if (!member) throw new Error(`Missing GameApp.${name}`);
  return member.getText(source);
});
const registrations = owner.members.filter(ts.isConstructorDeclaration).flatMap((constructor) =>
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
  `class Host { ${members.join('\n')} install() { ${registrations.join('\n')} } }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

function hostFixture(audio: RacingAudio, state: 'menu' | 'paused') {
  const window = new EventTarget(),
    document = Object.assign(new EventTarget(), { hidden: false });
  const Host = new Function('window', 'document', `${hostCode}; return Host;`)(
    window,
    document,
  ) as new () => { install(): void; dispose(): void };
  const disposable = () => ({ dispose: vi.fn() });
  const host = Object.assign(new Host(), {
    audio,
    pageWaiters: new Set<() => void>(),
    state,
    generation: 0,
    initTimeout: 0,
    rumble: { stop: vi.fn() },
    referenceSession: { interrupt: vi.fn(), ...disposable() },
    menuFrames: { suspend: vi.fn(), ...disposable() },
    sessionReview: { stop: vi.fn() },
    tabEvidence: disposable(),
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    reviewVideo: disposable(),
    exporter: { cancel: vi.fn() },
    inputPump: disposable(),
    ui: disposable(),
    festivalOwner: { cancel: vi.fn() },
    endDemoClock: vi.fn(),
    input: disposable(),
    menuPreviewReceipt: disposable(),
    uiSounds: disposable(),
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  host.install();
  return { host, window, document };
}

afterEach(async () => {
  for (const release of cleanup.splice(0)) await release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('driving audio preview cancellation', () => {
  it('keeps visible menu previews audible through the paused race master', async () => {
    const { audio, context } = await audioFixture();
    audio.stop();
    await audio.previewDriving(settings);
    const gain = previewGain(context);
    expect(context.nodes[0].gain.value).toBe(0);
    expect(context.reaches(gain, context.nodes[0])).toBe(false);
    expect(context.reaches(gain, context.destination)).toBe(true);
    expect(
      scheduled(gain.gain.events)
        .filter((event) => event.value > 0)
        .map((event) => event.time),
    ).toEqual([0.012, 0.262, 0.512]);
  });

  it('immediately cancels future preview tones on public mute, including after unmute', async () => {
    const { audio, context } = await audioFixture();
    await audio.previewDriving(settings);
    const gain = previewGain(context);
    context.currentTime = 0.1;
    audio.muted = true;
    expect(audio.muted).toBe(true);
    expectCancelled(gain, 0.1);
    audio.muted = false;
    expectCancelled(gain, 0.1);
    context.currentTime = 1;
    await audio.previewDriving(settings);
    expect(previewTones(context)).toHaveLength(2);
  });

  it('revokes pending activation through mute/unmute and accepts a fresh request', async () => {
    const { audio, context } = await audioFixture();
    const resume = holdResume(context);
    const preview = audio.previewDriving(settings);
    audio.muted = true;
    audio.muted = false;
    resume();
    await preview;
    expect(previewTones(context)).toHaveLength(0);
    await audio.previewDriving(settings);
    expect(previewTones(context)).toHaveLength(1);
  });

  it('does not queue a request made while muted for a later unmute', async () => {
    const { audio, context } = await audioFixture();
    audio.muted = true;
    const resume = holdResume(context);
    const preview = audio.previewDriving(settings);
    audio.muted = false;
    resume();
    await preview;
    expect(context.resume).not.toHaveBeenCalled();
    expect(previewTones(context)).toHaveLength(0);
  });

  it.each(['menu', 'paused'] as const)(
    'cancels scheduled preview tones on window blur from %s',
    async (state) => {
      const { audio, context } = await audioFixture();
      const { host, window } = hostFixture(audio, state);
      await audio.previewDriving(settings);
      const gain = previewGain(context);
      context.currentTime = 0.1;
      window.dispatchEvent(new Event('blur'));
      expectCancelled(gain, 0.1);
      expect(host.rumble.stop).toHaveBeenCalledWith(null);
      expect(host.state).toBe(state);
      expect(context.close).not.toHaveBeenCalled();
      context.currentTime = 1;
      await audio.previewDriving(settings);
      expect(previewTones(context)).toHaveLength(2);
    },
  );

  it.each(['blur', 'visibilitychange'] as const)(
    'revokes pending menu previews on %s before activation settles',
    async (event) => {
      const { audio, context } = await audioFixture();
      const { window, document } = hostFixture(audio, 'menu');
      const resume = holdResume(context);
      const preview = audio.previewDriving(settings);
      if (event === 'blur') window.dispatchEvent(new Event(event));
      else {
        document.hidden = true;
        document.dispatchEvent(new Event(event));
        document.hidden = false;
      }
      resume();
      await preview;
      expect(previewTones(context)).toHaveLength(0);
      await audio.previewDriving(settings);
      expect(previewTones(context)).toHaveLength(1);
    },
  );

  it('removes the owned blur listener when the host is disposed', async () => {
    const { audio } = await audioFixture();
    const { host, window } = hostFixture(audio, 'menu');
    const stop = vi.spyOn(audio, 'stop');
    host.dispose();
    const stopped = stop.mock.calls.length;
    window.dispatchEvent(new Event('blur'));
    expect(stop).toHaveBeenCalledTimes(stopped);
    expect(host.referenceSession.interrupt).not.toHaveBeenCalled();
  });
});
