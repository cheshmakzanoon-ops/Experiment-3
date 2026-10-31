import type { SuppliedDrawRanges } from './supplied-draw-ranges.ts';

/** CPU-only diagnostic bounds, not a rendering/quality limit. */
export const INDEX_EVIDENCE_SUBJECT_LIMIT = 12;
export const INDEX_EVIDENCE_CAMERA_LIMIT = INDEX_EVIDENCE_SUBJECT_LIMIT * 3;
export type IndexCounterOwner = Pick<SuppliedDrawRanges, 'enabled' | 'compact' | 'diagnostics'>;
type Subject = { suppliedPlayer?: { lods?: { drawRanges?: IndexCounterOwner } | null } | null };

export function compactIndexCounts(owner: IndexCounterOwner) {
  const { buffers, uploads, uploadedBytes } = owner.diagnostics().compacted;
  return { buffers, uploads, uploadedBytes };
}

/** Deliberately omit render submissions/triangles: these are owned-pool counters
 * across ALL cameras, including shadow/probe/wet passes not primed by this path. */
export function snapshotSuppliedIndexEvidence(subjects: readonly Subject[]) {
  const sampledSubjects = Math.min(subjects.length, INDEX_EVIDENCE_SUBJECT_LIMIT);
  const owners = [];
  let suppliedOwners = 0,
    eligibleOwners = 0,
    buffers = 0,
    uploads = 0,
    uploadedBytes = 0;
  for (let subject = 0; subject < sampledSubjects; subject++) {
    const ranges = subjects[subject].suppliedPlayer?.lods?.drawRanges;
    if (!ranges) continue;
    const data = ranges.diagnostics();
    const compacted = {
      buffers: data.compacted.buffers,
      uploads: data.compacted.uploads,
      uploadedBytes: data.compacted.uploadedBytes,
    };
    const eligible = ranges.enabled && ranges.compact && data.meshes > 0;
    suppliedOwners++;
    if (eligible) eligibleOwners++;
    buffers += compacted.buffers;
    uploads += compacted.uploads;
    uploadedBytes += compacted.uploadedBytes;
    owners.push({ subject, eligible, meshBindings: data.meshes, compacted });
  }
  return {
    subjects: subjects.length,
    sampledSubjects,
    omittedSubjects: subjects.length - sampledSubjects,
    truncated: subjects.length > sampledSubjects,
    suppliedOwners,
    eligibleOwners,
    compacted: { buffers, uploads, uploadedBytes },
    owners,
  };
}
