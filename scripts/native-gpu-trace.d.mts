import type { writeFile } from 'node:fs/promises';
import type { NativeGpuWorkSummary } from './native-gpu-trace-summary.mjs';
import type { FirstGraphicsFault } from './native-smoke-control.mjs';

export type NativeGpuTraceCategory =
  | 'gpu'
  | 'gpu.service'
  | 'gpu.angle'
  | 'viz'
  | 'toplevel'
  | 'disabled-by-default-gpu.service'
  | 'disabled-by-default-gpu.device'
  | 'disabled-by-default-gpu.debug'
  | 'disabled-by-default-angle';

export const NATIVE_GPU_TRACE: Readonly<{
  bufferKiB: number;
  scope: 'unchanged-babylon-inspect-through-authored-wheel-check-or-first-gpu-fault';
  maxFileBytes: number;
  setupMs: number;
  stopMs: number;
  categoryInventory: Readonly<{
    maxGroups: number;
    maxGroupCharacters: number;
    maxBytes: number;
  }>;
  categories: readonly NativeGpuTraceCategory[];
}>;

export function nativeGpuTraceEnabled(value?: string): boolean;
export function nativeGpuTraceCategories(available: unknown): NativeGpuTraceCategory[];
export interface NativeGpuTraceCategoryInventory {
  input: 'array' | 'not-array';
  reportedGroups: number | null;
  scannedGroups: number;
  omittedGroups: number | null;
  malformedGroups: number;
  oversizedGroups: number;
  truncated: boolean;
  limits: typeof NATIVE_GPU_TRACE.categoryInventory;
  matchedCategories: NativeGpuTraceCategory[];
}
export function nativeGpuTraceCategoryInventory(
  available: unknown,
): NativeGpuTraceCategoryInventory;

export interface NativeGpuTraceSource {
  commit: string;
  fingerprint: string;
  electron: string;
}

export interface NativeGpuTraceConfig {
  included_categories: NativeGpuTraceCategory[];
  recording_mode: 'record-continuously';
  trace_buffer_size_in_kb: number;
  enable_argument_filter: true;
}

export interface NativeGpuTraceAdapter {
  categories(): Promise<string[]>;
  start(config: NativeGpuTraceConfig): Promise<void>;
  stop(path: string): Promise<string>;
}

export interface NativeGpuTraceRetainedOutput {
  retained: true;
  file: string;
  bytes: number;
  sha256: string;
  rawTraceUploaded: false;
  captureValid: true;
  parsed: true;
  gpuWorkObserved: boolean;
}

export type NativeGpuTraceOutput = NativeGpuTraceRetainedOutput;

export interface NativeGpuTraceCleanup {
  producerClosed: boolean;
  pendingInspections: number;
  rawDeletion:
    | 'not-applicable'
    | 'producer-unconfirmed'
    | 'deferred-inspection-settlement'
    | 'scheduled'
    | 'removed'
    | 'private-cleanup-failed';
}

export type NativeGpuTraceCompleteness =
  | 'not-recorded'
  | 'window-flushed-child-tail-not-certified'
  | 'partial-or-uncertain';

export type NativeGpuTraceFatalCoverage =
  | 'no-observed-graphics-fault'
  | 'observed-during-trace-window'
  | 'observed-after-trace-window-not-explained-by-this-capture'
  | 'trace-window-unavailable-or-uncertain';

export interface NativeGpuTraceReceipt {
  version: 1;
  enabled: boolean;
  diagnosticOnly: boolean;
  scope: 'unchanged-babylon-inspect-through-authored-wheel-check-or-first-gpu-fault';
  omittedGameplayChecks: string[];
  source: NativeGpuTraceSource;
  status: 'not-started' | 'disabled' | 'recording' | 'recorded' | 'incomplete';
  format: 'private-perfetto-numeric-summary';
  rawTraceUploaded: false;
  categoryPolicy: 'fixed-allowlist-requested-not-discovered';
  cleanup?: NativeGpuTraceCleanup;
  config: NativeGpuTraceConfig | null;
  setupBudgetMs: number;
  stopBudgetMs: number;
  maxFileBytes: number;
  completeness: NativeGpuTraceCompleteness;
  errors: string[];
  parserExitStatus?: number;
  categoryInventory?: NativeGpuTraceCategoryInventory;
  startRequestedAt?: number;
  startAcknowledgedAt?: number;
  stopRequestedAt?: number;
  stopAcknowledgedAt?: number;
  stopReason?:
    | 'late-start'
    | 'setup-failed'
    | 'first-graphics-fault'
    | 'authored-model-operation-ended';
  lateStartCleanup?: boolean;
  graphicsFaultAtWindowClose?: string | null;
  finalGraphicsFault?: string | null;
  fatalCoverage?: NativeGpuTraceFatalCoverage;
  output?: NativeGpuTraceOutput;
}

export interface NativeGpuTraceOptions {
  enabled: boolean;
  source?: Partial<NativeGpuTraceSource>;
  adapter: NativeGpuTraceAdapter;
  firstFault: FirstGraphicsFault;
  onOperationFailure?: (failure: unknown) => void;
  path: string;
  outputPath?: string;
  parserPath?: string;
  now?: () => number;
  setupMs?: number;
  stopMs?: number;
  inspect?: (
    path: string,
    outputPath: string,
    signal: AbortSignal,
  ) => Promise<NativeGpuTraceOutput>;
}

export interface NativeGpuTrace {
  receipt: NativeGpuTraceReceipt;
  finalize(): void;
  cleanup(options?: { producerClosed?: boolean }): NativeGpuTraceCleanup;
  run<T>(operation: () => T | PromiseLike<T>): Promise<T>;
}

export function createNativeGpuTrace(options: NativeGpuTraceOptions): NativeGpuTrace;

export interface NativeGpuTraceEvidence {
  outcome: 'retained-typed-gpu-work-summary';
  completeness: NativeGpuTraceCompleteness;
  fatalCoverage: NativeGpuTraceFatalCoverage;
  source: NativeGpuTraceSource;
  output: NativeGpuTraceRetainedOutput;
}

export function validateNativeGpuTraceEvidence(
  report: unknown,
  directory: string,
): Promise<NativeGpuTraceEvidence>;

export function retainNativeGpuTraceSummary(options: {
  summary: NativeGpuWorkSummary;
  source: NativeGpuTraceSource;
  outputPath: string;
  signal: AbortSignal;
  writeSummary?: typeof writeFile;
}): Promise<NativeGpuTraceRetainedOutput>;
