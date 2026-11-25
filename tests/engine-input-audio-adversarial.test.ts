import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RacingAudio } from '../src/audio/engine.ts';
import { validateDrivingAudio } from '../src/audio/driving-cues.ts';
import { InputController } from '../src/input/controller.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { FakeContext, asContext } from './fake-audio.ts';

const cleanup: (() => void | Promise<void>)[] = [];
const button = (pressed = false) => ({ pressed, touched: pressed, value: Number(pressed) });

function inputFixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const pad = {
    index: 0,
    id: 'Adversarial controller',
    connected: true,
    mapping: 'standard' as GamepadMappingType,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => button()),
  };
  let selected = pad;
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads: () => [selected] });
  const settings = structuredClone(DEFAULT_SETTINGS);
  const action = vi.fn<(name: string) => void>();
  const input = new InputController(settings, action);
  input.setEnabled(true);
  input.update(1 / 60);
  cleanup.push(() => input.dispose());
  return { input, settings, action, pad, select: (value: typeof pad) => (selected = value) };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((ready, failed) => {
    resolve = ready;
    reject = failed;
  });
  return { promise, resolve, reject };
}

class LiveContext extends FakeContext {
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

const previewSettings = validateDrivingAudio(null);
function centerTones(context: FakeContext) {
  return context
    .of('oscillator')
    .flatMap((oscillator) =>
      oscillator.frequency.events.filter((event) => event.kind === 'set' && event.value === 800),
    );
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) await release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('controller action callbacks own complete button observations', () => {
  it('consumes simultaneous held actions before a host callback polls actions reentrantly', () => {
    const f = inputFixture();
    f.action.mockImplementation((name) => {
      if (name === 'camera') f.input.pollActions('driving');
    });
    f.pad.buttons[f.settings.mapping.buttonActions.camera] = button(true);
    f.pad.buttons[f.settings.mapping.buttonActions.pause] = button(true);
    f.pad.buttons[f.settings.mapping.shiftUpButton] = button(true);
    expect(f.input.update(1 / 60).shift).toBe(1);
    expect(f.action.mock.calls).toEqual([['camera']]);
    // Reading controls has not acknowledged the one driving edge.
    expect(f.input.update(1 / 60).shift).toBe(1);
    f.input.state.shift = 0;
    expect(f.input.update(1 / 60).shift).toBe(0);
    expect(f.action.mock.calls).toEqual([['camera']]);

    f.pad.buttons[f.settings.mapping.buttonActions.pause] = button();
    f.input.pollActions('paused');
    f.pad.buttons[f.settings.mapping.buttonActions.pause] = button(true);
    f.input.pollActions('paused');
    expect(f.action.mock.calls).toEqual([['camera'], ['pause']]);
  });

  it('does not turn a simultaneous held action into a deferred command after a callback throws', () => {
    const f = inputFixture();
    const failure = new Error('Host action failed');
    f.action.mockImplementationOnce(() => {
      throw failure;
    });
    f.pad.buttons[f.settings.mapping.buttonActions.camera] = button(true);
    f.pad.buttons[f.settings.mapping.buttonActions.pause] = button(true);
    expect(() => f.input.update(1 / 60)).toThrow(failure);
    f.input.pollActions('paused');
    f.input.pollActions('driving');
    expect(f.action.mock.calls).toEqual([['camera']]);
    f.pad.buttons[f.settings.mapping.buttonActions.pause] = button();
    f.input.pollActions('paused');
    f.pad.buttons[f.settings.mapping.buttonActions.pause] = button(true);
    f.input.pollActions('paused');
    expect(f.action.mock.calls).toEqual([['camera'], ['pause']]);
  });

  it('preserves a replacement device baseline acquired during an action callback', () => {
    const f = inputFixture();
    const replacement = structuredClone(f.pad);
    replacement.id = 'Replacement controller';
    replacement.buttons[f.settings.mapping.buttonActions.pause] = button(true);
    replacement.buttons[f.settings.mapping.shiftUpButton] = button(true);
    f.action.mockImplementation((name) => {
      if (name !== 'camera') return;
      f.input.setEnabled(false);
      f.select(replacement);
      f.input.pollActions('paused');
    });
    f.pad.buttons[f.settings.mapping.buttonActions.camera] = button(true);
    expect(f.input.update(1 / 60).shift).toBe(0);
    f.input.pollActions('paused');
    expect(f.action.mock.calls).toEqual([['camera']]);
    f.input.setEnabled(true);
    expect(f.input.update(1 / 60).shift).toBe(0);
    expect(f.action.mock.calls).toEqual([['camera']]);
    replacement.buttons[f.settings.mapping.buttonActions.pause] = button();
    f.input.pollActions('paused');
    replacement.buttons[f.settings.mapping.buttonActions.pause] = button(true);
    f.input.pollActions('paused');
    expect(f.action.mock.calls).toEqual([['camera'], ['pause']]);
  });
});

describe('preview activation refusal does not retain audible intent', () => {
  it.each(['rejected', 'thrown', 'timed out'] as const)(
    'does not arm a preview after a %s live resume for a later unrelated unlock gesture',
    async (failure) => {
      const window = new EventTarget();
      vi.stubGlobal('window', window);
      const context = new LiveContext();
      const audio = new RacingAudio();
      cleanup.push(() => audio.dispose());
      await audio.start(asContext(context));
      context.state = 'suspended';
      const pending = deferred();
      if (failure === 'thrown')
        context.resume.mockImplementationOnce(() => {
          throw new Error('Activation refused');
        });
      else context.resume.mockReturnValueOnce(pending.promise);

      const preview = audio.previewDriving(previewSettings);
      if (failure === 'rejected') pending.reject(new Error('Activation refused'));
      if (failure === 'timed out') await vi.advanceTimersByTimeAsync(250);
      await preview;
      expect(context.state).toBe('suspended');
      expect(centerTones(context)).toEqual([]);

      // The real AudioUnlock listener retries on an ordinary gesture. Only
      // context activation belongs to that gesture; the old preview is over.
      window.dispatchEvent(new Event('keydown'));
      await Promise.resolve();
      expect(context.state).toBe('running');
      if (failure === 'timed out') pending.reject(new Error('Old activation refused later'));
      await Promise.resolve();
      expect(centerTones(context)).toEqual([]);
      expect(context.resume).toHaveBeenCalledTimes(2);

      // A failed preview must not spend the cooldown of a fresh request.
      await audio.previewDriving(previewSettings);
      expect(centerTones(context)).toHaveLength(1);
      await audio.previewDriving(previewSettings);
      expect(centerTones(context)).toHaveLength(1);
      context.currentTime = 1;
      await audio.previewDriving(previewSettings);
      expect(centerTones(context)).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('still schedules offline previews before a suspended rendering context starts', async () => {
    const context = Object.assign(new LiveContext(), { startRendering: vi.fn() });
    context.state = 'suspended';
    const audio = new RacingAudio();
    cleanup.push(() => audio.dispose());
    await audio.start(asContext(context));
    await audio.previewDriving(previewSettings);
    expect(centerTones(context)).toEqual([{ kind: 'set', value: 800, time: 0.25 }]);
    expect(context.resume).not.toHaveBeenCalled();
  });
});
