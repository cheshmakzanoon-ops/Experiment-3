export interface OfflineGpuStructureRow {
  id: number;
  processCount: number;
  count: number;
  completed: number;
  unfinished: number;
  ancestorCount: number;
  jointOpenCount: number;
}
export interface OfflineGpuStructureSummary {
  schema: 'offline-gpu-structural-coverage-v1';
  privacy: 'fixed-numeric-structure-only';
  parserVersion: '58.2';
  captureBytes: number;
  parseCompleted: true;
  parserExitStatus: 0;
  catalogueCounts: { selected: 10; unselected: 393; total: 403 };
  childTailCertified: false;
  ancestryScope: 'same-instance-ordered-same-track-open-decoder-flush-not-causation';
  bucketScope: 'gpu-token-scopes-excluding-parent-pairs';
  coverageMask: number;
  parserErrors: number;
  parserErrorStatRows: number;
  reportedDataLoss: number;
  dataLossStatRows: number;
  aggregate: OfflineGpuStructureRow;
  buckets: OfflineGpuStructureRow[];
  flush: OfflineGpuStructureRow;
  decoder: OfflineGpuStructureRow;
}
export const OFFLINE_GPU_STRUCTURE_QUERY: string;
export const OFFLINE_GPU_STRUCTURE_LIMITS: Readonly<{
  maxInputBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxSummaryBytes: number;
  processingMs: number;
}>;
export function decodeOfflineGpuStructureRows(
  stdout: unknown,
  captureBytes: number,
): OfflineGpuStructureSummary;
export function validateOfflineGpuStructureSummary(value: unknown): OfflineGpuStructureSummary;
