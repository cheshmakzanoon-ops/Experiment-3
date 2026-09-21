import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
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
      // Broad wet/cloud response is immutable for a given snapshot. No automatic
      // exposure reacts to the camera, car colour, or entry into a light pool.
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

/** Own the complete PMREM output and replace it only after a successful capture.
 * Weather bins avoid per-frame GPU allocation. Rewinds pick the correct bin on
 * their first frame, rather than reflecting the sky from the future. */
export class SkyEnvironment {
  private current: T.WebGLRenderTarget | null = null;
  private bin = -1;
  private mode: LightingMode = 'day';
  captures = 0;
  private environmentScene = new T.Scene();
  constructor(private sky: Sky) {
    this.environmentScene.add(sky.clone());
  }
  update(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    cover: number,
    value: boolean | LightingMode = false,
  ) {
    if (!Number.isFinite(cover)) throw new Error('Non-finite sky coverage');
    const mode = lightingMode(value);
    const nextBin = Math.round(clamp(cover, 0, 1) * 8);
    if (nextBin === this.bin && mode === this.mode) return false;
    const generator = new T.PMREMGenerator(renderer);
    let next: T.WebGLRenderTarget;
    const previousCover = this.sky.material.uniforms.cloudCover.value;
    const previousNight = this.sky.material.uniforms.nightAmount.value;
    const previousSunset = this.sky.material.uniforms.sunsetAmount.value;
    const previousSun = this.sky.material.uniforms.sunPosition.value.clone() as T.Vector3;
    const previousTurbidity = this.sky.material.uniforms.turbidity.value;
    const previousRadiance = this.sky.material.uniforms.skyRadiance.value;
    try {
      // Capture the bin centre so returning to the same weather has the same IBL.
      this.sky.material.uniforms.cloudCover.value = nextBin / 8;
      this.sky.material.uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
      this.sky.material.uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
      this.sky.material.uniforms.sunPosition.value.copy(lightingDirection(mode));
      this.sky.material.uniforms.turbidity.value = circuitLightState(
        nextBin / 8,
        0,
        mode,
      ).turbidity;
      this.sky.material.uniforms.skyRadiance.value = circuitLightState(
        nextBin / 8,
        0,
        mode,
      ).skyRadiance;
      next = generator.fromScene(this.environmentScene, 0.04, 0.1, 700000, { size: 128 });
    } finally {
      this.sky.material.uniforms.cloudCover.value = previousCover;
      this.sky.material.uniforms.nightAmount.value = previousNight;
      this.sky.material.uniforms.sunsetAmount.value = previousSunset;
      this.sky.material.uniforms.sunPosition.value.copy(previousSun);
      this.sky.material.uniforms.turbidity.value = previousTurbidity;
      this.sky.material.uniforms.skyRadiance.value = previousRadiance;
      generator.dispose();
    }
    const previous = this.current;
    scene.environment = next.texture;
    this.current = next;
    this.bin = nextBin;
    this.mode = mode;
    this.captures++;
    previous?.dispose();
    return true;
  }
  dispose() {
    this.current?.dispose();
    this.current = null;
    this.bin = -1;
  }
}
