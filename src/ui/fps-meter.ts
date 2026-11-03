/** A frame-rate readout for the settings screen. It counts the frames the window really
 * delivers (requestAnimationFrame), over a one-second window, and reports the average and the
 * 1% low (the slowest frame in a hundred, as a rate). While the settings screen is open the
 * game is not drawing its own scene, so this measures the window and the machine's load,
 * not the cost of a race: the screen says so beside the figure. Pure maths below; the
 * meter itself only wires the clock. */
export interface FpsStats {
  /** Average frames per second over the samples. */
  fps: number;
  /** The rate of the slowest 1% of frames (at least the single slowest frame). */
  low: number;
  frames: number;
}
export function fpsStats(deltasMs: readonly number[]): FpsStats | null {
  const clean = deltasMs.filter((d) => Number.isFinite(d) && d > 0 && d < 2000);
  if (clean.length < 2) return null;
  const total = clean.reduce((a, b) => a + b, 0);
  const sorted = [...clean].sort((a, b) => b - a);
  const worst = sorted.slice(0, Math.max(1, Math.ceil(clean.length * 0.01)));
  const worstMs = worst.reduce((a, b) => a + b, 0) / worst.length;
  return { fps: (clean.length * 1000) / total, low: 1000 / worstMs, frames: clean.length };
}

export class FpsMeter {
  private frame = 0;
  private last = 0;
  private samples: number[] = [];
  private windowStart = 0;
  private running = false;
  constructor(private readonly onUpdate: (stats: FpsStats | null) => void) {}
  start() {
    if (this.running || typeof requestAnimationFrame !== 'function') return;
    this.running = true;
    this.last = 0;
    this.samples = [];
    this.frame = requestAnimationFrame(this.tick);
  }
  stop() {
    this.running = false;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
  }
  private tick = (now: number) => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden) {
      // A hidden tab is throttled by the browser: that is not a frame rate.
      this.last = 0;
      this.samples = [];
      return;
    }
    if (this.last) this.samples.push(now - this.last);
    this.last = now;
    if (!this.windowStart) this.windowStart = now;
    if (now - this.windowStart >= 1000) {
      this.onUpdate(fpsStats(this.samples));
      this.samples = [];
      this.windowStart = now;
    }
  };
}
