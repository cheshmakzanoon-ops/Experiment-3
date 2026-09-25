import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp } from '../core/math.ts';

/** One world-space sun direction for the visible disk, illumination and shadows. */
export const SUN_OFFSET = Object.freeze(new T.Vector3(-160, 190, -130));
export const SUNSET_OFFSET = Object.freeze(new T.Vector3(-215, 28, -150));
export type LightingMode = 'day' | 'sunset' | 'night';
export function lightingMode(value: boolean | LightingMode): LightingMode {
  if (value === true) return 'night';
  if (value === false) return 'day';
  if (value === 'day' || value === 'sunset' || value === 'night') return value;
  throw new Error('Invalid circuit lighting mode');
}
export function lightingDirection(mode: boolean | LightingMode) {
  return lightingMode(mode) === 'sunset' ? SUNSET_OFFSET : SUN_OFFSET;
}
function basis(direction: T.Vector3) {
  const forward = direction.clone().normalize(),
    right = new T.Vector3(0, 1, 0).cross(forward).normalize();
  return { forward, right, up: forward.clone().cross(right).normalize() };
}
const dayBasis = basis(SUN_OFFSET),
  sunsetBasis = basis(SUNSET_OFFSET);

/** Authored daylight response, not measured exposure/meteorological calibration.
 * Diffuse fill is deliberately subordinate to direct light: the previous bright
 * hemisphere plus IBL lit recesses almost as strongly as exposed bodywork. */
export function daylightState(cloud: number, rain: number) {
  if (![cloud, rain].every(Number.isFinite)) throw new Error('Non-finite daylight state');
  const cover = clamp(cloud, 0, 1),
    precipitation = clamp(rain, 0, 60),
    storm = precipitation / 60;
  return {
    cover,
    sun: 4.2 * (1 - 0.94 * cover ** 1.45),
    fill: 0.26 + cover * 0.34,
    environment: 0.28 - cover * 0.07,
    exposure: 0.9 + cover * 0.1,
    turbidity: 2.8 + cover * 5,
    // Normalize the analytic skydome before the shared scene tone map; keeping
    // its native radiance washed the entire clear sky and reflected paint white.
    skyRadiance: 0.32 + cover * 0.2,
    fogDensity: 0.00025 + cover * 0.00012 + precipitation * 0.000026,
    fogRed: 0.55 - cover * 0.12 - storm * 0.06,
    fogGreen: 0.65 - cover * 0.12 - storm * 0.055,
    fogBlue: 0.76 - cover * 0.12 - storm * 0.045,
  };
}

/** Shared circuit/night profile for the renderer and its evidence fixtures.
 * This is authored exposure, not a claim of calibrated real-world photometry.
 * Keep a low ambient floor so unlit carbon remains readable between mast pools. */
export function circuitLightState(
  cloud: number,
  rain: number,
  value: boolean | LightingMode = false,
) {
  const light = daylightState(cloud, rain);
  const mode = lightingMode(value);
  if (mode === 'sunset')
    Object.assign(light, {
      sun: 2.8 * (1 - light.cover * 0.88),
      fill: 0.27 + light.cover * 0.2,
      environment: 0.24 - light.cover * 0.06,
      exposure: 1.01 - light.cover * 0.03,
      turbidity: 5.6 + light.cover * 3,
      skyRadiance: 0.26 + light.cover * 0.12,
      fogDensity: light.fogDensity * 1.18,
      fogRed: 0.55 - light.cover * 0.11,
      fogGreen: 0.37 + light.cover * 0.02,
      fogBlue: 0.31 + light.cover * 0.06,
    });
  if (mode === 'night')
    Object.assign(light, {
      // Broad wet/cloud baseline is immutable for a given snapshot. The separate
      // bounded photometric pass can adapt without turning night into daylight.
      sun: 0.105 * (1 - light.cover * 0.55),
      fill: 0.205 + light.cover * 0.025,
      environment: 0.07 + light.cover * 0.01,
      exposure: 1.06 - clamp(rain, 0, 60) * 0.001,
      fogDensity: light.fogDensity * 0.75,
      fogRed: 0.01 + light.cover * 0.002,
      fogGreen: 0.014 + light.cover * 0.003,
      fogBlue: 0.026 + light.cover * 0.002,
    });
  return light;
}

/** Snap in LIGHT space, not world X/Z. The rotation is fixed, so translation
 * smaller than one shadow texel cannot swim across static geometry. */
export function shadowAnchor(
  target: T.Vector3,
  size: number,
  halfExtent: number,
  out: T.Vector3,
  mode: boolean | LightingMode = false,
) {
  if (
    ![target.x, target.y, target.z, size, halfExtent].every(Number.isFinite) ||
    size < 1 ||
    halfExtent <= 0
  )
    throw new Error('Invalid shadow grid');
  const {
    forward: lightForward,
    right: lightRight,
    up: lightUp,
  } = lightingMode(mode) === 'sunset' ? sunsetBasis : dayBasis;
  const texel = (2 * halfExtent) / size;
  const x = target.dot(lightRight),
    y = target.dot(lightUp),
    z = target.dot(lightForward);
  return out
    .copy(lightRight)
    .multiplyScalar(Math.round(x / texel) * texel)
    .addScaledVector(lightUp, Math.round(y / texel) * texel)
    .addScaledVector(lightForward, z);
}

// Bounded, stationary cloud field. Coverage follows recorded weather; there is
// no wall-clock cloud animation that would diverge between pause and replay.
const cloudFunctions = `
uniform float cloudCover;
uniform float skyRadiance;
uniform float nightAmount;
uniform float sunsetAmount;
float skyHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float skyNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(skyHash(i),skyHash(i+vec2(1,0)),f.x),
    mix(skyHash(i+vec2(0,1)),skyHash(i+vec2(1,1)),f.x),f.y);
}
float skyCloud(vec2 p) {
  return .52*skyNoise(p)+.27*skyNoise(p*2.03+11.7)+
    .14*skyNoise(p*4.09+3.1)+.07*skyNoise(p*8.17+27.3);
}
`;
export function configureSky(sky: Sky) {
  const material = sky.material;
  material.uniforms.cloudCover = { value: 0 };
  material.uniforms.nightAmount = { value: 0 };
  material.uniforms.sunsetAmount = { value: 0 };
  material.uniforms.skyRadiance = { value: daylightState(0, 0).skyRadiance };
  material.uniforms.sunPosition.value.copy(SUN_OFFSET);
  material.uniforms.rayleigh.value = 2.2;
  material.uniforms.mieCoefficient.value = 0.004;
  material.uniforms.mieDirectionalG.value = 0.82;
  material.fragmentShader = material.fragmentShader
    .replace('void main() {', cloudFunctions + '\nvoid main() {')
    .replace(
      'gl_FragColor = vec4( retColor, 1.0 );',
      `
      vec2 cloudUV=direction.xz/(max(direction.y,0.0)+0.24)*2.1+vec2(4.7,1.3);
      float field=skyCloud(cloudUV);
      float cover=smoothstep(.76-.64*cloudCover,.92-.57*cloudCover,field);
      cover*=smoothstep(-.025,.12,direction.y)*smoothstep(0.0,.16,cloudCover);
      float edge=skyCloud(cloudUV+vec2(.11,-.09));
      vec3 cloudLight=mix(vec3(.39,.46,.55),vec3(1.35,1.42,1.48),
        clamp(.48+(field-edge)*3.0+.22*max(0.0,dot(direction,vSunDirection)),0.0,1.0));
      cloudLight*=1.0-.42*cloudCover;
      cloudLight=mix(cloudLight,cloudLight*vec3(1.35,.84,.63),sunsetAmount*(1.-cloudCover*.60));
      retColor=mix(retColor,cloudLight,cover);
      retColor=mix(retColor,vec3(.55,.64,.75),cloudCover*.22);
      // The night dome shares the same stationary cloud field, not a daylight
      // texture behind a black background. This is an authored fictional night
      // sky, not an astronomical moon/date model or measured photometry.
      vec3 radiance=retColor * skyRadiance;
      if(sunsetAmount>0.5) {
        float haze=pow(1.-clamp(direction.y,0.,1.),4.0);
        radiance=mix(radiance,vec3(.38,.19,.12),haze*.15*(1.-cloudCover*.5));
      }
      if(nightAmount>0.5) {
        float elevation=max(0.0,direction.y);
        float horizon=pow(1.0-clamp(elevation,0.0,1.0),3.0);
        vec3 nightSky=mix(vec3(.008,.014,.029),vec3(.035,.039,.052),horizon);
        float moonCos=dot(direction,vSunDirection);
        float moonEdge=max(fwidth(moonCos),.0000007);
        float moon=smoothstep(.999989-moonEdge,.999989+moonEdge,moonCos);
        float halo=pow(max(0.0,moonCos),96.0)*.012;
        nightSky+=vec3(.43,.46,.48)*(moon+halo)*(1.0-cover);
        vec3 nightCloud=mix(vec3(.012,.017,.027),vec3(.040,.044,.052),
          clamp(.4+(field-edge)*2.0+.35*max(0.0,moonCos),0.0,1.0));
        nightSky=mix(nightSky,nightCloud,cover);
        radiance=mix(vec3(.01,.014,.026),nightSky,smoothstep(-.05,.10,direction.y));
      }
      gl_FragColor=vec4(radiance,1.0);
    `,
    );
  material.needsUpdate = true;
}

/** Piecewise-linear radiance between neighbouring, identically packed PMREMs.
 * Coverage and interpolation are functions of this snapshot, not wall time. */
export function skyBlendPlan(cover: number) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite sky coverage');
  const value = clamp(cover, 0, 1),
    position = value * 8;
  return {
    cover: value,
    lower: Math.floor(position),
    upper: Math.ceil(position),
    weight: position % 1,
  };
}

/** No colour conversion or tone map here: the two sources are linear HDR CubeUV
 * atlases of the same size, and their mip tiles must retain their packed layout. */
export function skyBlendMaterial() {
  return new T.RawShaderMaterial({
    name: 'Snapshot-linear sky radiance',
    glslVersion: T.GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
    uniforms: {
      lowSky: { value: null as T.Texture | null },
      highSky: { value: null as T.Texture | null },
      skyWeight: { value: 0 },
    },
    vertexShader: `precision highp float;
      in vec3 position; in vec2 uv; out vec2 atlasUV;
      void main() { atlasUV=uv; gl_Position=vec4(position,1.); }`,
    fragmentShader: `precision highp float;
      precision highp sampler2D;
      uniform sampler2D lowSky; uniform sampler2D highSky; uniform float skyWeight;
      in vec2 atlasUV; out vec4 radiance;
      void main() { radiance=mix(texture(lowSky,atlasUV),texture(highSky,atlasUV),skyWeight); }`,
  });
}

/** Protect the caller even when capture/blend throws partway through a pass. */
function preserveSkyRenderState(renderer: T.WebGLRenderer) {
  const target = renderer.getRenderTarget(),
    face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel(),
    viewport = renderer.getViewport(new T.Vector4()),
    scissor = renderer.getScissor(new T.Vector4()),
    scissorTest = renderer.getScissorTest(),
    xr = renderer.xr.enabled,
    autoClear = renderer.autoClear,
    toneMapping = renderer.toneMapping;
  return () => {
    renderer.xr.enabled = xr;
    renderer.autoClear = autoClear;
    renderer.toneMapping = toneMapping;
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    // Restore the target LAST. Its viewport/scissor are already physical
    // pixels; applying canvas-logical dimensions after binding it would scale
    // them again on high-DPI displays and crop a caller's offscreen pass.
    renderer.setRenderTarget(target, face, mip);
  };
}

/** At most two neighbouring sky captures and two reusable blend outputs are
 * retained. PMREM is captured only at a bin/mode change; a changing fractional
 * cover costs one small atlas blend, not a six-face recapture. A held frame costs
 * neither. Rewind reconstructs the requested sky immediately. */
export class SkyEnvironment {
  private cached = new Map<number, T.WebGLRenderTarget>();
  private cover = NaN;
  private mode: LightingMode = 'day';
  private environmentScene = new T.Scene();
  private blend = skyBlendMaterial();
  private quad = new FullScreenQuad(this.blend);
  private outputs: T.WebGLRenderTarget[] = [];
  private nextOutput = 0;
  private publishedScene: T.Scene | null = null;
  private publishedTexture: T.Texture | null = null;
  captures = 0;
  blends = 0;
  probeRefreshNeeded = false;
  private epoch: object = {};
  constructor(private sky: Sky) {
    this.environmentScene.add(sky.clone());
  }
  private capture(renderer: T.WebGLRenderer, bin: number, mode: LightingMode) {
    const restore = preserveSkyRenderState(renderer);
    let generator: T.PMREMGenerator | undefined;
    const uniforms = this.sky.material.uniforms;
    const previous = {
      cover: uniforms.cloudCover.value,
      night: uniforms.nightAmount.value,
      sunset: uniforms.sunsetAmount.value,
      sun: uniforms.sunPosition.value.clone() as T.Vector3,
      turbidity: uniforms.turbidity.value,
      radiance: uniforms.skyRadiance.value,
    };
    try {
      generator = new T.PMREMGenerator(renderer);
      const light = circuitLightState(bin / 8, 0, mode);
      uniforms.cloudCover.value = bin / 8;
      uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
      uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
      uniforms.sunPosition.value.copy(lightingDirection(mode));
      uniforms.turbidity.value = light.turbidity;
      uniforms.skyRadiance.value = light.skyRadiance;
      const target = generator.fromScene(this.environmentScene, 0.04, 0.1, 700000, { size: 128 });
      this.captures++;
      return target;
    } finally {
      uniforms.cloudCover.value = previous.cover;
      uniforms.nightAmount.value = previous.night;
      uniforms.sunsetAmount.value = previous.sunset;
      uniforms.sunPosition.value.copy(previous.sun);
      uniforms.turbidity.value = previous.turbidity;
      uniforms.skyRadiance.value = previous.radiance;
      try {
        generator?.dispose();
      } finally {
        restore();
      }
    }
  }
  private interpolate(
    renderer: T.WebGLRenderer,
    low: T.WebGLRenderTarget,
    high: T.WebGLRenderTarget,
    weight: number,
  ) {
    if (
      low.width !== high.width ||
      low.height !== high.height ||
      low.texture.type !== high.texture.type ||
      low.texture.colorSpace !== high.texture.colorSpace
    )
      throw new Error('Mismatched sky radiance atlases');
    if (!this.outputs.length) {
      this.outputs = [0, 1].map(() => {
        const target = new T.WebGLRenderTarget(low.width, low.height, {
          type: low.texture.type,
          minFilter: T.LinearFilter,
          magFilter: T.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        });
        target.texture.mapping = T.CubeUVReflectionMapping;
        target.texture.colorSpace = low.texture.colorSpace;
        target.texture.name = 'Continuous recorded-weather sky';
        return target;
      });
    }
    const output = this.outputs[this.nextOutput];
    if (output.width !== low.width || output.height !== low.height)
      throw new Error('Sky atlas layout changed');
    const restore = preserveSkyRenderState(renderer);
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(output);
      renderer.setScissorTest(false);
      this.blend.uniforms.lowSky.value = low.texture;
      this.blend.uniforms.highSky.value = high.texture;
      this.blend.uniforms.skyWeight.value = weight;
      this.quad.render(renderer);
      this.blends++;
    } finally {
      this.blend.uniforms.lowSky.value = this.blend.uniforms.highSky.value = null;
      restore();
    }
    // Never overwrite the published atlas: a failed blend keeps the last
    // complete image intact, and the next attempt reuses only the spare output.
    this.nextOutput = 1 - this.nextOutput;
    return output.texture;
  }
  update(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    cover: number,
    value: boolean | LightingMode = false,
  ) {
    const plan = skyBlendPlan(cover),
      mode = lightingMode(value);
    this.probeRefreshNeeded = false;
    if (plan.cover === this.cover && mode === this.mode) return false;
    const candidates = new Map<number, T.WebGLRenderTarget>();
    const created: T.WebGLRenderTarget[] = [];
    let texture: T.Texture;
    try {
      for (const bin of new Set([plan.lower, plan.upper])) {
        let target = mode === this.mode ? this.cached.get(bin) : undefined;
        if (!target) {
          target = this.capture(renderer, bin, mode);
          created.push(target);
        }
        candidates.set(bin, target);
      }
      const low = candidates.get(plan.lower)!;
      const high = candidates.get(plan.upper)!;
      texture =
        plan.lower === plan.upper
          ? low.texture
          : this.interpolate(renderer, low, high, plan.weight);
    } catch (error) {
      created.forEach((target) => target.dispose());
      throw error;
    }
    // Publish before retiring old resources. A disposal listener must not send
    // an already published complete target down the failed-capture cleanup path.
    const retired = this.cached;
    // A stable epoch lets local reflections honor their normal capture interval
    // while fractional-cloud atlas outputs alternate. Hard changes invalidate
    // immediately, including when the simulation is paused.
    const hardChange =
      !Number.isFinite(this.cover) ||
      mode !== this.mode ||
      Math.abs(plan.cover - this.cover) > 0.25;
    if (hardChange) this.epoch = {};
    texture.userData.aurelSkyEpoch = this.epoch;
    scene.environment = texture;
    this.publishedScene = scene;
    this.publishedTexture = texture;
    // Moving clouds must not force a local six-face reflection every frame.
    // Large weather jumps, mode switches and explicit seeks still invalidate it.
    this.probeRefreshNeeded = hardChange;
    this.cover = plan.cover;
    this.mode = mode;
    this.cached = candidates;
    for (const [bin, target] of retired) if (candidates.get(bin) !== target) target.dispose();
    return true;
  }
  diagnostics() {
    return {
      captures: this.captures,
      blends: this.blends,
      cover: this.cover,
      mode: this.mode,
      cachedBins: [...this.cached.keys()],
      retainedTargets: this.cached.size + this.outputs.length,
      interpolation: 'linear-HDR-CubeUV',
      independentAnimation: false,
    };
  }
  dispose() {
    if (this.publishedScene?.environment === this.publishedTexture)
      this.publishedScene.environment = null;
    for (const target of this.cached.values()) target.dispose();
    this.cached.clear();
    this.outputs.forEach((target) => target.dispose());
    this.outputs.length = 0;
    this.blend.dispose();
    this.quad.dispose();
    this.cover = NaN;
    this.publishedScene = null;
    this.publishedTexture = null;
  }
}
