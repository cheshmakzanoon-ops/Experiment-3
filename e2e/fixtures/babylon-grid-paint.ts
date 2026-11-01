import * as T from 'three';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { WebGLPipelineContext } from '@babylonjs/core/Engines/WebGL/webGLPipelineContext.js';
import { Track } from '../../src/simulation/track.ts';
import { createBabylonGridPaint } from '../../src/engine/babylon/grid-paint.ts';
import { createFormulaSurfaceProbe } from '../../src/engine/babylon/formula-surfaces.ts';
import { BabylonPresentationGpu } from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import {
  prepareOriginalMaterials,
  yieldPreparationTurn,
} from '../../src/engine/babylon/asset-preparation.ts';
import { createSurfaceProbeHarness, surfaceProbeResources } from './babylon-surface-parity.ts';
import {
  GRID_FACTOR_LIMITS as FACTOR_LIMITS,
  GRID_VIEWS,
  gridProbeTransaction,
  GRID_DEPTH_COUNTS,
  gridViewPose,
  gridRoadRange,
  originalGridReference,
  originalGridRoadReference,
  gridDepthSamples,
} from './babylon-grid-paint-reference.ts';

const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const equal = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => n === b[i]);
class GridFactorOutput extends MaterialPluginBase {
  mode = 0;
  constructor(material: PBRMaterial) {
    super(material, 'IsolatedOriginalGridFactors', 300, { GRID_FACTOR_OUTPUT: true }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'gridProbeMode', size: 1, type: 'float' },
        { name: 'gridProbeView', size: 16, type: 'mat4' },
      ],
      fragment: 'uniform float gridProbeMode; uniform mat4 gridProbeView;',
    };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('gridProbeMode', this.mode);
    buffer.updateMatrix('gridProbeView', this._material.getScene().getViewMatrix());
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: 'vec3 gridProbeAlbedo; vec3 gridProbeNormal;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS:
            'gridProbeAlbedo=surfaceAlbedo; gridProbeNormal=normalize(mat3(gridProbeView)*normalW);',
          CUSTOM_FRAGMENT_MAIN_END:
            'gl_FragColor=vec4(gridProbeMode<.5 ? gridProbeAlbedo : gridProbeNormal*.5+.5,1.0);',
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

interface GridProbeReport {
  transport: string;
  forceStandalone: boolean;
  baseline: object | null;
  factorLimits: typeof FACTOR_LIMITS;
  rows: object[];
  receipts: object[];
  images: { name: string; image: string }[];
  failure: string | null;
  loss: object | null;
  scope: string;
}
async function probe(
  forceStandalone: boolean,
  loseContext: boolean,
  deadline: number,
): Promise<GridProbeReport> {
  const report: GridProbeReport = {
    transport: 'unavailable',
    forceStandalone,
    baseline: null,
    factorLimits: FACTOR_LIMITS,
    rows: [],
    receipts: [],
    images: [],
    failure: null,
    loss: null,
    scope: 'Isolated original dry Formula grid; setup incomplete',
  };
  return gridProbeTransaction(report, async (cleanup) => {
    Object.assign(report, await runProbe(forceStandalone, loseContext, deadline, cleanup, report));
  });
}
async function runProbe(
  forceStandalone: boolean,
  loseContext: boolean,
  deadline: number,
  cleanup: (() => void)[],
  report: GridProbeReport,
) {
  const width = 1024,
    height = 384,
    h = createSurfaceProbeHarness(width, height, undefined, forceStandalone);
  cleanup.unshift(() => h.dispose());
  report.transport = h.transport;
  h.deadline = deadline;
  const timer = setTimeout(
    () => h.abort.abort(new Error('Grid case exceeded shared 120s deadline')),
    Math.max(0, deadline - performance.now()),
  );
  cleanup.unshift(() => clearTimeout(timer));
  const track = new Track(),
    original = originalGridReference(track);
  cleanup.unshift(() => original.dispose());
  const originalRoad = originalGridRoadReference(track);
  cleanup.unshift(() => originalRoad.dispose());
  const camera = new UniversalCamera('original grid inspection', Vector3.Zero(), h.scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 200;
  new HemisphericLight('independent inspection light', Vector3.Up(), h.scene);
  const warm = new PBRMaterial('shared PBR infrastructure', h.scene);
  warm.dispose();
  const resources = () => ({
    ...surfaceProbeResources(h.scene),
    transforms: h.scene.transformNodes.length,
    lights: h.scene.lights.length,
    cameras: h.scene.cameras.length,
  });
  const objects = () => [
    ...h.scene.meshes,
    ...h.scene.materials,
    ...h.scene.geometries,
    ...h.scene.textures,
    ...h.scene.lights,
    ...h.scene.cameras,
  ];
  const baseline = resources(),
    baselineObjects = objects();
  report.baseline = baseline;
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
  cleanup.unshift(() => threeCanvas.remove());
  document.body.append(threeCanvas);
  const renderer = new T.WebGLRenderer({
    canvas: threeCanvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  cleanup.unshift(() => renderer.dispose());
  // Register again after GPU infrastructure exists: these disposers are
  // idempotent, so early setup failures and normal GPU cleanup share ownership.
  cleanup.unshift(
    () => original.dispose(),
    () => originalRoad.dispose(),
  );
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0, 0);
  const threeGl = renderer.getContext() as WebGL2RenderingContext,
    threeGpu = new BabylonPresentationGpu(threeGl),
    threeSchedule = new PresentationSchedule();
  cleanup.unshift(() => threeGpu.dispose());
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
  const setCamera = (view: (typeof GRID_VIEWS)[number]) => {
    const pose = gridViewPose(track, view.row, view.eye);
    camera.position.copyFromFloats(...pose.eye.toArray());
    camera.setTarget(Vector3.FromArray(pose.target.toArray()));
    camera.orthoLeft = -view.extent;
    camera.orthoRight = view.extent;
    camera.orthoTop = (view.extent * height) / width;
    camera.orthoBottom = (-view.extent * height) / width;
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
    threeCamera.near = camera.minZ;
    threeCamera.far = camera.maxZ;
    threeCamera.projectionMatrix.fromArray(camera.getProjectionMatrix().asArray());
    threeCamera.projectionMatrixInverse.copy(threeCamera.projectionMatrix).invert();
    threeCamera.matrixWorldInverse.fromArray(camera.getViewMatrix().asArray());
    threeCamera.matrixWorld.copy(threeCamera.matrixWorldInverse).invert();
  };
  setCamera(GRID_VIEWS[0]);
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
  const referenceMode = { value: 0 },
    previous = original.material.onBeforeCompile,
    key = original.material.customProgramCacheKey();
  let referenceFinishCompiled = false;
  original.material.onBeforeCompile = (shader, renderer) => {
    previous.call(original.material, shader, renderer);
    referenceFinishCompiled =
      shader.fragmentShader.includes('finishFilteredNoise(vFinishWorld.xz*24.0)') &&
      shader.fragmentShader.includes('.82+.16*grit+.05*wear');
    shader.uniforms.gridReferenceMode = referenceMode;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float gridReferenceMode;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor=vec4(gridReferenceMode<.5 ? diffuseColor.rgb : normal*.5+.5,1.0);',
      );
  };
  original.material.customProgramCacheKey = () => key + ':isolated-grid-factors';
  for (const mesh of original.meshes)
    mesh.onAfterRender = () => {
      referenceDraws++;
    };
  threeScene.add(original.root);
  const gl = h.gl,
    rows = report.rows,
    receipts = report.receipts,
    images = report.images;
  let owner: Awaited<ReturnType<typeof createBabylonGridPaint>> | undefined,
    road: ReturnType<typeof createFormulaSurfaceProbe> | undefined;
  let failure: string | null = null,
    loss: object | null = null;
  cleanup.unshift(
    () => owner?.dispose(),
    () => road?.dispose(),
  );
  try {
    const cancel = new AbortController();
    let cancelled = false;
    try {
      await createBabylonGridPaint(options(AbortSignal.any([h.abort.signal, cancel.signal])), {
        prepare: async (...args) => {
          await prepareOriginalMaterials(...args);
          cancel.abort();
        },
      });
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === 'AbortError';
    }
    check(
      cancelled && JSON.stringify(resources()) === JSON.stringify(baseline),
      'Cancelled grid preparation leaked resources',
    );
    check(
      objects().every((value, i) => value === baselineObjects[i]) &&
        objects().length === baselineObjects.length,
      'Cancelled grid changed independent owners',
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle === 1) {
        road = await lease('Original grid-region road creation', async () =>
          createFormulaSurfaceProbe(
            h.scene,
            track,
            { discipline: 'formula', presentation: 'circuit', circuitId: 'aurel' },
            gridRoadRange(track),
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
      if (road) {
        check(
          road.roadMeshes.length === originalRoad.meshes.length,
          'Actual original road chunk count differs',
        );
        road.roadMeshes.forEach((mesh, i) => {
          check(
            equal(mesh.getIndices()!, originalRoad.meshes[i].geometry.index!.array) &&
              equal(
                mesh.getVerticesData('position')!,
                originalRoad.meshes[i].geometry.getAttribute('position').array,
              ),
            'Native subset must retain actual full original road chunk triangles',
          );
        });
      }
      const cycleBaseline = resources(),
        coObjects = objects();
      const coGeometry = h.scene.meshes.map((mesh) => {
        if (!(mesh instanceof Mesh)) throw new Error('Unexpected independent mesh class');
        return {
          mesh,
          enabled: mesh.isEnabled(),
          indices: Array.from(mesh.getIndices() ?? []),
          vertices: mesh
            .getVerticesDataKinds()
            .map((kind) => ({ kind, values: Array.from(mesh.getVerticesData(kind)!) })),
          world: Array.from(mesh.getWorldMatrix().asArray()),
        };
      });
      owner = await createBabylonGridPaint(options());
      const d = owner.diagnostics();
      check(
        d.stagedParts === original.meshes.length && d.activeParts === 0 && d.activeMaterials === 0,
        'Grid not staged outside scene',
      );
      check(
        d.meshes.length === original.meshes.length &&
          d.meshes.reduce((n, m) => n + m.getTotalIndices() / 3, 0) === 432,
        'Original 432-triangle inventory differs',
      );
      for (let i = 0; i < d.meshes.length; i++) {
        const mesh = d.meshes[i],
          source = original.meshes[i];
        check(
          equal(mesh.getIndices()!, source.geometry.index!.array),
          'Original grid indices differ',
        );
        for (const kind of ['position', 'normal', 'uv'])
          check(
            equal(mesh.getVerticesData(kind)!, source.geometry.getAttribute(kind).array),
            'Original grid attribute differs',
          );
        check(
          equal(mesh.getWorldMatrix().asArray(), new Float32Array(source.matrixWorld.elements)),
          'Original grid world pose differs',
        );
      }
      check(
        equal(d.material.albedoColor.asArray(), original.material.color.toArray()) &&
          d.material.roughness === 0.55 &&
          d.material.backFaceCulling &&
          !d.material.twoSidedLighting,
        'Original grid material differs',
      );
      await pump(owner.install());
      const ownedBuffers = await lease(
        'Original grid native buffer ownership witness',
        async () => {
          const buffers = new Set<WebGLBuffer>();
          for (const mesh of d.meshes) {
            for (const kind of ['position', 'normal', 'uv']) {
              const buffer = mesh.getVertexBuffer(kind)?.getBuffer()?.underlyingResource as
                | WebGLBuffer
                | undefined;
              if (buffer) buffers.add(buffer);
            }
            const index = mesh.geometry?.getIndexBuffer()?.underlyingResource as
              | WebGLBuffer
              | undefined;
            if (index) buffers.add(index);
          }
          const handles = [...buffers],
            allLive = handles.every((buffer) => gl.isBuffer(buffer));
          receipts.push({ cycle, phase: 'native-owned-buffers', count: handles.length, allLive });
          check(
            handles.length === d.meshes.length * 4 && allLive,
            'Original grid vertex/index GPU allocations missing',
          );
          return handles;
        },
      );
      check(
        owner.diagnostics().activeParts === d.meshes.length &&
          owner.diagnostics().activeMaterials === 1,
        'Installed grid bindings missing',
      );
      if (cycle === 0)
        images.push({
          name: 'native-grid',
          image: await lease('Native dry grid image', async () => h.capture().image),
        });
      const plugin = await lease(
        'Install isolated original grid factor output',
        async () => new GridFactorOutput(d.material),
      );
      await prepareOriginalMaterials(
        { scene: h.scene, meshes: d.meshes },
        h.gpu,
        h.abort.signal,
        deadline,
        () => {},
      );
      coGeometry.forEach(({ mesh }) => mesh.setEnabled(false));
      await threeGpu.prepare('Original grid factor reference compilation', deadline, async () => {
        await renderer.compileAsync(threeScene, threeCamera);
      });
      const seenBatches = new Set<Mesh>();
      for (const view of GRID_VIEWS) {
        setCamera(view);
        // Entire fixed source-only sample set is classified BEFORE reading any
        // native output. No ray, near tie or raster mismatch is filtered away.
        const samples =
          view.depth && cycle === 1
            ? gridDepthSamples(
                track,
                view.row,
                threeCamera,
                original.meshes,
                originalRoad.root,
                width,
                height,
              )
            : null;
        if (samples) {
          const counts = {
            visible: samples.filter((s) => s.visible).length,
            occluded: samples.filter((s) => !s.visible).length,
            total: samples.length,
          };
          check(
            JSON.stringify(counts) ===
              JSON.stringify(GRID_DEPTH_COUNTS[view.name as keyof typeof GRID_DEPTH_COUNTS]),
            'Preregistered original grid depth counts changed',
          );
        }
        for (const mode of [0, 1]) {
          plugin.mode = mode;
          referenceMode.value = mode;
          const stage = mode === 0 ? 'linear-albedo' : 'view-normal';
          const factorReceipt = { cycle, view: view.name, stage, status: 'reference' };
          receipts.push(factorReceipt);
          const first = await referenceFrame(),
            repeated = await referenceFrame();
          Object.assign(factorReceipt, {
            referenceRepeat: equal(first.pixels, repeated.pixels),
            referenceGlErrors: [first.glError, repeated.glError],
            referenceFrontFaces: [first.frontFace, repeated.frontFace],
            referenceFrames: [first.completedFrames, repeated.completedFrames],
            referenceDraws: [first.draws, repeated.draws],
          });
          if (cycle === 0) images.push({ name: `${view.name}-${stage}-three`, image: first.image });
          check(
            referenceFinishCompiled &&
              equal(first.pixels, repeated.pixels) &&
              first.glError === 0 &&
              repeated.glError === 0 &&
              first.completedFrames >= 2 &&
              repeated.completedFrames >= 2 &&
              first.draws >= 2 &&
              repeated.draws >= 2,
            'Original finished grid reference did not repeat after completed draws',
          );
          const draws: {
            part: number;
            frontFace: number;
            culling: boolean;
            cullMode: number;
            depthTest: boolean;
            depthWrite: boolean;
            depthFunc: number;
          }[] = [];
          Object.assign(factorReceipt, { status: 'native-presentation', draws });
          const drawnBatches = new Set<Mesh>();
          let ownedDraw = false;
          const observers = d.meshes.map((mesh) =>
            mesh.onAfterRenderObservable.add(() => {
              check(ownedDraw, 'Grid draw observation outside owned frame');
              drawnBatches.add(mesh);
              seenBatches.add(mesh);
              draws.push({
                part: d.meshes.indexOf(mesh),
                frontFace: gl.getParameter(gl.FRONT_FACE),
                culling: gl.isEnabled(gl.CULL_FACE),
                cullMode: gl.getParameter(gl.CULL_FACE_MODE),
                depthTest: gl.isEnabled(gl.DEPTH_TEST),
                depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK),
                depthFunc: gl.getParameter(gl.DEPTH_FUNC),
              });
            }),
          );
          const completed = h.gpu.diagnostics().completed;
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
            d.meshes.forEach((mesh, i) => mesh.onAfterRenderObservable.remove(observers[i]));
          }
          const actual = await lease(
            'Original grid factor and linked-program readback',
            async () => {
              const programs = d.meshes
                .filter((mesh) => drawnBatches.has(mesh))
                .map((mesh) => {
                  const effect = mesh.subMeshes[0]?.effect,
                    program = (effect?.getPipelineContext() as WebGLPipelineContext | null)
                      ?.program;
                  return {
                    part: d.meshes.indexOf(mesh),
                    name: mesh.name,
                    linked:
                      !!program &&
                      gl.isProgram(program) &&
                      !!gl.getProgramParameter(program, gl.LINK_STATUS),
                    error: effect?.getCompilationError(),
                    defines: effect?.defines ?? '',
                    finish: effect?._fragmentSourceCode.includes(
                      'finishFilteredNoise(vPositionW.xz*24.0)',
                    ),
                    ubo: d.material._uniformBuffer.useUbo,
                  };
                });
              return { ...h.capture(), programs, glError: gl.getError() };
            },
          );
          const result = metrics(actual.pixels, first.pixels, width, height);
          Object.assign(factorReceipt, {
            status: 'factor-comparison',
            metrics: result,
            completedFrames: h.gpu.diagnostics().completed - completed,
            programs: actual.programs,
            glError: actual.glError,
          });
          if (cycle === 0)
            images.push({ name: `${view.name}-${stage}-babylon`, image: actual.image });
          check(
            draws.length > 0 &&
              draws.every(
                (draw) =>
                  draw.frontFace === gl.CCW &&
                  draw.culling &&
                  draw.cullMode === gl.BACK &&
                  draw.depthTest &&
                  draw.depthWrite &&
                  draw.depthFunc === gl.LEQUAL,
              ),
            'Grid actual CCW/back-culling/depth draw contract differs',
          );
          check(
            h.gpu.diagnostics().completed - completed >= 2 &&
              actual.glError === 0 &&
              result.compared >= 1000 &&
              result.missingInterior === 0 &&
              result.partialAlpha === 0 &&
              result.missing + result.excess <= FACTOR_LIMITS.coverageMismatchPixels &&
              result.max <= FACTOR_LIMITS.max &&
              result.mean <= FACTOR_LIMITS.mean,
            `Original grid ${view.name}/${stage} factor differs`,
          );
          check(
            actual.programs.every(
              (p) =>
                p.linked &&
                !p.error &&
                p.finish &&
                p.ubo === (h.transport === 'ubo') &&
                /^#define ORIGINAL_CIRCUIT_PAINT_FINISH_V1\b/m.test(p.defines) &&
                !/^#define TWOSIDEDLIGHTING\b/m.test(p.defines),
            ),
            'Original grid dry finish or uniform transport missing',
          );
          if (samples && mode === 0) {
            const depth = {
              cycle,
              phase: 'original-road-depth',
              view: view.name,
              status: 'reference-compile',
              total: samples.length,
              expectedCounts: GRID_DEPTH_COUNTS[view.name as keyof typeof GRID_DEPTH_COUNTS],
              minimumTriangleGap: Math.min(...samples.map((s) => Math.abs(s.gap))),
              pixels: [] as object[],
              verifiedSamples: 0,
              visible: 0,
              occluded: 0,
            };
            receipts.push(depth);
            threeScene.add(originalRoad.root);
            let roadDraws = 0;
            originalRoad.meshes.forEach((mesh) => {
              mesh.onAfterRender = () => {
                roadDraws++;
              };
            });
            await threeGpu.prepare(
              'Original grid road-depth reference compilation',
              deadline,
              async () => {
                await renderer.compileAsync(threeScene, threeCamera);
              },
            );
            const composite = await referenceFrame();
            images.push({ name: `${view.name}-three-composite`, image: composite.image });
            const compositeRepeat = await referenceFrame();
            original.root.visible = false;
            const referenceRoadOnly = await referenceFrame();
            images.push({ name: `${view.name}-three-road-only`, image: referenceRoadOnly.image });
            const referenceRoadRepeat = await referenceFrame();
            original.root.visible = true;
            Object.assign(depth, {
              status: 'reference-repeat',
              referenceRepeat: equal(composite.pixels, compositeRepeat.pixels),
              roadOnlyRepeat: equal(referenceRoadOnly.pixels, referenceRoadRepeat.pixels),
              referenceGlErrors: [
                composite,
                compositeRepeat,
                referenceRoadOnly,
                referenceRoadRepeat,
              ].map((c) => c.glError),
              referenceFrames: [
                composite,
                compositeRepeat,
                referenceRoadOnly,
                referenceRoadRepeat,
              ].map((c) => c.completedFrames),
              roadDraws,
            });
            check(
              equal(composite.pixels, compositeRepeat.pixels) &&
                equal(referenceRoadOnly.pixels, referenceRoadRepeat.pixels) &&
                [composite, compositeRepeat, referenceRoadOnly, referenceRoadRepeat].every(
                  (c) => c.glError === 0 && c.completedFrames >= 2,
                ) &&
                roadDraws >= 8,
              'Original grid composite/road-only reference failed repeat gate',
            );
            let withRoad: ReturnType<typeof h.capture> & { glError: number },
              roadOnly: ReturnType<typeof h.capture> & { glError: number };
            try {
              coGeometry.forEach(({ mesh, enabled }) => mesh.setEnabled(enabled));
              await h.presented();
              withRoad = await lease('Native original grid road composite', async () => ({
                ...h.capture(),
                glError: gl.getError(),
              }));
              Object.assign(depth, { nativeCompositeGlError: withRoad.glError });
              images.push({ name: `${view.name}-native-composite`, image: withRoad.image });
              d.meshes.forEach((mesh) => mesh.setEnabled(false));
              await h.presented();
              roadOnly = await lease('Native independent road-only witness', async () => ({
                ...h.capture(),
                glError: gl.getError(),
              }));
              Object.assign(depth, { nativeRoadOnlyGlError: roadOnly.glError });
              images.push({ name: `${view.name}-native-road-only`, image: roadOnly.image });
            } finally {
              d.meshes.forEach((mesh) => mesh.setEnabled(true));
              coGeometry.forEach(({ mesh }) => mesh.setEnabled(false));
            }
            check(
              withRoad.glError === 0 && roadOnly.glError === 0,
              'Native grid composite/road-only GL error',
            );
            const coverage = metrics(withRoad.pixels, composite.pixels, width, height);
            Object.assign(depth, {
              status: 'coverage-comparison',
              coverage: {
                missing: coverage.missing,
                excess: coverage.excess,
                partialAlpha: coverage.partialAlpha,
              },
            });
            check(
              coverage.missing + coverage.excess <= FACTOR_LIMITS.coverageMismatchPixels &&
                coverage.partialAlpha === 0,
              'Original grid road composite coverage differs',
            );
            let visible = 0,
              occluded = 0,
              sumVisible = 0,
              sumOccluded = 0,
              max = 0;
            depth.status = 'fixed-pixel-comparison';
            for (const sample of samples) {
              const i = (sample.py * width + sample.px) * 4;
              const opaque = [first, composite, referenceRoadOnly, withRoad, roadOnly].every(
                (c) => c.pixels[i + 3] === 255,
              );
              const delta = (a: Uint8Array, b: Uint8Array) =>
                Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c] - b[i + c])));
              const originalPaintError = delta(composite.pixels, first.pixels),
                originalRoadError = delta(composite.pixels, referenceRoadOnly.pixels),
                nativePaintError = delta(withRoad.pixels, first.pixels),
                nativeRoadError = delta(withRoad.pixels, roadOnly.pixels),
                distinct = delta(roadOnly.pixels, first.pixels);
              depth.pixels.push({
                ...sample,
                opaque,
                originalPaintError,
                originalRoadError,
                nativePaintError,
                nativeRoadError,
                distinct,
              });
              check(opaque, 'Fixed grid depth pixel is not opaque');
              check(
                distinct > FACTOR_LIMITS.max,
                'Grid/road fixed sample colors are indistinguishable',
              );
              check(
                sample.visible
                  ? originalPaintError <= FACTOR_LIMITS.max && originalRoadError > FACTOR_LIMITS.max
                  : originalRoadError === 0 && originalPaintError > FACTOR_LIMITS.max,
                'Original Three composite disagrees with original triangle-depth class',
              );
              const error = sample.visible ? nativePaintError : nativeRoadError;
              check(
                error <= FACTOR_LIMITS.max &&
                  (sample.visible ? nativeRoadError : nativePaintError) > FACTOR_LIMITS.max,
                'Native grid visible/occluded classification differs',
              );
              max = Math.max(max, error);
              const sum = [0, 1, 2].reduce(
                (n, c) =>
                  n +
                  Math.abs(
                    withRoad.pixels[i + c] -
                      (sample.visible ? first.pixels[i + c] : roadOnly.pixels[i + c]),
                  ),
                0,
              );
              if (sample.visible) {
                visible++;
                sumVisible += sum;
              } else {
                occluded++;
                sumOccluded += sum;
              }
              depth.verifiedSamples++;
              depth.visible = visible;
              depth.occluded = occluded;
            }
            const meanVisible = visible ? sumVisible / (visible * 3) : 0,
              meanOccluded = occluded ? sumOccluded / (occluded * 3) : 0;
            Object.assign(depth, { max, meanVisible, meanOccluded, status: 'mean-comparison' });
            check(
              meanVisible <= FACTOR_LIMITS.mean && meanOccluded <= FACTOR_LIMITS.mean,
              'Fixed grid depth errors exceed factor limit',
            );
            const depthGlError = await lease('Grid depth GL receipt', async () => gl.getError());
            Object.assign(depth, { glError: depthGlError, status: 'gl-status' });
            check(depthGlError === 0, 'Grid depth GL error');
            depth.status = 'complete';
            threeScene.remove(originalRoad.root);
          }
        }
      }
      check(
        seenBatches.size === d.meshes.length,
        'Fixed grid views did not actually draw every source batch',
      );
      coGeometry.forEach(({ mesh, enabled }) => mesh.setEnabled(enabled));
      await h.presented();
      if (loseContext && cycle === 1) {
        const ext = await lease('Grid context-loss extension', async () =>
          gl.getExtension('WEBGL_lose_context'),
        );
        check(ext, 'Context-loss extension unavailable');
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
        await lease('Grid owner disposal', async () => {
          owner!.dispose();
          owner!.dispose();
        });
      const nativeBuffersDeleted = h.gpu.diagnostics().lost
        ? null
        : await lease('Disposed grid native buffer witness', async () =>
            ownedBuffers.every((buffer) => !gl.isBuffer(buffer)),
          );
      receipts.push({
        cycle,
        phase: 'native-buffer-disposal',
        count: ownedBuffers.length,
        deleted: nativeBuffersDeleted,
        lost: h.gpu.diagnostics().lost,
      });
      check(
        nativeBuffersDeleted === true || h.gpu.diagnostics().lost,
        'Original grid GPU buffer disposal failed',
      );
      check(
        d.meshes.every((mesh) => mesh.isDisposed()) &&
          JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Grid disposal did not restore baseline',
      );
      check(
        objects().length === coObjects.length &&
          objects().every((value, i) => value === coObjects[i]),
        'Grid changed independent resource identities',
      );
      check(
        coGeometry.every(
          ({ mesh, indices, vertices, world }) =>
            !mesh.isDisposed() &&
            equal(mesh.getIndices() ?? [], indices) &&
            vertices.every(({ kind, values }) => equal(mesh.getVerticesData(kind)!, values)) &&
            equal(mesh.getWorldMatrix().asArray(), world),
        ),
        'Grid changed independent geometry/world pose',
      );
      rows.push({
        cycle,
        slots: 12,
        boxes: 36,
        triangles: 432,
        parts: d.meshes.length,
        nativeBufferCount: ownedBuffers.length,
        nativeBuffersDeleted,
        disposed: true,
        restored: resources(),
      });
      owner = undefined;
      if (road) {
        if (h.gpu.diagnostics().lost) road.dispose();
        else await lease('Independent road cleanup', async () => road!.dispose());
        road = undefined;
      }
      check(
        JSON.stringify(resources()) === JSON.stringify(baseline) &&
          objects().length === baselineObjects.length &&
          objects().every((value, i) => value === baselineObjects[i]),
        'Grid cycle did not restore original independent baseline',
      );
    }
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
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
      'Original Aurel Formula 432-triangle grid dry paint factors and source-classified original-road occlusion only; no live activation, wet/GP/shadow/final PBR parity',
  };
}
export async function babylonGridPaint(forceStandalone = false, loseContext = false) {
  const deadline = performance.now() + 120000;
  const report = await probe(forceStandalone, loseContext, deadline);
  const restart =
    loseContext && report.failure === null ? await probe(forceStandalone, false, deadline) : null;
  return { ...report, restart };
}
