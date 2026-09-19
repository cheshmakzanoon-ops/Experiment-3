import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS, validateBindings, isHeld } from '../src/input/bindings.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { InputController } from '../src/input/controller.ts';

afterEach(() => vi.unstubAllGlobals());
it('migrates version-one driving keys and provides bindings for every existing action', () => {
  const result = validateSettings({
    ...DEFAULT_SETTINGS,
    version: 1,
    bindings: { throttle: 'KeyI', brake: 'KeyK', left: 'KeyJ', right: 'KeyL' },
  });
  expect(result.version).toBe(6);
  expect(result.bindings.throttle).toBe('KeyI');
  expect(result.bindings.shiftUp).toBe('BracketRight');
  expect(result.bindings.camera).toBe('KeyC');
  expect(new Set(Object.values(result.bindings)).size).toBe(16);
});
it('rejects duplicate actions and reserved browser/safety keys', () => {
  expect(() => validateBindings({ ...DEFAULT_BINDINGS, throttle: 'KeyC' })).toThrow(
    'already assigned',
  );
  for (const key of ['Escape', 'F5', 'F11', 'F12', 'Tab', '<script>', ''])
    expect(() => validateBindings({ ...DEFAULT_BINDINGS, throttle: key })).toThrow('Invalid');
});
it('an arrow alias cannot activate a second action after explicit reassignment', () => {
  const bindings = validateBindings({ ...DEFAULT_BINDINGS, throttle: 'ArrowRight' }),
    keys = new Set(['ArrowRight']);
  expect(isHeld(keys, bindings, 'throttle')).toBe(true);
  expect(isHeld(keys, bindings, 'right', ['ArrowRight'])).toBe(false);
  expect(isHeld(new Set(['ArrowLeft']), bindings, 'left', ['ArrowLeft'])).toBe(true);
});
it('routes remapped camera and paddle keys once, retaining unconditional Escape pause', () => {
  const listeners = new Map<string, EventListener>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', { getGamepads: () => [] });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.bindings.camera = 'KeyO';
  settings.bindings.shiftUp = 'KeyU';
  const action = vi.fn(),
    input = new InputController(settings, action);
  input.setEnabled(true);
  const send = (code: string, repeat = false) =>
    listeners.get('keydown')!({
      code,
      repeat,
      target: { matches: () => false },
      preventDefault: vi.fn(),
    } as unknown as Event);
  send('KeyO');
  send('KeyO', true);
  expect(action).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenLastCalledWith('camera');
  send('KeyU');
  expect(input.state.shift).toBe(1);
  send('Escape');
  expect(action).toHaveBeenLastCalledWith('pause');
  input.dispose();
});

it('leaves dialog keys and native Escape cancellation to the dialog owner', () => {
  const listeners = new Map<string, EventListener>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
    removeEventListener: vi.fn(),
  });
  const action = vi.fn(),
    input = new InputController(structuredClone(DEFAULT_SETTINGS), action);
  const preventDefault = vi.fn();
  for (const enabled of [true, false]) {
    input.setEnabled(enabled);
    for (const code of ['Escape', 'KeyC', 'KeyT', 'ArrowRight']) {
      listeners.get('keydown')!({
        code,
        repeat: false,
        target: { matches: () => false, closest: () => ({ open: true }) },
        preventDefault,
      } as unknown as Event);
    }
  }
  expect(action).not.toHaveBeenCalled();
  expect(preventDefault).not.toHaveBeenCalled();
  expect(input.state.shift).toBe(0);
  input.dispose();
});
