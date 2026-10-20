import { clamp, mod } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import type { JumpSurvey } from '../../simulation/offroad/profile.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { tracksideRigs } from '../trackside.ts';
import { mxFurnitureGround, planMxTracksideFurniture } from './mx-trackside-furniture.ts';
import { STADIUM } from './stadium-dimensions.ts';

export interface MxCourseSite {
  kind: 'barn' | 'quarry' | 'ridge-deck';
  name: string;
  station: number;
  x: number;
  /** Level base above the highest sampled ground in the complete footprint.
   * Visible individual feet still descend to mxFurnitureGround. */
  y: number;
  z: number;
  /** Local -Z faces the course. */
  yaw: number;
  radius: number;
}

export interface MxJumpGuide {
  jump: JumpSurvey;
  index: number;
  station: number;
  x: number;
  y: number;
  z: number;
  /** Local +Z faces riders arriving along the approach. */
  yaw: number;
  radius: number;
}

const CLEARANCE = 0.8;
/** Full optical envelope, including board edges and the tallest roof cap. */
export const MX_COURSE_SITE_HEIGHT = Object.freeze({ landmark: 7.5, guide: 1.6 });
const SITE_GAP = 1;
const ALONG = [0, -6, 6, -12, 12, -18, 18, -24, 24, -30, 30];
const SETBACKS = [1, 3, 6, 10, 15, 21];

/** Static visual locations derived from the same surveyed features riders
 * encounter. A circular envelope contains every rotated model corner and is
 * rejected against every centreline segment, including neighbouring SX lanes.
 * No terrain, racing width, collision boundary or jump survey is modified. */
export function planMxCourseSites(track: Track): {
  landmarks: MxCourseSite[];
  guides: MxJumpGuide[];
  rejected: number;
} {
  const surface = Track.offroadOf(track);
  if (
    !(surface instanceof TrackTerrainSurface) ||
    !['motocross', 'supercross'].includes(surface.kind)
  )
    throw new Error('MX course sites require a motocross or supercross course');
  const indoor = surface.kind === 'supercross';
  const lanes = track.points.slice(0, -1).map((a, index) => {
    const b = track.points[index + 1];
    return {
      x: a.x,
      z: a.z,
      dx: b.x - a.x,
      dz: b.z - a.z,
      width:
        Math.max(
          track.boundaryAt(a, -1),
          track.boundaryAt(a, 1),
          track.boundaryAt(b, -1),
          track.boundaryAt(b, 1),
          surface.course.legalWidth(a.width, a.s, -1),
          surface.course.legalWidth(a.width, a.s, 1),
          surface.course.legalWidth(b.width, b.s, -1),
          surface.course.legalWidth(b.width, b.s, 1),
        ) + 0.1,
    };
  });
  const floor = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  if (indoor) {
    const p = trackPoint();
    // Same station interval, edge definition and margin as the actual bowl.
    for (let s = 0; s < track.length; s += 4) {
      track.at(s, p);
      for (const side of [-1, 1]) {
        const x = p.x + p.nx * p.width * side,
          z = p.z + p.nz * p.width * side;
        floor.minX = Math.min(floor.minX, x - STADIUM.margin);
        floor.maxX = Math.max(floor.maxX, x + STADIUM.margin);
        floor.minZ = Math.min(floor.minZ, z - STADIUM.margin);
        floor.maxZ = Math.max(floor.maxZ, z + STADIUM.margin);
      }
    }
  }
  const furniture = planMxTracksideFurniture(track).sites,
    cameras = tracksideRigs(track),
    landmarks: MxCourseSite[] = [],
    guides: MxJumpGuide[] = [];
  const sightlines = cameras.flatMap((camera) =>
    [-0.35, 0, 0.35].map((fraction) => {
      const target = track.at(camera.centerS + camera.coverageM * fraction, trackPoint());
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        dx: target.x - camera.position.x,
        dy: surface.terrain.baseHeight(target.s, 0) + 1.1 - camera.position.y,
        dz: target.z - camera.position.z,
      };
    }),
  );
  let rejected = 0;

  const candidate = (
    station: number,
    side: number,
    setback: number,
    radius: number,
    height: number,
  ) => {
    station = mod(station, track.length);
    const p = track.at(station, trackPoint()),
      lateral = side * (track.boundaryAt(p, side) + setback + radius),
      x = p.x + p.nx * lateral,
      z = p.z + p.nz * lateral,
      reach = radius + CLEARANCE;
    if (
      (indoor &&
        (x - reach < floor.minX ||
          x + reach > floor.maxX ||
          z - reach < floor.minZ ||
          z + reach > floor.maxZ)) ||
      inStandFootprint(track, x, z, reach) ||
      furniture.some((q) => Math.hypot(x - q.x, z - q.z) < radius + q.radius + SITE_GAP) ||
      cameras.some((q) => Math.hypot(x - q.position.x, z - q.position.z) < radius + 2.4) ||
      [...landmarks, ...guides].some(
        (q) => Math.hypot(x - q.x, z - q.z) < radius + q.radius + SITE_GAP,
      )
    )
      return null;
    for (const lane of lanes) {
      const clearance = reach + lane.width;
      if (
        x < Math.min(lane.x, lane.x + lane.dx) - clearance ||
        x > Math.max(lane.x, lane.x + lane.dx) + clearance ||
        z < Math.min(lane.z, lane.z + lane.dz) - clearance ||
        z > Math.max(lane.z, lane.z + lane.dz) + clearance
      )
        continue;
      const lengthSquared = lane.dx * lane.dx + lane.dz * lane.dz,
        t =
          lengthSquared > 1e-8
            ? clamp(((x - lane.x) * lane.dx + (z - lane.z) * lane.dz) / lengthSquared, 0, 1)
            : 0;
      if (Math.hypot(x - lane.x - t * lane.dx, z - lane.z - t * lane.dz) < clearance) return null;
    }
    // The level reference includes intermediate points as well as the
    // circumference. Builders use individual ground samples for their feet.
    let low = Infinity,
      high = -Infinity;
    const sample = (dx: number, dz: number) => {
      const y = mxFurnitureGround(track, x + dx, z + dz);
      low = Math.min(low, y);
      high = Math.max(high, y);
    };
    sample(0, 0);
    for (const ring of [0.5, 1])
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        sample(Math.sin(angle) * radius * ring, Math.cos(angle) * radius * ring);
      }
    if (!Number.isFinite(low + high)) return null;
    // Preserve fixed broadcast coverage, not just physical camera supports.
    // Intersect the complete cylinder interval: testing only the nearest ray
    // point could miss a low corner of a descending sightline.
    for (const ray of sightlines) {
      const lengthSquared = ray.dx * ray.dx + ray.dz * ray.dz;
      if (lengthSquared < 1e-8) continue;
      const dx = x - ray.x,
        dz = z - ray.z,
        centre = (dx * ray.dx + dz * ray.dz) / lengthSquared,
        squaredDistance = (dx - centre * ray.dx) ** 2 + (dz - centre * ray.dz) ** 2,
        allowance = (radius + 0.25) ** 2 - squaredDistance;
      if (allowance < 0) continue;
      const halfInterval = Math.sqrt(allowance / lengthSquared),
        enter = Math.max(0, centre - halfInterval),
        leave = Math.min(1, centre + halfInterval);
      if (enter > leave) continue;
      const firstY = ray.y + ray.dy * enter,
        lastY = ray.y + ray.dy * leave;
      if (Math.max(firstY, lastY) >= low - 0.1 && Math.min(firstY, lastY) <= high + height + 0.1)
        return null;
    }
    return { station, x, y: high + 0.03, z, radius, relief: high - low, p };
  };

  if (!indoor) {
    const anchors: {
      kind: MxCourseSite['kind'];
      name: string;
      station?: number;
      radius: number;
    }[] = [
      {
        kind: 'barn',
        name: 'BARN DOUBLE',
        station: surface.course.jumps.find((j) => j.name === 'BARN DOUBLE')?.takeoff,
        radius: 8,
      },
      {
        kind: 'quarry',
        name: 'QUARRY',
        station: track.circuit.corners.find((c) => c.name === 'QUARRY')?.s,
        radius: 11,
      },
      {
        kind: 'ridge-deck',
        name: 'SKY TRIPLE',
        station: surface.course.jumps.find((j) => j.name === 'SKY TRIPLE')?.takeoff,
        radius: 7,
      },
    ];
    for (const anchor of anchors) {
      if (anchor.station === undefined) continue;
      let found = false;
      for (const along of ALONG) {
        for (const setback of SETBACKS) {
          for (const side of [-1, 1]) {
            const site = candidate(
              anchor.station + along,
              side,
              setback,
              anchor.radius,
              MX_COURSE_SITE_HEIGHT.landmark,
            );
            if (!site || site.relief > (anchor.kind === 'quarry' ? 5 : 2.4)) {
              rejected++;
              continue;
            }
            landmarks.push({
              kind: anchor.kind,
              name: anchor.name,
              station: site.station,
              x: site.x,
              y: site.y,
              z: site.z,
              radius: site.radius,
              yaw: Math.atan2(site.x - site.p.x, site.z - site.p.z),
            });
            found = true;
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
    }
  }

  for (const [index, jump] of surface.course.jumps.entries()) {
    let found = false;
    for (const before of [18, 16, 14, 12, 10, 8]) {
      for (const setback of [1, 1.75, 3, 4.5, 6]) {
        for (const side of [-1, 1]) {
          const site = candidate(
            jump.start - before,
            side,
            setback,
            1.5,
            MX_COURSE_SITE_HEIGHT.guide,
          );
          if (!site || site.relief > 0.65) {
            rejected++;
            continue;
          }
          guides.push({
            jump,
            index,
            station: site.station,
            x: site.x,
            y: site.y,
            z: site.z,
            radius: site.radius,
            yaw: Math.atan2(-site.p.tx, -site.p.tz),
          });
          found = true;
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
  }
  return { landmarks, guides, rejected };
}
