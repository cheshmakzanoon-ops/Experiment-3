import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, lerp, smooth } from '../core/math.ts';
import { circuitLightColors } from './lighting-coherence.ts';
import { aerialFogColor, setAerialPerspective } from './studio/aerial-perspective.ts';
import {
  SKY_CLOUD_LIGHT,
  SKY_CLOUD_LIGHTING,
  SKY_CLOUD_SAMPLE,
  SKY_CLOUD_UNIFORMS,
  cloudDomeTerms,
  createSkyCloudUniforms,
  skyCloudLight,
  type SkyClouds,
} from './studio/sky-clouds.ts';
import {
  IBL_ENERGY,
  SKY_IRRADIANCE_SATURATION,
  SKY_GROUND_GLSL,
  SKY_GROUND_UNIFORMS,
  groundIrradiance,
} from './studio/ibl-energy.ts';

/** One world-space sun direction for the visible disk, illumination and shadows.
 * Day: about 52 degrees of elevation, the short shadows tucked under the car of
 * the midday references; azimuth as before, so far-shadow and probe bakes keep
 * their orientation. Sunset: about 10 degrees, a long raking golden-hour key. */
export const SUN_OFFSET = Object.freeze(new T.Vector3(-140, 235, -115));
export const SUNSET_OFFSET = Object.freeze(new T.Vector3(-215, 45, -150));
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
 * Diffuse fill is deliberately subordinate to direct light, and it is mostly sky:
 * the IBL `environment` (the share of the visible dome that lights diffuse
 * surfaces) rises with cover, because overcast light is all sky light, while the
 * small hemisphere term only adds a cool sky / warm ground bias. Specular IBL is
 * normalised to the visible dome separately (studio/ibl-energy.ts). */
export function daylightState(cloud: number, rain: number) {
  if (![cloud, rain].every(Number.isFinite)) throw new Error('Non-finite daylight state');
  const cover = clamp(cloud, 0, 1),
    precipitation = clamp(rain, 0, 60),
    fog = aerialFogColor(cover, precipitation, 'day');
  return {
    cover,
    sun: 3.9 * (1 - 0.94 * cover ** 1.45),
    fill: 0.14 + cover * 0.3,
    environment: 0.42 + cover * 0.08,
    exposure: 0.9 + cover * 0.1,
    // A clean, deep clear-day sky (ART_BIBLE_A section 2.1): less Mie haze than
    // the former 2.3, so the blue survives down toward the horizon.
    turbidity: 1.9 + cover * 5.5,
    // Normalize the analytic skydome before the shared scene tone map; keeping
    // its native radiance washed the entire clear sky and reflected paint white.
    skyRadiance: 0.28 + cover * 0.2,
    // P12 aerial perspective (studio/aerial-perspective.ts): FogExp2 density
    // at the circuit datum, thinning with altitude in the fog chunk. Clear
    // 0.00055 (26 % contrast loss at 1 km), overcast 0.0008, the 24 mm/h rain
    // preset about 0.0017. The colour is the anti-sun haze #9db8d3, greying to
    // overcast #c4cacd and rain #aeb5b8; the sun side adds its glow per view.
    fogDensity: 0.00055 + cover * 0.00025 + precipitation * 0.0000375,
    fogRed: fog[0],
    fogGreen: fog[1],
    fogBlue: fog[2],
  };
}

function fogChannels([fogRed, fogGreen, fogBlue]: readonly number[]) {
  return { fogRed, fogGreen, fogBlue };
}
const sunsetFog = (cover: number, rain: number) =>
  fogChannels(aerialFogColor(cover, clamp(rain, 0, 60), 'sunset'));
const nightFog = (cover: number, rain: number) =>
  fogChannels(aerialFogColor(cover, clamp(rain, 0, 60), 'night'));

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
      // P2 golden hour: a ~10 degree key strong enough to dominate whatever
      // faces it (car flanks, walls, hillsides read warm orange) while a
      // horizontal road still gets only sin(10 deg) of it and stays mostly sky lit.
      sun: 3.6 * (1 - light.cover * 0.88),
      // A distinct, cooler violet-blue skylight floor, instead of compensating
      // with global exposure (which clips the warm key). Kept below the sky IBL
      // so sunlit asphalt reads warm grey rather than mauve.
      fill: 0.45 + light.cover * 0.1,
      // The same diffuse share of the (sunset) dome as by day.
      environment: 0.42 + light.cover * 0.08,
      exposure: 1.03 - light.cover * 0.03,
      turbidity: 5.6 + light.cover * 3,
      skyRadiance: 0.26 + light.cover * 0.12,
      fogDensity: light.fogDensity * 1.18,
      // Anti-sun dusk haze #7d84a0; the sun side glows #d9a27c (per view).
      ...sunsetFog(light.cover, rain),
    });
  if (mode === 'night')
    Object.assign(light, {
      // Floodlit circuit: the directional key stands for the aggregate of the
      // circuit's floodlight masts (still well below overcast daylight), and
      // the skylight fill is low so the surroundings fall away to dark instead
      // of the whole scene reading as a flat blue-grey. The bounded photometric
      // pass can adapt without turning night into daylight.
      sun: 0.3 * (1 - light.cover * 0.55),
      fill: 0.085 + light.cover * 0.03,
      environment: 0.07 + light.cover * 0.01,
      exposure: 1.12 - clamp(rain, 0, 60) * 0.001,
      fogDensity: light.fogDensity * 0.75,
      // Night haze #0e141c, a little lighter under cloud.
      ...nightFog(light.cover, rain),
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

/** Scattering parameters of the circuit sky (three's Preetham Sky uniforms). */
export const SKY_SCATTERING = Object.freeze({ rayleigh: 3.4, mie: 0.0032, mieDirectionalG: 0.82 });

/** Day-sky colour grade, a linear per-channel gain from the horizon to the
 * zenith: `mix(horizon, zenith, smoothstep(edges, direction.y))`, faded out
 * at sunset and night. Preetham's single-scatter fit saturates every channel
 * along the long horizon path, so its lower sky goes white and, through the
 * ACES shoulder and the day grade, cyan-grey (G/B 0.93-1.0 at 5-25 degrees,
 * horizon B-G about 0). The gains are fitted (through ACES at day exposure and
 * the day broadcast grade) to the clear-sky targets of ART_BIBLE_A section 2.1:
 * horizon #b8d4ea-#c8dcef, 20 degrees about #8ec0f3, zenith #6aa2d6-#70a6cb,
 * 90 degrees in azimuth from the sun. The sun side keeps Preetham's brighter,
 * whiter Mie glow; the anti-sun side is a deeper blue. */
export const SKY_GRADE = Object.freeze({
  horizon: Object.freeze([0.36, 0.65, 1.49] as const),
  zenith: Object.freeze([1.132, 0.865, 0.792] as const),
  edges: Object.freeze([0.05, 0.93] as const),
});
/** CPU mirror of the shader's day-sky grade for a view direction's y. `day` is
 * 1 for the day dome and 0 at sunset or night (no grade). */
export function skyGrade(y: number, day = 1, out: number[] = [0, 0, 0]) {
  const s = smooth(SKY_GRADE.edges[0], SKY_GRADE.edges[1], y);
  for (let i = 0; i < 3; i++)
    out[i] = lerp(1, lerp(SKY_GRADE.horizon[i], SKY_GRADE.zenith[i], s), day);
  return out;
}

/** CPU port of three r180 Sky.js in-scattering (Preetham), without the solar
 * disc. `linear` is the shader's texColor; `encoded` is its final retColor,
 * pow(texColor, 1/(1.2 + 1.2 sunfade)), a display-style curve (1/2.4 for any
 * sun above the horizon). */
export function preethamSky(direction: T.Vector3, sun: T.Vector3, turbidity: number) {
  const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const mieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const s = sun.clone().normalize();
  const sunCos = clamp(s.y, -1, 1);
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(sunCos)) / 1.5)));
  // three derives sunfade from the un-normalized sun position over 450 km.
  const sunfade = 1 - clamp(1 - Math.exp(sun.y / 450000), 0, 1);
  const rayleighCoefficient = SKY_SCATTERING.rayleigh - (1 - sunfade);
  const d = direction.clone().normalize();
  const zenith = Math.acos(Math.max(0, d.y));
  const inverse =
    1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  const cosTheta = d.dot(s);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = SKY_SCATTERING.mieDirectionalG,
    g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5));
  const horizonBlend = clamp(Math.pow(1 - sunCos, 5), 0, 1);
  const linear = [0, 0, 0],
    encoded = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const betaR = totalRayleigh[i] * rayleighCoefficient;
    const betaM = 0.434 * 0.2 * turbidity * 10e-18 * mieConst[i] * SKY_SCATTERING.mie;
    const fex = Math.exp(-(betaR * 8.4e3 * inverse + betaM * 1.25e3 * inverse));
    const ratio = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= 1 + (Math.pow(sunE * ratio * fex, 0.5) - 1) * horizonBlend;
    linear[i] = (lin + 0.1 * fex) * 0.04 + [0, 0.0003, 0.00075][i];
    encoded[i] = Math.pow(linear[i], 1 / (1.2 + 1.2 * sunfade));
  }
  return { linear, encoded };
}

const skyGainCache = new Map<string, number>();
/** Gain that gives the linear Preetham sky the same cosine-weighted
 * (hemispherical) luminance as three's encoded output, so the environment
 * light the sky contributes is unchanged while its colour stops being
 * flattened by a second display curve. Cached per sun and turbidity. */
export function skyLinearGain(sun: T.Vector3, turbidity: number) {
  if (![sun.x, sun.y, sun.z, turbidity].every(Number.isFinite) || turbidity <= 0)
    throw new Error('Invalid sky state');
  // 0.05 turbidity steps change the gain by under 0.001; a miss costs ~1 ms.
  const quantized = Math.max(0.05, Math.round(turbidity * 20) / 20);
  const key = `${sun.x},${sun.y},${sun.z},${quantized}`;
  const cached = skyGainCache.get(key);
  if (cached !== undefined) return cached;
  const disc = sun.clone().normalize();
  const direction = new T.Vector3();
  let encoded = 0,
    linear = 0;
  const N = 24;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < 2 * N; j++) {
      const elevation = ((i + 0.5) / N) * (Math.PI / 2),
        azimuth = ((j + 0.5) / (2 * N)) * 2 * Math.PI;
      direction.set(
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      );
      if (direction.dot(disc) > 0.99995) continue;
      const sample = preethamSky(direction, sun, quantized);
      const w = Math.sin(elevation) * Math.cos(elevation);
      const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      encoded += luma(sample.encoded) * w;
      linear += luma(sample.linear) * w;
    }
  const gain = encoded / linear;
  if (skyGainCache.size > 256) skyGainCache.clear();
  skyGainCache.set(key, gain);
  return gain;
}

// Bounded, stationary clouds: a baked cumulus panorama per cover bin
// (studio/sky-clouds.ts). Coverage follows recorded weather; there is no
// wall-clock cloud animation that would diverge between pause and replay.
const cloudFunctions = `
uniform float cloudCover;
uniform float skyLinearGain;
uniform float skyRadiance;
uniform float probeSkyIntensity;
uniform float nightAmount;
uniform float sunsetAmount;
const vec3 skyGradeHorizon=vec3(${SKY_GRADE.horizon.join(',')});
const vec3 skyGradeZenith=vec3(${SKY_GRADE.zenith.join(',')});
${SKY_CLOUD_UNIFORMS}${SKY_CLOUD_SAMPLE}${SKY_CLOUD_LIGHTING}`;
export function configureSky(sky: Sky) {
  const material = sky.material;
  material.uniforms.cloudCover = { value: 0 };
  material.uniforms.nightAmount = { value: 0 };
  material.uniforms.sunsetAmount = { value: 0 };
  material.uniforms.skyRadiance = { value: daylightState(0, 0).skyRadiance };
  material.uniforms.skyLinearGain = {
    value: skyLinearGain(SUN_OFFSET, daylightState(0, 0).turbidity),
  };
  // One in the visible sky/PMREM. The local scene probe temporarily applies the
  // authored IBL gain here, without attenuating captured lamps a second time.
  material.uniforms.probeSkyIntensity = { value: 1 };
  // Cloud panoramas: unbound (no baked clouds) until a SkyClouds binds them.
  Object.assign(material.uniforms, createSkyCloudUniforms());
  // Ground hemisphere: 0 for the visible dome, set only by SkyEnvironment.capture.
  material.uniforms.groundAmount = { value: 0 };
  material.uniforms.groundAlbedo = { value: new T.Vector3(...IBL_ENERGY.groundAlbedo) };
  material.uniforms.groundIrradiance = { value: new T.Vector3() };
  material.uniforms.sunPosition.value.copy(SUN_OFFSET);
  material.uniforms.rayleigh.value = SKY_SCATTERING.rayleigh;
  material.uniforms.mieCoefficient.value = SKY_SCATTERING.mie;
  material.uniforms.mieDirectionalG.value = SKY_SCATTERING.mieDirectionalG;
  material.fragmentShader = material.fragmentShader
    .replace('void main() {', cloudFunctions + SKY_GROUND_UNIFORMS + '\nvoid main() {')
    .replace(
      'gl_FragColor = vec4( retColor, 1.0 );',
      `
      // three's Sky ends with a display curve (pow(texColor, 1/2.4) for a sun
      // above the horizon), but this pipeline tone-maps and encodes once at
      // output. Encoding twice flattened the dome to a pale grey haze (at 15
      // degrees elevation, saturation 0.40 instead of 0.71). Use the linear
      // Preetham radiance, scaled to the same hemispherical luminance so the
      // sky's share of the environment light is unchanged. The solar disc keeps
      // its former radiance: the linear disc would overflow half float.
      // Day-sky colour grade (SKY_GRADE): the white Preetham lower sky becomes
      // the clear blue of the references; none at sunset or night.
      vec3 skyGrade=mix(vec3(1.0),mix(skyGradeHorizon,skyGradeZenith,
        smoothstep(${SKY_GRADE.edges[0]},${SKY_GRADE.edges[1]},direction.y)),
        (1.0-sunsetAmount)*(1.0-nightAmount));
      retColor=mix(((Lin+vec3(0.1)*Fex)*0.04+vec3(0.0,0.0003,0.00075))*skyGrade*skyLinearGain,retColor,sundisk);
      // Behind the clouds, unresolved thin cloud and haze grey the dome with
      // cover, and a closing deck turns it into the deck's own diffuse grey.
      retColor=mix(retColor,vec3(.55,.64,.75),cloudCover*.22);
      retColor=mix(retColor,skyOvercastHaze*cloudSkyGain,smoothstep(.55,.95,cloudCover)*.9);
      // Baked cumulus (premultiplied sun and sky terms, opacity): flat bases,
      // billowed tops, self-shadow and a silver lining; over the sun disc too.
      vec4 clouds=skyCloudTerms(direction);
      float cover=clouds.a;
      retColor=retColor*(1.0-cover)+skyCloudLight(clouds);
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
        // Moonlit tops from the same bake's sun (moon) term per unit opacity.
        float moonLit=clouds.r/max(clouds.a,0.02);
        vec3 nightCloud=mix(vec3(.012,.017,.027),vec3(.040,.044,.052),
          clamp(.25+.3*moonLit+.35*max(0.0,moonCos),0.0,1.0));
        nightSky=mix(nightSky,nightCloud,cover);
        // Unresolved cloud veils the stars and moon and catches the venue glow.
        nightSky=mix(nightSky,vec3(.026,.030,.040),cloudCover*.45*(1.0-cover));
        radiance=mix(vec3(.01,.014,.026),nightSky,smoothstep(-.05,.10,direction.y));
      }
      ${SKY_GROUND_GLSL}
      gl_FragColor=vec4(radiance * probeSkyIntensity,1.0);
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

/** PMREM face size of the sky capture by tier. Each doubling adds one mip level,
 * i.e. two blur draws per capture, so Medium and Low keep 128 px (draw-neutral
 * in the cold-frame budget); High resolves a 0.04 clearcoat's horizon line at
 * 256 px. Below roughness ~0.075 three samples the top mip, so only the
 * glossiest finishes see the difference. */
export const SKY_PMREM_SIZE = Object.freeze({ standard: 128, high: 256 });

/** At most two neighbouring sky captures and two reusable blend outputs are
 * retained. PMREM is captured only at a bin/mode change; a changing fractional
 * cover costs one small atlas blend, not a six-face recapture. A held frame costs
 * neither. Rewind reconstructs the requested sky immediately. */
export class SkyEnvironment {
  private cached = new Map<number, T.WebGLRenderTarget>();
  private cover = NaN;
  private mode: LightingMode = 'day';
  private size: number = SKY_PMREM_SIZE.standard;
  /** High tier: capture at SKY_PMREM_SIZE.high (the renderer's setQuality). */
  highDetail = false;
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
  /** `clouds` bakes and binds the sky's cloud panoramas (the circuit renderer);
   * without it the dome has no baked clouds. */
  constructor(
    private sky: Sky,
    private clouds?: SkyClouds,
  ) {
    this.environmentScene.add(sky.clone());
  }
  private capture(renderer: T.WebGLRenderer, bin: number, mode: LightingMode, size: number) {
    const restore = preserveSkyRenderState(renderer);
    let generator: T.PMREMGenerator | undefined, unbindClouds: (() => void) | undefined;
    const uniforms = this.sky.material.uniforms;
    const previous = {
      cover: uniforms.cloudCover.value,
      night: uniforms.nightAmount.value,
      sunset: uniforms.sunsetAmount.value,
      sun: uniforms.sunPosition.value.clone() as T.Vector3,
      turbidity: uniforms.turbidity.value,
      radiance: uniforms.skyRadiance.value,
      ground: uniforms.groundAmount?.value as number | undefined,
      groundIrradiance: (uniforms.groundIrradiance?.value as T.Vector3 | undefined)?.clone(),
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
      // The lower hemisphere is ground, lit by this bin's sun and sky, not
      // horizon sky: undersides and lower bodywork reflect dark warm asphalt.
      if (uniforms.groundAmount && uniforms.groundIrradiance) {
        uniforms.groundAmount.value = 1;
        groundIrradiance(groundLightState(bin / 8, mode), uniforms.groundIrradiance.value);
      }
      // This bin's cloud panorama, not the visible dome's blend.
      unbindClouds = this.clouds?.bind(renderer, bin, mode);
      // Paid only on a cloud-bin, lighting or tier change.
      const target = generator.fromScene(this.environmentScene, 0.04, 0.1, 700000, { size });
      this.captures++;
      return target;
    } finally {
      unbindClouds?.();
      uniforms.cloudCover.value = previous.cover;
      uniforms.nightAmount.value = previous.night;
      uniforms.sunsetAmount.value = previous.sunset;
      uniforms.sunPosition.value.copy(previous.sun);
      uniforms.turbidity.value = previous.turbidity;
      uniforms.skyRadiance.value = previous.radiance;
      if (previous.ground !== undefined) uniforms.groundAmount.value = previous.ground;
      if (previous.groundIrradiance)
        uniforms.groundIrradiance.value.copy(previous.groundIrradiance);
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
    size: number = this.highDetail ? SKY_PMREM_SIZE.high : SKY_PMREM_SIZE.standard,
  ) {
    const plan = skyBlendPlan(cover),
      mode = lightingMode(value);
    if (!Number.isInteger(Math.log2(size)) || size < 16 || size > 1024)
      throw new Error('Invalid sky PMREM size');
    // The visible dome's clouds (bakes only a missing bin panorama) and the
    // aerial perspective's sun-side glow for this cover and lighting.
    this.clouds?.prepare(renderer, plan.cover, mode);
    setAerialPerspective(plan.cover, mode);
    this.probeRefreshNeeded = false;
    if (plan.cover === this.cover && mode === this.mode && size === this.size) return false;
    const resized = size !== this.size;
    const candidates = new Map<number, T.WebGLRenderTarget>();
    const created: T.WebGLRenderTarget[] = [];
    // A new atlas layout needs new blend outputs. The published texture may be
    // one of the old ones, so they are retired only after the new publish.
    const retiredOutputs = resized ? this.outputs : [];
    if (resized) {
      this.outputs = [];
      this.nextOutput = 0;
    }
    let texture: T.Texture;
    try {
      for (const bin of new Set([plan.lower, plan.upper])) {
        let target = mode === this.mode && !resized ? this.cached.get(bin) : undefined;
        if (!target) {
          target = this.capture(renderer, bin, mode, size);
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
      if (resized) {
        this.outputs.forEach((target) => target.dispose());
        this.outputs = retiredOutputs;
        this.nextOutput = 0;
      }
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
      resized ||
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
    this.size = size;
    this.cached = candidates;
    for (const [bin, target] of retired) if (candidates.get(bin) !== target) target.dispose();
    retiredOutputs.forEach((target) => target.dispose());
    return true;
  }
  diagnostics() {
    return {
      captures: this.captures,
      blends: this.blends,
      cover: this.cover,
      mode: this.mode,
      cachedBins: [...this.cached.keys()],
      size: this.size,
      retainedTargets: this.cached.size + this.outputs.length,
      interpolation: 'linear-HDR-CubeUV',
      independentAnimation: false,
      clouds: this.clouds?.diagnostics() ?? null,
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
    this.clouds?.dispose();
    this.cover = NaN;
    this.publishedScene = null;
    this.publishedTexture = null;
  }
}

const domeCache = new Map<string, T.Color>();
/** Cosine-weighted mean radiance of the upper dome as the sky shader renders it
 * for a PMREM capture (linear, probeSkyIntensity 1). The baked clouds enter
 * through their measured dome means (`cloudDomeTerms`), as if spread evenly
 * over the hemisphere. It sets the sky part of the PMREM ground's irradiance;
 * the visible dome is unaffected. */
export function skyCosineRadiance(cloud: number, value: boolean | LightingMode = false) {
  const mode = lightingMode(value),
    light = circuitLightState(cloud, 0, mode),
    cover = light.cover;
  const key = `${mode}:${cover}`;
  const cached = domeCache.get(key);
  if (cached) return cached.clone();
  const sun = lightingDirection(mode);
  const gain = skyLinearGain(sun, light.turbidity);
  const terms = cloudDomeTerms(cover, mode),
    clouds = skyCloudLight(terms, cover, mode === 'sunset' ? 1 : 0),
    deck = smooth(0.55, 0.95, cover) * 0.9;
  const direction = new T.Vector3(),
    sum = new T.Color(0, 0, 0),
    sample = new T.Color(),
    grade = [1, 1, 1];
  let weights = 0;
  const N = 12;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < 2 * N; j++) {
      const elevation = ((i + 0.5) / N) * (Math.PI / 2),
        azimuth = ((j + 0.5) / (2 * N)) * 2 * Math.PI;
      direction.set(
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      );
      const y = direction.y;
      if (mode === 'night') {
        const horizon = (1 - y) ** 3;
        const night = [
          [0.008, 0.035, 0.0232, 0.026],
          [0.014, 0.039, 0.0278, 0.03],
          [0.029, 0.052, 0.037, 0.04],
        ].map(([zenith, low, cloudy, veil]) =>
          lerp(
            lerp(lerp(zenith, low, horizon), cloudy, terms.opacity),
            veil,
            cover * 0.45 * (1 - terms.opacity),
          ),
        );
        sample.setRGB(night[0], night[1], night[2]);
      } else {
        const clear = preethamSky(direction, sun, light.turbidity).linear;
        skyGrade(y, mode === 'day' ? 1 : 0, grade);
        const veil = [0.55, 0.64, 0.75];
        const rgb = clear.map((c, k) => {
          const background = lerp(
            lerp(c * gain * grade[k], veil[k], cover * 0.22),
            SKY_CLOUD_LIGHT.overcastHaze[k] * SKY_CLOUD_LIGHT.skyGain,
            deck,
          );
          return (background * (1 - terms.opacity) + clouds[k]) * light.skyRadiance;
        });
        if (mode === 'sunset') {
          const haze = (1 - y) ** 4 * 0.15 * (1 - cover * 0.5);
          [0.38, 0.19, 0.12].forEach((h, k) => (rgb[k] = lerp(rgb[k], h, haze)));
        }
        sample.setRGB(rgb[0], rgb[1], rgb[2]);
      }
      const w = Math.sin(elevation) * Math.cos(elevation);
      sum.r += sample.r * w;
      sum.g += sample.g * w;
      sum.b += sample.b * w;
      weights += w;
    }
  const result = sum.multiplyScalar(1 / weights);
  if (domeCache.size > 64) domeCache.clear();
  domeCache.set(key, result.clone());
  return result;
}

/** The lights of one PMREM bin, for the ground's irradiance. */
export function groundLightState(cloud: number, value: boolean | LightingMode = false) {
  const mode = lightingMode(value),
    light = circuitLightState(cloud, 0, mode),
    colors = circuitLightColors(light.cover, mode);
  return {
    sunColor: colors.sun,
    sun: light.sun,
    sunDirection: lightingDirection(mode).clone(),
    skyColor: colors.sky,
    fill: light.fill,
    environment: light.environment,
    skyCosineRadiance: skyCosineRadiance(light.cover, mode),
    skySaturation: SKY_IRRADIANCE_SATURATION[mode],
  };
}
