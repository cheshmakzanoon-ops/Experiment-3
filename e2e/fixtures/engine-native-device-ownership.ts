import { CreditsGamepad } from '../../src/ui/credits.ts';
import { MenuGamepad } from '../../src/ui/menu-gamepad.ts';
import type { LaunchBoard } from '../../src/ui/launch-board.ts';

interface OwnerRecord {
  scheduled: number;
  cancelled: number;
  maxPending: number;
  scheduledAfterRelease: number;
  deliveredAfterRelease: number;
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

interface RafOwnerRecord {
  delivered: number;
  duplicateFrames: number;
  unwitnessedDeliveries: number;
  timestampMismatches: number;
  duplicateTimestamps: number;
  lastFrame: number | null;
  lastTimestamp: number | null;
  timestampCollisions: { timestamp: number; previousFrame: number | null; frame: number }[];
}
const emptyRafOwner = (): RafOwnerRecord => ({
  delivered: 0,
  duplicateFrames: 0,
  unwitnessedDeliveries: 0,
  timestampMismatches: 0,
  duplicateTimestamps: 0,
  lastFrame: null,
  lastTimestamp: null,
  timestampCollisions: [],
});

/**
 * Start before scheduling any observed owner. HTML snapshots an ordered callback
 * list: this native sentinel runs before the owners, and queues its successor
 * before they can queue theirs. Its serial identifies that callback batch even
 * when two batches receive equal timestamp numbers. It never supplies or changes
 * an owner's callback timestamp.
 */
export function createRafWitness(
  request: (callback: FrameRequestCallback) => number,
  cancel: (id: number) => void,
) {
  const owners = new Map<string, RafOwnerRecord>();
  let frame = 0;
  let timestamp: number | null = null;
  let pending: number | null = null;
  let stopped = false;
  const markFrame: FrameRequestCallback = (time) => {
    pending = null;
    if (stopped) return;
    frame++;
    timestamp = time;
    pending = request(markFrame);
  };
  pending = request(markFrame);
  return {
    delivered(owner: string, time: number) {
      let stats = owners.get(owner);
      if (!stats) {
        stats = emptyRafOwner();
        owners.set(owner, stats);
      }
      stats.delivered++;
      if (stopped || frame === 0) stats.unwitnessedDeliveries++;
      if (timestamp !== time) stats.timestampMismatches++;
      if (stats.lastFrame === frame) stats.duplicateFrames++;
      if (stats.lastTimestamp === time) {
        stats.duplicateTimestamps++;
        stats.timestampCollisions.push({
          timestamp: time,
          previousFrame: stats.lastFrame,
          frame,
        });
      }
      stats.lastFrame = frame;
      stats.lastTimestamp = time;
    },
    owner(name: string) {
      const value = owners.get(name) ?? emptyRafOwner();
      return {
        ...value,
        timestampCollisions: value.timestampCollisions.map((collision) => ({ ...collision })),
      };
    },
    snapshot: () => ({
      frames: frame,
      lastTimestamp: timestamp,
      pending: pending !== null,
      stopped,
    }),
    stop() {
      if (stopped) return;
      stopped = true;
      if (pending !== null) cancel(pending);
      pending = null;
    },
  };
}

let state: ReturnType<typeof create> | null = null;

function create() {
  const root = document.getElementById('root')!;
  const dialog = document.getElementById('modal') as HTMLDialogElement;
  const content = document.getElementById('modalContent')!;
  const nativeRaf = window.requestAnimationFrame;
  const nativeCancel = window.cancelAnimationFrame;
  const rafWitness = createRafWitness(
    (callback) => nativeRaf.call(window, callback),
    (id) => nativeCancel.call(window, id),
  );
  const controlOwner = 'raf-witness-negative-control';
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
        cancelled: 0,
        maxPending: 0,
        scheduledAfterRelease: 0,
        deliveredAfterRelease: 0,
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
      rafWitness.delivered(owner, time);
      if (released.has(owner)) stats.deliveredAfterRelease++;
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
  // Calibrate the witness with an actual duplicate owner in one native batch.
  // Both requests are forwarded normally; the diagnostic owner is reported
  // separately and releases itself after its second (and final) callback.
  let controlCallbacks = 2;
  owned(controlOwner, () => {
    for (let i = 0; i < 2; i++)
      window.requestAnimationFrame(() => {
        if (--controlCallbacks === 0) released.add(controlOwner);
      });
  });
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

  function ownerSnapshot(name: string, value: OwnerRecord) {
    return {
      ...value,
      ...rafWitness.owner(name),
      released: released.has(name),
      pending: [...pending.values()].filter((owner) => owner === name).length,
      listeners: listeners.filter((item) => item.owner === name).length,
    };
  }
  function snapshot() {
    const witness = rafWitness.snapshot();
    return {
      disposed,
      restored,
      nativeApisRestored:
        restored &&
        witness.stopped &&
        !witness.pending &&
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
      rafWitness: witness,
      rafControl: ownerSnapshot(controlOwner, record(controlOwner)),
      owners: Object.fromEntries(
        [...owners]
          .filter(([name]) => name !== controlOwner)
          .map(([name, value]) => [name, ownerSnapshot(name, value)]),
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
      released.add(controlOwner);
      for (const [id, owner] of pending)
        if (owner === controlOwner) window.cancelAnimationFrame(id);
      rafWitness.stop();
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
        animationFrames:
          'native callbacks and timestamps; first native sentinel marks each batch',
        rafControl: 'two native callbacks under one separate diagnostic owner',
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
