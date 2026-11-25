/// <reference lib="webworker" />
export interface IntervalOwner {
  owner: number;
  handle: number;
  delay: number | null;
  scheduledAt: number;
  cancelledAt: number | null;
  callbacks: number;
  callbacksAfterCancel: number;
  activeAfterLastCallback: boolean | null;
  cancelledInCallback: boolean | null;
}
export interface IntervalSnapshot {
  time: number;
  scheduled: number;
  cancelled: number;
  callbacks: number;
  callbacksAfterCancel: number;
  maxActive: number;
  activeOwners: number[];
  owners: IntervalOwner[];
}
export interface IdleObservation {
  type: '__engineIdleObservation';
  sequence: number;
  requestedMs: number;
  before: IntervalSnapshot;
  after: IntervalSnapshot;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const nativeInterval = scope.setInterval.bind(scope),
  nativeClear = scope.clearInterval.bind(scope),
  nativeTimeout = scope.setTimeout.bind(scope);
const active = new Map<number, IntervalOwner>();
const owners: IntervalOwner[] = [];
let executing: IntervalOwner | null = null;
let cancelled = 0,
  callbacks = 0,
  callbacksAfterCancel = 0,
  maxActive = 0;

// This prelude is bundled separately and executed before the production worker.
// Every production request retains its native period, arguments, handle and
// callback delivery. No callback is supplied by the observer itself.
scope.setInterval = (handler: TimerHandler, delay?: number, ...args: unknown[]): number => {
  if (typeof handler !== 'function')
    throw new Error('Native idle witness requires function interval callbacks');
  let owner!: IntervalOwner;
  const handle = nativeInterval(function (this: unknown, ...delivered: unknown[]) {
    callbacks++;
    owner.callbacks++;
    if (owner.cancelledAt !== null) {
      callbacksAfterCancel++;
      owner.callbacksAfterCancel++;
    }
    const previous = executing;
    executing = owner;
    try {
      return Reflect.apply(handler, this, delivered);
    } finally {
      owner.activeAfterLastCallback = active.get(handle) === owner;
      executing = previous;
    }
  }, delay, ...args);
  owner = {
    owner: owners.length + 1,
    handle,
    delay: delay ?? null,
    scheduledAt: performance.now(),
    cancelledAt: null,
    callbacks: 0,
    callbacksAfterCancel: 0,
    activeAfterLastCallback: null,
    cancelledInCallback: null,
  };
  owners.push(owner);
  active.set(handle, owner);
  maxActive = Math.max(maxActive, active.size);
  return handle;
};
scope.clearInterval = (handle?: number) => {
  nativeClear(handle);
  if (handle === undefined) return;
  const owner = active.get(handle);
  if (!owner) return;
  active.delete(handle);
  owner.cancelledAt = performance.now();
  owner.cancelledInCallback = executing === owner;
  cancelled++;
};

const snapshot = (): IntervalSnapshot => ({
  time: performance.now(),
  scheduled: owners.length,
  cancelled,
  callbacks,
  callbacksAfterCancel,
  maxActive,
  activeOwners: [...active.values()].map((owner) => owner.owner),
  owners: owners.map((owner) => ({ ...owner })),
});

// Installed before production assigns onmessage. A query is a FIFO barrier
// behind earlier host commands; only this fixture's private query is consumed.
// Real production messages pass unchanged through the native event dispatch.
scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data as { type?: string; sequence?: number; duration?: number } | null;
  if (!data || data.type !== '__engineIdleObserve') return;
  event.stopImmediatePropagation();
  const sequence = data.sequence,
    duration = data.duration;
  if (
    !Number.isSafeInteger(sequence) ||
    typeof sequence !== 'number' ||
    sequence < 1 ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 200
  )
    throw new Error('Invalid native idle observation request');
  const before = snapshot();
  const reply = () => {
    const response: IdleObservation = {
      type: '__engineIdleObservation',
      sequence,
      requestedMs: duration,
      before,
      after: snapshot(),
    };
    scope.postMessage(response);
  };
  if (duration === 0) reply();
  else nativeTimeout(reply, duration);
});
