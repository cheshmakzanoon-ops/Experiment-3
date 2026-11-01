import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { OfflineGpuStructureSummary } from './offline-gpu-structure-prototype.mjs';

export class OfflineGpuStructureError extends Error {
  readonly reason: string;
  constructor(reason: string);
}
export function runBoundedStructuralProcessor(options: {
  parserPath: string;
  path: string;
  deadlineAt: number;
  signal?: AbortSignal;
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}): Promise<string>;
export function summarizeOfflineGpuStructure(options: {
  path: string;
  parserPath: string;
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<OfflineGpuStructureSummary>;
