import {
  ControllerActions,
  type ActionContext,
  driveButtonOwner,
  type ButtonAction,
} from './button-actions.ts';
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
import { MAX_PENDING_SHIFTS, ShiftInputQueue } from '../workers/input-queue.ts';
export type TouchAction = 'left' | 'right' | 'throttle' | 'brake' | 'riderForward' | 'riderBack';
const releasedTouch = (): Record<TouchAction, boolean> => ({
  left: false,
  right: false,
  throttle: false,
  brake: false,
  riderForward: false,
  riderBack: false,
});
const deviceIdentity = (pad: Gamepad) => `${pad.index}:${pad.id}:${pad.mapping}`;
export class InputController {
  readonly state: Controls = controls();
  private keys = new Set<string>();
  private steering = 0;
  private previousButtons = new Set<number>();
  private readonly pendingShifts = new ShiftInputQueue();
  private enabled = false;
  private disposed = false;
  private generation = 0;
  private buttons = new ControllerActions();
  private touch = releasedTouch();
  private touchPointers = new Map<number, { element: HTMLElement; action: TouchAction }>();
  gamepadName = 'KEYBOARD';
  deviceStatus = '';
  private lastDevice = '';
  private lastSelection = '';
  private lastFault = '';
  private suppressedDevice = '';
  private blockedMapping: Settings['mapping'] | null = null;
  private touchEvents = new AbortController();
  private readonly ownerDocument = typeof document === 'undefined' ? null : document;
  constructor(
    public settings: Settings,
    private action: (name: string) => void,
  ) {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    window.addEventListener('gamepaddisconnected', this.disconnected);
    this.ownerDocument?.addEventListener('visibilitychange', this.visibilityChanged);
  }
  private keyDown = (e: KeyboardEvent) => {
    if (this.disposed || this.ownerDocument?.hidden || e.defaultPrevented) return;
    // Widgets own their keys even if driving remains enabled. The composed path
    // also identifies focused widgets inside a shadow root; window/document
    // targets do not implement Element methods.
    if (
      [e.target, ...(e.composedPath?.() ?? [])].some((target) => {
        const element = target as HTMLElement | null;
        const widgets = 'dialog[open],input,select,textarea,button';
        return (
          element?.isContentEditable || element?.closest?.(widgets) || element?.matches?.(widgets)
        );
      })
    )
      return;
    if (!this.enabled && e.code !== 'Escape') return;
    // A repeat arriving after reset/focus loss is not a fresh press.
    if (e.repeat && !this.keys.has(e.code)) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'F3', 'Tab'].includes(e.code))
      e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Escape') {
      // While the game consumes Escape it must also stop the browser's own default for
      // it (a dialog close request): the pause menu opens during this very keydown, and
      // the default would cancel it at once. That cancel used to be hidden because the
      // pause menu re-opened itself on every cancel, i.e. Escape flickered the menu and
      // could never resume (journey finding D1).
      if (this.enabled) e.preventDefault();
      this.action('pause');
      return;
    }
    const action = boundAction(this.settings.bindings, e.code);
    if (action) e.preventDefault();
    if (action === 'shiftUp') this.queueShift(1);
    else if (action === 'shiftDown') this.queueShift(-1);
    else if (
      action &&
      ![
        'throttle',
        'brake',
        'left',
        'right',
        'reverse',
        'clutch',
        'rearBrake',
        'riderForward',
        'riderBack',
      ].includes(action)
    )
      this.action(action);
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private queueShift(direction: number) {
    // The host acknowledges the exposed pulse by setting state.shift to zero.
    // Include that staged pulse in the bound, and drop newest overflow while
    // preserving the order of keyboard and gamepad edges already accepted.
    if (this.pendingShifts.pending + Number(this.state.shift !== 0) < MAX_PENDING_SHIFTS)
      this.pendingShifts.push(direction);
    this.stageShift();
  }
  private stageShift() {
    // Merely reading/updating controls must not consume an unacknowledged edge.
    if (this.state.shift === 0) this.state.shift = this.pendingShifts.take();
  }
  private blur = () => {
    // Inputs pressed while unfocused are a new baseline, not resume commands.
    this.buttons.reset();
    this.reset();
    if (this.enabled) this.action('blur');
  };
  private visibilityChanged = () => {
    if (this.ownerDocument?.hidden) this.blur();
  };
  private disconnected = (event: GamepadEvent) => {
    this.syncSelection();
    if (this.lastDevice === deviceIdentity(event.gamepad))
      this.deviceFault('Selected controller disconnected.', false);
  };
  private syncSelection() {
    const device = this.settings.mapping.device;
    const selection = device ? `${device.index}:${device.id}` : '';
    if (selection === this.lastSelection) return;
    // A deliberate settings selection starts a new ownership baseline. Merely
    // replacing the settings object must not authorize an automatic takeover.
    this.lastSelection = selection;
    this.lastDevice = '';
    this.previousButtons.clear();
    this.buttons.reset();
  }
  private lostDevice(pad: Gamepad | null) {
    return !!this.lastDevice && (!pad || deviceIdentity(pad) !== this.lastDevice);
  }
  private deviceFault(message: string, suppress = true) {
    if (suppress) {
      this.suppressedDevice = this.lastDevice;
      this.blockedMapping = this.settings.mapping;
    }
    this.deviceStatus = message;
    this.buttons.reset();
    this.reset();
    if (message !== this.lastFault) {
      this.lastFault = message;
      if (this.enabled) this.action('deviceLost');
    }
    return this.state;
  }
  setEnabled(value: boolean) {
    if (this.disposed) return;
    this.enabled = value;
    this.reset();
  }
  /** History navigation also revokes action edges. Ordinary pause/resume keeps
   * those edges, but a button held while away must become a new baseline. */
  suspendForPage() {
    this.buttons.reset();
    this.setEnabled(false);
  }
  reset() {
    this.generation++;
    this.keys.clear();
    this.steering = 0;
    this.pendingShifts.clear();
    Object.assign(this.state, controls());
    this.previousButtons.clear();
    this.lastDevice = '';
    this.touch = releasedTouch();
    const pointers = [...this.touchPointers];
    this.touchPointers.clear();
    for (const [pointerId, { element }] of pointers) {
      try {
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      } catch {
        // The browser may already have cancelled a pointer during focus loss.
      }
    }
  }
  private observeButtons(pad: Gamepad) {
    const identity = deviceIdentity(pad);
    if (identity === this.lastDevice) return;
    // Holding a button through connect/resume cannot manufacture a new edge.
    this.previousButtons.clear();
    pad.buttons.forEach((button, index) => {
      if (button.pressed) this.previousButtons.add(index);
    });
    this.lastDevice = identity;
  }
  private dispatchButtons(
    pad: Gamepad,
    allowed: ActionContext | readonly ButtonAction[] = 'driving',
  ) {
    const generation = this.generation;
    this.buttons.poll(pad, this.settings.mapping, allowed, this.action);
    return generation === this.generation;
  }
  /** The selected gamepad, for output-only cues such as rumble. */
  activePad(): Gamepad | null {
    if (this.disposed) return null;
    try {
      return selectDevice(navigator.getGamepads?.() ?? [], this.settings.mapping.device);
    } catch {
      return null;
    }
  }
  /** Paused/replay UI may poll a small action allowlist without ever reading or
   * publishing drive axes. Suppressed buttons are still observed, not delayed. */
  pollActions(allowed: ActionContext | readonly ButtonAction[]) {
    if (this.disposed || this.ownerDocument?.hidden) return;
    this.syncSelection();
    let pad: Gamepad | null;
    try {
      pad = selectDevice(navigator.getGamepads?.() ?? [], this.settings.mapping.device);
    } catch (error) {
      this.deviceStatus = `Gamepad access unavailable: ${String(error)}`;
      if (this.enabled && this.lastDevice) this.deviceFault(this.deviceStatus, false);
      return;
    }
    if (this.enabled && this.lostDevice(pad)) {
      this.deviceFault('Selected controller disconnected or changed.', false);
      return;
    }
    if (!pad) {
      this.lastDevice = '';
      this.previousButtons.clear();
      this.buttons.poll(null, this.settings.mapping, allowed, this.action);
      return;
    }
    if (
      this.blockedMapping === this.settings.mapping &&
      this.suppressedDevice === deviceIdentity(pad)
    )
      return;
    this.observeButtons(pad);
    this.dispatchButtons(pad, allowed);
  }
  bindTouch(element: HTMLElement, action: TouchAction) {
    if (this.disposed) return;
    const options = { signal: this.touchEvents.signal };
    element.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.enabled || this.ownerDocument?.hidden) return;
        e.preventDefault();
        try {
          element.setPointerCapture(e.pointerId);
        } catch {
          // A cancelled pointer cannot own a control without capture.
          return;
        }
        this.touchPointers.set(e.pointerId, { element, action });
        this.syncTouch();
      },
      options,
    );
    const release = (e: PointerEvent) => {
      for (const [pointerId, owner] of this.touchPointers) {
        if (owner.element === element && (e.pointerId === undefined || e.pointerId === pointerId))
          this.touchPointers.delete(pointerId);
      }
      this.syncTouch();
    };
    element.addEventListener('pointerup', release, options);
    element.addEventListener('pointercancel', release, options);
    element.addEventListener('lostpointercapture', release, options);
  }
  private syncTouch() {
    this.touch = releasedTouch();
    for (const { action } of this.touchPointers.values()) this.touch[action] = true;
  }
  update(dt: number) {
    if (!this.enabled || this.ownerDocument?.hidden) return this.state;
    this.syncSelection();
    const b = this.settings.bindings,
      k = this.keys,
      t = this.touch;
    let steer =
      Number(isHeld(k, b, 'right', ['ArrowRight']) || t.right) -
      Number(isHeld(k, b, 'left', ['ArrowLeft']) || t.left);
    let throttle = Number(isHeld(k, b, 'throttle', ['ArrowUp']) || t.throttle),
      brake = Number(isHeld(k, b, 'brake', ['ArrowDown', 'Space']) || t.brake);
    const forward = isHeld(k, b, 'riderForward') || t.riderForward,
      back = isHeld(k, b, 'riderBack') || t.riderBack;
    let riderLean = Number(forward) - Number(back);
    const m = this.settings.mapping;
    let clutch = Number(isHeld(k, b, 'clutch'));
    let rearBrake = Number(isHeld(k,b,'rearBrake'));
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch (error) {
      this.deviceStatus = `Gamepad access unavailable: ${String(error)}`;
      if (this.lastDevice) return this.deviceFault(this.deviceStatus, false);
    }
    let pad = selectDevice(pads, m.device);
    if (pad && this.blockedMapping === m && this.suppressedDevice === deviceIdentity(pad))
      pad = null;
    // Automatic selection can return a second connected pad immediately. Lose
    // the established owner before reading that replacement's held controls.
    if (this.lostDevice(pad))
      return this.deviceFault('Selected controller disconnected or changed.', false);
    let wheelInput = false;
    if (pad) {
      this.gamepadName = pad.id;
      this.observeButtons(pad);
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
      if ((m.rearBrakeButton ?? -1) >= 0) {
        const rear = pad.buttons[m.rearBrakeButton!];
        if (!rear) return this.deviceFault('The mapped rear brake button is missing. Input paused.');
        rearBrake = Math.max(rearBrake, clamp(rear.value || Number(rear.pressed),0,1));
      }
      // The standard right-stick vertical axis independently positions the
      // rider. Explicit keyboard/touch input owns this axis, including a
      // deliberate neutral from both keys. A custom wheel, missing stick or
      // axis already assigned to a driving control must never move the rider.
      if (
        !forward &&
        !back &&
        pad.mapping === 'standard' &&
        !m.wheelSteering &&
        m.steerAxis !== 3 &&
        (!m.axisPedals || (m.throttleAxis !== 3 && m.brakeAxis !== 3)) &&
        (!m.manualClutch || m.clutchAxis !== 3)
      ) {
        const bodyAxis = readAxis(pad, 3);
        if (bodyAxis !== undefined) riderLean = steeringResponse(-bodyAxis, m.deadzone, 1, 1);
      }
      if (!this.dispatchButtons(pad)) return this.state;
      for (const [index, direction] of [
        [m.shiftDownButton, -1],
        [m.shiftUpButton, 1],
      ]) {
        if (index < 0) continue;
        const down = !!pad.buttons[index]?.pressed;
        if (down && !this.previousButtons.has(index)) this.queueShift(direction);
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
    this.state.riderLean = riderLean || 0;
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.clutch = clutch;
    this.state.rearBrake = rearBrake;
    this.state.manualClutch = m.manualClutch;
    const reverse = m.buttonActions.reverse;
    this.state.reverse =
      isHeld(k, b, 'reverse') ||
      !!(pad && reverse >= 0 && !driveButtonOwner(m, reverse) && pad.buttons[reverse]?.pressed);
    this.stageShift();
    return this.state;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.buttons.reset();
    this.reset();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('gamepaddisconnected', this.disconnected);
    this.ownerDocument?.removeEventListener('visibilitychange', this.visibilityChanged);
    this.touchEvents.abort();
  }
}
