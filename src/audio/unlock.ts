/** Autoplay policy. A browser keeps a new AudioContext suspended until the page
 * has seen a user gesture, and `resume()` on a suspended context stays PENDING
 * (it neither resolves nor rejects) until then. The session start used to await
 * it, so a player who reached the grid with a gamepad alone (a gamepad button is
 * not a user activation) would have waited on a promise that never settles.
 *
 * `settle` bounds that wait; `AudioUnlock` keeps asking on every gesture that
 * counts as activation until the context runs. The desktop shell sets
 * `autoplayPolicy: 'no-user-gesture-required'` (desktop/main.cjs) and never sees
 * this path. */

/** The slice of AudioContext the unlock needs. */
export interface UnlockableContext {
  readonly state: AudioContextState | 'interrupted';
  resume(): Promise<void>;
}

/** Gestures browsers accept as activation (a gamepad button is not one). */
export const UNLOCK_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click'] as const;

/** Resolve when `promise` settles or after `ms`, whichever is first; never rejects. */
export function settle(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export class AudioUnlock {
  private readonly abort = new AbortController();
  /** Gestures seen that asked the context to resume (diagnostics, tests). */
  attempts = 0;
  constructor(
    private readonly context: UnlockableContext,
    target: EventTarget | undefined = globalThis.window,
  ) {
    for (const type of UNLOCK_EVENTS)
      target?.addEventListener(type, () => this.attempt(), {
        signal: this.abort.signal,
        capture: true,
        passive: true,
      });
  }
  /** True while the context is not running (blocked by the autoplay policy or suspended). */
  get locked() {
    return this.context.state !== 'running';
  }
  /** Ask the context to resume; failures are not errors (the next gesture asks again). */
  attempt() {
    if (!this.locked) return;
    this.attempts++;
    void this.context.resume().catch(() => undefined);
  }
  dispose() {
    this.abort.abort();
  }
}
