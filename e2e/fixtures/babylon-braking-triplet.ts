import * as T from 'three';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { WebGLPipelineContext } from '@babylonjs/core/Engines/WebGL/webGLPipelineContext.js';
import { distanceBoardLabel } from '../../src/rendering/studio/branding-plan.ts';
import { Track } from '../../src/simulation/track.ts';
import { TRACK_BOARDS, decodeTrackBoards } from '../../src/rendering/track-boards.ts';
import { loadBabylonBrakingTriplet } from '../../src/engine/babylon/braking-triplet.ts';
import {
  BabylonPresentationGpu,
  cleanupPresentation,
} from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import {
  prepareOriginalMaterials,
  yieldPreparationTurn,
} from '../../src/engine/babylon/asset-preparation.ts';
import { createSurfaceProbeHarness, surfaceProbeResources } from './babylon-surface-parity.ts';
import {
  a07TextureGamma,
  a07ProgramGamma,
  assertA07GammaTransport,
} from './babylon-start-gantry-gamma.ts';

// Preregistered before GPU execution: RGBA8 rounding contributes at most one
// code per independently evaluated pipeline; allow two codes max, mean <= .25.
// Camera projection/view Float32 matrices are shared; source geometry/UVs and
// hardware filters/mips are unchanged. Exclude only the outer two-pixel geometry
// boundary (never disagreeing artwork). Missing/excess coverage is counted over
// the ENTIRE frame, with <=8 total boundary pixels and zero missing interior.
const FACTOR_LIMITS = Object.freeze({ max: 2, mean: 0.25, coverageMismatchPixels: 8 });
const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const equal = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => n === b[i]);
const hash = async (data: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');

/** Fixture-local output only. Reads native albedo AFTER native texture sampling,
 * or actual view-space normal BEFORE lighting. No global shader edit. */
class BoardFactorOutput extends MaterialPluginBase {
  mode = 0;
  constructor(material: PBRMaterial) {
    super(
      material,
      'IsolatedOriginalBoardFactors',
      300,
      { BOARD_FACTOR_OUTPUT: true },
      true,
      false,
    );
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'boardProbeMode', size: 1, type: 'float' },
        { name: 'boardProbeView', size: 16, type: 'mat4' },
      ],
      fragment: 'uniform float boardProbeMode; uniform mat4 boardProbeView;',
    };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('boardProbeMode', this.mode);
    buffer.updateMatrix('boardProbeView', this._material.getScene().getViewMatrix());
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: 'vec3 boardProbeAlbedo; vec3 boardProbeNormal;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS:
            'boardProbeAlbedo=surfaceAlbedo; boardProbeNormal=normalize(mat3(boardProbeView)*normalW);',
          CUSTOM_FRAGMENT_MAIN_END:
            'gl_FragColor=vec4(boardProbeMode<.5 ? boardProbeAlbedo : boardProbeNormal*.5+.5,1.0);',
        }
      : null;
  }
}
function metrics(actual: Uint8Array, expected: Uint8Array, width: number, height: number) {
  let compared = 0,
    max = 0,
    sum = 0,
    missing = 0,
    excess = 0,
    missingInterior = 0,
    partialAlpha = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (expected[i + 3] === 255 && actual[i + 3] !== 255) missing++;
      if (actual[i + 3] === 255 && expected[i + 3] === 0) excess++;
      if (
        (actual[i + 3] !== 0 && actual[i + 3] !== 255) ||
        (expected[i + 3] !== 0 && expected[i + 3] !== 255)
      )
        partialAlpha++;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
      const interior = [-2, -1, 0, 1, 2].every(
        (d) => expected[i + d * 4 + 3] === 255 && expected[i + d * width * 4 + 3] === 255,
      );
      if (interior && actual[i + 3] !== 255) missingInterior++;
      if (!interior || actual[i + 3] !== 255) continue;
      compared++;
      for (let c = 0; c < 3; c++) {
        const error = Math.abs(actual[i + c] - expected[i + c]);
        max = Math.max(max, error);
        sum += error;
      }
    }
  return {
    compared,
    max,
    mean: sum / (compared * 3),
    missing,
    excess,
    missingInterior,
    partialAlpha,
  };
}

/** Read only inside the existing renderer-owned frame. These are the GLSL
 * strings supplied to GL, not driver-translated machine code. Block-backed
 * matrices are deliberately NOT mislabeled as getUniform readbacks. */
function diagnosticErrors(gl: WebGL2RenderingContext) {
  const errors: number[] = [];
  for (let i = 0; i < 16; i++) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    errors.push(error);
  }
  return errors;
}
function submittedProgramDiagnostic(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const matrixTypes = new Set<number>([
    gl.FLOAT_MAT2,
    gl.FLOAT_MAT3,
    gl.FLOAT_MAT4,
    gl.FLOAT_MAT2x3,
    gl.FLOAT_MAT2x4,
    gl.FLOAT_MAT3x2,
    gl.FLOAT_MAT3x4,
    gl.FLOAT_MAT4x2,
    gl.FLOAT_MAT4x3,
  ]);
  const matrices: object[] = [];
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let index = 0; index < Math.min(uniformCount, 1024); index++) {
    const info = gl.getActiveUniform(program, index);
    if (!info || !matrixTypes.has(info.type) || matrices.length >= 48) continue;
    const block = (gl.getActiveUniforms(program, [index], gl.UNIFORM_BLOCK_INDEX) as number[])[0];
    if (block !== -1 && block !== gl.INVALID_INDEX) {
      matrices.push({
        name: info.name,
        type: info.type,
        size: info.size,
        storage: 'uniform block; actual GPU matrix bytes NOT read',
        block: gl.getActiveUniformBlockName(program, block),
      });
      continue;
    }
    const location = gl.getUniformLocation(program, info.name);
    const values = location ? (gl.getUniform(program, location) as Float32Array | null) : null;
    matrices.push({
      name: info.name,
      type: info.type,
      size: info.size,
      storage: 'actual ordinary uniform readback for this draw',
      values: values ? Array.from(values).slice(0, 1024) : null,
      truncated: values ? values.length > 1024 : false,
    });
  }
  const attributes: object[] = [];
  const count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < Math.min(count, 16); i++) {
    const info = gl.getActiveAttrib(program, i);
    if (!info) continue;
    const location = gl.getAttribLocation(program, info.name);
    attributes.push({
      name: info.name,
      location,
      type: info.type,
      enabled: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
      components: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE),
      componentType: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_TYPE),
      normalized: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
      stride: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
      offset: gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER),
      bufferBound: !!gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
    });
  }
  return {
    label:
      'Actual attached GL shader-source strings and current-draw state; not driver-translated output',
    currentProgram: gl.getParameter(gl.CURRENT_PROGRAM) === program,
    linked: !!gl.getProgramParameter(program, gl.LINK_STATUS),
    shaders: (gl.getAttachedShaders(program) ?? []).slice(0, 2).map((shader) => {
      const source = gl.getShaderSource(shader) ?? '';
      return {
        type: gl.getShaderParameter(shader, gl.SHADER_TYPE),
        source: source.slice(0, 1048576),
        sourceLength: source.length,
        truncated: source.length > 1048576,
      };
    }),
    matrices,
    attributes,
  };
}
type ClipDrawReceipt = {
  currentProgram?: boolean;
  pluginPresent?: boolean;
  programIndex?: number;
  uniforms?: { name: string; block: number | null; values: number[] | null }[];
  worldIdentity?: boolean;
  sameSceneMatrices?: boolean;
};
type ProgramDiagnostic = {
  name: string;
  state?: ReturnType<typeof submittedProgramDiagnostic>;
  cpuMirrors?: object;
  error?: string;
  preExistingGlError: number;
  diagnosticGlErrors?: number[];
};
/** Readback only after completed frames, under that context's existing prepare
 * lease. Attach an already-owned albedo texture; never replace/regenerate mips.
 * Restore READ_FRAMEBUFFER/read-buffer and all pixel-pack state independently. */
async function existingMipDiagnostic(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
) {
  const rows: {
    level: number;
    width: number;
    height: number;
    status: number;
    format: number;
    type: number;
    hash?: string;
    rgba?: number[];
    glError?: number;
    additionalDiagnosticErrors?: number[];
  }[] = [];
  const preExistingGlError = gl.getError();
  if (preExistingGlError !== 0)
    return {
      label: 'Skipped diagnostics after prior lane GL error',
      rows,
      error: null,
      preExistingGlError,
      restoredGlError: 0,
    };
  const savedFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const savedReadBuffer = gl.getParameter(gl.READ_BUFFER) as number;
  const savedPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
  const packing = [
    gl.PACK_ALIGNMENT,
    gl.PACK_ROW_LENGTH,
    gl.PACK_SKIP_PIXELS,
    gl.PACK_SKIP_ROWS,
  ].map((parameter) => ({ parameter, value: gl.getParameter(parameter) as number }));
  const framebuffer = gl.createFramebuffer();
  let error: string | null = null;
  try {
    check(framebuffer, 'A09 diagnostic read framebuffer unavailable');
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    packing.forEach(({ parameter }) =>
      gl.pixelStorei(parameter, parameter === gl.PACK_ALIGNMENT ? 1 : 0),
    );
    const levels = Math.min(10, 1 + Math.floor(Math.log2(Math.max(width, height))));
    for (let level = 0; level < levels; level++) {
      const w = Math.max(1, width >> level),
        h = Math.max(1, height >> level);
      gl.framebufferTexture2D(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        level,
      );
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      const status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
      const row: {
        level: number;
        width: number;
        height: number;
        status: number;
        format: number;
        type: number;
        hash?: string;
        rgba?: number[];
        glError?: number;
        additionalDiagnosticErrors?: number[];
      } = { level, width: w, height: h, status, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
      rows.push(row);
      if (status === gl.FRAMEBUFFER_COMPLETE) {
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        row.hash = await hash(pixels);
        if (level === 4 || level === 5) row.rgba = Array.from(pixels);
      }
      row.glError = gl.getError();
      row.additionalDiagnosticErrors = diagnosticErrors(gl);
    }
  } catch (cause) {
    error = String(cause);
  } finally {
    const failures = cleanupPresentation([
      () => gl.bindFramebuffer(gl.READ_FRAMEBUFFER, savedFramebuffer),
      () => gl.readBuffer(savedReadBuffer),
      () => gl.bindBuffer(gl.PIXEL_PACK_BUFFER, savedPack),
      ...packing.map(
        ({ parameter, value }) =>
          () =>
            gl.pixelStorei(parameter, value),
      ),
      () => gl.deleteFramebuffer(framebuffer),
    ]);
    if (failures.length && error === null) error = String(failures[0]);
  }
  return {
    label: 'Actual existing albedo mip RGBA readbacks, GPU row order; no mip regeneration',
    rows,
    error,
    preExistingGlError,
    restoredGlError: gl.getError(),
    additionalRestoredErrors: diagnosticErrors(gl),
  };
}

// Each acquisition registers an idempotent cleanup immediately. Setup failures
// therefore retain partial evidence and drain later owners independently.
async function probe(forceStandalone: boolean, loseContext: boolean, deadline: number) {
  const rows: object[] = [],
    receipts: object[] = [],
    images: { name: string; image: string }[] = [];
  const cleanups: (() => void)[] = [];
  const retain = (cleanup: () => void) => {
    let attempted = false;
    const once = () => {
      if (!attempted) {
        attempted = true;
        cleanup();
      }
    };
    cleanups.push(once);
    return once;
  };
  let failure: string | null = null,
    loss: object | null = null,
    transport = 'unknown';
  try {
    const width = 768,
      height = 512;
    const h = createSurfaceProbeHarness(width, height, undefined, forceStandalone);
    retain(() => h.dispose());
    transport = h.transport;
    h.deadline = deadline;
    const timer = setTimeout(
      () => h.abort.abort(new Error('A09 shared 120s deadline exceeded')),
      Math.max(0, deadline - performance.now()),
    );
    retain(() => clearTimeout(timer));
    const gl = h.gl,
      track = new Track();
    const nativeRenderErrors: number[] = [],
      originalRenderErrors: number[] = [];
    const camera = new UniversalCamera(
      'A09 fixed source inspection',
      new Vector3(0, 3, 10),
      h.scene,
    );
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.minZ = 0.1;
    camera.maxZ = 100;
    camera.setTarget(Vector3.Zero());
    new HemisphericLight('fixture-only neutral light', Vector3.Up(), h.scene);
    const warm = new PBRMaterial('shared infrastructure', h.scene);
    warm.dispose();
    const resources = () => ({
      ...surfaceProbeResources(h.scene),
      transforms: h.scene.transformNodes.length,
      lights: h.scene.lights.length,
    });
    const baseline = resources();
    const baselineObjects = [
      ...h.scene.meshes,
      ...h.scene.materials,
      ...h.scene.textures,
      ...h.scene.geometries,
      ...h.scene.transformNodes,
      ...h.scene.lights,
    ];
    const options = (signal = h.abort.signal) => ({
      scene: h.scene,
      track,
      context: {
        presentation: 'circuit',
        vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
      } as const,
      base: location.origin + '/',
      signal,
      gpu: h.gpu,
      deadline,
      schedule: h.schedule,
      isCurrent: () => !signal.aborted && !h.scene.isDisposed,
    });
    const lease = async <R>(label: string, work: () => Promise<R>) => {
      let value!: R;
      await h.gpu.prepare(label, deadline, async (signal) => {
        signal.throwIfAborted();
        value = await work();
        signal.throwIfAborted();
      });
      return value;
    };
    const pump = async <R>(pending: Promise<R>) => {
      let done = false;
      void pending.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );
      while (!done) {
        h.abort.signal.throwIfAborted();
        h.gpu.ready();
        await Promise.resolve();
        if (done) break;
        h.gpu.frame(h.schedule, false, h.scene, () => {
          const before = h.scene.isReady();
          h.engine.beginFrame();
          h.scene.render();
          h.engine.endFrame();
          const after = h.scene.isReady();
          h.schedule.rendered(before, after);
          return before && after;
        });
        await yieldPreparationTurn(h.abort.signal, deadline);
      }
      return await pending;
    };
    const threeCanvas = document.createElement('canvas');
    document.body.append(threeCanvas);
    retain(() => threeCanvas.remove());
    const renderer = new T.WebGLRenderer({
      canvas: threeCanvas,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    retain(() => renderer.dispose());
    renderer.setSize(width, height);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0, 0);
    const threeGl = renderer.getContext() as WebGL2RenderingContext;
    const threeGpu = new BabylonPresentationGpu(threeGl);
    retain(() => threeGpu.dispose());
    const threeSchedule = new PresentationSchedule(),
      threeScene = new T.Scene(),
      threeCamera = new T.OrthographicCamera();
    // Reference-only neutral illumination keeps the original PBR sampling paths
    // active before factor instrumentation; final lit RGB is never compared.
    threeScene.add(new T.HemisphereLight(0xffffff, 0x000000, 1));
    threeCamera.matrixAutoUpdate = false;
    threeCamera.matrixWorldAutoUpdate = false;
    threeCanvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        threeGpu.contextLost();
        h.abort.abort(new Error('A09 reference lost'));
      },
      { signal: h.abort.signal },
    );
    let referenceDrawing = false;
    const referenceFrame = async () => {
      const before = threeGpu.diagnostics().completed;
      while (threeGpu.diagnostics().completed < before + 2) {
        h.abort.signal.throwIfAborted();
        threeGpu.ready();
        if (threeGpu.diagnostics().completed >= before + 2) break;
        threeGpu.frame(threeSchedule, false, threeScene, () => {
          referenceDrawing = true;
          try {
            renderer.render(threeScene, threeCamera);
          } finally {
            referenceDrawing = false;
          }
          return true;
        });
        await yieldPreparationTurn(h.abort.signal, deadline);
      }
      let result!: { pixels: Uint8Array; image: string; glError: number; frames: number };
      await threeGpu.prepare('A09 original reference readback', deadline, async () => {
        const pixels = new Uint8Array(width * height * 4);
        threeGl.readPixels(0, 0, width, height, threeGl.RGBA, threeGl.UNSIGNED_BYTE, pixels);
        result = {
          pixels,
          image: threeCanvas.toDataURL('image/png'),
          glError: threeGl.getError() || originalRenderErrors.find((error) => error !== 0) || 0,
          frames: threeGpu.diagnostics().completed - before,
        };
      });
      return result;
    };
    // Forward unchanged native allocation calls. No GL queries in these hooks.
    const nativeBind = gl.bindTexture,
      nativeImage = gl.texImage2D,
      nativeMip = gl.generateMipmap;
    let bound: WebGLTexture | null = null;
    const allocations: {
        texture: WebGLTexture | null;
        internalFormat: number;
        width: number;
        height: number;
        bytes: Uint8Array;
      }[] = [],
      mips: WebGLTexture[] = [];
    gl.bindTexture = function (target, texture) {
      if (target === gl.TEXTURE_2D) bound = texture;
      return nativeBind.call(this, target, texture);
    };
    gl.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args.length >= 9 && args[3] === 256 && args[4] === 256 && ArrayBuffer.isView(args[8])) {
        const data = args[8] as ArrayBufferView;
        allocations.push({
          texture: bound,
          internalFormat: args[2] as number,
          width: 256,
          height: 256,
          bytes: new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
        });
      }
      return Reflect.apply(nativeImage, this, args);
    } as typeof gl.texImage2D;
    gl.generateMipmap = function (target) {
      if (target === gl.TEXTURE_2D && bound) mips.push(bound);
      return nativeMip.call(this, target);
    };
    retain(() => {
      gl.bindTexture = nativeBind;
      gl.texImage2D = nativeImage;
      gl.generateMipmap = nativeMip;
    });
    const response = await fetch(new URL(TRACK_BOARDS.url, location.origin), {
      signal: h.abort.signal,
    });
    check(response.ok, 'A09 original reference fetch');
    const raw = new Uint8Array(await response.arrayBuffer());
    receipts.push({ phase: 'source', sha256: await hash(raw), bytes: raw.length });
    check(
      raw.length === 676084 && (await hash(raw)) === TRACK_BOARDS.sha256,
      'A09 original asset identity',
    );
    // CPU PNG rows are source top-to-bottom. Native GLTF invertY=false makes
    // GPU row zero the same source row; prints separately use explicit reversal.
    const atlases = await lease('A09 independent embedded PNG decode', async () => {
      const jsonLength = new DataView(raw.buffer).getUint32(12, true),
        binary = 28 + jsonLength;
      const doc = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + jsonLength))) as {
        materials: {
          normalTexture: { index: number; scale: number };
          pbrMetallicRoughness: {
            baseColorTexture: { index: number };
            metallicRoughnessTexture: { index: number };
          };
        }[];
        textures: { source: number }[];
        images: { bufferView: number; mimeType: string }[];
        bufferViews: { byteOffset?: number; byteLength: number }[];
      };
      const mat = doc.materials[0];
      const decoded = [];
      for (const [role, index] of [
        ['baseColor', mat.pbrMetallicRoughness.baseColorTexture.index],
        ['normal', mat.normalTexture.index],
        ['metallicRoughness', mat.pbrMetallicRoughness.metallicRoughnessTexture.index],
      ] as const) {
        const img = doc.images[doc.textures[index].source],
          v = doc.bufferViews[img.bufferView],
          start = binary + (v.byteOffset ?? 0),
          png = raw.slice(start, start + v.byteLength);
        check(
          img.mimeType === 'image/png' && start + v.byteLength <= raw.length,
          'A09 embedded PNG bounds',
        );
        const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
          imageOrientation: 'none',
        });
        try {
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
            ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          check(ctx, 'A09 PNG decoder');
          ctx!.drawImage(bitmap, 0, 0);
          const pixels = new Uint8Array(ctx!.getImageData(0, 0, bitmap.width, bitmap.height).data);
          decoded.push({
            role,
            index,
            width: bitmap.width,
            height: bitmap.height,
            pixels,
            pngHash: await hash(png),
            rgbaHash: await hash(pixels),
          });
        } finally {
          bitmap.close();
        }
      }
      return decoded;
    });
    // Cancel after real native decoding/preparation, never substitute materials.
    const cancelled = new AbortController();
    let cancellationObserved = false;
    const cancellationStart = allocations.length;
    try {
      await pump(
        loadBabylonBrakingTriplet(options(AbortSignal.any([h.abort.signal, cancelled.signal])), {
          prepare: async (...args) => {
            await prepareOriginalMaterials(...args);
            cancelled.abort();
          },
        }),
      );
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
      cancellationObserved = true;
    }
    const cancelledTexturesDeleted = await lease(
      'A09 cancelled native texture deletion',
      async () => {
        const owned = allocations.slice(cancellationStart);
        return owned.length === 3 && owned.every((x) => x.texture && !gl.isTexture(x.texture));
      },
    );
    receipts.push({
      phase: 'cancelled',
      cancellationObserved,
      cancelledTexturesDeleted,
      resources: resources(),
    });
    check(
      cancellationObserved &&
        cancelledTexturesDeleted &&
        JSON.stringify(resources()) === JSON.stringify(baseline),
      'A09 cancellation leaked scene ownership',
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      const owner = await pump(loadBabylonBrakingTriplet(options()));
      const disposeOwner = retain(() => owner.dispose());
      const d = owner.diagnostics();
      const canvasHashes = await Promise.all(
        d.labels.map((l) =>
          hash(new Uint8Array(l.sourceCanvas.getContext('2d')!.getImageData(0, 0, 256, 256).data)),
        ),
      );
      receipts.push({
        cycle,
        phase: 'staged',
        stagedParts: d.stagedParts,
        activeParts: d.activeParts,
        materials: d.retainedMaterials,
        textures: d.retainedTextures,
        triangles: d.retainedTriangles,
        stations: d.stations,
        resources: resources(),
      });
      check(
        d.stagedParts === 6 &&
          d.activeParts === 0 &&
          d.retainedMaterials === 4 &&
          d.retainedTextures === 6 &&
          d.retainedTriangles === 4950 &&
          d.retainedMeshes === 6 &&
          equal(d.stations, [420, 470, 520]) &&
          JSON.stringify(resources()) === JSON.stringify(baseline),
        'A09 exact off-scene triplet inventory',
      );
      // The unchanged source kit executes the original placement/conformation.
      // It borrows the OWNER'S exact stroke canvases, not a second rendering.
      const referenceRoot = new T.Group();
      threeScene.add(referenceRoot);
      retain(() => referenceRoot.removeFromParent());
      let kit: Awaited<ReturnType<typeof decodeTrackBoards>> | undefined;
      const disposeKit = retain(() => kit?.dispose());
      await threeGpu.prepare('A09 original GLTF/source kit decode', deadline, async () => {
        kit = await decodeTrackBoards(raw, undefined, (text, w, hgt) => {
          const label = d.labels.find((x) => x.text === text);
          // Unselected labels retain their original producer and never enter a view.
          if (!label) return distanceBoardLabel(text, w, hgt);
          const canvas = label.sourceCanvas;
          check(w === 256 && hgt === 256, 'A09 original label size');
          const texture = new T.CanvasTexture(canvas);
          texture.colorSpace = T.SRGBColorSpace;
          texture.anisotropy = 8;
          return texture;
        });
        kit.build(track, referenceRoot);
        threeScene.updateMatrixWorld(true);
      });
      const refs = d.parts.map((part) => {
        const index = kit!.sites.findIndex(
          (site) =>
            site.s === part.station &&
            site.text === part.text &&
            site.variant === 'clean' &&
            site.lateral === -18,
        );
        check(index >= 0, 'Original A09 fixed station missing');
        const ref = kit!.chunks[index].levels[0].children[
          part.kind === 'structure' ? 0 : 1
        ] as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
        return ref;
      });
      kit!.chunks.forEach((chunk) =>
        chunk.levels.forEach((level) => {
          level.visible = false;
        }),
      );
      const geometry = d.parts.map((part, i) => ({
        name: part.name,
        position: equal(
          part.mesh.getVerticesData('position')!,
          refs[i].geometry.attributes.position.array,
        ),
        normal: equal(
          part.mesh.getVerticesData('normal')!,
          refs[i].geometry.attributes.normal.array,
        ),
        uv: equal(part.mesh.getVerticesData('uv')!, refs[i].geometry.attributes.uv.array),
        indices: equal(part.mesh.getIndices()!, refs[i].geometry.index!.array),
        world: equal(
          part.mesh.getWorldMatrix().asArray(),
          new Float32Array(refs[i].matrixWorld.elements),
        ),
      }));
      receipts.push({ cycle, phase: 'original-geometry', geometry });
      check(
        geometry.length === 6 &&
          geometry.every((x) => x.position && x.normal && x.uv && x.indices && x.world),
        'A09 actual original buffers/world mismatch',
      );
      // Camera basis is the ORIGINAL print plane's positive normal and tangent.
      // Fixed offsets/extents below are never selected from rendered candidate pixels.
      const setView = (text: string, view: 'front' | 'rear' | 'grazing') => {
        const ref = refs[d.parts.findIndex((p) => p.text === text && p.kind === 'print')];
        ref.geometry.computeBoundingBox();
        const center = ref.geometry
          .boundingBox!.getCenter(new T.Vector3())
          .applyMatrix4(ref.matrixWorld);
        const structure = refs[d.parts.findIndex((p) => p.text === text && p.kind === 'structure')];
        structure.geometry.computeBoundingBox();
        center.y = structure.geometry
          .boundingBox!.getCenter(new T.Vector3())
          .applyMatrix4(structure.matrixWorld).y;
        const normal = new T.Vector3()
          .fromBufferAttribute(ref.geometry.attributes.normal as T.BufferAttribute, 0)
          .transformDirection(ref.matrixWorld);
        const tangent = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), normal).normalize();
        const eye = center
          .clone()
          .addScaledVector(normal, view === 'rear' ? -8 : view === 'grazing' ? 2 : 8)
          .addScaledVector(tangent, view === 'grazing' ? 8 : 0);
        camera.position.set(eye.x, eye.y, eye.z);
        camera.setTarget(new Vector3(center.x, center.y, center.z));
        const extent = 2.25;
        camera.orthoLeft = -extent;
        camera.orthoRight = extent;
        camera.orthoTop = (extent * height) / width;
        camera.orthoBottom = (-extent * height) / width;
        camera.getViewMatrix(true);
        camera.getProjectionMatrix(true);
        threeCamera.projectionMatrix.fromArray(camera.getProjectionMatrix().asArray());
        threeCamera.projectionMatrixInverse.copy(threeCamera.projectionMatrix).invert();
        threeCamera.matrixWorldInverse.fromArray(camera.getViewMatrix().asArray());
        threeCamera.matrixWorld.copy(threeCamera.matrixWorldInverse).invert();
        d.parts.forEach((p) => p.mesh.setEnabled(p.text === text));
        kit!.chunks.forEach((c) =>
          c.levels.forEach((g) => {
            g.visible = false;
          }),
        );
        ref.parent!.visible = true;
        return {
          text,
          view,
          eye: eye.toArray(),
          center: center.toArray(),
          normal: normal.toArray(),
          extent,
        };
      };
      setView('150', 'front');
      // Installation itself must include all six selected parts, never hidden LODs.
      d.parts.forEach((p) => p.mesh.setEnabled(true));
      const installedBefore = h.gpu.diagnostics().completed;
      await pump(owner.install());
      const ready = owner.diagnostics();
      receipts.push({
        cycle,
        phase: 'ready',
        activeParts: ready.activeParts,
        activeMaterials: ready.activeMaterials,
        activeTextures: ready.activeTextures,
        completed: h.gpu.diagnostics().completed - installedBefore,
      });
      check(
        ready.activeParts === 6 &&
          ready.activeMaterials === 4 &&
          ready.activeTextures === 6 &&
          h.gpu.diagnostics().completed >= installedBefore + 2,
        'A09 active ownership/fresh presentation',
      );
      let duplicateRejected = false;
      try {
        await owner.install();
      } catch {
        duplicateRejected = true;
      }
      check(duplicateRejected, 'A09 duplicate installation accepted');
      const sourceSamplerSeen = new Set<T.Texture>();
      const readReferenceSamplers = async (text: string) => {
        await threeGpu.prepare('A09 actual original source samplers', deadline, async () => {
          const selected = refs.filter((_, i) => d.parts[i].text === text);
          for (const ref of selected)
            for (const texture of [
              ref.material.map,
              ref.material.normalMap,
              ref.material.metalnessMap,
              ref.material.roughnessMap,
            ]) {
              if (!texture || sourceSamplerSeen.has(texture)) continue;
              sourceSamplerSeen.add(texture);
              const handle = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture })
                .__webglTexture;
              const prior = threeGl.getParameter(threeGl.TEXTURE_BINDING_2D) as WebGLTexture | null;
              check(handle, 'A09 original texture native allocation absent');
              let min = 0,
                mag = 0,
                wrapS = 0,
                wrapT = 0,
                anisotropy = 0,
                maximum = 0;
              try {
                threeGl.bindTexture(threeGl.TEXTURE_2D, handle!);
                min = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_MIN_FILTER);
                mag = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_MAG_FILTER);
                wrapS = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_WRAP_S);
                wrapT = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_WRAP_T);
                const ext = threeGl.getExtension('EXT_texture_filter_anisotropic');
                check(ext, 'A09 original anisotropy extension absent');
                anisotropy = threeGl.getTexParameter(
                  threeGl.TEXTURE_2D,
                  ext!.TEXTURE_MAX_ANISOTROPY_EXT,
                );
                maximum = threeGl.getParameter(ext!.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
              } finally {
                threeGl.bindTexture(threeGl.TEXTURE_2D, prior);
              }
              receipts.push({
                cycle,
                phase: 'original-native-sampler',
                name: ref.name,
                texture: texture.name,
                min,
                mag,
                wrapS,
                wrapT,
                anisotropy,
                declaredAnisotropy: texture.anisotropy,
              });
              check(
                min === threeGl.LINEAR_MIPMAP_LINEAR &&
                  mag === threeGl.LINEAR &&
                  wrapS === threeGl.CLAMP_TO_EDGE &&
                  wrapT === threeGl.CLAMP_TO_EDGE &&
                  anisotropy === Math.min(texture.anisotropy, maximum),
                'A09 original sampler contract',
              );
            }
        });
      };
      // Production owner, not a fixture transform override. All reflection and
      // ordinary uniform reads occur immediately after this mesh's owned draw.
      const clipPrograms = new Map<WebGLProgram, number>();
      const captureClip = (
        part: (typeof d.parts)[number],
        program: WebGLProgram,
        result: ClipDrawReceipt,
      ) => {
        result.currentProgram = gl.getParameter(gl.CURRENT_PROGRAM) === program;
        result.pluginPresent = !!part.material.pluginManager?.getPlugin('OriginalA09ClipOrder');
        if (!clipPrograms.has(program)) {
          check(clipPrograms.size < 16, 'A09 bounded production clip program inventory exceeded');
          const index = clipPrograms.size;
          clipPrograms.set(program, index);
          const programRow: {
            phase: string;
            cycle: number;
            index: number;
            linked?: boolean;
            vertexSource?: string;
            vertexSourceLength?: number;
            sourceComplete?: boolean;
            marker?: boolean;
            ordinarySite?: boolean;
            declarations?: boolean;
            fragmentHasNoClipUniforms?: boolean;
          } = { phase: 'production-original-clip-program', cycle, index };
          receipts.push(programRow);
          const sources = (gl.getAttachedShaders(program) ?? []).map((shader) => ({
            type: gl.getShaderParameter(shader, gl.SHADER_TYPE) as number,
            source: gl.getShaderSource(shader) ?? '',
          }));
          const vertex = sources.find((s) => s.type === gl.VERTEX_SHADER)?.source ?? '';
          const fragment = sources.find((s) => s.type === gl.FRAGMENT_SHADER)?.source ?? '';
          programRow.linked = !!gl.getProgramParameter(program, gl.LINK_STATUS);
          programRow.vertexSource = vertex.slice(0, 262144);
          programRow.vertexSourceLength = vertex.length;
          programRow.sourceComplete = vertex.length > 0 && vertex.length <= 262144;
          programRow.marker =
            /^#define ORIGINAL_A09_CLIP_ORDER\b/m.test(vertex) &&
            !/^#define MULTIVIEW\b/m.test(vertex);
          programRow.ordinarySite =
            vertex.split(
              '#else\ngl_Position=a09OriginalProjection*(a09OriginalView*worldPos);\n#endif',
            ).length === 2;
          programRow.declarations =
            vertex.split('uniform mat4 a09OriginalView;').length === 2 &&
            vertex.split('uniform mat4 a09OriginalProjection;').length === 2;
          programRow.fragmentHasNoClipUniforms =
            fragment.length > 0 && !/a09OriginalView|a09OriginalProjection/.test(fragment);
          check(
            sources.length === 2 &&
              programRow.linked &&
              programRow.sourceComplete &&
              programRow.marker &&
              programRow.ordinarySite &&
              programRow.declarations &&
              programRow.fragmentHasNoClipUniforms,
            'A09 actual production clip shader source/site missing',
          );
        }
        result.programIndex = clipPrograms.get(program);
        const names = ['a09OriginalView', 'a09OriginalProjection'];
        const indices = gl.getUniformIndices(program, names);
        result.uniforms = names.map((name, i) => {
          const index = indices?.[i] ?? gl.INVALID_INDEX;
          const block =
            index === gl.INVALID_INDEX
              ? null
              : (gl.getActiveUniforms(program, [index], gl.UNIFORM_BLOCK_INDEX) as number[])[0];
          const location = gl.getUniformLocation(program, name);
          const values = location
            ? (gl.getUniform(program, location) as Float32Array | null)
            : null;
          return { name, block, values: values ? Array.from(values) : null };
        });
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        result.worldIdentity = equal(part.mesh.getWorldMatrix().asArray(), identity);
        result.sameSceneMatrices =
          !!result.uniforms[0].values &&
          !!result.uniforms[1].values &&
          equal(result.uniforms[0].values, h.scene.getViewMatrix().asArray()) &&
          equal(result.uniforms[1].values, h.scene.getProjectionMatrix().asArray());
        check(
          result.currentProgram &&
            result.pluginPresent &&
            result.worldIdentity &&
            result.sameSceneMatrices &&
            result.uniforms.every(
              (u) => (u.block === -1 || u.block === gl.INVALID_INDEX) && u.values?.length === 16,
            ),
          `A09 ${part.name} actual production ordinary clip matrices mismatch`,
        );
      };
      let pbrDrawing = false;
      const pbrDraws: {
        name: string;
        kind: string;
        currentProgram: boolean;
        bindings: { sampler: string; unit: number; matches: boolean }[];
        clip: ClipDrawReceipt;
      }[] = [];
      receipts.push({ cycle, phase: 'native-PBR-draw-bindings', draws: pbrDraws });
      const pbrObservers = d.parts.map((part) => ({
        mesh: part.mesh,
        observer: part.mesh.onAfterRenderObservable.add(() => {
          check(pbrDrawing, 'A09 native PBR binding query outside owned frame');
          const effect = part.mesh.subMeshes[0]?.effect,
            program = (effect?.getPipelineContext() as WebGLPipelineContext | null)?.program;
          const row = {
            name: part.name,
            kind: part.kind,
            currentProgram: !!program && gl.getParameter(gl.CURRENT_PROGRAM) === program,
            bindings: [] as { sampler: string; unit: number; matches: boolean }[],
            clip: {} as ClipDrawReceipt,
          };
          pbrDraws.push(row);
          check(program && row.currentProgram, 'A09 native PBR current program missing');
          captureClip(part, program!, row.clip);
          const slots =
            part.kind === 'structure'
              ? ([
                  ['albedoSampler', part.material.albedoTexture!],
                  ['bumpSampler', part.material.bumpTexture!],
                  ['reflectivitySampler', part.material.metallicTexture!],
                ] as const)
              : ([['albedoSampler', part.material.albedoTexture!]] as const);
          const prior = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
          try {
            for (const [sampler, texture] of slots) {
              const location = effect!.getUniform(sampler);
              check(location, `A09 native PBR ${sampler} uniform absent`);
              const unit = gl.getUniform(program!, location!) as number;
              check(Number.isInteger(unit) && unit >= 0, 'A09 native sampler unit invalid');
              gl.activeTexture(gl.TEXTURE0 + unit);
              row.bindings.push({
                sampler,
                unit,
                matches:
                  gl.getParameter(gl.TEXTURE_BINDING_2D) ===
                  texture.getInternalTexture()!._hardwareTexture!.underlyingResource,
              });
            }
          } finally {
            gl.activeTexture(prior);
          }
        }),
      }));
      const removePbrObservers = retain(() =>
        pbrObservers.forEach((x) => x.mesh.onAfterRenderObservable.remove(x.observer)),
      );
      for (const text of ['150', '100', '50'])
        for (const view of ['front', 'rear'] as const) {
          const cameraReceipt = setView(text, view);
          if (view === 'front') {
            await threeGpu.prepare(
              'Original uninstrumented A09 PBR compile',
              deadline,
              async () => {
                await renderer.compileAsync(threeScene, threeCamera);
              },
            );
            const originalPbr = await referenceFrame();
            receipts.push({
              cycle,
              phase: 'original-PBR-before-factor-instrumentation',
              text,
              frames: originalPbr.frames,
              glError: originalPbr.glError,
            });
            check(
              originalPbr.frames >= 2 && originalPbr.glError === 0,
              'Original A09 PBR frame completion',
            );
            await readReferenceSamplers(text);
          }
          await h.presented(() => {
            pbrDrawing = true;
            try {
              h.scene.render();
            } finally {
              pbrDrawing = false;
            }
          });
          await lease('A09 original PBR screenshot', async () => {
            const capture = h.capture();
            const glError = gl.getError();
            receipts.push({ cycle, phase: 'native-pbr', ...cameraReceipt, glError });
            if (cycle === 0)
              images.push({ name: `${text}-${view}-native-pbr`, image: capture.image });
            check(glError === 0, 'A09 uninstrumented native PBR GL error');
          });
        }
      removePbrObservers();
      const atlas = d.parts[0].material;
      await lease('A09 uninstrumented native PBR slot and gamma proof', async () => {
        const programs = d.parts.map((p) => {
          const effect = p.mesh.subMeshes[0]?.effect,
            program = (effect?.getPipelineContext() as WebGLPipelineContext | null)?.program;
          return {
            name: p.name,
            kind: p.kind,
            linked:
              !!program &&
              gl.isProgram(program) &&
              !!gl.getProgramParameter(program, gl.LINK_STATUS),
            defines: effect?.defines ?? '',
            samplers: effect?.getSamplers() ?? [],
            error: effect?.getCompilationError(),
            ubo: p.material._uniformBuffer.useUbo,
          };
        });
        const textures = [
          a07TextureGamma(atlas.albedoTexture!, 'baseColor'),
          a07TextureGamma(atlas.bumpTexture!, 'normal'),
          a07TextureGamma(atlas.metallicTexture!, 'metallicRoughness'),
        ];
        const glError = gl.getError();
        receipts.push({
          cycle,
          phase: 'native-PBR-before-factor-instrumentation',
          programs,
          textures,
          draws: pbrDraws,
          glError,
        });
        check(glError === 0, 'A09 native PBR binding/program query GL error');
        check(
          programs.every((p) => p.linked && !p.error && (!forceStandalone || !p.ubo)) &&
            d.parts.every((p) => pbrDraws.some((x) => x.name === p.name)) &&
            pbrDraws.every(
              (x) =>
                x.currentProgram &&
                x.bindings.length === (x.kind === 'structure' ? 3 : 1) &&
                x.bindings.every((b) => b.matches),
            ),
          'A09 actual original PBR draws and sampler bindings',
        );
        assertA07GammaTransport(
          textures,
          programs
            .filter((p) => p.kind === 'structure')
            .map((p) => a07ProgramGamma(p.name, p.defines, p.samplers)),
        );
      });

      const textureList = [
        atlas.albedoTexture!,
        atlas.bumpTexture!,
        atlas.metallicTexture!,
        ...d.labels.map((x) => x.texture),
      ];
      const handles = textureList.map(
        (t) => t.getInternalTexture()!._hardwareTexture!.underlyingResource as WebGLTexture,
      );
      const buffers = await lease('A09 actual GPU buffer identities', async () =>
        d.parts.flatMap((p) => [
          ...['position', 'normal', 'uv'].map(
            (k) => p.mesh.getVertexBuffer(k)!.getBuffer()!.underlyingResource as WebGLBuffer,
          ),
          p.geometry.getIndexBuffer()!.underlyingResource as WebGLBuffer,
        ]),
      );
      await lease('A09 actual original atlas and print bytes', async () => {
        check(
          buffers.length === 24 && buffers.every((b) => gl.isBuffer(b)),
          'A09 six meshes require four live GPU buffers each',
        );
        for (let i = 0; i < textureList.length; i++) {
          const texture = textureList[i],
            internal = texture.getInternalTexture()!,
            hardware = handles[i];
          const source =
            i < 3
              ? atlases[i].pixels
              : new Uint8Array(
                  d.labels[i - 3].sourceCanvas.getContext('2d')!.getImageData(0, 0, 256, 256).data,
                );
          const expected = new Uint8Array(source);
          if (i >= 3)
            for (let y = 0; y < 256; y++)
              expected.set(source.subarray(y * 1024, (y + 1) * 1024), (255 - y) * 1024);
          const pixels = await texture.readPixels();
          check(pixels, 'A09 GPU texture readback');
          const gpuBytes = new Uint8Array(pixels!.buffer, pixels!.byteOffset, pixels!.byteLength);
          const prior = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
          const sampler: {
            min?: number;
            mag?: number;
            wrapS?: number;
            wrapT?: number;
            anisotropy?: number;
            maximum?: number;
          } = {};
          try {
            gl.bindTexture(gl.TEXTURE_2D, hardware);
            sampler.min = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
            sampler.mag = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER);
            sampler.wrapS = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S);
            sampler.wrapT = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T);
            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            if (ext) {
              sampler.anisotropy = gl.getTexParameter(
                gl.TEXTURE_2D,
                ext.TEXTURE_MAX_ANISOTROPY_EXT,
              );
              sampler.maximum = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            }
          } finally {
            gl.bindTexture(gl.TEXTURE_2D, prior);
          }
          const allocation = allocations.find((x) => x.texture === hardware);
          const row = {
            cycle,
            phase: 'native-texture',
            role: i < 3 ? atlases[i].role : d.labels[i - 3].text,
            width: internal.width,
            height: internal.height,
            hardwareSrgb: internal._useSRGBBuffer,
            invertY: internal.invertY,
            sampler,
            exactBytes: equal(gpuBytes, expected),
            sourceHash: await hash(source),
            expectedHash: await hash(expected),
            gpuHash: await hash(new Uint8Array(gpuBytes)),
            allocation: allocation
              ? {
                  internalFormat: allocation.internalFormat,
                  exactBytes: equal(allocation.bytes, expected),
                }
              : null,
            mipmapCalls: mips.filter((x) => x === hardware).length,
            glError: gl.getError(),
            orientation:
              i < 3
                ? 'native GLTF row0 = PNG top row'
                : 'native row0 = same original canvas bottom row; explicit reverse/invertY false',
          };
          receipts.push(row);
          check(
            row.exactBytes &&
              internal.width === (i < 3 ? atlases[i].width : 256) &&
              internal.height === (i < 3 ? atlases[i].height : 256) &&
              row.glError === 0 &&
              sampler.min === gl.LINEAR_MIPMAP_LINEAR &&
              sampler.mag === gl.LINEAR &&
              sampler.wrapS === gl.CLAMP_TO_EDGE &&
              sampler.wrapT === gl.CLAMP_TO_EDGE &&
              (i >= 3 || sampler.anisotropy === 1),
            `A09 ${row.role} original pixels/sampler mismatch`,
          );
          if (i >= 3)
            check(
              internal._useSRGBBuffer === true &&
                row.allocation?.internalFormat === gl.SRGB8_ALPHA8 &&
                row.allocation.exactBytes &&
                row.mipmapCalls > 0 &&
                sampler.anisotropy === Math.min(8, sampler.maximum!),
              `A09 ${row.role} actual sRGB allocation/mip/anisotropy mismatch`,
            );
        }
        check(
          atlas.bumpTexture!.level === 0.3499999940395355 &&
            !atlas.ambientTexture &&
            !atlas.backFaceCulling,
          'A09 authored atlas PBR slots',
        );
      });
      const printRefs = refs.filter((_, i) => d.parts[i].kind === 'print');
      receipts.push({
        cycle,
        phase: 'same-original-canvases',
        labels: printRefs.map((r, i) => ({
          text: d.labels[i].text,
          sameCanvas: r.material.map!.image === d.labels[i].sourceCanvas,
          flipY: r.material.map!.flipY,
          colorSpace: r.material.map!.colorSpace,
        })),
      });
      check(
        printRefs.every(
          (r, i) =>
            r.material.map!.image === d.labels[i].sourceCanvas &&
            r.material.map!.flipY &&
            r.material.map!.colorSpace === T.SRGBColorSpace,
        ),
        'A09 reference must use same original canvases/orientation',
      );
      const plugins = await lease('Install fixture-local A09 factor outputs', async () =>
        [...new Set(d.parts.map((p) => p.material))].map((m) => new BoardFactorOutput(m)),
      );
      const referenceMode = { value: 0 };
      for (const material of new Set(refs.map((r) => r.material))) {
        const previous = material.onBeforeCompile,
          key = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, r) => {
          previous.call(material, shader, r);
          shader.uniforms.boardReferenceMode = referenceMode;
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float boardReferenceMode;')
            .replace(
              '#include <dithering_fragment>',
              '#include <dithering_fragment>\ngl_FragColor=vec4(boardReferenceMode<.5 ? diffuseColor.rgb : normal*.5+.5,1.0);',
            );
        };
        material.customProgramCacheKey = () => key + ':isolated-original-A09-factors';
        material.needsUpdate = true;
      }
      d.parts.forEach((p) => p.mesh.setEnabled(true));
      await prepareOriginalMaterials(
        { scene: h.scene, meshes: d.parts.map((p) => p.mesh) },
        h.gpu,
        h.abort.signal,
        deadline,
        () => {},
      );
      let diagnosticTarget = false;
      const nativePrograms: ProgramDiagnostic[] = [],
        originalPrograms: ProgramDiagnostic[] = [];
      const seenNative = new Set<string>(),
        seenOriginal = new Set<string>();
      let referenceClipMatrices: {
        name: string;
        view?: number[];
        projection?: number[];
        worldIdentity?: boolean;
        currentProgram?: boolean;
      }[] = [];
      const referenceCallbacks = refs.map((ref) => {
        const previous = ref.onAfterRender;
        ref.onAfterRender = (...args) => {
          previous.apply(ref, args);
          check(referenceDrawing, 'A09 original clip matrices outside owned draw');
          const matrixRow: {
            name: string;
            view?: number[];
            projection?: number[];
            worldIdentity?: boolean;
            currentProgram?: boolean;
          } = { name: ref.name };
          referenceClipMatrices.push(matrixRow);
          const originalProgram = threeGl.getParameter(
            threeGl.CURRENT_PROGRAM,
          ) as WebGLProgram | null;
          matrixRow.currentProgram = !!originalProgram;
          check(originalProgram, 'A09 original actual draw program absent');
          for (const [field, name] of [
            ['view', 'modelViewMatrix'],
            ['projection', 'projectionMatrix'],
          ] as const) {
            const location = threeGl.getUniformLocation(originalProgram!, name);
            const values = location
              ? (threeGl.getUniform(originalProgram!, location) as Float32Array | null)
              : null;
            if (values) matrixRow[field] = Array.from(values);
          }
          matrixRow.worldIdentity = equal(
            ref.matrixWorld.elements,
            [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          );
          check(
            matrixRow.worldIdentity &&
              matrixRow.view?.length === 16 &&
              matrixRow.projection?.length === 16,
            'A09 original identity-world matrix readbacks absent',
          );
          if (!diagnosticTarget || seenOriginal.has(ref.name)) return;
          check(referenceDrawing, 'A09 reference diagnostic outside owned draw');
          seenOriginal.add(ref.name);
          const preExistingGlError = threeGl.getError();
          originalRenderErrors.push(preExistingGlError);
          const row: ProgramDiagnostic = { name: ref.name, preExistingGlError };
          originalPrograms.push(row);
          if (preExistingGlError !== 0) return;
          try {
            const program = threeGl.getParameter(threeGl.CURRENT_PROGRAM) as WebGLProgram | null;
            check(program, 'A09 original diagnostic program absent');
            row.state = submittedProgramDiagnostic(threeGl, program!);
            row.cpuMirrors = {
              label: 'Original CPU mirrors immediately after this draw; NOT uniform readbacks',
              view: threeCamera.matrixWorldInverse.toArray(),
              projection: threeCamera.projectionMatrix.toArray(),
              world: ref.matrixWorld.toArray(),
              modelView: ref.modelViewMatrix.toArray(),
            };
          } catch (error) {
            row.error = String(error);
          } finally {
            row.diagnosticGlErrors = diagnosticErrors(threeGl);
          }
        };
        return () => {
          ref.onAfterRender = previous;
        };
      });
      const removeReferenceDiagnostics = retain(() =>
        referenceCallbacks.forEach((cleanup) => cleanup()),
      );
      const draws: {
        name: string;
        kind: string;
        frontFace: number;
        culling: boolean;
        cullMode: number;
        depthTest: boolean;
        depthWrite: boolean;
        depthFunc: number;
        offset: boolean;
        factor: number;
        units: number;
        currentProgram: boolean;
        clip: ClipDrawReceipt;
      }[] = [];
      let drawing = false;
      const observers = d.parts.map((part) => ({
        mesh: part.mesh,
        observer: part.mesh.onAfterRenderObservable.add(() => {
          check(drawing, 'A09 draw receipt outside owned frame');
          if (diagnosticTarget && !seenNative.has(part.name)) {
            seenNative.add(part.name);
            const preExistingGlError = gl.getError();
            nativeRenderErrors.push(preExistingGlError);
            const row: ProgramDiagnostic = { name: part.name, preExistingGlError };
            nativePrograms.push(row);
            if (preExistingGlError === 0)
              try {
                const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
                check(program, 'A09 native diagnostic program absent');
                row.state = submittedProgramDiagnostic(gl, program!);
                row.cpuMirrors = {
                  label: 'Native CPU mirrors immediately after this draw; NOT actual UBO bytes',
                  view: Array.from(h.scene.getViewMatrix().asArray()),
                  projection: Array.from(h.scene.getProjectionMatrix().asArray()),
                  transform: Array.from(h.scene.getTransformMatrix().asArray()),
                  world: Array.from(part.mesh.getWorldMatrix().asArray()),
                };
              } catch (error) {
                row.error = String(error);
              } finally {
                row.diagnosticGlErrors = diagnosticErrors(gl);
              }
          }

          const program = (
            part.mesh.subMeshes[0]?.effect?.getPipelineContext() as WebGLPipelineContext | null
          )?.program;
          const drawRow = {
            name: part.name,
            kind: part.kind,
            frontFace: gl.getParameter(gl.FRONT_FACE),
            culling: gl.isEnabled(gl.CULL_FACE),
            cullMode: gl.getParameter(gl.CULL_FACE_MODE),
            depthTest: gl.isEnabled(gl.DEPTH_TEST),
            depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK),
            depthFunc: gl.getParameter(gl.DEPTH_FUNC),
            offset: gl.isEnabled(gl.POLYGON_OFFSET_FILL),
            factor: gl.getParameter(gl.POLYGON_OFFSET_FACTOR),
            units: gl.getParameter(gl.POLYGON_OFFSET_UNITS),
            currentProgram: !!program && gl.getParameter(gl.CURRENT_PROGRAM) === program,
            clip: {} as ClipDrawReceipt,
          };
          draws.push(drawRow);
          check(program, 'A09 factor draw program absent');
          captureClip(part, program!, drawRow.clip);
        }),
      }));
      const removeObservers = retain(() =>
        observers.forEach((x) => x.mesh.onAfterRenderObservable.remove(x.observer)),
      );
      for (const text of ['150', '100', '50'])
        for (const view of ['front', 'rear', 'grazing'] as const) {
          const cameraReceipt = setView(text, view);
          await threeGpu.prepare('Compile actual original A09 reference', deadline, async () => {
            await renderer.compileAsync(threeScene, threeCamera);
          });
          for (const mode of [0, 1]) {
            plugins.forEach((p) => {
              p.mode = mode;
            });
            referenceMode.value = mode;
            draws.length = 0;
            const row: {
              cycle: number;
              text: string;
              view: string;
              stage: string;
              camera: object;
              referenceExact?: boolean;
              referenceGlErrors?: number[];
              referenceFrames?: number[];
              nativeFrames?: number;
              metrics?: ReturnType<typeof metrics>;
              glError?: number;
              draws?: typeof draws;
              programs?: object[];
              referenceClipMatrices?: typeof referenceClipMatrices;
              productionClipMatchesOriginal?: boolean;
            } = {
              cycle,
              text,
              view,
              stage: mode === 0 ? 'linear-albedo' : 'view-normal',
              camera: cameraReceipt,
            };
            receipts.push(row);
            diagnosticTarget = cycle === 0 && text === '150' && view === 'rear' && mode === 0;
            const diagnostic: {
              phase: string;
              cycle: number;
              text: string;
              view: string;
              nativePrograms: object[];
              originalPrograms: object[];
              sourceGeometry?: object;
              nativeMips?: Awaited<ReturnType<typeof existingMipDiagnostic>>;
              originalMips?: Awaited<ReturnType<typeof existingMipDiagnostic>>;
              error?: string;
            } = {
              phase: 'rear150-readonly-diagnostic',
              cycle,
              text,
              view,
              nativePrograms,
              originalPrograms,
            };
            if (diagnosticTarget) {
              receipts.push(diagnostic);
              const source = refs.find(
                (ref) =>
                  ref.name ===
                  d.parts.find((p) => p.text === '150' && p.kind === 'structure')!.name,
              )!;
              diagnostic.sourceGeometry = {
                label: 'Original CPU geometry for offline interpolation; NOT GPU varying readback',
                name: source.name,
                position: Array.from(source.geometry.attributes.position.array).slice(0, 50000),
                uv: Array.from(source.geometry.attributes.uv.array).slice(0, 50000),
                indices: Array.from(source.geometry.index!.array).slice(0, 50000),
                complete: [
                  source.geometry.attributes.position.array,
                  source.geometry.attributes.uv.array,
                  source.geometry.index!.array,
                ].every((a) => a.length <= 50000),
              };
            }
            referenceClipMatrices = [];
            row.referenceClipMatrices = referenceClipMatrices;
            const first = await referenceFrame();
            if (cycle === 0)
              images.push({ name: `${text}-${view}-${row.stage}-original`, image: first.image });
            const repeat = await referenceFrame();
            row.referenceExact = equal(first.pixels, repeat.pixels);
            row.referenceGlErrors = [first.glError, repeat.glError];
            row.referenceFrames = [first.frames, repeat.frames];
            check(
              row.referenceExact &&
                first.glError === 0 &&
                repeat.glError === 0 &&
                first.frames >= 2 &&
                repeat.frames >= 2,
              'A09 full original reference repeat/frame failure',
            );
            const before = h.gpu.diagnostics().completed;
            await h.presented(() => {
              drawing = true;
              try {
                h.scene.render();
              } finally {
                drawing = false;
              }
            });
            row.nativeFrames = h.gpu.diagnostics().completed - before;
            await lease('A09 linked factor program and image receipt', async () => {
              const actual = h.capture();
              if (cycle === 0)
                images.push({ name: `${text}-${view}-${row.stage}-native`, image: actual.image });
              row.metrics = metrics(actual.pixels, first.pixels, width, height);
              row.glError = gl.getError() || nativeRenderErrors.find((error) => error !== 0) || 0;
              row.draws = [...draws];
              row.productionClipMatchesOriginal =
                draws.length >= 4 &&
                draws.every((draw) => {
                  const source = referenceClipMatrices.filter((ref) => ref.name === draw.name);
                  return (
                    source.length >= 2 &&
                    source.every(
                      (ref) =>
                        ref.worldIdentity &&
                        ref.view &&
                        ref.projection &&
                        draw.clip.uniforms?.[0].values &&
                        draw.clip.uniforms?.[1].values &&
                        equal(draw.clip.uniforms[0].values, ref.view) &&
                        equal(draw.clip.uniforms[1].values, ref.projection),
                    )
                  );
                });
              check(
                row.productionClipMatchesOriginal,
                'A09 production matrices differ from actual original view/projection',
              );
              const active = d.parts.filter((p) => p.text === text);
              const programs = active.map((p) => {
                const effect = p.mesh.subMeshes[0]?.effect,
                  program = (effect?.getPipelineContext() as WebGLPipelineContext | null)?.program;
                return {
                  name: p.name,
                  kind: p.kind,
                  linked:
                    !!program &&
                    gl.isProgram(program) &&
                    !!gl.getProgramParameter(program, gl.LINK_STATUS),
                  error: effect?.getCompilationError(),
                  defines: effect?.defines ?? '',
                  samplers: effect?.getSamplers() ?? [],
                  ubo: p.material._uniformBuffer.useUbo,
                };
              });
              row.programs = programs;
              check(
                programs.every(
                  (p) =>
                    p.linked &&
                    !p.error &&
                    p.samplers.includes('albedoSampler') &&
                    (!forceStandalone || !p.ubo),
                ),
                'A09 actual linked draw programs/transport',
              );
              // Factor output intentionally removes final lighting/metalness.
              // The driver may strip reflectivitySampler here; its actual full
              // PBR binding was verified before instrumentation above.
              check(
                programs
                  .filter((p) => p.kind === 'structure')
                  .every((p) => p.samplers.includes('bumpSampler')),
                'A09 normal-factor native bump sampler absent',
              );
              const print = programs.find((p) => p.kind === 'print')!;
              check(
                !/^\s*#define\s+GAMMAALBEDO\b/m.test(print.defines),
                'A09 print hardware sRGB must not double-decode in shader',
              );
            });
            if (diagnosticTarget) {
              try {
                await threeGpu.prepare(
                  'A09 existing original albedo mip diagnostics',
                  deadline,
                  async () => {
                    const source = refs.find(
                      (ref) =>
                        ref.name ===
                        d.parts.find((p) => p.text === '150' && p.kind === 'structure')!.name,
                    )!;
                    const texture = (
                      renderer.properties.get(source.material.map!) as {
                        __webglTexture?: WebGLTexture;
                      }
                    ).__webglTexture;
                    check(texture, 'A09 original mip allocation absent');
                    diagnostic.originalMips = await existingMipDiagnostic(
                      threeGl,
                      texture!,
                      512,
                      512,
                    );
                  },
                );
                diagnostic.nativeMips = await lease(
                  'A09 existing native albedo mip diagnostics',
                  async () =>
                    existingMipDiagnostic(
                      gl,
                      atlas.albedoTexture!.getInternalTexture()!._hardwareTexture!
                        .underlyingResource as WebGLTexture,
                      512,
                      512,
                    ),
                );
              } catch (error) {
                diagnostic.error = String(error);
              }
              row.glError =
                row.glError ||
                diagnostic.nativeMips?.preExistingGlError ||
                diagnostic.originalMips?.preExistingGlError ||
                0;
            }
            check(
              row.nativeFrames >= 2 &&
                row.glError === 0 &&
                row.metrics!.compared > 100 &&
                row.metrics!.max <= FACTOR_LIMITS.max &&
                row.metrics!.mean <= FACTOR_LIMITS.mean &&
                row.metrics!.missing + row.metrics!.excess <=
                  FACTOR_LIMITS.coverageMismatchPixels &&
                row.metrics!.missingInterior === 0 &&
                row.metrics!.partialAlpha === 0,
              `A09 ${text}/${view}/${row.stage} original factor mismatch`,
            );
            if (diagnosticTarget)
              check(
                !diagnostic.error &&
                  nativePrograms.length === 2 &&
                  originalPrograms.length === 2 &&
                  [...nativePrograms, ...originalPrograms].every(
                    (program) =>
                      !program.error &&
                      program.preExistingGlError === 0 &&
                      program.diagnosticGlErrors?.length === 0 &&
                      program.state?.currentProgram &&
                      program.state.linked &&
                      program.state.shaders.length === 2 &&
                      program.state.shaders.every(
                        (shader) => shader.sourceLength > 0 && !shader.truncated,
                      ),
                  ) &&
                  [diagnostic.originalMips, diagnostic.nativeMips].every(
                    (m) =>
                      m &&
                      !m.error &&
                      m.preExistingGlError === 0 &&
                      m.restoredGlError === 0 &&
                      (m.additionalRestoredErrors ?? []).length === 0 &&
                      m.rows.length === 10 &&
                      m.rows.every(
                        (level) =>
                          level.status === gl.FRAMEBUFFER_COMPLETE &&
                          level.glError === 0 &&
                          level.additionalDiagnosticErrors?.length === 0 &&
                          !!level.hash,
                      ),
                  ),
                'A09 read-only diagnostic incomplete',
              );
            check(
              draws.length >= 4 &&
                draws.every(
                  (x) =>
                    x.currentProgram &&
                    x.frontFace === gl.CCW &&
                    x.depthTest &&
                    x.depthWrite &&
                    x.depthFunc === gl.LEQUAL &&
                    (x.kind === 'print'
                      ? x.culling &&
                        x.cullMode === gl.BACK &&
                        x.offset &&
                        x.factor === -1 &&
                        x.units === -1
                      : !x.culling),
                ),
              'A09 actual front-side/atlas two-sided/depth/polygon offset draw mismatch',
            );
          }
        }
      removeObservers();
      removeReferenceDiagnostics();
      await threeGpu.prepare('A09 original reference cleanup', deadline, async () => disposeKit());
      // Restore all selected parts before checking ownership; no hidden LOD copies.
      d.parts.forEach((p) => p.mesh.setEnabled(true));
      check(
        owner.diagnostics().activeParts === 6,
        'A09 selected ownership not restored after views',
      );
      if (loseContext && cycle === 1) {
        const ext = await lease('A09 actual context-loss extension', async () =>
          gl.getExtension('WEBGL_lose_context'),
        );
        check(ext, 'A09 loss extension');
        const lost = new Promise<void>((resolve, reject) => {
          h.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
          h.abort.signal.addEventListener(
            'abort',
            () =>
              queueMicrotask(() =>
                h.gpu.diagnostics().lost ? resolve() : reject(h.abort.signal.reason),
              ),
            { once: true },
          );
        });
        ext!.loseContext();
        await lost;
        disposeOwner();
        loss = h.gpu.diagnostics();
      } else
        await lease('A09 repeated owner disposal', async () => {
          disposeOwner();
          owner.dispose();
        });
      const deletion = h.gpu.diagnostics().lost
        ? null
        : await lease('A09 native resource deletion', async () => ({
            textures: handles.every((t) => !gl.isTexture(t)),
            buffers: buffers.every((b) => !gl.isBuffer(b)),
          }));
      const objects = [
        ...h.scene.meshes,
        ...h.scene.materials,
        ...h.scene.textures,
        ...h.scene.geometries,
        ...h.scene.transformNodes,
        ...h.scene.lights,
      ];
      const canvasRetainedHashes = await Promise.all(
        d.labels.map((l) =>
          hash(new Uint8Array(l.sourceCanvas.getContext('2d')!.getImageData(0, 0, 256, 256).data)),
        ),
      );
      const row = {
        cycle,
        disposed: d.parts.every((p) => p.mesh.isDisposed() && p.geometry.isDisposed()),
        nativeDeletion: deletion,
        canvasBorrowedIntact: d.labels.every(
          (l, i) =>
            l.sourceCanvas.width === 256 &&
            l.sourceCanvas.height === 256 &&
            canvasRetainedHashes[i] === canvasHashes[i],
        ),
        restored: resources(),
        identityRestored:
          objects.length === baselineObjects.length &&
          objects.every((x, i) => x === baselineObjects[i]),
      };
      rows.push(row);
      check(
        row.disposed &&
          row.canvasBorrowedIntact &&
          row.identityRestored &&
          JSON.stringify(resources()) === JSON.stringify(baseline) &&
          (deletion === null || (deletion.textures && deletion.buffers)),
        'A09 disposal leaked resources/borrowed canvas/baseline',
      );
    }
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    const errors = cleanupPresentation(cleanups.reverse());
    if (errors.length && failure === null) failure = String(errors[0]);
  }
  return {
    transport,
    forceStandalone,
    rows,
    receipts,
    images,
    failure,
    loss,
    factorLimits: FACTOR_LIMITS,
    scope:
      'Original first clean 150/100/50 A09 triplet only: same source canvases, exact GLB/geometry, native texture sampling and normal factors. No final PBR/weather/shadow/LOD-selection/sector-board parity.',
  };
}
export async function babylonBrakingTriplet(forceStandalone = false, loseContext = false) {
  const deadline = performance.now() + 120000;
  const report = await probe(forceStandalone, loseContext, deadline);
  const restart =
    loseContext && report.failure === null ? await probe(forceStandalone, false, deadline) : null;
  return { ...report, restart };
}
