import type { spawn } from 'node:child_process';
import type { createReadStream } from 'node:fs';
export const NATIVE_TRACE_PROCESSOR: Readonly<{
  version: '58.2';
  bytes: number;
  sha256: string;
  maxInputBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxSummaryBytes: number;
  processingMs: number;
}>;
export const NATIVE_GPU_WORK_EVENTS: readonly Readonly<{ category: string; name: string }>[];
export const NATIVE_GPU_TRACE_QUERY: string;
export class NativeGpuTraceSummaryError extends Error {
  constructor(reason: string, parserExitStatus?: number | null);
  readonly reason: string;
  readonly parserExitStatus: number | null;
}
export interface NativeGpuWorkAggregate {
  id: number;
  processCount: number;
  count: number;
  completed: number;
  unfinished: number;
  firstNs: number;
  lastNs: number;
  totalDurationNs: number;
  maxDurationNs: number;
  unfinishedFlushAncestorCount: number;
  unfinishedUnderUnfinishedFlushCount: number;
}
export interface NativeGpuWorkSummary {
  version: 2;
  privacy: 'constant-label-numeric-summary-only';
  parserVersion: '58.2';
  captureBytes: number;
  parseCompleted: true;
  parserExitStatus: 0;
  parserErrors: number;
  parserErrorStatRows: number;
  reportedDataLoss: number;
  dataLossStatRows: number;
  otherGpuEvents: number;
  childTailCertified: false;
  durationScope: 'overlapping-cpu-work-spans-not-gpu-execution-time';
  coverage: 'typed-gpu-work-observed' | 'no-typed-gpu-work-observed';
  ancestryScope: 'same-track-descendants-of-unfinished-flush-not-causation';
  compileLinkDiscriminator:
    | 'same-track-open-compile-or-link-under-unfinished-flush-observed'
    | 'inconclusive';
  aggregate: NativeGpuWorkAggregate;
  events: (NativeGpuWorkAggregate & { name: string; category: string })[];
}
export function decodeNativeGpuTraceRows(
  stdout: string,
  captureBytes: number,
): NativeGpuWorkSummary;
export function validateNativeGpuTraceSummary(value: unknown): NativeGpuWorkSummary;
export function verifyNativeTraceProcessor(
  parserPath: string | undefined,
  deadlineAt: number,
  options?: { signal?: AbortSignal; openReadStream?: typeof createReadStream },
): Promise<void>;
export function runBoundedTraceProcessor(options: {
  parserPath: string;
  path: string;
  deadlineAt: number;
  signal?: AbortSignal;
  spawnProcess?: typeof spawn;
}): Promise<string>;
export function summarizeNativeGpuTrace(options: {
  path: string;
  parserPath?: string;
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<NativeGpuWorkSummary>;
