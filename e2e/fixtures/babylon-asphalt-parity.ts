import * as THREE from 'three';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import { createAsphaltSubstrate } from '../../src/engine/babylon/asphalt-substrate.ts';
import { BabylonPresentationGpu } from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import { yieldPreparationTurn } from '../../src/engine/babylon/asset-preparation.ts';
import {
  createSurfaceProbeHarness,
  surfaceProbeResources,
  prepareSurfaceProbeMeshes,
} from './babylon-surface-parity.ts';
import {
  ASPHALT_OUTPUTS,
  ASPHALT_PARITY_LIMITS,
  ASPHALT_VIEWS,
  createAsphaltReference,
  type AsphaltControl,
  type AsphaltOutput,
} from './asphalt-reference.ts';
import { compareAsphaltPixels } from './asphalt-parity-metrics.ts';

/** Probe output reads the actual candidate prelighting values, not a second
 * implementation of the reference. PBR/environment/tone curves are bypassed.
 * Roughness is captured from the actual native input after the substrate hook,
 * before Babylon's renderer-side clamp, not from a candidate-private scalar.
 * Exported only so source contracts can exercise actual plugin composition. */
export class AsphaltFactorOutput extends MaterialPluginBase {
  mode = 0;
  constructor(material: PBRMaterial) {
    super(
      material,
      'IsolatedAsphaltFactorOutput',
      300,
      { ASPHALT_FACTOR_OUTPUT_V1: true },
      true,
      false,
    );
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getUniforms() {
    return {
      ubo: [{ name: 'asphaltProbeOutput', size: 1, type: 'float' }],
      fragment: 'uniform float asphaltProbeOutput;',
    };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('asphaltProbeOutput', this.mode);
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: 'vec3 asphaltProbeAlbedo; float asphaltProbeRoughness;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: 'asphaltProbeAlbedo=surfaceAlbedo;',
          CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: 'asphaltProbeRoughness=metallicRoughness.g;',
          CUSTOM_FRAGMENT_MAIN_END: `vec3 asphaltProbeValue=asphaltProbeOutput<.5 ? asphaltProbeAlbedo*4.0
            : asphaltProbeOutput<1.5 ? vec3(asphaltProbeRoughness*.5)
            : normalize(mat3(asphaltSubstrateView)*normalW)*.5+.5;
            gl_FragColor=vec4(asphaltProbeValue,1.0);`,
        }
      : null;
  }
}

type View = (typeof ASPHALT_VIEWS)[number];
/** Identical Float32 vertex input and continuous metre UVs, including the seam. */
function planes(view: View) {
  const e = view.extent;
  return (
    view.split
      ? [
          [-e, 0],
          [0, e],
        ]
      : [[-e, e]]
  ).map(([left, right]) => ({
    positions: new Float32Array([left, 0, -e, right, 0, -e, right, 0, e, left, 0, e]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([left / 5, -e / 5, right / 5, -e / 5, right / 5, e / 5, left / 5, e / 5]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  }));
}
const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
type Metrics = ReturnType<typeof compareAsphaltPixels>;
type ReferenceRow = {
  name: string;
  output: AsphaltOutput;
  metrics: Metrics;
  image: string;
  completedFrames: number;
  repeatCompletedFrames: number;
  glError: number;
};
type ControlRow = {
  name: AsphaltControl;
  output: AsphaltOutput;
  metrics: Metrics;
  image: string;
  completedFrames: number;
  glError: number;
};
type CandidateRow = {
  name: string;
  output: AsphaltOutput;
  metrics: Metrics;
  image: string;
  completedFrames: number;
  glError: number;
  sharedMaterial: boolean;
  retained: ReturnType<typeof surfaceProbeResources>;
  samplers: string[];
};
type Allocation = {
  internalFormat: number;
  width: number;
  height: number;
  format: number;
  type: number;
  bytes: number;
};

export async function babylonControlledAsphaltParity() {
  const size = 256,
    h = createSurfaceProbeHarness(size, size);
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
      h.abort.abort(new Error('Actual original asphalt reference lost WebGL context'));
    },
    { signal: h.abort.signal },
  );
  const scene = new THREE.Scene();
  const camera = new UniversalCamera('isolated-asphalt', new Vector3(0, 1.2, 1.4), h.scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 500;
  const threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const setCamera = (view: View) => {
    const [x, y, z] = view.centre,
      [ex, ey, ez] = view.eye,
      half = 1.3 * view.extent;
    threeCamera.position.set(x + ex, y + ey, z + ez);
    threeCamera.lookAt(x, y, z);
    threeCamera.left = -half;
    threeCamera.right = half;
    threeCamera.top = half;
    threeCamera.bottom = -half;
    threeCamera.updateProjectionMatrix();
    camera.position.set(x + ex, y + ey, z + ez);
    camera.setTarget(new Vector3(x, y, z));
    camera.orthoLeft = -half;
    camera.orthoRight = half;
    camera.orthoTop = half;
    camera.orthoBottom = -half;
  };
  const threeMeshes: THREE.Mesh[] = [],
    meshes: Mesh[] = [];
  const clearThree = () => {
    for (const mesh of threeMeshes.splice(0)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
  };
  const setThreeGeometry = (view: View, material: THREE.Material) => {
    clearThree();
    setCamera(view);
    for (const data of planes(view)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.fromArray(view.centre);
      mesh.rotation.z = view.bank;
      scene.add(mesh);
      threeMeshes.push(mesh);
    }
  };
  const captureThree = async () => {
    const before = threeGpu.diagnostics().completed;
    while (threeGpu.diagnostics().completed < before + 2) {
      h.abort.signal.throwIfAborted();
      threeGpu.ready();
      if (threeGpu.diagnostics().completed >= before + 2) break;
      threeGpu.frame(schedule, false, scene, () => {
        renderer.render(scene, threeCamera);
        return true;
      });
      await yieldPreparationTurn(h.abort.signal, h.deadline);
    }
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels,
      image: canvas.toDataURL('image/png'),
      completedFrames: threeGpu.diagnostics().completed - before,
      glError: gl.getError(),
    };
  };
  const referenceRows: ReferenceRow[] = [],
    controls: ControlRow[] = [],
    rows: CandidateRow[] = [];
  const referencePixels = new Map<string, Uint8Array>();
  const phases: string[] = [],
    allocations: Allocation[] = [];
  let failure: string | null = null,
    referenceQualified = false,
    candidateConstructed = false;
  let owner: ReturnType<typeof createAsphaltSubstrate> | undefined;
  let reference: ReturnType<typeof createAsphaltReference> | undefined;
  let shaders: ReturnType<typeof h.shaders> | null = null;
  let sampling: object[] = [];
  let repeatDisposeUnchanged = false;
  const warm = new PBRMaterial('scene-owned-reference-infrastructure', h.scene);
  warm.dispose();
  const baseline = surfaceProbeResources(h.scene);
  let restored = baseline;
  try {
    phases.push('original-reference');
    reference = createAsphaltReference();
    for (const view of ASPHALT_VIEWS) {
      setThreeGeometry(view, reference.material);
      await threeGpu.prepare(`original asphalt ${view.name}`, h.deadline, async () => {
        await renderer.compileAsync(scene, threeCamera);
      });
      for (const output of ASPHALT_OUTPUTS) {
        reference.setOutput(output);
        const expected = await captureThree(),
          repeat = await captureThree();
        const metrics = compareAsphaltPixels(repeat.pixels, expected.pixels, size);
        referenceRows.push({
          name: view.name,
          output,
          metrics,
          image: expected.image,
          completedFrames: expected.completedFrames,
          repeatCompletedFrames: repeat.completedFrames,
          glError: expected.glError || repeat.glError,
        });
        referencePixels.set(`${view.name}/${output}`, expected.pixels);
        if (
          expected.glError ||
          repeat.glError ||
          threeShaderErrors.length ||
          metrics.comparedPixels < ASPHALT_PARITY_LIMITS.minInteriorPixels ||
          metrics.maxChannelError > ASPHALT_PARITY_LIMITS.referenceMax ||
          metrics.meanChannelError > ASPHALT_PARITY_LIMITS.referenceMean ||
          metrics.alphaMismatchPixels
        )
          throw new Error(`Actual original asphalt repeat did not qualify: ${view.name}/${output}`);
      }
    }
    clearThree();
    reference.dispose();
    reference = undefined;
    phases.push('original-negative-controls');
    for (const [control, output] of [
      ['wrong-gamma', 'albedo'],
      ['wrong-packed-channel', 'roughness'],
      ['flipped-normal', 'normal'],
      ['omitted-meso-tone', 'albedo'],
    ] as const) {
      reference = createAsphaltReference(control);
      setThreeGeometry(ASPHALT_VIEWS[0], reference.material);
      reference.setOutput(output);
      await threeGpu.prepare(`original asphalt control ${control}`, h.deadline, async () => {
        await renderer.compileAsync(scene, threeCamera);
      });
      const actual = await captureThree();
      const metrics = compareAsphaltPixels(
        actual.pixels,
        referencePixels.get(`near-glints/${output}`)!,
        size,
      );
      controls.push({
        name: control,
        output,
        metrics,
        image: actual.image,
        completedFrames: actual.completedFrames,
        glError: actual.glError,
      });
      if (
        actual.glError ||
        threeShaderErrors.length ||
        metrics.missingInteriorPixels ||
        metrics.excessCoveragePixels ||
        metrics.comparedPixels < ASPHALT_PARITY_LIMITS.minInteriorPixels ||
        metrics.changedPixels < ASPHALT_PARITY_LIMITS.negativeMinChangedPixels ||
        metrics.maxChannelError < ASPHALT_PARITY_LIMITS.negativeMinMaxError
      )
        throw new Error(`Original asphalt negative control not discriminating: ${control}`);
      clearThree();
      reference.dispose();
      reference = undefined;
    }
    // No candidate is allocated, rendered or measured until every independent
    // reference repeat and deliberate damaged-source control has qualified.
    referenceQualified = true;
    phases.push('reference-qualified');
    await h.gpu.prepare('isolated asphalt exact original allocation', h.deadline, async () => {
      const original = h.gl.texImage2D,
        descriptor = Object.getOwnPropertyDescriptor(h.gl, 'texImage2D');
      h.gl.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
        if (args.length >= 9 && args[3] === 512 && args[4] === 512 && ArrayBuffer.isView(args[8]))
          allocations.push({
            internalFormat: args[2] as number,
            width: 512,
            height: 512,
            format: args[6] as number,
            type: args[7] as number,
            bytes: args[8].byteLength,
          });
        Reflect.apply(original, this, args);
      } as typeof h.gl.texImage2D;
      try {
        owner = createAsphaltSubstrate(h.scene);
        candidateConstructed = true;
      } finally {
        if (descriptor) Object.defineProperty(h.gl, 'texImage2D', descriptor);
        else delete (h.gl as Partial<WebGL2RenderingContext>).texImage2D;
      }
    });
    const surface = owner!;
    phases.push('candidate');
    const outputPlugin = new AsphaltFactorOutput(surface.material);
    h.observe(surface.material);
    sampling = Object.entries(surface.textures).map(([name, texture]) => ({
      name,
      srgb: texture.getInternalTexture()?._useSRGBBuffer,
      gammaSpace: texture.gammaSpace,
      repeat: [texture.uScale, texture.vScale],
      anisotropy: texture.anisotropicFilteringLevel,
      flipY: texture.getInternalTexture()?.invertY,
      mipmaps: texture.getInternalTexture()?.generateMipMaps,
      samplingMode: texture.samplingMode,
    }));
    for (const view of ASPHALT_VIEWS) {
      setCamera(view);
      for (const data of planes(view)) {
        const mesh = new Mesh(`isolated-${view.name}`, h.scene),
          vertex = new VertexData();
        vertex.positions = data.positions;
        vertex.normals = data.normals;
        vertex.uvs = data.uvs;
        vertex.indices = data.indices;
        vertex.applyToMesh(mesh);
        mesh.position.set(view.centre[0], view.centre[1], view.centre[2]);
        mesh.rotation.z = view.bank;
        mesh.material = surface.material;
        meshes.push(mesh);
      }
      await prepareSurfaceProbeMeshes(h, meshes);
      for (const output of ASPHALT_OUTPUTS) {
        outputPlugin.mode = ASPHALT_OUTPUTS.indexOf(output);
        const before = h.gpu.diagnostics().completed;
        await h.presented();
        const actual = h.capture(),
          effect = meshes[0]?.subMeshes[0]?.effect;
        if (!effect) throw new Error(`Missing original asphalt effect: ${view.name}/${output}`);
        rows.push({
          name: view.name,
          output,
          metrics: compareAsphaltPixels(
            actual.pixels,
            referencePixels.get(`${view.name}/${output}`)!,
            size,
          ),
          image: actual.image,
          completedFrames: h.gpu.diagnostics().completed - before,
          glError: h.gl.getError(),
          sharedMaterial: meshes.every((m) => m.material === surface.material),
          retained: surfaceProbeResources(h.scene),
          samplers: [...effect.getSamplers()],
        });
      }
      for (const mesh of meshes.splice(0)) mesh.dispose();
    }
    surface.dispose();
    restored = surfaceProbeResources(h.scene);
    surface.dispose();
    repeatDisposeUnchanged =
      JSON.stringify(surfaceProbeResources(h.scene)) === JSON.stringify(restored);
    phases.push('disposed');
  } catch (error) {
    failure = message(error);
  }
  const diagnostics = { babylon: h.gpu.diagnostics(), three: threeGpu.diagnostics() };
  try {
    shaders = h.shaders(!!failure);
  } catch (error) {
    failure ??= message(error);
  }
  // Capture only cached diagnostics before cleanup; never perform fresh driver
  // queries when a compiler/presentation deadline may have poisoned a context.
  for (const cleanup of [
    () => threeGpu.dispose(),
    () => clearThree(),
    () => reference?.dispose(),
    () => {
      for (const mesh of meshes.splice(0)) mesh.dispose();
    },
    () => owner?.dispose(),
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
    phases,
    referenceQualified,
    candidateConstructed,
    referenceRows,
    controls,
    rows,
    allocations,
    sampling,
    shaders,
    threeShaderErrors,
    threeRevision: THREE.REVISION,
    limits: ASPHALT_PARITY_LIMITS,
    baseline,
    restored,
    repeatDisposeUnchanged,
    diagnostics,
    encoding:
      'RGBA8: original linear albedo * 4; pre-clamp roughness * 0.5; view normal * 0.5 + 0.5',
    sourceBoundary: "surfaceMaterial('asphalt', undefined, false)",
    productionActivated: false,
    unported: [
      'scanned asphalt',
      'road macro/detail and rubber wear',
      'wet road/water film',
      'car grounding',
      'light pools',
      'complete four-mode presentation',
      'PBR/environment parity',
    ],
  };
}
