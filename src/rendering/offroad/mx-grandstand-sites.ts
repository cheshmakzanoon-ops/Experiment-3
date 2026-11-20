import { mod } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { StandSpec } from '../venue-plan.ts';

// The outdoor stand's roof extends 0.75 m past the deck at either end.
// Include the fascia, rear footings and an allowance between track samples.
const HALF_DEPTH = 6.5 + 0.5;
const OFFSETS = [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30];

function clearsCourse(track: Track, site: StandSpec) {
  const point = track.at(site.s, trackPoint()),
    lateral = site.side * (track.boundaryAt(point, site.side) + 7 + 4.5),
    x = point.x + point.nx * lateral,
    z = point.z + point.nz * lateral,
    halfLength = site.length / 2 + 0.75 + 0.5;
  for (let i = 0; i < track.points.length - 1; i++) {
    const lane = track.points[i],
      left = track.boundaryAt(lane, -1) + 4,
      right = track.boundaryAt(lane, 1) + 4,
      offset = (right - left) / 2,
      radius = (right + left) / 2,
      dx = lane.x + lane.nx * offset - x,
      dz = lane.z + lane.nz * offset - z;
    // Project the complete barrier-to-barrier segment into the stand's frame.
    // Its midpoint and half length retain the wider side of the mechanics lane.
    const u = dx * point.nx + dz * point.nz,
      v = dx * point.tx + dz * point.tz,
      du = lane.nx * point.nx + lane.nz * point.nz,
      dv = lane.nx * point.tx + lane.nz * point.tz;
    if (
      Math.abs(u) > HALF_DEPTH + radius * Math.abs(du) ||
      Math.abs(v) > halfLength + radius * Math.abs(dv)
    )
      continue;
    // The third separating axis is perpendicular to the road cross-section.
    if (Math.abs(v * du - u * dv) <= HALF_DEPTH * Math.abs(dv) + halfLength * Math.abs(du))
      return false;
  }
  return true;
}

/** Fit the outdoor terraces beside the complete course, including the short
 * return from the last berm. The same plan drives the models and every
 * vegetation, spectator and trackside-equipment exclusion. */
export function fitMxGrandstands(track: Track, authored: readonly StandSpec[]) {
  const fitted: StandSpec[] = [];
  for (const site of authored) {
    for (const shift of OFFSETS) {
      const candidate = shift ? { ...site, s: site.s + shift } : site;
      const overlaps = fitted.some(
        (other) =>
          other.side === candidate.side &&
          Math.abs(mod(other.s - candidate.s + track.length / 2, track.length) - track.length / 2) <
            (other.length + candidate.length) / 2 + 4,
      );
      if (!overlaps && clearsCourse(track, candidate)) {
        fitted.push(candidate);
        break;
      }
    }
  }
  return fitted;
}
