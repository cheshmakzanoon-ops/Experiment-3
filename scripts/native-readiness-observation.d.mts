export type NativeReadinessPlain =
  | null
  | boolean
  | number
  | string
  | NativeReadinessPlain[]
  | { [key: string]: NativeReadinessPlain };
export interface NativeBabylonReadiness {
  renderer: { nowMs: number | null; timeOriginMs: number | null };
  dom: {
    statusText: string | null;
    pauseButton: string | null;
    loadDisabled: boolean | null;
    hidden: boolean | null;
    focused: boolean | null;
    data: Record<string, string | null>;
    truncatedFields: string[];
  };
  predicate: { submitted: number | null; completed: number | null; ready: boolean };
  graphics: NativeReadinessPlain;
  errors: string[];
}
export function readNativeBabylonReadiness(): NativeBabylonReadiness;
export interface NativeReadinessHistorySnapshot {
  version: 1;
  limits: { maxEntries: number; maxSampleBytes: number; maxTotalBytes: number };
  received: number;
  evicted: number;
  rejected: number;
  retainedBytes: number;
  observations: NativeReadinessPlain[];
}
export function createNativeReadinessHistory(options?: { maxEntries?: number }): {
  record(phase: string, sample: unknown, hostBefore: unknown, hostAfter: unknown): boolean;
  snapshot(): NativeReadinessHistorySnapshot;
};
export function preserveNativeFailureWhileObserving(error: unknown, observe: () => void): never;

export function normalizeNativeBabylonReadiness(value: unknown): NativeBabylonReadiness | null;
