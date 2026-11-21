import { smoothstep } from './noise.ts';

export type Crop = 'barley' | 'wheat' | 'stubble';
function plot(x: number, z: number, bearing: number, length: number, width: number, crop: Crop, spacing: number) {
  const dx = Math.cos(bearing), dz = Math.sin(bearing);
  return Object.freeze({ x, z, dx, dz, length, width, crop, spacing,
    boundX: Math.abs(dx) * length + Math.abs(dz) * width,
    boundZ: Math.abs(dz) * length + Math.abs(dx) * width });
}
/** Solvane's lowland fields, surveyed inside the actual country-road loops.
 * Length and width are half-extents. Row bearings follow each parcel. */
export const FARM_FIELDS = Object.freeze([
  plot(-2395, -1176, 1.463, 68, 27, 'wheat', 0.28),
  plot(-2403, -1386, 1.594, 62, 25, 'stubble', 0.27),
  plot(-1647, -413, 0.186, 65, 25, 'barley', 0.24),
  plot(-1836, -369, 0.367, 61, 27, 'wheat', 0.28),
  plot(1447, 36, -0.478, 66, 25, 'stubble', 0.27),
  plot(1628, -59, -0.489, 68, 27, 'barley', 0.24),
  plot(2905, -773, 0.032, 54, 21, 'wheat', 0.28),
  plot(3121, -796, 0.515, 64, 25, 'barley', 0.24),
]);
export type FarmField = (typeof FARM_FIELDS)[number];
export const TRAMLINE = Object.freeze({ pitch: 12, wheel: 0.87, edge0: 0.18, edge1: 0.34, headland: 4.4 });
export function fieldAt(x: number, z: number) {
  for (const f of FARM_FIELDS) {
    const X = x - f.x, Z = z - f.z;
    if (Math.abs(X) > f.boundX || Math.abs(Z) > f.boundZ) continue;
    if (Math.abs(X * f.dx + Z * f.dz) <= f.length && Math.abs(Z * f.dx - X * f.dz) <= f.width) return f;
  }
  return null;
}
/** Tyre tracks of repeated implement passes: continuous fertile headlands,
 * twin pressed soil tracks along the working rows. */
export function tramlineCoverage(along: number, across: number, f: FarmField) {
  const lane = across - TRAMLINE.pitch * Math.round(across / TRAMLINE.pitch);
  const d = Math.abs(Math.abs(lane) - TRAMLINE.wheel);
  const border = Math.min(f.length - Math.abs(along), f.width - Math.abs(across));
  return (1 - smoothstep(TRAMLINE.edge0, TRAMLINE.edge1, d)) *
    smoothstep(TRAMLINE.headland, TRAMLINE.headland + 1.1, border);
}
