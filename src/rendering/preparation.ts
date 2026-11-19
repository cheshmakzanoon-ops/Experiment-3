import * as T from 'three';
import type { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
  preparation?: { cancelled: () => boolean; beforeMetadata?: () => void },
) {
  return compileTarget(
    renderer,
    hiddenRoots ? compilationView(scene, hiddenRoots) : scene,
    camera,
    target,
    preparation,
    hiddenRoots ? scene : undefined,
  );
}

interface PreparedSampler {
  id: string;
  type?: number;
  size?: number;
}

// Direct assignments in r180 WebGLMaterials.refreshMaterialUniforms. envMap
// is deliberately separate: its sampled owner is the renderer's processed map.
const MATERIAL_TEXTURE_SLOTS = new Set([
  'map',
  'alphaMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'specularMap',
  'lightMap',
  'aoMap',
  'gradientMap',
  'metalnessMap',
  'roughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
  'specularColorMap',
  'specularIntensityMap',
  'matcap',
]);

/** The compiled material owns the sampler; the texture still owns its pixels,
 * filtering and lifetime. Upload only ready, static 2D owners through Three's
 * normal cache before shadow/probe submissions can precede their first use.
 * No source, version, sampler setting or dynamic update clock changes here. */
export function prepareSceneTextures(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  cancelled: () => boolean,
  hiddenRoots?: readonly T.Object3D[],
) {
  if (cancelled()) return;
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
    const assigned = (object as T.Mesh).material;
    if (Array.isArray(assigned)) assigned.forEach((material) => materials.add(material));
    else if (assigned) materials.add(assigned);
  });
  const retained = new Set(renderer.info.programs ?? []),
    prepared = new Set<T.Texture>();
  for (const material of materials) {
    if (cancelled()) return;
    if (!material.visible) continue;
    const properties = renderer.properties.get(material) as {
      programs?: Map<string, T.WebGLProgram>;
      uniforms?: Record<string, T.IUniform & { needsUpdate?: boolean }>;
      envMap?: T.Texture | null;
    };
    if (!properties.uniforms) continue;
    for (const program of properties.programs?.values() ?? []) {
      if (!retained.has(program) || program.usedTimes <= 0) continue;
      // r180 exposes seq at runtime; the installed @types omits that field.
      const samplers = program.getUniforms() as unknown as { seq: PreparedSampler[] };
      for (const sampler of samplers.seq) {
        // Native SingleUniform SAMPLER_2D only. Arrays, structured uniforms,
        // cube/volume maps and framebuffer attachments keep their own paths.
        if (sampler.type !== 0x8b5e || sampler.size !== undefined) continue;
        const uniform = properties.uniforms?.[sampler.id];
        if (!uniform || uniform.needsUpdate === false) continue;
        // WebGLMaterials refreshes built-in map slots only at the real draw;
        // their compiled uniforms can still be null (or an older binding).
        // Custom shader uniforms already retain their installed owner.
        let value: unknown = uniform.value;
        if (!(material instanceof T.ShaderMaterial)) {
          if (MATERIAL_TEXTURE_SLOTS.has(sampler.id))
            value = (material as unknown as Record<string, unknown>)[sampler.id];
          else if (sampler.id === 'envMap') value = properties.envMap;
        }
        if (!(value instanceof T.Texture) || prepared.has(value) || !staticTextureReady(value))
          continue;
        if (cancelled()) return;
        renderer.initTexture(value);
        prepared.add(value);
      }
    }
  }
}

function staticTextureReady(texture: T.Texture) {
  if (
    texture.isRenderTargetTexture ||
    (texture as T.Texture & { isExternalTexture?: boolean }).isExternalTexture ||
    texture instanceof T.DepthTexture ||
    texture instanceof T.VideoTexture ||
    texture instanceof T.CubeTexture ||
    texture instanceof T.Data3DTexture ||
    texture instanceof T.DataArrayTexture ||
    (texture as T.Texture & { isCompressedArrayTexture?: boolean }).isCompressedArrayTexture ||
    texture.userData.dynamic ||
    texture.version <= 0 ||
    texture.source.dataReady === false
  )
    return false;
  // Simulation fields, bones and mutable state atlases are DataTextures too.
  // Only explicitly immutable data owners are safe to prepare ahead of a draw.
  if (
    texture instanceof T.DataTexture &&
    texture.userData.normalResidency !== 'decoded-rgba8' &&
    texture.userData.surfaceDetail !== true &&
    texture.userData.immutableAssetTexture !== true
  )
    return false;
  const image = texture.image as { width?: number; height?: number; complete?: boolean } | null;
  return !!image && image.complete !== false && (image.width ?? 0) > 0 && (image.height ?? 0) > 0;
}

/** FullScreenQuad exposes its real mesh and camera through render(). Capture
 * that public call with a compile-only adapter: never invoke the renderer's
 * draw path, borrow private fields, or rebuild the pass's geometry/shaders. */
export function compileFullscreenTarget(
  renderer: T.WebGLRenderer,
  quad: FullScreenQuad,
  target: T.WebGLRenderTarget | null,
  cancelled: () => boolean,
): Promise<void> {
  if (cancelled()) return Promise.resolve();
  let compiling: Promise<T.Object3D> | undefined;
  quad.render({
    render(object: T.Object3D, camera: T.Camera) {
      compiling = compileTarget(renderer, object, camera, target, { cancelled });
    },
  } as unknown as T.WebGLRenderer);
  if (!compiling) throw new Error('Fullscreen preparation did not receive its native draw owner');
  return compiling.then(() => {});
}

/** Use the installed OutputPass/ShaderPass draw entry point to select its
 * actual material, quad, target and (for OutputPass) native display defines.
 * The adapter submits compilation only. Restore borrowed sampler/exposure
 * uniforms before awaiting; no pixels are cleared, drawn or read. */
export function compilePassTarget(
  renderer: T.WebGLRenderer,
  pass: OutputPass | ShaderPass,
  writeBuffer: T.WebGLRenderTarget,
  readBuffer: T.WebGLRenderTarget,
  cancelled: () => boolean,
): Promise<void> {
  if (!pass.enabled || cancelled()) return Promise.resolve();
  let target: T.WebGLRenderTarget | null = null;
  let compiling: Promise<T.Object3D> | undefined;
  const uniforms = Object.values(pass.uniforms).map((uniform) => [uniform, uniform.value] as const);
  try {
    pass.render(
      {
        outputColorSpace: renderer.outputColorSpace,
        toneMapping: renderer.toneMapping,
        toneMappingExposure: renderer.toneMappingExposure,
        autoClearColor: renderer.autoClearColor,
        autoClearDepth: renderer.autoClearDepth,
        autoClearStencil: renderer.autoClearStencil,
        setRenderTarget(value: T.WebGLRenderTarget | null) {
          target = value;
        },
        clear() {},
        render(object: T.Object3D, camera: T.Camera) {
          if (compiling) throw new Error('Expected one native fullscreen pass owner');
          compiling = compileTarget(renderer, object, camera, target, { cancelled });
        },
      } as unknown as T.WebGLRenderer,
      writeBuffer,
      readBuffer,
      0,
      false,
    );
  } finally {
    for (const [uniform, value] of uniforms) uniform.value = value;
  }
  if (!compiling) throw new Error('Fullscreen pass did not provide its native draw owner');
  return compiling.then(() => {});
}

function compileTarget(
  renderer: T.WebGLRenderer,
  view: T.Object3D,
  camera: T.Camera,
  target: T.WebGLRenderTarget | null,
  preparation?: { cancelled: () => boolean; beforeMetadata?: () => void },
  targetScene?: T.Scene,
) {
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new T.Vector4());
  const scissor = renderer.getScissor(new T.Vector4());
  const scissorTest = renderer.getScissorTest();
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
    const compiling = targetScene
      ? renderer.compileAsync(view, camera, targetScene)
      : renderer.compileAsync(view, camera);
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
      for (const program of programs)
        if (retained.has(program) && program.usedTimes > 0) program.getUniforms();
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
