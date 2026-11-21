import type * as T from 'three';
import { clamp } from '../../core/math.ts';
import { SURFACE, trackPoint, type TrackPoint } from '../../simulation/track.ts';
import { apronWidth } from '../../simulation/gp-course-edges.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import type { BuildQueue } from '../build-queue.ts';
import { drawnTerrain, type Terrain } from '../terrain.ts';
import type { VenueKitContext } from './context.ts';

/** The CircuitScene surface API the kit reuses, so verges and skirts carry
 * the same metre UVs, track UVs and edge attributes as every road ribbon. */
export interface RibbonHost {
  readonly construction: BuildQueue;
  ribbon(
    material: T.Material,
    options: {
      start?: number;
      end?: number;
      step?: number;
      offset: (s: number, t: number) => number;
      height?: (s: number, l: number, t: number) => number;
      columns?: number;
      include?: (s: number, lateral: number) => boolean;
      attributes?: Readonly<Record<string, (s: number, lateral: number) => number>>;
    },
  ): T.Mesh;
}

/** Offset from the road cross-section to a skirt knot. A small embed at
 * the far edge prevents light leaking through the join on a bank. */
export function catalogueSkirtOffset(
  p: TrackPoint,
  ground: Pick<Terrain, 'height'>,
  lateral: number,
  t: number,
) {
  const road = p.y + p.bank * clamp(lateral, -12, 12);
  const target = ground.height(p.x + p.nx * lateral, p.z + p.nz * lateral) - 0.08;
  return -0.05 + (target - road + 0.05) * t * t * (3 - 2 * t);
}

/** Verge between the run-off paint and the barrier (grass, sand, gravel trap
 * or asphalt run-off exactly where physics reads them), then a skirt beyond
 * the barrier that eases onto the venue terrain. Quads over another section
 * (hairpin legs, stacked or crossing roads) are dropped. */
export function queueGround(kit: VenueKitContext, host: RibbonHost) {
  const track = kit.track,
    gp = isGpCourse(track),
    p = trackPoint(),
    m = kit.materials,
    terrain = drawnTerrain(track);
  const shoulder = (s: number, side: number) => apronWidth(track.gpEdges?.at(s, side) ?? 1);
  const surfaceAt = (s: number, lateral: number) => track.runoffSurface(track.at(s, p), lateral);
  // GP venues: a gravel trap's ribbon reaches one quad into the grass either
  // side, carrying `gravelCover` (0 off the physical trap), so the trap ends
  // in scattered drifts (ground/gp-ground.ts) rather than a 4 m staircase.
  const scattered = (kind: number) => gp && kind === SURFACE.GRAVEL;
  const verge = (side: 1 | -1, kind: number, material: T.Material, lift: number) => ({
    step: 4,
    columns: 2,
    offset: (s: number, t: number) => {
      track.at(s, p);
      const a = p.width + shoulder(s, side) - (gp ? 0.14 : 0),
        b = Math.max(a, track.boundaryAt(p, side) + 1);
      return side * (a + (b - a) * t);
    },
    height: () => lift,
    include: (s: number, lateral: number) =>
      Math.abs(lateral) > track.at(s, p).width + shoulder(s, side) + 0.05 &&
      (surfaceAt(s, lateral) === kind ||
        (scattered(kind) &&
          (surfaceAt(s - 4, lateral) === kind || surfaceAt(s + 4, lateral) === kind))),
    ...(scattered(kind)
      ? {
          attributes: {
            gravelCover: (s: number, lateral: number) =>
              surfaceAt(s, lateral) === SURFACE.GRAVEL ? 1 : 0,
          },
        }
      : {}),
  });
  const skirt = (side: 1 | -1) => ({
    step: 4,
    columns: 4,
    offset: (s: number, t: number) => {
      track.at(s, p);
      const a = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
      return side * (a + 26 * t);
    },
    height: (s: number, l: number, t: number) => {
      track.at(s, p);
      return catalogueSkirtOffset(p, terrain, l, t);
    },
    include: (s: number, lateral: number) => {
      track.at(s, p);
      return !kit.overOtherSection(p.x + p.nx * lateral, p.z + p.nz * lateral, s, 0);
    },
  });
  const chunk = 80,
    count = Math.ceil(track.length / chunk);
  for (let i = 0; i < count; i++) {
    const start = (track.length * i) / count,
      end = (track.length * (i + 1)) / count;
    host.construction.add('Venue kit verges and run-off', 1, () => {
      for (const side of [-1, 1] as const)
        for (const [kind, material, lift] of [
          [SURFACE.GRASS, m.ground, -0.04],
          [SURFACE.GRAVEL, m.gravel, -0.027],
          [SURFACE.ASPHALT, m.runoff, -0.014],
        ] as const) {
          // Street walls stand inside the paint band: no verge to lay there.
          let present = false;
          for (let s = start; s < end && !present; s += 4) {
            track.at(s, p);
            const outer = track.boundaryAt(p, side) + 1,
              inner = p.width + shoulder(s, side),
              middle = side * (inner + Math.max(0, outer - inner) / 2);
            present = outer > inner + 0.2 && track.runoffSurface(p, middle) === kind;
          }
          if (present) host.ribbon(material, { start, end, ...verge(side, kind, material, lift) });
        }
    });
    host.construction.add('Venue kit terrain skirts', 2, () => {
      for (const side of [-1, 1] as const) host.ribbon(m.ground, { start, end, ...skirt(side) });
    });
  }
}
