export const NATIVE_TRACE_PROCESSOR = Object.freeze({
  version: '58.2',
  bytes: 14897560,
  sha256: '58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9',
  maxInputBytes: 64 * 1024 * 1024,
  maxStdoutBytes: 16 * 1024,
  maxStderrBytes: 4 * 1024,
  maxSummaryBytes: 16 * 1024,
  processingMs: 5000,
});
// Source-pinned static pairs only. No trace-derived names enter SQL or output.
export const NATIVE_GPU_WORK_EVENTS = Object.freeze(
  [
    ['gpu', 'CommandBufferStub::OnAsyncFlush'],
    ['gpu', 'CommandBufferStub::PerformWork'],
    ['gpu', 'Scheduler::RunTask'],
    ['gpu', 'CommandBufferService:PutChanged'],
    ['gpu', 'GLES2DecoderPassthroughImpl::DoLinkProgram'],
    ['gpu.angle', 'CompileEvent::wait'],
    ['gpu.angle', 'Program::MainLinkLoadEvent::wait'],
    ['gpu.angle', 'ProgramGL::linkJobImpl'],
    ['gpu.angle', 'ProgramGL::postLinkJobImpl'],
  ].map(([category, name]) => Object.freeze({ category, name })),
);
const reasons = new Set([
  'processing-timeout',
  'parser-unavailable',
  'parser-integrity',
  'trace-unavailable',
  'trace-size',
  'trace-changed',
  'private-staging-failed',
  'parser-launch-failed',
  'parser-output-limit',
  'parser-exit',
  'parser-rows',
  'summary-invalid',
]);
export class NativeGpuTraceSummaryError extends Error {
  constructor(reason, parserExitStatus = null) {
    super(`Native GPU trace summary: ${reasons.has(reason) ? reason : 'summary-invalid'}`);
    this.name = 'NativeGpuTraceSummaryError';
    this.reason = reasons.has(reason) ? reason : 'summary-invalid';
    this.parserExitStatus =
      Number.isInteger(parserExitStatus) && parserExitStatus >= 0 && parserExitStatus <= 255
        ? parserExitStatus
        : null;
  }
}
