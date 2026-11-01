import * as T from 'three';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { WebGLPipelineContext } from '@babylonjs/core/Engines/WebGL/webGLPipelineContext.js';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { batchScene, mesh as originalMesh } from '../../src/rendering/geometry.ts';
import { createBabylonStartFinishStripe } from '../../src/engine/babylon/start-finish-stripe.ts';
import { circuitRibbonData } from '../../src/engine/assets/circuit-ribbon-data.ts';
import { apexLineAt } from '../../src/engine/assets/circuit-line-profile.ts';
import { createFormulaSurfaceProbe } from '../../src/engine/babylon/formula-surfaces.ts';
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

/** Fixture-local output only. Reads native stripe albedo without any backing/grounding hook,
 * or actual view-space normal BEFORE lighting. No global shader edit. */
class StripeFactorOutput extends MaterialPluginBase {
  mode = 0;
  constructor(material: PBRMaterial) {
    super(
      material,
      'IsolatedOriginalStripeFactors',
      300,
      { STRIPE_FACTOR_OUTPUT: true },
      true,
      false,
    );
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'stripeProbeMode', size: 1, type: 'float' },
        { name: 'stripeProbeView', size: 16, type: 'mat4' },
      ],
      fragment: 'uniform float stripeProbeMode; uniform mat4 stripeProbeView;',
    };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('stripeProbeMode', this.mode);
    buffer.updateMatrix('stripeProbeView', this._material.getScene().getViewMatrix());
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: 'vec3 stripeProbeAlbedo; vec3 stripeProbeNormal;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS:
            'stripeProbeAlbedo=surfaceAlbedo; stripeProbeNormal=normalize(mat3(stripeProbeView)*normalW);',
          CUSTOM_FRAGMENT_MAIN_END:
            'gl_FragColor=vec4(stripeProbeMode<.5 ? stripeProbeAlbedo : stripeProbeNormal*.5+.5,1.0);',
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
    mean: compared ? sum / (compared * 3) : 0,
    missing,
    excess,
    missingInterior,
    partialAlpha,
  };
}

async function probe(forceStandalone: boolean, loseContext: boolean, deadline: number) {
  const width = 1024,
    height = 384,
    h = createSurfaceProbeHarness(width, height, undefined, forceStandalone);
  h.deadline = deadline;
  const timer = setTimeout(
    () => h.abort.abort(new Error('Stripe case exceeded shared 120s deadline')),
    Math.max(0, deadline - performance.now()),
  );
  const track = new Track(),
    station = track.at(0, trackPoint()),
    root = new T.Group();
  root.position.set(station.x, station.y, station.z);
  root.rotation.y = Math.atan2(station.tx, station.tz);
  root.updateMatrixWorld(true);
  const world = (x: number, y: number, z: number) => {
    const p = new T.Vector3(x, y, z).applyMatrix4(root.matrixWorld);
    return new Vector3(p.x, p.y, p.z);
  };
  // Immutable circuit.ts grid() construction followed by its ACTUAL CPU batcher.
  // The production owner uses the same original canvas; geometry is independently
  // reconstructed from pinned original source, not from native mesh buffers.
  const sourceParent = new T.Group(),
    sourceMaterial = new T.MeshStandardMaterial({ roughness: 0.8 });
  const originalPlane = originalMesh(
    sourceParent,
    new T.PlaneGeometry(station.width * 2, 1.2),
    sourceMaterial,
  );
  originalPlane.position.set(station.x, station.y + 0.015, station.z);
  originalPlane.rotation.set(-Math.PI / 2, 0, -Math.atan2(station.tx, station.tz));
  batchScene(sourceParent, new Set());
  const originalBatch = sourceParent.children.find(
    (child) => child instanceof T.Mesh,
  ) as T.Mesh<T.BufferGeometry>;
  const originalGeometry = originalBatch.geometry,
    originalWorld = originalBatch.matrixWorld.clone();
  sourceMaterial.dispose();
  const camera = new UniversalCamera('original stripe inspection', world(0, 12, -0.01), h.scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 200;
  const sky = new HemisphericLight(
    'fixed inspection light, not stripe-owned',
    Vector3.Up(),
    h.scene,
  );
  sky.intensity = 1;
  const warm = new PBRMaterial('shared PBR infrastructure', h.scene);
  warm.dispose();
  const resources = () => ({
    ...surfaceProbeResources(h.scene),
    transforms: h.scene.transformNodes.length,
    lights: h.scene.lights.length,
  });
  const baseline = resources(),
    originalLights = [...h.scene.lights];
  const options = (signal = h.abort.signal) => ({
    scene: h.scene,
    track,
    context: {
      presentation: 'circuit',
      vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
    } as const,
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
  const pump = async (pending: Promise<void>) => {
    let done = false,
      error: unknown;
    void pending.then(
      () => {
        done = true;
      },
      (e) => {
        done = true;
        error = e;
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
    if (error) throw error;
    await pending;
  };
  const threeCanvas = document.createElement('canvas');
  document.body.append(threeCanvas);
  const renderer = new T.WebGLRenderer({
    canvas: threeCanvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0, 0);
  const threeGl = renderer.getContext() as WebGL2RenderingContext,
    threeGpu = new BabylonPresentationGpu(threeGl),
    threeSchedule = new PresentationSchedule();
  threeCanvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      threeGpu.contextLost();
      h.abort.abort(new Error('Reference context lost'));
    },
    { signal: h.abort.signal },
  );
  const threeScene = new T.Scene(),
    threeCamera = new T.OrthographicCamera();
  threeCamera.matrixAutoUpdate = false;
  threeCamera.matrixWorldAutoUpdate = false;
  const setCamera = (eye: [number, number, number], extent: number) => {
    camera.position.copyFrom(world(...eye));
    camera.setTarget(world(0, 0.015, 0));
    camera.orthoLeft = -extent;
    camera.orthoRight = extent;
    camera.orthoTop = (extent * height) / width;
    camera.orthoBottom = (-extent * height) / width;
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
    // CPU Raycaster uses near/far in addition to the shared projection matrix.
    // Synchronize metadata only; rendered matrices/camera positions are unchanged.
    threeCamera.near = camera.minZ;
    threeCamera.far = camera.maxZ;
    threeCamera.projectionMatrix.fromArray(camera.getProjectionMatrix().asArray());
    threeCamera.projectionMatrixInverse.copy(threeCamera.projectionMatrix).invert();
    threeCamera.matrixWorldInverse.fromArray(camera.getViewMatrix().asArray());
    threeCamera.matrixWorld.copy(threeCamera.matrixWorldInverse).invert();
  };
  setCamera([0, 12, -0.01], 12);
  let referenceDraws = 0;
  const referenceFrame = async () => {
    const priorDraws = referenceDraws;
    const before = threeGpu.diagnostics().completed;
    while (threeGpu.diagnostics().completed < before + 2) {
      h.abort.signal.throwIfAborted();
      threeGpu.ready();
      if (threeGpu.diagnostics().completed >= before + 2) break;
      threeGpu.frame(threeSchedule, false, threeScene, () => {
        renderer.render(threeScene, threeCamera);
        return true;
      });
      await yieldPreparationTurn(h.abort.signal, deadline);
    }
    let result!: {
      pixels: Uint8Array;
      image: string;
      glError: number;
      frontFace: number;
      completedFrames: number;
      draws: number;
    };
    await threeGpu.prepare('Original same-canvas reference readback', deadline, async () => {
      const pixels = new Uint8Array(width * height * 4);
      threeGl.readPixels(0, 0, width, height, threeGl.RGBA, threeGl.UNSIGNED_BYTE, pixels);
      result = {
        pixels,
        image: threeCanvas.toDataURL('image/png'),
        glError: threeGl.getError(),
        frontFace: threeGl.getParameter(threeGl.FRONT_FACE) as number,
        completedFrames: threeGpu.diagnostics().completed - before,
        draws: referenceDraws - priorDraws,
      };
    });
    return result;
  };
  // Observe allocation calls, not metadata guesses. Hooks forward native calls
  // unchanged and never query GL. Binding identity is tracked from actual calls.
  const gl = h.gl,
    nativeBind = gl.bindTexture,
    nativeImage = gl.texImage2D,
    nativeMip = gl.generateMipmap;
  let bound: WebGLTexture | null = null;
  const allocations: {
      texture: WebGLTexture | null;
      internalFormat: number;
      width: number;
      height: number;
      format: number;
      type: number;
      bytes: Uint8Array;
    }[] = [],
    mipCalls: WebGLTexture[] = [];
  gl.bindTexture = function (target, texture) {
    if (target === gl.TEXTURE_2D) bound = texture;
    return nativeBind.call(this, target, texture);
  };
  gl.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
    if (args.length >= 9 && args[3] === 128 && args[4] === 32 && ArrayBuffer.isView(args[8])) {
      const bytes = args[8] as ArrayBufferView;
      allocations.push({
        texture: bound,
        internalFormat: args[2] as number,
        width: 128,
        height: 32,
        format: args[6] as number,
        type: args[7] as number,
        bytes: new Uint8Array(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
      });
    }
    return Reflect.apply(nativeImage, this, args);
  } as typeof gl.texImage2D;
  gl.generateMipmap = function (target) {
    if (target === gl.TEXTURE_2D && bound) mipCalls.push(bound);
    return nativeMip.call(this, target);
  };
  let owner: Awaited<ReturnType<typeof createBabylonStartFinishStripe>> | undefined,
    road: ReturnType<typeof createFormulaSurfaceProbe> | undefined;
  let referenceMaterial: T.MeshStandardMaterial | undefined,
    referenceMap: T.CanvasTexture | undefined;
  const depthReferenceCleanup: (() => void)[] = [];
  const receipts: object[] = [],
    rows: object[] = [],
    images: { name: string; image: string }[] = [];
  let failure: string | null = null,
    loss: object | null = null;
  try {
    const cancel = new AbortController();
    let cancelled = false;
    try {
      await createBabylonStartFinishStripe(
        options(AbortSignal.any([h.abort.signal, cancel.signal])),
        {
          prepare: async (...args) => {
            await prepareOriginalMaterials(...args);
            cancel.abort();
          },
        },
      );
    } catch (e) {
      if (!(e instanceof DOMException) || e.name !== 'AbortError') throw e;
      cancelled = true;
    }
    const cancelledTextureDeleted = await lease(
      'Cancelled native stripe texture disposal witness',
      async () =>
        allocations.length === 1 &&
        allocations.every((a) => a.texture !== null && !gl.isTexture(a.texture)),
    );
    receipts.push({
      phase: 'cancelled',
      cancelled,
      cancelledTextureDeleted,
      resources: resources(),
    });
    check(
      cancelled &&
        cancelledTextureDeleted &&
        JSON.stringify(resources()) === JSON.stringify(baseline),
      'Cancelled stripe resources leaked',
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle === 1) {
        road = await lease('Original road subset creation', async () =>
          createFormulaSurfaceProbe(
            h.scene,
            track,
            { discipline: 'formula', presentation: 'circuit', circuitId: 'aurel' },
            { start: -8, end: 8 },
          ),
        );
        await prepareOriginalMaterials(
          { scene: h.scene, meshes: road.meshes },
          h.gpu,
          h.abort.signal,
          deadline,
          () => {},
        );
      }
      const coVisibility = h.scene.meshes.map((mesh) => ({ mesh, enabled: mesh.isEnabled() }));
      const cycleBaseline = resources(),
        coObjects = [
          ...h.scene.meshes,
          ...h.scene.materials,
          ...h.scene.geometries,
          ...h.scene.textures,
        ];
      const coGeometry = h.scene.meshes.map((mesh) => {
        if (!(mesh instanceof Mesh))
          throw new Error('Unexpected non-Mesh co-present original asset');
        return {
          mesh,
          indices: Array.from(mesh.getIndices() ?? []),
          vertices: mesh
            .getVerticesDataKinds()
            .map((kind) => ({ kind, values: Array.from(mesh.getVerticesData(kind)!) })),
          world: Array.from(mesh.computeWorldMatrix(true).asArray()),
        };
      });
      owner = await createBabylonStartFinishStripe(options());
      const d = owner.diagnostics(),
        canvas = d.sourceCanvas!;
      const nativeTextureHandle = d.texture.getInternalTexture()!._hardwareTexture!
        .underlyingResource as WebGLTexture;
      const source = canvas.getContext('2d')!.getImageData(0, 0, 128, 32).data,
        expected = new Uint8Array(source.length);
      for (let y = 0; y < 32; y++)
        expected.set(source.subarray(y * 128 * 4, (y + 1) * 128 * 4), (31 - y) * 128 * 4);
      const sourceHash = await hash(new Uint8Array(source));
      const geometry = {
        position: equal(
          d.mesh.getVerticesData('position')!,
          originalGeometry.attributes.position.array,
        ),
        normal: equal(d.mesh.getVerticesData('normal')!, originalGeometry.attributes.normal.array),
        uv: equal(d.mesh.getVerticesData('uv')!, originalGeometry.attributes.uv.array),
        indices: equal(d.mesh.getIndices()!, originalGeometry.index!.array),
        world: equal(d.mesh.getWorldMatrix().asArray(), new Float32Array(originalWorld.elements)),
        elevation: Array.from(d.mesh.getVerticesData('position')!).every(
          (v, i) => i % 3 !== 1 || v === Math.fround(station.y + 0.015),
        ),
        material:
          d.material.roughness === 0.8 &&
          d.material.metallic === 0 &&
          equal(d.material.albedoColor.asArray(), [1, 1, 1]) &&
          d.material.backFaceCulling &&
          !d.material.twoSidedLighting &&
          d.material.zOffset === 0 &&
          d.material.zOffsetUnits === 0,
      };
      receipts.push({ cycle, phase: 'staged', geometry, resources: resources(), sourceHash });
      check(
        Object.values(geometry).every(Boolean) &&
          JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Original stripe geometry/world or off-scene staging mismatch',
      );
      await pump(owner.install());
      for (const side of ['overhead', 'oblique'] as const) {
        setCamera(side === 'overhead' ? [0, 12, -0.01] : [8, 5, -8], 12);
        await h.presented();
        if (cycle === 0)
          images.push({
            name: `native-pbr-${side}`,
            image: await lease('Native original stripe screenshot', async () => h.capture().image),
          });
      }
      const pixels = await lease(
        'Original stripe actual allocation, bytes and sampler state',
        async () => {
          const internal = d.texture.getInternalTexture()!,
            hardware = internal._hardwareTexture!.underlyingResource as WebGLTexture;
          const record = allocations.find((a) => a.texture === hardware);
          const receipt: {
            allocation: object | null;
            mipmapCalls: number;
            rowOrientation: string;
            gpuHash?: string;
            exactPixels?: boolean;
            min?: number;
            mag?: number;
            wrapS?: number;
            wrapT?: number;
            anisotropy?: number;
            maximumAnisotropy?: number;
            glError?: number;
          } = {
            allocation: record
              ? {
                  internalFormat: record.internalFormat,
                  width: record.width,
                  height: record.height,
                  format: record.format,
                  type: record.type,
                  bytes: record.bytes.length,
                }
              : null,
            mipmapCalls: mipCalls.filter((t) => t === hardware).length,
            rowOrientation:
              'GPU row zero equals original canvas bottom row; explicit CPU reverse, upload invertY=false',
          };
          receipts.push({ cycle, phase: 'native-texture', receipt });
          check(
            record &&
              record.internalFormat === gl.SRGB8_ALPHA8 &&
              record.format === gl.RGBA &&
              record.type === gl.UNSIGNED_BYTE &&
              equal(record.bytes, expected),
            'Native stripe sRGB allocation/byte witness missing',
          );
          const data = await d.texture.readPixels();
          check(data, 'Native stripe GPU pixels unavailable');
          const bytes = new Uint8Array(data!.buffer, data!.byteOffset, data!.byteLength);
          receipt.gpuHash = await hash(new Uint8Array(bytes));
          receipt.exactPixels = equal(bytes, expected);
          const prior = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
          try {
            gl.bindTexture(gl.TEXTURE_2D, hardware);
            receipt.min = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
            receipt.mag = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER);
            receipt.wrapS = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S);
            receipt.wrapT = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T);
            const ext = gl.getExtension('EXT_texture_filter_anisotropic');
            check(ext, 'Original anisotropic sampler extension missing');
            receipt.anisotropy = gl.getTexParameter(gl.TEXTURE_2D, ext!.TEXTURE_MAX_ANISOTROPY_EXT);
            receipt.maximumAnisotropy = gl.getParameter(ext!.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
          } finally {
            gl.bindTexture(gl.TEXTURE_2D, prior);
          }
          receipt.glError = gl.getError();
          check(
            receipt.exactPixels &&
              receipt.mipmapCalls > 0 &&
              receipt.min === gl.LINEAR_MIPMAP_LINEAR &&
              receipt.mag === gl.LINEAR &&
              receipt.wrapS === gl.CLAMP_TO_EDGE &&
              receipt.wrapT === gl.CLAMP_TO_EDGE &&
              receipt.anisotropy === Math.min(8, receipt.maximumAnisotropy!) &&
              receipt.glError === 0,
            'Native original stripe byte/sampler contract mismatch',
          );
          return receipt;
        },
      );
      // Co-present owners were actually presented above. Isolate ONLY the
      // diagnostic factor comparison; restore every original enabled state below.
      coVisibility.forEach(({ mesh }) => mesh.setEnabled(false));
      // Borrow exactly the same original canvas. No new artwork generation.
      referenceMap = new T.CanvasTexture(canvas);
      referenceMap.colorSpace = T.SRGBColorSpace;
      referenceMap.anisotropy = 8;
      receipts.push({
        cycle,
        phase: 'same-canvas-reference',
        sameCanvas: referenceMap.image === canvas,
        flipY: referenceMap.flipY,
        colorSpace: referenceMap.colorSpace,
        generateMipmaps: referenceMap.generateMipmaps,
      });
      check(
        referenceMap.image === canvas &&
          referenceMap.flipY &&
          referenceMap.colorSpace === T.SRGBColorSpace,
        'Reference must borrow the same original canvas with original upload orientation',
      );
      referenceMaterial = new T.MeshStandardMaterial({ map: referenceMap, roughness: 0.8 });
      const referenceMode = { value: 0 },
        previous = referenceMaterial.onBeforeCompile,
        key = referenceMaterial.customProgramCacheKey();
      referenceMaterial.onBeforeCompile = (shader, referenceRenderer) => {
        previous.call(referenceMaterial!, shader, referenceRenderer);
        shader.uniforms.stripeReferenceMode = referenceMode;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float stripeReferenceMode;')
          .replace(
            '#include <dithering_fragment>',
            '#include <dithering_fragment>\ngl_FragColor=vec4(stripeReferenceMode<.5 ? diffuseColor.rgb : normal*.5+.5,1.0);',
          );
      };
      referenceMaterial.customProgramCacheKey = () => key + ':isolated-stripe-factors';
      const reference = new T.Mesh(originalGeometry, referenceMaterial);
      reference.onAfterRender = () => {
        referenceDraws++;
      };
      reference.matrixAutoUpdate = false;
      reference.matrix.copy(originalWorld);
      threeScene.add(reference);
      // Pinned plugin manager can rebuild an already-used material UBO.
      const plugin = await lease(
        'Install isolated stripe factor output',
        async () => new StripeFactorOutput(d.material),
      );
      await prepareOriginalMaterials(
        { scene: h.scene, meshes: [d.mesh] },
        h.gpu,
        h.abort.signal,
        deadline,
        () => {},
      );
      await threeGpu.prepare(
        'Original same-canvas factor reference compile',
        deadline,
        async () => {
          await renderer.compileAsync(threeScene, threeCamera);
        },
      );
      await referenceFrame();
      await threeGpu.prepare('Actual original reference sampler state', deadline, async () => {
        const hardware = (
          renderer.properties.get(referenceMap!) as { __webglTexture?: WebGLTexture }
        ).__webglTexture;
        const previous = threeGl.getParameter(threeGl.TEXTURE_BINDING_2D) as WebGLTexture | null;
        check(hardware, 'Original Three canvas texture has no native allocation');
        const state: Record<string, number> = {};
        receipts.push({ cycle, phase: 'three-native-sampler', state });
        try {
          threeGl.bindTexture(threeGl.TEXTURE_2D, hardware!);
          state.min = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_MIN_FILTER);
          state.mag = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_MAG_FILTER);
          state.wrapS = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_WRAP_S);
          state.wrapT = threeGl.getTexParameter(threeGl.TEXTURE_2D, threeGl.TEXTURE_WRAP_T);
          const ext = threeGl.getExtension('EXT_texture_filter_anisotropic');
          check(ext, 'Original reference anisotropy extension missing');
          state.anisotropy = threeGl.getTexParameter(
            threeGl.TEXTURE_2D,
            ext!.TEXTURE_MAX_ANISOTROPY_EXT,
          );
          state.maximum = threeGl.getParameter(ext!.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        } finally {
          threeGl.bindTexture(threeGl.TEXTURE_2D, previous);
        }
        check(
          state.min === threeGl.LINEAR_MIPMAP_LINEAR &&
            state.mag === threeGl.LINEAR &&
            state.wrapS === threeGl.CLAMP_TO_EDGE &&
            state.wrapT === threeGl.CLAMP_TO_EDGE &&
            state.anisotropy === Math.min(8, state.maximum),
          'Actual original reference sampler differs',
        );
      });
      const cases = [
        { name: 'overhead', eye: [0, 12, -0.01], extent: 12 },
        { name: 'minified', eye: [0, 12, -0.01], extent: 40 },
        { name: 'oblique', eye: [8, 5, -8], extent: 12 },
        { name: 'underside', eye: [0, -12, -0.01], extent: 12 },
      ] as const;
      for (const view of cases) {
        setCamera([...view.eye], view.extent);
        for (const mode of [0, 1]) {
          plugin.mode = mode;
          referenceMode.value = mode;

          const row: {
            cycle: number;
            view: string;
            stage: string;
            metrics?: ReturnType<typeof metrics>;
            referenceRepeat?: ReturnType<typeof metrics>;
            referenceExact?: boolean;
            referenceGlErrors?: number[];
            glError?: number;
            frontFace?: number;
            referenceFrontFace?: number;
            referenceFrames?: number[];
            referenceDraws?: number[];
            completedFrames?: number;
            draw?: {
              frontFace: number;
              culling: boolean;
              cullMode: number;
              depthTest: boolean;
              depthWrite: boolean;
              depthFunc: number;
            };
            coverage?: { native: number; reference: number };
            programs?: object[];
          } = { cycle, view: view.name, stage: mode === 0 ? 'linear-albedo' : 'view-normal' };
          receipts.push(row);
          const first = await referenceFrame(),
            repeated = await referenceFrame();
          row.referenceRepeat = metrics(repeated.pixels, first.pixels, width, height);
          row.referenceExact = equal(repeated.pixels, first.pixels);
          row.referenceGlErrors = [first.glError, repeated.glError];
          row.referenceFrontFace = first.frontFace;
          row.referenceFrames = [first.completedFrames, repeated.completedFrames];
          row.referenceDraws = [first.draws, repeated.draws];
          check(
            row.referenceExact &&
              first.glError === 0 &&
              repeated.glError === 0 &&
              row.referenceFrames.every((n) => n >= 2) &&
              row.referenceDraws.every((n) => n >= 2),
            'Same-canvas reference did not repeat exactly',
          );
          let ownedDraw = false;
          const completed = h.gpu.diagnostics().completed;
          const observer = d.mesh.onAfterRenderObservable.add(() => {
            check(ownedDraw, 'Stripe culling callback outside owned frame');
            row.draw = {
              frontFace: gl.getParameter(gl.FRONT_FACE) as number,
              culling: gl.isEnabled(gl.CULL_FACE),
              cullMode: gl.getParameter(gl.CULL_FACE_MODE) as number,
              depthTest: gl.isEnabled(gl.DEPTH_TEST),
              depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
              depthFunc: gl.getParameter(gl.DEPTH_FUNC) as number,
            };
          });
          try {
            await h.presented(() => {
              ownedDraw = true;
              try {
                h.scene.render();
              } finally {
                ownedDraw = false;
              }
            });
          } finally {
            d.mesh.onAfterRenderObservable.remove(observer);
          }
          row.completedFrames = h.gpu.diagnostics().completed - completed;
          const actual = await lease(
            'Original stripe factor capture and program receipt',
            async () => {
              row.programs = [d.mesh].map((mesh) => {
                const effect = mesh.subMeshes[0]?.effect,
                  program = (effect?.getPipelineContext() as WebGLPipelineContext | null)?.program;
                return {
                  name: mesh.name,
                  linked:
                    !!program &&
                    gl.isProgram(program) &&
                    !!gl.getProgramParameter(program, gl.LINK_STATUS),
                  defines: effect?.defines,
                  error: effect?.getCompilationError(),
                  ubo: d.material._uniformBuffer.useUbo,
                };
              });
              row.glError = gl.getError();
              row.frontFace = gl.getParameter(gl.FRONT_FACE) as number;
              return h.capture();
            },
          );
          row.metrics = metrics(actual.pixels, first.pixels, width, height);
          const covered = (bytes: Uint8Array) =>
            bytes.reduce((n, v, i) => n + (i % 4 === 3 && v !== 0 ? 1 : 0), 0);
          row.coverage = { native: covered(actual.pixels), reference: covered(first.pixels) };
          check(
            row.completedFrames >= 2 &&
              row.draw?.frontFace === gl.CCW &&
              row.draw.culling &&
              row.draw.cullMode === gl.BACK &&
              row.draw.depthTest &&
              row.draw.depthWrite &&
              row.draw.depthFunc === gl.LEQUAL,
            'Stripe lacks completed CCW/back-culling/depth-tested draw',
          );

          if (cycle === 0) {
            images.push(
              { name: `${view.name}-${row.stage}-babylon`, image: actual.image },
              { name: `${view.name}-${row.stage}-three`, image: first.image },
            );
          }
          const minimum = view.name === 'minified' ? 500 : 1000;
          check(
            (view.name === 'underside'
              ? row.coverage.native === 0 &&
                row.coverage.reference === 0 &&
                equal(actual.pixels, first.pixels)
              : row.metrics.compared >= minimum &&
                row.metrics.missingInterior === 0 &&
                row.metrics.partialAlpha === 0 &&
                row.metrics.missing + row.metrics.excess <= FACTOR_LIMITS.coverageMismatchPixels &&
                row.metrics.max <= FACTOR_LIMITS.max &&
                row.metrics.mean <= FACTOR_LIMITS.mean) &&
              row.glError === 0 &&
              first.glError === 0,
            `Original same-canvas ${view.name}/${row.stage} factor mismatch`,
          );
          if (road && view.name === 'overhead' && mode === 0) {
            const depth = {
              cycle,
              phase: 'original-road-depth',
              roadParts: road.roadMeshes.length,
              stage:
                'Original Three road depth with diagnostic magenta output; native road shading is compared only to its own road-only witness',
              samples: [] as object[],
              visiblePixels: 0,
              occludedPixels: 0,
              // Frozen source-only CPU ray oracle, not observed native colors.
              expectedSourceClassification: { visible: 54, occluded: 27, total: 81 },
              minimumTriangleGap: Number.POSITIVE_INFINITY,
              max: 0,
              maxVisible: 0,
              maxOccluded: 0,
              meanVisible: 0,
              meanOccluded: 0,
              compositeCoverage: { missing: 0, excess: 0, partialAlpha: 0 },
              glError: -1,
              referenceRepeat: false,
              roadOnlyRepeat: false,
              referenceErrors: [] as number[],
              referenceRoadDraws: [] as number[],
            };
            receipts.push(depth);
            // Independently allocate Three geometry from the shared neutral
            // ORIGINAL circuitRibbonData producer, not candidate native buffers.
            // This is not an independent ribbon algorithm: the frozen original
            // ribbon geometry oracles establish producer equivalence. Preserve
            // range/columns/step; diagnostic color isolates depth, not PBR parity.
            const point = trackPoint();
            const data = circuitRibbonData(
              track,
              {
                start: -8,
                end: 8,
                columns: 14,
                road: true,
                step: 1.8,
                offset: (s, t) => (t * 2 - 1) * track.at(s, point).width,
              },
              {
                hasGpDesign: () => false,
                apex: (s, l, out, motorcycle) => apexLineAt(track, s, l, out, motorcycle),
                color: () => ({ r: 0, g: 0, b: 0 }),
                kerbStyle: () => {
                  throw new Error('Unexpected reference kerb request');
                },
                runoffStyle: () => {
                  throw new Error('Unexpected reference runoff request');
                },
                usage: () => {
                  throw new Error('Unexpected reference usage request');
                },
                gpPaint: () => {
                  throw new Error('Unexpected reference paint request');
                },
                gpGravel: () => {
                  throw new Error('Unexpected reference gravel request');
                },
              },
            );
            const roadGeometry = new T.BufferGeometry();
            let geometryReleaseAttempted = false;
            const disposeRoadGeometry = () => {
              if (geometryReleaseAttempted) return;
              geometryReleaseAttempted = true;
              roadGeometry.dispose();
            };
            depthReferenceCleanup.push(disposeRoadGeometry);
            roadGeometry.setAttribute(
              'position',
              new T.BufferAttribute(new Float32Array(data.vertices), 3),
            );
            roadGeometry.setIndex(data.indices);
            const roadMaterial = new T.MeshBasicMaterial({ color: 0xff00ff, toneMapped: false });
            let materialReleaseAttempted = false;
            const disposeRoadMaterial = () => {
              if (materialReleaseAttempted) return;
              materialReleaseAttempted = true;
              roadMaterial.dispose();
            };
            depthReferenceCleanup.push(disposeRoadMaterial);
            const referenceRoad = new T.Mesh(roadGeometry, roadMaterial);
            let roadDraws = 0;
            referenceRoad.onAfterRender = () => {
              roadDraws++;
            };
            threeScene.add(referenceRoad);
            let depthFailed = false,
              depthFailure: unknown;
            try {
              await threeGpu.prepare(
                'Original Three composite depth reference compile',
                deadline,
                async () => {
                  await renderer.compileAsync(threeScene, threeCamera);
                },
              );
              let priorRoadDraws = roadDraws;
              const composite = await referenceFrame(),
                compositeRepeat = await referenceFrame();
              depth.referenceRoadDraws.push(roadDraws - priorRoadDraws);
              depth.referenceRepeat = equal(composite.pixels, compositeRepeat.pixels);
              reference.visible = false;
              priorRoadDraws = roadDraws;
              const referenceRoadOnly = await referenceFrame(),
                referenceRoadRepeat = await referenceFrame();
              depth.referenceRoadDraws.push(roadDraws - priorRoadDraws);
              reference.visible = true;
              depth.roadOnlyRepeat = equal(referenceRoadOnly.pixels, referenceRoadRepeat.pixels);
              depth.referenceErrors = [
                composite.glError,
                compositeRepeat.glError,
                referenceRoadOnly.glError,
                referenceRoadRepeat.glError,
              ];
              images.push(
                { name: 'original-three-road-depth', image: composite.image },
                { name: 'original-three-road-only', image: referenceRoadOnly.image },
              );
              check(
                depth.referenceRepeat &&
                  depth.roadOnlyRepeat &&
                  depth.referenceErrors.every((n) => n === 0) &&
                  depth.referenceRoadDraws.every((n) => n >= 4) &&
                  composite.draws >= 2 &&
                  compositeRepeat.draws >= 2,
                'Original Three composite/road-only reference did not repeat after actual draws',
              );
              let withRoad: ReturnType<typeof h.capture>, roadOnly: ReturnType<typeof h.capture>;
              try {
                coVisibility.forEach(({ mesh, enabled }) => mesh.setEnabled(enabled));
                await h.presented();
                withRoad = await lease('Original road and stripe depth capture', async () =>
                  h.capture(),
                );
                d.mesh.setEnabled(false);
                await h.presented();
                roadOnly = await lease('Actual original road-only coverage witness', async () =>
                  h.capture(),
                );
              } finally {
                d.mesh.setEnabled(true);
                coVisibility.forEach(({ mesh }) => mesh.setEnabled(false));
              }
              images.push(
                { name: 'original-road-depth', image: withRoad.image },
                { name: 'original-road-only', image: roadOnly.image },
              );
              // Marker changes RGB only. Full composite alpha coverage remains
              // comparable against the original independently generated road.
              for (let i = 3; i < composite.pixels.length; i += 4) {
                const expected = composite.pixels[i],
                  actual = withRoad.pixels[i];
                depth.compositeCoverage.missing += expected === 255 && actual !== 255 ? 1 : 0;
                depth.compositeCoverage.excess += actual === 255 && expected === 0 ? 1 : 0;
                depth.compositeCoverage.partialAlpha +=
                  (expected !== 0 && expected !== 255) || (actual !== 0 && actual !== 255) ? 1 : 0;
              }
              check(
                depth.compositeCoverage.missing + depth.compositeCoverage.excess <=
                  FACTOR_LIMITS.coverageMismatchPixels &&
                  depth.compositeCoverage.partialAlpha === 0,
                'Original road/stripe composite alpha coverage differs',
              );
              let visibleErrorSum = 0,
                occludedErrorSum = 0;
              const ray = new T.Raycaster();
              // The SAME nine 3x3 patches: classification comes from ORIGINAL
              // composite visibility and independent CPU triangle intersections,
              // never from observed native errors or a changed/masked coordinate.
              for (const x of [-station.width + 1, 0, station.width - 1])
                for (const z of [-0.3, 0, 0.3]) {
                  const projected = Vector3.Project(
                    Vector3.FromArray(
                      new T.Vector3(x, z, 0).applyMatrix4(originalPlane.matrixWorld).toArray(),
                    ),
                    Matrix.Identity(),
                    h.scene.getTransformMatrix(),
                    camera.viewport.toGlobal(width, height),
                  );
                  const px = Math.round(projected.x),
                    py = height - 1 - Math.round(projected.y);
                  const sample = { x, z, pixels: [] as object[], max: 0, visible: 0, occluded: 0 };
                  depth.samples.push(sample);
                  for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                      const sx = px + dx,
                        sy = py + dy,
                        i = (sy * width + sx) * 4;
                      // readPixels row zero is bottom; +.5 samples the SAME
                      // framebuffer pixel center in normalized device coordinates.
                      ray.setFromCamera(
                        new T.Vector2(((sx + 0.5) / width) * 2 - 1, ((sy + 0.5) / height) * 2 - 1),
                        threeCamera,
                      );
                      const stripeHit = ray.intersectObject(reference, false)[0],
                        roadHit = ray.intersectObject(referenceRoad, false)[0];
                      const opaque = [
                        first,
                        composite,
                        referenceRoadOnly,
                        withRoad,
                        roadOnly,
                      ].every((c) => c.pixels[i + 3] === 255);
                      const gap =
                        stripeHit && roadHit ? roadHit.distance - stripeHit.distance : null;
                      const expectedVisible = gap !== null && gap > 0;
                      if (gap !== null)
                        depth.minimumTriangleGap = Math.min(
                          depth.minimumTriangleGap,
                          Math.abs(gap),
                        );
                      let originalRoadError = 0,
                        originalStripeError = 0,
                        nativeRoadError = 0,
                        nativeStripeError = 0,
                        distinct = 0;
                      for (let c = 0; c < 3; c++) {
                        originalRoadError = Math.max(
                          originalRoadError,
                          Math.abs(composite.pixels[i + c] - referenceRoadOnly.pixels[i + c]),
                        );
                        originalStripeError = Math.max(
                          originalStripeError,
                          Math.abs(composite.pixels[i + c] - first.pixels[i + c]),
                        );
                        nativeRoadError = Math.max(
                          nativeRoadError,
                          Math.abs(withRoad.pixels[i + c] - roadOnly.pixels[i + c]),
                        );
                        nativeStripeError = Math.max(
                          nativeStripeError,
                          Math.abs(withRoad.pixels[i + c] - first.pixels[i + c]),
                        );
                        distinct = Math.max(
                          distinct,
                          Math.abs(roadOnly.pixels[i + c] - first.pixels[i + c]),
                        );
                      }
                      const nativeError = expectedVisible ? nativeStripeError : nativeRoadError;
                      for (let c = 0; c < 3; c++) {
                        if (expectedVisible)
                          visibleErrorSum += Math.abs(withRoad.pixels[i + c] - first.pixels[i + c]);
                        else
                          occludedErrorSum += Math.abs(
                            withRoad.pixels[i + c] - roadOnly.pixels[i + c],
                          );
                      }
                      sample.pixels.push({
                        sx,
                        sy,
                        opaque,
                        triangleDepthGap: gap,
                        expectedVisible,
                        originalRoadError,
                        originalStripeError,
                        nativeRoadError,
                        nativeStripeError,
                        roadStripeDifference: distinct,
                      });
                      check(
                        opaque &&
                          gap !== null &&
                          Math.abs(gap) > 1e-5 &&
                          distinct > FACTOR_LIMITS.max,
                        'Fixed depth patch lacks distinct opaque road/stripe and unambiguous original triangles',
                      );
                      check(
                        expectedVisible
                          ? originalStripeError <= FACTOR_LIMITS.max &&
                              originalRoadError > FACTOR_LIMITS.max
                          : originalRoadError === 0 && originalStripeError > FACTOR_LIMITS.max,
                        'Original Three composite disagrees with original triangle-depth classification',
                      );
                      check(
                        nativeError <= FACTOR_LIMITS.max &&
                          (expectedVisible ? nativeRoadError : nativeStripeError) >
                            FACTOR_LIMITS.max,
                        'Native original road/stripe visible-or-occluded classification differs',
                      );
                      sample.max = Math.max(sample.max, nativeError);
                      depth.max = Math.max(depth.max, nativeError);
                      if (expectedVisible) {
                        sample.visible++;
                        depth.visiblePixels++;
                        depth.maxVisible = Math.max(depth.maxVisible, nativeError);
                      } else {
                        sample.occluded++;
                        depth.occludedPixels++;
                        depth.maxOccluded = Math.max(depth.maxOccluded, nativeError);
                      }
                    }
                }
              depth.meanVisible = visibleErrorSum / (depth.visiblePixels * 3);
              depth.meanOccluded = occludedErrorSum / (depth.occludedPixels * 3);
              depth.glError = await lease('Original road depth GL status', async () =>
                gl.getError(),
              );
              check(
                depth.visiblePixels === depth.expectedSourceClassification.visible &&
                  depth.occludedPixels === depth.expectedSourceClassification.occluded &&
                  depth.visiblePixels + depth.occludedPixels ===
                    depth.expectedSourceClassification.total &&
                  depth.meanVisible <= FACTOR_LIMITS.mean &&
                  depth.meanOccluded <= FACTOR_LIMITS.mean &&
                  depth.glError === 0,
                'Both original visible and occluded depth cases must be exercised',
              );
            } catch (error) {
              depthFailed = true;
              depthFailure = error;
            } finally {
              reference.visible = true;
              threeScene.remove(referenceRoad);
              try {
                await threeGpu.prepare(
                  'Original Three depth reference cleanup',
                  deadline,
                  async () => {
                    const errors = cleanupPresentation([disposeRoadGeometry, disposeRoadMaterial]);
                    if (errors.length) throw errors[0];
                  },
                );
              } catch (error) {
                if (!depthFailed) {
                  depthFailed = true;
                  depthFailure = error;
                }
              }
            }
            if (depthFailed) throw depthFailure;
          }
          check(
            (
              row.programs as { linked: boolean; defines: string; error: string; ubo: boolean }[]
            ).every(
              (p) =>
                p.linked &&
                !p.error &&
                p.ubo === (h.transport === 'ubo') &&
                !/^#define TWOSIDEDLIGHTING\b/m.test(p.defines) &&
                !/^#define GAMMAALBEDO\b/m.test(p.defines),
            ),
            'Native stripe program/normal/sRGB decode contract differs',
          );
        }
      }
      coVisibility.forEach(({ mesh, enabled }) => mesh.setEnabled(enabled));
      await h.presented();
      threeScene.clear();
      await threeGpu.prepare('Original borrowed-canvas reference cleanup', deadline, async () => {
        referenceMaterial!.dispose();
        referenceMap!.dispose();
      });
      referenceMaterial = undefined;
      referenceMap = undefined;
      if (loseContext && cycle === 1) {
        const ext = await lease('Stripe context-loss extension', async () =>
          gl.getExtension('WEBGL_lose_context'),
        );
        check(ext, 'Context-loss extension missing');
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
        owner.dispose();
        loss = h.gpu.diagnostics();
      } else
        await lease('Original stripe owner disposal', async () => {
          owner!.dispose();
          owner!.dispose();
        });
      const nativeTextureDeleted = h.gpu.diagnostics().lost
        ? null
        : await lease(
            'Disposed native stripe texture witness',
            async () => !gl.isTexture(nativeTextureHandle),
          );
      const after = {
        cycle,
        nativeTextureDeleted,
        pixels,
        disposed: d.mesh.isDisposed(),
        canvasRetained:
          canvas.width === 128 &&
          canvas.height === 32 &&
          (await hash(
            new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, 128, 32).data),
          )) === sourceHash,
        restored: resources(),
      };
      rows.push(after);
      check(
        after.disposed &&
          (nativeTextureDeleted === true || h.gpu.diagnostics().lost) &&
          after.canvasRetained &&
          JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Stripe disposal/canvas borrowing did not restore baseline',
      );
      owner = undefined;
      const now = [
        ...h.scene.meshes,
        ...h.scene.materials,
        ...h.scene.geometries,
        ...h.scene.textures,
      ];
      const coGeometryPreserved = coGeometry.every(
        ({ mesh, indices, vertices, world }) =>
          !mesh.isDisposed() &&
          equal(mesh.getIndices() ?? [], indices) &&
          vertices.every(({ kind, values }) => equal(mesh.getVerticesData(kind)!, values)) &&
          equal(mesh.computeWorldMatrix(true).asArray(), world),
      );
      const coState = {
        roadParts: road?.roadMeshes.length ?? 0,
        geometryPreserved: coGeometryPreserved,
      };
      receipts.push({ cycle, phase: 'co-presence-restored', coState });
      check(
        coGeometryPreserved && (!road || coState.roadParts > 0),
        'Stripe changed co-present geometry/world or active ownership',
      );
      check(
        now.length === coObjects.length &&
          now.every((o, i) => o === coObjects[i]) &&
          originalLights.length === h.scene.lights.length &&
          originalLights.every((l, i) => l === h.scene.lights[i]),
        'Stripe altered independent co-present owners/lights',
      );
      if (road) {
        if (h.gpu.diagnostics().lost) road.dispose();
        else await lease('Independent original road cleanup', async () => road!.dispose());
        road = undefined;
        check(
          JSON.stringify(resources()) === JSON.stringify(baseline),
          'Co-present owners did not restore original baseline',
        );
      }
    }
  } catch (e) {
    failure = e instanceof Error ? (e.stack ?? e.message) : String(e);
  } finally {
    clearTimeout(timer);
    const errors = cleanupPresentation([
      () => owner?.dispose(),
      () => road?.dispose(),
      ...depthReferenceCleanup,
      () => referenceMaterial?.dispose(),
      () => referenceMap?.dispose(),
      () => originalGeometry.dispose(),
      () => {
        gl.bindTexture = nativeBind;
        gl.texImage2D = nativeImage;
        gl.generateMipmap = nativeMip;
      },
      () => threeGpu.dispose(),
      () => renderer.dispose(),
      () => threeCanvas.remove(),
      () => h.dispose(),
    ]);
    if (errors.length) failure ??= String(errors[0]);
  }
  return {
    transport: h.transport,
    forceStandalone,
    baseline,
    factorLimits: FACTOR_LIMITS,
    rows,
    receipts,
    images,
    failure,
    loss,
    scope:
      'Original checker same-canvas upload/sampling, exact post-batch geometry and 15mm elevation, FrontSide factors and original-road co-presence only; car-crossing occlusion and final PBR/weather/shadow parity unqualified',
  };
}
export async function babylonStartFinishStripe(forceStandalone = false, loseContext = false) {
  const deadline = performance.now() + 120000;
  const report = await probe(forceStandalone, loseContext, deadline);
  const restart =
    loseContext && !report.failure ? await probe(forceStandalone, false, deadline) : null;
  return { ...report, restart };
}
