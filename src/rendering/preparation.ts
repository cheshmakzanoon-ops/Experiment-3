import * as T from 'three';

/** Borrow renderables without reparenting them. Three's compilation traverses
 * invisible objects too, so keep inactive bike LODs and service parts. Only
 * explicitly supplied roots that are still hidden may omit their subtrees. */
function compilationView(scene: T.Scene, hiddenRoots: readonly T.Object3D[]) {
  const omitted = new Set(hiddenRoots.filter((root) => root.visible === false));
  const renderables: T.Object3D[] = [];
  const visit = (object: T.Object3D) => {
    if (omitted.has(object)) return;
    if (
      (object as T.Mesh).isMesh ||
      (object as T.Points).isPoints ||
      (object as T.Line).isLine ||
      (object as T.Sprite).isSprite
    )
      renderables.push(object);
    for (const child of object.children) visit(child);
  };
  visit(scene);
  const view = new T.Object3D();
  view.traverse = (callback) => {
    for (const object of renderables) callback(object);
  };
  // Empty children leave traverseVisible light-free. compileAsync collects
  // lights, fog and environment from the original target scene exactly once.
  return view;
}

/** Compile the programs actually used by the linear scene pass, rather than
 * unused canvas/tone-mapped variants. Never leave an offscreen target bound
 * while awaiting parallel compilation, cancellation or a UI repaint. */
export function compileSceneTarget(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  target: T.WebGLRenderTarget,
  hiddenRoots?: readonly T.Object3D[],
) {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new T.Vector4());
  const scissor = renderer.getScissor(new T.Vector4());
  const scissorTest = renderer.getScissorTest();
  try {
    renderer.setRenderTarget(target);
    return hiddenRoots
      ? renderer.compileAsync(compilationView(scene, hiddenRoots), camera, scene)
      : renderer.compileAsync(scene, camera);
  } finally {
    renderer.setRenderTarget(previous, face, mip);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
  }
}

export interface PreparationCheckpoint {
  run: number;
  sequence: number;
  span: number;
  phase: 'start' | 'end' | 'error' | 'cancelled' | 'mark';
  label: string;
  at: number;
}

interface PreparationRecord {
  run: number;
  checkpoints: PreparationCheckpoint[];
  checkpointSequence: number;
  checkpointsDropped: number;
  observerErrors: number;
  status: 'preparing' | 'complete' | 'cancelled' | 'failed';
  started: number;
  ended: number | null;
  error: string | null;
  stages: { label: string; started: number; ended: number | null }[];
}
/** Bounded wall-time diagnostics, not a simulation clock or a hardware FPS claim. */
export class PreparationTrace {
  private current: PreparationRecord | null = null;
  private nextRun = 0;
  constructor(
    private readonly now = () => performance.now(),
    private readonly observer?: (event: PreparationCheckpoint) => void,
  ) {}
  checkpoint(phase: PreparationCheckpoint['phase'], label: string, span = 0) {
    const record = this.current;
    if (!record || record.status !== 'preparing') return 0;
    const sequence = ++record.checkpointSequence;
    const event = {
      run: record.run,
      sequence,
      span: span || sequence,
      phase,
      label: label.slice(0, 160),
      at: this.now(),
    };
    if (record.checkpoints.length === 256) {
      record.checkpoints.shift();
      record.checkpointsDropped++;
    }
    record.checkpoints.push(event);
    try {
      this.observer?.({ ...event });
    } catch {
      record.observerErrors++;
    }
    return event.span;
  }
  begin(label: string) {
    return this.checkpoint('start', label);
  }
  end(span: number, label: string) {
    this.checkpoint('end', label, span);
  }
  observe<T>(label: string, operation: () => T): T {
    const record = this.current;
    const span = this.begin(label);
    try {
      const result = operation();
      if (record === this.current) this.end(span, label);
      return result;
    } catch (error) {
      if (record === this.current) this.checkpoint('error', label, span);
      throw error;
    }
  }
  async observeAsync<T>(
    label: string,
    operation: () => Promise<T>,
    cancelled = () => false,
  ): Promise<T> {
    const record = this.current;
    const span = this.begin(label);
    try {
      const result = await operation();
      if (record === this.current) this.checkpoint(cancelled() ? 'cancelled' : 'end', label, span);
      return result;
    } catch (error) {
      if (record === this.current) this.checkpoint('error', label, span);
      throw error;
    }
  }
  async run(
    progress: (label: string) => void,
    prepare: (report: (label: string) => void) => Promise<boolean>,
  ) {
    const record: PreparationRecord = {
      run: ++this.nextRun,
      checkpoints: [],
      checkpointSequence: 0,
      checkpointsDropped: 0,
      observerErrors: 0,
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
      if (this.current === record) this.checkpoint('mark', `stage:${label}`);
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
      checkpoints: record.checkpoints.map((event) => ({ ...event })),
      checkpointsDropped: record.checkpointsDropped,
      observerErrors: record.observerErrors,
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
