import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { COURSE_CELL } from '../../simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { terrainFor } from '../terrain.ts';

/** Read only the ground already visible in the venue: the MX terrain band
 * and the four-segment terrain skirt. No hidden flattening or physics edits. */
export function mxFurnitureGround(track: Track, x: number, z: number) {
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface)) throw new Error('MX furniture requires terrain');
  const p = trackPoint(),
    l = track.nearest(x, z, p),
    side = l < 0 ? -1 : 1;
  const start = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
  const t = clamp((Math.abs(l) - start) / 26, 0, 1);
  const road = p.y + p.bank * clamp(l, -12, 12);
  const ground = terrainFor(track);
  const knot = (u: number) => {
    const lateral = side * (start + 26 * u);
    const ry = p.y + p.bank * clamp(lateral, -12, 12);
    const natural = ground.height(p.x + p.nx * lateral, p.z + p.nz * lateral) - 0.08;
    return ry - 0.05 + (natural - ry + 0.05) * u * u * (3 - 2 * u);
  };
  const lo = Math.min(3, Math.floor(t * 4)),
    f = t * 4 - lo;
  const skirt = Math.abs(l) < start ? road - 0.04 : knot(lo / 4) * (1 - f) + knot((lo + 1) / 4) * f;
  const withinBand =
    l >= surface.terrain.lateralMin &&
    l <= surface.terrain.originX + surface.terrain.renderColumns * COURSE_CELL.lateral * 2 &&
    !(p.curvature * l > 0 && Math.abs(l) > 0.85 / Math.abs(p.curvature));
  return withinBand ? Math.max(skirt, surface.terrain.baseHeight(p.s, l)) : skirt;
}

/** Fit a rigid prop to four ground contacts. The lateral and longitudinal
 * grades come from opposing pairs, so a rut beneath just one corner cannot
 * rotate the whole prop about a single edge. +Z is the prop's heading. */
export function mxFootprintMatrix(
  track: Track,
  x: number,
  z: number,
  yaw: number,
  width: number,
  length: number,
  offset = 0,
) {
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  const sample = (side: number, end: number) =>
    mxFurnitureGround(track, x + cos * side + sin * end, z - sin * side + cos * end);
  const a = sample(-width / 2, -length / 2),
    b = sample(width / 2, -length / 2);
  const c = sample(-width / 2, length / 2),
    d = sample(width / 2, length / 2);
  const sideGrade = (b + d - a - c) / (2 * width);
  const alongGrade = (c + d - a - b) / (2 * length);
  const up = new T.Vector3(
    -cos * sideGrade - sin * alongGrade,
    1,
    sin * sideGrade - cos * alongGrade,
  ).normalize();
  const right = new T.Vector3(cos, sideGrade, -sin).normalize();
  const forward = right.clone().cross(up).normalize();
  return new T.Matrix4()
    .makeBasis(right, up, forward)
    .setPosition(x + up.x * offset, (a + b + c + d) / 4 + up.y * offset, z + up.z * offset);
}
