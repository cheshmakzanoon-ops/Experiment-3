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
const gamepad = (index = 0, id = `Fault retry controller ${index}`) => ({
  index,
  id,
  connected: true,
  mapping: 'standard' as GamepadMappingType,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => button()),
});
type TestPad = ReturnType<typeof gamepad>;
const controllers: InputController[] = [];

function fixture() {
  const window = new InputTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const pad = gamepad();
  let pads: (TestPad | null)[] = [pad];
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  let driving = true;
  // Match the host's synchronous pause/resume handback through the actual
  // controller callback; a missing callback otherwise leaves driving enabled.
  const action = vi.fn((name: string) => {
    if (name === 'deviceLost' || name === 'blur') driving = false;
    else if (name === 'pause') driving = !driving;
    else return;
    input.setEnabled(driving);
  });
  const input: InputController = new InputController(structuredClone(DEFAULT_SETTINGS), action);
  controllers.push(input);
  input.setEnabled(true);
  return {
    input,
    pad,
    action,
    window,
    document,
    get driving() {
      return driving;
    },
    get faults() {
      return action.mock.calls.filter(([name]) => name === 'deviceLost').length;
    },
    setPads: (value: (TestPad | null)[]) => (pads = value),
    key: (code: string) =>
      window.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false }),
      ),
    disconnect: (value: TestPad) =>
      window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: value })),
  };
}

function pollPaused(f: ReturnType<typeof fixture>) {
  for (let i = 0; i < 3; i++) {
    f.input.pollActions('paused');
    expect(f.input.update(0.1)).toEqual(controls());
    f.disconnect(f.pad);
  }
}

afterEach(() => {
  for (const input of controllers.splice(0)) input.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('controller fault ownership retries', () => {
  it.each(['missing steering', 'steering calibration', 'pedal calibration', 'rear brake'] as const)(
    'pauses exactly once for each saved-settings retry of the same %s failure',
    (failure) => {
      const f = fixture();
      const m = f.input.settings.mapping;
      if (failure === 'missing steering') f.pad.axes = [];
      if (failure === 'steering calibration')
        m.calibration.steering = { axis: 1, left: -1, center: 0, right: 1 };
      if (failure === 'pedal calibration') {
        m.axisPedals = true;
        f.pad.axes = [0, 0, -1, 0, 0, -1];
        m.calibration.throttle = { axis: 1, released: -1, pressed: 1 };
      }
      if (failure === 'rear brake') m.rearBrakeButton = f.pad.buttons.length;
      expect(f.input.update(0.1)).toEqual(controls());
      const message = f.input.deviceStatus;
      expect(f.faults).toBe(1);
      expect(f.driving).toBe(false);

      for (const attempt of [2, 3]) {
        pollPaused(f);
        expect(f.faults).toBe(attempt - 1);
        // The settings transaction replaces the complete settings object.
        f.input.settings = structuredClone(f.input.settings);
        if (attempt === 3) f.input.pollActions('paused');
        f.key('Escape');
        expect(f.driving).toBe(true);
        expect(f.input.update(0.1)).toEqual(controls());
        expect(f.input.deviceStatus).toBe(message);
        expect(f.faults).toBe(attempt);
        expect(f.driving).toBe(false);
        // The required pause must revoke keyboard publication as well.
        f.key(f.input.settings.bindings.throttle);
        expect(f.input.update(0.1)).toEqual(controls());
      }
      pollPaused(f);
      expect(f.faults).toBe(3);
    },
  );

  it('keeps a failed mapping suppressed across unchanged settings, resume and focus resets', () => {
    const f = fixture();
    f.pad.axes = [];
    f.input.update(0.1);
    expect(f.faults).toBe(1);
    f.pad.axes = [0, 0, 0, 0];
    f.pad.buttons[7] = button(true);
    // An outer settings replacement alone does not replace the failed mapping.
    f.input.settings = { ...f.input.settings };
    f.key('Escape');
    expect(f.input.update(0.1).throttle).toBe(0);
    f.input.setEnabled(true);
    f.input.reset();
    f.input.pollActions('driving');
    expect(f.input.update(0.1).throttle).toBe(0);
    f.window.dispatchEvent(new Event('blur'));
    f.document.hidden = true;
    f.document.dispatchEvent(new Event('visibilitychange'));
    f.document.hidden = false;
    f.document.dispatchEvent(new Event('visibilitychange'));
    pollPaused(f);
    f.key('Escape');
    expect(f.input.update(0.1).throttle).toBe(0);
    expect(f.faults).toBe(1);
    f.input.settings.mapping = structuredClone(f.input.settings.mapping);
    expect(f.input.update(0.1).throttle).toBe(1);
    expect(f.faults).toBe(1);
  });

  it('recovers through a valid saved mapping without replaying held action or shift edges', () => {
    const f = fixture();
    f.pad.axes = [];
    for (const index of [3, 5, 7, 9]) f.pad.buttons[index] = button(true);
    f.input.update(0.1);
    expect(f.faults).toBe(1);
    f.input.settings = structuredClone(f.input.settings);
    f.pad.axes = [0.6, 0, 0, 0];
    f.input.pollActions('paused');
    f.key('Escape');
    expect(f.input.update(0.1)).toMatchObject({ throttle: 1, shift: 0 });
    expect(f.input.state.steer).toBeLessThan(0);
    expect(f.input.deviceStatus).toBe('Controller ready');
    expect(f.action.mock.calls).toEqual([['deviceLost'], ['pause']]);
    expect(f.input.update(0.1).shift).toBe(0);

    f.pad.buttons[3] = button();
    f.pad.buttons[5] = button();
    f.input.update(0.1);
    f.pad.buttons[3] = button(true);
    f.pad.buttons[5] = button(true);
    expect(f.input.update(0.1).shift).toBe(1);
    f.input.state.shift = 0;
    expect(f.input.update(0.1).shift).toBe(0);
    expect(f.action.mock.calls).toEqual([['deviceLost'], ['pause'], ['camera']]);

    f.pad.axes = [];
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.faults).toBe(2);
    expect(f.driving).toBe(false);
    pollPaused(f);
    expect(f.faults).toBe(2);
  });

  it('pauses when replacement hardware repeats the same fault without a mapping change', () => {
    const f = fixture();
    f.pad.axes = [];
    f.input.update(0.1);
    expect(f.faults).toBe(1);
    const replacement = gamepad(0, 'Replacement hardware');
    replacement.axes = [];
    replacement.buttons[3] = button(true);
    replacement.buttons[5] = button(true);
    f.setPads([replacement]);
    f.input.pollActions('paused');
    f.key('Escape');
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.faults).toBe(2);
    expect(f.driving).toBe(false);
    pollPaused(f);
    expect(f.faults).toBe(2);
    expect(f.action.mock.calls).toEqual([['deviceLost'], ['pause'], ['deviceLost']]);
  });

  it('re-arms a disconnect pause after action polling acquires a new resumed owner', () => {
    const f = fixture();
    f.input.update(0.1);
    f.setPads([]);
    f.input.update(0.1);
    expect(f.faults).toBe(1);
    const message = f.input.deviceStatus;
    f.setPads([f.pad]);
    f.key('Escape');
    // No successful driving sample occurs between these two losses.
    f.input.pollActions('driving');
    f.setPads([]);
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.input.deviceStatus).toBe(message);
    expect(f.faults).toBe(2);
    expect(f.driving).toBe(false);
    pollPaused(f);
    expect(f.faults).toBe(2);
  });
});
