import { GpuFrameGate } from './gpu-frame-gate.ts';

/** A renderer owns a lease, never the context's shared completion fence. */
export type GpuFrameLease = Pick<
  GpuFrameGate,
  'ready' | 'submittedFrame' | 'diagnostics' | 'completionLatencyMs' | 'dispose'
>;

interface ContextGate {
  gate: GpuFrameGate;
  owners: number;
}

// Context identity is the GPU command stream identity. Keep no owner list or
// strong context registry: a live context needs one gate and an owner count.
const contexts = new WeakMap<WebGL2RenderingContext, ContextGate>();

/** Acquire only after construction succeeds. Releasing a borrowed renderer's
 * lease leaves unfinished commands visible to every remaining context owner. */
export function acquireGpuFrameGate(gl: WebGL2RenderingContext): GpuFrameLease {
  let shared = contexts.get(gl);
  if (!shared) {
    shared = { gate: new GpuFrameGate(gl), owners: 0 };
    contexts.set(gl, shared);
  }
  const context = shared;
  context.owners++;
  let released = false;
  return {
    get completionLatencyMs() {
      return context.gate.completionLatencyMs;
    },
    ready() {
      return !released && context.gate.ready();
    },
    submittedFrame() {
      if (released) throw new Error('GPU frame gate lease is disposed');
      context.gate.submittedFrame();
    },
    diagnostics() {
      return context.gate.diagnostics();
    },
    dispose() {
      if (released) return;
      released = true;
      if (--context.owners !== 0) return;
      // Revoke the final owner before driver cleanup, which can itself fail.
      contexts.delete(gl);
      context.gate.dispose();
    },
  };
}
