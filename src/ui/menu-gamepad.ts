import type { LaunchBoard } from './launch-board.ts';
import type { BoardDiscipline } from './disciplines.ts';
import { uiCue } from './ui-cue.ts';

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
    const along = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
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
  private frame = 0;
  private previous = new Set<number>();
  private wasActive = false;
  private held: Direction | null = null;
  private repeatAt = 0;
  private disposed = false;
  constructor(
    private readonly root: HTMLElement,
    private readonly board: () => LaunchBoard,
  ) {
    if (typeof requestAnimationFrame !== 'function') return;
    // Pointer or keyboard use hands the focus ring back to the browser.
    const release = () => {
      if (this.root.dataset.pad) delete this.root.dataset.pad;
    };
    root.addEventListener('pointerdown', release, true);
    root.addEventListener('keydown', release, true);
    this.frame = requestAnimationFrame(this.poll);
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
  private poll = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.poll);
    const pad = this.pad(),
      scope = pad && !document.hidden ? this.scope() : null;
    const now = new Set<number>();
    pad?.buttons.forEach((b, i) => b.pressed && now.add(i));
    if (!pad || !scope) {
      this.wasActive = false;
      this.previous = now;
      this.held = null;
      return;
    }
    if (!this.wasActive) {
      // A press that opened this screen (A on a menu button) is not ours.
      this.wasActive = true;
      this.previous = now;
      return;
    }
    const edge = (i: number) => now.has(i) && !this.previous.has(i);
    // Left stick acts as the D-pad (past a generous dead zone).
    const sx = pad.axes[0] ?? 0,
      sy = pad.axes[1] ?? 0;
    let dir: Direction | null = null;
    if (now.has(PAD.up) || sy < -0.6) dir = 'up';
    else if (now.has(PAD.down) || sy > 0.6) dir = 'down';
    else if (now.has(PAD.left) || sx < -0.6) dir = 'left';
    else if (now.has(PAD.right) || sx > 0.6) dir = 'right';
    const time = performance.now();
    if (!dir) this.held = null;
    else if (dir !== this.held) {
      this.held = dir;
      this.repeatAt = time + 360;
      this.move(scope, dir);
    } else if (time >= this.repeatAt) {
      this.repeatAt = time + 110;
      this.move(scope, dir);
    }
    if (edge(PAD.a)) this.activate(scope);
    if (edge(PAD.b)) this.back(scope);
    if (scope.matches('.menu-body')) {
      if (edge(PAD.lb)) this.discipline(-1);
      if (edge(PAD.rb)) this.discipline(1);
      if (edge(PAD.start)) {
        const go = scope.querySelector<HTMLButtonElement>('.enter.primary');
        const form = scope.querySelector<HTMLFormElement>('#sessionForm');
        if (go && form && !go.disabled) form.requestSubmit(go);
      }
    }
    if (now.size || dir) this.root.dataset.pad = 'true';
    this.previous = now;
  };
  private move(scope: HTMLElement, dir: Direction) {
    const active = document.activeElement as HTMLElement | null;
    const inside = active && scope.contains(active) ? active : null;
    if (!inside) return this.enter(scope);
    if (dir === 'left' || dir === 'right') {
      if (this.step(inside, dir === 'right' ? 1 : -1)) return;
    }
    const list = this.focusables(scope).filter((e) => e !== inside);
    const at = nearestInDirection(
      inside.getBoundingClientRect(),
      list.map((e) => e.getBoundingClientRect()),
      dir,
    );
    if (at >= 0) {
      list[at].focus({ preventScroll: false });
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
        el.dispatchEvent(new Event('change', { bubbles: true }));
        uiCue('tick');
      }
      return true;
    }
    if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'number')) {
      if (direction > 0) el.stepUp();
      else el.stepDown();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
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
      ? scope.querySelector<HTMLElement>('[data-action="modalClose"], [data-action="telemetryClose"]')
      : null;
    if (close) {
      uiCue('back');
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
    if (document.activeElement?.matches?.('.lb-plate')) next.focus();
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
  }
}
