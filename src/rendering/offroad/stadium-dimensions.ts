import { Box3, Vector3 } from 'three';
import type { Track } from '../../simulation/track.ts';

/** Indoor stadium dimensions (m), shared by visible seating and static
 * replay-camera clearance. Keep the ceiling clear of every jump. */
export const STADIUM = Object.freeze({
  margin: 9,
  tiers: 20,
  rise: 0.78,
  depth: 1.02,
  seat: 0.62,
  roof: 34,
  occupancy: 0.82,
  concourse: 3.2,
});

const floors = new WeakMap<Track, Box3>();

/** Floor shared by the grandstands, lights, scenery and camera rigs. Wide
 * gate/pit runoff can extend beyond the ordinary nine-metre dirt apron.
 * Keep a chase-camera/service strip behind the physical crash padding. */
export function stadiumFloor(track: Track) {
  const cached = floors.get(track);
  if (cached) return cached;
  const lane = new Box3(), padding = new Box3(), point = new Vector3();
  for (const p of track.points) for (const side of [-1, 1]) {
    const edge = p.width * side, barrier = track.boundaryAt(p, side) * side;
    lane.expandByPoint(point.set(p.x + p.nx * edge, p.y, p.z + p.nz * edge));
    padding.expandByPoint(point.set(p.x + p.nx * barrier, p.y, p.z + p.nz * barrier));
  }
  lane.expandByVector(point.set(STADIUM.margin, 0, STADIUM.margin));
  padding.expandByVector(point.set(4.5, 0, 4.5));
  lane.union(padding);
  floors.set(track, lane);
  return lane;
}
