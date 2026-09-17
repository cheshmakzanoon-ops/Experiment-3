/// <reference lib="webworker" />
import { telemetryCsv } from '../storage/telemetry-schema.ts';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ id: number; values: Float32Array; count: number }>) => {
  const { id, values, count } = event.data;
  try {
    scope.postMessage({ id, blob: telemetryCsv(values, count) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
