import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { clamp } from '../core/math.ts';

/** One world-space sun direction for the visible disk, illumination and shadows. */
export const SUN_OFFSET = Object.freeze(new T.Vector3(-160, 190, -130));
const lightForward = SUN_OFFSET.clone().normalize();
const lightRight = new T.Vector3(0, 1, 0).cross(lightForward).normalize();
const lightUp = lightForward.clone().cross(lightRight).normalize();

/** Authored daylight response, not measured exposure/meteorological calibration.
 * Diffuse fill is deliberately subordinate to direct light: the previous bright
 * hemisphere plus IBL lit recesses almost as strongly as exposed bodywork. */
export function daylightState(cloud: number, rain: number) {
  if (![cloud, rain].every(Number.isFinite)) throw new Error('Non-finite daylight state');
  const cover = clamp(cloud, 0, 1),
    precipitation = clamp(rain, 0, 60);
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
    fogDensity: 0.00025 + cover * 0.00012 + precipitation * 0.000024,
  };
}

/** Snap in LIGHT space, not world X/Z. The rotation is fixed, so translation
 * smaller than one shadow texel cannot swim across static geometry. */
export function shadowAnchor(target: T.Vector3, size: number, halfExtent: number, out: T.Vector3) {
  if (
    ![target.x, target.y, target.z, size, halfExtent].every(Number.isFinite) ||
    size < 1 ||
    halfExtent <= 0
  )
    throw new Error('Invalid shadow grid');
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
      retColor=mix(retColor,cloudLight,cover);
      retColor=mix(retColor,vec3(.55,.64,.75),cloudCover*.22);
      gl_FragColor=vec4(retColor * skyRadiance,1.0);
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
  captures = 0;
  private environmentScene = new T.Scene();
  constructor(private sky: Sky) {
    this.environmentScene.add(sky.clone());
  }
  update(renderer: T.WebGLRenderer, scene: T.Scene, cover: number) {
    if (!Number.isFinite(cover)) throw new Error('Non-finite sky coverage');
    const nextBin = Math.round(clamp(cover, 0, 1) * 8);
    if (nextBin === this.bin) return false;
    const generator = new T.PMREMGenerator(renderer);
    let next: T.WebGLRenderTarget;
    const previousCover = this.sky.material.uniforms.cloudCover.value;
    const previousTurbidity = this.sky.material.uniforms.turbidity.value;
    const previousRadiance = this.sky.material.uniforms.skyRadiance.value;
    try {
      // Capture the bin centre so returning to the same weather has the same IBL.
      this.sky.material.uniforms.cloudCover.value = nextBin / 8;
      this.sky.material.uniforms.turbidity.value = daylightState(nextBin / 8, 0).turbidity;
      this.sky.material.uniforms.skyRadiance.value = daylightState(nextBin / 8, 0).skyRadiance;
      next = generator.fromScene(this.environmentScene, 0.04, 0.1, 700000, { size: 128 });
    } finally {
      this.sky.material.uniforms.cloudCover.value = previousCover;
      this.sky.material.uniforms.turbidity.value = previousTurbidity;
      this.sky.material.uniforms.skyRadiance.value = previousRadiance;
      generator.dispose();
    }
    const previous = this.current;
    scene.environment = next.texture;
    this.current = next;
    this.bin = nextBin;
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
