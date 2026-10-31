export type NativeGpuServiceApiMode = 'off' | 'service-api-boundary-v1';

export const NATIVE_GPU_SERVICE_API_WORKFLOW: '.github/workflows/desktop-gpu-service-api-review.yml';

export function nativeGpuServiceApiMode(value?: string): NativeGpuServiceApiMode;
export function nativeGpuServiceApiManualContext(env?: Record<string, string | undefined>): boolean;

export interface NativeGpuServiceApiLaunchOptions {
  mode?: string;
  traceEnabled?: boolean;
  platform?: string;
  arch?: string;
  hostArch?: string;
  graphicsBackend?: string;
  journey?: string;
  manualNonpublishing?: boolean;
}

export interface NativeGpuServiceApiLaunchReceipt {
  mode: 'service-api-boundary-v1';
  argument: '--enable-gpu-service-tracing';
  platform: 'linux';
  arch: 'x64';
  graphicsBackend: 'mesa';
  journey: 'full';
  manualNonpublishing: true;
}

export function nativeGpuServiceApiLaunchReceipt(
  options?: NativeGpuServiceApiLaunchOptions,
): Readonly<NativeGpuServiceApiLaunchReceipt> | undefined;
export function nativeGpuServiceApiArguments(
  options?: NativeGpuServiceApiLaunchOptions,
): '--enable-gpu-service-tracing'[];
export function validateNativeGpuServiceApiSource(
  mode?: string,
  source?: { electron?: unknown },
): void;
export function validateNativeGpuServiceApiRuntime(
  mode?: string,
  runtime?: { electron?: unknown; chromium?: unknown },
): void;
