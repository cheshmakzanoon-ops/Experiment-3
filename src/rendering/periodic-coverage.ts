/** Box-filter a periodic stripe using its integral. Keep derivatives on the
 * unwrapped coordinate: fract/mod/floor discontinuities are not pixel sizes. */
export function periodicCoverage(centre: number, footprint: number, halfWidth: number) {
  if (!Number.isFinite(centre) || !Number.isFinite(footprint) ||
      !Number.isFinite(halfWidth) || footprint <= 0 || halfWidth < 0 || halfWidth > 0.5)
    throw new Error('Invalid periodic coverage');
  if (footprint >= 32) return 2 * halfWidth;
  // Centre reduction avoids subtracting large, nearly equal integrals on long laps.
  const x = centre - Math.floor(centre), w = Math.max(footprint, 0.00001);
  const integral = (p: number) => {
    const whole = Math.floor(p), f = p - whole;
    return whole * 2 * halfWidth + Math.min(f, halfWidth) + Math.max(0, f - 1 + halfWidth);
  };
  const exact = Math.max(0, Math.min(1, (integral(x + w / 2) - integral(x - w / 2)) / w));
  const t = Math.max(0, Math.min(1, (w - 16) / 16));
  return exact + (2 * halfWidth - exact) * t * t * (3 - 2 * t);
}

/** Matches periodicCoverage, including the continuous transition to the mean.
 * The guard permits composition by independently installed material hooks. */
export const PERIODIC_COVERAGE_GLSL = `
#ifndef APEX_PERIODIC_COVERAGE
#define APEX_PERIODIC_COVERAGE
float apexStripeIntegral(float x, float h) {
  float whole = floor(x), f = x - whole;
  return whole * (2. * h) + min(f, h) + max(0., f - 1. + h);
}
float apexStripeCoverage(float x, float footprint, float h) {
  float w = max(footprint, .00001);
  if (w >= 32.) return 2. * h;
  x = fract(x);
  float coverage = clamp((apexStripeIntegral(x + w * .5, h) -
    apexStripeIntegral(x - w * .5, h)) / w, 0., 1.);
  return mix(coverage, 2. * h, smoothstep(16., 32., w));
}
#endif
`;
