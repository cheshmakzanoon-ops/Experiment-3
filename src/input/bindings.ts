export const DEFAULT_BINDINGS = {
  throttle: 'KeyW',
  brake: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  reverse: 'KeyB',
  clutch: 'ShiftLeft',
  shiftDown: 'BracketLeft',
  shiftUp: 'BracketRight',
  camera: 'KeyC',
  pit: 'KeyP',
  ers: 'KeyE',
  replay: 'KeyR',
  telemetry: 'KeyT',
  debug: 'F3',
  mute: 'KeyM',
  autopilot: 'KeyG',
};
export type BindingAction = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<BindingAction, string>;
export const BINDING_LABELS: Record<BindingAction, string> = {
  throttle: 'Throttle',
  brake: 'Brake',
  left: 'Steer left',
  right: 'Steer right',
  reverse: 'Reverse (hold at low speed)',
  clutch: 'Clutch pedal (manual clutch mode)',
  shiftDown: 'Downshift',
  shiftUp: 'Upshift',
  camera: 'Cycle camera',
  pit: 'Request / cancel pit',
  ers: 'Hybrid mode',
  replay: 'Replay',
  telemetry: 'Telemetry',
  debug: 'Engineering overlay',
  mute: 'Mute',
  autopilot: 'AI demonstration',
};
export const validBindingCode = (code: unknown): code is string =>
  typeof code === 'string' &&
  /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Space|Bracket(Left|Right)|Shift(Left|Right)|Control(Left|Right)|Comma|Period|Slash|Backquote|Minus|Equal|F[1-4]|F[6-9]|F10)$/.test(
    code,
  );
export function validateBindings(value: unknown): Bindings {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const result = { ...DEFAULT_BINDINGS };
  if (source.clutch === undefined) {
    result.clutch =
      ['ShiftLeft', 'ShiftRight', 'ControlRight', 'ControlLeft', 'KeyQ', 'KeyZ'].find(
        (code) =>
          !Object.entries(source).some(([name, value]) => name !== 'clutch' && value === code),
      ) ?? 'ShiftLeft';
  }
  const occupied = new Map<string, string>();
  for (const action of Object.keys(result) as BindingAction[]) {
    const code = source[action] === undefined ? result[action] : source[action];
    if (!validBindingCode(code))
      throw new Error(`Invalid ${BINDING_LABELS[action]} key. Escape remains reserved for pause.`);
    if (occupied.has(code))
      throw new Error(`${keyName(code)} is already assigned to ${occupied.get(code)}.`);
    result[action] = code;
    occupied.set(code, BINDING_LABELS[action]);
  }
  return result;
}
export function keyName(code: string) {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('BracketLeft', '[')
    .replace('BracketRight', ']');
}
export function boundAction(bindings: Bindings, code: string): BindingAction | null {
  for (const action of Object.keys(DEFAULT_BINDINGS) as BindingAction[])
    if (bindings[action] === code) return action;
  return null;
}
/** Arrow/space accessibility aliases are fallback inputs, never a second
 * simultaneous action when the same key has been explicitly reassigned. */
export function isHeld(
  keys: ReadonlySet<string>,
  bindings: Bindings,
  action: BindingAction,
  aliases: readonly string[] = [],
) {
  if (keys.has(bindings[action])) return true;
  return aliases.some((code) => keys.has(code) && boundAction(bindings, code) === null);
}
