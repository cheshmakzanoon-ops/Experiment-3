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

/** Equivalent main-view distance of a subject in a smaller feed, such as a
 * rear-view mirror: the lens correction above, scaled by how many fewer pixel
 * rows the feed has than the main view. A reflection 20 px tall then chooses
 * the detail a main-view subject 20 px tall would. */
export function feedDetailDistance(
  distance: number,
  fov: number,
  aspect: number,
  feedHeight: number,
  viewHeight: number,
): number {
  if (!(feedHeight > 0) || !(viewHeight > 0) || !Number.isFinite(feedHeight + viewHeight))
    throw new Error('Invalid detail feed');
  return detailDistance(distance, fov, aspect) * Math.max(1, viewHeight / feedHeight);
}
