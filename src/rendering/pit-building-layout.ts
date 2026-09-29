import { Track, trackPoint } from '../simulation/track.ts';

/** Existing garage datums: +X into the building, -X to pits, +Z along the row. */
export const PIT_BUILDING_CHUNKS = [
  { id: 'A', station: 79, firstBay: 0, kind: 'service' },
  { id: 'B', station: 106, firstBay: 3, kind: 'operations' },
  { id: 'C', station: 133, firstBay: 6, kind: 'hospitality' },
  { id: 'D', station: 160, firstBay: 9, kind: 'service' },
] as const;
export const PIT_BUILDING_LATERAL = 35;
export const PIT_BUILDING_LIMITS = {
  triangles: [140000, 55000, 10000],
  bytes: 12 * 1024 * 1024,
  materials: 9,
  images: 3,
} as const;
export function pitBuildingLayout(track: Track) {
  const anchor = (station: number) => {
    const p = track.at(station, trackPoint());
    return {
      x: p.x + p.nx * PIT_BUILDING_LATERAL,
      y: p.y + p.bank * 12,
      z: p.z + p.nz * PIT_BUILDING_LATERAL,
      yaw: Math.atan2(p.tx, p.tz),
    };
  };
  return PIT_BUILDING_CHUNKS.map((chunk) => {
    const centre = anchor(chunk.station);
    const c = Math.cos(centre.yaw),
      s = Math.sin(centre.yaw);
    const bays = [0, 1, 2].map((j) => {
      const index = chunk.firstBay + j,
        station = 70 + index * 9,
        p = anchor(station);
      const dx = p.x - centre.x,
        dz = p.z - centre.z;
      return {
        index,
        station,
        x: c * dx - s * dz,
        y: p.y - centre.y,
        z: s * dx + c * dz,
        yaw: p.yaw - centre.yaw,
      };
    });
    if (
      ![...Object.values(centre), ...bays.flatMap((b) => Object.values(b))].every(Number.isFinite)
    )
      throw new Error('Invalid A21 track placement');
    return { ...chunk, ...centre, bays };
  });
}
