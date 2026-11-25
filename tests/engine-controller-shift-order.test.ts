import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller.ts';
import { InputPump } from '../src/input/pump.ts';
import type { Controls } from '../src/simulation/config.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { MAX_PENDING_SHIFTS, ShiftInputQueue } from '../src/workers/input-queue.ts';

// Execute the application's actual sampling callback, including its scalar
// acknowledgement, without importing main.ts's DOM boot and rendering assets.
function hostPumpInstaller() {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  );
  if (!owner) throw new Error('Missing GameApp');
  const assignments: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(source) === 'this.inputPump' &&
      ts.isNewExpression(node.right)
    )
      assignments.push(node);
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (assignments.length !== 1) throw new Error('Expected one GameApp InputPump assignment');
  const compiled = ts.transpileModule(
    `class Host { install() { ${assignments[0].getText(source)}; return this.inputPump; } }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function('InputPump', `${compiled}; return Host.prototype.install;`)(InputPump) as (
    this: object,
  ) => InputPump;
}

const installPump = hostPumpInstaller();
const cleanup: (() => void)[] = [];
const button = (pressed = false, value = Number(pressed)) => ({ pressed, touched: pressed, value });

function fixture(mode: 'circuit' | 'festival' = 'circuit', withPad = false) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => null });
  const pad = {
    index: 0,
    id: 'Shift controller',
    connected: true,
    mapping: 'standard' as GamepadMappingType,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => button()),
  };
  let pads = withPad ? [pad] : [];
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const settings = structuredClone(DEFAULT_SETTINGS);
  const action = vi.fn();
  const input = new InputController(settings, action);
  input.setEnabled(true);
  const workerShifts = new ShiftInputQueue();
  const messages: Controls[] = [];
  const publish = (value: Controls) => {
    // The worker transport owns a clone, while the production callback clears
    // the controller's retained scalar after publishing it.
    const snapshot = structuredClone(value);
    messages.push(snapshot);
    workerShifts.push(snapshot.shift);
  };
  const host = {
    state: 'driving',
    errorStopped: false,
    input,
    ers: 1,
    drsPress: false,
    overtakePress: false,
    ui: { telemetryModal: { open: false }, modal: { open: false } },
    festival: mode === 'festival' ? { drivingInputEnabled: true, input: publish } : null,
    post: (message: { input: Controls }) => publish(message.input),
  };
  const pump = installPump.call(host);
  pump.start();
  cleanup.push(() => {
    pump.dispose();
    input.dispose();
  });
  const key = (
    code: string,
    options: { up?: boolean; repeat?: boolean; path?: EventTarget[] } = {},
  ) => {
    const event = Object.assign(new Event(options.up ? 'keyup' : 'keydown', { cancelable: true }), {
      code,
      repeat: options.repeat ?? false,
    });
    if (options.path) Object.defineProperty(event, 'composedPath', { value: () => options.path });
    window.dispatchEvent(event);
    return event;
  };
  const tap = (direction: number) => {
    const code = direction > 0 ? settings.bindings.shiftUp : settings.bindings.shiftDown;
    key(code);
    key(code, { up: true });
  };
  return {
    input,
    settings,
    action,
    window,
    document,
    pad,
    pump,
    messages,
    workerShifts,
    key,
    tap,
    disconnect: () => {
      pads = [];
      window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: pad }));
    },
    sample: () => {
      pump.poll();
      return workerShifts.take();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('controller shift intent through the host and worker queue', () => {
  it.each(['circuit', 'festival'] as const)(
    '%s publishes repeated and opposing key presses in order while analog levels stay current',
    (mode) => {
      const f = fixture(mode);
      for (const shift of [1, 1, -1]) f.tap(shift);
      expect(f.input.state.shift).toBe(1);
      // Reading/updating controls is not an acknowledgement. Only the host's
      // zero after publication may expose the next pulse.
      for (let i = 0; i < 3; i++) expect(f.input.update(1 / 60).shift).toBe(1);
      f.key(f.settings.bindings.throttle);
      f.pump.poll();
      expect(f.input.state.shift).toBe(0);
      expect(f.messages[0]).toMatchObject({ shift: 1, throttle: 1, brake: 0 });

      // A new edge between acknowledgement and the next poll must join the
      // tail, never jump ahead of the two previously accepted presses.
      f.tap(-1);
      expect(f.input.state.shift).toBe(1);
      f.tap(1);
      f.key(f.settings.bindings.throttle, { up: true });
      f.key(f.settings.bindings.brake);
      for (let i = 0; i < 5; i++) f.pump.poll();
      expect(f.messages.map((input) => input.shift)).toEqual([1, 1, -1, -1, 1, 0]);
      expect(f.messages.slice(1).every((input) => input.throttle === 0 && input.brake === 1)).toBe(
        true,
      );
      expect(f.messages[0].throttle).toBe(1);
      expect(Array.from({ length: 6 }, () => f.workerShifts.take())).toEqual([1, 1, -1, -1, 1, 0]);
    },
  );

  it('shares ordered intent across keyboard and gamepad edges without repeating held paddles', () => {
    const f = fixture('circuit', true);
    const up = f.settings.mapping.shiftUpButton;
    const down = f.settings.mapping.shiftDownButton;
    f.input.update(1 / 60);
    f.tap(1);
    f.pad.buttons[down] = button(true);
    f.pad.buttons[up] = button(true);
    // Both edges discovered in one poll retain the controller's down/up scan
    // order. Later observations of the same held buttons add no new presses.
    for (let i = 0; i < 3; i++) f.input.update(1 / 60);
    f.pad.buttons[down] = button();
    f.pad.buttons[up] = button();
    f.input.update(1 / 60);
    f.pad.buttons[up] = button(true);
    f.input.update(1 / 60);
    f.tap(-1);
    f.pad.buttons[f.settings.mapping.throttleButton] = button(true, 0.6);
    expect(Array.from({ length: 7 }, () => f.sample())).toEqual([1, -1, 1, 1, -1, 0, 0]);
    expect(f.messages.every((input) => input.throttle === 0.6)).toBe(true);
  });

  it('bounds the staged pulse plus reserve and accepts new intent after the host frees a slot', () => {
    const f = fixture();
    const accepted = Array.from({ length: MAX_PENDING_SHIFTS }, (_, i) => (i % 3 ? 1 : -1));
    for (const shift of accepted) f.tap(shift);
    for (let i = 0; i < 40; i++) f.tap(-1);
    expect(f.sample()).toBe(accepted[0]);
    // This newly freed slot belongs after every surviving older pulse.
    f.tap(1);
    f.key(f.settings.bindings.throttle);
    expect(Array.from({ length: MAX_PENDING_SHIFTS + 2 }, () => f.sample())).toEqual([
      ...accepted.slice(1),
      1,
      0,
      0,
    ]);
    expect(f.messages.slice(1).every((input) => input.throttle === 1)).toBe(true);
  });

  it('leaves widget keys and keyboard repeats outside the shift queue', () => {
    const f = fixture();
    const up = f.settings.bindings.shiftUp;
    const widget = { matches: () => true } as unknown as EventTarget;
    expect(f.key(up, { path: [widget, f.window] }).defaultPrevented).toBe(false);
    f.key(up, { up: true });
    expect(f.key(up).defaultPrevented).toBe(true);
    f.key(up, { repeat: true });
    f.key(up, { repeat: true });
    f.key(up, { up: true });
    f.tap(-1);
    expect([f.sample(), f.sample(), f.sample()]).toEqual([1, -1, 0]);
  });

  it.each(['reset', 'disable', 'blur', 'hidden', 'disconnect', 'dispose'] as const)(
    '%s clears the staged pulse and reserve before any later host sample',
    (boundary) => {
      const f = fixture('circuit', true);
      f.input.update(1 / 60);
      for (const shift of [1, -1, 1]) f.tap(shift);
      expect(f.input.state.shift).toBe(1);
      if (boundary === 'reset') f.input.reset();
      else if (boundary === 'disable') f.input.setEnabled(false);
      else if (boundary === 'blur') f.window.dispatchEvent(new Event('blur'));
      else if (boundary === 'hidden') {
        f.document.hidden = true;
        f.document.dispatchEvent(new Event('visibilitychange'));
        f.document.hidden = false;
      } else if (boundary === 'disconnect') f.disconnect();
      else f.input.dispose();
      expect(f.input.state.shift).toBe(0);
      expect([f.sample(), f.sample(), f.sample()]).toEqual([0, 0, 0]);
      if (boundary === 'disable') f.input.setEnabled(true);
      if (boundary !== 'dispose') {
        f.tap(-1);
        expect([f.sample(), f.sample()]).toEqual([-1, 0]);
      } else {
        f.input.setEnabled(true);
        f.tap(-1);
        expect(f.sample()).toBe(0);
      }
    },
  );
});
