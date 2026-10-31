import type { NativeGpuWorkAggregate, NativeGpuWorkSummary } from './native-gpu-trace-summary.mjs';
export const NATIVE_GPU_SERVICE_API_EVENTS: readonly Readonly<{ category: 'gpu'; name: string }>[];
export const NATIVE_GPU_SERVICE_API_WORK_EVENTS: readonly Readonly<{
  category: string;
  name: string;
}>[];
export const NATIVE_GPU_SERVICE_API_QUERY: string;
export interface NativeGpuServiceApiAggregate extends NativeGpuWorkAggregate {
  unfinishedDecoderFlushAncestorCount: number;
  unfinishedUnderUnfinishedDecoderFlushCount: number;
}
export interface NativeGpuServiceApiSummary
  extends Omit<NativeGpuWorkSummary, 'version' | 'aggregate' | 'events'> {
  version: 3;
  serviceApiMode: 'service-api-boundary-v1';
  serviceApiCoverage: 'typed-gpu-service-api-observed' | 'no-typed-gpu-service-api-observed';
  serviceApiBoundaryDiscriminator:
    | 'same-track-open-service-api-under-unfinished-decoder-and-flush-observed'
    | 'inconclusive';
  aggregate: NativeGpuServiceApiAggregate;
  events: (NativeGpuServiceApiAggregate & { name: string; category: string })[];
}
export function decodeNativeGpuServiceApiRows(
  stdout: string,
  captureBytes: number,
): NativeGpuServiceApiSummary;
export function validateNativeGpuServiceApiSummary(value: unknown): NativeGpuServiceApiSummary;
