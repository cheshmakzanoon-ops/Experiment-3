import { SessionLifetime } from './session-lifetime.ts';

/** A first-frame gate for one startup generation. The same lifetime cancels
 * startup's other waits; it does not own the worker or the running session. */
export class WorkerReadiness {
  readonly lifetime = new SessionLifetime('Circuit startup cancelled.');
  readonly ready: Promise<void>;
  private resolve: (() => void) | null = null;

  constructor(readonly generation: number) {
    this.ready = this.lifetime.wait(
      new Promise<void>((resolve) => {
        this.resolve = resolve;
      }),
      () => {
        this.resolve = null;
      },
    );
    // Audio, module loading and rendering can still be pending when startup
    // fails. Observe rejection immediately, before start reaches await ready.
    void this.ready.catch(() => undefined);
  }

  get pending() {
    return this.resolve !== null;
  }

  accept(generation: number) {
    if (generation !== this.generation || this.lifetime.signal.aborted) return;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }

  close(error?: Error) {
    this.lifetime.close(error);
  }
}
