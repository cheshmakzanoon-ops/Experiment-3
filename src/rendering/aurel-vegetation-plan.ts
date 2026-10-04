import { Track, trackPoint } from '../simulation/track.ts';
import { vegetationPlan, grovePlan, plantingCharacter, type TreePlacement } from './landscape.ts';
import { terrainFor } from './terrain.ts';
import { inStandFootprint } from './grandstand.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { districtPlan, inDistrictFootprint } from './venue-districts.ts';
import { landmarkSitePlan, inLandmarkFootprint } from './venue-landmark.ts';
import { venuePlan } from './venue-plan.ts';
import manifest from './aurel-vegetation.manifest.json' with { type: 'json' };

export type TreeVariant = keyof typeof manifest.dimensions;
export type PlantingLayer = 'near' | 'orchard' | 'grove' | 'treeline';
export interface AuthoredTree extends TreePlacement {
  variant: TreeVariant;
  layer: PlantingLayer;
  station: number;
  plot?: number;
  row?: number;
  column?: number;
}
export const ORCHARD_PLOTS = Object.freeze([
  { station: 640, lateral: -69, rows: 3, columns: 11 },
  { station: 830, lateral: -72, rows: 3, columns: 11 },
]);
export const ORCHARD_SPACING = Object.freeze({ along: 8.5, across: 10 });
export type PlantingExclusion = (x: number, z: number, padding: number) => boolean;

/** Stable spatial variation survives bucket, camera, density and replay changes. */
export function treeSeed(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 100), 0x45d9f3b) ^ Math.imul(Math.round(z * 100), 0x119de1f3);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Radius of the full exported crown, not a point/trunk-only placement test. */
export function crownRadius(tree: Pick<AuthoredTree, 'width' | 'variant'>) {
  const b = manifest.bounds[tree.variant],
    d = manifest.dimensions[tree.variant];
  return (
    (Math.hypot(
      Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])),
      Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])),
    ) *
      tree.width) /
    d.width
  );
}

/** Retain the original nearest-segment/footprint protections and extend them to
 * the exported crown envelope and A05 recovery approaches, including groves. */
export function plantingClearance(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: PlantingExclusion,
) {
  const nearest = trackPoint(),
    districts = districtPlan(track, services),
    landmark = landmarkSitePlan(track, services, districts),
    ground = terrainFor(track);
  return (tree: AuthoredTree) => {
    const l = track.nearest(tree.x, tree.z, nearest),
      radius = crownRadius(tree),
      margin = Math.max(8, radius + 2);
    const corridor = tree.layer === 'grove' || tree.layer === 'treeline' ? 60 : 14;
    if (Math.abs(l) < track.boundary(nearest.s, l < 0 ? -1 : 1) + corridor + radius) return false;
    if (l > 0 && (nearest.s < 335 || nearest.s > track.length - 50) && l < 65 + radius)
      return false;
    if (ground.seaLevel !== null && ground.height(tree.x, tree.z) < ground.seaLevel + 0.6)
      return false;
    return !(
      inStandFootprint(track, tree.x, tree.z, margin) ||
      inServiceFootprint(services, tree.x, tree.z, margin) ||
      inDistrictFootprint(districts, tree.x, tree.z, margin) ||
      inLandmarkFootprint(landmark, tree.x, tree.z, margin) ||
      extraExclusion?.(tree.x, tree.z, margin)
    );
  };
}

/** Straight, deliberately managed rows outside the Orchard racing corridor.
 * Candidates are rejected rather than moved through a building or onto the road. */
export function orchardPlan(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: PlantingExclusion,
): AuthoredTree[] {
  if (track.circuit.id !== 'aurel') return [];
  const clear = plantingClearance(track, services, extraExclusion),
    ground = terrainFor(track),
    anchor = trackPoint(),
    nearest = trackPoint(),
    trees: AuthoredTree[] = [];
  ORCHARD_PLOTS.forEach((plot, id) => {
    track.at(plot.station, anchor);
    for (let row = 0; row < plot.rows; row++)
      for (let column = 0; column < plot.columns; column++) {
        const along = (column - (plot.columns - 1) / 2) * ORCHARD_SPACING.along,
          across = plot.lateral - row * ORCHARD_SPACING.across,
          x = anchor.x + anchor.tx * along + anchor.nx * across,
          z = anchor.z + anchor.tz * along + anchor.nz * across,
          seed = treeSeed(x, z),
          end = column === 0 || column === plot.columns - 1;
        track.nearest(x, z, nearest);
        const tree: AuthoredTree = {
          x,
          y: ground.height(x, z),
          z,
          height: (end ? 5.1 : 4.6) + (seed % 7) * 0.065,
          width: (end ? 5.6 : 5.0) + (seed % 5) * 0.07,
          yaw: Math.atan2(anchor.tx, anchor.tz) + ((seed % 9) - 4) * 0.09,
          variant: end ? 'orchard-row-end' : 'orchard-open',
          layer: 'orchard',
          station: nearest.s,
          plot: id,
          row,
          column,
        };
        if (clear(tree)) trees.push(tree);
      }
  });
  return trees;
}

export function aurelVegetationPlan(
  track: Track,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: PlantingExclusion,
): AuthoredTree[] {
  if (track.circuit.id !== 'aurel') throw new Error('A51-A54 has not been authored for this venue');
  const near = vegetationPlan(track, 7109, services, extraExclusion),
    { groves, treeline } = grovePlan(track, 40913, services),
    orchard = orchardPlan(track, services, extraExclusion),
    clear = plantingClearance(track, services, extraExclusion),
    p = trackPoint(),
    zones = venuePlan(track).plantingZones;
  const convert = (tree: TreePlacement, layer: PlantingLayer): AuthoredTree => {
    track.nearest(tree.x, tree.z, p);
    const seed = treeSeed(tree.x, tree.z),
      narrow =
        layer === 'near'
          ? plantingCharacter(p.s, track.length, zones).species === 'upright'
          : tree.width / tree.height < 0.55,
      variant: TreeVariant = narrow
        ? seed % 2
          ? 'columnar-young'
          : 'columnar-mature'
        : seed % 2
          ? 'broadleaf-young'
          : 'broadleaf-mature';
    return {
      ...tree,
      width: narrow ? tree.height * 0.32 : tree.width,
      variant,
      layer,
      station: p.s,
    };
  };
  // New rows replace nearby scatter, not stack on top of it. The combined
  // foreground retains the original 650-tree cap; no arbitrary global density jump.
  const foreground = near
    .map((t) => convert(t, 'near'))
    .filter(
      (t) =>
        clear(t) &&
        orchard.every(
          (o) => Math.hypot(t.x - o.x, t.z - o.z) > crownRadius(t) + crownRadius(o) + 2,
        ),
    )
    .slice(0, Math.max(0, 650 - orchard.length));
  return [
    ...foreground,
    ...orchard,
    ...groves.map((t) => convert(t, 'grove')).filter(clear),
    ...treeline.map((t) => convert(t, 'treeline')).filter(clear),
  ];
}
