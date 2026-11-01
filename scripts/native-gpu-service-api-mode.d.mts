export type NativeGpuServiceApiMode = 'off' | 'service-api-boundary-v1';

export const NATIVE_GPU_SERVICE_API_WORKFLOW: '.github/workflows/desktop-gpu-service-api-review.yml';
export const NATIVE_GPU_SERVICE_API_ONE_SHOT: Readonly<{
  repository: 'cheshmakzanoon-ops/Experiment-3';
  ref: 'refs/heads/main';
  baseCommit: 'b3a0cc29a78f03ac019e701592b4788d468f124e';
  message: 'diagnostic: authorize gpu-service-api once 2026-11-01-8dc45f7a';
  maxEventBytes: 262144;
}>;

export function nativeGpuServiceApiMode(value?: string): NativeGpuServiceApiMode;
export function nativeGpuServiceApiManualContext(env?: Record<string, string | undefined>): boolean;
export function nativeGpuServiceApiOneShotPushContext(
  env?: Record<string, string | undefined>,
  event?: unknown,
): boolean;
export function nativeGpuServiceApiAuthorization(
  mode?: string,
  env?: Record<string, string | undefined>,
): { manualNonpublishing?: true; oneShotPushNonpublishing?: true };

export interface NativeGpuServiceApiLaunchOptions {
  mode?: string;
  traceEnabled?: boolean;
  platform?: string;
  arch?: string;
  hostArch?: string;
  graphicsBackend?: string;
  journey?: string;
  manualNonpublishing?: boolean;
  oneShotPushNonpublishing?: boolean;
}

interface NativeGpuServiceApiLaunchFacts {
  mode: 'service-api-boundary-v1';
  argument: '--enable-gpu-service-tracing';
  platform: 'linux';
  arch: 'x64';
  graphicsBackend: 'mesa';
  journey: 'full';
}

export type NativeGpuServiceApiLaunchReceipt = NativeGpuServiceApiLaunchFacts &
  (
    | { manualNonpublishing: true; oneShotPushNonpublishing?: never }
    | { oneShotPushNonpublishing: true; manualNonpublishing?: never }
  );

export function nativeGpuServiceApiLaunchReceipt(
  options?: NativeGpuServiceApiLaunchOptions,
): Readonly<NativeGpuServiceApiLaunchReceipt> | undefined;
export function nativeGpuServiceApiArguments(
  options?: NativeGpuServiceApiLaunchOptions,
): '--enable-gpu-service-tracing'[];
export function validateNativeGpuServiceApiSource(
  mode?: string,
  source?: { electron?: unknown; commit?: unknown },
  authorization?: { oneShotPushNonpublishing?: boolean; githubSha?: string },
): void;
export function validateNativeGpuServiceApiRuntime(
  mode?: string,
  runtime?: { electron?: unknown; chromium?: unknown },
): void;
