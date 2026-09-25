import { H } from '../simulation/protocol.ts';
import { PresentedFrame } from './frame-state.ts';
import type { Effects } from './effects.ts';

// At most two seconds / 60 steps of particle work per rendered frame.
// Longer LIVE gaps reconstruct only the recent window, never the whole stall.
// Replay gaps remain discontinuities; explicit reset always discards old trails.
const MAX_CONTINUOUS_GAP = 2;
const MAX_EFFECT_STEP = 1 / 30;
/** Visual particle evolution follows the presented simulation clock, in both
 * live and replay views. Pauses cannot create smoke/rain from a stale snapshot.
 * Bounded substeps trace the moving emitter during slow/accelerated playback.
 * A discontinuous seek starts a fresh pool rather than drawing a teleport trail. */
export class EffectPlayback {
  private previous = new Float32Array(0);
  private sampled = new PresentedFrame();
  private time = NaN;
  private active = false;
  elapsed = 0;
  resets = 0;
  boundedCatchups = 0;
  omittedSeconds = 0;
  constructor(private effects: Effects) {}
  reset() {
    this.effects.clear();
    this.time = NaN;
    this.active = false;
    this.elapsed = 0;
    this.boundedCatchups = 0;
    this.omittedSeconds = 0;
    this.resets++;
  }
  update(frame: Float32Array, active = true, continuousLive = false) {
    this.effects.group.visible = active && this.effects.enabled;
    const time = frame[H.TIME];
    if (!Number.isFinite(time)) throw new Error('Invalid particle presentation time');
    if (!active) {
      if (this.active) this.reset();
      return;
    }
    const elapsed = time - this.time;
    const cut =
      !this.active ||
      this.previous.length !== frame.length ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      (!continuousLive && elapsed > MAX_CONTINUOUS_GAP);
    if (cut) {
      this.effects.clear();
      this.resets++;
      if (this.previous.length !== frame.length) this.previous = new Float32Array(frame.length);
      this.effects.update(frame, 0, false);
    } else if (elapsed > 0) {
      const duration = Math.min(elapsed, MAX_CONTINUOUS_GAP),
        omitted = elapsed - duration;
      if (omitted > 0) {
        // Do not mistake a slow live GPU for a replay seek and erase every frame.
        // Drop expired trails and seed cumulative work at the retained window's
        // start. Interpolation is presentation-only, not unseen physics history.
        this.effects.clear();
        this.effects.update(this.sampled.sample(this.previous, frame, omitted / elapsed), 0, false);
        this.boundedCatchups++;
        this.omittedSeconds += omitted;
      }
      const steps = Math.ceil(duration / MAX_EFFECT_STEP);
      for (let i = 1; i <= steps; i++) {
        const alpha = i === steps ? 1 : (omitted + (duration * i) / steps) / elapsed;
        const state = this.sampled.sample(this.previous, frame, alpha);
        this.effects.update(state, duration / steps, true);
      }
      this.elapsed += duration;
    }
    this.active = true;
    this.time = time;
    this.previous.set(frame);
  }
}
