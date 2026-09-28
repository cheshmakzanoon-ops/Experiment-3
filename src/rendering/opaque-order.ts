/** The renderer still sorts transparency back-to-front. Only opaque items use
 * this order: explicit artist groups/orders first, then front-to-back so hidden
 * fragments can fail the depth test before running the PBR/weather shader.
 * Stable material/id ties preserve the original coplanar ordering. */
export interface OpaqueItem {
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: { id: number };
  id: number;
}
export function frontToBackOpaque(a: OpaqueItem, b: OpaqueItem): number {
  return (
    a.groupOrder - b.groupOrder ||
    a.renderOrder - b.renderOrder ||
    a.z - b.z ||
    a.material.id - b.material.id ||
    a.id - b.id
  );
}
