/** Integer lattice hash in [0, 1). Deterministic across platforms (32-bit ops). */
function latticeHash(ix: number, iz: number) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const a = latticeHash(ix, iz),
    b = latticeHash(ix + 1, iz),
    c = latticeHash(ix, iz + 1),
    d = latticeHash(ix + 1, iz + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/** Ridged multifractal in [0, 1]: sharp crests and eroded valleys read as
 * mountain ranges rather than the rounded sinusoidal mounds used before. */
export function ridgedNoise(x: number, z: number, octaves = 5) {
  let sum = 0,
    amplitude = 0.5,
    frequency = 1,
    weight = 1,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    // Rotate each octave so lattice axes never align into visible grid ridges.
    const rx = x * frequency * 0.8 - z * frequency * 0.6 + i * 17.3,
      rz = x * frequency * 0.6 + z * frequency * 0.8 - i * 9.1;
    let n = 1 - Math.abs(valueNoise(rx, rz) * 2 - 1);
    n *= n * weight;
    weight = Math.min(1, n * 1.6);
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** Distant landform height. Inside 680 m of the origin the ground is the flat
 * -4 m venue datum (buildings, paddock, planting and apron rely on it). Beyond
 * it, the original rolling foothills continue and a ridged range rises from
 * roughly 1.2 km, giving a layered, readable horizon without touching any
 * physical track or collision geometry. */
export function terrainHeight(x: number, z: number) {
  const distance = Math.hypot(x, z);
  const foothills =
    Math.min(1, Math.max(0, (distance - 680) / 240)) ** 2 *
      (24 * Math.sin(x * 0.006 + z * 0.002) ** 2 + 17 * Math.sin(z * 0.008 - x * 0.001) ** 4) +
    Math.max(0, distance - 680) * 0.033 * (0.3 + 0.7 * Math.sin(x * 0.004 + z * 0.002) ** 2) +
    Math.max(0, distance - 1000) * 0.038 * Math.cos(x * 0.003 - z * 0.004) ** 2;
  if (distance <= 680) return -4 + foothills;
  // Low-amplitude undulation breaks up the analytic foothills near the venue.
  const near = Math.min(1, (distance - 680) / 320);
  const undulation = near * near * 7 * (valueNoise(x * 0.012 + 3.1, z * 0.012 - 7.7) - 0.5);
  // The range: ridge crests up to ~260 m at the terrain edge.
  const t = Math.min(1, Math.max(0, (distance - 1150) / 1100));
  const rise = t * t * (3 - 2 * t);
  const range = rise * (40 + 220 * ridgedNoise(x * 0.00105 + 11.3, z * 0.00105 - 4.2));
  return -4 + foothills + undulation + range;
}
