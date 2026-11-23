import { clamp, mod } from '../../core/math.ts';
import { gpCornerShapes, isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { inStandFootprint } from '../grandstand.ts';
import { terrainFor } from '../terrain.ts';
import { districtPlan, inDistrictFootprint } from '../venue-districts.ts';
import { serviceSitePlan, inServiceFootprint } from '../venue-service-plan.ts';
import { inLandmarkFootprint, landmarkSitePlan } from '../venue-landmark.ts';
import { gpFarmsteadPlan, inGpFarmstead } from './gp-farmsteads.ts';
import { cataloguePlantingGround } from './planting-ground.ts';

export interface GpSpectatorBank {
  station: number;
  side: -1 | 1;
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
  rise: number;
}

const style: Record<string, readonly [number, number, number]> = {
  'poggio-alto': [77, 24, 3.4],
  'cape-wrenna': [61, 21, 2.7],
  haarveld: [84, 23, 2.4],
  montejaral: [73, 25, 3.1],
};
const cached = new WeakMap<Track, GpSpectatorBank[]>();

export function inGpSpectatorBank(
  sites: readonly GpSpectatorBank[],
  x: number,
  z: number,
  margin: number,
) {
  return sites.some((s) => {
    const dx = x - s.x,
      dz = z - s.z,
      c = Math.cos(s.yaw),
      n = Math.sin(s.yaw);
    return (
      Math.abs(c * dx - n * dz) < s.width / 2 + margin &&
      Math.abs(n * dx + c * dz) < s.length / 2 + margin
    );
  });
}

/** Two general-admission banks overlook distinct bends. Use the nearest
 * physical road for every edge of the bank, including the far leg of a
 * hairpin. The waterline, paddock, buildings and seated stands keep priority. */
export function gpSpectatorBankPlan(track: Track): readonly GpSpectatorBank[] {
  const previous = cached.get(track);
  if (previous) return previous;
  const sites: GpSpectatorBank[] = [];
  cached.set(track, sites);
  if (!isGpCourse(track)) return sites;
  const [length, width, rise] = style[track.circuit.id];
  const ground = cataloguePlantingGround(track),
    water = terrainFor(track).seaLevel;
  const services = serviceSitePlan(track),
    districts = districtPlan(track, services);
  const landmark = landmarkSitePlan(track, services, districts),
    farms = gpFarmsteadPlan(track);
  const sample = trackPoint(),
    near = trackPoint(),
    shape = gpCornerShapes(track);
  for (const fraction of [0.22, 0.68]) {
    let best = -Infinity,
      selected: GpSpectatorBank | undefined;
    for (const [i, corner] of track.circuit.corners.entries()) {
      if (shape[i].direction === 'straight') continue;
      const station = mod(corner.s + 0.2 * shape[i].exit, track.length);
      const lapGap = Math.abs(
        mod(station - fraction * track.length + track.length / 2, track.length) - track.length / 2,
      );
      if (lapGap > track.length * 0.21 || sites.some((s) => Math.abs(s.station - station) < 340))
        continue;
      track.at(station, sample);
      for (const side of [-1, 1] as const) {
        const lateral = side * (track.boundaryAt(sample, side) + width / 2 + 22);
        const x = sample.x + sample.nx * lateral,
          z = sample.z + sample.nz * lateral;
        if (!Number.isFinite(x + z)) continue;
        let min = Infinity,
          max = -Infinity,
          clear = true;
        for (const v of [-0.5, -0.25, 0, 0.25, 0.5]) {
          for (const u of [-0.5, 0, 0.5]) {
            const wx = x + sample.nx * u * width + sample.tx * v * length;
            const wz = z + sample.nz * u * width + sample.tz * v * length;
            const l = track.nearest(wx, wz, near),
              nearestSide = l < 0 ? -1 : 1;
            const height = ground(near.s, l, wx, wz);
            if (
              Math.abs(l) < track.boundaryAt(near, nearestSide) + 11 ||
              (nearestSide === track.pit.side && track.isPitSection(near.s)) ||
              (water !== null && height < water + 1.4) ||
              inStandFootprint(track, wx, wz, 7) ||
              inServiceFootprint(services, wx, wz, 5) ||
              inDistrictFootprint(districts, wx, wz, 6) ||
              inLandmarkFootprint(landmark, wx, wz, 6) ||
              inGpFarmstead(farms, wx, wz, 7)
            ) {
              clear = false;
              break;
            }
            min = Math.min(min, height);
            max = Math.max(max, height);
          }
          if (!clear) break;
        }
        if (!clear || max - min > 8 || min + rise < sample.y - 0.25) continue;
        const score = -0.018 * lapGap - 0.45 * (max - min) + clamp(min - sample.y, -2, 3);
        if (score > best) {
          best = score;
          selected = {
            station,
            side,
            x,
            z,
            yaw: Math.atan2(sample.tx, sample.tz),
            length,
            width,
            rise,
          };
        }
      }
    }
    if (selected) sites.push(selected);
  }
  return sites;
}
