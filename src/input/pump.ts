/** Poll input on its own timer, not on delivered WebGL frames. A busy rendering
 * frame can still block the browser thread; the worker's stale-input safety
 * remains in place for that case. This does not synthesize heartbeats or inputs. */
export class InputPump {
  private handle: ReturnType<typeof setInterval> | null = null;
  private previous = 0;
  private generation = 0;
  private polling = false;
  ticks = 0;
  constructor(
    private sample: (dt: number) => void,
    private now: () => number = () => performance.now(),
  ) {}
  start() {
    if (this.handle !== null) return;
    this.previous = this.now();
    const generation = ++this.generation;
    this.handle = setInterval(() => {
      if (generation === this.generation) this.poll();
    }, 1000 / 60);
  }
  /** An immediate sample belongs to the current run. Action handlers can stop
   * or restart that run, but cannot recursively publish another sample. */
  poll() {
    if (this.handle === null || this.polling) return;
    this.polling = true;
    try {
      const now = this.now();
      const dt = Math.max(0, Math.min(0.25, (now - this.previous) / 1000));
      this.previous = now;
      this.ticks++;
      this.sample(dt);
    } finally {
      this.polling = false;
    }
  }
  dispose() {
    if (this.handle !== null) clearInterval(this.handle);
    this.handle = null;
  }
}
