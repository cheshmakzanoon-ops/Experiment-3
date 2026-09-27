/** Equivalent distance under the current lens, relative to a 58-degree view.
 * Narrow lenses and portrait views must not select coarse geometry for an
 * optically enlarged subject. Wide lenses retain the existing metre thresholds;
 * physical visibility/culling and simulation relevance never use this value. */
export function detailDistance(distance: number, fov = 58, aspect = 16 / 9): number {
  if (
    !Number.isFinite(distance) ||
    distance < 0 ||
    !Number.isFinite(fov) ||
    fov <= 0 ||
    fov >= 180 ||
    !Number.isFinite(aspect) ||
    aspect <= 0
  )
    throw new Error('Invalid detail lens');
  const scale = Math.min(
    1,
    (Math.tan((fov * Math.PI) / 360) * Math.min(1, aspect)) / Math.tan((58 * Math.PI) / 360),
  );
  return distance * scale;
}
