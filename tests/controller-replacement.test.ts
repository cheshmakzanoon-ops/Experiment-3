import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller.ts';
import { controls } from '../src/simulation/config.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';

class InputTarget extends EventTarget {
  matches() {
    return false;
  }
}

const button = (pressed = false) => ({ pressed, touched: pressed, value: Number(pressed) });
const gamepad = (index: number, id = `Replacement controller ${index}`) => ({
  id,
  index,
  connected: true,
  mapping: 'standard' as GamepadMappingType,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => button()),
});
type TestPad = ReturnType<typeof gamepad>;
const controllers: InputController[] = [];

function holdControls(pad: TestPad) {
  pad.axes[0] = 0.9;
  pad.axes[3] = -0.7;
  for (const index of [0, 1, 3, 5, 6, 7, 9, 10]) pad.buttons[index] = button(true);
  return pad;
}

function fixture() {
  const window = new InputTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const first = gamepad(0);
  const second = gamepad(1);
  let pads: (TestPad | null)[] = [first, second];
  const getGamepads = vi.fn(() => pads);
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads });
  const settings = structuredClone(DEFAULT_SETTINGS);
  // The application handles deviceLost synchronously by pausing the session
  // and disabling driving input; exercise that public handback contract.
  const action = vi.fn((name: string) => {
    if (name === 'deviceLost') input.setEnabled(false);
  });
  const input: InputController = new InputController(settings, action);
  controllers.push(input);
  input.setEnabled(true);
  return {
    input,
    settings,
    action,
    first,
    second,
    getGamepads,
    setPads: (value: (TestPad | null)[]) => (pads = value),
    disconnect: (pad: TestPad) =>
      window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: pad })),
    key: (code: string) =>
      window.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false }),
      ),
  };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('controller replacement ownership', () => {
  it.each(['driving', 'actions'] as const)(
    '%s polling neutralizes a held replacement and emits one loss through the paused interval',
    (poll) => {
      const f = fixture();
      f.settings.mapping.manualClutch = true;
      f.settings.mapping.clutchAxis = -1;
      f.settings.mapping.clutchButton = 0;
      f.settings.mapping.rearBrakeButton = 1;
      f.settings.mapping.buttonActions.reverse = 10;
      holdControls(f.first);
      holdControls(f.second);
      const state = f.input.update(0.1);
      expect(state).toMatchObject({ throttle: 1, brake: 1, clutch: 1, rearBrake: 1 });
      expect(state.steer).not.toBe(0);
      f.key(f.settings.bindings.throttle);

      f.setPads([null, f.second]);
      if (poll === 'driving') expect(f.input.update(0.1)).toBe(state);
      else f.input.pollActions('driving');
      expect(state).toEqual(controls());
      expect(f.action.mock.calls).toEqual([['deviceLost']]);

      // Both callback orderings must be harmless: after the loss and after a
      // paused action poll has observed the replacement's held buttons.
      f.disconnect(f.first);
      for (let i = 0; i < 3; i++) {
        f.input.pollActions(['pause', 'camera']);
        expect(f.input.update(0.1)).toEqual(controls());
        f.disconnect(f.first);
      }
      expect(f.action.mock.calls).toEqual([['deviceLost']]);
    },
  );

  it('acquires the replacement after an explicit resume without manufacturing held button edges', () => {
    const f = fixture();
    f.input.update(0.1);
    holdControls(f.second);
    f.setPads([null, f.second]);
    f.input.update(0.1);
    f.input.pollActions(['pause']);
    f.input.setEnabled(true);
    expect(f.input.update(0.1)).toMatchObject({ throttle: 1, brake: 1, shift: 0 });
    expect(f.input.state.steer).toBeLessThan(0);
    f.disconnect(f.first);
    expect(f.action.mock.calls).toEqual([['deviceLost']]);

    f.second.buttons[3] = button();
    f.second.buttons[5] = button();
    f.second.buttons[9] = button();
    f.input.update(0.1);
    f.second.buttons[3] = button(true);
    f.second.buttons[5] = button(true);
    expect(f.input.update(0.1).shift).toBe(1);
    expect(f.action.mock.calls).toEqual([['deviceLost'], ['camera']]);
  });

  it('handles a disconnect callback before polling with the same neutral pause and resume behavior', () => {
    const f = fixture();
    f.input.update(0.1);
    holdControls(f.second);
    f.setPads([null, f.second]);
    f.disconnect(f.first);
    expect(f.input.state).toEqual(controls());
    f.input.pollActions(['pause']);
    expect(f.input.update(0.1)).toEqual(controls());
    f.disconnect(f.first);
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
    f.input.setEnabled(true);
    expect(f.input.update(0.1)).toMatchObject({ throttle: 1, brake: 1, shift: 0 });
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
  });

  it.each(['id', 'mapping'] as const)('detects changed %s on a reused slot', (field) => {
    const f = fixture();
    // An explicit device permits a nonstandard mapping, so a physical mapping
    // change must be detected even though selectDevice still finds this slot.
    if (field === 'mapping') f.settings.mapping.device = { index: f.first.index, id: f.first.id };
    f.input.update(0.1);
    const replacement = holdControls(gamepad(0, f.first.id));
    if (field === 'id') replacement.id = 'Different hardware in slot zero';
    else replacement.mapping = '';
    f.setPads([replacement, f.second]);
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
    f.input.setEnabled(true);
    expect(f.input.update(0.1).throttle).toBe(1);
    f.disconnect(f.first);
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
  });

  it('treats a newly preferred automatic pad as a handoff even if the previous pad remains connected', () => {
    const f = fixture();
    f.setPads([null, f.second]);
    f.input.update(0.1);
    holdControls(f.first);
    f.setPads([f.first, f.second]);
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
  });

  it('accepts initial automatic acquisition with held axes and baselined actions', () => {
    const f = fixture();
    f.setPads([]);
    expect(f.input.update(0.1).throttle).toBe(0);
    holdControls(f.second);
    f.setPads([null, f.second]);
    expect(f.input.update(0.1)).toMatchObject({ throttle: 1, brake: 1, shift: 0 });
    expect(f.input.state.steer).toBeLessThan(0);
    expect(f.action).not.toHaveBeenCalled();
  });

  it('keeps the same device identity across fresh browser snapshots and unrelated settings edits', () => {
    const f = fixture();
    f.input.update(0.1);
    f.input.settings = structuredClone(f.settings);
    const freshSnapshot = gamepad(0, f.first.id);
    freshSnapshot.axes[0] = 0.8;
    freshSnapshot.buttons[7] = button(true);
    f.setPads([freshSnapshot, f.second]);
    expect(f.input.update(0.1).throttle).toBe(1);
    expect(f.input.state.steer).toBeLessThan(0);
    f.disconnect(f.second);
    expect(f.action).not.toHaveBeenCalled();
  });

  it('does not authorize an automatic replacement merely because settings were cloned', () => {
    const f = fixture();
    f.input.update(0.1);
    f.input.settings = structuredClone(f.settings);
    f.setPads([null, holdControls(f.second)]);
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
  });

  it.each(['mutated', 'replaced'] as const)(
    'honors an explicit selection in %s settings without misclassifying it as device loss',
    (kind) => {
      const f = fixture();
      f.input.update(0.1);
      holdControls(f.second);
      if (kind === 'replaced') f.input.settings = structuredClone(f.settings);
      f.input.settings.mapping.device = { index: f.second.index, id: f.second.id };
      // The old hardware may disconnect before the next settings-aware poll.
      f.disconnect(f.first);
      expect(f.input.update(0.1)).toMatchObject({ throttle: 1, brake: 1, shift: 0 });
      expect(f.action).not.toHaveBeenCalled();
    },
  );

  it('uses the configured controller initially and keeps keyboard resume available after its loss', () => {
    const f = fixture();
    f.settings.mapping.device = { index: f.second.index, id: f.second.id };
    f.second.buttons[7] = button(true);
    expect(f.input.update(0.1).throttle).toBe(1);
    expect(f.input.gamepadName).toBe(f.second.id);
    holdControls(f.first);
    f.setPads([f.first, null]);
    expect(f.input.update(0.1)).toEqual(controls());
    f.action.mockImplementation((name: string) => {
      if (name === 'deviceLost') f.input.setEnabled(false);
      else if (name === 'pause') f.input.setEnabled(true);
    });
    f.input.pollActions(['pause']);
    f.key('Escape');
    f.key(f.settings.bindings.throttle);
    expect(f.input.update(0.1)).toMatchObject({ throttle: 1, brake: 0, shift: 0 });
    expect(Math.abs(f.input.state.steer)).toBe(0);
    expect(f.input.gamepadName).toBe('KEYBOARD');
    expect(f.action.mock.calls).toEqual([['deviceLost'], ['pause']]);
  });

  it.each(['missing', 'inaccessible'] as const)(
    'cannot erase the active owner with an enabled action poll when the device is %s',
    (kind) => {
      const f = fixture();
      f.first.buttons[7] = button(true);
      expect(f.input.update(0.1).throttle).toBe(1);
      if (kind === 'missing') f.setPads([]);
      else
        f.getGamepads.mockImplementationOnce(() => {
          throw new Error('Gamepad access unavailable');
        });
      f.input.pollActions('off');
      expect(f.input.state).toEqual(controls());
      expect(f.action.mock.calls).toEqual([['deviceLost']]);
    },
  );

  it('preserves calibration suppression until the mapping is explicitly replaced', () => {
    const f = fixture();
    f.input.update(0.1);
    f.first.axes = [];
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
    f.first.axes = [0, 0, 0, 0];
    f.first.buttons[7] = button(true);
    f.input.setEnabled(true);
    expect(f.input.update(0.1).throttle).toBe(0);
    f.input.pollActions('driving');
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
    f.settings.mapping = structuredClone(f.settings.mapping);
    expect(f.input.update(0.1).throttle).toBe(1);
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
  });
});
