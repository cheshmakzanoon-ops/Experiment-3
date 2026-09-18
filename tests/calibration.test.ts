import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calibratedPedal,
  calibratedSteer,
  selectDevice,
  steeringResponse,
  validatePedal,
  validateSteering,
  validateCalibration,
} from '../src/input/calibration.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { InputController } from '../src/input/controller.ts';

const button = (value = 0) => ({ value, pressed: value > 0.5, touched: value > 0 });
function pad(index = 0, id = 'Test wheel') {
  return {
    index,
    id,
    connected: true,
    mapping: '',
    axes: [0, 1, -1, 1],
    buttons: Array.from({ length: 12 }, () => button()),
  } as unknown as Gamepad;
}
afterEach(() => vi.unstubAllGlobals());
describe('device calibration', () => {
  it.each([
    [-0.8, 0.1, 0.7],
    [0.9, 0.2, -0.6],
  ])('normalizes asymmetric %j/%j/%j steering endpoints', (left, center, right) => {
    const c = validateSteering({ axis: 0, left, center, right });
    expect(calibratedSteer(left, c)).toBe(-1);
    expect(calibratedSteer(center, c)).toBe(0);
    expect(calibratedSteer(right, c)).toBe(1);
    expect(calibratedSteer((center + right) / 2, c)).toBeCloseTo(0.5);
    expect(calibratedSteer((center + left) / 2, c)).toBeCloseTo(-0.5);
  });
  it.each([
    [1, -1],
    [-0.3, 0.85],
    [0.8, 0.1],
  ])('calibrates independently directed pedal endpoints %j/%j', (released, pressed) => {
    const c = validatePedal({ axis: 3, released, pressed });
    expect(calibratedPedal(released, c)).toBe(0);
    expect(calibratedPedal(pressed, c)).toBe(1);
    expect(calibratedPedal((released + pressed) / 2, c)).toBeCloseTo(0.5);
  });
  it('rejects degenerate, same-side, non-finite and out-of-range calibration', () => {
    for (const left of [0, 0.8, NaN, -2])
      expect(() => validateSteering({ axis: 0, left, center: 0, right: 1 })).toThrow();
    for (const axis of [-1, 0.2, 32])
      expect(() => validatePedal({ axis, released: 1, pressed: -1 })).toThrow();
    expect(() => validatePedal({ axis: 0, released: 1, pressed: 0.95 })).toThrow();
    expect(() => validateCalibration({ steering: 'bad' })).toThrow();
  });
  it('applies deadzone, saturation and response curves without non-finite controls', () => {
    expect(steeringResponse(0.08, 0.1, 0.8, 2)).toBe(0);
    expect(steeringResponse(0.45, 0.1, 0.8, 2)).toBeCloseTo(0.25);
    expect(steeringResponse(-0.95, 0.1, 0.8, 2)).toBe(-1);
    expect(steeringResponse(NaN, 0.1, 0.8, 2)).toBe(0);
  });
  it('handles sparse slots and refuses a different device reusing a selected slot', () => {
    const wheel = pad(2),
      controller = pad(0, 'Standard');
    Object.assign(controller, { mapping: 'standard' });
    expect(selectDevice([controller, null, wheel], { index: 2, id: wheel.id })).toBe(wheel);
    expect(
      selectDevice([controller, null, pad(2, 'Different')], { index: 2, id: wheel.id }),
    ).toBeNull();
    expect(selectDevice([wheel], null)).toBeNull();
    expect(selectDevice([null, controller, wheel], null)).toBe(controller);
  });
  it('migrates old settings without changing a ShiftLeft driving binding', () => {
    const settings = validateSettings({
      ...DEFAULT_SETTINGS,
      version: 1,
      bindings: { throttle: 'ShiftLeft' },
    });
    expect(settings.version).toBe(4);
    expect(settings.bindings.throttle).toBe('ShiftLeft');
    expect(settings.bindings.clutch).toBe('ShiftRight');
    expect(settings.mapping.manualClutch).toBe(false);
  });
});
function fixture() {
  const wheel = pad(2);
  let pads: (Gamepad | null)[] = [null, null, wheel];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  vi.stubGlobal('window', new EventTarget());
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.mapping, {
    device: { id: wheel.id, index: wheel.index },
    axisPedals: true,
    steerAxis: 0,
    throttleAxis: 1,
    brakeAxis: 2,
    clutchAxis: 3,
    wheelSteering: true,
    manualClutch: true,
    shiftUpButton: 10,
    shiftDownButton: 11,
    calibration: {
      steering: { axis: 0, left: -0.8, center: 0, right: 0.6 },
      throttle: { axis: 1, released: 1, pressed: -1 },
      brake: { axis: 2, released: -1, pressed: 1 },
      clutch: { axis: 3, released: 1, pressed: -1 },
    },
  });
  const action = vi.fn();
  const input = new InputController(settings, action);
  input.setEnabled(true);
  const axes = wheel.axes as number[],
    buttons = wheel.buttons as GamepadButton[];
  return {
    input,
    action,
    wheel,
    axes,
    buttons,
    setPads: (value: (Gamepad | null)[]) => {
      pads = value;
    },
  };
}
describe('physical device controls', () => {
  it('delivers calibrated wheel input directly and maps independent pedals', () => {
    const f = fixture();
    f.axes[0] = 0.6;
    f.axes[1] = -1;
    f.axes[2] = -1;
    f.axes[3] = -1;
    const value = f.input.update(1 / 120);
    expect(value.steer).toBe(-1);
    expect(value.throttle).toBe(1);
    expect(value.brake).toBe(0);
    expect(value.clutch).toBe(1);
    expect(value.manualClutch).toBe(true);
    f.input.dispose();
  });
  it('uses configured paddles once on nonstandard wheels and ignores held buttons after resume', () => {
    const f = fixture();
    f.buttons[10] = button(1);
    expect(f.input.update(0.01).shift).toBe(0);
    f.buttons[10] = button(0);
    f.input.update(0.01);
    f.buttons[10] = button(1);
    expect(f.input.update(0.01).shift).toBe(1);
    f.input.state.shift = 0;
    expect(f.input.update(0.01).shift).toBe(0);
    f.buttons[11] = button(1);
    expect(f.input.update(0.01).shift).toBe(-1);
    f.input.dispose();
  });
  it('neutralizes and pauses once after disconnect, without applying the profile to another wheel', () => {
    const f = fixture();
    f.axes[1] = -1;
    expect(f.input.update(0.01).throttle).toBe(1);
    f.setPads([null, null, pad(2, 'Wrong wheel')]);
    expect(f.input.update(0.01).throttle).toBe(0);
    expect(f.action).toHaveBeenCalledWith('deviceLost');
    f.input.update(0.01);
    expect(f.action).toHaveBeenCalledTimes(1);
    f.input.dispose();
  });
  it('fails closed for a missing or changed calibrated pedal axis', () => {
    const f = fixture();
    f.input.settings.mapping.throttleAxis = 9;
    expect(f.input.update(0.01).throttle).toBe(0);
    expect(f.action).toHaveBeenCalledWith('deviceLost');
    f.input.dispose();
  });
});

it('an explicitly mapped standard-gamepad paddle owns its button instead of also pausing', () => {
  const f = fixture();
  Object.assign(f.wheel, { mapping: 'standard' });
  f.input.settings.mapping.shiftUpButton = 9;
  f.input.update(0.01);
  f.buttons[9] = button(1);
  expect(f.input.update(0.01).shift).toBe(1);
  expect(f.action).not.toHaveBeenCalled();
  f.input.dispose();
});
it('a broken profile is suppressed until reapplied instead of repeatedly pausing keyboard fallback', () => {
  const f = fixture();
  f.input.settings.mapping.throttleAxis = 9;
  f.input.update(0.01);
  for (let i = 0; i < 5; i++) f.input.update(0.01);
  expect(f.action).toHaveBeenCalledTimes(1);
  f.input.settings.mapping = structuredClone(f.input.settings.mapping);
  f.input.settings.mapping.throttleAxis = 1;
  f.axes[1] = -1;
  expect(f.input.update(0.01).throttle).toBe(1);
  f.input.dispose();
});
