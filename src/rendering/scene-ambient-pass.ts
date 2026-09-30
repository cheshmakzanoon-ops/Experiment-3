import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Scalable ambient obscurance tuning. World-space radius in metres; the screen
 * radius is clamped so a cockpit surface 30 cm from the eye cannot black out. */
export interface AmbientOcclusionSettings {
  radius: number;
  intensity: number;
  bias: number;
  maxPixels: number;
  fadeStart: number;
  fadeEnd: number;
}
export const AMBIENT_OCCLUSION: Readonly<AmbientOcclusionSettings> = Object.freeze({
  radius: 0.9,
  intensity: 1.15,
  bias: 0.012,
  maxPixels: 72,
  fadeStart: 90,
  fadeEnd: 220,
});

/** Half-resolution obscurance buffer; never below one pixel. */
export function obscuranceSize(width: number, height: number) {
  if (![width, height].every(Number.isFinite)) throw new Error('Invalid obscurance size');
  return {
    width: Math.max(1, Math.ceil(Math.max(1, width) / 2)),
    height: Math.max(1, Math.ceil(Math.max(1, height) / 2)),
  };
}

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const viewPosition = /* glsl */ `
  #include <packing>
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform vec2 projectionScale;
  float sceneDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
  float viewZAt(vec2 uv) { return perspectiveDepthToViewZ(sceneDepth(uv), cameraNear, cameraFar); }
  vec3 viewAt(vec2 uv) {
    float z = viewZAt(uv);
    return vec3((uv * 2.0 - 1.0) * -z / projectionScale, z);
  }
`;
const obscuranceFragment = /* glsl */ `
  ${viewPosition}
  uniform vec2 resolution;
  uniform float radius;
  uniform float intensity;
  uniform float bias;
  uniform float maxPixels;
  uniform float fadeStart;
  uniform float fadeEnd;
  varying vec2 vUv;
  #define SAMPLES 14
  #define TURNS 7.0
  void main() {
    float depth = sceneDepth(vUv);
    if (depth >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewAt(vUv);
    vec2 texel = 1.0 / resolution;
    // Reconstruct the facet normal from the least-discontinuous neighbours so
    // silhouettes against distant scenery do not produce halo normals.
    vec3 pr = viewAt(vUv + vec2(texel.x, 0.0)), pl = viewAt(vUv - vec2(texel.x, 0.0));
    vec3 pu = viewAt(vUv + vec2(0.0, texel.y)), pd = viewAt(vUv - vec2(0.0, texel.y));
    vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
    vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
    vec3 n = normalize(cross(dx, dy));
    if (dot(n, p) > 0.0) n = -n;
    float distanceFade = 1.0 - smoothstep(fadeStart, fadeEnd, -p.z);
    if (distanceFade <= 0.0) { gl_FragColor = vec4(1.0); return; }
    // Near surfaces shrink their world radius; distant ones keep it.
    float worldRadius = min(radius, max(0.06, -p.z * 0.35));
    float pixels = min(maxPixels, worldRadius * projectionScale.y * resolution.y * 0.5 / -p.z);
    if (pixels < 1.0) { gl_FragColor = vec4(1.0); return; }
    // Interleaved gradient noise: stable per pixel, never wall-clock animated.
    vec2 pixel = floor(vUv * resolution);
    float rotation = 6.2831853 * fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    float r2 = worldRadius * worldRadius;
    float sum = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float alpha = (float(i) + 0.5) / float(SAMPLES);
      float angle = alpha * TURNS * 6.2831853 + rotation;
      vec2 offset = vec2(cos(angle), sin(angle)) * alpha * pixels * texel;
      vec2 uv = vUv + offset;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      vec3 v = viewAt(uv) - p;
      float vv = dot(v, v);
      float vn = dot(v, n);
      float f = max(r2 - vv, 0.0);
      sum += f * f * f * max((vn - bias * -p.z) / (0.01 * r2 + vv), 0.0);
    }
    float obscurance = sum * intensity * 5.0 / (float(SAMPLES) * r2 * r2 * r2);
    float ao = clamp(1.0 - obscurance, 0.0, 1.0);
    ao = mix(1.0, ao, distanceFade);
    gl_FragColor = vec4(vec3(ao), 1.0);
  }
`;
const blurFragment = /* glsl */ `
  ${viewPosition}
  uniform sampler2D tObscurance;
  uniform vec2 direction;
  varying vec2 vUv;
  void main() {
    float z = viewZAt(vUv);
    float sum = texture2D(tObscurance, vUv).r;
    float weight = 1.0;
    float tolerance = max(0.05, -z * 0.04);
    for (int i = -3; i <= 3; i++) {
      if (i == 0) continue;
      vec2 uv = vUv + direction * float(i);
      float w = exp(-float(i * i) / 8.0) * (1.0 - smoothstep(0.0, tolerance, abs(viewZAt(uv) - z)));
      sum += texture2D(tObscurance, uv).r * w;
      weight += w;
    }
    gl_FragColor = vec4(vec3(sum / weight), 1.0);
  }
`;
const compositeFragment = /* glsl */ `
  ${viewPosition}
  uniform sampler2D tColor;
  uniform sampler2D tObscurance;
  uniform vec2 obscuranceResolution;
  uniform float enabled;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(tColor, vUv);
    if (enabled < 0.5) { gl_FragColor = color; return; }
    // Joint-bilateral upsample: prefer half-resolution texels on the same surface.
    float z = viewZAt(vUv);
    vec2 grid = vUv * obscuranceResolution - 0.5;
    vec2 base = floor(grid), f = grid - base;
    float sum = 0.0, weight = 0.0;
    for (int j = 0; j < 2; j++)
      for (int i = 0; i < 2; i++) {
        vec2 uv = (base + vec2(float(i), float(j)) + 0.5) / obscuranceResolution;
        float bilinear = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
        float w = bilinear / (0.002 + abs(viewZAt(uv) - z) / max(0.1, -z));
        sum += texture2D(tObscurance, uv).r * w;
        weight += w;
      }
    float ao = weight > 0.0 ? sum / weight : 1.0;
    // Obscurance occludes indirect light; very bright direct highlights keep more energy.
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb *= mix(ao, 1.0, clamp(luminance * 0.12, 0.0, 0.45));
    gl_FragColor = color;
  }
`;

/** Renders the linear scene into an optionally multisampled target with a float
 * depth attachment, then composites half-resolution depth-only ambient obscurance.
 * It replaces RenderPass without a second geometry draw; disabling AO is a copy. */
export class SceneAmbientPass extends Pass {
  readonly target: T.WebGLRenderTarget;
  private obscurance: T.WebGLRenderTarget;
  private blurred: T.WebGLRenderTarget;
  private obscuranceMaterial: T.ShaderMaterial;
  private blurMaterial: T.ShaderMaterial;
  private compositeMaterial: T.ShaderMaterial;
  private quad = new FullScreenQuad();
  private width = 1;
  private height = 1;
  ambientOcclusion = true;
  frames = 0;
  constructor(
    private scene: T.Scene,
    private camera: T.PerspectiveCamera,
    samples = 0,
  ) {
    super();
    this.needsSwap = true;
    const depthTexture = new T.DepthTexture(1, 1, T.FloatType);
    depthTexture.minFilter = depthTexture.magFilter = T.NearestFilter;
    this.target = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    this.target.texture.name = 'APEX linear scene (multisampled)';
    const small = () =>
      new T.WebGLRenderTarget(1, 1, {
        type: T.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
      });
    this.obscurance = small();
    this.blurred = small();
    const shared = () => ({
      tDepth: { value: depthTexture as T.Texture },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      projectionScale: { value: new T.Vector2(1, 1) },
    });
    const material = (name: string, fragmentShader: string, uniforms: Record<string, T.IUniform>) =>
      new T.ShaderMaterial({
        name,
        vertexShader: fullscreenVertex,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: T.NoBlending,
        toneMapped: false,
      });
    this.obscuranceMaterial = material('APEX scalable ambient obscurance', obscuranceFragment, {
      ...shared(),
      resolution: { value: new T.Vector2(1, 1) },
      radius: { value: AMBIENT_OCCLUSION.radius },
      intensity: { value: AMBIENT_OCCLUSION.intensity },
      bias: { value: AMBIENT_OCCLUSION.bias },
      maxPixels: { value: AMBIENT_OCCLUSION.maxPixels },
      fadeStart: { value: AMBIENT_OCCLUSION.fadeStart },
      fadeEnd: { value: AMBIENT_OCCLUSION.fadeEnd },
    });
    this.blurMaterial = material('APEX depth-aware obscurance blur', blurFragment, {
      ...shared(),
      tObscurance: { value: null },
      direction: { value: new T.Vector2(1, 0) },
    });
    this.compositeMaterial = material('APEX obscurance composite', compositeFragment, {
      ...shared(),
      tColor: { value: this.target.texture },
      tObscurance: { value: this.blurred.texture },
      obscuranceResolution: { value: new T.Vector2(1, 1) },
      enabled: { value: 1 },
    });
  }
  get samples() {
    return this.target.samples;
  }
  setSamples(samples: number) {
    if (samples === this.target.samples) return;
    // Sample count is immutable per framebuffer; release it so Three re-creates it.
    this.target.samples = samples;
    this.target.dispose();
  }
  override setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.target.setSize(this.width, this.height);
    const small = obscuranceSize(this.width, this.height);
    this.obscurance.setSize(small.width, small.height);
    this.blurred.setSize(small.width, small.height);
    this.obscuranceMaterial.uniforms.resolution.value.set(small.width, small.height);
    this.compositeMaterial.uniforms.obscuranceResolution.value.set(small.width, small.height);
  }
  private syncCamera() {
    for (const m of [this.obscuranceMaterial, this.blurMaterial, this.compositeMaterial]) {
      m.uniforms.cameraNear.value = this.camera.near;
      m.uniforms.cameraFar.value = this.camera.far;
      m.uniforms.projectionScale.value.set(
        this.camera.projectionMatrix.elements[0],
        this.camera.projectionMatrix.elements[5],
      );
    }
  }
  override render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget) {
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
      const occlude = this.ambientOcclusion;
      if (occlude) {
        this.syncCamera();
        this.quad.material = this.obscuranceMaterial;
        renderer.setRenderTarget(this.obscurance);
        this.quad.render(renderer);
        const small = this.obscuranceMaterial.uniforms.resolution.value as T.Vector2;
        this.quad.material = this.blurMaterial;
        this.blurMaterial.uniforms.tObscurance.value = this.obscurance.texture;
        this.blurMaterial.uniforms.direction.value.set(1 / small.x, 0);
        renderer.setRenderTarget(this.blurred);
        this.quad.render(renderer);
        this.blurMaterial.uniforms.tObscurance.value = this.blurred.texture;
        this.blurMaterial.uniforms.direction.value.set(0, 1 / small.y);
        renderer.setRenderTarget(this.obscurance);
        this.quad.render(renderer);
        this.compositeMaterial.uniforms.tObscurance.value = this.obscurance.texture;
      }
      this.compositeMaterial.uniforms.enabled.value = occlude ? 1 : 0;
      this.quad.material = this.compositeMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
      this.frames++;
    } finally {
      renderer.autoClear = autoClear;
    }
  }
  diagnostics() {
    return {
      samples: this.target.samples,
      ambientOcclusion: this.ambientOcclusion,
      width: this.width,
      height: this.height,
      obscuranceWidth: this.obscurance.width,
      obscuranceHeight: this.obscurance.height,
      frames: this.frames,
    };
  }
  override dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.obscurance.dispose();
    this.blurred.dispose();
    this.obscuranceMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}
