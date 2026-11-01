export type Leg = 'A' | 'B';
export interface ComparisonSource {
  version: 1;
  commit: string;
  fingerprint: string;
  electron: '45.2.1';
  platform: 'linux';
  arch: 'x64';
  hostArch: 'x64';
}
export interface RuntimeIdentity {
  platform: string;
  arch: string;
  electron: string;
  chromium: string;
  node: string;
}
export interface RuntimePin extends RuntimeIdentity {
  leg: Leg;
  file: string;
  bytes: number;
  sha256: string;
  assetId: number;
  url: string;
  sourceCommit: string;
}
export interface ImmutableReceipt {
  source: ComparisonSource;
  sourceTreeSha256: string;
  payloadSha256: string;
  payloadBytes: number;
  smokeSha256: string;
  compiledSmokeSha256: string;
}
export interface LegResult {
  leg: Leg;
  status: 'passed' | 'failed' | 'unqualified' | 'blocked';
  reason: string;
  exitCode: number | null;
  actualRuntime: RuntimeIdentity | null;
  cleanupVerified: boolean;
  evidenceSha256: string | null;
}
export interface ComparisonSummary {
  schema: string;
  nonpublishing: true;
  requiredLaneQualification: false;
  declaredShippedElectron: string;
  immutable: ImmutableReceipt;
  legs: LegResult[];
  success: boolean;
  comparisonOnly: true;
  traceEnabled: false;
}
export const RUNTIME_AB_SCHEMA: string;
export const RUNTIME_AB_LEG_SCHEMA: string;
export const RUNTIME_AB_LIMITS: Readonly<{
  sourceFiles: number;
  sourceBytes: number;
  payloadBytes: number;
  fileBytes: number;
  reportBytes: number;
  legEvidenceBytes: number;
  comparisonBytes: number;
}>;
export const RUNTIME_AB_PINS: readonly Readonly<RuntimePin>[];
export const RUNTIME_AB_DECLARED: '45.2.1';
export function runtimeAbFail(code: string): never;
export function exactKeys(value: unknown, keys: string[], code?: string): void;
export function runtimeAbPin(leg: string): Readonly<RuntimePin>;
export function validateComparisonSource(source: unknown): ComparisonSource;
export function validateComparisonRuntime(leg: string, actual: unknown): RuntimeIdentity;
export function isDeclaredRuntimeNativeEvidence(report: unknown): boolean;
export function comparisonEnvironment(
  inherited: Record<string, string | undefined>,
  options: { privateRoot: string; token: string },
): Readonly<Record<string, string>>;
export function validateComparisonHost(host: {
  platform: string;
  arch: string;
  uid: number;
  osRelease: string;
}): void;
export function validateImmutableReceipt(value: unknown): ImmutableReceipt;
export function summarizeComparison(
  immutable: ImmutableReceipt,
  legs: LegResult[],
): ComparisonSummary;
export function validateComparisonSummary(value: unknown): ComparisonSummary;
