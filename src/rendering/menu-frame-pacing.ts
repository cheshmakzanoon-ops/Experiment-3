interface MenuFrameSource {
  canSubmitFrame(): boolean;
}

export type MenuFrameReadiness = 'busy' | 'completed' | 'quiet' | 'ready';

/** A completed showroom frame gets a quiet browser interval before another
 * submission. A cap measured from submission START has already expired after
 * slow GPU work, so drawing again immediately can starve UI paint callbacks.
 * Poll once per animation-frame callback, using the real renderer's GPU gate.
 * This only schedules menu presentation; it never advances or samples a race.
 */
export class MenuFramePacing {
  static readonly quietMilliseconds = 1000 / 15;
  private owner: MenuFrameSource | null = null;
  private pending = false;
  private availableAt = -Infinity;
  private paintPending = false;
  private disposed = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  submittedFrame(source: MenuFrameSource): void {
    if (this.disposed) throw new Error('Menu frame pacing is disposed');
    if (this.owner !== source) this.reset();
    if (this.pending) throw new Error('A menu frame is already pending');
    this.owner = source;
    this.pending = true;
  }

  poll(source: MenuFrameSource): MenuFrameReadiness {
    if (this.disposed) return 'busy';
    // A replacement renderer cannot acknowledge the abandoned owner's frame.
    if (this.owner !== source) this.reset();
    if (!source.canSubmitFrame()) return 'busy';
    if (this.pending) {
      this.pending = false;
      this.availableAt = this.now() + MenuFramePacing.quietMilliseconds;
      this.paintPending = true;
      return 'completed';
    }
    // Leave the completion callback and at least one following callback clear
    // for UI painting, even if a slow browser callback exhausted the interval.
    if (this.paintPending) {
      this.paintPending = false;
      return 'quiet';
    }
    return this.now() >= this.availableAt ? 'ready' : 'quiet';
  }

  /** A new renderer must submit and complete its own initial menu frame. */
  reset(): void {
    this.owner = null;
    this.pending = false;
    this.availableAt = -Infinity;
    this.paintPending = false;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
