import * as T from 'three';
import { drawWordmark, fitHeight } from './brand-atlas.ts';

/**
 * Sidewall art for the slick tyres (D12 vehicle-tyres-wheels), drawn in the
 * tread shader from the tyre's bind-space polar coordinates (`tireBind`),
 * independent of any glTF UV layout and of live carcass deflection.
 *
 *  - Compound band: two 150° arcs between radius `band[0]` and `band[1]` in
 *    the compound colour (P8), the classic broken sidewall ring.
 *  - Lettering: original wordmarks (P19: APEX CORSA, SLICK 18) between
 *    `letters[0]` and `letters[1]`, twice around the tyre, from a 1024×128
 *    lettering atlas (white strokes, red channel = coverage).
 *  - Rotational blur: above `blur.start` rad/s the art is smeared along the
 *    angle (8 taps over up to a quarter turn), reaching a uniform ring at
 *    `blur.full` (`wheelBlur`). Deterministic: from presented wheel speed.
 */
export const TYRE_ART = Object.freeze({
  band: Object.freeze([0.312, 0.326] as const),
  bandArc: 150,
  letters: Object.freeze([0.268, 0.308] as const),
  words: Object.freeze(['APEX CORSA', 'SLICK 18'] as const),
  ink: 0xe9e8e3,
  atlas: Object.freeze({ width: 1024, height: 128 }),
  blur: Object.freeze({ start: 18, full: 45 }),
  tread: Object.freeze({ color: 0x2a2a2a, roughness: 0.75, scrubbed: 0.82 }),
  sidewall: Object.freeze({ color: 0x1f2022, roughness: 0.58 }),
});

/** Rotational blur amount 0..1 for a wheel spinning at `omega` rad/s. */
export function wheelBlur(omega: number) {
  if (!Number.isFinite(omega)) return 0;
  const { start, full } = TYRE_ART.blur;
  const t = Math.min(1, Math.max(0, (Math.abs(omega) - start) / (full - start)));
  return t * t * (3 - 2 * t);
}

/** Share of the band ring covered by the two arcs. */
export const BAND_COVERAGE = (2 * TYRE_ART.bandArc) / 360;

let atlas: T.CanvasTexture | null = null;
/** The shared lettering atlas, or null where no canvas exists (unit tests). */
export function tyreLetteringAtlas(): T.CanvasTexture | null {
  if (atlas) return atlas;
  if (typeof document === 'undefined') return null;
  const { width, height } = TYRE_ART.atlas;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#fff';
  // One half-turn of the tyre per atlas: the brand word, then the size code.
  const [brand, size] = TYRE_ART.words;
  const style = { weight: 0.2, width: 1.05, tracking: 0.16 };
  const cap = Math.min(fitHeight(brand, width * 0.52, height * 0.62, style), height * 0.62);
  drawWordmark(context, brand, width * 0.29, height / 2, cap, style);
  drawWordmark(context, size, width * 0.76, height / 2, cap * 0.72, { ...style, weight: 0.17 });
  atlas = new T.CanvasTexture(canvas);
  atlas.colorSpace = T.NoColorSpace;
  atlas.wrapS = T.RepeatWrapping;
  atlas.wrapT = T.ClampToEdgeWrapping;
  atlas.anisotropy = 8;
  atlas.name = 'Original tyre sidewall lettering';
  return atlas;
}

/** Sidewall GLSL, appended to tread.frag (needs tireRadius, tireAngle,
 * tireAcross, tireAngularPixel, treadSide* uniforms). */
export const TYRE_SIDEWALL_GLSL = /* glsl */ `
// D12 sidewall: band arcs, lettering and rotational blur.
float sideFace = smoothstep(.72, .9, abs(tireAcross));
float sideRadial = 1. - smoothstep(.326, .332, tireRadius);
float sideMask = sideFace * sideRadial;
float spin = clamp(treadSide.x, 0., 1.);
if (sideMask > 0.) {
  float turn = fract(tireAngle);
  // Two 150 deg arcs centred on 0 and 180 deg; blurred toward their coverage.
  float arcPhase = abs(fract(turn * 2. + .5) - .5) * 360.;
  float arc = 1. - smoothstep(${(TYRE_ART.bandArc / 2 - 1.5).toFixed(1)}, ${(TYRE_ART.bandArc / 2 + 1.5).toFixed(1)}, arcPhase);
  arc = mix(arc, ${BAND_COVERAGE.toFixed(4)}, spin);
  float bandEdge = max(fwidth(tireRadius), 1e-4);
  float band = smoothstep(${TYRE_ART.band[0].toFixed(3)} - bandEdge, ${TYRE_ART.band[0].toFixed(3)} + bandEdge, tireRadius) *
    (1. - smoothstep(${TYRE_ART.band[1].toFixed(3)} - bandEdge, ${TYRE_ART.band[1].toFixed(3)} + bandEdge, tireRadius));
  float letters = 0.;
  if (treadSide.y > .5) {
    float v = (tireRadius - ${TYRE_ART.letters[0].toFixed(3)}) / ${(TYRE_ART.letters[1] - TYRE_ART.letters[0]).toFixed(3)};
    if (v > 0. && v < 1.) {
      // Text reads around the tyre, mirrored on the inner face.
      float u = turn * 2. * sign(tireAcross);
      if (spin < .01) letters = texture2D(tireLettering, vec2(u, v)).r;
      else {
        for (int k = 0; k < 8; k++) letters += texture2D(tireLettering, vec2(u + (float(k) / 7. - .5) * .5 * spin, v)).r;
        letters /= 8.;
      }
    }
  }
  vec3 inkColor = vec3(${new T.Color(TYRE_ART.ink)
    .toArray()
    .map((c) => c.toFixed(4))
    .join(', ')});
  diffuseColor.rgb = mix(diffuseColor.rgb, treadBandColor, band * arc * sideMask);
  diffuseColor.rgb = mix(diffuseColor.rgb, inkColor, letters * sideMask * (1. - tireWet * .25));
  tireInk = max(band * arc, letters) * sideMask;
}
`;
