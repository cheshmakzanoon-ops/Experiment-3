import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsGamepad } from '../src/ui/credits.ts';
import { Interface } from '../src/ui/interface.ts';
import type { LaunchBoard } from '../src/ui/launch-board.ts';
import { MenuGamepad } from '../src/ui/menu-gamepad.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';

/** Browser boundaries only: every selection, edge, repeat and teardown decision
 * is made by the real production classes. No MenuGamepad method is replaced. */
class MenuDocument extends EventTarget {
  hidden = false;
  focused = true;
  activeElement: MenuElement | null = null;
  hasFocus = () => this.focused;
}

class MenuElement extends EventTarget {
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { contains: (name: string) => this.classes.has(name) };
  children: MenuElement[] = [];
  queries = new Map<string, MenuElement | (() => MenuElement | null)>();
  lists = new Map<string, MenuElement[]>();
  attributes = new Map<string, string>();
  hidden = false;
  disabled = false;
  x = 0;
  y = 0;
  constructor(
    readonly doc: MenuDocument,
    readonly tag = 'button',
  ) {
    super();
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  querySelector(selector: string): MenuElement | null {
    const value = this.queries.get(selector);
    return typeof value === 'function' ? value() : (value ?? null);
  }
  querySelectorAll(selector: string) {
    return this.lists.get(selector) ?? this.children;
  }
  contains(element: MenuElement): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const name = part.trim();
      return name.startsWith('.') ? this.classes.has(name.slice(1)) : name === this.tag;
    });
  }
  closest(selector: string) {
    return selector === '[data-action]' && this.dataset.action ? this : null;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  getClientRects() {
    return this.hidden ? [] : [this.getBoundingClientRect()];
  }
  getBoundingClientRect() {
    return {
      x: this.x,
      y: this.y,
      width: 40,
      height: 20,
      left: this.x,
      right: this.x + 40,
      top: this.y,
      bottom: this.y + 20,
    } as DOMRect;
  }
  focus = vi.fn(() => {
    this.doc.activeElement = this;
    this.dispatchEvent(new Event('focus'));
  });
  click = vi.fn(() => {
    this.dispatchEvent(new Event('click'));
  });
  scrollIntoView = vi.fn();
  scrollBy = vi.fn();
  requestSubmit = vi.fn();
}

class MenuSelect extends MenuElement {
  value = 'one';
  options = ['one', 'two', 'three'].map((value) => {
    const isSelected = () => this.value === value;
    return {
      value,
      disabled: false,
      get selected() {
        return isSelected();
      },
    };
  });
}
class MenuInput extends MenuElement {
  type = 'range';
  value = 0;
  stepUp = vi.fn(() => {
    this.value++;
  });
  stepDown = vi.fn(() => {
    this.value--;
  });
}

const gamepad = (index = 0) => ({
  index,
  id: `Menu controller ${index}`,
  mapping: 'standard' as GamepadMappingType,
  connected: true,
  axes: [0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
});
type Pad = ReturnType<typeof gamepad>;
function press(pad: Pad, ...buttons: number[]) {
  pad.buttons.forEach((button, index) => {
    button.pressed = buttons.includes(index);
    button.touched = button.pressed;
    button.value = Number(button.pressed);
  });
}
const cleanup: (() => void)[] = [];

function fixture() {
  const document = new MenuDocument(),
    window = new EventTarget();
  const root = new MenuElement(document, 'main'),
    menu = new MenuElement(document, 'section');
  const scope = new MenuElement(document, 'div');
  scope.classes.add('menu-body');
  root.dataset.mode = 'menu';
  root.queries.set('#menu', menu);
  root.queries.set('dialog[open]', () => state.dialog);
  menu.queries.set('.menu-body', scope);
  const controls = Array.from({ length: 5 }, (_, index) => {
    const control = new MenuElement(document);
    control.y = index * 50;
    return control;
  });
  scope.children = controls;
  document.activeElement = controls[0];
  const go = new MenuElement(document),
    form = new MenuElement(document, 'form');
  scope.queries.set('.enter.primary', go);
  scope.queries.set('#sessionForm', form);
  scope.queries.set('.primary, [data-action="resume"], button, [tabindex="0"]', controls[0]);
  const plates = ['circuit', 'wildcard', 'festival'].map((discipline, index) => {
    const plate = new MenuElement(document);
    plate.classes.add('lb-plate');
    plate.dataset.discipline = discipline;
    plate.attributes.set('aria-checked', String(index === 0));
    return plate;
  });
  menu.lists.set('.lb-plate', plates);
  const board = { setDiscipline: vi.fn() };
  const pad = gamepad();
  const state = { pads: [pad] as (Pad | null)[], dialog: null as MenuElement | null, now: 0 };
  const frames = new Map<number, FrameRequestCallback>();
  const callbacks: FrameRequestCallback[] = [];
  let sequence = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    callbacks.push(callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    frames.delete(id);
  });
  const getGamepads = vi.fn(() => state.pads);
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { getGamepads });
  vi.stubGlobal('HTMLElement', MenuElement);
  vi.stubGlobal('HTMLSelectElement', MenuSelect);
  vi.stubGlobal('HTMLInputElement', MenuInput);
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.spyOn(performance, 'now').mockImplementation(() => state.now);
  const rootRemove = vi.spyOn(root, 'removeEventListener');
  const windowRemove = vi.spyOn(window, 'removeEventListener');
  const documentRemove = vi.spyOn(document, 'removeEventListener');
  const input = new MenuGamepad(
    root as unknown as HTMLElement,
    () => board as unknown as LaunchBoard,
  );
  cleanup.push(() => input.dispose());
  const frame = (time = state.now + 16) => {
    state.now = time;
    const next = frames.entries().next().value;
    if (!next) throw new Error('No menu frame is queued');
    const [id, callback] = next;
    frames.delete(id);
    callback(time);
  };
  const dialog = () => {
    const modal = new MenuElement(document, 'dialog');
    const close = new MenuElement(document),
      firstLap = new MenuElement(document);
    modal.children = controls;
    modal.queries.set(
      '[data-action="modalClose"], [data-action="telemetryClose"], [data-action="firstrun:skip"]',
      close,
    );
    modal.queries.set('[data-action="firstrun:go"]', firstLap);
    state.dialog = modal;
    return { modal, close, firstLap };
  };
  return {
    input,
    document,
    window,
    root,
    menu,
    scope,
    controls,
    go,
    form,
    board,
    pad,
    state,
    frames,
    callbacks,
    request,
    cancel,
    getGamepads,
    frame,
    dialog,
    rootRemove,
    windowRemove,
    documentRemove,
  };
}
type Fixture = ReturnType<typeof fixture>;

afterEach(() => {
  for (const release of cleanup.splice(0).reverse()) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectNoActions(f: Fixture) {
  expect(f.controls[0].click).not.toHaveBeenCalled();
  expect(f.form.requestSubmit).not.toHaveBeenCalled();
  expect(f.board.setDiscipline).not.toHaveBeenCalled();
}

describe('menu gamepad ownership', () => {
  it.each(['index', 'id', 'mapping'] as const)(
    'baselines a directly replaced device with a different %s',
    (field) => {
      const f = fixture();
      f.frame();
      f.frame();
      const replacement = field === 'mapping' ? f.pad : gamepad();
      if (field === 'index') replacement.index = 1;
      else if (field === 'id') replacement.id = 'A replacement at the same index';
      else replacement.mapping = '';
      press(replacement, 0, 4, 5, 9);
      if (field === 'index') {
        f.pad.connected = false;
        f.state.pads = [f.pad, replacement];
      } else f.state.pads = [replacement];
      f.frame();
      f.frame(2000);
      expectNoActions(f);
      press(replacement);
      f.frame();
      press(replacement, 0, 5, 9);
      f.frame();
      expect(f.controls[0].click).toHaveBeenCalledOnce();
      expect(f.form.requestSubmit).toHaveBeenCalledExactlyOnceWith(f.go);
      expect(f.board.setDiscipline).toHaveBeenCalledExactlyOnceWith('wildcard');
    },
  );

  it.each([false, true])(
    'ignores held actions after hidden/visible (hidden frame: %s)',
    (hiddenFrame) => {
      const f = fixture();
      f.frame();
      f.document.hidden = true;
      f.document.dispatchEvent(new Event('visibilitychange'));
      press(f.pad, 0, 4, 5, 9);
      if (hiddenFrame) f.frame();
      f.document.hidden = false;
      f.document.dispatchEvent(new Event('visibilitychange'));
      f.frame();
      f.frame(3000);
      expectNoActions(f);
      press(f.pad);
      f.frame();
      press(f.pad, 0, 9);
      f.frame();
      expect(f.controls[0].click).toHaveBeenCalledOnce();
      expect(f.form.requestSubmit).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    'ignores actions while blurred and held on focus (blurred frame: %s)',
    (blurredFrame) => {
      const f = fixture();
      f.frame();
      f.window.dispatchEvent(new Event('blur'));
      press(f.pad, 0, 9);
      if (blurredFrame) f.frame();
      f.window.dispatchEvent(new Event('focus'));
      f.frame();
      f.frame(3000);
      expectNoActions(f);
      press(f.pad);
      f.frame();
      press(f.pad, 0, 9);
      f.frame();
      expect(f.controls[0].click).toHaveBeenCalledOnce();
      expect(f.form.requestSubmit).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    'suspends on pagehide and baselines held actions/navigation on pageshow (persisted: %s)',
    (persisted) => {
      const f = fixture();
      f.frame();
      f.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted }));
      press(f.pad, 0, 9, 13);
      expect(f.frames.size).toBe(0);
      f.getGamepads.mockClear();
      for (const callback of f.callbacks) callback(1000);
      expect(f.getGamepads).not.toHaveBeenCalled();
      expect(f.frames.size).toBe(0);
      f.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
      expect(f.frames.size).toBe(1);
      f.frame(2000);
      f.frame(4000);
      expectNoActions(f);
      expect(f.document.activeElement).toBe(f.controls[0]);
      press(f.pad);
      f.frame();
      press(f.pad, 0, 9);
      f.frame();
      expect(f.controls[0].click).toHaveBeenCalledOnce();
      expect(f.form.requestSubmit).toHaveBeenCalledOnce();
    },
  );

  it('cannot restart after disposal while the page is away', () => {
    const f = fixture();
    f.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    f.input.dispose();
    f.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.frames.size).toBe(0);
    expect(f.getGamepads).not.toHaveBeenCalled();
  });

  it('baselines a same-identity reconnect between frames without disturbing another pad', () => {
    const f = fixture();
    f.frame();
    f.window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: f.pad }));
    press(f.pad, 0, 9);
    f.frame();
    f.frame();
    expectNoActions(f);
    press(f.pad);
    f.frame();
    f.window.dispatchEvent(
      Object.assign(new Event('gamepaddisconnected'), { gamepad: gamepad(2) }),
    );
    press(f.pad, 0);
    f.frame();
    expect(f.controls[0].click).toHaveBeenCalledOnce();
  });

  it.each(['disconnected', 'api unavailable'] as const)(
    'baselines after %s interrupts ownership',
    (reason) => {
      const f = fixture();
      f.frame();
      if (reason === 'disconnected') f.state.pads = [null];
      else
        f.getGamepads.mockImplementationOnce(() => {
          throw new Error('Gamepad access denied');
        });
      f.frame();
      f.state.pads = [f.pad];
      press(f.pad, 0, 9);
      f.frame();
      f.frame();
      expectNoActions(f);
    },
  );

  it('baselines a directly opened modal and preserves A, B and first-launch Start mappings', () => {
    const f = fixture();
    f.frame();
    const { close, firstLap } = f.dialog();
    press(f.pad, 0, 1, 9);
    f.frame();
    f.frame();
    expectNoActions(f);
    expect(close.click).not.toHaveBeenCalled();
    expect(firstLap.click).not.toHaveBeenCalled();
    press(f.pad);
    f.frame();
    press(f.pad, 0, 1, 9);
    f.frame();
    expect(f.controls[0].click).toHaveBeenCalledOnce();
    expect(close.click).toHaveBeenCalledOnce();
    expect(firstLap.click).toHaveBeenCalledOnce();
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
  });

  it('baselines new content inside the persistent modal without a closed-frame gap', () => {
    const f = fixture(),
      { modal, firstLap } = f.dialog();
    const content = new MenuElement(f.document, 'div');
    content.children = [new MenuElement(f.document, 'header')];
    modal.queries.set('#modalContent', content);
    f.frame();
    content.children = [new MenuElement(f.document, 'header')];
    press(f.pad, 0, 9);
    f.frame();
    f.frame();
    expect(f.controls[0].click).not.toHaveBeenCalled();
    expect(firstLap.click).not.toHaveBeenCalled();
    press(f.pad);
    f.frame();
    press(f.pad, 0, 9);
    f.frame();
    expect(f.controls[0].click).toHaveBeenCalledOnce();
    expect(firstLap.click).toHaveBeenCalledOnce();
  });
});

describe('menu directional ownership and normal navigation', () => {
  it.each(['device', 'blur', 'visibility', 'scope'] as const)(
    'requires a fully neutral direction after %s ownership changes',
    (boundary) => {
      const f = fixture();
      f.frame(0);
      press(f.pad, 13);
      f.frame(16);
      expect(f.document.activeElement).toBe(f.controls[1]);
      let pad = f.pad;
      if (boundary === 'device') {
        pad = gamepad(1);
        pad.axes[1] = 0.8;
        f.state.pads = [pad];
      } else if (boundary === 'blur') {
        f.window.dispatchEvent(new Event('blur'));
        f.window.dispatchEvent(new Event('focus'));
      } else if (boundary === 'visibility') {
        f.document.hidden = true;
        f.document.dispatchEvent(new Event('visibilitychange'));
        f.document.hidden = false;
        f.document.dispatchEvent(new Event('visibilitychange'));
      } else f.dialog();
      f.frame(600);
      f.frame(1200);
      expect(f.document.activeElement).toBe(f.controls[1]);
      press(pad, 12);
      pad.axes[1] = -0.8;
      f.frame(1500);
      expect(f.document.activeElement).toBe(f.controls[1]);
      press(pad);
      pad.axes[1] = 0;
      f.frame(1600);
      pad.axes[1] = 0.8;
      f.frame(1616);
      expect(f.document.activeElement).toBe(f.controls[2]);
      expect(f.controls[2].focus).toHaveBeenCalledOnce();
    },
  );

  it('ignores a direction held on initial contact and keeps the 360/110 ms repeats after neutral', () => {
    const f = fixture();
    press(f.pad, 13);
    f.frame(0);
    f.frame(1000);
    expect(f.document.activeElement).toBe(f.controls[0]);
    press(f.pad);
    f.frame(1010);
    press(f.pad, 13);
    f.frame(1020);
    expect(f.document.activeElement).toBe(f.controls[1]);
    f.frame(1379);
    expect(f.document.activeElement).toBe(f.controls[1]);
    f.frame(1380);
    expect(f.document.activeElement).toBe(f.controls[2]);
    f.frame(1489);
    expect(f.document.activeElement).toBe(f.controls[2]);
    f.frame(1490);
    expect(f.document.activeElement).toBe(f.controls[3]);
  });

  it('preserves stick dead zones, left/right value steps, and A on selects', () => {
    const f = fixture();
    const control = new MenuSelect(f.document);
    f.scope.children = [control];
    f.document.activeElement = control;
    const input = vi.fn(),
      change = vi.fn();
    control.addEventListener('input', input);
    control.addEventListener('change', change);
    f.frame();
    f.pad.axes[0] = 0.6;
    f.frame();
    expect(control.value).toBe('one');
    f.pad.axes[0] = 0.61;
    f.frame();
    expect(control.value).toBe('two');
    f.pad.axes[0] = 0;
    f.frame();
    press(f.pad, 14);
    f.frame();
    expect(control.value).toBe('one');
    press(f.pad);
    f.frame();
    press(f.pad, 0);
    f.frame();
    expect(control.value).toBe('two');
    expect(input).toHaveBeenCalledTimes(3);
    expect(change).toHaveBeenCalledTimes(3);
  });
});

describe('menu disposal during a sample', () => {
  it('stops the remaining buttons and queued callbacks when A disposes the controller', () => {
    const f = fixture();
    f.frame();
    f.controls[0].addEventListener('click', () => f.input.dispose());
    press(f.pad, 0, 4, 5, 9);
    f.frame();
    expect(f.controls[0].click).toHaveBeenCalledOnce();
    expect(f.board.setDiscipline).not.toHaveBeenCalled();
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
    f.getGamepads.mockClear();
    for (const callback of f.callbacks) callback(5000);
    expect(f.getGamepads).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });

  it('stops after a focus callback disposes the host while navigating', () => {
    const f = fixture();
    f.frame();
    f.controls[1].addEventListener('focus', () => f.input.dispose());
    press(f.pad, 13, 0, 9);
    f.frame();
    expect(f.controls[1].focus).toHaveBeenCalledOnce();
    expect(f.controls[1].scrollIntoView).not.toHaveBeenCalled();
    expect(f.controls[1].click).not.toHaveBeenCalled();
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });

  it.each(['select', 'range'] as const)(
    'stops subsequent change/click actions after %s input disposes it',
    (kind) => {
      const f = fixture();
      const control = kind === 'select' ? new MenuSelect(f.document) : new MenuInput(f.document);
      f.scope.children = [control];
      f.document.activeElement = control;
      const change = vi.fn();
      control.addEventListener('input', () => f.input.dispose());
      control.addEventListener('change', change);
      f.frame();
      press(f.pad, 15, 0, 9);
      f.frame();
      expect(change).not.toHaveBeenCalled();
      expect(control.click).not.toHaveBeenCalled();
      expect(f.form.requestSubmit).not.toHaveBeenCalled();
      expect(f.frames.size).toBe(0);
    },
  );

  it('stops a back action if its sound notification disposes the owner', () => {
    const f = fixture(),
      { close, firstLap } = f.dialog();
    f.frame();
    f.window.addEventListener('motobound:cue', () => f.input.dispose());
    press(f.pad, 1, 9);
    f.frame();
    expect(close.click).not.toHaveBeenCalled();
    expect(firstLap.click).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });

  it('stops subsequent shoulder and Start actions after discipline selection disposes it', () => {
    const f = fixture();
    f.frame();
    f.board.setDiscipline.mockImplementation(() => f.input.dispose());
    press(f.pad, 4, 5, 9);
    f.frame();
    expect(f.board.setDiscipline).toHaveBeenCalledExactlyOnceWith('festival');
    expect(f.form.requestSubmit).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });

  it.each(['visibility', 'scope', 'page'] as const)(
    'abandons remaining actions after reentrant %s loss',
    (boundary) => {
      const f = fixture();
      f.frame();
      f.controls[0].addEventListener('click', () => {
        if (boundary === 'scope') f.dialog();
        else if (boundary === 'page') {
          f.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
          f.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
        } else {
          f.document.hidden = true;
          f.document.dispatchEvent(new Event('visibilitychange'));
          f.document.hidden = false;
          f.document.dispatchEvent(new Event('visibilitychange'));
        }
      });
      press(f.pad, 0, 4, 5, 9);
      f.frame();
      f.frame();
      expect(f.controls[0].click).toHaveBeenCalledOnce();
      expect(f.board.setDiscipline).not.toHaveBeenCalled();
      expect(f.form.requestSubmit).not.toHaveBeenCalled();
    },
  );

  it('removes all owned listeners once and cannot change the focus ring after disposal', () => {
    const f = fixture();
    f.root.dataset.pad = 'true';
    f.root.dispatchEvent(new Event('keydown'));
    expect(f.root.dataset.pad).toBeUndefined();
    f.input.dispose();
    f.input.dispose();
    f.root.dataset.pad = 'true';
    f.root.dispatchEvent(new Event('keydown'));
    f.root.dispatchEvent(new Event('pointerdown'));
    expect(f.root.dataset.pad).toBe('true');
    expect(f.rootRemove.mock.calls.map(([name, , capture]) => [name, capture])).toEqual([
      ['pointerdown', true],
      ['keydown', true],
    ]);
    expect(f.windowRemove.mock.calls.map(([name]) => name)).toEqual([
      'blur',
      'focus',
      'pagehide',
      'pageshow',
      'gamepaddisconnected',
    ]);
    expect(f.documentRemove.mock.calls.map(([name]) => name)).toEqual(['visibilitychange']);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.frames.size).toBe(0);
  });

  it('is safe to dispose when animation frames are unavailable', () => {
    const f = fixture();
    f.input.dispose();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const input = new MenuGamepad(
      f.root as unknown as HTMLElement,
      () => f.board as unknown as LaunchBoard,
    );
    expect(() => {
      input.dispose();
      input.dispose();
    }).not.toThrow();
    expect(f.frames.size).toBe(0);
  });
});

/** Complete production GameApp.dispose, without main.ts's automatic boot. The
 * Interface disposal below is invoked directly from its real prototype. */
function sourceOwner(path: string, name: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  if (!owner) throw new Error(`Missing production owner ${name}`);
  return { source, owner };
}
const main = sourceOwner('../src/main.ts', 'GameApp');
const dispose = main.owner.members.find((node) => node.name?.getText(main.source) === 'dispose');
if (!dispose) throw new Error('Missing GameApp.dispose');
const hostCode = ts.transpileModule(`class Host { ${dispose.getText(main.source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function installRootEvents(ui: Interface, element: MenuElement) {
  const { source, owner } = sourceOwner('../src/ui/interface.ts', 'Interface');
  const constructor = owner.members.find(ts.isConstructorDeclaration);
  const statements = constructor?.body?.statements.filter((node) =>
    ts.isVariableStatement(node)
      ? node.declarationList.declarations.some(
          (declaration) => declaration.name.getText(source) === 'events',
        )
      : ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        node.expression.expression.getText(source) === 'element.addEventListener',
  );
  if (statements?.length !== 3)
    throw new Error('Expected the production root event owner and two listeners');
  const code = ts.transpileModule(
    `function install(element) { ${statements.map((node) => node.getText(source)).join('\n')} }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    },
  ).outputText;
  const install = new Function(`${code}; return install;`)() as (
    this: Interface,
    element: MenuElement,
  ) => void;
  install.call(ui, element);
}

function uiFixture(f: Fixture) {
  const own = () => ({ dispose: vi.fn() });
  const credits = new CreditsGamepad(
    new MenuElement(f.document) as unknown as HTMLElement,
    vi.fn(),
  );
  const events = new AbortController(),
    bindingCapture = new AbortController();
  const key = vi.fn();
  f.document.addEventListener('keydown', key, { signal: bindingCapture.signal });
  const resources = {
    wildcardBinding: vi.fn(),
    firstRunBinding: vi.fn(),
    settingsBinding: vi.fn(),
    creditsPad: credits,
    bindingCapture,
    deviceCalibration: own(),
    board: own(),
    resizeObserver: { disconnect: vi.fn() },
  };
  const ui = Object.assign(Object.create(Interface.prototype) as object, {
    disposed: false,
    events,
    menuPad: f.input,
    toastTimer: 0,
    nodes: new Map(),
    ...resources,
  }) as unknown as Interface;
  cleanup.push(() => ui.dispose());
  return { ui: ui as Interface, resources, events, key };
}

function hostFixture(ui: Interface) {
  const own = () => ({ dispose: vi.fn() });
  const prototype = new Function(`${hostCode}; return Host.prototype;`)() as { dispose(): void };
  return Object.assign(Object.create(prototype) as { dispose(): void }, {
    disposed: false,
    pageWaiters: new Set<() => void>(),
    generation: 1,
    circuitStartup: null,
    ui,
    sessionReview: { stop: vi.fn() },
    tabEvidence: own(),
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    reviewVideo: own(),
    exporter: { cancel: vi.fn() },
    replay: null,
    inputPump: own(),
    festivalOwner: { cancel: vi.fn() },
    endDemoClock: vi.fn(),
    timer: 0,
    initTimeout: 0,
    worker: null,
    mediaView: null,
    referenceSession: own(),
    rumble: { stop: vi.fn() },
    input: own(),
    menuFrames: own(),
    menuPreviewReceipt: own(),
    renderer: null,
    uiSounds: own(),
    audio: { dispose: vi.fn(async () => {}) },
  });
}

describe('Interface and application teardown integration', () => {
  it.each([1, 9])('preserves the credits close mapping for a fresh button %s edge', (button) => {
    const f = fixture();
    f.input.dispose();
    press(f.pad, button);
    const close = vi.fn();
    const credits = new CreditsGamepad(
      new MenuElement(f.document) as unknown as HTMLElement,
      close,
    );
    cleanup.push(() => credits.dispose());
    close.mockImplementation(() => credits.dispose());
    f.frame();
    expect(close).not.toHaveBeenCalled();
    press(f.pad);
    f.frame();
    press(f.pad, button);
    f.frame();
    expect(close).toHaveBeenCalledOnce();
    expect(f.frames.size).toBe(0);
    expect(f.controls[0].click).not.toHaveBeenCalled();
  });

  it('releases actual menu and credits polls, modal owners, capture and UI listeners from host disposal', () => {
    const f = fixture(),
      { ui, resources, events, key } = uiFixture(f);
    const action = vi.fn();
    Object.assign(ui, { callbacks: { action } });
    f.root.dataset.action = 'settings';
    installRootEvents(ui, f.root);
    f.root.dispatchEvent(new Event('click'));
    expect(action).toHaveBeenCalledExactlyOnceWith('settings');
    const host = hostFixture(ui);
    const creditsDispose = vi.spyOn(resources.creditsPad, 'dispose');
    const captureAbort = vi.spyOn(resources.bindingCapture, 'abort');
    host.dispose();
    host.dispose();
    ui.dispose();
    expect(f.frames.size).toBe(0);
    expect(events.signal.aborted).toBe(true);
    expect(creditsDispose).toHaveBeenCalledOnce();
    expect(captureAbort).toHaveBeenCalledOnce();
    expect(resources.deviceCalibration.dispose).toHaveBeenCalledOnce();
    expect(resources.board.dispose).toHaveBeenCalledOnce();
    expect(resources.resizeObserver.disconnect).toHaveBeenCalledOnce();
    for (const binding of [
      resources.wildcardBinding,
      resources.firstRunBinding,
      resources.settingsBinding,
    ])
      expect(binding).toHaveBeenCalledOnce();
    f.getGamepads.mockClear();
    f.root.dispatchEvent(new Event('click'));
    f.document.dispatchEvent(new Event('keydown'));
    for (const callback of f.callbacks) callback(4000);
    expect(action).toHaveBeenCalledOnce();
    expect(key).not.toHaveBeenCalled();
    expect(f.getGamepads).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });

  it.each(['menu', 'credits'] as const)(
    'does not queue or dispatch after an active %s click disposes the host',
    (screen) => {
      const f = fixture();
      if (screen === 'menu') f.frame();
      else f.dialog().modal.queries.set('#creditsList', new MenuElement(f.document));
      const { ui } = uiFixture(f),
        host = hostFixture(ui);
      if (screen === 'credits') f.frame(); // Menu navigation yields ownership to credits.
      f.controls[0].addEventListener('click', () => host.dispose());
      press(f.pad, 0, 4, 5, 9);
      if (screen === 'credits') press(f.pad, 0); // Start is the credits close mapping.
      f.frame();
      expect(f.controls[0].click).toHaveBeenCalledOnce();
      expect(f.form.requestSubmit).not.toHaveBeenCalled();
      expect(f.board.setDiscipline).not.toHaveBeenCalled();
      expect(f.frames.size).toBe(0);
      f.getGamepads.mockClear();
      for (const callback of f.callbacks) callback(5000);
      expect(f.getGamepads).not.toHaveBeenCalled();
      expect(f.frames.size).toBe(0);
    },
  );

  it('cancels the UI-owned toast timeout and refuses a late replacement', () => {
    const f = fixture(),
      { ui } = uiFixture(f);
    const toast = { textContent: '', hidden: true };
    const setTimeout = vi.fn(() => 123);
    Object.assign(f.window, { setTimeout });
    Object.assign(ui, { get: () => toast });
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    ui.toast('Before disposal');
    expect(setTimeout).toHaveBeenCalledOnce();
    ui.dispose();
    expect(clear).toHaveBeenCalledWith(123);
    ui.toast('Late notification');
    expect(setTimeout).toHaveBeenCalledOnce();
    expect(toast.textContent).toBe('Before disposal');
  });

  it.each(['wildcardBinding', 'firstRunBinding', 'settingsBinding'] as const)(
    'finishes cleanup and detaches each modal owner before reentrant %s failure',
    (name) => {
      const f = fixture(),
        { ui, resources, events } = uiFixture(f);
      const host = hostFixture(ui),
        failure = new Error('Modal cleanup failed');
      resources[name].mockImplementation(() => {
        host.dispose();
        ui.dispose();
        throw failure;
      });
      expect(() => host.dispose()).toThrow(failure);
      expect(() => host.dispose()).not.toThrow();
      expect(f.frames.size).toBe(0);
      expect(events.signal.aborted).toBe(true);
      expect(resources.bindingCapture.signal.aborted).toBe(true);
      for (const binding of [
        resources.wildcardBinding,
        resources.firstRunBinding,
        resources.settingsBinding,
      ])
        expect(binding).toHaveBeenCalledOnce();
      expect(resources.deviceCalibration.dispose).toHaveBeenCalledOnce();
      expect(resources.board.dispose).toHaveBeenCalledOnce();
      expect(resources.resizeObserver.disconnect).toHaveBeenCalledOnce();
      expect(host.audio.dispose).toHaveBeenCalledOnce();
    },
  );

  it('owns the constructor resize observer, ignores its stale callback and prevents late resource creation', () => {
    const f = fixture(),
      { ui } = uiFixture(f);
    const declaration = sourceOwner('../src/ui/interface.ts', 'Interface');
    const constructor = declaration.owner.members.find(ts.isConstructorDeclaration);
    const observer = constructor?.body?.statements.find(
      (node) =>
        ts.isIfStatement(node) &&
        node.expression.getText(declaration.source) === "typeof ResizeObserver !== 'undefined'",
    );
    if (!observer) throw new Error('Missing production resize observer registration');
    let callback!: () => void;
    const watch = { observe: vi.fn(), disconnect: vi.fn() };
    const ResizeObserver = function (report: () => void) {
      callback = report;
      return watch;
    };
    const registration = ts.transpileModule(
      `function install() { ${observer.getText(declaration.source)} }`,
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      },
    ).outputText;
    const install = new Function(
      'ResizeObserver',
      'showroomWindowOf',
      `${registration}; return install;`,
    )(ResizeObserver, () => ({ left: 0.3, right: 0.7 })) as (this: Interface) => void;
    const showroomWindow = vi.fn(),
      get = vi.fn();
    Object.assign(ui, { menu: f.menu, callbacks: { showroomWindow }, get });
    install.call(ui);
    callback();
    expect(showroomWindow).toHaveBeenCalledOnce();
    ui.dispose();
    callback();
    ui.toast('Late completion');
    ui.credits();
    ui.modalContent('<button>Late modal</button>');
    ui.settings(DEFAULT_SETTINGS);
    expect(watch.disconnect).toHaveBeenCalledOnce();
    expect(showroomWindow).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });
});
