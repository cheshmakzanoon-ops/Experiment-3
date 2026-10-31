export interface NativePreparationConfig {
  prefix: string;
  maxPackets: number;
  maxPacketBytes: number;
  maxDetailBytes: number;
}
export const NATIVE_PREPARATION_CAPTURE: Readonly<NativePreparationConfig>;
export function installNativePreparationObserver(config: NativePreparationConfig): void;
export interface NativePreparationEvent {
  documentId: string;
  origin: number;
  url: string;
  sequence: number;
  receivedAt: number;
  checkpoint: {
    run: number;
    sequence: number;
    span: number;
    phase: string;
    label: string;
    at: number;
    detailJSON?: string;
  };
}
export interface NativePreparationSnapshot {
  version: number;
  limits: { maxEvents: number; maxBytes: number; maxDocuments: number };
  received: number;
  accepted: number;
  rejected: number;
  oversizedPackets: number;
  reorderedPackets: number;
  documentLimitPackets: number;
  truncatedDetails: number;
  evictedEvents: number;
  evictedBytes: number;
  retainedBytes: number;
  documents: {
    documentId: string;
    origin: number;
    url: string;
    lastSequence: number;
    missingPackets: number;
    sourceDropped: number;
    sourceTruncated: number;
    sourceCapped: boolean;
  }[];
  events: NativePreparationEvent[];
}
export function createNativePreparationSink(options?: {
  maxEvents?: number;
  maxBytes?: number;
  maxDocuments?: number;
}): {
  consume(text: string, receivedAt?: number): boolean;
  snapshot(): NativePreparationSnapshot;
};
export function createNativePreparationWriter(path: string): {
  update(snapshot: unknown): void;
  flush(): Promise<string | null>;
};
export interface RetainedGameObservation {
  failure: string | null;
  diagnosticsError?: string;
  [key: string]: unknown;
}
export function readRetainedGameObservation(): RetainedGameObservation;
export function retainCompatibilityObservation<T extends RetainedGameObservation>(
  report: { lastCompatibilityObservation?: RetainedGameObservation },
  observation: T,
): T;
