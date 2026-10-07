import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { LightingMode } from '../daylight.ts';

/**
 * Sky clouds (D07): a baked cumulus panorama per cloud-cover bin.
 *
 * The former cloud layer was four octaves of value noise in a flat projection,
 * evaluated twice per sky pixel; it read as grey smudges. Clouds are now a
 * small volumetric bake:
 *
 *  1. A tiling 2D cloud field (once per session): Perlin-Worley cumulus cells
 *     (R), a fine Worley billow detail (G) and a broad modulation (B).
 *  2. Per (cover bin, sun direction), a 2048x512 HalfFloat equirect panorama of
 *     the upper hemisphere. Each texel marches its view ray through a cloud
 *     slab over a curved earth: columns rise from one flat base altitude and
 *     narrow with height, so bases are flat and tops billow; two samples toward
 *     the sun give the self-shadow (with a multiple-scattering floor), and a
 *     two-lobe phase function gives the silver lining near the sun. Distant
 *     clouds fade into the horizon haze.
 *
 * The panorama stores lighting terms, not colours: R = sun-scattered light
 * (phase and self-shadow included), G = skylight from above, B = light
 * bounced up from the sunlit ground (bases), A = opacity; all premultiplied. The
 * sky shader colours them for day, golden hour, overcast or night from its
 * own uniforms, so the visible dome and every PMREM capture of a bin share one
 * bake and one colour model.
 *
 * Cost: one draw for the field (first use) and one per panorama bake, paid only
 * when a bin or lighting direction is first needed (load, weather bin change);
 * a frame that reuses cached panoramas draws nothing. The sky shader replaces
 * eight value-noise evaluations per pixel with at most two texture fetches.
 *
 * Determinism: the bake is a pure function of the bin and the sun direction
 * (integer-hash noise, fixed seeds, a per-texel interleaved-gradient offset);
 * no time, no randomness. The clouds are stationary.
 */
export const SKY_CLOUDS = Object.freeze({
  panoramaWidth: 2048,
  panoramaHeight: 512,
  fieldSize: 1024,
  /** Tiling period of the cloud field, metres. */
  fieldPeriod: 24000,
  earthRadius: 6371000,
  /** Primary march steps per panorama texel (more on long, low rays). */
  minSteps: 24,
  maxSteps: 48,
  /** Rays end at this distance; clouds fade into haze before it. */
  maxDistance: 80000,
  /** Distance at which a cloud keeps 1/e of its contrast against the horizon. */
  hazeDistance: 32000,
  /** Cached panoramas (8 MB each); two cover bins of the current lighting plus one spare. */
  cacheSize: 3,
});

/** Cloud slab and coverage for a weather cover in [0, 1]. Fair-weather
 * cumulus (cover <= 0.5) sit on a 1400 m base; toward overcast the base lowers
 * and the layer thickens into a closed deck. `threshold` is the field value a
 * column needs to exist at the base; it is calibrated on the baked field so
 * that the clear preset (cover 0.12) shows 15-30 % cloud in the lower 25 degrees
 * of sky. */
export function cloudLayer(cover: number) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  const c = Math.min(1, Math.max(0, cover));
  const deck = smooth01((c - 0.45) / 0.55);
  return {
    cover: c,
    threshold: c <= 0 ? 2 : tableAt(CLOUD_THRESHOLDS, c),
    baseAltitude: lerp(1400, 900, deck),
    thickness: lerp(1150, 1800, smooth01(c / 0.9)),
    /** Extinction per metre at density 1. */
    extinction: lerp(0.018, 0.026, deck),
  };
}
/** Field threshold per eighth of cover (index = bin), calibrated on the baked
 * panoramas so the visible cloud fraction 10-30 degrees up grows evenly: about
 * 0.25, 0.4, 0.55, 0.7, 0.82, 0.92, 0.98 and 1 for bins 1-8. Bin 0 has none. */
const CLOUD_THRESHOLDS = [0.66, 0.61, 0.565, 0.52, 0.47, 0.425, 0.34, 0.22, 0.08] as const;
function tableAt(table: readonly number[], c: number) {
  const x = c * (table.length - 1),
    i = Math.min(table.length - 2, Math.floor(x));
  return lerp(table[i], table[i + 1], x - i);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function smooth01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

const QUAD_VERTEX = `precision highp float;
in vec3 position; in vec2 uv; out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;

const NOISE_GLSL = `
uint cloudHash(uvec3 p) {
  uint h = p.x * 0x8da6b343u ^ p.y * 0xd8163841u ^ p.z * 0xcb1ab31fu;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return h;
}
// Floor-based wrap: GLSL ES leaves % undefined for negative operands.
ivec2 cloudWrap(ivec2 c, int period) {
  return c - period * ivec2(floor(vec2(c) / float(period)));
}
vec2 cloudRandom2(ivec2 c, int period, uint seed) {
  uvec2 w = uvec2(cloudWrap(c, period));
  uint h = cloudHash(uvec3(w, seed));
  return vec2(float(h & 0xffffu), float(h >> 16u)) / 65536.0;
}
// Periodic gradient noise in about [0, 1].
float cloudPerlin(vec2 p, int period, uint seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a00 = 6.2831853 * cloudRandom2(i, period, seed).x,
    a10 = 6.2831853 * cloudRandom2(i + ivec2(1, 0), period, seed).x,
    a01 = 6.2831853 * cloudRandom2(i + ivec2(0, 1), period, seed).x,
    a11 = 6.2831853 * cloudRandom2(i + ivec2(1, 1), period, seed).x;
  vec2 g00 = vec2(cos(a00), sin(a00)), g10 = vec2(cos(a10), sin(a10)),
    g01 = vec2(cos(a01), sin(a01)), g11 = vec2(cos(a11), sin(a11));
  float n = mix(mix(dot(g00, f), dot(g10, f - vec2(1.0, 0.0)), u.x),
    mix(dot(g01, f - vec2(0.0, 1.0)), dot(g11, f - vec2(1.0, 1.0)), u.x), u.y);
  return clamp(n * 0.75 + 0.5, 0.0, 1.0);
}
// Periodic inverted Worley (1 - F1): 1 at each cell's feature point.
float cloudWorley(vec2 p, int period, uint seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  float d = 4.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      ivec2 c = i + ivec2(x, y);
      vec2 r = vec2(x, y) + cloudRandom2(c, period, seed) - f;
      d = min(d, dot(r, r));
    }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}
`;

/** Tiling cloud field. One period of the field spans SKY_CLOUDS.fieldPeriod
 * metres; R holds 2-3 km cumulus cells clustered by a broad Perlin term, G a
 * 150-300 m billow detail and B a broad, independent modulation. */
const FIELD_FRAGMENT = `precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fieldColor;
${NOISE_GLSL}
void main() {
  vec2 p = vUv;
  float cells = 0.58 * cloudWorley(p * 10.0, 10, 11u) + 0.27 * cloudWorley(p * 21.0, 21, 12u) +
    0.15 * cloudWorley(p * 43.0, 43, 13u);
  float clusters = 0.65 * cloudPerlin(p * 3.0, 3, 21u) + 0.35 * cloudPerlin(p * 7.0, 7, 22u);
  // Perlin-Worley: billowed cells, grouped and thinned by the broad term.
  float base = clamp(cells * mix(0.55, 1.12, clusters) + 0.08 * (clusters - 0.5), 0.0, 1.0);
  float detail = 0.55 * cloudWorley(p * 80.0, 80, 31u) + 0.3 * cloudWorley(p * 160.0, 160, 32u) +
    0.15 * cloudPerlin(p * 120.0, 120, 33u);
  float broad = cloudPerlin(p * 2.0, 2, 41u) * 0.6 + cloudPerlin(p * 5.0, 5, 42u) * 0.4;
  fieldColor = vec4(base, detail, broad, 1.0);
}`;

/** Equirect upper hemisphere: u = atan(z, x) / 2pi + 0.5, v = elevation / 90 deg. */
const PANORAMA_FRAGMENT = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D cloudField;
uniform vec3 sunDirection;
uniform float threshold;
uniform float baseAltitude;
uniform float thickness;
uniform float extinction;
uniform vec2 resolution;
in vec2 vUv;
out vec4 cloudTerms;
const float PI = 3.141592653589793;
const float EARTH = ${SKY_CLOUDS.earthRadius.toFixed(1)};
const float PERIOD = ${SKY_CLOUDS.fieldPeriod.toFixed(1)};
const float MAX_DISTANCE = ${SKY_CLOUDS.maxDistance.toFixed(1)};
const float HAZE = ${SKY_CLOUDS.hazeDistance.toFixed(1)};
float shellDistance(float dy, float h) {
  float b = EARTH * dy;
  return -b + sqrt(b * b + 2.0 * EARTH * h + h * h);
}
float altitude(vec3 p) { return length(p + vec3(0.0, EARTH, 0.0)) - EARTH; }
// Cloud density at world point p (camera at the origin), 0..1; column is the
// local column height (0..1) for the skylight that reaches the base.
float density(vec3 p, bool detailed, out float column) {
  column = 0.0;
  float hf = (altitude(p) - baseAltitude) / thickness;
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec2 xz = p.xz / PERIOD;
  vec4 field = texture(cloudField, xz);
  // An independent, rotated and rescaled view of the broad term breaks the tiling.
  float broad = texture(cloudField, mat2(0.8, -0.6, 0.6, 0.8) * xz * 0.37 + vec2(0.31, 0.67)).b;
  float base = field.r * mix(0.86, 1.1, broad);
  float shape = (base - threshold) / max(1.0 - threshold, 0.05);
  column = clamp(shape, 0.0, 1.0);
  // Columns narrow with height: domed tops on a flat base.
  float top = shape - pow(hf, 1.7);
  if (detailed) {
    // Billows: the detail is sampled with a height-dependent offset, so the
    // erosion varies up the cloud like a 3D noise would.
    float billow = 0.55 * texture(cloudField, xz * 1.3 + vec2(hf * 0.012, -hf * 0.008)).g +
      0.45 * texture(cloudField, mat2(0.6, 0.8, -0.8, 0.6) * xz * 2.3 + vec2(-hf * 0.031, hf * 0.019)).g;
    top -= (0.62 - billow) * 0.42 * (0.35 + hf);
  }
  return smoothstep(0.0, 0.14, top) * smoothstep(0.0, 0.045, hf);
}
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5);
}
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float el = vUv.y * 0.5 * PI;
  vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  float enter = shellDistance(dir.y, baseAltitude);
  float leave = min(shellDistance(dir.y, baseAltitude + thickness), MAX_DISTANCE);
  if (enter >= leave) { cloudTerms = vec4(0.0); return; }
  float span = leave - enter;
  float dt = span / clamp(span / 160.0, ${SKY_CLOUDS.minSteps}.0, ${SKY_CLOUDS.maxSteps}.0);
  // Interleaved gradient noise: a fixed per-texel offset hides step banding.
  vec2 pixel = floor(vUv * resolution);
  float jitter = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  float mu = dot(dir, sunDirection);
  // Forward lobe (silver lining) + a weak back lobe, relative to isotropic;
  // capped so a cloud beside the sun glows without a bloom-blown core.
  float phase = min(mix(phaseHG(mu, 0.68), phaseHG(mu, -0.18), 0.32), 4.5);
  float transmittance = 1.0, sun = 0.0, sky = 0.0, ground = 0.0, meanT = 0.0, weight = 0.0;
  // Coarse steps through empty air. On reaching cloud, step back and march at
  // a quarter step for as long as the ray stays in cloud (plus a short margin),
  // so silhouettes are crisp and the lighting shows no step contours.
  float t = enter + jitter * dt * 0.35, stepLength = dt;
  int outside = 0;
  for (int i = 0; i < ${SKY_CLOUDS.maxSteps + 64}; i++) {
    if (t >= leave || transmittance < 0.015) break;
    vec3 p = dir * t;
    float column;
    float d = density(p, true, column);
    if (d > 0.001 && stepLength == dt) {
      stepLength = dt * 0.25;
      t = max(enter, t - dt * 0.875);
      outside = 0;
      continue;
    }
    float advance = stepLength;
    t += advance;
    if (stepLength < dt) {
      outside = d > 0.001 ? 0 : outside + 1;
      if (outside >= 6) stepLength = dt;
    }
    if (d <= 0.001) continue;
    float hf = (altitude(p) - baseAltitude) / thickness;
    // Two-step self-shadow toward the sun.
    float unused;
    float near = density(p + sunDirection * 90.0, false, unused);
    float far = density(p + sunDirection * 380.0, false, unused);
    float depth = extinction * (near * 180.0 + far * 520.0);
    // Beer-Lambert with a multiple-scattering floor (no black cores).
    float lit = max(exp(-depth), 0.32 * exp(-depth * 0.22));
    // Skylight: tops see the whole dome, a base mostly the sunlit ground below;
    // a taller column above darkens its base (the low-contrast overcast rolls).
    float shade = 1.0 - 0.2 * column * (1.0 - hf);
    float ambient = (0.16 + 0.84 * pow(hf, 0.65)) * shade;
    float bounce = 0.4 * pow(1.0 - hf, 1.5) * shade;
    float stepOpacity = 1.0 - exp(-extinction * d * advance);
    float w = transmittance * stepOpacity;
    sun += w * lit * phase;
    sky += w * ambient;
    ground += w * bounce;
    meanT += w * (t - advance * 0.5);
    weight += w;
    transmittance *= 1.0 - stepOpacity;
  }
  float opacity = 1.0 - transmittance;
  if (weight <= 0.0) { cloudTerms = vec4(0.0); return; }
  meanT /= weight;
  // Aerial perspective: distant clouds lose contrast against the horizon haze.
  float haze = exp(-pow(meanT / HAZE, 1.6));
  cloudTerms = vec4(sun, sky, ground, opacity) * haze;
}`;

/** How the sky shader lights the baked terms, in sky-shader units (before
 * skyRadiance). Calibrated through ACES at day exposure and the day grade to
 * ART_BIBLE_A section 2.2: sunlit tops #f6f7f8 (just under clip), shaded bases
 * #9aa6b4-#aab4c0, overcast #cfd3d6-#e8eaea. */
export const SKY_CLOUD_LIGHT = Object.freeze({
  keyGain: 6.0,
  skyGain: 3.0,
  dayKey: Object.freeze([0.96, 0.98, 1.0] as const),
  sunsetKey: Object.freeze([1.0, 0.5, 0.22] as const),
  daySky: Object.freeze([0.46, 0.6, 0.9] as const),
  sunsetSky: Object.freeze([0.26, 0.24, 0.42] as const),
  /** Sunlit ground seen by cloud bases (dry verges and asphalt, warm). */
  groundBounce: Object.freeze([0.62, 0.58, 0.5] as const),
  /** Deck base under overcast (sky term about 0.34 there). */
  overcastSky: Object.freeze([1.15, 1.34, 1.66] as const),
  /** The dome behind a closing deck: the deck's own diffuse grey. */
  overcastHaze: Object.freeze([0.4, 0.46, 0.57] as const),
});
const vec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(4)).join(',')})`;
/** Sky-shader declarations (configureSky). */
export const SKY_CLOUD_UNIFORMS = `
uniform sampler2D cloudLow;
uniform sampler2D cloudHigh;
uniform float cloudWeight;
uniform float cloudReady;
uniform float cloudKeyGain;
uniform float cloudSkyGain;
`;
/** Colours the baked terms for the bound lighting and cover: the sun term by
 * the key (hidden toward overcast), the sky term by the dome (grey under a
 * closed deck). Expects cloudCover and sunsetAmount. */
export const SKY_CLOUD_LIGHTING = `
const vec3 skyOvercastHaze=${vec3(SKY_CLOUD_LIGHT.overcastHaze)};
vec3 skyCloudLight(vec4 terms) {
  float sunVisible = 1.0 - 0.9 * smoothstep(0.35, 0.95, cloudCover);
  vec3 key = mix(${vec3(SKY_CLOUD_LIGHT.dayKey)}, ${vec3(SKY_CLOUD_LIGHT.sunsetKey)}, sunsetAmount);
  vec3 dome = mix(mix(${vec3(SKY_CLOUD_LIGHT.daySky)}, ${vec3(SKY_CLOUD_LIGHT.sunsetSky)}, sunsetAmount),
    ${vec3(SKY_CLOUD_LIGHT.overcastSky)}, smoothstep(0.45, 1.0, cloudCover));
  // Ground bounce follows the sun on the ground; under a deck it is the sky's.
  vec3 bounce = ${vec3(SKY_CLOUD_LIGHT.groundBounce)} * mix(key * sunVisible, dome, 0.35);
  return terms.r * key * cloudKeyGain * sunVisible + (terms.g * dome + terms.b * bounce) * cloudSkyGain;
}
`;
/** Sky-shader sampling of the bound panoramas (premultiplied terms, opacity). */
export const SKY_CLOUD_SAMPLE = `
vec4 skyCloudTerms(vec3 direction) {
  if (cloudReady < 0.5 || direction.y <= 0.0) return vec4(0.0);
  vec2 uv = vec2(atan(direction.z, direction.x) * 0.15915494 + 0.5,
    asin(clamp(direction.y, 0.0, 1.0)) * 0.63661977);
  return mix(texture2D(cloudLow, uv), texture2D(cloudHigh, uv), cloudWeight);
}
`;

/** Cosine-weighted means of the baked terms over the upper hemisphere, per
 * cover bin (index): [opacity, sun (day sun), sun (sunset sun), sky, ground].
 * Measured on the GPU bakes (scratch lab, 128 rows x 512 azimuths); the CPU
 * dome model (`skyCosineRadiance`) uses them for the PMREM ground's skylight. */
export const CLOUD_DOME_MEANS: readonly (readonly [number, number, number, number, number])[] =
  Object.freeze([
    [0, 0, 0, 0, 0],
    [0.1445, 0.0745, 0.0363, 0.0467, 0.0481],
    [0.242, 0.092, 0.0489, 0.0755, 0.0813],
    [0.3658, 0.1082, 0.0606, 0.1097, 0.1245],
    [0.5263, 0.1299, 0.0656, 0.1507, 0.1817],
    [0.6778, 0.1326, 0.0613, 0.1847, 0.2375],
    [0.9181, 0.0665, 0.0289, 0.2302, 0.3272],
    [0.9744, 0.0117, 0.0076, 0.2276, 0.3451],
    [0.9759, 0.009, 0.0061, 0.2221, 0.339],
  ] as const);
/** Mean baked terms (premultiplied) of the dome at a cover, blended between
 * neighbouring bins exactly as the dome blends their panoramas. */
export function cloudDomeTerms(cover: number, mode: LightingMode) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  const x = Math.min(1, Math.max(0, cover)) * 8,
    i = Math.min(7, Math.floor(x)),
    w = x - i;
  const a = CLOUD_DOME_MEANS[i],
    b = CLOUD_DOME_MEANS[i + 1];
  const at = (k: number) => lerp(a[k], b[k], w);
  return { opacity: at(0), sun: at(mode === 'sunset' ? 2 : 1), sky: at(3), ground: at(4) };
}
/** CPU mirror of SKY_CLOUD_LIGHTING (sky-shader units): the radiance of
 * premultiplied terms for a cover and sunset amount. */
export function skyCloudLight(
  terms: { sun: number; sky: number; ground: number },
  cover: number,
  sunset: number,
  out: number[] = [0, 0, 0],
) {
  const L = SKY_CLOUD_LIGHT;
  const sunVisible = 1 - 0.9 * smooth01((cover - 0.35) / 0.6),
    deck = smooth01((cover - 0.45) / 0.55);
  for (let k = 0; k < 3; k++) {
    const key = lerp(L.dayKey[k], L.sunsetKey[k], sunset),
      dome = lerp(lerp(L.daySky[k], L.sunsetSky[k], sunset), L.overcastSky[k], deck),
      bounce = L.groundBounce[k] * lerp(key * sunVisible, dome, 0.35);
    out[k] =
      terms.sun * key * L.keyGain * sunVisible +
      (terms.sky * dome + terms.ground * bounce) * L.skyGain;
  }
  return out;
}

export interface SkyCloudUniforms {
  cloudLow: T.IUniform<T.Texture | null>;
  cloudHigh: T.IUniform<T.Texture | null>;
  cloudWeight: T.IUniform<number>;
  cloudReady: T.IUniform<number>;
  cloudKeyGain: T.IUniform<number>;
  cloudSkyGain: T.IUniform<number>;
}
/** Fresh, unbound uniforms (no panorama: the dome shows no baked clouds). */
export function createSkyCloudUniforms(): SkyCloudUniforms {
  return {
    cloudLow: { value: null },
    cloudHigh: { value: null },
    cloudWeight: { value: 0 },
    cloudReady: { value: 0 },
    cloudKeyGain: { value: SKY_CLOUD_LIGHT.keyGain },
    cloudSkyGain: { value: SKY_CLOUD_LIGHT.skyGain },
  };
}

/** Panoramas are shared by lightings with one sun direction (day and night). */
export function cloudLightKey(mode: LightingMode) {
  return mode === 'sunset' ? 'sunset' : 'day';
}

type Uniforms = Record<string, T.IUniform>;
function preserve(renderer: T.WebGLRenderer) {
  const target = renderer.getRenderTarget(),
    face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel(),
    viewport = renderer.getViewport(new T.Vector4()),
    scissor = renderer.getScissor(new T.Vector4()),
    scissorTest = renderer.getScissorTest(),
    xr = renderer.xr.enabled,
    autoClear = renderer.autoClear;
  return () => {
    renderer.xr.enabled = xr;
    renderer.autoClear = autoClear;
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.setRenderTarget(target, face, mip);
  };
}

/** The cloud panoramas of one sky. `prepare` binds the visible dome's two
 * neighbouring bins (baking any that are missing); `bind` temporarily binds one
 * bin for a PMREM capture of that bin. */
export class SkyClouds {
  private field: T.WebGLRenderTarget | null = null;
  private readonly panoramas = new Map<string, T.WebGLRenderTarget>();
  private readonly empty: T.DataTexture;
  private readonly fieldMaterial = new T.RawShaderMaterial({
    name: 'Sky cloud field bake',
    glslVersion: T.GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: FIELD_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
  });
  private readonly panoramaMaterial = new T.RawShaderMaterial({
    name: 'Sky cloud panorama bake',
    glslVersion: T.GLSL3,
    vertexShader: QUAD_VERTEX,
    fragmentShader: PANORAMA_FRAGMENT,
    uniforms: {
      cloudField: { value: null },
      sunDirection: { value: new T.Vector3(0, 1, 0) },
      threshold: { value: 1 },
      baseAltitude: { value: 1400 },
      thickness: { value: 800 },
      extinction: { value: 0.02 },
      resolution: {
        value: new T.Vector2(SKY_CLOUDS.panoramaWidth, SKY_CLOUDS.panoramaHeight),
      },
    },
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
  });
  private readonly quad = new FullScreenQuad(this.fieldMaterial);
  private readonly order: string[] = [];
  bakes = 0;
  fieldBakes = 0;
  private visible = { low: -1, high: -1, weight: 0, light: '' };
  constructor(
    readonly uniforms: SkyCloudUniforms = createSkyCloudUniforms(),
    private readonly sunDirection: (mode: LightingMode) => T.Vector3 = () => new T.Vector3(0, 1, 0),
  ) {
    this.empty = new T.DataTexture(new Uint16Array(4), 1, 1, T.RGBAFormat, T.HalfFloatType);
    this.empty.needsUpdate = true;
  }
  /** Use the uniforms of a configured sky material (configureSky declares them). */
  static forSky(material: T.ShaderMaterial, sunDirection: (mode: LightingMode) => T.Vector3) {
    const u = material.uniforms as Uniforms;
    if (!u.cloudLow || !u.cloudHigh || !u.cloudWeight || !u.cloudReady)
      throw new Error('Sky material has no cloud panorama uniforms');
    return new SkyClouds(u as unknown as SkyCloudUniforms, sunDirection);
  }
  private bakeField(renderer: T.WebGLRenderer) {
    const size = SKY_CLOUDS.fieldSize;
    const target = new T.WebGLRenderTarget(size, size, {
      type: T.UnsignedByteType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      wrapS: T.RepeatWrapping,
      wrapT: T.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = 'Sky cloud field';
    this.draw(renderer, target, this.fieldMaterial);
    this.fieldBakes++;
    return target;
  }
  private draw(renderer: T.WebGLRenderer, target: T.WebGLRenderTarget, material: T.Material) {
    const restore = preserve(renderer);
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      this.quad.material = material;
      this.quad.render(renderer);
    } finally {
      restore();
    }
  }
  /** The panorama of `bin` (0..8) for a lighting, baked on first use. Bin 0
   * (no cover) is the empty texture. */
  panorama(renderer: T.WebGLRenderer, bin: number, mode: LightingMode): T.Texture {
    if (!Number.isInteger(bin) || bin < 0 || bin > 8) throw new Error('Invalid cloud bin');
    const layer = cloudLayer(bin / 8);
    if (layer.threshold >= 1) return this.empty;
    const key = `${cloudLightKey(mode)}:${bin}`;
    const cached = this.panoramas.get(key);
    if (cached) {
      this.touch(key);
      return cached.texture;
    }
    if (!this.field) this.field = this.bakeField(renderer);
    const target = new T.WebGLRenderTarget(SKY_CLOUDS.panoramaWidth, SKY_CLOUDS.panoramaHeight, {
      type: T.HalfFloatType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      wrapS: T.RepeatWrapping,
      wrapT: T.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = `Sky cloud panorama ${key}`;
    const u = this.panoramaMaterial.uniforms;
    u.cloudField.value = this.field.texture;
    (u.sunDirection.value as T.Vector3).copy(this.sunDirection(mode)).normalize();
    u.threshold.value = layer.threshold;
    u.baseAltitude.value = layer.baseAltitude;
    u.thickness.value = layer.thickness;
    u.extinction.value = layer.extinction;
    try {
      this.draw(renderer, target, this.panoramaMaterial);
    } catch (error) {
      target.dispose();
      throw error;
    } finally {
      u.cloudField.value = null;
    }
    this.bakes++;
    this.panoramas.set(key, target);
    this.touch(key);
    return target.texture;
  }
  private touch(key: string) {
    const i = this.order.indexOf(key);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(key);
  }
  /** Drop the least recently used panoramas beyond the cache size, never one
   * in `keep` (bound to the dome or to a capture). */
  private evict(keep: ReadonlySet<T.Texture | null>) {
    while (this.order.length > SKY_CLOUDS.cacheSize) {
      const index = this.order.findIndex((k) => !keep.has(this.panoramas.get(k)!.texture));
      if (index < 0) break;
      const [key] = this.order.splice(index, 1);
      this.panoramas.get(key)!.dispose();
      this.panoramas.delete(key);
    }
  }
  /** Bind the visible dome's clouds for a cover and lighting. Returns true
   * when a binding changed. Bakes only missing panoramas. */
  prepare(renderer: T.WebGLRenderer, cover: number, mode: LightingMode) {
    if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
    const position = Math.min(1, Math.max(0, cover)) * 8,
      low = Math.floor(position),
      high = Math.ceil(position),
      weight = position - low,
      light = cloudLightKey(mode);
    const v = this.visible;
    if (v.low === low && v.high === high && v.weight === weight && v.light === light) return false;
    const lowTexture = this.panorama(renderer, low, mode),
      highTexture = high === low ? lowTexture : this.panorama(renderer, high, mode);
    this.uniforms.cloudLow.value = lowTexture;
    this.uniforms.cloudHigh.value = highTexture;
    this.uniforms.cloudWeight.value = weight;
    this.uniforms.cloudReady.value = 1;
    this.visible = { low, high, weight, light };
    this.evict(new Set([lowTexture, highTexture]));
    return true;
  }
  /** Bind one bin (PMREM capture of that bin). Returns the restore function. */
  bind(renderer: T.WebGLRenderer, bin: number, mode: LightingMode) {
    const u = this.uniforms;
    const previous = {
      low: u.cloudLow.value,
      high: u.cloudHigh.value,
      weight: u.cloudWeight.value,
      ready: u.cloudReady.value,
    };
    const texture = this.panorama(renderer, bin, mode);
    this.evict(new Set([texture, previous.low, previous.high]));
    u.cloudLow.value = u.cloudHigh.value = texture;
    u.cloudWeight.value = 0;
    u.cloudReady.value = 1;
    return () => {
      u.cloudLow.value = previous.low;
      u.cloudHigh.value = previous.high;
      u.cloudWeight.value = previous.weight;
      u.cloudReady.value = previous.ready;
    };
  }
  /** The baked panorama texture of a bin if cached (diagnostics, lookdev). */
  cached(bin: number, mode: LightingMode) {
    return this.panoramas.get(`${cloudLightKey(mode)}:${bin}`)?.texture ?? null;
  }
  diagnostics() {
    return {
      bakes: this.bakes,
      fieldBakes: this.fieldBakes,
      cached: [...this.order],
      visible: { ...this.visible },
      bytes:
        this.panoramas.size * SKY_CLOUDS.panoramaWidth * SKY_CLOUDS.panoramaHeight * 8 +
        (this.field ? SKY_CLOUDS.fieldSize ** 2 * 4 : 0),
      stationary: true,
    };
  }
  dispose() {
    for (const target of this.panoramas.values()) target.dispose();
    this.panoramas.clear();
    this.order.length = 0;
    this.field?.dispose();
    this.field = null;
    this.empty.dispose();
    this.fieldMaterial.dispose();
    this.panoramaMaterial.dispose();
    this.quad.dispose();
    const u = this.uniforms;
    u.cloudLow.value = u.cloudHigh.value = null;
    u.cloudReady.value = 0;
    u.cloudWeight.value = 0;
    this.visible = { low: -1, high: -1, weight: 0, light: '' };
  }
}
