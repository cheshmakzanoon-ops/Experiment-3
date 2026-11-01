import type {
  ImmutableReceipt,
  Leg,
  LegResult,
  ComparisonSummary,
} from './electron-runtime-ab-contract.mjs';
import type { ComparisonContext } from './electron-runtime-ab-payload.mjs';
export interface Execution {
  spawned: boolean | null;
  exitCode: number | null;
  signal: string | null;
}
export type Classification = Pick<LegResult, 'status' | 'reason' | 'actualRuntime'>;
export interface Evidence {
  classification: Classification;
  envelope: Record<string, unknown> & { leg: Leg };
  encoded: Buffer;
  sha256: string;
  images: { name: string; sha256: string; bytes: number }[];
}
export interface ComparisonAdapters {
  verifyImmutable(): Promise<boolean>;
  assertFresh(leg: Leg): Promise<unknown>;
  verifyEmpty(leg: Leg): Promise<unknown>;
  execute(leg: Leg): Promise<Execution>;
  cleanup(leg: Leg): Promise<unknown>;
  collect(leg: Leg, execution: Execution): Promise<Evidence>;
  removePrivateState(leg: Leg, cleanup: unknown): Promise<unknown>;
}
export interface ComparisonOutcome {
  summary: ComparisonSummary;
  retained: Evidence[];
}
export function unchangedSmokeInvocation(
  context: ComparisonContext,
  leg: Leg,
  inherited: Record<string, string | undefined>,
  nodeExecutable: string,
): Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  shell: false;
  originalStageBudgets: true;
  automaticRetries: 0;
}>;
export function cleanupIsVerified(value: unknown, beforeLaunch?: boolean): boolean;
export function classifySmokeResult(
  leg: Leg,
  immutable: ImmutableReceipt,
  execution: Execution,
  report: unknown,
): Classification;
export function collectComparisonEvidence(
  context: ComparisonContext,
  leg: Leg,
  execution: Execution,
): Promise<Evidence>;
export function assertFreshComparisonLeg(context: ComparisonContext, leg: Leg): Promise<void>;
export function removeComparisonPrivateState(
  context: ComparisonContext,
  leg: Leg,
  cleanup: unknown,
): Promise<void>;
export function runRuntimeComparison(options: {
  immutable: ImmutableReceipt;
  adapters: ComparisonAdapters;
}): Promise<ComparisonOutcome>;
export function exportComparisonEvidence(
  context: ComparisonContext,
  outcome: ComparisonOutcome,
  destination: string,
): Promise<{ bytes: number; files: number; sha256: string }>;
export function validateComparisonEnvelope(
  item: Evidence,
  immutable: ImmutableReceipt,
  leg: Leg,
): Record<string, unknown>;
