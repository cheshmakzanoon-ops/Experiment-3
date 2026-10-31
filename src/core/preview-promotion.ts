export interface PreviewPromotionJob<T> {
  current(): boolean;
  create(cancelled: () => boolean): Promise<T | null>;
  adopt(value: T): void;
  dispose(value: T): void;
  reveal(): void;
}

/** One renderer construction owner. Closing its panel does not abandon GPU
 * ownership: finish the venue into the menu, but never reopen a closed panel.
 * A superseded/disposed application never adopts its late candidate. */
export class PreviewPromotion {
  private pending: Promise<void> | null = null;
  private epoch = 0;
  private panel = false;
  get busy() {
    return this.pending !== null;
  }
  closePanel() {
    this.panel = false;
  }
  invalidate() {
    this.epoch++;
    this.panel = false;
  }
  run<T>(job: PreviewPromotionJob<T>): Promise<void> {
    this.panel = true;
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    const current = () => epoch === this.epoch && job.current();
    // Install ownership before create can synchronously call back into the UI.
    const pending = Promise.resolve().then(async () => {
      let candidate: T | null = null;
      try {
        if (!current()) return;
        candidate = await job.create(() => !current());
        if (!candidate || !current()) return;
        job.adopt(candidate);
        candidate = null;
        if (this.panel && current()) job.reveal();
      } catch (error) {
        // A disposed/superseded owner must not resurrect its error UI either.
        if (current()) throw error;
      } finally {
        if (candidate) job.dispose(candidate);
      }
    });
    this.pending = pending.finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
