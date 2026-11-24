import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller.ts';
import { controls } from '../src/simulation/config.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';

class InputTarget extends EventTarget {
  matches() {
    return false;
  }
  setPointerCapture = vi.fn();
  hasPointerCapture = vi.fn(() => true);
  releasePointerCapture = vi.fn();
}

class VisibilityTarget extends EventTarget {
  hidden = false;
}

const button = (pressed = false) => ({ pressed, touched: pressed, value: Number(pressed) });
const gamepad = (index = 0) => ({
  id: `Lifecycle controller ${index}`,
  index,
  connected: true,
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => button()),
});
const controllers: InputController[] = [];

function fixture() {
  const window = new InputTarget();
  const document = new VisibilityTarget();
  const listeners = vi.spyOn(window, 'addEventListener');
  const pad = gamepad();
  let pads = [pad];
  const getGamepads = vi.fn(() => pads);
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads });
  const settings = structuredClone(DEFAULT_SETTINGS);
  const action = vi.fn();
  const input = new InputController(settings, action);
  controllers.push(input);
  input.setEnabled(true);
  const key = (
    code: string,
    options: { up?: boolean; repeat?: boolean; target?: unknown; path?: EventTarget[] } = {},
  ) => {
    const type = options.up ? 'keyup' : 'keydown';
    const event = Object.assign(new Event(type, { cancelable: true }), {
      code,
      repeat: options.repeat ?? false,
    });
    Object.defineProperty(event, 'target', {
      value: 'target' in options ? options.target : window,
    });
    if (options.path) Object.defineProperty(event, 'composedPath', { value: () => options.path });
    const listener = listeners.mock.calls.find(([name]) => name === type)![1] as EventListener;
    listener(event);
    return event;
  };
  return {
    input,
    settings,
    action,
    window,
    document,
    pad,
    key,
    getGamepads,
    setPads: (value: typeof pads) => (pads = value),
  };
}

function pointer(target: InputTarget, type: string, pointerId: number) {
  const event = Object.assign(new Event(type, { cancelable: true }), { pointerId });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('input lifecycle ownership', () => {
  it('neutralizes a retained state on disposal and cannot resume polling or driving afterward', () => {
    const f = fixture();
    f.key('KeyW');
    const touch = new InputTarget();
    f.input.bindTouch(touch as unknown as HTMLElement, 'brake');
    pointer(touch, 'pointerdown', 1);
    const state = f.input.update(0.1);
    expect(state).toMatchObject({ throttle: 1, brake: 1 });

    f.input.dispose();
    expect(state).toEqual(controls());
    f.getGamepads.mockClear();
    f.input.setEnabled(true);
    f.pad.buttons[7] = button(true);
    f.pad.buttons[3] = button(true);
    pointer(touch, 'pointerdown', 2);
    f.input.pollActions('driving');
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.input.activePad()).toBeNull();
    expect(f.getGamepads).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
    f.input.dispose();
  });

  it('stops an in-progress sample when its action callback disposes the controller', () => {
    const f = fixture();
    f.input.update(0.1);
    f.action.mockImplementation(() => f.input.dispose());
    f.pad.buttons[7] = button(true);
    f.pad.buttons[3] = button(true);
    f.pad.buttons[5] = button(true);
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['camera']]);
  });

  it('releases held controls on visibility loss without blur and ignores hidden-tab commands', () => {
    const f = fixture();
    const touch = new InputTarget();
    f.input.bindTouch(touch as unknown as HTMLElement, 'brake');
    f.key('KeyW');
    pointer(touch, 'pointerdown', 1);
    expect(f.input.update(0.1)).toMatchObject({ throttle: 1, brake: 1 });

    f.document.hidden = true;
    f.document.dispatchEvent(new Event('visibilitychange'));
    expect(f.input.state).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['blur']]);
    f.pad.buttons[3] = button(true);
    f.key('Escape');
    f.key('KeyW');
    pointer(touch, 'pointerdown', 2);
    f.input.pollActions('driving');
    expect(f.input.update(0.1)).toEqual(controls());
    expect(f.action.mock.calls).toEqual([['blur']]);

    f.document.hidden = false;
    f.document.dispatchEvent(new Event('visibilitychange'));
    expect(f.input.update(0.1)).toMatchObject({ throttle: 0, brake: 0 });
    expect(f.action.mock.calls).toEqual([['blur']]);
    f.pad.buttons[3] = button();
    f.input.pollActions('driving');
    f.pad.buttons[3] = button(true);
    f.input.pollActions('driving');
    expect(f.action.mock.calls).toEqual([['blur'], ['camera']]);
  });

  it('releases a held key on blur and ignores its delayed repeat after re-enabling', () => {
    const f = fixture();
    f.key('KeyW');
    expect(f.input.update(0.1).throttle).toBe(1);
    f.window.dispatchEvent(new Event('blur'));
    expect(f.input.state).toEqual(controls());
    f.input.setEnabled(false);
    f.input.setEnabled(true);
    f.key('KeyW', { repeat: true });
    expect(f.input.update(0.1).throttle).toBe(0);
    f.key('KeyW', { up: true });
    f.key('KeyW');
    expect(f.input.update(0.1).throttle).toBe(1);
  });

  it('removes its visibility listener when disposed', () => {
    const f = fixture();
    const remove = vi.spyOn(f.document, 'removeEventListener');
    f.input.dispose();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});

describe('keyboard event ownership', () => {
  it.each([
    ['native input', { matches: (): boolean => true }],
    ['editable content', { matches: (): boolean => false, isContentEditable: true }],
    [
      'nested button content',
      {
        matches: (): boolean => false,
        closest: (selector: string) => (selector.includes('button') ? {} : null),
      },
    ],
  ])('leaves %s keys to the widget while driving is enabled', (_name, target) => {
    const f = fixture();
    for (const code of ['KeyW', 'KeyC', 'Escape', 'ArrowRight'])
      expect(f.key(code, { target }).defaultPrevented).toBe(false);
    const state = f.input.update(0.1);
    expect(state.throttle).toBe(0);
    expect(Math.abs(state.steer)).toBe(0);
    expect(f.action).not.toHaveBeenCalled();
  });

  it('recognizes a focused control inside a retargeted shadow-DOM event', () => {
    const f = fixture();
    const control = { matches: () => true } as unknown as EventTarget;
    expect(f.key('KeyC', { path: [control, f.window] }).defaultPrevented).toBe(false);
    expect(f.action).not.toHaveBeenCalled();
  });

  it.each([null, new EventTarget()])('accepts non-element keyboard targets (%s)', (target) => {
    const f = fixture();
    expect(() => f.key('KeyW', { target })).not.toThrow();
    expect(f.input.update(0.1).throttle).toBe(1);
    f.key('KeyW', { up: true, target: { matches: () => true } });
    expect(f.input.update(0.1).throttle).toBe(0);
  });
});

describe('touch and controller device ownership', () => {
  it('leaves controls released when an already-cancelled pointer cannot be captured', () => {
    const f = fixture();
    const touch = new InputTarget();
    const listeners = vi.spyOn(touch, 'addEventListener');
    f.input.bindTouch(touch as unknown as HTMLElement, 'throttle');
    touch.setPointerCapture.mockImplementationOnce(() => {
      throw new DOMException('Pointer no longer active', 'NotFoundError');
    });
    const down = listeners.mock.calls.find(([name]) => name === 'pointerdown')![1] as EventListener;
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { pointerId: 1 });
    expect(() => down(event)).not.toThrow();
    expect(f.input.update(0.1).throttle).toBe(0);
  });

  it('keeps a touch action held until its last pointer is released', () => {
    const f = fixture();
    const touch = new InputTarget();
    f.input.bindTouch(touch as unknown as HTMLElement, 'throttle');
    pointer(touch, 'pointerdown', 1);
    pointer(touch, 'pointerdown', 2);
    expect(f.input.update(0.1).throttle).toBe(1);
    pointer(touch, 'pointercancel', 1);
    expect(f.input.update(0.1).throttle).toBe(1);
    pointer(touch, 'lostpointercapture', 2);
    expect(f.input.update(0.1).throttle).toBe(0);
  });

  it('does not let stale pointer cancellation release a new press after re-enabling', () => {
    const f = fixture();
    const touch = new InputTarget();
    f.input.bindTouch(touch as unknown as HTMLElement, 'throttle');
    pointer(touch, 'pointerdown', 1);
    f.input.setEnabled(false);
    expect(touch.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(pointer(touch, 'pointerdown', 3).defaultPrevented).toBe(false);
    f.input.setEnabled(true);
    pointer(touch, 'pointerdown', 2);
    pointer(touch, 'pointercancel', 1);
    pointer(touch, 'lostpointercapture', 1);
    expect(f.input.update(0.1).throttle).toBe(1);
    pointer(touch, 'pointerup', 2);
    expect(f.input.update(0.1).throttle).toBe(0);
  });

  it('baselines held action buttons when the same controller reconnects before another poll', () => {
    const f = fixture();
    f.input.update(0.1);
    f.window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: f.pad }));
    f.pad.buttons[3] = button(true);
    f.input.update(0.1);
    expect(f.action.mock.calls).toEqual([['deviceLost']]);
    f.pad.buttons[3] = button();
    f.input.update(0.1);
    f.pad.buttons[3] = button(true);
    f.input.update(0.1);
    expect(f.action.mock.calls).toEqual([['deviceLost'], ['camera']]);
  });

  it('baselines held actions and paddles when automatic selection switches devices', () => {
    const f = fixture();
    f.input.update(0.1);
    const next = gamepad(1);
    next.buttons[3] = button(true);
    next.buttons[5] = button(true);
    f.setPads([next]);
    expect(f.input.update(0.1).shift).toBe(0);
    expect(f.action).not.toHaveBeenCalled();
    next.buttons[3] = button();
    next.buttons[5] = button();
    f.input.update(0.1);
    next.buttons[3] = button(true);
    next.buttons[5] = button(true);
    expect(f.input.update(0.1).shift).toBe(1);
    expect(f.action.mock.calls).toEqual([['camera']]);
  });
});
