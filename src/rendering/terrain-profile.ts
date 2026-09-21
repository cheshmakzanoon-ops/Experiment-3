export function terrainHeight(x: number, z: number) {
  const distance = Math.hypot(x, z);
  return (
    -4 +
    Math.min(1, Math.max(0, (distance - 680) / 240)) ** 2 *
      (24 * Math.sin(x * 0.006 + z * 0.002) ** 2 + 17 * Math.sin(z * 0.008 - x * 0.001) ** 4) +
    Math.max(0, distance - 680) * 0.033 * (0.3 + 0.7 * Math.sin(x * 0.004 + z * 0.002) ** 2) +
    Math.max(0, distance - 1000) * 0.038 * Math.cos(x * 0.003 - z * 0.004) ** 2
  );
}
