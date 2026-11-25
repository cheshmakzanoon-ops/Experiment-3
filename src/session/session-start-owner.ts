export interface SessionStartScope {
  readonly signal: AbortSignal;
  current(): boolean;
  /** Host callbacks must lose access to shared UI/input/audio when replaced. */
  guard<Args extends unknown[]>(callback: (...args: Args) => void): (...args: Args) => void;
}

interface SessionRun<Session> {
  controller: AbortController;
  starting: boolean;
  session: Session | null;
}

/** Own a lazy session before its module or session instance exists. Cancellation
 * remains connected after startup; late instances are disposed instead of adopted. */
export class SessionStartOwner<Session extends { dispose(): void }> {
  private run: SessionRun<Session> | null = null;
  private generation = 0;

  get session() {
    return this.run?.session ?? null;
  }

  get starting() {
    return this.run?.starting ?? false;
  }

  async start<Module>(task: {
    load(): Promise<Module>;
    create(module: Module, scope: SessionStartScope): Promise<Session>;
    ready(session: Session): void;
    failed(): void;
  }): Promise<void> {
    if (this.run) return;
    const run: SessionRun<Session> = {
      controller: new AbortController(), starting: true, session: null,
    };
    this.run = run;
    const generation = ++this.generation;
    const current = () => this.run === run && !run.controller.signal.aborted;
    const scope: SessionStartScope = {
      signal: run.controller.signal,
      current,
      guard: (callback) => (...args) => {
        if (current()) callback(...args);
      },
    };
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => { cancelled = () => resolve(); });
    run.controller.signal.addEventListener('abort', cancelled, { once: true });
    const stopWaiting = () => run.controller.signal.removeEventListener('abort', cancelled);
    const complete = async () => {
      try {
        const module = await task.load();
        if (!current()) return;
        const session = await task.create(module, scope);
        if (!current()) {
          session.dispose();
          return;
        }
        run.session = session;
        task.ready(session);
      } catch (error) {
        // An aborted import/start can reject later, after a new run has begun.
        // Its failure belongs to the departed run, not the application.
        if (!current()) return;
        // Failure cleanup aborts this run too, but must retain its startup cause
        // instead of settling as an intentional cancellation.
        stopWaiting();
        try {
          this.cancel();
        } catch {
          // A cleanup failure must not suppress host recovery below.
        }
        // Cleanup can synchronously admit another run. Its host state must
        // not be restored or failed by the departed predecessor.
        if (this.generation !== generation) return;
        let failure = error;
        try {
          task.failed();
        } catch (recoveryError) {
          // Keep the startup cause while preserving the host's terminal
          // recovery diagnostic, which describes why it could not resume.
          failure = new AggregateError(
            [error, recoveryError],
            recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            { cause: error },
          );
        }
        if (this.generation !== generation) return;
        throw failure;
      } finally {
        // Never clear a replacement run's loading state from a stale finally.
        run.starting = false;
        stopWaiting();
      }
    };
    // Cancellation releases the caller even if a loader never settles. Keep
    // observing complete(): late rejection is consumed and late sessions disposed.
    return Promise.race([complete(), cancellation]);
  }

  cancel() {
    const run = this.run;
    if (!run) return;
    // Abort listeners may call the host synchronously. Revoke ownership first.
    this.run = null;
    run.controller.abort();
    run.session?.dispose();
  }
}
