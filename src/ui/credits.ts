import { creditLines, type CreditLine } from '../rendering/assets/third-party.ts';

const KIND_LABEL: Record<CreditLine['kind'], string> = {
  hdri: 'Photographed skies (HDRI)',
  texture: 'Scanned material textures',
  mesh: 'Models',
  vegetation: 'Trees, shrubs and grass',
};

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "Credits & licences" modal body: every third-party manifest entry with its
 * attribution, licence and source, grouped by kind. Plain links; the list is
 * a focusable scroll region (arrow keys, Page Up/Down, gamepad). */
export function creditsHtml(lines: readonly CreditLine[] = creditLines()) {
  const groups = (['hdri', 'texture', 'mesh', 'vegetation'] as const)
    .map((kind) => ({ kind, items: lines.filter((l) => l.kind === kind) }))
    .filter((g) => g.items.length);
  const body = groups
    .map(
      (g) =>
        `<section class="credits-group"><h3>${KIND_LABEL[g.kind]}</h3><ul>${g.items
          .map(
            (l) =>
              `<li><b>${escape(l.title)}</b><span>${escape(l.attribution)}</span><small><a href="${escape(l.licenceUrl)}" target="_blank" rel="noopener noreferrer">${escape(l.licenceName)}</a> · <a href="${escape(l.homepage ?? l.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a></small></li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('');
  return `<span class="eyebrow">PADDOCK / CREDITS</span><h2>Credits &amp; licences.</h2><p>The circuits, cars, riders, interface and sound are original work of this project. The photographed and scanned material below is used under its authors' licences; thank you to everyone who shares their work freely.</p><div class="credits-list" id="creditsList" tabindex="0" role="region" aria-label="Third-party credits">${
    body || '<p>No third-party assets are shipped in this build.</p>'
  }<p class="small-note">Full licence texts for everything below and for the runtime libraries (three.js MIT; the Basis Universal transcoder Apache-2.0; the Saira and Saira Stencil One typefaces by Omnibus-Type, SIL Open Font License 1.1): <a href="THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener">THIRD_PARTY_NOTICES.txt</a>. Art attributions only: <a href="assets/third-party/CREDITS.txt" target="_blank" rel="noopener">CREDITS.txt</a>.</p></div><div class="dialog-buttons"><button class="primary" data-action="modalClose">CLOSE</button></div>`;
}

/**
 * Gamepad access for the credits modal (the paddock menu itself is driven by
 * keyboard and pointer): D-pad / left stick scrolls the list, A activates
 * the focused control, B or Start closes. Polls only while the modal is open.
 */
export class CreditsGamepad {
  private frame: number | null = null;
  private frameGeneration = 0;
  private previous = new Set<number>();
  private device: Pick<Gamepad, 'index' | 'id' | 'mapping'> | null = null;
  private focused = true;
  private pageActive = true;
  private navigationReady = false;
  private ownership = 0;
  private disposed = false;
  private resetOwnership = () => {
    this.ownership++;
    this.device = null;
    this.previous.clear();
    this.navigationReady = false;
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
    this.cancelFrame();
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
    private readonly list: HTMLElement,
    private readonly close: () => void,
  ) {
    // Buttons held while the modal opened are not new presses.
    this.focused = document.hasFocus?.() ?? true;
    const pad = this.pad();
    if (pad && this.focused && !document.hidden) this.baseline(pad);
    window.addEventListener('blur', this.blur);
    window.addEventListener('focus', this.focus);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
    window.addEventListener('gamepaddisconnected', this.disconnect);
    document.addEventListener('visibilitychange', this.resetOwnership);
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
  private cancelFrame() {
    this.frameGeneration++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
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
  private pressed(pad: Gamepad) {
    const set = new Set<number>();
    pad.buttons.forEach((b, i) => b.pressed && set.add(i));
    return set;
  }
  private baseline(pad: Gamepad) {
    this.device = { index: pad.index, id: pad.id, mapping: pad.mapping };
    this.previous = this.pressed(pad);
    this.navigationReady =
      !this.previous.has(12) && !this.previous.has(13) && Math.abs(pad.axes[1] ?? 0) <= 0.25;
  }
  private poll() {
    if (this.disposed || !this.pageActive) return;
    const ownership = this.ownership;
    const pad = this.pad();
    if (this.disposed || !this.pageActive || ownership !== this.ownership) {
      this.scheduleFrame();
      return;
    }
    if (!pad || !this.focused || document.hidden) {
      this.resetOwnership();
      this.scheduleFrame();
      return;
    }
    if (
      !this.device ||
      pad.index !== this.device.index ||
      pad.id !== this.device.id ||
      pad.mapping !== this.device.mapping
    ) {
      this.resetOwnership();
      this.baseline(pad);
      this.scheduleFrame();
      return;
    }
    const now = this.pressed(pad),
      previous = this.previous;
    this.previous = now;
    const edge = (i: number) => now.has(i) && !previous.has(i);
    const stick = Math.abs(pad.axes[1] ?? 0) > 0.25 ? (pad.axes[1] ?? 0) : 0;
    const step = (now.has(13) ? 1 : 0) - (now.has(12) ? 1 : 0) + stick;
    if (!now.has(12) && !now.has(13) && stick === 0) this.navigationReady = true;
    if (step && this.navigationReady) {
      this.list.scrollBy({ top: step * 14 });
      // Scrolling may run a callback that replaces the modal or suspends its
      // page. None of the remaining edges belongs to that new owner.
      if (
        this.disposed ||
        !this.pageActive ||
        !this.focused ||
        document.hidden ||
        ownership !== this.ownership
      ) {
        this.scheduleFrame();
        return;
      }
    }
    if (edge(1) || edge(9)) return this.close();
    if (edge(0) && document.activeElement instanceof HTMLElement) document.activeElement.click();
    this.scheduleFrame();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('focus', this.focus);
    window.removeEventListener('pagehide', this.pageHide);
    window.removeEventListener('pageshow', this.pageShow);
    window.removeEventListener('gamepaddisconnected', this.disconnect);
    document.removeEventListener('visibilitychange', this.resetOwnership);
    this.resetOwnership();
  }
}
