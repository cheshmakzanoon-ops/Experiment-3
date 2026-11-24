/** Cancel the waits owned by one session, including work whose underlying
 * loader is shared and must finish independently. Late rejections are consumed. */
export class SessionLifetime {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;

  constructor(
    private readonly closedMessage: string,
    signal?: AbortSignal,
  ) {
    const close = () => this.close();
    if (signal?.aborted) close();
    else signal?.addEventListener('abort', close, { once: true, signal: this.signal });
  }

  check() {
    if (this.signal.aborted) throw this.signal.reason;
  }

  close(error = new Error(this.closedMessage)) {
    if (!this.signal.aborted) this.controller.abort(error);
  }

  wait<T>(work: Promise<T>, cancel?: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener('abort', abort);
        cancel?.();
        complete();
      };
      const abort = () => finish(() => reject(this.signal.reason));
      // Keep both handlers even after cancellation: shared loaders can fail
      // later, but that failure no longer belongs to the departed session.
      work.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
      if (this.signal.aborted) abort();
      else this.signal.addEventListener('abort', abort, { once: true });
    });
  }

  delay(milliseconds: number) {
    this.check();
    let timer: ReturnType<typeof setTimeout>;
    const work = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    });
    return this.wait(work, () => clearTimeout(timer));
  }

  frame() {
    this.check();
    let frame: number;
    const work = new Promise<void>((resolve) => {
      frame = requestAnimationFrame(() => resolve());
    });
    return this.wait(work, () => cancelAnimationFrame(frame));
  }
}
