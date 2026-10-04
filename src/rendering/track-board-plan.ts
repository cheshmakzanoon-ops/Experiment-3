import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { AUREL_VENUE, venuePlan } from './venue-plan.ts';
import { timingSensorPlan } from './track-signal-plan.ts';
export const BRAKING_CORNERS = AUREL_VENUE.brakingBoards;
export const BRAKING_DISTANCES = Object.freeze([50, 100, 150]);
export interface TrackBoardSite {
  s: number;
  lateral: number;
  text: string;
  variant: 'clean' | 'worn' | 'sector';
  x: number;
  y: number;
  z: number;
  yaw: number;
}
function boardSite(
  track: Track,
  s: number,
  lateral: number,
  text: string,
  variant: TrackBoardSite['variant'],
): TrackBoardSite {
  const p = track.at(s, trackPoint());
  return Object.freeze({
    s,
    lateral,
    text,
    variant,
    x: p.x + p.nx * lateral,
    y: p.y + p.bank * Math.max(-12, Math.min(12, lateral)),
    z: p.z + p.nz * lateral,
    yaw: Math.atan2(p.tx, p.tz) + Math.PI,
  });
}
/** Retain the eighteen original braking stations, offsets and labels. Only
 * their facing is corrected toward approaching traffic; the road is untouched. */
export function trackBoardPlan(track: Track): readonly TrackBoardSite[] {
  const sites: TrackBoardSite[] = [];
  for (const [i, corner] of venuePlan(track).brakingBoards.entries())
    for (const distance of BRAKING_DISTANCES)
      sites.push(
        boardSite(
          track,
          corner - distance,
          -18,
          String(distance),
          (i + distance / 50) % 4 === 0 ? 'worn' : 'clean',
        ),
      );
  for (const [i, s] of [track.length / 3, (track.length * 2) / 3].entries()) {
    const sensor = timingSensorPlan(track).find((p) => Math.abs(p.s - s) < 1e-7);
    if (!sensor) continue;
    const site = boardSite(
        track,
        s,
        sensor.side * (track.boundary(s, sensor.side) + 2.45),
        `S${i + 1}`,
        'sector',
      ),
      matrix = trackBoardMatrix(site);
    let clear = true;
    for (const x of [-0.64, 0, 0.64])
      for (const z of [-0.28, 0, 0.17]) {
        const p = new T.Vector3(x, 0, z).applyMatrix4(matrix),
          q = trackPoint(),
          l = track.nearest(p.x, p.z, q);
        if (
          Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1) < 1.7 ||
          inStandFootprint(track, p.x, p.z, 0.25)
        )
          clear = false;
      }
    if (clear) sites.push(site);
  }
  return Object.freeze(sites);
}
export function trackBoardMatrix(site: TrackBoardSite) {
  return new T.Matrix4().makeRotationY(site.yaw).setPosition(site.x, site.y, site.z);
}
export function conformTrackBoardGeometry(
  template: T.BufferGeometry,
  track: Track,
  site: TrackBoardSite,
) {
  const g = template.clone().applyMatrix4(trackBoardMatrix(site)),
    p = g.getAttribute('position'),
    src = template.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    if (src.getY(i) < 0) {
      const q = trackPoint(),
        l = track.nearest(p.getX(i), p.getZ(i), q),
        ground = q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
      p.setY(i, Math.min(p.getY(i), ground - 0.02));
    }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
