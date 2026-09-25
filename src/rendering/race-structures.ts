import type { Group, Material } from 'three';
import { box } from './geometry.ts';
import type { BroadcastSightlines } from './broadcast-sightlines.ts';

/** Register the actual opaque meshes, never the empty opening under a gantry.
 * Caller places the parent before construction, as with the venue builders. */
export function buildGantrySolids(
  parent: Group,
  beam: Material,
  concrete: Material,
  sightlines: BroadcastSightlines,
) {
  sightlines.add(box(parent, beam, 0, 6, 0, 22, 1.3, 0.5));
  for (const side of [-1, 1]) sightlines.add(box(parent, concrete, side * 10.8, 3, 0, 0.5, 6, 0.5));
}
export function buildControlTowerSolids(
  parent: Group,
  concrete: Material,
  glass: Material,
  roof: Material,
  sightlines: BroadcastSightlines,
) {
  sightlines.add(box(parent, concrete, 0, 8, 0, 7, 16, 7));
  // The glazed observation room is not a solid nine-metre occlusion block.
  box(parent, glass, 0, 15, 0, 9, 3.5, 9);
  sightlines.add(box(parent, roof, 0, 17, 0, 10, 0.25, 10));
}
