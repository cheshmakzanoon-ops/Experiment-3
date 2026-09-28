import * as T from 'three';

/** Compile the programs actually used by the linear scene pass, rather than
 * unused canvas/tone-mapped variants. Never leave an offscreen target bound
 * while awaiting parallel compilation, cancellation or a UI repaint. */
export function compileSceneTarget(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  target: T.WebGLRenderTarget,
) {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new T.Vector4());
  const scissor = renderer.getScissor(new T.Vector4());
  const scissorTest = renderer.getScissorTest();
  try {
    renderer.setRenderTarget(target);
    return renderer.compileAsync(scene, camera);
  } finally {
    renderer.setRenderTarget(previous, face, mip);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
  }
}

interface PreparationRecord {
  status: 'preparing' | 'complete' | 'cancelled' | 'failed';
  started: number;
  ended: number | null;
  error: string | null;
  stages: { label: string; started: number; ended: number | null }[];
}
/** Bounded wall-time diagnostics, not a simulation clock or a hardware FPS claim. */
export class PreparationTrace {
  private current: PreparationRecord | null = null;
  constructor(private readonly now = () => performance.now()) {}
  async run(
    progress: (label: string) => void,
    prepare: (report: (label: string) => void) => Promise<boolean>,
  ) {
    const record: PreparationRecord = {
      status: 'preparing',
      started: this.now(),
      ended: null,
      error: null,
      stages: [],
    };
    this.current = record;
    const report = (label: string) => {
      const time = this.now(),
        previous = record.stages.at(-1);
      if (previous) previous.ended = time;
      if (record.stages.length === 32) record.stages.shift();
      record.stages.push({ label, started: time, ended: null });
      progress(label);
    };
    try {
      const completed = await prepare(report);
      record.status = completed ? 'complete' : 'cancelled';
      return completed;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      record.ended = this.now();
      const last = record.stages.at(-1);
      if (last) last.ended = record.ended;
    }
  }
  snapshot() {
    const record = this.current;
    if (!record) return null;
    const time = record.ended ?? this.now();
    return {
      status: record.status,
      elapsedMs: Math.max(0, time - record.started),
      error: record.error,
      stages: record.stages.map((stage) => ({
        label: stage.label,
        elapsedMs: Math.max(0, (stage.ended ?? time) - stage.started),
        complete: stage.ended !== null,
      })),
    };
  }
}
