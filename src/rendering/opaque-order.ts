/** The renderer still sorts transparency back-to-front. Only opaque items use
 * this order: explicit artist groups/orders first, then front-to-back so hidden
 * fragments can fail the depth test before running the PBR/weather shader.
 * Stable material/id ties preserve the original coplanar ordering. */
export interface OpaqueItem {
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: { id: number; name?: string };
  id: number;
}
export function frontToBackOpaque(a: OpaqueItem, b: OpaqueItem): number {
  // Three's analytic SkyShader writes camera-far depth with depthWrite=false.
  // Its object origin is NOT its raster depth. Place it last even when its
  // centre projects in front of nearby geometry; covered sky fragments can
  // then fail depth before running the atmospheric/cloud shader. Transparency
  // remains a separate later pass; no shader, radiance or depth state changes.
  const skyA = a.material.name === 'SkyShader';
  const skyB = b.material.name === 'SkyShader';
  if (skyA !== skyB) return skyA ? 1 : -1;
  return (
    a.groupOrder - b.groupOrder ||
    a.renderOrder - b.renderOrder ||
    a.z - b.z ||
    a.material.id - b.material.id ||
    a.id - b.id
  );
}
