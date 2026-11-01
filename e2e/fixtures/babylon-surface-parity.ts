import type { WebGLPipelineContext } from '@babylonjs/core/Engines/WebGL/webGLPipelineContext.js';
import type { DataBuffer } from '@babylonjs/core/Buffers/dataBuffer.js';
import { F, carBase } from '../../src/simulation/protocol.ts';
import { writeFormulaGroundingPose } from '../../src/engine/assets/formula-grounding.ts';
import { BabylonCircuitScene } from '../../src/engine/babylon/circuit-scene.ts';
import { SurfacePreparation } from '../../src/engine/babylon/surface-preparation.ts';
import { SimulationComponent } from '../../src/engine/simulation-component.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color3, Color4, Vector3, Quaternion } from '@babylonjs/core/Maths/math.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import * as THREE from 'three';
import { CircuitPaintFinishPlugin } from '../../src/engine/babylon/circuit-paint-finish.ts';
import { createFormulaSurfaceProbe } from '../../src/engine/babylon/formula-surfaces.ts';
import { installCircuitFinish } from '../../src/rendering/circuit-finish.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import {
  BabylonPresentationGpu,
  cleanupPresentation,
} from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import { waitForPresentation } from '../../src/engine/babylon/presentation-ready.ts';
import {
  prepareOriginalMaterials,
  yieldPreparationTurn,
} from '../../src/engine/babylon/asset-preparation.ts';

// Isolated engineering probe; neither game entry imports this file. It exercises
// the current surface owner without changing live selection, shaders or physics.
function harness(
  width: number,
  height: number,
  sceneFactory?: (engine: Engine) => Scene,
  forceStandalone = false,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.append(canvas);
  const engine = new Engine(canvas, false, { preserveDrawingBuffer: true });
  // Only disable: never override Babylon native driver exclusions.
  if (forceStandalone) engine.disableUniformBuffers = true;
  const transport = engine.supportsUniformBuffers ? ('ubo' as const) : ('standalone' as const);
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('Surface acceptance requires WebGL2');
  let scene: Scene;
  try {
    scene = sceneFactory ? sceneFactory(engine) : new Scene(engine);
  } catch (error) {
    cleanupPresentation([() => engine.dispose(), () => canvas.remove()]);
    throw error;
  }
  scene.useRightHandedSystem = true;
  if (!sceneFactory) scene.clearColor = new Color4(0, 0, 0, 0);
  const gpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule();
  const abort = new AbortController(),
    deadline = performance.now() + 120000;
  const timer = setTimeout(
    () => abort.abort(new Error('Surface probe exceeded 120000ms total budget')),
    120000,
  );
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      gpu.contextLost();
      abort.abort(new Error('Surface probe lost WebGL context'));
    },
    { signal: abort.signal },
  );
  const effects = new Map<Effect, string>();
  const observe = (material: Material) =>
    material.onEffectCreatedObservable.add(({ effect }) => {
      if (effect) effects.set(effect, material.name);
    });
  // Cached driver-submitted source only: public source getters can query GL,
  // which is unsafe if a first-fault deadline leaves graphics still pending.
  const shaders = (failed: boolean) => {
    const sourceSeen = new Set<string>();
    return {
      maxFragmentSamplers: engine.getCaps().maxTexturesImageUnits,
      effects: [...effects].map(([effect, material]) => {
        const error = effect.getCompilationError(),
          source = effect._fragmentSourceCode;
        const retainSource =
          !!error || (!sourceSeen.has(source) && sourceSeen.size < (failed ? 12 : 2));
        if (retainSource) sourceSeen.add(source);
        return {
          material,
          error,
          samplers: effect.getSamplers(),
          samplerCount: effect.getSamplers().length,
          ...(retainSource
            ? { vertexSource: effect._vertexSourceCode, fragmentSource: source }
            : {}),
        };
      }),
    };
  };
  const presented = async (draw = () => scene.render()) => {
    let done = false,
      failure: unknown;
    const completed = waitForPresentation(scene, abort.signal, gpu).then(() => {
      done = true;
    });
    void completed.catch((error) => {
      failure = error;
    });
    while (!done) {
      abort.signal.throwIfAborted();
      if (failure) throw failure;
      gpu.ready();
      await Promise.resolve();
      if (done) break;
      gpu.frame(schedule, false, scene, () => {
        const before = scene.isReady();
        engine.beginFrame();
        draw();
        engine.endFrame();
        const after = scene.isReady();
        schedule.rendered(before, after);
        return before && after;
      });
      await yieldPreparationTurn(abort.signal, deadline);
    }
    await completed;
  };
  const capture = () => {
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels, image: canvas.toDataURL('image/png') };
  };
  return {
    canvas,
    transport,
    engine,
    gl,
    scene,
    gpu,
    schedule,
    abort,
    deadline,
    presented,
    capture,
    observe,
    shaders,
    dispose() {
      const failures = cleanupPresentation([
        () => clearTimeout(timer),
        () => abort.abort(),
        () => gpu.dispose(),
        () => scene.dispose(),
        () => engine.dispose(),
        () => canvas.remove(),
      ]);
      if (failures.length) throw failures[0];
    },
  };
}
const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Capture the actual PBR albedo after the production paint plugin, before
 * lighting. Half-scale encoding retains factors above one without clipping. */
class PaintFactorOutput extends MaterialPluginBase {
  constructor(material: PBRMaterial, base: readonly number[]) {
    super(
      material,
      'SurfaceProbePaintFactor',
      300,
      { SURFACE_PROBE_PAINT_FACTOR_V1: true },
      true,
      true,
    );
    this.base = base.map((v) => v.toPrecision(17)).join(',');
  }
  private readonly base: string;
  getCustomCode(shaderType: string) {
    return shaderType === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: 'vec3 surfaceProbeFactor;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: `surfaceProbeFactor=surfaceAlbedo/vec3(${this.base});`,
          CUSTOM_FRAGMENT_MAIN_END: 'gl_FragColor=vec4(surfaceProbeFactor*.5,1.0);',
        }
      : null;
  }
}

/** Diagnostic only: authored side ID, retaining the same geometry, depth/cull
 * state and single shared paint material. Screen halves cannot identify sides.
 * v9.33.1 hardBind runs on every submesh before the final UBO upload, unlike
 * ordinary bindForSubMesh which can be skipped for a cached shared material. */
class SurfaceIdOutput extends MaterialPluginBase {
  enabled = false;
  constructor(
    material: PBRMaterial,
    private readonly paint: boolean,
  ) {
    super(material, 'SurfaceProbeId', 400, { SURFACE_PROBE_ID_V2: true }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'surfaceProbeIdEnabled', size: 1, type: 'float' },
        { name: 'surfaceProbeAuthoredSide', size: 1, type: 'float' },
      ],
      fragment: 'uniform float surfaceProbeIdEnabled; uniform float surfaceProbeAuthoredSide;',
    };
  }
  hardBindForSubMesh(
    buffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ) {
    const side: unknown = subMesh.getMesh().metadata?.side;
    if (this.paint ? side !== -1 && side !== 1 : side !== 0)
      throw new Error('Surface ID probe requires exact authored road/paint side metadata');
    buffer.updateFloat('surfaceProbeIdEnabled', this.enabled ? 1 : 0);
    buffer.updateFloat('surfaceProbeAuthoredSide', side as number);
  }
  getCustomCode(shaderType: string) {
    return shaderType === 'fragment'
      ? {
          CUSTOM_FRAGMENT_MAIN_END: `if(surfaceProbeIdEnabled>.5) {
            gl_FragColor=surfaceProbeAuthoredSide<-.5 ? vec4(1.0,1.0,0.0,1.0)
              : surfaceProbeAuthoredSide>.5 ? vec4(1.0,0.0,1.0,1.0) : vec4(0.0,0.0,1.0,1.0);
          }`,
        }
      : null;
  }
}
const resources = (scene: Scene) => ({
  meshes: scene.meshes.length,
  geometries: scene.geometries.length,
  materials: scene.materials.length,
  textures: scene.textures.length,
});
const prepare = (h: ReturnType<typeof harness>, meshes: readonly Mesh[]) =>
  prepareOriginalMaterials(
    { meshes: [...meshes], scene: h.scene } as unknown as AssetContainer,
    h.gpu,
    h.abort.signal,
    h.deadline,
    () => {},
  );

// Reuse the unchanged bounded GPU owner for other isolated material probes.
export {
  harness as createSurfaceProbeHarness,
  resources as surfaceProbeResources,
  prepare as prepareSurfaceProbeMeshes,
};

function compareInterior(actual: Uint8Array, expected: Uint8Array, size: number) {
  let comparedPixels = 0,
    maxChannelError = 0,
    sum = 0,
    min = 255,
    max = 0;
  for (let y = 2; y < size - 2; y++)
    for (let x = 2; x < size - 2; x++) {
      const i = (y * size + x) * 4;
      // Geometric coverage only, never exclude disagreeing colour samples.
      const interior = [-2, -1, 0, 1, 2].every(
        (d) =>
          expected[i + d * 4 + 3] === 255 &&
          actual[i + d * 4 + 3] === 255 &&
          expected[i + d * size * 4 + 3] === 255 &&
          actual[i + d * size * 4 + 3] === 255,
      );
      if (!interior) continue;
      comparedPixels++;
      min = Math.min(min, expected[i]);
      max = Math.max(max, expected[i]);
      for (let c = 0; c < 3; c++) {
        const error = Math.abs(actual[i + c] - expected[i + c]);
        maxChannelError = Math.max(maxChannelError, error);
        sum += error;
      }
    }
  return {
    comparedPixels,
    maxChannelError,
    meanChannelError: sum / (comparedPixels * 3),
    referenceMin: min,
    referenceMax: max,
  };
}

export async function babylonControlledPaintParity() {
  const size = 256,
    h = harness(size, size);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0, 0);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const threeGpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule();
  const threeShaderErrors: object[] = [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    threeShaderErrors.push({
      program: context.getProgramInfoLog(program as unknown as WebGLProgram),
      vertex: context.getShaderInfoLog(vertex),
      fragment: context.getShaderInfoLog(fragment),
      vertexSource: context.getShaderSource(vertex),
      fragmentSource: context.getShaderSource(fragment),
    });
  };
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      threeGpu.contextLost();
      h.abort.abort(new Error('Three paint reference lost context'));
    },
    { signal: h.abort.signal },
  );
  const scene = new THREE.Scene();
  const camera = new UniversalCamera('paint-factor', new Vector3(0, 4, 2), h.scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -1.3;
  camera.orthoRight = 1.3;
  camera.orthoTop = 1.3;
  camera.orthoBottom = -1.3;
  camera.minZ = 0.1;
  camera.maxZ = 20;
  const threeCamera = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.1, 20);
  threeCamera.position.set(0, 4, 2);
  threeCamera.lookAt(0, 0, 0);
  const positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const indices = [0, 2, 1, 0, 3, 2],
    uv = [0, 0, 1, 0, 1, 1, 0, 1];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const base = new THREE.Color(0xe9e7e0).toArray();
  const rows: {
    name: string;
    comparedPixels: number;
    maxChannelError: number;
    meanChannelError: number;
    referenceMin: number;
    referenceMax: number;
    babylonGlError: number;
    threeGlError: number;
    completedFrames: number;
    babylonCompletedFrames: number;
    paintShaderCode: boolean;
    shaderSamplers: string[];
    babylonImage: string;
    threeImage: string;
    retained: ReturnType<typeof resources>;
  }[] = [];
  let failure: string | null = null;
  let shaders: ReturnType<typeof h.shaders> | null = null;
  const warm = new PBRMaterial('baseline-PBR-infrastructure', h.scene);
  warm.dispose();
  const baseline = resources(h.scene);
  try {
    for (const probe of [
      { name: 'resolved', scale: 1, bank: 0, translated: false, finish: true },
      { name: 'banked-translated', scale: 1, bank: 0.17, translated: true, finish: true },
      { name: 'minified', scale: 300, bank: 0, translated: false, finish: true },
      { name: 'plain-control', scale: 1, bank: 0, translated: false, finish: false },
    ]) {
      const mesh = new Mesh(probe.name, h.scene),
        vertex = new VertexData();
      vertex.positions = positions;
      vertex.normals = normals;
      vertex.uvs = uv;
      vertex.indices = indices;
      vertex.applyToMesh(mesh);
      const material = new PBRMaterial(probe.name, h.scene);
      material.albedoColor = new Color3(base[0], base[1], base[2]);
      material.metallic = 0;
      material.roughness = 0.55;
      material.sideOrientation = Material.CounterClockWiseSideOrientation;
      material.backFaceCulling = true;
      if (probe.finish) new CircuitPaintFinishPlugin(material);
      new PaintFactorOutput(material, base);
      h.observe(material);
      mesh.material = material;
      const threeMaterial = new THREE.MeshStandardMaterial({
        color: 0xe9e7e0,
        roughness: 0.55,
        metalness: 0,
      });
      if (probe.finish) installCircuitFinish(threeMaterial, 'paint');
      const original = threeMaterial.onBeforeCompile;
      const originalKey = threeMaterial.customProgramCacheKey();
      threeMaterial.onBeforeCompile = (shader, referenceRenderer) => {
        original.call(threeMaterial, shader, referenceRenderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>\ngl_FragColor=vec4(diffuseColor.rgb/vec3(${base.map((v) => v.toPrecision(17)).join(',')})*.5,1.0);`,
        );
      };
      threeMaterial.customProgramCacheKey = () => `${originalKey}:surface-probe-factor-v1`;
      const threeMesh = new THREE.Mesh(geometry, threeMaterial);
      scene.add(threeMesh);
      mesh.scaling.setAll(probe.scale);
      threeMesh.scale.setScalar(probe.scale);
      mesh.rotation.z = threeMesh.rotation.z = probe.bank;
      const centre = probe.translated ? [3.125, 0, -2.75] : [0, 0, 0];
      mesh.position.set(centre[0], centre[1], centre[2]);
      threeMesh.position.fromArray(centre);
      camera.position.set(centre[0], 4 * probe.scale, centre[2] + 2 * probe.scale);
      camera.setTarget(mesh.position);
      camera.orthoLeft = -1.3 * probe.scale;
      camera.orthoRight = 1.3 * probe.scale;
      camera.orthoTop = 1.3 * probe.scale;
      camera.orthoBottom = -1.3 * probe.scale;
      camera.maxZ = 20 * probe.scale;
      threeCamera.position.set(centre[0], 4 * probe.scale, centre[2] + 2 * probe.scale);
      threeCamera.lookAt(...(centre as [number, number, number]));
      threeCamera.left = -1.3 * probe.scale;
      threeCamera.right = 1.3 * probe.scale;
      threeCamera.top = 1.3 * probe.scale;
      threeCamera.bottom = -1.3 * probe.scale;
      threeCamera.far = 20 * probe.scale;
      threeCamera.updateProjectionMatrix();
      await prepare(h, [mesh]);
      const before = h.gpu.diagnostics().completed;
      await h.presented();
      const actual = h.capture();
      await threeGpu.prepare(probe.name, h.deadline, async () => {
        await renderer.compileAsync(scene, threeCamera);
      });
      const beforeThree = threeGpu.diagnostics().completed;
      while (threeGpu.diagnostics().completed < beforeThree + 2) {
        h.abort.signal.throwIfAborted();
        threeGpu.ready();
        if (threeGpu.diagnostics().completed >= beforeThree + 2) break;
        threeGpu.frame(schedule, false, scene, () => {
          renderer.render(scene, threeCamera);
          return true;
        });
        await yieldPreparationTurn(h.abort.signal, h.deadline);
      }
      const expected = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, expected);
      const effect = mesh.subMeshes[0]?.effect;
      if (!effect) throw new Error(`No paint effect: ${probe.name}`);
      rows.push({
        name: probe.name,
        ...compareInterior(actual.pixels, expected, size),
        babylonGlError: h.gl.getError(),
        threeGlError: gl.getError(),
        completedFrames: threeGpu.diagnostics().completed - beforeThree,
        babylonCompletedFrames: h.gpu.diagnostics().completed - before,
        paintShaderCode: effect._fragmentSourceCode.includes('float finishFilteredNoise'),
        shaderSamplers: [...effect.getSamplers()],
        babylonImage: actual.image,
        threeImage: canvas.toDataURL('image/png'),
        retained: resources(h.scene),
      });
      scene.remove(threeMesh);
      threeMaterial.dispose();
      mesh.dispose();
      material.dispose();
    }
  } catch (error) {
    failure = message(error);
  }
  const restored = resources(h.scene);
  const diagnostics = { babylon: h.gpu.diagnostics(), three: threeGpu.diagnostics() };
  try {
    shaders = h.shaders(!!failure);
  } catch (error) {
    failure ??= message(error);
  }
  for (const cleanup of [
    () => threeGpu.dispose(),
    () => {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) (object.material as THREE.Material).dispose();
      });
    },
    () => geometry.dispose(),
    () => renderer.dispose(),
    () => canvas.remove(),
    () => h.dispose(),
  ]) {
    try {
      cleanup();
    } catch (error) {
      failure ??= message(error);
    }
  }
  return {
    failure,
    rows,
    shaders,
    threeShaderErrors,
    threeRevision: THREE.REVISION,
    encoding: 'linear RGB8 = paint factor * 0.5; actual original Three construction finish',
    baseline,
    restored,
    diagnostics,
    productionActivated: false,
  };
}

export async function babylonFormulaSurfaceVisibility() {
  const h = harness(1024, 768);
  h.scene.clearColor = new Color4(0.12, 0.17, 0.23, 1);
  const camera = new UniversalCamera('surface-visibility', new Vector3(0, 10, -20), h.scene);
  camera.minZ = 0.05;
  camera.maxZ = 2000;
  camera.fov = Math.PI / 3;
  const fill = new HemisphericLight('fixed-sky', new Vector3(0, 1, 0), h.scene);
  fill.intensity = 0.7;
  const sun = new DirectionalLight('fixed-sun', new Vector3(-0.3, -1, 0.4), h.scene);
  sun.intensity = 1.5;
  const aurel = new Track('clear'),
    coast = new Track('clear', false, undefined, CIRCUITS.vellamar);
  const bank = aurel.points.reduce((a, b) => (Math.abs(a.bank) >= Math.abs(b.bank) ? a : b)).s;
  let widthStation = 0,
    widthChange = 0;
  for (let i = 1; i < coast.points.length; i++) {
    const change = Math.abs(coast.points[i].width - coast.points[i - 1].width);
    if (change > widthChange) {
      widthChange = change;
      widthStation = coast.points[i].s;
    }
  }
  const cases = [
    {
      name: 'aurel-straight-chunk-seam',
      track: aurel,
      station: 82,
      start: 0,
      end: 164,
      grazing: false,
    },
    {
      name: 'aurel-banked',
      track: aurel,
      station: bank,
      start: bank - 50,
      end: bank + 50,
      grazing: false,
    },
    {
      name: 'vellamar-width-changing',
      track: coast,
      station: widthStation,
      start: widthStation - 50,
      end: widthStation + 50,
      grazing: false,
    },
    {
      name: 'aurel-grazing-lap-seam',
      track: aurel,
      station: aurel.length,
      start: aurel.length - 50,
      end: aurel.length + 50,
      grazing: true,
    },
  ];
  const rows: {
    name: string;
    roadChunks: number;
    paintChunks: number;
    roadPixels: number;
    paintPixels: number;
    authoredLeftPaintPixels: number;
    authoredRightPaintPixels: number;
    litCompletedFrames: number;
    idCompletedFrames: number;
    postDisposeCompletedFrames: number;
    glError: number;
    idGlError: number;
    postDisposeGlError: number;
    image: string;
    idImage: string;
    baseline: ReturnType<typeof resources>;
    retained: ReturnType<typeof resources>;
    restored: ReturnType<typeof resources>;
    repeatDisposeUnchanged: boolean;
    allMeshesDisposed: boolean;
    station: number;
    bank: number;
    range: { start: number; end: number };
    geometryDigest: string;
    geometryUnchanged: boolean;
    shaderPaint: boolean;
    shaderRoadPaint: boolean;
    shaderRoadAsphalt: boolean;
    shaderPaintAsphalt: boolean;
  }[] = [];
  let failure: string | null = null,
    shaders: ReturnType<typeof h.shaders> | null = null;
  let current: ReturnType<typeof createFormulaSurfaceProbe> | undefined;
  // PBR's scene-owned BRDF LUT is infrastructure, not an adapter allocation.
  // Construct/dispose a PBR material before baseline so retained infrastructure
  // is counted consistently rather than mislabeled as an adapter texture leak.
  const warm = new PBRMaterial('baseline-PBR-infrastructure', h.scene);
  warm.dispose();
  const hashGeometry = async (meshes: readonly Mesh[]) => {
    const arrays = meshes.flatMap((mesh) => [
      mesh.getVerticesData('position'),
      mesh.getVerticesData('normal'),
      mesh.getVerticesData('uv'),
      mesh.getIndices(),
    ]);
    const bytes = new TextEncoder().encode(JSON.stringify(arrays));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  };
  try {
    for (const probe of cases) {
      const baseline = resources(h.scene),
        range = { start: probe.start, end: probe.end };
      let roadId: SurfaceIdOutput | undefined, paintId: SurfaceIdOutput | undefined;
      await h.gpu.prepare(`create ${probe.name}`, h.deadline, async (signal) => {
        signal.throwIfAborted();
        current = createFormulaSurfaceProbe(
          h.scene,
          probe.track,
          {
            discipline: 'formula',
            presentation: 'circuit',
            circuitId: probe.track.circuit.id as 'aurel' | 'vellamar',
          },
          range,
        );
        roadId = new SurfaceIdOutput(current.roadMaterial, false);
        paintId = new SurfaceIdOutput(current.paintMaterial, true);
        h.observe(current.roadMaterial);
        h.observe(current.paintMaterial);
      });
      const surface = current!;
      const p = probe.track.at(probe.station, trackPoint());
      const setback = probe.grazing ? 22 : 20,
        height = probe.grazing ? 1.15 : 12;
      camera.position.set(p.x - p.tx * setback, p.y + height, p.z - p.tz * setback);
      camera.setTarget(new Vector3(p.x + p.tx * 8, p.y + 0.006, p.z + p.tz * 8));
      const geometryDigest = await hashGeometry(surface.meshes);
      await prepare(h, surface.meshes);
      const before = h.gpu.diagnostics().completed;
      await h.presented();
      const lit = h.capture();
      const litCompletedFrames = h.gpu.diagnostics().completed - before,
        glError = h.gl.getError();
      await h.gpu.prepare(`ID output ${probe.name}`, h.deadline, async (signal) => {
        signal.throwIfAborted();
        roadId!.enabled = true;
        paintId!.enabled = true;
        h.scene.resetCachedMaterial();
      });
      const beforeId = h.gpu.diagnostics().completed;
      await h.presented();
      const id = h.capture();
      let roadPixels = 0,
        paintPixels = 0,
        authoredLeftPaintPixels = 0,
        authoredRightPaintPixels = 0;
      for (let y = 0; y < 768; y++)
        for (let x = 0; x < 1024; x++) {
          const i = (y * 1024 + x) * 4;
          if (id.pixels[i] === 255 && id.pixels[i + 1] === 255 && id.pixels[i + 2] === 0) {
            paintPixels++;
            authoredLeftPaintPixels++;
          }
          if (id.pixels[i] === 255 && id.pixels[i + 1] === 0 && id.pixels[i + 2] === 255) {
            paintPixels++;
            authoredRightPaintPixels++;
          }
          if (id.pixels[i] === 0 && id.pixels[i + 1] === 0 && id.pixels[i + 2] === 255)
            roadPixels++;
        }
      const idGlError = h.gl.getError(),
        idCompletedFrames = h.gpu.diagnostics().completed - beforeId;
      const retained = resources(h.scene),
        geometryUnchanged = geometryDigest === (await hashGeometry(surface.meshes));
      const shaderPaint = surface.paintMeshes.every((m) =>
        m.subMeshes[0]?.effect?._fragmentSourceCode.includes('float finishFilteredNoise'),
      );
      const shaderRoadPaint = surface.roadMeshes.some((m) =>
        m.subMeshes[0]?.effect?._fragmentSourceCode.includes('float finishFilteredNoise'),
      );
      const shaderRoadAsphalt = surface.roadMeshes.every((m) =>
        m.subMeshes[0]?.effect?._fragmentSourceCode.includes('float asphaltSubstrateMicro;'),
      );
      const shaderPaintAsphalt = surface.paintMeshes.some((m) =>
        m.subMeshes[0]?.effect?._fragmentSourceCode.includes('float asphaltSubstrateMicro;'),
      );
      const roadChunks = surface.roadMeshes.length,
        paintChunks = surface.paintMeshes.length;
      await h.gpu.prepare(`dispose ${probe.name}`, h.deadline, async (signal) => {
        signal.throwIfAborted();
        surface.dispose();
      });
      const allMeshesDisposed = surface.meshes.every((m) => m.isDisposed()),
        restored = resources(h.scene);
      surface.dispose();
      const repeatDisposeUnchanged =
        JSON.stringify(restored) === JSON.stringify(resources(h.scene));
      current = undefined;
      const beforeDisposed = h.gpu.diagnostics().completed;
      await h.presented();
      rows.push({
        name: probe.name,
        roadChunks,
        paintChunks,
        roadPixels,
        paintPixels,
        authoredLeftPaintPixels,
        authoredRightPaintPixels,
        litCompletedFrames,
        idCompletedFrames,
        postDisposeCompletedFrames: h.gpu.diagnostics().completed - beforeDisposed,
        glError,
        idGlError,
        postDisposeGlError: h.gl.getError(),
        image: lit.image,
        idImage: id.image,
        baseline,
        retained,
        restored,
        repeatDisposeUnchanged,
        allMeshesDisposed,
        station: probe.station,
        bank: p.bank,
        range,
        geometryDigest,
        geometryUnchanged,
        shaderPaint,
        shaderRoadPaint,
        shaderRoadAsphalt,
        shaderPaintAsphalt,
      });
    }
  } catch (error) {
    failure = message(error);
  }
  const diagnostics = h.gpu.diagnostics();
  try {
    shaders = h.shaders(!!failure);
  } catch (error) {
    failure ??= message(error);
  }
  // On failure never dispose the partial adapter while its lane may still own
  // compilation. Stop/invalidate that owner first, then let the scene tear down
  // all resources; h.dispose continues even if an individual disposer throws.
  for (const cleanup of [() => h.dispose()]) {
    try {
      cleanup();
    } catch (error) {
      failure ??= message(error);
    }
  }
  return {
    failure,
    rows,
    shaders,
    diagnostics,
    productionActivated: false,
    scope: 'Original Formula ribbons, edge-paint finish and procedural dry asphalt substrate',
    sideEncoding: 'road blue; authored side -1 yellow; authored side +1 magenta',
    seamEvidence:
      'Exact geometry is covered by byte-oracle tests; these counts establish visibility, not seam continuity. Inspect retained lit and ID images.',
    unported: [
      'scanned asphalt',
      'road macro/detail and rubber wear',
      'wet road/water film',
      'PBR/environment parity',
      'car grounding',
      'light pools',
      'pit lanes',
      'kerbs',
      'runoff',
      'terrain',
    ],
  };
}

type LiveGroundingBind = {
  mesh: Mesh;
  effect: Effect;
  buffer: DataBuffer | null;
  notifications: number;
};
const groundingShaderAnchors = [
  'highp int formulaGroundingCount;',
  'vec4 formulaGroundingPose[12];',
  'float formulaGround= formulaGrounding(vPositionW);',
  'finalDiffuse=finalDiffuse*formulaDirect+formulaSkyDiffuse*(formulaIndirect-formulaDirect);',
  'finalSpecularScaled=finalSpecularScaled*formulaDirect+formulaSkySpecular*(formulaIndirect-formulaDirect);',
  'finalAmbient*=formulaIndirect;',
];
/** Inspection is only called after completed draws under the existing GPU lease.
 * onBind receipts retain real draw objects; driver metadata locates UBO bytes
 * or actual standalone uniforms, never plugin-private CPU state or fabricated
 * effect identities. The native Mac UBO exclusion is never overridden. */
async function liveGroundingReceipt(
  h: ReturnType<typeof harness>,
  view: BabylonCircuitScene,
  binds: Map<PBRMaterial, LiveGroundingBind>,
  bindings: Map<DataBuffer, Set<number>>,
  frame: Float32Array,
) {
  let result:
    | {
        expected: number[];
        receivers: {
          transport: 'ubo' | 'standalone';
          surface: string;
          notifications: number;
          count: number;
          poses: number[];
          block: number | null;
          binding: number | null;
          byteLength: number | null;
          countOffset: number | null;
          poseOffset: number | null;
          poseStride: number | null;
          countType: number;
          poseType: number;
          poseSize: number;
        }[];
        completedSequence: number;
        completedFrames: number;
      }
    | undefined;
  await h.gpu.prepare('inspect completed live grounding uniforms', h.deadline, async (signal) => {
    signal.throwIfAborted();
    const gl = h.gl;
    const previous =
      h.transport === 'ubo'
        ? (gl.getParameter(gl.UNIFORM_BUFFER_BINDING) as WebGLBuffer | null)
        : null;
    try {
      const root = view.entrants[0];
      const pose = writeFormulaGroundingPose(
        frame,
        carBase(0),
        root.position,
        root.rotationQuaternion!,
        { x: 0, y: 0, z: 0, w: 0 },
      );
      const expected = [pose.x, pose.y, pose.z, pose.w].map(Math.fround);
      const receivers = [...binds].map(([material, receipt]) => {
        const { mesh, effect, buffer, notifications } = receipt;
        if (
          view.scene.isDisposed ||
          mesh.isDisposed() ||
          !view.scene.materials.includes(material) ||
          mesh.material !== material ||
          !mesh.subMeshes.some((submesh) => submesh.effect === effect) ||
          (material._uniformBuffer.getBuffer() ?? null) !== buffer ||
          material._uniformBuffer.useUbo !== (h.transport === 'ubo') ||
          material._uniformBuffer.currentEffect !== effect ||
          (h.transport === 'ubo' ? !buffer?.underlyingResource : buffer !== null)
        )
          throw new Error('Stale live grounding bind receipt');
        const program = (effect.getPipelineContext() as WebGLPipelineContext | null)?.program;
        if (!program || !gl.isProgram(program) || !gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error('Live grounding program was not linked');
        if (h.transport === 'standalone') {
          const indices = Array.from(
            { length: gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number },
            (_, index) => index,
          );
          const find = (name: string) => {
            const index = indices.find((i) => gl.getActiveUniform(program, i)?.name === name);
            if (index === undefined)
              throw new Error('Live standalone grounding uniform absent: ' + name);
            return index;
          };
          const countIndex = find('formulaGroundingCount');
          const poseIndex = find('formulaGroundingPose[0]');
          const countInfo = gl.getActiveUniform(program, countIndex)!;
          const poseInfo = gl.getActiveUniform(program, poseIndex)!;
          const blocks = gl.getActiveUniforms(
            program,
            [countIndex, poseIndex],
            gl.UNIFORM_BLOCK_INDEX,
          ) as number[];
          if (
            countInfo.type !== gl.INT ||
            countInfo.size !== 1 ||
            poseInfo.type !== gl.FLOAT_VEC4 ||
            poseInfo.size !== 12 ||
            blocks.some((block) => block !== -1 && block !== gl.INVALID_INDEX)
          )
            throw new Error('Unexpected live grounding standalone uniform layout');
          const location = (name: string) => {
            const value = gl.getUniformLocation(program, name);
            if (value === null) throw new Error('Live grounding uniform location absent: ' + name);
            return value;
          };
          const count = gl.getUniform(program, location('formulaGroundingCount')) as number;
          const poses = Array.from({ length: 12 }, (_, i) => {
            const value = gl.getUniform(
              program,
              location(`formulaGroundingPose[${i}]`),
            ) as Float32Array;
            if (!(value instanceof Float32Array) || value.length !== 4)
              throw new Error('Live grounding standalone pose is not vec4');
            return Array.from(value);
          }).flat();
          return {
            transport: h.transport,
            surface: mesh.metadata.surface as string,
            notifications,
            count,
            poses,
            block: null,
            binding: null,
            byteLength: null,
            countOffset: null,
            poseOffset: null,
            poseStride: null,
            countType: countInfo.type,
            poseType: poseInfo.type,
            poseSize: poseInfo.size,
          };
        }
        if (!buffer) throw new Error('Live grounding UBO buffer absent');
        const block = gl.getUniformBlockIndex(program, 'Material');
        if (block === gl.INVALID_INDEX) throw new Error('Live grounding Material block absent');
        const binding = gl.getActiveUniformBlockParameter(
          program,
          block,
          gl.UNIFORM_BLOCK_BINDING,
        ) as number;
        if (!bindings.get(buffer)?.has(binding) || !gl.isBuffer(buffer.underlyingResource))
          throw new Error('Live grounding UBO lacks actual native binding receipt');
        const indices = Array.from(
          gl.getActiveUniformBlockParameter(
            program,
            block,
            gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,
          ) as Uint32Array,
        );
        const find = (suffix: string) => {
          const index = indices.find((index) => {
            const name = gl.getActiveUniform(program, index)?.name;
            return name === suffix || name?.endsWith('.' + suffix);
          });
          if (index === undefined) throw new Error('Live grounding uniform absent: ' + suffix);
          return index;
        };
        const countIndex = find('formulaGroundingCount'),
          poseIndex = find('formulaGroundingPose[0]');
        const countInfo = gl.getActiveUniform(program, countIndex)!;
        const poseInfo = gl.getActiveUniform(program, poseIndex)!;
        const offsets = gl.getActiveUniforms(
          program,
          [countIndex, poseIndex],
          gl.UNIFORM_OFFSET,
        ) as number[];
        const strides = gl.getActiveUniforms(
          program,
          [poseIndex],
          gl.UNIFORM_ARRAY_STRIDE,
        ) as number[];
        const byteLength = gl.getActiveUniformBlockParameter(
          program,
          block,
          gl.UNIFORM_BLOCK_DATA_SIZE,
        ) as number;
        if (
          countInfo.type !== gl.INT ||
          countInfo.size !== 1 ||
          poseInfo.type !== gl.FLOAT_VEC4 ||
          poseInfo.size !== 12 ||
          strides[0] !== 16 ||
          offsets.some((offset) => !Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) ||
          offsets[0] + 4 > byteLength ||
          offsets[1] + 12 * strides[0] > byteLength
        )
          throw new Error('Unexpected live grounding driver UBO layout');
        gl.bindBuffer(gl.UNIFORM_BUFFER, buffer.underlyingResource);
        if (gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE) < byteLength)
          throw new Error('Live grounding GPU buffer is too short');
        const bytes = new ArrayBuffer(byteLength);
        gl.getBufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(bytes));
        const count = new Int32Array(bytes, offsets[0], 1)[0];
        const poses = Array.from(new Float32Array(bytes, offsets[1], 48));
        return {
          transport: h.transport,
          surface: mesh.metadata.surface as string,
          notifications,
          count,
          poses,
          block,
          binding,
          byteLength,
          countOffset: offsets[0],
          poseOffset: offsets[1],
          poseStride: strides[0],
          countType: countInfo.type,
          poseType: poseInfo.type,
          poseSize: poseInfo.size,
        };
      });
      if (receivers.length !== 2 || new Set(receivers.map((r) => r.surface)).size !== 2)
        throw new Error('Both live grounding receiver materials must actually bind');
      result = {
        expected,
        receivers,
        completedSequence: h.gpu.diagnostics().lastCompletedSequence,
        completedFrames: h.gpu.diagnostics().completed,
      };
    } finally {
      if (h.transport === 'ubo') gl.bindBuffer(gl.UNIFORM_BUFFER, previous);
    }
  });
  if (!result) throw new Error('Missing live grounding GPU receipt');
  return result;
}
function liveGeometrySnapshot(scene: Scene) {
  return scene.meshes.map((mesh) => {
    if (!(mesh instanceof Mesh)) throw new Error('Unexpected non-Mesh in original Formula scene');
    const kinds = mesh.getVerticesDataKinds().sort();
    return {
      kinds,
      vertices: kinds.map((kind) => Array.from(mesh.getVerticesData(kind)!)),
      indices: Array.from(mesh.getIndices()!),
    };
  });
}
function sameLiveGeometry(
  before: ReturnType<typeof liveGeometrySnapshot>,
  after: ReturnType<typeof liveGeometrySnapshot>,
) {
  const equal = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return (
    before.length === after.length &&
    before.every(
      (mesh, i) =>
        mesh.kinds.length === after[i].kinds.length &&
        mesh.kinds.every((kind, j) => kind === after[i].kinds[j]) &&
        mesh.vertices.every((values, j) => equal(values, after[i].vertices[j])) &&
        equal(mesh.indices, after[i].indices),
    )
  );
}

/** Full workload through the actual live scene/readiness classes. The real
 * /babylon.html journey selects Aurel; Vellamar is qualified here without a
 * hidden production query parameter or fabricated route diagnostics. */
export async function babylonFullFormulaScenes(forceStandalone = false) {
  const rows: {
    transport: 'ubo' | 'standalone';
    circuit: string;
    surfaces: BabylonCircuitScene['surfaceDiagnostics'];
    resources: ReturnType<typeof resources>;
    restored: ReturnType<typeof resources>;
    completedFrames: number;
    preparationVariants: number;
    asphaltShaderChunks: number;
    paintAsphaltShaderChunks: number;
    grounding: {
      initial: Awaited<ReturnType<typeof liveGroundingReceipt>>;
      moved: Awaited<ReturnType<typeof liveGroundingReceipt>>;
      appliedRoadChunks: number;
      appliedPaintChunks: number;
      effectsStable: boolean;
      resourcesStable: boolean;
      geometryStable: boolean;
      movedImage: string;
      glErrorAfterMove: number;
    };
    glError: number;
    disposeGlError: number;
    diagnostics: ReturnType<BabylonPresentationGpu['diagnostics']>;
    image: string;
    shaders: ReturnType<ReturnType<typeof harness>['shaders']>;
  }[] = [];
  let failure: string | null = null;
  let failureEvidence: {
    circuit: string;
    shaders: ReturnType<ReturnType<typeof harness>['shaders']>;
    diagnostics: ReturnType<BabylonPresentationGpu['diagnostics']>;
    resources: ReturnType<typeof resources>;
  } | null = null;
  for (const circuit of ['aurel', 'vellamar'] as const) {
    let h: ReturnType<typeof harness> | undefined;
    let restoreBinding: (() => void) | undefined;
    try {
      const host = new SimulationComponent({
        ...DEFAULT_OPTIONS,
        circuit,
        mode: 'practice',
        opponents: 0,
      });
      let view!: BabylonCircuitScene;
      h = harness(
        1024,
        768,
        (engine) => {
          view = new BabylonCircuitScene(engine, host.simulation.track, 1, {
            presentation: 'circuit',
            vehicles: host.simulation.cars.map((car) => car.definition),
          });
          return view.scene;
        },
        forceStandalone,
      );
      const binds = new Map<PBRMaterial, LiveGroundingBind>();
      const bindings = new Map<DataBuffer, Set<number>>();
      // Forward every native binding unchanged; observe arguments only, with no
      // driver query during a draw. This engine is private to this fixture.
      const engine = h.engine;
      const nativeBind = engine.bindUniformBufferBase;
      const bindingDescriptor = Object.getOwnPropertyDescriptor(engine, 'bindUniformBufferBase');
      restoreBinding = () => {
        if (bindingDescriptor)
          Object.defineProperty(engine, 'bindUniformBufferBase', bindingDescriptor);
        else Reflect.deleteProperty(engine, 'bindUniformBufferBase');
      };
      engine.bindUniformBufferBase = function (
        this: Engine,
        ...args: Parameters<Engine['bindUniformBufferBase']>
      ) {
        const result = nativeBind.apply(this, args);
        const [buffer, location, name] = args;
        if (name === 'Material') {
          const locations = bindings.get(buffer) ?? new Set<number>();
          locations.add(location);
          bindings.set(buffer, locations);
        }
        return result;
      };
      for (const material of view.scene.materials) {
        h.observe(material);
        if (
          material instanceof PBRMaterial &&
          material.pluginManager?.getPlugin('OriginalFormulaGrounding')
        )
          material.onBindObservable.add((mesh) => {
            const effect = mesh?.subMeshes[0]?.effect,
              buffer = material._uniformBuffer.getBuffer() ?? null;
            if (!(mesh instanceof Mesh) || !effect || (h!.transport === 'ubo' && !buffer))
              throw new Error('Live grounding bound without effect or required UBO');
            binds.set(material, {
              mesh,
              effect,
              buffer,
              notifications: (binds.get(material)?.notifications ?? 0) + 1,
            });
          });
      }
      const ready = new SurfacePreparation(
        view.scene,
        view.scene.meshes,
        h.gpu,
        h.schedule,
        h.abort.signal,
        h.deadline,
      );
      let completed = false,
        preparationFailure: unknown;
      void ready.completion.then(
        () => {
          completed = true;
        },
        (error) => {
          preparationFailure = error;
        },
      );
      // Same gate as main: compile gaps never submit normal scene draws.
      const schedule = h.schedule;
      const finish = schedule.prepare();
      const baselineCompleted = h.gpu.diagnostics().completed;
      try {
        while (!completed) {
          h.abort.signal.throwIfAborted();
          if (preparationFailure) throw preparationFailure;
          const idle = h.gpu.ready();
          await Promise.resolve();
          if (ready.completed) {
            await ready.completion;
            completed = true;
            break;
          }
          if (idle && ready.canDraw)
            h.gpu.frame(schedule, false, view.scene, () => {
              const before = view.scene.isReady();
              h!.engine.beginFrame();
              view.render(host.frame);
              h!.engine.endFrame();
              const after = view.scene.isReady();
              schedule.rendered(before, after);
              return before && after;
            });
          await yieldPreparationTurn(h.abort.signal, h.deadline);
        }
        await ready.completion;
      } finally {
        finish();
      }
      if (!ready.completed) throw new Error('Full scene did not complete readiness');
      const capture = h.capture(),
        surfaces = view.surfaceDiagnostics,
        retained = resources(view.scene),
        glError = h.gl.getError();
      // Preserve original preparation receipt before test-only inspection leases.
      const preparationVariants = h.gpu.diagnostics().preparation.completed;
      const initial = await liveGroundingReceipt(h, view, binds, bindings, host.frame);
      const receivers = view.scene.meshes.filter(
        (mesh) => mesh.metadata?.surface === 'road' || mesh.metadata?.surface === 'edge-paint',
      );
      const effects = receivers.map((mesh) => mesh.subMeshes.map((submesh) => submesh.effect));
      if (effects.some((list) => !list.length || list.some((effect) => !effect)))
        throw new Error('Missing prepared live receiver effect');
      const applied = (surface: string) =>
        receivers.filter(
          (mesh) =>
            mesh.metadata.surface === surface &&
            mesh.subMeshes.every((submesh) =>
              groundingShaderAnchors.every((anchor) =>
                submesh.effect!._fragmentSourceCode.includes(anchor),
              ),
            ),
        ).length;
      const appliedRoadChunks = applied('road'),
        appliedPaintChunks = applied('edge-paint');
      const geometry = liveGeometrySnapshot(view.scene);
      const retainedObjects = [
        ...view.scene.meshes,
        ...view.scene.geometries,
        ...view.scene.materials,
        ...view.scene.textures,
      ];
      // Synthetic presentation-only movement. Never modify the simulation frame,
      // solver, model, receiver geometry or original qualification oracle.
      const movedFrame = host.frame.slice(),
        offset = carBase(0);
      movedFrame[offset + F.X] += 3;
      movedFrame[offset + F.Z] += 2;
      const q = Quaternion.RotationAxis(Vector3.Up(), 0.65).multiply(
        view.entrants[0].rotationQuaternion!,
      );
      movedFrame.set([q.x, q.y, q.z, q.w], offset + F.QX);
      await h.presented(() => view.render(movedFrame));
      const moved = await liveGroundingReceipt(h, view, binds, bindings, movedFrame);
      const currentObjects = [
        ...view.scene.meshes,
        ...view.scene.geometries,
        ...view.scene.materials,
        ...view.scene.textures,
      ];
      const grounding = {
        initial,
        moved,
        appliedRoadChunks,
        appliedPaintChunks,
        effectsStable: receivers.every(
          (mesh, i) =>
            mesh.subMeshes.length === effects[i].length &&
            mesh.subMeshes.every((submesh, j) => submesh.effect === effects[i][j]),
        ),
        resourcesStable:
          retainedObjects.length === currentObjects.length &&
          retainedObjects.every((object, i) => object === currentObjects[i]),
        geometryStable: sameLiveGeometry(geometry, liveGeometrySnapshot(view.scene)),
        movedImage: h.capture().image,
        glErrorAfterMove: h.gl.getError(),
      };
      const beforeDispose = h.gpu.diagnostics();
      const shaders = h.shaders(false);
      const asphaltShaderChunks = view.scene.meshes.filter(
        (mesh) =>
          mesh.metadata?.surface === 'road' &&
          mesh.subMeshes[0]?.effect?._fragmentSourceCode.includes('float asphaltSubstrateMicro;'),
      ).length;
      const paintAsphaltShaderChunks = view.scene.meshes.filter(
        (mesh) =>
          mesh.metadata?.surface === 'edge-paint' &&
          mesh.subMeshes[0]?.effect?._fragmentSourceCode.includes('float asphaltSubstrateMicro;'),
      ).length;
      await h.gpu.prepare(`dispose full ${circuit}`, h.deadline, async (signal) => {
        signal.throwIfAborted();
        view.dispose();
      });
      rows.push({
        transport: h.transport,
        circuit,
        surfaces,
        resources: retained,
        restored: resources(view.scene),
        completedFrames: beforeDispose.completed - baselineCompleted,
        preparationVariants,
        grounding,
        asphaltShaderChunks,
        paintAsphaltShaderChunks,
        glError,
        disposeGlError: h.gl.getError(),
        diagnostics: h.gpu.diagnostics(),
        image: capture.image,
        shaders,
      });
    } catch (error) {
      failure = message(error);
      if (h)
        failureEvidence = {
          circuit,
          shaders: h.shaders(true),
          diagnostics: h.gpu.diagnostics(),
          resources: resources(h.scene),
        };
    } finally {
      try {
        try {
          restoreBinding?.();
        } finally {
          h?.dispose();
        }
      } catch (error) {
        failure ??= message(error);
      }
    }
    if (failure) break;
  }
  return {
    rows,
    forceStandalone,
    failure,
    failureEvidence,
    scope:
      'Full actual BabylonCircuitScene and SurfacePreparation with dry asphalt and live Formula grounding; synthetic pose movement is renderer-only evidence, not simulation acceptance; no wet/scanned/road-state, light pools or PBR/environment parity',
  };
}
