import type { InputMapping } from '../storage/data.ts';

export const BUTTON_ACTION_LABELS = {
  pause: 'Pause / resume',
  camera: 'Cycle camera',
  ers: 'Hybrid mode',
  pit: 'Request / cancel pit',
  replay: 'Open / close replay',
  telemetry: 'Telemetry',
  mute: 'Mute',
  debug: 'Engineering overlay',
  autopilot: 'AI demonstration',
} as const;
export type ButtonAction = keyof typeof BUTTON_ACTION_LABELS;
export type ButtonActions = Record<ButtonAction, number>;
export const DEFAULT_BUTTON_ACTIONS: ButtonActions = {
  pause: 9,
  camera: 3,
  ers: 2,
  pit: -1,
  replay: -1,
  telemetry: -1,
  mute: -1,
  debug: -1,
  autopilot: -1,
};
export const BUTTON_ACTIONS = Object.keys(BUTTON_ACTION_LABELS) as ButtonAction[];
export type ActionContext = 'driving' | 'paused' | 'replay' | 'off';

export function occupiedDrivingButtons(mapping: InputMapping) {
  const buttons = new Map<number, string>();
  for (const [button, name] of [
    [mapping.shiftUpButton, 'Upshift'],
    [mapping.shiftDownButton, 'Downshift'],
    ...(!mapping.axisPedals
      ? [
          [mapping.throttleButton, 'Throttle'],
          [mapping.brakeButton, 'Brake'],
        ]
      : []),
    ...(mapping.manualClutch && mapping.clutchAxis < 0 ? [[mapping.clutchButton, 'Clutch']] : []),
  ] as [number, string][])
    if (button >= 0) buttons.set(button, name);
  return buttons;
}
/** V1–4 had implicit standard-controller actions. Migration preserves the old
 * driving-button precedence; unmapped wheels do not acquire surprise actions. */
export function validateButtonActions(
  value: unknown,
  mapping: InputMapping,
  legacy = false,
): ButtonActions {
  const defaults = { ...DEFAULT_BUTTON_ACTIONS };
  if (legacy && mapping.device) for (const key of BUTTON_ACTIONS) defaults[key] = -1;
  const source = legacy ? defaults : value;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Controller actions must be a button map');
  const result = {} as ButtonActions,
    occupied = occupiedDrivingButtons(mapping);
  for (const key of BUTTON_ACTIONS) {
    let n = (source as Record<string, unknown>)[key];
    if (!Number.isInteger(n) || (n as number) < -1 || (n as number) > 127)
      throw new Error(`${BUTTON_ACTION_LABELS[key]} requires a whole button number from -1 to 127`);
    if (legacy && occupied.has(n as number)) n = -1;
    if ((n as number) >= 0 && occupied.has(n as number))
      throw new Error(
        `${BUTTON_ACTION_LABELS[key]} conflicts with ${occupied.get(n as number)} on button ${n}`,
      );
    result[key] = n as number;
    if ((n as number) >= 0) occupied.set(n as number, BUTTON_ACTION_LABELS[key]);
  }
  return result;
}

/** Edges survive pause/resume. Held buttons on connect/rebind are baselines, not
 * commands. Forbidden actions are consumed in menus rather than deferred. */
export class ControllerActions {
  private held = new Uint8Array(128);
  private device = '';
  private mapping: InputMapping | null = null;
  poll(
    pad: Gamepad | null,
    mapping: InputMapping,
    context: ActionContext,
    emit: (action: ButtonAction) => void,
  ) {
    const id = pad ? `${pad.index}:${pad.id}` : '';
    const baseline = id !== this.device || mapping !== this.mapping;
    this.device = id;
    this.mapping = mapping;
    if (!pad) {
      this.held.fill(0);
      return;
    }
    let dispatched = false;
    for (let index = 0; index < this.held.length; index++) {
      const value = pad.buttons[index];
      const down = !!value && Number.isFinite(value.value) && value.pressed;
      const edge = down && !this.held[index];
      this.held[index] = Number(down);
      if (
        baseline ||
        !edge ||
        context === 'off' ||
        dispatched ||
        index === mapping.shiftUpButton ||
        index === mapping.shiftDownButton ||
        (!mapping.axisPedals &&
          (index === mapping.throttleButton || index === mapping.brakeButton)) ||
        (mapping.manualClutch && mapping.clutchAxis < 0 && index === mapping.clutchButton)
      )
        continue;
      const action = BUTTON_ACTIONS.find((key) => mapping.buttonActions[key] === index);
      if (
        !action ||
        (context === 'paused' && action !== 'pause') ||
        (context === 'replay' && !['pause', 'camera', 'replay', 'mute', 'debug'].includes(action))
      )
        continue;
      dispatched = true; // One UI transition per sample; other held presses are consumed.
      emit(action);
    }
  }
}
