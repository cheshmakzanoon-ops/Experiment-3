import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/input/controller.ts';
import { controls } from '../src/simulation/config.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { CreditsGamepad } from '../src/ui/credits.ts';
import type { LaunchBoard } from '../src/ui/launch-board.ts';
import { MenuGamepad } from '../src/ui/menu-gamepad.ts';

class TestDocument extends EventTarget {
  hidden = false;
  focused = true;
  activeElement: TestElement | null = null;
  pointerLockElement = null;
  hasFocus = () => this.focused;
}

class TestElement extends EventTarget {
  dataset: Record<string, string> = {};
  hidden = false;
  children: TestElement[] = [];
  queries = new Map<string, TestElement | (() => TestElement | null)>();
  classList = { contains: () => false };
  constructor(
    readonly document: TestDocument,
    readonly tag = 'button',
  ) {
    super();
  }
  querySelector(selector: string): TestElement | null {
    const result = this.queries.get(selector);
    return typeof result === 'function' ? result() : (result ?? null);
  }
  querySelectorAll() {
    return this.children;
  }
  contains(element: TestElement): boolean {
    return element === this || this.children.some((child) => child.contains(element));
  }
  matches(selector: string) {
    return selector === this.tag;
  }
  closest() {
    return null;
  }
  getClientRects() {
    return [this.getBoundingClientRect()];
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 10, height: 10, left: 0, right: 10, top: 0, bottom: 10 };
  }
  focus = vi.fn(() => {
    this.document.activeElement = this;
  });
  click = vi.fn(() => this.dispatchEvent(new Event('click')));
  scrollBy = vi.fn();
}

const pad = (id = 'Original controller') => ({
  index: 0,
  id,
  mapping: 'standard' as GamepadMappingType,
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
});
type Pad = ReturnType<typeof pad>;
function press(device: Pad, ...buttons: number[]) {
  device.buttons.forEach((button, index) => {
    button.pressed = buttons.includes(index);
    button.touched = button.pressed;
    button.value = Number(button.pressed);
  });
}

/** Complete production page callbacks; rendering, audio and transport are
 * boundaries. The input controller and both competing UI pollers are real. */
const source = ts.createSourceFile(
  'main.ts',
  readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const hostClass = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
)!;
const hostCallbacks = ['pageHide', 'pageShow'].map((name) => {
  const member = hostClass.members.find((node) => node.name?.getText(source) === name);
  if (!member) throw new Error(`Missing GameApp.${name}`);
  return member.getText(source);
});
const Host = new Function(
  'controls',
  ts.transpileModule(`class Host { ${hostCallbacks.join('\n')} } return Host;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(controls) as new () => {
  pageHide(event: PageTransitionEvent): void;
  pageShow(event: PageTransitionEvent): void;
};

const releases: (() => void)[] = [];
function fixture() {
  const document = new TestDocument(),
    window = new EventTarget();
  const root = new TestElement(document, 'main');
  const menu = new TestElement(document, 'section');
  const scope = new TestElement(document, '.menu-body');
  const modal = new TestElement(document, 'dialog');
  const list = new TestElement(document, 'div');
  const button = new TestElement(document);
  const state = { pads: [pad()] as (Pad | null)[], creditsOpen: true, apiUnavailable: false };
  document.activeElement = button;
  root.dataset.mode = 'menu';
  root.queries.set('dialog[open]', () => (state.creditsOpen ? modal : null));
  root.queries.set('#menu', menu);
  menu.queries.set('.menu-body', scope);
  modal.queries.set('#creditsList', list);
  modal.children = [list, button];
  scope.children = [button];
  const frames = new Map<number, FrameRequestCallback>();
  const callbacks: FrameRequestCallback[] = [];
  let nextId = 0;
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', {
    getGamepads: () => {
      if (state.apiUnavailable) throw new Error('Gamepad access unavailable');
      return state.pads;
    },
  });
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('HTMLSelectElement', class extends TestElement {});
  vi.stubGlobal('HTMLInputElement', class extends TestElement {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    frames.set(nextId, callback);
    return nextId++;
  });
  const cancel = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const actions: string[] = [];
  const input = new InputController(structuredClone(DEFAULT_SETTINGS), (name) =>
    actions.push(name),
  );
  const menuPad = new MenuGamepad(root as unknown as HTMLElement, () => ({}) as LaunchBoard);
  const close = vi.fn(() => {
    state.creditsOpen = false;
    credits.dispose();
  });
  const credits = new CreditsGamepad(list as unknown as HTMLElement, close);
  const host = Object.assign(new Host(), {
    disposed: false,
    pageSuspended: false,
    pageEpoch: 0,
    pageWaiters: new Set(),
    errorStopped: false,
    pageMenuRecovery: false,
    timer: null,
    circuitStartup: null,
    festivalStarting: false,
    festival: null,
    state: 'menu',
    input,
    inputPump: { dispose: vi.fn(), start: vi.fn() },
    uiSounds: { suspend: vi.fn() },
    menuFrames: { suspend: vi.fn() },
    audio: { stop: vi.fn() },
    liveFrames: { setPaused: vi.fn() },
    menuPreviewReceipt: { request: vi.fn() },
    suspendPlayback: vi.fn(),
    post: vi.fn(),
    scheduleFrame: vi.fn(),
    renderer: null,
    dispose: vi.fn(),
  });
  window.addEventListener('pagehide', host.pageHide as EventListener);
  window.addEventListener('pageshow', host.pageShow as EventListener);
  releases.push(() => {
    credits.dispose();
    menuPad.dispose();
    input.dispose();
    window.removeEventListener('pagehide', host.pageHide as EventListener);
    window.removeEventListener('pageshow', host.pageShow as EventListener);
  });
  const frame = () => {
    const pending = [...frames];
    for (const [id, callback] of pending) {
      if (!frames.delete(id)) continue;
      callback(16);
    }
  };
  const page = (type: 'pagehide' | 'pageshow') =>
    window.dispatchEvent(Object.assign(new Event(type), { persisted: true }));
  return {
    document,
    window,
    state,
    input,
    menuPad,
    credits,
    close,
    list,
    button,
    frames,
    callbacks,
    cancel,
    frame,
    page,
    host,
    actions,
  };
}

afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('composed credits, menu and host input ownership', () => {
  it('baselines a held credits action across retained navigation with no visibility or blur event', () => {
    const f = fixture();
    f.frame();
    f.input.pollActions('paused');
    f.page('pagehide');
    press(f.state.pads[0]!, 1, 9);
    f.page('pageshow');
    f.input.pollActions('paused');
    f.frame();
    expect(f.actions).toEqual([]);
    expect(f.input.state).toEqual(controls());
    expect(f.close).not.toHaveBeenCalled();
    expect(f.button.click).not.toHaveBeenCalled();
    press(f.state.pads[0]!);
    f.frame();
    press(f.state.pads[0]!, 1);
    f.frame();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.frames.size).toBe(1);
  });

  it.each(['blur', 'visibility'] as const)(
    'does not activate the retained credits link after %s',
    (kind) => {
      const f = fixture();
      f.frame();
      if (kind === 'blur') {
        f.document.focused = false;
        f.window.dispatchEvent(new Event('blur'));
      } else {
        f.document.hidden = true;
        f.document.dispatchEvent(new Event('visibilitychange'));
      }
      press(f.state.pads[0]!, 0, 13);
      f.frame();
      expect(f.button.click).not.toHaveBeenCalled();
      expect(f.list.scrollBy).not.toHaveBeenCalled();
      f.document.focused = true;
      f.document.hidden = false;
      (kind === 'blur' ? f.window : f.document).dispatchEvent(
        new Event(kind === 'blur' ? 'focus' : 'visibilitychange'),
      );
      f.frame();
      expect(f.button.click).not.toHaveBeenCalled();
      expect(f.list.scrollBy).not.toHaveBeenCalled();
      press(f.state.pads[0]!);
      f.frame();
      press(f.state.pads[0]!, 0, 13);
      f.frame();
      expect(f.button.click).toHaveBeenCalledOnce();
      expect(f.list.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 14 });
    },
  );

  it('baselines a different controller before it can close the credits and hand control to the menu', () => {
    const f = fixture();
    f.frame();
    const replacement = pad('Replacement controller');
    press(replacement, 0, 1);
    f.state.pads = [replacement];
    f.frame();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.button.click).not.toHaveBeenCalled();
    press(replacement);
    f.frame();
    press(replacement, 0, 1);
    f.frame();
    expect(f.close).toHaveBeenCalledOnce();
    f.frame();
    expect(f.button.click).not.toHaveBeenCalled();
    press(replacement);
    f.frame();
    press(replacement, 0);
    f.frame();
    expect(f.button.click).toHaveBeenCalledOnce();
  });

  it.each(['mapping', 'disconnect', 'absence', 'API error'] as const)(
    'requires a new credits action after %s interrupts controller ownership',
    (change) => {
      const f = fixture();
      const device = f.state.pads[0]!;
      f.frame();
      if (change === 'mapping') device.mapping = '';
      if (change === 'disconnect')
        f.window.dispatchEvent(
          Object.assign(new Event('gamepaddisconnected'), { gamepad: device }),
        );
      if (change === 'absence') f.state.pads = [];
      if (change === 'API error') f.state.apiUnavailable = true;
      if (change === 'absence' || change === 'API error') f.frame();
      f.state.apiUnavailable = false;
      f.state.pads = [device];
      press(device, 9);
      f.frame();
      expect(f.close).not.toHaveBeenCalled();
      press(device);
      f.frame();
      press(device, 9);
      f.frame();
      expect(f.close).toHaveBeenCalledOnce();
    },
  );

  it.each(['dispose', 'page navigation'] as const)(
    'revokes remaining credits edges when scrolling reenters %s',
    (change) => {
      const f = fixture();
      f.frame();
      f.list.scrollBy.mockImplementationOnce(() => {
        if (change === 'dispose') f.credits.dispose();
        else {
          f.page('pagehide');
          f.page('pageshow');
        }
      });
      press(f.state.pads[0]!, 0, 1, 13);
      f.frame();
      expect(f.list.scrollBy).toHaveBeenCalledOnce();
      expect(f.close).not.toHaveBeenCalled();
      expect(f.button.click).not.toHaveBeenCalled();
      expect(f.frames.size).toBe(change === 'dispose' ? 1 : 2);
      f.frame();
      expect(f.close).not.toHaveBeenCalled();
      expect(f.button.click).not.toHaveBeenCalled();
    },
  );

  it('does not hand an A edge to a replacement credits owner created inside the activated control', () => {
    const f = fixture();
    f.frame();
    f.button.addEventListener(
      'click',
      () => {
        f.credits.dispose();
        const replacement = new CreditsGamepad(f.list as unknown as HTMLElement, f.close);
        releases.push(() => replacement.dispose());
      },
      { once: true },
    );
    press(f.state.pads[0]!, 0);
    f.frame();
    expect(f.button.click).toHaveBeenCalledOnce();
    expect(f.frames.size).toBe(2);
    f.frame();
    expect(f.button.click).toHaveBeenCalledOnce();
    press(f.state.pads[0]!);
    f.frame();
    press(f.state.pads[0]!, 0);
    f.frame();
    expect(f.button.click).toHaveBeenCalledTimes(2);
    expect(f.frames.size).toBe(2);
  });

  it('keeps one scheduler per UI owner after controlled delivery of cancelled old page callbacks', () => {
    const f = fixture();
    f.frame();
    const oldCallbacks = [...f.frames.values()];
    expect(oldCallbacks).toHaveLength(2);
    f.page('pagehide');
    expect(f.frames.size).toBe(0);
    f.page('pageshow');
    expect(f.frames.size).toBe(2);
    for (const callback of oldCallbacks) callback(1234);
    expect(f.frames.size).toBe(2);
    f.frame();
    expect(f.frames.size).toBe(2);
    expect(f.close).not.toHaveBeenCalled();
    expect(f.button.click).not.toHaveBeenCalled();
  });

  it('removes credits event ownership and keeps old callbacks inert after repeated disposal', () => {
    const f = fixture();
    const windowRemove = vi.spyOn(f.window, 'removeEventListener');
    const documentRemove = vi.spyOn(f.document, 'removeEventListener');
    const oldCredits = f.callbacks[1];
    f.credits.dispose();
    f.credits.dispose();
    expect(windowRemove.mock.calls.map(([name]) => name)).toEqual([
      'blur',
      'focus',
      'pagehide',
      'pageshow',
      'gamepaddisconnected',
    ]);
    expect(documentRemove.mock.calls.map(([name]) => name)).toEqual(['visibilitychange']);
    expect(f.frames.size).toBe(1);
    f.page('pagehide');
    f.page('pageshow');
    press(f.state.pads[0]!, 0, 1, 9);
    oldCredits(1234);
    f.frame();
    expect(f.frames.size).toBe(1);
    expect(f.close).not.toHaveBeenCalled();
    expect(f.button.click).not.toHaveBeenCalled();
  });
});
