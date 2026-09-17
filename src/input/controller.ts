import { approach, clamp } from '../core/math.ts';
import { controls, type Controls } from '../simulation/config.ts';
import type { Settings } from '../storage/data.ts';
export class InputController {
  readonly state: Controls = controls();
  private keys = new Set<string>();
  private steering = 0;
  private previousButtons = new Set<number>();
  private enabled = false;
  private touch = { left: false, right: false, throttle: false, brake: false };
  gamepadName = 'KEYBOARD';
  constructor(
    public settings: Settings,
    private action: (name: string) => void,
  ) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    window.addEventListener('gamepaddisconnected', this.blur);
  }
  private keyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('input,select,textarea,button') && !this.enabled) return;
    if (!this.enabled && e.code !== 'Escape') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'F3', 'Tab'].includes(e.code))
      e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    const actions: Record<string, string> = {
      Escape: 'pause',
      KeyC: 'camera',
      KeyP: 'pit',
      KeyE: 'ers',
      KeyR: 'replay',
      KeyT: 'telemetry',
      F3: 'debug',
      KeyM: 'mute',
      KeyG: 'autopilot',
    };
    if (actions[e.code]) this.action(actions[e.code]);
    if (e.code === 'BracketRight') this.state.shift = 1;
    if (e.code === 'BracketLeft') this.state.shift = -1;
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private blur = () => {
    this.reset();
    if (this.enabled) this.action('blur');
  };
  setEnabled(value: boolean) {
    this.enabled = value;
    this.reset();
  }
  reset() {
    this.keys.clear();
    this.steering = 0;
    Object.assign(this.state, controls());
    this.previousButtons.clear();
    this.touch = { left: false, right: false, throttle: false, brake: false };
  }
  bindTouch(element: HTMLElement, action: 'left' | 'right' | 'throttle' | 'brake') {
    element.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      element.setPointerCapture(e.pointerId);
      this.touch[action] = true;
    });
    const release = () => (this.touch[action] = false);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
  }
  update(dt: number) {
    if (!this.enabled) return this.state;
    const b = this.settings.bindings,
      k = this.keys,
      t = this.touch;
    let steer =
      Number(k.has(b.right) || k.has('ArrowRight') || t.right) -
      Number(k.has(b.left) || k.has('ArrowLeft') || t.left);
    let throttle = Number(k.has(b.throttle) || k.has('ArrowUp') || t.throttle),
      brake = Number(k.has(b.brake) || k.has('ArrowDown') || k.has('Space') || t.brake);
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      this.gamepadName = pad.id;
      const m = this.settings.mapping;
      const raw = (pad.axes[m.steerAxis] ?? 0) * (m.invertSteer ? -1 : 1),
        v =
          Math.sign(raw) *
          Math.pow(clamp((Math.abs(raw) - m.deadzone) / (1 - m.deadzone), 0, 1), m.exponent);
      if (Math.abs(v) > 0.001) steer = v;
      if (m.axisPedals) {
        const sign = m.invertPedals ? -1 : 1;
        throttle = Math.max(
          throttle,
          clamp((1 + sign * (pad.axes[m.throttleAxis] ?? -sign)) * 0.5, 0, 1),
        );
        brake = Math.max(brake, clamp((1 + sign * (pad.axes[m.brakeAxis] ?? -sign)) * 0.5, 0, 1));
      } else {
        throttle = Math.max(throttle, pad.buttons[m.throttleButton]?.value ?? 0);
        brake = Math.max(brake, pad.buttons[m.brakeButton]?.value ?? 0);
      }
      if (pad.mapping === 'standard') {
        for (const [index, name] of [
          [9, 'pause'],
          [3, 'camera'],
          [2, 'ers'],
        ] as const) {
          const down = pad.buttons[index]?.pressed;
          if (down && !this.previousButtons.has(index)) this.action(name);
          if (down) this.previousButtons.add(index);
          else this.previousButtons.delete(index);
        }
        for (const [index, direction] of [
          [4, -1],
          [5, 1],
        ] as const) {
          const down = pad.buttons[index]?.pressed;
          if (down && !this.previousButtons.has(index)) this.state.shift = direction;
          if (down) this.previousButtons.add(index);
          else this.previousButtons.delete(index);
        }
      }
    } else this.gamepadName = 'KEYBOARD';
    this.steering = approach(this.steering, steer, dt * (Math.abs(steer) < 0.001 ? 4.8 : 2.6));
    this.state.steer = this.steering;
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.reverse = k.has('KeyB');
    return this.state;
  }
  dispose() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('gamepaddisconnected', this.blur);
  }
}
