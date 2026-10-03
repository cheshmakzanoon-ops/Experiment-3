/** Environment identity must survive camera/quality changes. Runtime LOD
 * counters belong in the separate detail report, not in retained asset IDs. */
export function infrastructureIdentity<
  T extends { selectedLods: number[]; selectedTriangles?: number },
>(report: T | null) {
  if (!report) return null;
  const { selectedLods: _lods, selectedTriangles: _triangles, ...identity } = report;
  return identity;
}
