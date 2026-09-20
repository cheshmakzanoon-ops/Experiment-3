import type { InputMapping } from '../storage/data.ts';

export const BUTTON_ACTION_LABELS = {
  pause: 'Pause / resume',
  camera: 'Cycle camera',
  ers: 'Hybrid mode',
  pit: 'Request / cancel pit',
  telemetry: 'Telemetry',
  replay: 'Replay / exit',
  autopilot: 'AI demonstration',
  mute: 'Mute',
  debug: 'Engineering overlay',
  reverse: 'Reverse (hold at low speed)',
} as const;
export type ButtonAction = keyof typeof BUTTON_ACTION_LABELS;
export type ButtonActions = Record<ButtonAction, number>;
export const BUTTON_ACTIONS = Object.keys(BUTTON_ACTION_LABELS) as ButtonAction[];
export type ActionContext = 'driving' | 'paused' | 'replay' | 'off';
export const DEFAULT_BUTTON_ACTIONS: ButtonActions = defaultButtonActions(true);
/** Use the standard layout only when its mapping is known. Legacy explicitly
 * selected devices migrate unbound because their mapping type was not saved;
 * the editor can initialize a currently connected standard pad explicitly. */
export function defaultButtonActions(standard = false): ButtonActions {
  return {
    pause: standard ? 9 : -1,
    camera: standard ? 3 : -1,
    ers: standard ? 2 : -1,
    pit: -1,
    telemetry: -1,
    replay: -1,
    autopilot: -1,
    mute: -1,
    debug: -1,
    reverse: -1,
  };
}
export function driveButtonOwner(mapping: InputMapping, index: number): string | null {
  if (index < 0) return null;
  if (index === mapping.shiftUpButton) return 'upshift';
  if (index === mapping.shiftDownButton) return 'downshift';
  if (mapping.manualClutch && mapping.clutchAxis < 0 && index === mapping.clutchButton)
    return 'clutch';
  if (!mapping.axisPedals) {
    if (index === mapping.throttleButton) return 'throttle';
    if (index === mapping.brakeButton) return 'brake';
  }
  return null;
}
/** Legacy action conflicts were previously ignored by runtime. Preserve that
 * behavior by migrating the conflicting action to disabled; never steal a pedal. */
export function validateButtonActions(
  value: unknown,
  mapping: InputMapping,
  legacy = false,
): ButtonActions {
  if (!legacy && (!value || typeof value !== 'object' || Array.isArray(value)))
    throw new Error('Controller action bindings must be an object');
  const source = legacy
    ? defaultButtonActions(!mapping.device)
    : (value as Record<string, unknown>);
  const result = defaultButtonActions();
  const occupied = new Map<number, string>();
  const drive: [number, string][] = [
    [mapping.shiftUpButton, 'upshift'],
    [mapping.shiftDownButton, 'downshift'],
  ];
  if (!mapping.axisPedals)
    drive.push([mapping.throttleButton, 'throttle'], [mapping.brakeButton, 'brake']);
  if (mapping.manualClutch && mapping.clutchAxis < 0) drive.push([mapping.clutchButton, 'clutch']);
  for (const [index, name] of drive) {
    if (index < 0) continue;
    const owner = occupied.get(index);
    if (owner)
      throw new Error(
        `Button ${index} is already assigned to ${owner}; ${name} needs a different button`,
      );
    occupied.set(index, name);
  }

  if (!legacy && Object.keys(source).some((key) => !BUTTON_ACTIONS.includes(key as ButtonAction)))
    throw new Error('Unknown controller action');
  for (const action of BUTTON_ACTIONS) {
    const index = source[action];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < -1 || index > 127)
      throw new Error(`${BUTTON_ACTION_LABELS[action]}: use a whole button number from -1 to 127`);
    const owner = driveButtonOwner(mapping, index) ?? occupied.get(index);
    if (index >= 0 && owner) {
      if (legacy) continue;
      throw new Error(`Button ${index} is already assigned to ${owner}`);
    }
    result[action] = index;
    if (index >= 0) occupied.set(index, BUTTON_ACTION_LABELS[action]);
  }
  return result;
}

/** Edges survive pause/resume. Held buttons on connect/rebind are baselines, not
 * commands. Forbidden actions are consumed in menus rather than deferred. */
export class ControllerActions {
  private held = new Uint8Array(128);
  private device = '';
  private mapping: InputMapping | null = null;
  reset() {
    this.held.fill(0);
    this.device = '';
    this.mapping = null;
  }
  poll(
    pad: Gamepad | null,
    mapping: InputMapping,
    context: ActionContext | readonly ButtonAction[],
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
        action === 'reverse' ||
        (Array.isArray(context) && !context.includes(action)) ||
        (context === 'paused' && action !== 'pause') ||
        (context === 'replay' && !['pause', 'camera', 'replay', 'mute', 'debug'].includes(action))
      )
        continue;
      dispatched = true; // One UI transition per sample; other held presses are consumed.
      emit(action);
    }
  }
}
