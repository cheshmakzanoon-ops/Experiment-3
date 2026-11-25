import { CreditsGamepad } from '../../src/ui/credits.ts';
import { MenuGamepad } from '../../src/ui/menu-gamepad.ts';
import type { LaunchBoard } from '../../src/ui/launch-board.ts';

interface OwnerRecord {
  scheduled: number;
  delivered: number;
  cancelled: number;
  maxPending: number;
  duplicateTimestamps: number;
  scheduledAfterRelease: number;
  deliveredAfterRelease: number;
  lastTimestamp: number | null;
}
interface ListenerRecord {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
  owner: string;
}
export interface PadSample {
  buttons: number[];
  axisY?: number;
  id?: string;
  label: string;
}

let state: ReturnType<typeof create> | null = null;

function create() {
  const root = document.getElementById('root')!;
  const dialog = document.getElementById('modal') as HTMLDialogElement;
  const content = document.getElementById('modalContent')!;
  const nativeRaf = window.requestAnimationFrame;
  const nativeCancel = window.cancelAnimationFrame;
  const originalPad = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  const nativeGetGamepads = navigator.getGamepads;
  const events = new AbortController();
  const pending = new Map<number, string>();
  const owners = new Map<string, OwnerRecord>();
  const released = new Set<string>();
  const listeners: ListenerRecord[] = [];
  const restorations: (() => void)[] = [];
  const restorationChecks: (() => boolean)[] = [];
  const focusEvents: { type: string; trusted: boolean; active: string }[] = [];
  const clicks: { target: string; trusted: boolean; owner: string | null }[] = [];
  const submits: { submitter: string | null; constructor: string; prevented: boolean }[] = [];
  const stages: { label: string; snapshot: ReturnType<typeof snapshot> }[] = [];
  let activeOwner: string | null = null;
  let gamepadReads = 0;
  let padId = 'scripted controller A';
  let buttons: number[] = [];
  let axisY = 0;
  let menu: MenuGamepad | null = null;
  let credits: CreditsGamepad | null = null;
  let creditGeneration = 0;
  let contentGeneration = 0;
  let closeRequests = 0;
  let creditActions = 0;
  let secondActions = 0;
  let contentReplacements = 0;
  let replaceOnCreditAction = false;
  let disposed = false;
  let restored = false;

  const record = (name: string) => {
    let value = owners.get(name);
    if (!value) {
      value = {
        scheduled: 0,
        delivered: 0,
        cancelled: 0,
        maxPending: 0,
        duplicateTimestamps: 0,
        scheduledAfterRelease: 0,
        deliveredAfterRelease: 0,
        lastTimestamp: null,
      };
      owners.set(name, value);
    }
    return value;
  };
  function owned<T>(owner: string, action: () => T): T {
    const previous = activeOwner;
    activeOwner = owner;
    try {
      return action();
    } finally {
      activeOwner = previous;
    }
  }
  const capture = (options?: boolean | EventListenerOptions) =>
    typeof options === 'boolean' ? options : !!options?.capture;
  for (const target of [window, document, root] as EventTarget[]) {
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    const addDescriptor = Object.getOwnPropertyDescriptor(target, 'addEventListener');
    const removeDescriptor = Object.getOwnPropertyDescriptor(target, 'removeEventListener');
    Object.defineProperty(target, 'addEventListener', {
      configurable: true,
      writable: true,
      value(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        add.call(target, type, listener, options);
        if (
          activeOwner &&
          listener &&
          !listeners.some(
            (item) =>
              item.target === target &&
              item.type === type &&
              item.listener === listener &&
              item.capture === capture(options),
          )
        )
          listeners.push({ target, type, listener, capture: capture(options), owner: activeOwner });
      },
    });
    Object.defineProperty(target, 'removeEventListener', {
      configurable: true,
      writable: true,
      value(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        remove.call(target, type, listener, options);
        const at = listeners.findIndex(
          (item) =>
            item.target === target &&
            item.type === type &&
            item.listener === listener &&
            item.capture === capture(options),
        );
        if (at >= 0) listeners.splice(at, 1);
      },
    });
    restorations.push(() => {
      if (addDescriptor) Object.defineProperty(target, 'addEventListener', addDescriptor);
      else Reflect.deleteProperty(target, 'addEventListener');
      if (removeDescriptor) Object.defineProperty(target, 'removeEventListener', removeDescriptor);
      else Reflect.deleteProperty(target, 'removeEventListener');
    });
    restorationChecks.push(
      () => target.addEventListener === add && target.removeEventListener === remove,
    );
  }
  // Forward every request, cancellation and callback to/from the native scheduler.
  // The owner label follows its callback; no delivery or timestamp is invented.
  window.requestAnimationFrame = (callback) => {
    const owner = activeOwner;
    const id = nativeRaf.call(window, (time) => {
      pending.delete(id);
      if (!owner) return callback(time);
      const stats = record(owner);
      stats.delivered++;
      if (released.has(owner)) stats.deliveredAfterRelease++;
      if (stats.lastTimestamp === time) stats.duplicateTimestamps++;
      stats.lastTimestamp = time;
      owned(owner, () => callback(time));
    });
    if (owner) {
      pending.set(id, owner);
      const stats = record(owner);
      stats.scheduled++;
      if (released.has(owner)) stats.scheduledAfterRelease++;
      stats.maxPending = Math.max(
        stats.maxPending,
        [...pending.values()].filter((value) => value === owner).length,
      );
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const owner = pending.get(id);
    if (owner) record(owner).cancelled++;
    pending.delete(id);
    nativeCancel.call(window, id);
  };
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value() {
      gamepadReads++;
      // This is the only device boundary substituted by the fixture.
      return [
        {
          index: 0,
          id: padId,
          mapping: 'standard',
          connected: true,
          timestamp: performance.now(),
          axes: [0, axisY],
          buttons: Array.from({ length: 16 }, (_, i) => ({
            pressed: buttons.includes(i),
            touched: buttons.includes(i),
            value: buttons.includes(i) ? 1 : 0,
          })),
          vibrationActuator: null,
        } as unknown as Gamepad,
      ];
    },
  });
  for (const type of ['blur', 'focus'])
    window.addEventListener(
      type,
      (event) => {
        focusEvents.push({
          type,
          trusted: event.isTrusted,
          active: document.activeElement?.id ?? '',
        });
      },
      { signal: events.signal },
    );

  function releaseCredits() {
    const old = credits;
    credits = null;
    if (old) released.add(`credits-${creditGeneration}`);
    old?.dispose();
  }
  function closeDialog() {
    closeRequests++;
    releaseCredits();
    dialog.close();
  }
  function openCredits(replace = false) {
    if (disposed) throw new Error('Fixture owners are disposed');
    releaseCredits();
    replaceOnCreditAction = replace;
    creditGeneration++;
    contentGeneration++;
    content.innerHTML = `<section data-sheet="credits-${creditGeneration}">
      <h2>Credits input fixture</h2><div id="creditsList" tabindex="0" class="credits-list">
        <div id="creditFocus" tabindex="0">Credits focus</div>
        <button id="creditAction" type="button" data-action="creditAction">Credit action</button>
        <div class="scroll-space">Fixture scroll content</div></div>
      <button id="closeCredits" data-action="modalClose">Close credits</button>
      <iframe id="focus-target" title="Child focus" srcdoc="<input aria-label='Child focus field'>"></iframe>
    </section>`;
    if (!dialog.open) dialog.showModal();
    const list = document.getElementById('creditsList')!;
    list.focus();
    credits = owned(`credits-${creditGeneration}`, () => new CreditsGamepad(list, closeDialog));
  }
  function openReplacementSheet() {
    releaseCredits();
    contentGeneration++;
    content.innerHTML =
      '<section data-sheet="first"><h2>First sheet</h2>' +
      '<button id="replaceContent" data-action="replaceContent">Replace sheet</button>' +
      '<button data-action="modalClose">Close sheet</button></section>';
    if (!dialog.open) dialog.showModal();
    document.getElementById('replaceContent')!.focus();
  }
  root.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target || disposed) return;
      clicks.push({
        target: target.id || target.dataset.action!,
        trusted: event.isTrusted,
        owner: activeOwner,
      });
      switch (target.dataset.action) {
        case 'openCredits':
          openCredits();
          break;
        case 'modalClose':
          closeDialog();
          break;
        case 'creditAction': {
          creditActions++;
          if (replaceOnCreditAction) {
            openCredits();
            document.getElementById('creditAction')!.focus();
          }
          break;
        }
        case 'replaceContent':
          contentReplacements++;
          contentGeneration++;
          content.innerHTML =
            '<section data-sheet="second"><h2>Second sheet</h2>' +
            '<button id="secondAction" data-action="secondAction">Second action</button>' +
            '<button data-action="modalClose">Close sheet</button></section>';
          document.getElementById('secondAction')!.focus();
          break;
        case 'secondAction':
          secondActions++;
          break;
      }
    },
    { signal: events.signal },
  );
  document.getElementById('sessionForm')!.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      submits.push({
        submitter: (event as SubmitEvent).submitter?.id ?? null,
        constructor: event.constructor.name,
        prevented: event.defaultPrevented,
      });
    },
    { signal: events.signal },
  );
  menu = owned(
    'menu',
    () =>
      new MenuGamepad(
        root,
        () =>
          ({
            setDiscipline() {
              throw new Error('Fixture does not exercise discipline changes');
            },
          }) as unknown as LaunchBoard,
      ),
  );

  function snapshot() {
    return {
      disposed,
      restored,
      nativeApisRestored:
        restored &&
        window.requestAnimationFrame === nativeRaf &&
        window.cancelAnimationFrame === nativeCancel &&
        navigator.getGamepads === nativeGetGamepads &&
        restorationChecks.every((check) => check()),
      focused: document.hasFocus(),
      activeElement: document.activeElement?.id ?? '',
      modalOpen: dialog.open,
      contentGeneration,
      creditGeneration,
      closeRequests,
      creditActions,
      secondActions,
      contentReplacements,
      submits: submits.map((value) => ({ ...value })),
      scrollTop: document.getElementById('creditsList')?.scrollTop ?? null,
      padMarker: root.dataset.pad ?? null,
      gamepadReads,
      pendingRafs: pending.size,
      ownedListeners: listeners.length,
      owners: Object.fromEntries(
        [...owners].map(([name, value]) => [
          name,
          {
            ...value,
            released: released.has(name),
            pending: [...pending.values()].filter((owner) => owner === name).length,
            listeners: listeners.filter((item) => item.owner === name).length,
          },
        ]),
      ),
      focusEvents: focusEvents.map((value) => ({ ...value })),
      clicks: clicks.map((value) => ({ ...value })),
    };
  }
  async function frames(count = 3) {
    for (let i = 0; i < count; i++)
      await new Promise<number>((resolve) => nativeRaf.call(window, resolve));
  }
  async function checkpoint(label: string) {
    await frames();
    const value = snapshot();
    stages.push({ label, snapshot: value });
    return value;
  }
  function disposeOwners() {
    if (!disposed) {
      disposed = true;
      releaseCredits();
      const old = menu;
      menu = null;
      if (old) released.add('menu');
      old?.dispose();
      if (dialog.open) dialog.close();
      root.dataset.pad = 'retained-after-dispose';
    }
    return snapshot();
  }
  function close() {
    disposeOwners();
    if (!restored) {
      events.abort();
      for (const restore of restorations.reverse()) restore();
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCancel;
      if (originalPad) Object.defineProperty(navigator, 'getGamepads', originalPad);
      else Reflect.deleteProperty(navigator, 'getGamepads');
      restored = true;
    }
    return snapshot();
  }
  return {
    snapshot,
    checkpoint,
    disposeOwners,
    close,
    async sample(value: PadSample) {
      buttons = value.buttons.slice();
      axisY = value.axisY ?? 0;
      if (value.id !== undefined) padId = value.id;
      return checkpoint(value.label);
    },
    async showCredits(replace = false) {
      openCredits(replace);
      return checkpoint('open credits');
    },
    async showReplacementSheet() {
      openReplacementSheet();
      return checkpoint('open replacement sheet');
    },
    report: () => ({
      boundaries: {
        gamepad: 'scripted navigator.getGamepads',
        dom: 'native browser',
        animationFrames: 'native callbacks and timestamps, forwarding instrumentation',
        listenerAccounting: 'forwarded registration/removal on production owner targets',
        physicalControllerValidated: false,
        nativeHistoryValidated: false,
      },
      stages,
      current: snapshot(),
    }),
  };
}

export async function open() {
  state?.close();
  state = create();
  return state.checkpoint('open');
}
export const snapshot = () => state!.snapshot();
export const sample = (value: PadSample) => state!.sample(value);
export const checkpoint = (label: string) => state!.checkpoint(label);
export const showCredits = (replace = false) => state!.showCredits(replace);
export const showReplacementSheet = () => state!.showReplacementSheet();
export const disposeOwners = () => state!.disposeOwners();
export const close = () => state?.close() ?? null;
export const report = () => state?.report() ?? null;
