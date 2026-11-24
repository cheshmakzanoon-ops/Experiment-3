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

/** Survey the two real mesh triangles under a narrow marker. On a convex
 * take-off the analytic profile can stand several centimetres above the
 * straight chord actually drawn between render rows. Work in world XZ so
 * the installed height remains correct through the inside of a bend. */
export function mxMarkerFoot(
  track: Track,
  terrain: TrackTerrainSurface['terrain'],
  s: number,
  lateral: number,
) {
  const length = track.length;
  const station = ((s % length) + length) % length;
  const along = COURSE_CELL.along * 2,
    across = COURSE_CELL.lateral * 2;
  const p = track.at(station, trackPoint());
  const x = p.x + p.nx * lateral,
    z = p.z + p.nz * lateral;
  const ray = new T.Ray(new T.Vector3(x, p.y + 100, z), new T.Vector3(0, -1, 0));
  const hit = new T.Vector3(),
    nearest = trackPoint();
  function vertex(r: number, c: number) {
    const at = Math.min(length, r * along);
    track.at(at, p);
    let l = terrain.lateralMin + c * across;
    if (p.curvature * l > 0.85) l = 0.85 / p.curvature;
    return new T.Vector3(p.x + p.nx * l, terrain.baseHeight(at, l), p.z + p.nz * l);
  }
  function ground(at: number, l: number) {
    const r = Math.floor(at / along);
    const c = Math.min(
      terrain.renderColumns - 1,
      Math.max(0, Math.floor((l - terrain.lateralMin) / across)),
    );
    const test = (row: number, column: number) => {
      if (column < 0 || column >= terrain.renderColumns) return -Infinity;
      row = (row + terrain.renderRows) % terrain.renderRows;
      const a = vertex(row, column),
        b = vertex(row, column + 1),
        d = vertex(row + 1, column),
        e = vertex(row + 1, column + 1);
      return ray.intersectTriangle(a, d, b, false, hit) ||
        ray.intersectTriangle(e, b, d, false, hit)
        ? hit.y
        : -Infinity;
    };
    const y = test(r, c);
    if (Number.isFinite(y)) return y;
    // A curved row's straight edge can put the world point in the next cell.
    let adjacent = -Infinity;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) adjacent = Math.max(adjacent, test(r + dr, c + dc));
    return adjacent;
  }
  const l = track.nearest(x, z, nearest);
  // Adjacent arena lanes can overlap on their verges. The upper strip is the
  // ground a spectator actually sees beneath the shaft.
  const gap = Math.abs(((nearest.s - station + 1.5 * length) % length) - length * 0.5);
  const top =
    gap > 6 ? Math.max(ground(station, lateral), ground(nearest.s, l)) : ground(station, lateral);
  return Number.isFinite(top) ? top : terrain.baseHeight(station, lateral);
}
