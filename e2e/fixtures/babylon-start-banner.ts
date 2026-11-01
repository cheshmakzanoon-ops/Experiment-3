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
import { unprintedBack } from '../../src/rendering/geometry.ts';
import { createBabylonStartBanner } from '../../src/engine/babylon/start-banner.ts';
import { loadBabylonStartGantry } from '../../src/engine/babylon/start-gantry.ts';
import { createBabylonStartLamps } from '../../src/engine/babylon/start-lamps.ts';
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

/** Fixture-local output only. Reads native albedo AFTER original backing hook,
 * or actual view-space two-sided normal BEFORE lighting. No global shader edit. */
class BannerFactorOutput extends MaterialPluginBase {
  mode = 0;
  constructor(material: PBRMaterial) {
    super(
      material,
      'IsolatedOriginalBannerFactors',
      300,
      { BANNER_FACTOR_OUTPUT: true },
      true,
      false,
    );
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'bannerProbeMode', size: 1, type: 'float' },
        { name: 'bannerProbeView', size: 16, type: 'mat4' },
      ],
      fragment: 'uniform float bannerProbeMode; uniform mat4 bannerProbeView;',
    };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('bannerProbeMode', this.mode);
    buffer.updateMatrix('bannerProbeView', this._material.getScene().getViewMatrix());
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: 'vec3 bannerProbeAlbedo; vec3 bannerProbeNormal;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS:
            'bannerProbeAlbedo=surfaceAlbedo; bannerProbeNormal=normalize(mat3(bannerProbeView)*normalW);',
          CUSTOM_FRAGMENT_MAIN_END:
            'gl_FragColor=vec4(bannerProbeMode<.5 ? bannerProbeAlbedo : bannerProbeNormal*.5+.5,1.0);',
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

async function probe(forceStandalone: boolean, loseContext: boolean, deadline: number) {
  const width = 1024,
    height = 384,
    h = createSurfaceProbeHarness(width, height, undefined, forceStandalone);
  h.deadline = deadline;
  const timer = setTimeout(
    () => h.abort.abort(new Error('Banner case exceeded shared 120s deadline')),
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
  const placement = (x = 0, angle = Math.PI) => {
    const mesh = new T.Object3D();
    mesh.position.set(x, 6, -0.27);
    mesh.rotation.y = angle;
    root.add(mesh);
    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld.clone();
    root.remove(mesh);
    return matrix;
  };
  const originalWorld = placement(),
    originalGeometry = new T.PlaneGeometry(14, 1);
  const camera = new UniversalCamera('original banner inspection', world(0, 6, -12), h.scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 200;
  const sky = new HemisphericLight(
    'fixed inspection light, not banner-owned',
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
    camera.setTarget(world(0, 6, -0.27));
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
  };
  setCamera([0, 6, -12], 8);
  const referenceFrame = async () => {
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
    let result!: { pixels: Uint8Array; image: string; glError: number; frontFace: number };
    await threeGpu.prepare('Original same-canvas reference readback', deadline, async () => {
      const pixels = new Uint8Array(width * height * 4);
      threeGl.readPixels(0, 0, width, height, threeGl.RGBA, threeGl.UNSIGNED_BYTE, pixels);
      result = {
        pixels,
        image: threeCanvas.toDataURL('image/png'),
        glError: threeGl.getError(),
        frontFace: threeGl.getParameter(threeGl.FRONT_FACE) as number,
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
    if (args.length >= 9 && args[3] === 512 && args[4] === 128 && ArrayBuffer.isView(args[8])) {
      const bytes = args[8] as ArrayBufferView;
      allocations.push({
        texture: bound,
        internalFormat: args[2] as number,
        width: 512,
        height: 128,
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
  let owner: Awaited<ReturnType<typeof createBabylonStartBanner>> | undefined,
    structure: Awaited<ReturnType<typeof loadBabylonStartGantry>> | undefined,
    lamps: Awaited<ReturnType<typeof createBabylonStartLamps>> | undefined;
  let referenceMaterial: T.MeshStandardMaterial | undefined,
    referenceMap: T.CanvasTexture | undefined;
  let diagnosticMeshes: import('@babylonjs/core/Meshes/mesh.js').Mesh[] = [];
  const receipts: object[] = [],
    rows: object[] = [],
    images: { name: string; image: string }[] = [];
  let failure: string | null = null,
    loss: object | null = null;
  try {
    const cancel = new AbortController();
    let cancelled = false;
    try {
      await createBabylonStartBanner(options(AbortSignal.any([h.abort.signal, cancel.signal])), {
        prepare: async (...args) => {
          await prepareOriginalMaterials(...args);
          cancel.abort();
        },
      });
    } catch (e) {
      if (!(e instanceof DOMException) || e.name !== 'AbortError') throw e;
      cancelled = true;
    }
    const cancelledTextureDeleted = await lease(
      'Cancelled native banner texture disposal witness',
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
      'Cancelled banner resources leaked',
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle === 1) {
        structure = await loadBabylonStartGantry({ ...options(), base: location.origin + '/' });
        await pump(structure.install());
        lamps = await createBabylonStartLamps(options());
        await pump(lamps.install());
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
      owner = await createBabylonStartBanner(options());
      const d = owner.diagnostics(),
        canvas = d.sourceCanvas!;
      const nativeTextureHandle = d.texture.getInternalTexture()!._hardwareTexture!
        .underlyingResource as WebGLTexture;
      const source = canvas.getContext('2d')!.getImageData(0, 0, 512, 128).data,
        expected = new Uint8Array(source.length);
      for (let y = 0; y < 128; y++)
        expected.set(source.subarray(y * 512 * 4, (y + 1) * 512 * 4), (127 - y) * 512 * 4);
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
      };
      receipts.push({ cycle, phase: 'staged', geometry, resources: resources(), sourceHash });
      check(
        Object.values(geometry).every(Boolean) &&
          JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Original banner geometry/world or off-scene staging mismatch',
      );
      await pump(owner.install());
      for (const side of ['front', 'back'] as const) {
        setCamera(side === 'front' ? [0, 6, -12] : [0, 6, 12], 8);
        await h.presented();
        if (cycle === 0)
          images.push({
            name: `native-pbr-${side}`,
            image: await lease('Native original banner screenshot', async () => h.capture().image),
          });
      }
      const pixels = await lease(
        'Original banner actual allocation, bytes and sampler state',
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
            'Native banner sRGB allocation/byte witness missing',
          );
          const data = await d.texture.readPixels();
          check(data, 'Native banner GPU pixels unavailable');
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
            'Native original banner byte/sampler contract mismatch',
          );
          return receipt;
        },
      );
      // Co-present owners were actually presented above. Isolate ONLY the
      // diagnostic factor comparison; restore every original enabled state below.
      coVisibility.forEach(({ mesh }) => mesh.setEnabled(false));
      // Borrow exactly the same original canvas. No new font/art generation.
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
      referenceMaterial = unprintedBack(
        new T.MeshStandardMaterial({ map: referenceMap, side: T.DoubleSide }),
      );
      const referenceMode = { value: 0 },
        previous = referenceMaterial.onBeforeCompile,
        key = referenceMaterial.customProgramCacheKey();
      referenceMaterial.onBeforeCompile = (shader, referenceRenderer) => {
        previous.call(referenceMaterial!, shader, referenceRenderer);
        shader.uniforms.bannerReferenceMode = referenceMode;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float bannerReferenceMode;')
          .replace(
            '#include <dithering_fragment>',
            '#include <dithering_fragment>\ngl_FragColor=vec4(bannerReferenceMode<.5 ? diffuseColor.rgb : normal*.5+.5,1.0);',
          );
      };
      referenceMaterial.customProgramCacheKey = () => key + ':isolated-banner-factors';
      const reference = new T.Mesh(originalGeometry, referenceMaterial);
      reference.matrixAutoUpdate = false;
      reference.matrix.copy(originalWorld);
      threeScene.add(reference);
      // Pinned plugin manager can rebuild an already-used material UBO.
      const plugin = await lease(
        'Install isolated banner factor output',
        async () => new BannerFactorOutput(d.material),
      );
      await prepareOriginalMaterials(
        { scene: h.scene, meshes: [d.mesh] },
        h.gpu,
        h.abort.signal,
        deadline,
        () => {},
      );
      const pair = await lease(
        'Opposite-facing original shared-material diagnostic pair',
        async () =>
          [-8, 8].map((x, index) => {
            const clone = d.mesh.clone(`banner-pair-${index}`, null, true)!;
            clone.freezeWorldMatrix(
              Matrix.FromArray(placement(x, index === 0 ? Math.PI : 0).elements),
            );
            clone.setEnabled(false);
            return clone;
          }),
      );
      diagnosticMeshes = pair;
      const referencePair = [-8, 8].map((x, index) => {
        const mesh = new T.Mesh(originalGeometry, referenceMaterial!);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(placement(x, index === 0 ? Math.PI : 0));
        mesh.visible = false;
        threeScene.add(mesh);
        return mesh;
      });
      await prepareOriginalMaterials(
        { scene: h.scene, meshes: pair },
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
      const drawOrder: string[] = [];
      pair.forEach((mesh) => mesh.onAfterRenderObservable.add(() => drawOrder.push(mesh.name)));
      h.scene.setRenderingOrder(0, (a, b) => a.getMesh().alphaIndex - b.getMesh().alphaIndex);
      const cases = [
        { name: 'front', eye: [0, 6, -12], extent: 8 },
        { name: 'plain-back', eye: [0, 6, 12], extent: 8 },
        { name: 'magnified', eye: [0, 6, -12], extent: 3 },
        { name: 'minified', eye: [0, 6, -12], extent: 40 },
        { name: 'oblique', eye: [20, 6, -8], extent: 8 },
        { name: 'pair-ab', eye: [0, 6, -12], extent: 16 },
        { name: 'pair-ba', eye: [0, 6, -12], extent: 16 },
      ] as const;
      for (const view of cases) {
        const paired = view.name.startsWith('pair'),
          reverse = view.name === 'pair-ba';
        d.mesh.setEnabled(!paired);
        reference.visible = !paired;
        pair.forEach((m, i) => {
          m.setEnabled(paired);
          m.alphaIndex = reverse ? 1 - i : i;
          referencePair[i].visible = paired;
          referencePair[i].renderOrder = m.alphaIndex;
        });
        setCamera([...view.eye], view.extent);
        for (const mode of [0, 1]) {
          plugin.mode = mode;
          referenceMode.value = mode;
          drawOrder.length = 0;
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
            order?: string[];
            programs?: object[];
          } = { cycle, view: view.name, stage: mode === 0 ? 'linear-albedo' : 'view-normal' };
          receipts.push(row);
          const first = await referenceFrame(),
            repeated = await referenceFrame();
          row.referenceRepeat = metrics(repeated.pixels, first.pixels, width, height);
          row.referenceExact = equal(repeated.pixels, first.pixels);
          row.referenceGlErrors = [first.glError, repeated.glError];
          row.referenceFrontFace = first.frontFace;
          check(
            row.referenceExact && first.glError === 0 && repeated.glError === 0,
            'Same-canvas reference did not repeat exactly',
          );
          await h.presented();
          const actual = await lease(
            'Original banner factor capture and program receipt',
            async () => {
              row.programs = (paired ? pair : [d.mesh]).map((mesh) => {
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
          row.order = drawOrder.slice(-2);
          if (cycle === 0) {
            images.push(
              { name: `${view.name}-${row.stage}-babylon`, image: actual.image },
              { name: `${view.name}-${row.stage}-three`, image: first.image },
            );
          }
          const minimum = view.name === 'minified' ? 500 : 1000;
          check(
            row.metrics.compared >= minimum &&
              row.metrics.missingInterior === 0 &&
              row.metrics.partialAlpha === 0 &&
              row.metrics.missing + row.metrics.excess <= FACTOR_LIMITS.coverageMismatchPixels &&
              row.metrics.max <= FACTOR_LIMITS.max &&
              row.metrics.mean <= FACTOR_LIMITS.mean &&
              row.glError === 0 &&
              first.glError === 0,
            `Original same-canvas ${view.name}/${row.stage} factor mismatch`,
          );
          if (paired)
            check(
              equal(
                row.order!.map((name) => pair.findIndex((m) => m.name === name)),
                reverse ? [1, 0] : [0, 1],
              ),
              'Shared banner draw-order probe did not alternate',
            );
          check(
            (
              row.programs as { linked: boolean; defines: string; error: string; ubo: boolean }[]
            ).every(
              (p) =>
                p.linked &&
                !p.error &&
                p.ubo === (h.transport === 'ubo') &&
                /^#define TWOSIDEDLIGHTING\b/m.test(p.defines) &&
                !/^#define GAMMAALBEDO\b/m.test(p.defines),
            ),
            'Native banner program/normal/sRGB decode contract differs',
          );
        }
      }
      await lease('Banner diagnostic pair cleanup', async () => {
        pair.forEach((m) => m.dispose(true, false));
      });
      diagnosticMeshes = [];
      d.mesh.setEnabled(true);
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
        const ext = await lease('Banner context-loss extension', async () =>
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
        await lease('Original banner owner disposal', async () => {
          owner!.dispose();
          owner!.dispose();
        });
      const nativeTextureDeleted = h.gpu.diagnostics().lost
        ? null
        : await lease(
            'Disposed native banner texture witness',
            async () => !gl.isTexture(nativeTextureHandle),
          );
      const after = {
        cycle,
        nativeTextureDeleted,
        pixels,
        disposed: d.mesh.isDisposed(),
        canvasRetained:
          canvas.width === 512 &&
          canvas.height === 128 &&
          (await hash(
            new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, 512, 128).data),
          )) === sourceHash,
        restored: resources(),
      };
      rows.push(after);
      check(
        after.disposed &&
          (nativeTextureDeleted === true || h.gpu.diagnostics().lost) &&
          after.canvasRetained &&
          JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Banner disposal/canvas borrowing did not restore baseline',
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
        structure: structure?.diagnostics().activeParts ?? 0,
        lamps: lamps?.diagnostics().activeParts ?? 0,
        geometryPreserved: coGeometryPreserved,
      };
      receipts.push({ cycle, phase: 'co-presence-restored', coState });
      check(
        coGeometryPreserved &&
          (!structure || coState.structure === 4) &&
          (!lamps || coState.lamps === 5),
        'Banner changed co-present geometry/world or active ownership',
      );
      check(
        now.length === coObjects.length &&
          now.every((o, i) => o === coObjects[i]) &&
          originalLights.length === h.scene.lights.length &&
          originalLights.every((l, i) => l === h.scene.lights[i]),
        'Banner altered independent co-present owners/lights',
      );
      if (structure || lamps) {
        const clean = () => {
          lamps?.dispose();
          structure?.dispose();
        };
        if (h.gpu.diagnostics().lost) clean();
        else await lease('Independent structure/lamp cleanup', async () => clean());
        lamps = undefined;
        structure = undefined;
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
      () => diagnosticMeshes.forEach((m) => m.dispose(true, false)),
      () => owner?.dispose(),
      () => lamps?.dispose(),
      () => structure?.dispose(),
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
      'Same original per-run canvas, native upload/sampling, exact geometry and shared-material two-sided factor-stage evidence only; no cross-OS font hashes or final PBR/bloom/exposure/shadow parity',
  };
}
export async function babylonStartBanner(forceStandalone = false, loseContext = false) {
  const deadline = performance.now() + 120000;
  const report = await probe(forceStandalone, loseContext, deadline);
  const restart =
    loseContext && !report.failure ? await probe(forceStandalone, false, deadline) : null;
  return { ...report, restart };
}
