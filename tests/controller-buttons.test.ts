import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { BUTTON_ACTIONS, defaultButtonActions } from '../src/input/button-actions.ts';
import { InputController } from '../src/input/controller.ts';
import { controls } from '../src/simulation/config.ts';

afterEach(() => vi.unstubAllGlobals());
const button = (pressed = false) => ({ pressed, touched: pressed, value: Number(pressed) });
function fixture() {
  const pad = {
    id: 'Test mapped wheel',
    index: 2,
    connected: true,
    mapping: '',
    axes: [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 32 }, () => button()),
  };
  let pads = [null, null, pad];
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.mapping.device = { index: 2, id: pad.id };
  settings.mapping.buttonActions = defaultButtonActions();
  const action = vi.fn();
  const input = new InputController(settings, action);
  input.setEnabled(true);
  return { pad, settings, action, input, remove: () => (pads = []) };
}
it.each([1, 2, 3, 4])(
  'migrates version %i without stealing pedals or losing calibration/graphics',
  (version) => {
    const old = structuredClone(DEFAULT_SETTINGS);
    old.mapping.shiftUpButton = 9;
    old.graphics.motionBlur = 0.3;
    old.mapping.calibration.steering = { axis: 0, left: -0.8, center: 0.1, right: 0.7 };
    const saved = { ...old, version };
    const result = validateSettings(saved);
    expect(result.version).toBe(6);
    expect(result.mapping.buttonActions.pause).toBe(-1);
    expect(result.mapping.buttonActions.camera).toBe(3);
    expect(result.mapping.shiftUpButton).toBe(9);
    expect(result.mapping.calibration).toEqual(old.mapping.calibration);
    if (version === 4) expect(result.graphics).toEqual(old.graphics);
    expect(saved).toEqual({ ...old, version });
  },
);
it('does not assign standard button positions to an explicitly selected legacy wheel', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.mapping.device = { id: 'Unmapped wheel', index: 2 };
  const restored = validateSettings({ ...settings, version: 4 });
  expect(Object.values(restored.mapping.buttonActions).every((i) => i === -1)).toBe(true);
});
it('round-trips every action, disabled option and graphics field through the new schema', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.mapping.buttonActions = Object.fromEntries(
    BUTTON_ACTIONS.map((name, i) => [name, 20 + i]),
  ) as typeof settings.mapping.buttonActions;
  expect(validateSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
});
it.each([NaN, Infinity, 2.4, -2, 128, '3', null])(
  'rejects malformed action index %s rather than silently rebinding it',
  (value) => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings.mapping.buttonActions, { camera: value });
    expect(() => validateSettings(settings)).toThrow('whole button number');
  },
);
it('rejects action/action, action/paddle and action/active pedal conflicts', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  for (const index of [9, 5, 7, 6]) {
    settings.mapping.buttonActions.camera = index;
    expect(() => validateSettings(settings)).toThrow('already assigned');
  }
  settings.mapping.buttonActions.camera = 1;
  settings.mapping.manualClutch = true;
  settings.mapping.clutchAxis = -1;
  settings.mapping.clutchButton = 1;
  expect(() => validateSettings(settings)).toThrow('clutch');
  settings.mapping.clutchAxis = 3;
  expect(validateSettings(settings).mapping.buttonActions.camera).toBe(1);
});
it('rejects absent/unknown action maps in version six, but permits explicit unbound maps', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.mapping, { buttonActions: undefined });
  expect(() => validateSettings(settings)).toThrow('object');
  Object.assign(settings.mapping, { buttonActions: { launchMissile: 12 } });
  expect(() => validateSettings(settings)).toThrow('Unknown');
  Object.assign(settings.mapping, { buttonActions: defaultButtonActions() });
  expect(validateSettings(settings).mapping.buttonActions).toEqual(defaultButtonActions());
});
it.each(BUTTON_ACTIONS.filter((action) => action !== 'reverse'))(
  'routes a custom wheel %s assignment once per genuine edge',
  (name) => {
    const f = fixture();
    try {
      f.settings.mapping.buttonActions[name] = 20;
      f.input.update(1 / 60);
      f.pad.buttons[20] = button(true);
      for (let i = 0; i < 4; i++) f.input.update(1 / 60);
      expect(f.action.mock.calls).toEqual([[name]]);
      f.pad.buttons[20] = button();
      f.input.update(1 / 60);
      f.pad.buttons[20] = button(true);
      f.input.update(1 / 60);
      expect(f.action.mock.calls).toEqual([[name], [name]]);
    } finally {
      f.input.dispose();
    }
  },
);
it('reverse is a held control and not an action, with no latch on release', () => {
  const f = fixture();
  try {
    f.settings.mapping.buttonActions.reverse = 20;
    f.input.update(1 / 60);
    f.pad.buttons[20] = button(true);
    expect(f.input.update(1 / 60).reverse).toBe(true);
    expect(f.action).not.toHaveBeenCalled();
    f.pad.buttons[20] = button();
    expect(f.input.update(1 / 60).reverse).toBe(false);
  } finally {
    f.input.dispose();
  }
});
it('pause resume requires release and repress, and never publishes pedals while paused', () => {
  const f = fixture();
  try {
    f.settings.mapping.buttonActions.pause = 20;
    f.action.mockImplementation(() => f.input.setEnabled(false));
    f.input.update(1 / 60);
    f.pad.buttons[7] = button(true);
    f.pad.buttons[20] = button(true);
    expect(f.input.update(1 / 60)).toEqual(controls());
    for (let i = 0; i < 4; i++) f.input.pollActions(['pause']);
    expect(f.action).toHaveBeenCalledTimes(1);
    expect(f.input.state).toEqual(controls());
    f.pad.buttons[20] = button();
    f.input.pollActions(['pause']);
    f.action.mockImplementation(() => f.input.setEnabled(true));
    f.pad.buttons[20] = button(true);
    f.input.pollActions(['pause']);
    expect(f.action).toHaveBeenCalledTimes(2);
    expect(f.input.state).toEqual(controls());
    f.input.update(1 / 60); // held resume must not pause again
    expect(f.action).toHaveBeenCalledTimes(2);
  } finally {
    f.input.dispose();
  }
});
it('an action changing ownership cannot leak remaining pedal samples into replay', () => {
  const f = fixture();
  try {
    f.settings.mapping.buttonActions.replay = 20;
    f.action.mockImplementation(() => f.input.setEnabled(true));
    f.input.update(1 / 60);
    f.pad.buttons[7] = button(true);
    f.pad.buttons[20] = button(true);
    expect(f.input.update(1 / 60)).toEqual(controls());
  } finally {
    f.input.dispose();
  }
});
it('inactive action allowlists consume suppressed edges without firing them later', () => {
  const f = fixture();
  try {
    f.settings.mapping.buttonActions.ers = 20;
    f.settings.mapping.buttonActions.camera = 21;
    f.input.setEnabled(false);
    f.input.pollActions(['pause']);
    f.pad.buttons[20] = button(true);
    f.pad.buttons[21] = button(true);
    f.input.pollActions(['camera']);
    expect(f.action.mock.calls).toEqual([['camera']]);
    f.input.pollActions(['ers', 'camera']);
    expect(f.action.mock.calls).toEqual([['camera']]);
    expect(f.input.state).toEqual(controls());
    f.remove();
    f.input.pollActions(['pause']);
    expect(f.action).toHaveBeenCalledTimes(1);
  } finally {
    f.input.dispose();
  }
});

it('rejects duplicate active drive buttons but ignores inactive axis-pedal button slots', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.mapping.brakeButton = settings.mapping.throttleButton;
  expect(() => validateSettings(settings)).toThrow('brake needs a different button');
  settings.mapping.axisPedals = true;
  expect(validateSettings(settings).mapping.axisPedals).toBe(true);
});

it('migrates existing version-five nine-action saves without resetting assignments', () => {
  const old = structuredClone(DEFAULT_SETTINGS);
  old.mapping.buttonActions.camera = 31;
  const saved = {
    ...old,
    version: 5,
    mapping: { ...old.mapping, buttonActions: { ...old.mapping.buttonActions } },
  };
  delete (saved.mapping.buttonActions as Partial<typeof old.mapping.buttonActions>).reverse;
  const original = structuredClone(saved);
  const migrated = validateSettings(saved);
  expect(migrated.version).toBe(6);
  expect(migrated.mapping.buttonActions.camera).toBe(31);
  expect(migrated.mapping.buttonActions.reverse).toBe(-1);
  expect(migrated.graphics).toEqual(old.graphics);
  expect(migrated.mapping.calibration).toEqual(old.mapping.calibration);
  expect(saved).toEqual(original);
});

it('requires a new resume press after focus loss instead of replaying an unseen hidden-tab edge', () => {
  const f = fixture();
  try {
    f.settings.mapping.buttonActions.pause = 20;
    f.action.mockImplementation((name: string) => {
      if (name === 'blur') f.input.setEnabled(false);
    });
    f.input.update(1 / 60);
    window.dispatchEvent(new Event('blur'));
    f.pad.buttons[20] = button(true);
    f.input.pollActions('paused');
    expect(f.action.mock.calls).toEqual([['blur']]);
    f.pad.buttons[20] = button();
    f.input.pollActions('paused');
    f.pad.buttons[20] = button(true);
    f.input.pollActions('paused');
    expect(f.action.mock.calls).toEqual([['blur'], ['pause']]);
    expect(f.input.state).toEqual(controls());
  } finally {
    f.input.dispose();
  }
});
