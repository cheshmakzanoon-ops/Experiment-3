/** Dimensions of the existing luminous floodlight board. The equal-area disc
 * is a bounded angular-footprint approximation, not a rectangular area light. */
export const VENUE_LAMP_WIDTH = 3.2;
export const VENUE_LAMP_DEPTH = 1.3;
export const VENUE_LAMP_RADIUS = Math.sqrt((VENUE_LAMP_WIDTH * VENUE_LAMP_DEPTH) / Math.PI);

/** GGX uses alpha = perceptual roughness squared. Add a bounded angular
 * variance to alpha squared, leaving a zero-sized emitter exactly unchanged.
 * This is an artistic finite-emitter approximation, not calibrated transport. */
export function lightFootprintRoughness(roughness: number, distance: number, radius: number) {
  if (
    ![roughness, distance, radius].every(Number.isFinite) ||
    roughness < 0 ||
    roughness > 1 ||
    distance < 0 ||
    radius < 0
  )
    throw new Error('Invalid light footprint');
  if (radius === 0) return roughness;
  const angle = radius / Math.max(distance, radius);
  return Math.min(1, Math.pow(roughness ** 4 + Math.min(0.01, 0.25 * angle * angle), 0.25));
}

export const LIGHT_FOOTPRINT_GLSL = `
float apexLightFootprintRoughness(float roughness, float distanceM, float radiusM) {
  if (radiusM <= 0.) return roughness;
  float angle = radiusM / max(distanceM, radiusM);
  float alpha = roughness * roughness;
  return min(1., sqrt(sqrt(alpha * alpha + min(.01, .25 * angle * angle))));
}`;
