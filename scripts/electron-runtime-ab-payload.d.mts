import type { ComparisonSource, ImmutableReceipt, Leg } from './electron-runtime-ab-contract.mjs';
export interface FileIdentity {
  bytes: number;
  sha256: string;
  dev: string;
  ino: string;
  mode: number;
}
export interface TreeSnapshot {
  files: { path: string; bytes: number; sha256: string; executable: number }[];
  bytes: number;
  sha256: string;
}
export interface SourceSeal {
  schema: string;
  source: ComparisonSource;
  sourceTreeSha256: string;
  inputCount: number;
  smokeSha256: string;
}
export interface PrivateLeg {
  leg: Leg;
  privateRoot: string;
  runtimeRoot: string;
  ownerToken: string;
  stateDirectories: Record<string, { dev: string; ino: string }>;
}
export interface Envelope {
  leg: Leg;
  archiveSha256: string;
  archiveBytes: number;
  runtimeTreeSha256: string;
  executables: Record<string, { dev: string; ino: string }>;
}
export interface ComparisonContext {
  root: string;
  sourceSeal: SourceSeal;
  runRoot: string;
  payload: string;
  legs: Record<Leg, PrivateLeg>;
  immutable: ImmutableReceipt;
  envelopes?: Record<Leg, Envelope>;
}
export function assertNoSymlinkPath(path: string): Promise<string>;
export function hashRegularFile(path: string, limit?: number): Promise<FileIdentity>;
export function readBoundedRegularBytes(
  path: string,
  limit: number,
): Promise<{ bytes: Buffer; sha256: string; dev: string; ino: string }>;
export function readRegularJson(
  path: string,
  limit: number,
): Promise<{ value: unknown; bytes: Buffer; sha256: string }>;
export function snapshotRegularTree(
  root: string,
  selections?: string[] | null,
): Promise<TreeSnapshot>;
export function comparisonFingerprint(root: string): Promise<string>;
export function comparisonToolchainDirectories(root: string): Promise<string[]>;
export function sealComparisonSource(root: string, expectedCommit: string): Promise<SourceSeal>;
export function validateProtectedComparisonInputs(hashes: Record<string, string>): void;
export function verifyComparisonSource(root: string, seal: SourceSeal): Promise<SourceSeal>;
export function sealComparisonPayload(options: {
  root: string;
  sourceSeal: SourceSeal;
  privateParent: string;
}): Promise<ComparisonContext>;
export function copySealedPayload(
  context: ComparisonContext,
  leg: Leg,
): Promise<{ sha256: string; bytes: number }>;
export function verifyComparisonPayload(context: ComparisonContext): Promise<true>;
export function sealRuntimeEnvelope(
  context: ComparisonContext,
  leg: Leg,
  archiveReceipt: unknown,
): Promise<Envelope>;
export function ownedRelative(root: string, path: string): string;
