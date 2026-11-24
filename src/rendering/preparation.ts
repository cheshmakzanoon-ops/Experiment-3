import * as T from 'three';

/** Warm hidden motorcycle views against their normal materials, vertex buffers
 * and multisampled attachments. Restore the caller's scissor before the next
 * submission, including when a material fails during preparation. */
export function warmRoadGridColour(target: T.WebGLRenderTarget, draw: () => void) {
  const saved = target.scissor.clone();
  const enabled = target.scissorTest;
  const bounds = enabled ? saved : target.viewport;
  const width = Math.min(320, bounds.z), height = Math.min(200, bounds.w);
  target.scissor.set(
    Math.floor(bounds.x + (bounds.z - width) / 2),
    Math.floor(bounds.y + (bounds.w - height) / 2),
    width, height,
  );
  target.scissorTest = true;
  try {
    draw();
    return { width, height, targetWidth: target.width, targetHeight: target.height };
  } finally {
    target.scissor.copy(saved);
    target.scissorTest = enabled;
  }
}

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
 * while awaiting parallel compilation, cancellation or a UI repaint.
 *
 * r180 compileAsync readies material.currentProgram but defers error logs and
 * uniform/attribute metadata to the first draw. Snapshot every retained variant
 * owned by the participating materials immediately after its synchronous compile
 * phase: one material can own separate skinned, instanced and two-sided programs.
 * Older retained variants of these materials are included; unrelated material
 * owners are not. Resolve metadata before scene work can queue behind it. */
export function compileSceneTarget(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  target: T.WebGLRenderTarget,
  hiddenRoots?: readonly T.Object3D[],
  preparation?: { cancelled: () => boolean; beforeMetadata?: () => void; requireLinkedPrograms?: boolean },
) {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new T.Vector4());
  const scissor = renderer.getScissor(new T.Vector4());
  const scissorTest = renderer.getScissorTest();
  const view = hiddenRoots ? compilationView(scene, hiddenRoots) : scene;
  const materials = new Set<T.Material>();
  view.traverse((object) => {
    if (
      !(object as T.Mesh).isMesh &&
      !(object as T.Points).isPoints &&
      !(object as T.Line).isLine &&
      !(object as T.Sprite).isSprite
    )
      return;
    const material = (object as T.Mesh).material;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material) materials.add(material);
  });
  try {
    renderer.setRenderTarget(target);
    const compiling = hiddenRoots
      ? renderer.compileAsync(view, camera, scene)
      : renderer.compileAsync(scene, camera);
    const programs = new Set<T.WebGLProgram>();
    for (const material of materials) {
      const properties = renderer.properties.get(material) as {
        programs?: Map<string, T.WebGLProgram>;
      };
      const owned = properties.programs;
      for (const program of owned?.values() ?? []) programs.add(program);
    }
    return compiling.then((compiled) => {
      if (preparation?.cancelled()) return compiled;
      preparation?.beforeMetadata?.();
      if (preparation?.cancelled()) return compiled;
      const retained = new Set(renderer.info.programs ?? []);
      const gl = preparation?.requireLinkedPrograms ? renderer.getContext() : null;
      for (const program of programs) {
        if (!retained.has(program) || program.usedTimes <= 0) continue;
        // Three reports a failed link to the console and still resolves compileAsync.
        // An interactive preset change needs a usable program before it can be saved.
        if (gl && !gl.getProgramParameter(program.program, gl.LINK_STATUS))
          throw new Error(`The graphics device could not link the ${program.name || 'circuit'} shader for this preset.`);
        program.getUniforms();
      }
      return compiled;
    });
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
      // Async stages can outlive their run or resume after a replacement starts.
      // Keep both the loading message and the frozen timings with the live run.
      if (this.current !== record || record.status !== 'preparing') return;
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
