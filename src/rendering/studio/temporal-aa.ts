import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { STUDIO_MAX_CARS, studioGlsl, studioUniforms } from './studio-frame.ts';
import { MOTION_BLUR } from './velocity.ts';

/**
 * Temporal anti-aliasing for High (post-motion, D05; opt-in `temporalAA`).
 *
 * The scene draw is jittered by a Halton(2,3) sequence of 8 sub-pixel offsets;
 * one resolve quad blends the current frame into a reprojected history. The
 * history is fetched where the surface was in the last successful resolve:
 * static world through that frame's jittered projection, cars through their
 * rigid chassis transforms (the same footprint boxes as the motion blur).
 * History alpha stores positive linear view depth; zero marks background.
 * Depth-incompatible history texels cannot enter the colour filter. Compatible
 * interiors retain Catmull-Rom; edges use valid bilinear taps with reduced
 * confidence, followed by the existing YCoCg variance clip and HDR blend.
 * SceneAmbientPass consumes RGB and restores opaque output alpha.
 *
 * This is depth rejection, not per-vertex velocity: deformation, transparent
 * particles and incorrectly classified chassis-box pixels remain approximate.
 *
 * Determinism: the jitter index advances only on frames whose presented time
 * advances (`studioFrameDt > 0`). Held, paused and photo frames, menus, cuts,
 * seeks and resizes render unjittered without history, so held frames stay
 * byte-identical and nothing accumulates across a cut.
 */
export const TEMPORAL_AA = Object.freeze({
  /** Halton(2,3) jitter period. */
  samples: 8,
  /** History weight at rest and at `movingPixels` of motion per frame or more:
   * resampling a moving history softens it, so moving pixels trust it less. */
  feedbackStill: 0.92,
  feedbackMoving: 0.7,
  movingPixels: 3,
  /** Variance clip width in standard deviations. */
  gamma: 1.1,
  /** History alpha is a view distance in metres, not nonlinear device depth.
   * Half-float rounding is at most 1/2048 of a normal positive value. */
  depthRelative: 0.002,
  depthAbsolute: 0.02,
  /** Both production far planes (7 km / 26 km) fit without clamping. */
  maxDepth: 65000,
  /** Conservative one-ULP spacing of the existing Float32 depth attachment. */
  depthUlp: 2 ** -24,
  /** Do not extrapolate a surface plane across a silhouette discontinuity. */
  maxDepthGradient: 0.02,
  edgeFeedback: 0.5,
  /** The original five bilinear Catmull-Rom taps cover these 12 point texels.
   * Read each once so depth is validated before any colour interpolation. */
  historyFetches: 12,
});

/** Positive view-depth error per squared metre for one device-depth ULP.
 * The source attachment, unlike the history, remains Float32 device depth. */
export function temporalDepthPrecision(near: number, far: number) {
  return TEMPORAL_AA.depthUlp * (1 / near - 1 / far);
}

/** CPU reference of the GLSL comparison, also used by precision/QA tooling. */
export function temporalDepthTolerance(
  expected: number,
  sourceError: number,
  previousPrecision: number,
) {
  return (
    Math.max(TEMPORAL_AA.depthAbsolute, expected * TEMPORAL_AA.depthRelative) +
    sourceError +
    expected * expected * previousPrecision
  );
}

/** Radical inverse of `index` (≥ 1) in `base`. */
export function halton(index: number, base: number) {
  let result = 0,
    fraction = 1 / base,
    i = Math.floor(index);
  while (i > 0) {
    result += (i % base) * fraction;
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
}

/** Sub-pixel jitter (pixels, each in [-0.5, 0.5)) for frame `index`. */
export function jitterOffset(index: number, out = new T.Vector2()) {
  const i =
    (((Math.floor(index) % TEMPORAL_AA.samples) + TEMPORAL_AA.samples) % TEMPORAL_AA.samples) + 1;
  return out.set(halton(i, 2) - 0.5, halton(i, 3) - 0.5);
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragment = /* glsl */ `
  ${studioGlsl(['studioCarCount', 'studioCarNow', 'studioCarPrev', 'studioCarPose'])}
  uniform sampler2D tColor;
  uniform sampler2D tHistory;
  uniform sampler2D tDepth;
  uniform mat4 projectionInverse;
  uniform mat4 cameraWorld;
  uniform mat4 previousViewProjection;
  uniform vec2 previousRange;
  uniform vec2 depthPrecision;
  uniform vec2 resolution;
  uniform float historyValid;
  uniform float feedbackStill;
  uniform float feedbackMoving;
  uniform float gamma;
  varying vec2 vUv;
  vec3 toYCoCg(vec3 c) {
    return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
  }
  vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
  // Luminance-weighted (Karis) space: bright speculars cannot dominate the blend.
  vec3 compress(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
  vec3 expand(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
  // Clamped to the HalfFloat range: compress(Inf) is NaN, which would reach the history.
  vec3 finiteColor(vec3 c) { return clamp(c, vec3(0.0), vec3(65000.0)); }
  vec3 sampleCurrent(vec2 uv) { return toYCoCg(compress(finiteColor(texture2D(tColor, uv).rgb))); }
  float depthTolerance(float expected, float sourceError) {
    return max(${TEMPORAL_AA.depthAbsolute.toFixed(3)}, expected * ${TEMPORAL_AA.depthRelative.toFixed(4)})
      + sourceError + expected * expected * depthPrecision.y;
  }
  // Point sampling is essential: interpolated foreground/background depths can
  // appear to match a surface that never existed in the previous image.
  vec4 historyTap(vec2 pixel, vec3 previous, vec2 inverseGradient, float sourceError, out float valid) {
    pixel = clamp(pixel, vec2(0.0), resolution - 1.0);
    vec4 tap = texelFetch(tHistory, ivec2(pixel), 0);
    float inverseDepth = 1.0 / previous.z + dot(inverseGradient, pixel + 0.5 - previous.xy * resolution);
    float expected = 1.0 / max(inverseDepth, 1e-8);
    valid = tap.a > 0.0 && expected >= previousRange.x && expected <= previousRange.y
      && abs(tap.a - expected) <= depthTolerance(expected, sourceError) ? 1.0 : 0.0;
    return tap;
  }
  // Identical interior kernel to the original five bilinear Catmull-Rom taps,
  // expanded to its 12 contributing texels so no incompatible depth is mixed.
  // If the footprint crosses an edge, only validated central bilinear taps remain.
  vec3 sampleHistory(vec3 previous, vec2 inverseGradient, float sourceError, out float confidence) {
    vec2 uv = previous.xy;
    vec2 position = uv * resolution;
    vec2 center = floor(position - 0.5) + 0.5;
    vec2 f = position - center, f2 = f * f, f3 = f2 * f;
    vec2 w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
    vec2 w2 = -1.5 * f3 + 2.0 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
    vec3 bilinear = vec3(0.0), sum = vec3(0.0);
    float weight = 0.0, complete = 1.0;
    confidence = 0.0;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
      float valid;
      vec3 color = historyTap(center - 0.5 + vec2(float(x), float(y)), previous, inverseGradient, sourceError, valid).rgb;
      float b = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y);
      float c = (x == 0 ? w1.x : w2.x) * (y == 0 ? w1.y : w2.y);
      bilinear += color * (b * valid);
      confidence += b * valid;
      complete *= valid;
      sum += color * c;
      weight += c;
    }
    if (confidence < 1e-5) { confidence = 0.0; return vec3(0.0); }
    bilinear /= confidence;
    if (complete < 0.5) {
      confidence *= ${TEMPORAL_AA.edgeFeedback.toFixed(2)};
      return toYCoCg(compress(finiteColor(bilinear)));
    }
    for (int side = 0; side < 2; side++) for (int i = 0; i < 2; i++) {
      float outside = side == 0 ? -1.0 : 2.0;
      float validX, validY;
      vec3 xTap = historyTap(center - 0.5 + vec2(outside, float(i)), previous, inverseGradient, sourceError, validX).rgb;
      vec3 yTap = historyTap(center - 0.5 + vec2(float(i), outside), previous, inverseGradient, sourceError, validY).rgb;
      float wx = (side == 0 ? w0.x : w3.x) * (i == 0 ? w1.y : w2.y);
      float wy = (side == 0 ? w0.y : w3.y) * (i == 0 ? w1.x : w2.x);
      sum += xTap * wx + yTap * wy;
      weight += wx + wy;
      complete *= validX * validY;
    }
    if (complete < 0.5) {
      confidence *= ${TEMPORAL_AA.edgeFeedback.toFixed(2)};
      return toYCoCg(compress(finiteColor(bilinear)));
    }
    return toYCoCg(compress(finiteColor(sum / weight)));
  }
  vec3 previousSurface(vec3 view) {
    vec3 world = (cameraWorld * vec4(view, 1.0)).xyz;
    for (int i = 0; i < STUDIO_MAX_CARS; i++) {
      if (i >= studioCarCount) break;
      vec3 footprint = studioCarPoseLocal(studioCarPose[i], world);
      if (abs(footprint.x) < STUDIO_CAR_HALF_WIDTH + ${MOTION_BLUR.boxMargin.toFixed(2)} &&
          abs(footprint.z) < STUDIO_CAR_HALF_LENGTH + ${MOTION_BLUR.boxMargin.toFixed(2)} &&
          footprint.y > ${MOTION_BLUR.boxFloor.toFixed(3)} && footprint.y < ${MOTION_BLUR.boxTop.toFixed(2)}) {
        world = (studioCarPrev[i] * vec4(studioRigidToLocal(studioCarNow[i], world), 1.0)).xyz;
        break;
      }
    }
    vec4 clip = previousViewProjection * vec4(world, 1.0);
    // Perspective clip.w is positive linear view distance. This projection
    // contains the PREVIOUS successful frame's jitter, never the current one.
    return vec3(clip.xy / max(clip.w, 1e-5) * 0.5 + 0.5, clip.w);
  }
  void main() {
    vec2 texel = 1.0 / resolution;
    vec3 current = sampleCurrent(vUv);
    float depth = texture2D(tDepth, vUv).x;
    vec4 homogeneous = projectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 view = homogeneous.xyz / homogeneous.w;
    float distance = -view.z;
    // Exact clear depth, not 0.99999: the latter erases kilometres of Festival.
    float storedDepth = depth < 1.0 && distance > 0.0 && distance <= ${TEMPORAL_AA.maxDepth.toFixed(1)} ? distance : 0.0;
    vec3 previous = previousSurface(view);
    // Reciprocal depth is planar in projected pixels. Use its local Jacobian
    // to compare each history tap at that tap's own position (sloping roads).
    // Evaluate derivatives before non-uniform early exits.
    vec2 dx = dFdx(previous.xy * resolution), dy = dFdy(previous.xy * resolution);
    float invDepth = 1.0 / max(previous.z, 1e-5);
    float zx = dFdx(invDepth), zy = dFdy(invDepth), determinant = dx.x * dy.y - dx.y * dy.x;
    vec2 gradient = abs(determinant) > 1e-5 ? vec2(zx * dy.y - zy * dx.y, zy * dx.x - zx * dy.x) / determinant : vec2(0.0);
    float planeReliable = max(abs(gradient.x), abs(gradient.y)) <= ${TEMPORAL_AA.maxDepthGradient.toFixed(3)} * invDepth ? 1.0 : 0.0;
    gradient *= planeReliable;
    if (historyValid < 0.5 || storedDepth == 0.0 || previous.z < previousRange.x || previous.z > previousRange.y
      || previous.x < 0.0 || previous.y < 0.0 || previous.x > 1.0 || previous.y > 1.0) {
      gl_FragColor = vec4(expand(fromYCoCg(current)), storedDepth);
      return;
    }
    float sourceError = distance * length(view) * depthPrecision.x;
    float confidence;
    vec3 history = sampleHistory(previous, gradient, sourceError, confidence);
    if (confidence <= 0.0) {
      gl_FragColor = vec4(expand(fromYCoCg(current)), storedDepth);
      return;
    }
    // Far-distance Float32 source-depth uncertainty cannot be repaired by a
    // higher-precision history. Reduce trust when that uncertainty dominates.
    confidence *= min(1.0, ${TEMPORAL_AA.depthRelative.toFixed(4)} * previous.z / max(sourceError + previous.z * previous.z * depthPrecision.y, 1e-6));
    confidence *= mix(${TEMPORAL_AA.edgeFeedback.toFixed(2)}, 1.0, planeReliable);
    // Neighbourhood moments (3x3) in YCoCg.
    vec3 m1 = current, m2 = current * current;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        vec3 c = sampleCurrent(vUv + vec2(float(i), float(j)) * texel);
        m1 += c;
        m2 += c * c;
      }
    m1 /= 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, vec3(0.0))) * gamma;
    // Clip the history toward the neighbourhood mean onto the variance box.
    vec3 offset = history - m1;
    vec3 units = abs(offset / max(sigma, vec3(1e-5)));
    float scale = max(units.x, max(units.y, units.z));
    if (scale > 1.0) history = m1 + offset / scale;
    float pixels = length((previous.xy - vUv) * resolution);
    float feedback = mix(feedbackStill, feedbackMoving, clamp(pixels / ${TEMPORAL_AA.movingPixels.toFixed(1)}, 0.0, 1.0));
    gl_FragColor = vec4(expand(fromYCoCg(mix(current, history, feedback * confidence))), storedDepth);
  }
`;

export class TemporalAA {
  /** The settings key; the pass also needs a live, advancing frame. */
  enabled = false;
  frames = 0;
  resets = 0;
  private readonly history: [T.WebGLRenderTarget, T.WebGLRenderTarget];
  private readonly material: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly offset = new T.Vector2();
  private index = 0;
  private valid = false;
  private active = false;
  private pending = false;
  private jitteredCamera: T.PerspectiveCamera | null = null;
  private previousCamera: T.PerspectiveCamera | null = null;
  private readonly unjittered = new T.Matrix4();
  private readonly unjitteredInverse = new T.Matrix4();
  private readonly jitteredProjection = new T.Matrix4();
  private readonly jitteredInverse = new T.Matrix4();
  private readonly previousViewProjection = new T.Matrix4();
  private readonly previousCars = Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4());
  private readonly previousRange = new T.Vector2(0.1, 1000);
  private previousPrecision = temporalDepthPrecision(0.1, 1000);
  private width = 1;
  private height = 1;
  private disposed = false;
  constructor() {
    const target = () =>
      new T.WebGLRenderTarget(1, 1, {
        type: T.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
      });
    this.history = [target(), target()];
    this.history[0].texture.name = this.history[1].texture.name = 'APEX temporal history';
    const u = studioUniforms;
    this.material = new T.ShaderMaterial({
      name: 'APEX temporal resolve',
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        projectionInverse: { value: this.jitteredInverse },
        previousViewProjection: { value: this.previousViewProjection },
        previousRange: { value: this.previousRange },
        depthPrecision: { value: new T.Vector2() },
        cameraWorld: { value: new T.Matrix4() },
        resolution: { value: new T.Vector2(1, 1) },
        historyValid: { value: 0 },
        feedbackStill: { value: TEMPORAL_AA.feedbackStill },
        feedbackMoving: { value: TEMPORAL_AA.feedbackMoving },
        gamma: { value: TEMPORAL_AA.gamma },
        // Bound by identity: render-core's StudioFrame writes them each frame.
        studioCarCount: u.studioCarCount,
        studioCarNow: u.studioCarNow,
        // Capture only after a successful resolve. Shared StudioFrame previous
        // matrices may have advanced even when a scene/stage draw failed.
        studioCarPrev: { value: this.previousCars },
        studioCarPose: u.studioCarPose,
      },
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(width: number, height: number) {
    if (![width, height].every(Number.isFinite)) throw new Error('Invalid temporal AA size');
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    for (const target of this.history) target.setSize(this.width, this.height);
    this.material.uniforms.resolution.value.set(this.width, this.height);
    this.reset();
  }
  /** Jitter index of the current (or last) resolved frame. */
  get jitterIndex() {
    return this.index;
  }
  /** This frame is jittered and resolved (read after the scene pass began it). */
  get resolving() {
    return this.active;
  }
  /** Cut, seek, resize or settings change: the next frame starts a new history. */
  reset() {
    this.valid = false;
    this.resets++;
  }
  /**
   * Before the scene draw. `live` is false for menu, photo and paused replay;
   * `frameDt` is StudioFrame's presented step (0 when held or cut).
   * Returns whether this frame is jittered and resolved.
   */
  begin(camera: T.PerspectiveCamera, live: boolean, frameDt = studioUniforms.studioFrameDt.value) {
    // A scene/stage failure can leave an unfinished frame. Its projection and
    // object state must never be paired with an older published history.
    if (this.jitteredCamera) this.end(this.jitteredCamera);
    if (this.pending || (this.previousCamera && this.previousCamera !== camera)) this.reset();
    this.pending = false;
    const advancing = Number.isFinite(frameDt) && frameDt > 0;
    // The production scene/depth pipeline is conventional WebGL perspective.
    // Refuse unsupported projections instead of silently corrupting history.
    const supported =
      camera.isPerspectiveCamera &&
      camera.coordinateSystem === T.WebGLCoordinateSystem &&
      !camera.reversedDepth &&
      camera.near > 0 &&
      camera.far > camera.near &&
      camera.far <= TEMPORAL_AA.maxDepth;
    this.active = !this.disposed && this.enabled && live && advancing && supported;
    if (!this.active) {
      // Held frames render exactly as without TAA; the next advancing frame restarts.
      if (this.valid) this.reset();
      return false;
    }
    this.index = (this.index + 1) % TEMPORAL_AA.samples;
    jitterOffset(this.index, this.offset);
    this.unjittered.copy(camera.projectionMatrix);
    this.unjitteredInverse.copy(camera.projectionMatrixInverse);
    const p = camera.projectionMatrix.elements;
    p[8] += (2 * this.offset.x) / this.width;
    p[9] += (2 * this.offset.y) / this.height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jitteredProjection.copy(camera.projectionMatrix);
    this.jitteredInverse.copy(camera.projectionMatrixInverse);
    this.jitteredCamera = camera;
    this.pending = true;
    return true;
  }
  /** After the scene draw: restore the unjittered projection. */
  end(camera: T.PerspectiveCamera) {
    if (this.jitteredCamera !== camera) return;
    camera.projectionMatrix.copy(this.unjittered);
    camera.projectionMatrixInverse.copy(this.unjitteredInverse);
    this.jitteredCamera = null;
  }
  /** Resolve the jittered scene colour into the history; returns the image the
   * composite reads, or `color` itself when inactive. One full-screen quad. */
  resolve(
    renderer: T.WebGLRenderer,
    camera: T.PerspectiveCamera,
    color: T.Texture,
    depth: T.Texture,
  ): T.Texture {
    if (!this.active) return color;
    // Resolving the same presented frame twice is not a second history sample.
    if (!this.pending) return this.history[0].texture;
    const u = this.material.uniforms;
    const [read, write] = this.history;
    u.tColor.value = color;
    u.tDepth.value = depth;
    u.tHistory.value = read.texture;
    u.historyValid.value = this.valid ? 1 : 0;
    const precision = temporalDepthPrecision(camera.near, camera.far);
    u.depthPrecision.value.set(precision, this.previousPrecision);
    u.cameraWorld.value.copy(camera.matrixWorld);
    try {
      renderer.setRenderTarget(write);
      this.quad.render(renderer);
    } catch (error) {
      this.reset();
      this.active = false;
      this.pending = false;
      throw error;
    }
    this.history.reverse();
    this.previousViewProjection.multiplyMatrices(
      this.jitteredProjection,
      camera.matrixWorldInverse,
    );
    this.previousRange.set(camera.near, camera.far);
    this.previousPrecision = precision;
    for (let i = 0; i < STUDIO_MAX_CARS; i++)
      this.previousCars[i].copy(studioUniforms.studioCarNow.value[i]);
    this.previousCamera = camera;
    this.valid = true;
    this.pending = false;
    this.frames++;
    return write.texture;
  }
  diagnostics() {
    return {
      enabled: this.enabled,
      active: this.active,
      frames: this.frames,
      resets: this.resets,
      index: this.index,
      jitter: this.offset.toArray(),
      extraDraws: this.active ? 1 : 0,
      historyValid: this.valid,
      historyDepth: 'linear-view-metres-in-alpha',
      historyFetches: TEMPORAL_AA.historyFetches,
      /** Two RGBA16F targets, unchanged by depth rejection. No depth attachment. */
      historyBytes: this.width * this.height * 8 * 2,
    };
  }
  dispose() {
    if (this.disposed) return;
    if (this.jitteredCamera) this.end(this.jitteredCamera);
    this.disposed = true;
    this.enabled = false;
    this.active = false;
    this.pending = false;
    this.valid = false;
    for (const target of this.history) target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
