import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { InputController } from '../src/input/controller.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

class InputTarget extends EventTarget {
  matches() {
    return false;
  }
  setPointerCapture() {
    /* No browser capture is needed in this event fixture. */
  }
}
function setup(pad?: Partial<Gamepad>) {
  const window = new InputTarget();
  vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', { getGamepads: () => (pad ? [pad] : []) });
  const input = new InputController(structuredClone(DEFAULT_SETTINGS), () => undefined);
  input.setEnabled(true);
  return { input, window };
}
function key(window: EventTarget, code: string) {
  window.dispatchEvent(
    Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: false }),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe('human input and vehicle coordinate boundary', () => {
  it.each([
    ['KeyD', -1],
    ['KeyA', 1],
    ['ArrowRight', -1],
    ['ArrowLeft', 1],
  ] as const)('%s steers in the intended driver-view direction', (code, sign) => {
    const { input, window } = setup();
    key(window, code);
    expect(Math.sign(input.update(0.2).steer)).toBe(sign);
    input.dispose();
  });
  it('converts right-positive gamepad axes exactly once and honors calibration inversion', () => {
    const { input } = setup({
      connected: true,
      id: 'Test wheel',
      axes: [0.7],
      buttons: [],
      mapping: '',
    });
    expect(input.update(0.2).steer).toBeLessThan(0);
    input.settings.mapping.invertSteer = true;
    expect(input.update(1).steer).toBeGreaterThan(0);
    input.dispose();
  });
  it('applies the same direction conversion to touch steering', () => {
    const { input } = setup();
    const element = new InputTarget();
    input.bindTouch(element as unknown as HTMLElement, 'right');
    element.dispatchEvent(
      Object.assign(new Event('pointerdown', { cancelable: true }), { pointerId: 1 }),
    );
    expect(input.update(0.2).steer).toBeLessThan(0);
    element.dispatchEvent(new Event('pointercancel'));
    expect(Math.abs(input.update(1).steer)).toBe(0);
    input.dispose();
  });
  it('a real car commanded right moves to the right in the starting camera frame', () => {
    const { input, window } = setup();
    key(window, 'KeyW');
    key(window, 'KeyD');
    const track = new Track('clear', true);
    track.windX = track.windZ = 0;
    const car = new Vehicle(0);
    car.place(track, 30);
    const q = new T.Quaternion(
      car.body.orientation.x,
      car.body.orientation.y,
      car.body.orientation.z,
      car.body.orientation.w,
    );
    const start = new T.Vector3(car.body.position.x, car.body.position.y, car.body.position.z);
    const camera = new T.PerspectiveCamera();
    camera.position.copy(start).add(new T.Vector3(0, 2, -6).applyQuaternion(q));
    camera.lookAt(start);
    camera.updateMatrixWorld();
    const screenRight = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    for (let i = 0; i < 720; i++) {
      Object.assign(car.input, input.update(1 / 240));
      car.step(1 / 240, track);
    }
    const displacement = new T.Vector3(
      car.body.position.x,
      car.body.position.y,
      car.body.position.z,
    ).sub(start);
    expect(displacement.dot(screenRight)).toBeGreaterThan(1);
    input.dispose();
  }, 30000);
});
