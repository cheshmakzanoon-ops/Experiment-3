import type * as T from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { H } from '../../simulation/protocol.ts';
import { AdaptiveExposurePass } from '../adaptive-exposure.ts';
import type { LightingMode } from '../daylight.ts';
import { METER_KEY } from '../exposure-meter.ts';
import { MotionBlur } from '../motion-blur.ts';
import type { GraphicsOptions } from '../options.ts';
import { SceneAmbientPass } from '../scene-ambient-pass.ts';
import { StudioFrame, studioUniforms } from '../studio/studio-frame.ts';

/** The festival's scene/depth pass and its frame-dependent image controls.
 * Keep the meter in linear HDR, before the caller adds bloom and OutputPass;
 * motion is gathered by the scene composite, using this frame's camera and
 * snapshot. The shared WebGL context does not imply shared frame history. */
export class FestivalFramePipeline {
  readonly scenePass: SceneAmbientPass;
  readonly exposure = new AdaptiveExposurePass();
  readonly motion: MotionBlur;
  readonly studioFrame = new StudioFrame();
  private reducedMotion = false;
  private disposed = false;

  constructor(
    private readonly renderer: T.WebGLRenderer,
    private readonly camera: T.PerspectiveCamera,
    private readonly sun: T.DirectionalLight,
    scene: T.Scene,
    composer: EffectComposer,
    graphics: GraphicsOptions,
  ) {
    this.motion = new MotionBlur(renderer.extensions.has('EXT_color_buffer_float'));
    this.scenePass = new SceneAmbientPass(scene, camera, graphics.msaa, this.motion, sun);
    composer.addPass(this.scenePass);
    composer.addPass(this.exposure);
    this.configure(graphics);
  }

  configure(graphics: GraphicsOptions) {
    if (this.disposed) return;
    this.scenePass.setSamples(Math.min(graphics.msaa, this.renderer.capabilities.maxSamples));
    this.scenePass.ambientOcclusion = graphics.ambientOcclusion;
    this.scenePass.temporal.enabled = graphics.temporalAA;
    this.motion.setStrength(this.reducedMotion ? 0 : graphics.motionBlur);
    this.reset();
  }

  prepare(
    presented: Float32Array,
    graphics: GraphicsOptions,
    lighting: LightingMode,
    view: string,
    vehicle: number,
    photo: boolean,
    cut: boolean,
    baseExposure: number,
    reducedMotion: boolean,
  ) {
    if (this.disposed) return;
    if (cut) this.reset();
    else if (reducedMotion !== this.reducedMotion) {
      this.studioFrame.reset();
      this.motion.reset();
      this.scenePass.temporal.reset();
    }
    this.reducedMotion = reducedMotion;
    const identity = `${lighting}:${view}:${vehicle}:${photo}`;
    this.studioFrame.update(presented, this.camera, this.sun, identity);
    // The festival's established onshore breeze also drives its leaf depth
    // materials; retain it after StudioFrame writes the snapshot weather.
    studioUniforms.studioWind.value.set(2.6, 1.4, presented[H.TIME], 0.5);
    this.motion.setStrength(reducedMotion ? 0 : graphics.motionBlur, !photo);
    this.motion.prepareFrame(
      presented,
      this.camera,
      0,
      photo ? 'still' : view === 'hood' || view === 'cockpit' ? 'cockpit' : 'chase',
    );
    this.renderer.toneMappingExposure = this.exposure.prepare(
      presented[H.TIME],
      identity,
      baseExposure,
      graphics.autoExposure && !photo,
      METER_KEY[lighting],
    );
  }

  reset() {
    this.exposure.reset();
    this.studioFrame.reset();
    this.motion.reset();
    this.scenePass.temporal.reset();
  }

  diagnostics() {
    return {
      motionBlur: this.motion.diagnostics(),
      automaticExposure: this.exposure.diagnostics(),
      studioFrame: this.studioFrame.diagnostics(),
      scenePass: this.scenePass.diagnostics(),
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.motion.dispose();
    this.exposure.dispose();
    this.scenePass.dispose();
  }
}
