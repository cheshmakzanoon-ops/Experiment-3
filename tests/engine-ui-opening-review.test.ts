import { afterEach, describe, expect, it, vi } from 'vitest';
import { Interface } from '../src/ui/interface.ts';
import { UI_CUE_EVENT } from '../src/ui/ui-cue.ts';

type OpeningBoundary = 'dialog focus' | 'open cue' | 'first-run focus';
type ModalOwner = {
  disposed: boolean;
  firstRunBinding: (() => void) | null;
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const release of cleanup.splice(0)) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Run the actual modalContent, dispose and first-run binding implementations.
 * Only the browser focus/DOM boundary is controlled. A native focus handler or
 * a synchronous cue subscriber may dispose the owner before opening returns. */
function openingFixture(
  boundary: OpeningBoundary,
  operation: 'dispose' | 'replace' | 'close' = 'dispose',
) {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  const releaseListeners: (() => void)[] = [];
  function firstRunSection() {
    const primary = { focus: vi.fn() };
    const section = Object.assign(new EventTarget(), {
      querySelector: (selector: string) =>
        selector === '[data-action="firstrun:go"]' ? primary : null,
    });
    const signals: AbortSignal[] = [];
    const add = section.addEventListener.bind(section);
    vi.spyOn(section, 'addEventListener').mockImplementation((type, listener, options) => {
      if (options && typeof options === 'object' && options.signal) signals.push(options.signal);
      add(type, listener, options);
      releaseListeners.push(() => section.removeEventListener(type, listener, options));
    });
    return { section, primary, signals };
  }
  const original = firstRunSection(),
    replacement = firstRunSection();
  const content = {
    innerHTML: '',
    isConnected: true,
    querySelector: (selector: string) =>
      selector === '.fr'
        ? content.innerHTML.includes('replacement')
          ? replacement.section
          : original.section
        : null,
  };
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'modalContent' ? content : null),
  });
  const modal = { open: false, scrollTop: 0, showModal: vi.fn(), close: vi.fn() };
  modal.close.mockImplementation(() => {
    modal.open = false;
  });
  const events = new AbortController();
  const ui = Object.assign(Object.create(Interface.prototype) as object, {
    disposed: false,
    events,
    menuPad: null,
    board: null,
    resizeObserver: null,
    toastTimer: 0,
    nodes: new Map(),
    wildcardBinding: null,
    firstRunBinding: null,
    settingsBinding: null,
    creditsPad: null,
    bindingCapture: null,
    deviceCalibration: null,
    modal,
  }) as unknown as Interface;
  const owner = ui as unknown as ModalOwner;
  // Explicitly release a leaked test binding if the pre-fix implementation
  // publishes one after disposal. Repeated Interface.dispose alone cannot.
  cleanup.push(() => {
    ui.dispose();
    owner.firstRunBinding?.();
    for (const release of releaseListeners) release();
  });
  let interrupted = false;
  const replacementOpenings: boolean[] = [];
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    if (operation === 'dispose') ui.dispose();
    else if (operation === 'close') ui.closeModal();
    else
      replacementOpenings.push(
        ui.modalContent('<section class="fr" data-owner="replacement"></section>'),
      );
  };
  modal.showModal.mockImplementation(() => {
    modal.open = true;
    if (boundary === 'dialog focus') interrupt();
  });
  target.addEventListener(UI_CUE_EVENT, () => {
    if (boundary === 'open cue') interrupt();
  });
  original.primary.focus.mockImplementation(() => {
    if (boundary === 'first-run focus') interrupt();
  });
  return {
    ui,
    owner,
    events,
    signals: original.signals,
    replacement,
    content,
    modal,
    replacementOpenings,
  };
}

describe('modal opening cannot publish a binding after reentrant teardown', () => {
  it.each<OpeningBoundary>(['dialog focus', 'open cue', 'first-run focus'])(
    'releases the actual first-run listeners when disposed during %s',
    (boundary) => {
      const { ui, owner, events, signals } = openingFixture(boundary);
      expect(ui.modalContent('<section class="fr"></section>')).toBe(false);
      expect(owner.disposed).toBe(true);
      expect(events.signal.aborted).toBe(true);
      expect(signals.filter((signal) => !signal.aborted)).toHaveLength(0);
      expect(owner.firstRunBinding).toBeNull();
    },
  );

  it.each<OpeningBoundary>(['dialog focus', 'open cue', 'first-run focus'])(
    'retains only the replacement binding when another modal opens during %s',
    (boundary) => {
      const { ui, owner, signals, replacement, content, replacementOpenings } = openingFixture(
        boundary,
        'replace',
      );
      expect(ui.modalContent('<section class="fr"></section>')).toBe(false);
      expect(replacementOpenings).toEqual([true]);
      expect(owner.disposed).toBe(false);
      expect(content.innerHTML).toContain('replacement');
      expect(replacement.signals).toHaveLength(3);
      expect(replacement.signals.every((signal) => !signal.aborted)).toBe(true);
      expect(signals.filter((signal) => !signal.aborted)).toHaveLength(0);
      ui.dispose();
      expect(replacement.signals.every((signal) => signal.aborted)).toBe(true);
      expect(owner.firstRunBinding).toBeNull();
    },
  );

  it('releases the in-flight binding when first-run focus closes its modal', () => {
    const { ui, owner, events, signals, modal, replacement } = openingFixture(
      'first-run focus',
      'close',
    );
    expect(ui.modalContent('<section class="fr"></section>')).toBe(false);
    expect(owner.disposed).toBe(false);
    expect(events.signal.aborted).toBe(false);
    expect(modal.open).toBe(false);
    expect(modal.close).toHaveBeenCalledOnce();
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(owner.firstRunBinding).toBeNull();
    expect(ui.modalContent('<section class="fr" data-owner="replacement"></section>')).toBe(true);
    expect(replacement.signals).toHaveLength(3);
    expect(replacement.signals.every((signal) => !signal.aborted)).toBe(true);
    ui.dispose();
    expect(replacement.signals.every((signal) => signal.aborted)).toBe(true);
  });
});
