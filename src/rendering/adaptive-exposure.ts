import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ExposureAdaptation, readExposureMeter } from './exposure-meter.ts';

/** Measures the actual linear scene before bloom/output conversion. One 16x12
 * draw, at most four times per simulated second, with one async read in flight.
 * Disabled/photo/menu views perform no GPU measurement or adaptation. */
export class AdaptiveExposurePass extends Pass {
  readonly adaptation = new ExposureAdaptation();
  private readonly target = new T.WebGLRenderTarget(16, 12, {
    depthBuffer: false,
    stencilBuffer: false,
    type: T.UnsignedByteType,
    minFilter: T.NearestFilter,
    magFilter: T.NearestFilter,
  });
  private readonly material = new T.ShaderMaterial({
    uniforms: { tScene: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      uniform sampler2D tScene;
      varying vec2 vUv;
      void main() {
        // Meter the road/car region, not the extreme sky or letterbox edges.
        vec2 p = vec2(mix(.18,.82,vUv.x), mix(.12,.66,vUv.y));
        vec3 rgb = texture2D(tScene,p).rgb;
        float lum = dot(max(rgb,vec3(0.)),vec3(.2126,.7152,.0722));
        float encoded = clamp((log2(max(lum,exp2(-12.)))+12.)/24.,0.,1.);
        gl_FragColor = vec4(encoded,0.,0.,1.);
      }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly quad = new FullScreenQuad(this.material);
  private time = 0;
  private viewIdentity = '';
  private lastSample = -Infinity;
  private baseExposure = 1;
  private active = false;
  private pending = false;
  private disposed = false;
  failedReads = 0;
  lastError: string | null = null;
  constructor() {
    super();
    this.needsSwap = false;
    this.target.texture.colorSpace = T.NoColorSpace;
    this.target.texture.generateMipmaps = false;
  }
  prepare(time: number, identity: string, baseExposure: number, active: boolean) {
    if (!Number.isFinite(baseExposure) || baseExposure <= 0)
      throw new Error('Invalid base exposure');
    if (this.active !== (active && !this.disposed)) this.reset();
    const generation = this.adaptation.generation;
    const sameLighting =
      identity.includes(':') && identity.split(':')[0] === this.viewIdentity.split(':')[0];
    if (
      this.active &&
      active &&
      identity !== this.viewIdentity &&
      sameLighting &&
      time >= this.time &&
      time - this.time <= 2
    )
      this.adaptation.reframe(identity);
    this.viewIdentity = identity;
    this.time = time;
    this.baseExposure = baseExposure;
    this.active = active && !this.disposed;
    const multiplier = this.adaptation.step(time, identity, this.active);
    if (generation !== this.adaptation.generation) this.lastSample = -Infinity;
    return baseExposure * multiplier;
  }
  override render(
    renderer: T.WebGLRenderer,
    _write: T.WebGLRenderTarget,
    read: T.WebGLRenderTarget,
  ) {
    if (
      !this.active ||
      this.pending ||
      this.time - this.lastSample < 0.25 ||
      renderer.getContext().isContextLost()
    )
      return;
    this.lastSample = this.time;
    const generation = this.adaptation.generation,
      base = this.baseExposure;
    const previous = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const pixels = new Uint8Array(16 * 12 * 4);
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      // Render-target viewport/scissor are physical pixels. Calling setViewport
      // here would multiply by the canvas pixel ratio and crop the meter.
      this.material.uniforms.tScene.value = read.texture;
      this.quad.render(renderer);
      this.pending = true;
      // No synchronous readPixels stall and no unbounded queue of GPU requests.
      const readback = renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 16, 12, pixels);
      // r180 keeps its PBO bound while awaiting the fence. Release the binding
      // now so unrelated synchronous readPixels calls remain legal this frame.
      // Three rebinds its owned PBO before getBufferSubData when the fence settles.
      const gl = renderer.getContext();
      if ('PIXEL_PACK_BUFFER' in gl) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      void readback
        .then(() => {
          if (this.disposed || !this.active || generation !== this.adaptation.generation) return;
          const observation = readExposureMeter(pixels);
          if (observation)
            this.adaptation.observe(
              observation.logLuminance,
              base,
              generation,
              observation.highlightLogLuminance,
            );
        })
        .catch((error: unknown) => {
          if (!this.disposed) {
            this.failedReads++;
            this.lastError = error instanceof Error ? error.message : String(error);
          }
        })
        .finally(() => {
          this.pending = false;
          if (this.disposed) this.target.dispose();
        });
    } catch (error) {
      this.pending = false;
      this.failedReads++;
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      renderer.setRenderTarget(previous, face, mip);
      renderer.autoClear = autoClear;
    }
  }
  reset() {
    this.adaptation.reset();
    this.viewIdentity = '';
    this.lastSample = -Infinity;
  }
  diagnostics() {
    return {
      active: this.active,
      ev: this.adaptation.ev,
      targetEV: this.adaptation.targetEV,
      samples: this.adaptation.samples,
      pending: this.pending,
      failedReads: this.failedReads,
      lastError: this.lastError,
      samplePixels: 192,
      maximumSampleHz: 4,
    };
  }
  override dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.reset();
    // An outstanding async read owns its render target until its fence settles.
    if (!this.pending) this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
