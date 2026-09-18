import {
  calibratedPedal,
  calibratedSteer,
  readAxis,
  selectDevice,
  steeringResponse,
} from './calibration.ts';
import { boundAction, isHeld } from './bindings.ts';
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
  deviceStatus = '';
  private lastDevice = '';
  private lastFault = '';
  private suppressedDevice = '';
  private blockedMapping: Settings['mapping'] | null = null;
  private touchEvents = new AbortController();
  constructor(
    public settings: Settings,
    private action: (name: string) => void,
  ) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    window.addEventListener('gamepaddisconnected', this.disconnected);
  }
  private keyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('input,select,textarea,button') && !this.enabled) return;
    if (!this.enabled && e.code !== 'Escape') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'F3', 'Tab'].includes(e.code))
      e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.action('pause');
      return;
    }
    const action = boundAction(this.settings.bindings, e.code);
    if (action) e.preventDefault();
    if (action === 'shiftUp') this.state.shift = 1;
    else if (action === 'shiftDown') this.state.shift = -1;
    else if (
      action &&
      !['throttle', 'brake', 'left', 'right', 'reverse', 'clutch'].includes(action)
    )
      this.action(action);
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private blur = () => {
    this.reset();
    if (this.enabled) this.action('blur');
  };
  private disconnected = (event: GamepadEvent) => {
    if (this.lastDevice === `${event.gamepad.index}:${event.gamepad.id}`)
      this.deviceFault('Selected controller disconnected.', false);
  };
  private deviceFault(message: string, suppress = true) {
    if (suppress) {
      this.suppressedDevice = this.lastDevice;
      this.blockedMapping = this.settings.mapping;
    }
    this.deviceStatus = message;
    this.reset();
    if (message !== this.lastFault) {
      this.lastFault = message;
      if (this.enabled) this.action('deviceLost');
    }
    return this.state;
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    this.reset();
  }
  reset() {
    this.keys.clear();
    this.steering = 0;
    Object.assign(this.state, controls());
    this.previousButtons.clear();
    this.lastDevice = '';
    this.touch = { left: false, right: false, throttle: false, brake: false };
  }
  bindTouch(element: HTMLElement, action: 'left' | 'right' | 'throttle' | 'brake') {
    const options = { signal: this.touchEvents.signal };
    element.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        element.setPointerCapture(e.pointerId);
        this.touch[action] = true;
      },
      options,
    );
    const release = () => (this.touch[action] = false);
    element.addEventListener('pointerup', release, options);
    element.addEventListener('pointercancel', release, options);
    element.addEventListener('lostpointercapture', release, options);
  }
  update(dt: number) {
    if (!this.enabled) return this.state;
    const b = this.settings.bindings,
      k = this.keys,
      t = this.touch;
    let steer =
      Number(isHeld(k, b, 'right', ['ArrowRight']) || t.right) -
      Number(isHeld(k, b, 'left', ['ArrowLeft']) || t.left);
    let throttle = Number(isHeld(k, b, 'throttle', ['ArrowUp']) || t.throttle),
      brake = Number(isHeld(k, b, 'brake', ['ArrowDown', 'Space']) || t.brake);
    const m = this.settings.mapping;
    let clutch = Number(isHeld(k, b, 'clutch'));
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch (error) {
      this.deviceStatus = `Gamepad access unavailable: ${String(error)}`;
      if (this.lastDevice) return this.deviceFault(this.deviceStatus, false);
    }
    let pad = selectDevice(pads, m.device);
    if (pad && this.blockedMapping === m && this.suppressedDevice === `${pad.index}:${pad.id}`)
      pad = null;
    if (!pad && this.lastDevice)
      return this.deviceFault('Selected controller disconnected or changed.', false);
    let wheelInput = false;
    if (pad) {
      this.gamepadName = pad.id;
      const identity = `${pad.index}:${pad.id}`;
      // A button held while connecting/resuming is not a new paddle press.
      if (identity !== this.lastDevice) {
        this.previousButtons.clear();
        pad.buttons.forEach((button, index) => {
          if (button.pressed) this.previousButtons.add(index);
        });
        this.lastDevice = identity;
      }
      const raw = readAxis(pad, m.steerAxis);
      const sc = m.calibration.steering;
      if (raw === undefined || (sc && sc.axis !== m.steerAxis))
        return this.deviceFault(
          'Steering axis is missing or its calibration belongs to a different axis.',
        );
      const normalized = (sc ? calibratedSteer(raw, sc) : raw) * (m.invertSteer ? -1 : 1);
      const v = steeringResponse(normalized, m.deadzone, m.saturation, m.exponent);
      wheelInput = m.wheelSteering && steer === 0;
      if (wheelInput || (!m.wheelSteering && Math.abs(v) > 0.001)) steer = v;
      const pedal = (
        name: 'throttle' | 'brake' | 'clutch',
        axis: number,
        button: number,
        useAxis: boolean,
      ) => {
        if (!useAxis) {
          if (button < 0) return 0;
          const value = pad.buttons[button]?.value;
          return value !== undefined && Number.isFinite(value) ? clamp(value, 0, 1) : undefined;
        }
        const raw = readAxis(pad, axis),
          calibration = m.calibration[name];
        if (raw === undefined || (calibration && calibration.axis !== axis)) return undefined;
        return calibration
          ? calibratedPedal(raw, calibration)
          : clamp((1 + (m.invertPedals ? -1 : 1) * raw) / 2, 0, 1);
      };
      const pt = pedal('throttle', m.throttleAxis, m.throttleButton, m.axisPedals);
      const pb = pedal('brake', m.brakeAxis, m.brakeButton, m.axisPedals);
      const pc = m.manualClutch
        ? pedal('clutch', m.clutchAxis, m.clutchButton, m.clutchAxis >= 0)
        : 0;
      if (pt === undefined || pb === undefined || pc === undefined)
        return this.deviceFault('A mapped pedal is missing or needs recalibration. Input paused.');
      throttle = Math.max(throttle, pt);
      brake = Math.max(brake, pb);
      clutch = Math.max(clutch, pc);
      if (pad.mapping === 'standard') {
        for (const [index, name] of [
          [9, 'pause'],
          [3, 'camera'],
          [2, 'ers'],
        ] as const) {
          if (
            index === m.shiftUpButton ||
            index === m.shiftDownButton ||
            (m.manualClutch && index === m.clutchButton) ||
            (!m.axisPedals && (index === m.throttleButton || index === m.brakeButton))
          )
            continue;
          const down = !!pad.buttons[index]?.pressed;
          if (down && !this.previousButtons.has(index)) {
            this.action(name);
            if (!this.enabled) return this.state;
          }
          if (down) this.previousButtons.add(index);
          else this.previousButtons.delete(index);
        }
      }
      for (const [index, direction] of [
        [m.shiftDownButton, -1],
        [m.shiftUpButton, 1],
      ]) {
        if (index < 0) continue;
        const down = !!pad.buttons[index]?.pressed;
        if (down && !this.previousButtons.has(index)) this.state.shift = direction;
        if (down) this.previousButtons.add(index);
        else this.previousButtons.delete(index);
      }
      this.deviceStatus = 'Controller ready';
      this.lastFault = '';
    } else {
      this.gamepadName = 'KEYBOARD';
      this.deviceStatus = m.device
        ? 'Selected controller unavailable; keyboard remains available.'
        : 'Standard gamepad auto-detection. Select custom wheels in settings.';
    }
    this.steering = wheelInput
      ? steer
      : approach(
          this.steering,
          steer,
          Math.max(0, Math.min(dt, 0.25)) * (Math.abs(steer) < 0.001 ? 4.8 : 2.6),
        );
    // The simulation is right-handed with +Z forward and +X to the driver's
    // left. Devices use right-positive input, so convert exactly once here.
    // AI controls already use the simulation's left-positive convention.
    this.state.steer = -this.steering;
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.clutch = clutch;
    this.state.manualClutch = m.manualClutch;
    this.state.reverse = isHeld(k, b, 'reverse');
    return this.state;
  }
  dispose() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('gamepaddisconnected', this.disconnected);
    this.touchEvents.abort();
  }
}
