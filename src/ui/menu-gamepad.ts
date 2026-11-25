import type { LaunchBoard } from './launch-board.ts';
import type { BoardDiscipline } from './disciplines.ts';
import { uiCue } from './ui-cue.ts';
import { revealInList } from './wildcard-board.ts';

/** Controller navigation for the paddock board and every modal screen (art
 * direction section 8). Console conventions: D-pad or left stick up/down moves
 * focus (spatially, so a row of dials is walked row by row), left/right changes
 * the focused dial or moves between plates, A activates, B closes a modal that
 * offers a close action, Start launches the entry from the board, LB/RB switch
 * discipline. It reads the Gamepad API directly and acts only while the board or
 * a modal is on screen; buttons already held when a screen opens are ignored.
 * The credits list keeps its own handler (credits.ts). */
const PAD = { a: 0, b: 1, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
const FOCUSABLE =
  'button:not(:disabled):not([tabindex="-1"]), select:not(:disabled), input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]), a[href], [tabindex]:not([tabindex="-1"])';
type Direction = 'up' | 'down' | 'left' | 'right';

/** Nearest focusable in a direction: the one whose centre lies beyond the
 * current control's edge, scored by distance along the axis plus half the
 * drift across it. Exported for the unit test. */
export function nearestInDirection(
  from: DOMRect,
  candidates: readonly DOMRect[],
  direction: Direction,
): number {
  const cx = from.x + from.width / 2,
    cy = from.y + from.height / 2;
  let best = -1,
    bestScore = Infinity;
  candidates.forEach((r, i) => {
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    const dx = x - cx,
      dy = y - cy;
    const along =
      direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    const across = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    // Must lie past the edge we are leaving (a row's neighbours are not "below").
    const gap =
      direction === 'down'
        ? r.top - from.bottom + from.height / 2
        : direction === 'up'
          ? from.top - r.bottom + from.height / 2
          : direction === 'right'
            ? r.left - from.right + from.width / 2
            : from.left - r.right + from.width / 2;
    if (along <= 1 || gap < 0) return;
    const score = along + across * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export class MenuGamepad {
  private frame: number | null = null;
  private frameGeneration = 0;
  private previous = new Set<number>();
  private device: Pick<Gamepad, 'index' | 'id' | 'mapping'> | null = null;
  private activeScope: HTMLElement | null = null;
  private activeContent: Element | null = null;
  private focused = true;
  private pageActive = true;
  private ownership = 0;
  private navigationReady = false;
  private held: Direction | null = null;
  private repeatAt = 0;
  private disposed = false;
  private listening = false;
  /** Pointer or keyboard use hands the focus ring back to the browser. */
  private releaseFocusRing = () => {
    if (!this.disposed && this.root.dataset.pad) delete this.root.dataset.pad;
  };
  private resetOwnership = () => {
    this.ownership++;
    this.device = null;
    this.activeScope = null;
    this.activeContent = null;
    this.previous.clear();
    this.navigationReady = false;
    this.held = null;
    this.repeatAt = 0;
  };
  private blur = () => {
    this.focused = false;
    this.resetOwnership();
  };
  private focus = () => {
    this.focused = true;
    this.resetOwnership();
  };
  private pageHide = () => {
    if (this.disposed || !this.pageActive) return;
    this.pageActive = false;
    this.resetOwnership();
    this.frameGeneration++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  };
  private pageShow = () => {
    if (this.disposed) return;
    this.pageActive = true;
    this.focused = document.hasFocus?.() ?? this.focused;
    this.resetOwnership();
    this.scheduleFrame();
  };
  private disconnect = (event: GamepadEvent) => {
    if (event.gamepad.index === this.device?.index) this.resetOwnership();
  };
  constructor(
    private readonly root: HTMLElement,
    private readonly board: () => LaunchBoard,
  ) {
    if (typeof requestAnimationFrame !== 'function') return;
    this.focused = document.hasFocus?.() ?? true;
    root.addEventListener('pointerdown', this.releaseFocusRing, true);
    root.addEventListener('keydown', this.releaseFocusRing, true);
    window.addEventListener('blur', this.blur);
    window.addEventListener('focus', this.focus);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
    window.addEventListener('gamepaddisconnected', this.disconnect);
    document.addEventListener('visibilitychange', this.resetOwnership);
    this.listening = true;
    this.scheduleFrame();
  }
  private scheduleFrame() {
    if (this.disposed || !this.pageActive || this.frame !== null) return;
    const generation = ++this.frameGeneration;
    this.frame = requestAnimationFrame(() => {
      if (this.disposed || !this.pageActive || generation !== this.frameGeneration) return;
      this.frame = null;
      this.poll();
    });
  }
  private pad() {
    try {
      return (
        [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p?.connected) ?? null
      );
    } catch {
      return null;
    }
  }
  /** The element tree a controller may move through right now, or null. */
  private scope(): HTMLElement | null {
    const dialog = this.root.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog) return dialog.querySelector('#creditsList') ? null : dialog;
    const menu = this.root.querySelector<HTMLElement>('#menu');
    return menu && !menu.hidden && this.root.dataset.mode === 'menu'
      ? menu.querySelector<HTMLElement>('.menu-body')
      : null;
  }
  private focusables(scope: HTMLElement) {
    return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (e) =>
        e.getClientRects().length > 0 &&
        getComputedStyle(e).visibility !== 'hidden' &&
        !(e.matches('.menu-body, .mx-menu-scroll') || e.classList.contains('credits-list')),
    );
  }
  /** Interface replaces the content inside its persistent modal element. */
  private scopeContent(scope: HTMLElement): Element {
    return scope.matches('dialog')
      ? (scope.querySelector('#modalContent')?.firstElementChild ?? scope)
      : scope;
  }
  private poll = () => {
    if (this.disposed || !this.pageActive) return;
    this.scheduleFrame();
    const pad = this.pad();
    if (this.disposed) return;
    const scope = pad && this.focused && !document.hidden ? this.scope() : null;
    const now = new Set<number>();
    pad?.buttons.forEach((b, i) => b.pressed && now.add(i));
    if (!pad || !scope) {
      this.resetOwnership();
      return;
    }
    // Left stick acts as the D-pad (past a generous dead zone).
    const sx = pad.axes[0] ?? 0,
      sy = pad.axes[1] ?? 0;
    let dir: Direction | null = null;
    if (now.has(PAD.up) || sy < -0.6) dir = 'up';
    else if (now.has(PAD.down) || sy > 0.6) dir = 'down';
    else if (now.has(PAD.left) || sx < -0.6) dir = 'left';
    else if (now.has(PAD.right) || sx > 0.6) dir = 'right';
    const content = this.scopeContent(scope);
    if (
      !this.device ||
      scope !== this.activeScope ||
      content !== this.activeContent ||
      pad.index !== this.device.index ||
      pad.id !== this.device.id ||
      pad.mapping !== this.device.mapping
    ) {
      // Opening a screen, replacing a device or returning from suspension gives
      // us a baseline, never an action. Held navigation must reach neutral before
      // it may move or repeat, even if its direction changes while still held.
      this.resetOwnership();
      this.device = { index: pad.index, id: pad.id, mapping: pad.mapping };
      this.activeScope = scope;
      this.activeContent = content;
      this.previous = now;
      this.navigationReady = dir === null;
      return;
    }
    const previous = this.previous;
    this.previous = now;
    const edge = (i: number) => now.has(i) && !previous.has(i);
    const ownership = this.ownership;
    // A focus/click/change handler may close this screen, suspend input or dispose
    // its host. The rest of this sample must not act on an owner it has lost.
    const current = () =>
      !this.disposed &&
      ownership === this.ownership &&
      this.pageActive &&
      this.focused &&
      !document.hidden &&
      scope === this.scope() &&
      content === this.scopeContent(scope);
    const time = performance.now();
    if (!dir) {
      this.navigationReady = true;
      this.held = null;
    } else if (this.navigationReady && dir !== this.held) {
      this.held = dir;
      this.repeatAt = time + 360;
      this.move(scope, dir);
      if (!current()) return;
    } else if (this.navigationReady && time >= this.repeatAt) {
      this.repeatAt = time + 110;
      this.move(scope, dir);
      if (!current()) return;
    }
    if (edge(PAD.a)) {
      this.activate(scope);
      if (!current()) return;
    }
    if (edge(PAD.b)) {
      this.back(scope);
      if (!current()) return;
    }
    // The first-launch screen: START drives the first lap (B skips, see back()).
    if (scope.matches('dialog') && edge(PAD.start)) {
      scope.querySelector<HTMLButtonElement>('[data-action="firstrun:go"]')?.click();
      if (!current()) return;
    }
    if (scope.matches('.menu-body')) {
      if (edge(PAD.lb)) {
        this.discipline(-1);
        if (!current()) return;
      }
      if (edge(PAD.rb)) {
        this.discipline(1);
        if (!current()) return;
      }
      if (edge(PAD.start)) {
        const go = scope.querySelector<HTMLButtonElement>('.enter.primary');
        const form = scope.querySelector<HTMLFormElement>('#sessionForm');
        if (go && form && !go.disabled) form.requestSubmit(go);
        if (!current()) return;
      }
    }
    if (now.size || dir) this.root.dataset.pad = 'true';
  };
  private move(scope: HTMLElement, dir: Direction) {
    const active = document.activeElement as HTMLElement | null;
    const inside = active && scope.contains(active) ? active : null;
    if (!inside) return this.enter(scope);
    if (dir === 'left' || dir === 'right') {
      if (this.step(inside, dir === 'right' ? 1 : -1)) return;
    }
    // The Wildcard board's events are a roving radio group (one tab stop, the rest
    // tabindex -1), which the spatial search skips: up and down walk the list itself,
    // and focus selects the event whose page is then shown.
    if ((dir === 'up' || dir === 'down') && inside.matches('.wc-row')) {
      const rows = [...scope.querySelectorAll<HTMLElement>('.wc-row')];
      const next = rows[rows.indexOf(inside) + (dir === 'down' ? 1 : -1)];
      if (next) {
        next.focus({ preventScroll: true });
        if (this.disposed) return;
        revealInList(next);
        return;
      }
    }
    const list = this.focusables(scope).filter((e) => e !== inside);
    const at = nearestInDirection(
      inside.getBoundingClientRect(),
      list.map((e) => e.getBoundingClientRect()),
      dir,
    );
    if (at >= 0) {
      list[at].focus({ preventScroll: false });
      if (this.disposed) return;
      list[at].scrollIntoView({ block: 'nearest' });
      uiCue('tick');
    }
  }
  /** First contact: land on the entry's primary control. */
  private enter(scope: HTMLElement) {
    const first =
      scope.querySelector<HTMLElement>('.lb-plate[aria-checked="true"]') ??
      scope.querySelector<HTMLElement>('.primary, [data-action="resume"], button, [tabindex="0"]');
    first?.focus();
  }
  /** Left/right on a value control changes it; true when it did. */
  private step(el: HTMLElement, direction: 1 | -1): boolean {
    if (el.matches('.lb-plate')) {
      this.discipline(direction);
      return true;
    }
    const dial = el.closest<HTMLElement>('.lb-dial');
    const hand = dial?.querySelector<HTMLButtonElement>(`.lb-step[data-step="${direction}"]`);
    if (el instanceof HTMLSelectElement && hand) {
      hand.click();
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      const options = [...el.options].filter((o) => !o.disabled);
      const at = options.findIndex((o) => o.selected);
      const next = options[(at + direction + options.length) % options.length];
      if (next) {
        el.value = next.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        if (this.disposed) return true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (this.disposed) return true;
        uiCue('tick');
      }
      return true;
    }
    if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'number')) {
      if (direction > 0) el.stepUp();
      else el.stepDown();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (this.disposed) return true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (this.disposed) return true;
      uiCue('tick');
      return true;
    }
    return false;
  }
  private activate(scope: HTMLElement) {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !scope.contains(el)) return this.enter(scope);
    if (el instanceof HTMLSelectElement) this.step(el, 1);
    else if (el instanceof HTMLInputElement && el.type === 'range') return;
    else el.click();
  }
  private back(scope: HTMLElement) {
    const close = scope.matches('dialog')
      ? scope.querySelector<HTMLElement>(
          '[data-action="modalClose"], [data-action="telemetryClose"], [data-action="firstrun:skip"]',
        )
      : null;
    if (close) {
      uiCue('back');
      if (this.disposed) return;
      close.click();
    }
  }
  private discipline(direction: 1 | -1) {
    const menu = this.root.querySelector<HTMLElement>('#menu')!;
    const plates = [...menu.querySelectorAll<HTMLButtonElement>('.lb-plate')];
    const current = plates.findIndex((p) => p.getAttribute('aria-checked') === 'true');
    const next = plates[(Math.max(0, current) + direction + plates.length) % plates.length];
    if (!next) return;
    this.board().setDiscipline(next.dataset.discipline as BoardDiscipline);
    if (this.disposed) return;
    if (document.activeElement?.matches?.('.lb-plate')) next.focus();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.frameGeneration++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.listening) {
      this.listening = false;
      this.root.removeEventListener('pointerdown', this.releaseFocusRing, true);
      this.root.removeEventListener('keydown', this.releaseFocusRing, true);
      window.removeEventListener('blur', this.blur);
      window.removeEventListener('focus', this.focus);
      window.removeEventListener('pagehide', this.pageHide);
      window.removeEventListener('pageshow', this.pageShow);
      window.removeEventListener('gamepaddisconnected', this.disconnect);
      document.removeEventListener('visibilitychange', this.resetOwnership);
    }
    this.resetOwnership();
  }
}
