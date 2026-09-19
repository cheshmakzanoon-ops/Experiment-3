import { afterEach, expect, it, vi } from 'vitest';
import {
  ControllerActions,
  DEFAULT_BUTTON_ACTIONS,
  BUTTON_ACTIONS,
  validateButtonActions,
} from '../src/input/button-actions.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { InputController } from '../src/input/controller.ts';
const button = (down = false): GamepadButton => ({
  value: Number(down),
  pressed: down,
  touched: down,
});
function fixture() {
  const settings = structuredClone(DEFAULT_SETTINGS),
    actions = new ControllerActions();
  const buttons = Array.from({ length: 40 }, () => button());
  const pad = {
    index: 0,
    id: 'Pad',
    mapping: 'standard',
    connected: true,
    axes: [0, 0, 0, 0, 0, 0],
    buttons,
  } as unknown as Gamepad;
  const emit = vi.fn();
  return {
    settings,
    actions,
    buttons,
    pad,
    emit,
    poll: (mode: 'driving' | 'paused' | 'replay' | 'off' = 'driving') =>
      actions.poll(pad, settings.mapping, mode, emit),
  };
}
afterEach(() => vi.unstubAllGlobals());
it('migrates legacy saves without losing graphics/calibration and yields conflicting implicit buttons to driving', () => {
  const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  old.version = 4;
  const m = old.mapping as typeof DEFAULT_SETTINGS.mapping;
  m.shiftUpButton = 9;
  const result = validateSettings(old);
  expect(result.version).toBe(6);
  expect(result.graphics).toEqual(DEFAULT_SETTINGS.graphics);
  expect(result.mapping.buttonActions.pause).toBe(-1);
  expect(result.mapping.buttonActions.camera).toBe(3);
  m.device = { id: 'Custom', index: 1 };
  expect(Object.values(validateSettings(old).mapping.buttonActions).every((n) => n === -1)).toBe(
    true,
  );
});
it('roundtrips every action and rejects malformed or conflicting explicit maps', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  BUTTON_ACTIONS.forEach((key, i) => {
    settings.mapping.buttonActions[key] = 20 + i;
  });
  expect(validateSettings(settings)).toEqual(settings);
  for (const invalid of [null, [], { camera: 3 }])
    expect(() => validateButtonActions(invalid, settings.mapping)).toThrow();
  for (const bad of [NaN, Infinity, -2, 128, 1.1, '2'])
    expect(() =>
      validateButtonActions({ ...DEFAULT_BUTTON_ACTIONS, camera: bad }, settings.mapping),
    ).toThrow();
  expect(() =>
    validateButtonActions({ ...DEFAULT_BUTTON_ACTIONS, camera: 5 }, settings.mapping),
  ).toThrow(/upshift/);
  expect(() =>
    validateButtonActions({ ...DEFAULT_BUTTON_ACTIONS, camera: 2 }, settings.mapping),
  ).toThrow(/already assigned/);
});
it.each(BUTTON_ACTIONS.filter((key) => key !== 'reverse'))(
  'remaps %s on nonstandard devices and emits only once per actual press',
  (key) => {
    const f = fixture();
    Object.assign(f.pad, { mapping: '' });
    for (const name of BUTTON_ACTIONS) f.settings.mapping.buttonActions[name] = -1;
    f.settings.mapping.buttonActions[key] = 12;
    f.poll();
    f.buttons[12] = button(true);
    f.poll();
    f.poll();
    expect(f.emit.mock.calls).toEqual([[key]]);
    f.buttons[12] = button();
    f.poll();
    f.buttons[12] = button(true);
    f.poll();
    expect(f.emit).toHaveBeenCalledTimes(2);
  },
);
it('does not fire held connect/rebind buttons, duplicate pause on resume, or deferred menu presses', () => {
  const f = fixture();
  f.buttons[9] = button(true);
  f.poll();
  expect(f.emit).not.toHaveBeenCalled();
  f.buttons[9] = button();
  f.poll();
  f.buttons[9] = button(true);
  f.poll();
  f.poll('paused');
  expect(f.emit.mock.calls).toEqual([['pause']]);
  f.buttons[9] = button();
  f.poll('paused');
  f.buttons[9] = button(true);
  f.poll('paused');
  expect(f.emit).toHaveBeenCalledTimes(2);
  f.buttons[3] = button(true);
  f.poll('off');
  f.poll();
  expect(f.emit).toHaveBeenCalledTimes(2);
  f.settings.mapping = structuredClone(f.settings.mapping);
  f.poll();
  expect(f.emit).toHaveBeenCalledTimes(2);
});
it('consumes forbidden and simultaneous action edges without issuing multiple UI transitions', () => {
  const f = fixture();
  f.poll('paused');
  f.buttons[3] = button(true);
  f.poll('paused');
  f.poll();
  expect(f.emit).not.toHaveBeenCalled();
  f.buttons[3] = button();
  f.poll();
  f.buttons[3] = button(true);
  f.buttons[9] = button(true);
  f.poll();
  f.poll();
  expect(f.emit).toHaveBeenCalledTimes(1);
});
it('polls pause/resume independently without passing gamepad pedals to disabled driving input', () => {
  const f = fixture();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { getGamepads: () => [f.pad] });
  let enabled = true;
  const input = new InputController(f.settings, () => {
    enabled = !enabled;
    input.setEnabled(enabled);
  });
  input.setEnabled(true);
  input.pollActions('driving');
  f.buttons[7] = button(true);
  f.buttons[9] = button(true);
  input.pollActions('driving');
  expect(enabled).toBe(false);
  expect(input.update(0.01).throttle).toBe(0);
  input.pollActions('paused');
  expect(enabled).toBe(false);
  f.buttons[9] = button();
  input.pollActions('paused');
  f.buttons[9] = button(true);
  input.pollActions('paused');
  expect(enabled).toBe(true);
  input.pollActions('driving');
  expect(enabled).toBe(true);
  input.dispose();
});
