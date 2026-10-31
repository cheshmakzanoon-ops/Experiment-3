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

export interface ProgramReadinessReport {
  status: 'complete' | 'cancelled' | 'unsupported' | 'failed';
  livePrograms: number;
  queriedPrograms: number;
  initializedPrograms: number;
  queries: number;
  elapsedMs: number;
}

export interface ProgramReadinessOptions {
  cancelled?: () => boolean;
  yieldControl?: () => Promise<void>;
  now?: () => number;
  maxWaitMs?: number;
  batchSize?: number;
  /** Preserve Three first-use validation before any full warm draw. */
  initializeCaches?: boolean;
  report?: (value: ProgramReadinessReport) => void;
}

/** Three r180 compileAsync waits only each material's last currentProgram.
 * A shared mesh/instance/skin material and two-pass sides can own several.
 * Observe all live native programs instead, without querying logs/link status
 * or leaving an uncancellable Three polling timer behind. */
export async function waitForAllPrograms(
  renderer: Pick<T.WebGLRenderer, 'getContext' | 'info'>,
  options: ProgramReadinessOptions = {},
): Promise<'complete' | 'cancelled' | 'unsupported'> {
  const cancelled = options.cancelled ?? (() => false);
  const yieldControl =
    options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const now = options.now ?? (() => performance.now());
  const maxWaitMs = options.maxWaitMs ?? 45000;
  const batchSize = options.batchSize ?? 16;
  if (
    !Number.isFinite(maxWaitMs) ||
    maxWaitMs <= 0 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 64
  )
    throw new Error('Invalid shader preparation polling limits');
  const gl = renderer.getContext();
  const started = now();
  const deadline = started + maxWaitMs;
  const queried = new Set<WebGLProgram>();
  let queries = 0;
  let initializedPrograms = 0;
  let status: ProgramReadinessReport['status'] = 'failed';
  const finish = (value: 'complete' | 'cancelled' | 'unsupported') => {
    status = value;
    return value;
  };
  const stopped = () => {
    if (cancelled()) return true;
    if (gl.isContextLost()) throw new Error('WebGL context lost during shader preparation');
    if (now() >= deadline)
      throw new Error(`Shader preparation did not complete within ${maxWaitMs}ms`);
    return false;
  };
  // requestAnimationFrame can stop in a hidden document. Keep the ownership
  // checks alive independently of the supplied scheduler; do not submit more
  // GL work merely because a timer fired. Late scheduler settlement is inert.
  const yieldObserved = () =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (error?: unknown, failed = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (failed) reject(error);
        else resolve();
      };
      const watch = () => {
        try {
          if (stopped()) {
            settle();
            return;
          }
          timer = setTimeout(watch, Math.min(50, Math.max(1, deadline - now())));
        } catch (error) {
          settle(error, true);
        }
      };
      watch();
      if (!settled) {
        // Attach rejection handling even if the watcher wins first. We cannot
        // cancel an arbitrary caller promise, but it can never resume this loop.
        void Promise.resolve()
          .then(yieldControl)
          .then(
            () => settle(),
            (error: unknown) => settle(error, true),
          );
      }
    });
  try {
    if (stopped()) return finish('cancelled');
    const extension = gl.getExtension('KHR_parallel_shader_compile');
    if (!extension) {
      // Same no-extension fallback as Three: yield, then let the real first draw
      // perform first-use validation. Never label this as observed completion.
      await yieldObserved();
      return finish(stopped() ? 'cancelled' : 'unsupported');
    }
    const complete = new Set<WebGLProgram>();
    const initialized = new Set<WebGLProgram>();
    for (;;) {
      if (stopped()) return finish('cancelled');
      const pending = (renderer.info.programs ?? [])
        .map((program) => program.program as WebGLProgram)
        .filter((program) => !complete.has(program));
      if (!pending.length) {
        if (!options.initializeCaches) return finish('complete');
        // The KHR phase observed these handles complete. Never reflect programs
        // that appeared during a yield until the outer loop also checks them.
        const caches = (renderer.info.programs ?? []).filter(
          (program) => complete.has(program.program) && !initialized.has(program.program),
        );
        if (!caches.length) return finish('complete');
        for (const program of caches.slice(0, Math.min(batchSize, 4))) {
          if (stopped()) return finish('cancelled');
          if (!(renderer.info.programs ?? []).includes(program)) continue;
          // Preserve native receiver and normal error checks. r180's first
          // getter initializes BOTH caches; the second must be a cache hit.
          program.getUniforms();
          if (stopped()) return finish('cancelled');
          program.getAttributes();
          if (stopped()) return finish('cancelled');
          initialized.add(program.program);
          initializedPrograms++;
        }
        await yieldObserved();
        continue;
      }
      for (let index = 0; index < pending.length; index++) {
        if (stopped()) return finish('cancelled');
        const program = pending[index];
        // Disposal while yielding relinquishes this owner's responsibility.
        if ((renderer.info.programs ?? []).some((live) => live.program === program)) {
          queried.add(program);
          queries++;
          const ready: unknown = gl.getProgramParameter(program, extension.COMPLETION_STATUS_KHR);
          if (stopped()) return finish('cancelled');
          if (ready === true) complete.add(program);
          else if (ready !== false) throw new Error('Unable to check shader program completion');
        }
        if ((index + 1) % batchSize === 0 && index + 1 < pending.length) {
          await yieldObserved();
          if (stopped()) return finish('cancelled');
        }
      }
      // A task boundary bounds query bursts even when every current program is
      // pending; include older and newly added live variants on the next sweep.
      await yieldObserved();
    }
  } finally {
    // Diagnostics cannot change resource ownership or turn a failure into success.
    try {
      options.report?.({
        status,
        livePrograms: renderer.info.programs?.length ?? 0,
        queriedPrograms: queried.size,
        initializedPrograms,
        queries,
        elapsedMs: Math.max(0, now() - started),
      });
    } catch {
      /* observer only */
    }
  }
}

/** Compile the programs actually used by the linear scene pass, rather than
 * unused canvas/tone-mapped variants. Never leave an offscreen target bound
 * while awaiting parallel compilation, cancellation or a UI repaint.
 * Submission is synchronous renderer.compile; readiness is application-owned,
 * not Three's material-deduplicated compileAsync. Synchronous submission/errors
 * restore state before any readiness query; the returned promise retains the
 * borrowed view identity. Cancellation returns it without claiming readiness;
 * callers must honor their cancellation predicate before drawing. Native driver
 * calls cannot be preempted by JavaScript. The 45s budget starts AFTER
 * synchronous submission/restoration and bounds readiness polling plus opted-in
 * cache initialization, not total
 * compilation. A readiness query returning over budget fails closed; no new
 * synchronous-compilation time cap is imposed. Scheduler timers may themselves
 * be throttled, so this is not a hard wall-clock preemption guarantee. */
export function compileSceneTarget(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  target: T.WebGLRenderTarget,
  hiddenRoots?: readonly T.Object3D[],
  options: ProgramReadinessOptions = {},
) {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new T.Vector4());
  const scissor = renderer.getScissor(new T.Vector4());
  const scissorTest = renderer.getScissorTest();
  const view = hiddenRoots ? compilationView(scene, hiddenRoots) : scene;
  try {
    renderer.setRenderTarget(target);
    if (!options.cancelled?.()) {
      if (hiddenRoots) renderer.compile(view, camera, scene);
      else renderer.compile(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(previous, face, mip);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
  }
  return waitForAllPrograms(renderer, options).then(() => view);
}

export interface PreparationCheckpoint {
  run: number;
  sequence: number;
  span: number;
  phase: 'start' | 'end' | 'error' | 'cancelled' | 'mark';
  label: string;
  at: number;
  /** Valid structured JSON, capped at32KiB UTF-8; never an arbitrary string slice. */
  detailJSON?: string;
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
  checkpoint(phase: PreparationCheckpoint['phase'], label: string, span = 0, detail?: unknown) {
    const record = this.current;
    if (!record || record.status !== 'preparing') return 0;
    const sequence = ++record.checkpointSequence;
    let detailJSON: string | undefined;
    if (detail !== undefined) {
      try {
        detailJSON = JSON.stringify(detail);
        if (detailJSON !== undefined) {
          const bytes = new TextEncoder().encode(detailJSON).byteLength;
          if (bytes > 32768)
            detailJSON = JSON.stringify({
              truncated: true,
              reason: 'checkpoint-detail-byte-limit',
              originalBytes: bytes,
              limitBytes: 32768,
            });
        }
      } catch {
        detailJSON = JSON.stringify({
          truncated: true,
          reason: 'checkpoint-detail-not-serializable',
        });
      }
    }
    const event = {
      run: record.run,
      sequence,
      span: span || sequence,
      phase,
      label: label.slice(0, 160),
      at: this.now(),
      ...(detailJSON === undefined ? {} : { detailJSON }),
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
