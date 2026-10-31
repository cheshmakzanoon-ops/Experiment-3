import type * as T from 'three';
type Program = NonNullable<T.WebGLRenderer['info']['programs']>[number];
/** Prep-only CPU snapshot; deliberately no GL calls and no ordinary-frame hook. */
export function snapshotPrograms(programs: readonly Program[]) {
  return new Map(
    programs.map((program) => [program.id, { name: program.name, cacheKey: program.cacheKey }]),
  );
}
export function describeProgramChanges(
  before: ReturnType<typeof snapshotPrograms>,
  programs: readonly Program[],
) {
  const after = snapshotPrograms(programs);
  const oldIds = [...before.keys()];
  const newIds = [...after.keys()].filter((id) => !before.has(id));
  const removedIds = oldIds.filter((id) => !after.has(id));
  return {
    beforeCount: before.size,
    afterCount: after.size,
    oldIds: oldIds.slice(0, 512),
    oldIdsDropped: Math.max(0, oldIds.length - 512),
    newIds: newIds.slice(0, 512),
    newIdsDropped: Math.max(0, newIds.length - 512),
    removedIds: removedIds.slice(0, 512),
    removedIdsDropped: Math.max(0, removedIds.length - 512),
    newPrograms: newIds.slice(0, 12).map((id) => {
      const value = after.get(id)!;
      return {
        id,
        name: value.name.slice(0, 120),
        cacheKey: value.cacheKey.slice(0, 1200),
        cacheKeyTruncated: value.cacheKey.length > 1200,
      };
    }),
    newProgramsDropped: Math.max(0, newIds.length - 12),
  };
}
