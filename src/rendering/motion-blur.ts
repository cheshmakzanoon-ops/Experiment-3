import type * as T from 'three';
import { studioUniforms } from './studio/studio-frame.ts';
import {
  MOTION_BLUR,
  MotionField,
  motionCameraFor,
  shutterSeconds,
  type MotionCamera,
} from './studio/velocity.ts';

/**
 * Camera motion blur by depth reprojection (post-motion, D05).
 *
 * This object only decides *whether* and *how far* the frame streaks; the
 * streak itself is gathered inside the SceneAmbientPass composite from the
 * scene's own colour and depth (12 depth-gated taps, at most 3.5 % of the
 * width), so motion blur costs no scene re-render and no extra draw call.
 * Velocities come from the presented snapshot (see studio/velocity.ts): the
 * blur is identical at any frame rate, held frames are byte-identical, and the
 * followed car is locked to the camera. The HTML HUD is outside the canvas.
 * Photo, menu and a held replay frame are still (no streak).
 */
export class MotionBlur {
  readonly field = new MotionField();
  readonly uniforms = this.field.uniforms;
  enabled = false;
  velocityFrames = 0;
  resets = 0;
  private amount = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  constructor(readonly supported: boolean) {}
  setStrength(value: number) {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(MOTION_BLUR.maxStrength, value)) : 0;
    if (next !== this.amount) this.reset();
    this.amount = next;
    this.enabled = !this.disposed && this.supported && next > 0;
    if (!this.enabled) this.field.still();
  }
  /** Camera cut, seek or resize. Velocities carry no frame history, so there
   * is nothing to invalidate; the counter is kept for diagnostics. */
  reset() {
    this.resets++;
  }
  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.uniforms.motionMaxPixels.value = MOTION_BLUR.maxWidth * this.width;
    this.reset();
  }
  /**
   * Called once per frame after the camera solve and StudioFrame update.
   * `view` is the renderer camera mode ('still' for menu and photo); `replay`
   * marks recorded playback, whose paused frames do not streak: StudioFrame
   * reports a held or cut frame as `studioFrameDt == 0`. A paused live session
   * keeps the streak of its frozen instant, as the frame on screen did.
   */
  prepareFrame(
    presented: Float32Array,
    camera: T.Camera,
    follow: number,
    view: string,
    replay = false,
    frameDt = studioUniforms.studioFrameDt.value,
  ) {
    const held = replay && !(frameDt > 0);
    const model: MotionCamera = this.enabled && !held ? motionCameraFor(view) : 'still';
    if (model === 'still') return this.field.still();
    this.field.update(presented, camera, follow, model, shutterSeconds(this.amount));
  }
  /** The composite ran with the blur enabled (whether or not anything moved). */
  rendered() {
    if (this.enabled) this.velocityFrames++;
  }
  diagnostics() {
    return {
      supported: this.supported,
      active: this.enabled,
      strength: this.amount,
      velocityFrames: this.velocityFrames,
      resets: this.resets,
      width: this.width,
      height: this.height,
      maximumPixels: this.uniforms.motionMaxPixels.value,
      taps: MOTION_BLUR.taps,
      shutterSeconds: shutterSeconds(this.amount),
      camera: this.field.camera,
      cars: this.uniforms.motionActive.value ? this.uniforms.motionCars.value : 0,
      extraDraws: 0,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.field.still();
  }
}
