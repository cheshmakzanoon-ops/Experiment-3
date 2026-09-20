import { H } from '../simulation/protocol.ts';
import { PresentedFrame } from './frame-state.ts';
import type { Effects } from './effects.ts';

// A slow display is not a seek. Integrate up to two observed simulation seconds
// in at most 60 bounded substeps; explicit seek/reset still discards old trails.
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
  constructor(private effects: Effects) {}
  reset() {
    this.effects.clear();
    this.time = NaN;
    this.active = false;
    this.elapsed = 0;
    this.resets++;
  }
  update(frame: Float32Array, active = true) {
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
      elapsed > MAX_CONTINUOUS_GAP;
    if (cut) {
      this.effects.clear();
      this.resets++;
      if (this.previous.length !== frame.length) this.previous = new Float32Array(frame.length);
      this.effects.update(frame, 0, false);
    } else if (elapsed > 0) {
      const steps = Math.ceil(elapsed / MAX_EFFECT_STEP);
      for (let i = 1; i <= steps; i++) {
        const state = this.sampled.sample(this.previous, frame, i / steps);
        this.effects.update(state, elapsed / steps, true);
      }
      this.elapsed += elapsed;
    }
    this.active = true;
    this.time = time;
    this.previous.set(frame);
  }
}
