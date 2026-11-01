import * as THREE from 'three';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import {
  FormulaGroundingPoses,
  FormulaGroundingPlugin,
} from '../../src/engine/babylon/formula-grounding.ts';
import { createAsphaltSubstrate } from '../../src/engine/babylon/asphalt-substrate.ts';
import {
  CircuitPaintFinishPlugin,
  circuitPaintLinearChannel,
} from '../../src/engine/babylon/circuit-paint-finish.ts';
import { BabylonPresentationGpu } from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import { yieldPreparationTurn } from '../../src/engine/babylon/asset-preparation.ts';
import { StudioFrame, studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import {
  createSurfaceProbeHarness,
  surfaceProbeResources,
  prepareSurfaceProbeMeshes,
} from './babylon-surface-parity.ts';
import {
  GROUNDING_LAYOUTS,
  GROUNDING_LIGHTS,
  GROUNDING_OUTPUTS,
  GROUNDING_LIMITS,
  GROUNDING_OBSERVER_GLSL,
  GROUNDING_POSE_ORACLE_SHA256,
  createGroundingReference,
  frozenGroundingPoses,
  setOriginalGroundingPose,
  type GroundingLayout,
  type GroundingLight,
  type GroundingOutput,
  type GroundingControl,
  type GroundingReceiver,
} from './grounding-reference.ts';
import {
  groundingReferenceMask,
  compareGroundingChannels,
  compareGroundingCoverage,
  groundingPresence,
  groundingNativeStats,
  groundingNativeClosure,
  groundingClosureBound,
  type GroundingMask,
} from './grounding-parity-metrics.ts';

const nativeTerms = `vec4(groundingProbeSum(finalDiffuse),
#ifdef SPECULARTERM
  groundingProbeSum(finalSpecularScaled),
#else
  0.0,
#endif
  groundingProbeSum(finalAmbient),groundingProbeSum(finalEmissive))`;
/** Priority 240 snapshots the actual native final terms after AO and before
 * candidate priority 250. These observations are not candidate-private factors. */
export class GroundingNativeBefore extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, 'GroundingNativeBefore', 240, { GROUNDING_NATIVE_BEFORE_V1: true }, true, true);
  }
  getClassName() {
    return 'GroundingNativeBefore';
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: `${GROUNDING_OBSERVER_GLSL}\nvec4 groundingNativeBefore; vec4 groundingNativeAfter; vec3 groundingProbeAlbedo; float groundingProbeRoughness;`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `groundingNativeBefore=${nativeTerms};`,
        }
      : null;
  }
}
/** Priority 300 observes the native applied result; no final-color attenuation,
 * candidate-private occlusion, split contribution or duplicate shader formula.
 * Blue is deliberately zero, not a fabricated candidate occupancy witness. */
export class GroundingNativeOutput extends MaterialPluginBase {
  mode = 0;
  constructor(
    material: PBRMaterial,
    private readonly receiver: GroundingReceiver,
  ) {
    super(
      material,
      'GroundingNativeOutput',
      300,
      { GROUNDING_NATIVE_OUTPUT_V1: true },
      true,
      false,
    );
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName() {
    return 'GroundingNativeOutput';
  }
  getUniforms() {
    return {
      ubo: [
        { name: 'groundingProbeOutput', size: 1, type: 'float' },
        { name: 'groundingProbeView', size: 16, type: 'mat4' },
      ],
      fragment: 'uniform float groundingProbeOutput; uniform mat4 groundingProbeView;',
    };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('groundingProbeOutput', this.mode);
    buffer.updateMatrix('groundingProbeView', this._material.getScene().getViewMatrix());
  }
  getCustomCode(type: string) {
    return type === 'fragment'
      ? {
          CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: 'groundingProbeRoughness=metallicRoughness.g;',
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: 'groundingProbeAlbedo=surfaceAlbedo;',
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `groundingNativeAfter=${nativeTerms};`,
          CUSTOM_FRAGMENT_MAIN_END: `vec4 groundingOutput=vec4(groundingProbeRatio(groundingNativeBefore.x,groundingNativeAfter.x),groundingProbeRatio(groundingNativeBefore.y,groundingNativeAfter.y),0.0,1.0);
if(groundingProbeOutput>0.5 && groundingProbeOutput<1.5)
  groundingOutput=vec4(groundingProbeBits(groundingNativeBefore)/15.0,groundingProbeBits(groundingNativeAfter)/15.0,groundingProbeInvalid(groundingNativeBefore,groundingNativeAfter)/15.0,1.0);
else if(groundingProbeOutput>1.5 && groundingProbeOutput<2.5)
  groundingOutput=groundingProbeNative(groundingNativeBefore.x,groundingNativeAfter.x);
else if(groundingProbeOutput>2.5 && groundingProbeOutput<3.5)
  groundingOutput=groundingProbeNative(groundingNativeBefore.y,groundingNativeAfter.y);
else if(groundingProbeOutput>3.5 && groundingProbeOutput<4.5)
  groundingOutput=vec4(${this.receiver === 'road' ? '1.0,0.0' : '0.0,1.0'},0.0,1.0);
else if(groundingProbeOutput>4.5 && groundingProbeOutput<5.5)
  groundingOutput=vec4(groundingProbeAlbedo*0.5,1.0);
else if(groundingProbeOutput>5.5 && groundingProbeOutput<6.5)
  groundingOutput=vec4(vec3(groundingProbeRoughness*0.5),1.0);
else if(groundingProbeOutput>6.5 && groundingProbeOutput<7.5)
  groundingOutput=vec4(normalize(mat3(groundingProbeView)*normalW)*0.5+0.5,1.0);
else if(groundingProbeOutput>7.5)
  groundingOutput=vec4(finalEmissive,1.0);
gl_FragColor=groundingOutput;`,
        }
      : null;
  }
}

const SIZE = 256,
  EXTENT = 4.25;
const nativeOutputs = ['ratios', 'presence', 'native-diffuse', 'native-specular'] as const;
const factorOutputs = ['albedo', 'roughness', 'normal', 'emissive'] as const;
const receivers = ['road', 'paint'] as const;
const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
/** Identical float32 geometry/UV input. Adjacent road and paint use the actual
 * factories, not a new shadow card or production draw path. */
export function groundingProbePlanes() {
  return [
    [-EXTENT, 0],
    [0, EXTENT],
  ].map(([left, right]) => ({
    positions: new Float32Array([
      left,
      0,
      -EXTENT,
      right,
      0,
      -EXTENT,
      right,
      0,
      EXTENT,
      left,
      0,
      EXTENT,
    ]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([
      left / 5,
      -EXTENT / 5,
      right / 5,
      -EXTENT / 5,
      right / 5,
      EXTENT / 5,
      left / 5,
      EXTENT / 5,
    ]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  }));
}
export function groundingEffectIdentity(meshes: readonly Mesh[]) {
  const effects = meshes.map((mesh) => mesh.subMeshes?.[0]?.effect);
  if (effects.length !== 2 || effects.some((effect) => !effect))
    throw new Error('Grounding native draw effects were not actually bound');
  return effects;
}
export function groundingRawBytes(pixels: Uint8Array) {
  let result = '';
  for (let i = 0; i < pixels.length; i += 8192)
    result += String.fromCharCode(...pixels.subarray(i, i + 8192));
  return btoa(result);
}
type Observation = { pixels: Uint8Array; image: string; completedFrames: number; glError: number };
type CaptureRow = {
  renderer: 'three' | 'babylon';
  layout: string;
  light: GroundingLight;
  output: GroundingOutput;
  zero: boolean;
  control: GroundingControl;
  repeat: boolean;
  image: string;
  rgbaBase64?: string;
  completedFrames: number;
  glError: number;
};
type Comparison = ReturnType<typeof compareGroundingChannels>;
function exact(metrics: Comparison, label: string) {
  for (const row of Object.values(metrics))
    if (
      row.comparedPixels < GROUNDING_LIMITS.minInteriorPixelsPerReceiver ||
      row.missingPixels ||
      row.maxChannelError !== 0 ||
      row.meanChannelError !== 0
    )
      throw new Error(`Original/unchanged grounding observation not exact: ${label}`);
}
function present(metrics: ReturnType<typeof groundingPresence>, label: string) {
  for (const row of Object.values(metrics))
    if (
      row.pixels < GROUNDING_LIMITS.minInteriorPixelsPerReceiver ||
      row.missingRequired ||
      row.unexpectedlyActive ||
      row.invalidNative
    )
      throw new Error(`Required native grounding term invalid/absent: ${label}`);
}

export async function babylonControlledGroundingParity() {
  const h = createSurfaceProbeHarness(SIZE, SIZE),
    canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0, 0);
  const gl = renderer.getContext() as WebGL2RenderingContext,
    threeGpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule();
  const scene = new THREE.Scene(),
    threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const sky = new THREE.HemisphereLight(0xffffff, 0x000000, 0.7),
    sun = new THREE.DirectionalLight(0xffffff, 1.5);
  scene.add(sky, sun, sun.target);
  const threeShaderErrors: object[] = [],
    originalShaders: { vertexSource: string; fragmentSource: string; cacheKey: string }[] = [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) =>
    threeShaderErrors.push({
      program: context.getProgramInfoLog(program as unknown as WebGLProgram),
      vertex: context.getShaderInfoLog(vertex),
      fragment: context.getShaderInfoLog(fragment),
      vertexSource: context.getShaderSource(vertex),
      fragmentSource: context.getShaderSource(fragment),
    });
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      threeGpu.contextLost();
      h.abort.abort(new Error('Original grounding reference lost WebGL context'));
    },
    { signal: h.abort.signal },
  );
  let poses: FormulaGroundingPoses | undefined,
    owner: ReturnType<typeof createAsphaltSubstrate> | undefined,
    paint: PBRMaterial | undefined;
  const threeMeshes: THREE.Mesh[] = [],
    meshes: Mesh[] = [],
    references: ReturnType<typeof createGroundingReference>[] = [];
  let camera: UniversalCamera | undefined,
    bSky: HemisphericLight | undefined,
    bSun: DirectionalLight | undefined;
  const actualEffects = new Map<Effect, string>();
  const observers: GroundingNativeOutput[] = [],
    phases: string[] = [],
    captures: CaptureRow[] = [];
  const repeats: {
    layout: string;
    light: GroundingLight;
    output: GroundingOutput;
    zero: boolean;
    metrics: Comparison;
  }[] = [];
  const controls: { name: GroundingControl; metrics: Comparison }[] = [],
    comparisons: { layout: string; light: GroundingLight; metrics: Comparison; mapping: string }[] =
      [];
  const presence: {
    renderer: 'three' | 'babylon';
    layout: string;
    light: GroundingLight;
    requiredBits: number;
    metrics: ReturnType<typeof groundingPresence>;
  }[] = [];
  const nativeStats: {
    renderer: 'three' | 'babylon';
    layout: string;
    light: GroundingLight;
    output: string;
    metrics: ReturnType<typeof groundingNativeStats>;
  }[] = [];
  const closures: {
    renderer: 'three' | 'babylon';
    layout: string;
    output: string;
    metrics: ReturnType<typeof groundingNativeClosure>;
  }[] = [];
  const zeroApplication: { renderer: 'three' | 'babylon'; metrics: Comparison }[] = [];
  const factors: { renderer: 'three' | 'babylon'; output: string; metrics: Comparison }[] = [],
    coverage: { layout: string; metrics: ReturnType<typeof compareGroundingCoverage> }[] = [];
  const masks = new Map<string, GroundingMask>(),
    ids = new Map<string, Uint8Array>(),
    referencePixels = new Map<string, Uint8Array>();
  const key = (layout: GroundingLayout, light: GroundingLight, output: GroundingOutput) =>
    `${layout.name}/${light}/${output}`;
  let referenceQualified = false,
    candidateConstructed = false,
    failure: string | null = null,
    closureBound: number | null = null;
  let baseline = surfaceProbeResources(h.scene),
    retained = baseline,
    restored = baseline,
    repeatDisposeUnchanged = false,
    pluginResourceDelta: object | null = null;
  let shaders: ReturnType<typeof h.shaders> | null = null,
    displayUnchanged = false;
  const originalDisplay = JSON.stringify({
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
  });
  let candidateDisplay: string | undefined;
  let countCacheStable = false;
  function retain(
    observation: Observation,
    rendererName: 'three' | 'babylon',
    layout: GroundingLayout,
    light: GroundingLight,
    output: GroundingOutput,
    zero = false,
    control: GroundingControl = 'original',
    repeat = false,
  ) {
    captures.push({
      renderer: rendererName,
      layout: layout.name,
      light,
      output,
      zero,
      control,
      repeat,
      image: observation.image,
      ...(output.startsWith('native-')
        ? { rgbaBase64: groundingRawBytes(observation.pixels) }
        : {}),
      completedFrames: observation.completedFrames,
      glError: observation.glError,
    });
    if (observation.glError || observation.completedFrames < 2 || threeShaderErrors.length)
      throw new Error(
        `Grounding capture failed: ${rendererName}/${layout.name}/${light}/${output}`,
      );
  }
  function clearThree() {
    for (const mesh of threeMeshes.splice(0)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
  }
  function disposeReferences() {
    for (const ref of references.splice(0)) ref.dispose();
  }
  function setGeometry(layout: GroundingLayout, candidate: boolean) {
    const p = frozenGroundingPoses(layout),
      centre = [p[0], p[3], p[1]],
      half = 1.3 * EXTENT;
    threeCamera.position.set(centre[0], centre[1] + 8, centre[2] + 9);
    threeCamera.lookAt(...(centre as [number, number, number]));
    threeCamera.left = -half;
    threeCamera.right = half;
    threeCamera.top = half;
    threeCamera.bottom = -half;
    threeCamera.updateProjectionMatrix();
    sun.position.set(centre[0] + 0.3, centre[1] + 1, centre[2] - 0.4);
    sun.target.position.fromArray(centre);
    if (candidate) {
      for (const mesh of meshes.splice(0)) mesh.dispose();
      camera!.position.copyFromFloats(centre[0], centre[1] + 8, centre[2] + 9);
      camera!.setTarget(Vector3.FromArray(centre));
      camera!.orthoLeft = -half;
      camera!.orthoRight = half;
      camera!.orthoTop = half;
      camera!.orthoBottom = -half;
      for (const [i, data] of groundingProbePlanes().entries()) {
        const mesh = new Mesh(`grounding-${receivers[i]}`, h.scene),
          vertex = new VertexData();
        Object.assign(vertex, data);
        vertex.applyToMesh(mesh);
        mesh.position.copyFromFloats(...(centre as [number, number, number]));
        mesh.rotation.z = layout.bank;
        mesh.material = i ? paint! : owner!.material;
        meshes.push(mesh);
      }
    } else {
      clearThree();
      for (const [i, data] of groundingProbePlanes().entries()) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        const mesh = new THREE.Mesh(geometry, references[i].material);
        mesh.position.fromArray(centre);
        mesh.rotation.z = layout.bank;
        scene.add(mesh);
        threeMeshes.push(mesh);
      }
    }
  }
  function lighting(light: GroundingLight, candidate: boolean) {
    if (candidate) {
      bSky!.setEnabled(light !== 'sun');
      bSun!.setEnabled(light !== 'sky');
    } else {
      sky.visible = light !== 'sun';
      sun.visible = light !== 'sky';
    }
  }
  function referenceMaterials(control: GroundingControl = 'original') {
    disposeReferences();
    for (const receiver of receivers) {
      const ref = createGroundingReference(receiver, control),
        compile = ref.material.onBeforeCompile;
      ref.material.onBeforeCompile = (shader, webgl) => {
        compile.call(ref.material, shader, webgl);
        originalShaders.push({
          vertexSource: shader.vertexShader,
          fragmentSource: shader.fragmentShader,
          cacheKey: ref.material.customProgramCacheKey(),
        });
      };
      references.push(ref);
    }
  }
  async function captureThree() {
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
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels,
      image: canvas.toDataURL('image/png'),
      completedFrames: threeGpu.diagnostics().completed - before,
      glError: gl.getError(),
    };
  }
  async function captureCandidate() {
    const before = h.gpu.diagnostics().completed;
    await h.presented();
    return {
      ...h.capture(),
      completedFrames: h.gpu.diagnostics().completed - before,
      glError: h.gl.getError(),
    };
  }
  async function captureReference(
    layout: GroundingLayout,
    light: GroundingLight,
    output: GroundingOutput,
    zero = false,
    control: GroundingControl = 'original',
    repeat = true,
  ) {
    references.forEach((r) => r.setOutput(output));
    const actual = await captureThree();
    retain(actual, 'three', layout, light, output, zero, control);
    if (repeat) {
      const repeated = await captureThree();
      retain(repeated, 'three', layout, light, output, zero, control, true);
      const metrics = compareGroundingChannels(
        repeated.pixels,
        actual.pixels,
        masks.get(layout.name)!,
        output.startsWith('native-')
          ? [
              [0, 0],
              [1, 1],
              [2, 2],
              [3, 3],
            ]
          : undefined,
        !output.startsWith('native-'),
      );
      repeats.push({ layout: layout.name, light, output, zero, metrics });
      exact(metrics, `${layout.name}/${light}/${output}`);
    }
    return actual;
  }
  function nativeCheck(
    rendererName: 'three' | 'babylon',
    layout: GroundingLayout,
    light: GroundingLight,
    output: GroundingOutput,
    pixels: Uint8Array,
  ) {
    const mask = masks.get(layout.name)!;
    if (output === 'presence') {
      const requiredBits =
        rendererName === 'babylon' ? 3 : light === 'sky' ? 4 : light === 'sun' ? 3 : 7;
      const metrics = groundingPresence(pixels, mask, requiredBits);
      presence.push({ renderer: rendererName, layout: layout.name, light, requiredBits, metrics });
      present(metrics, `${rendererName}/${layout.name}/${light}`);
    }
    if (output.startsWith('native-')) {
      const metrics = groundingNativeStats(pixels, mask);
      nativeStats.push({ renderer: rendererName, layout: layout.name, light, output, metrics });
      for (const row of Object.values(metrics)) {
        const absent = rendererName === 'three' && light === 'sky' && output === 'native-specular';
        if (
          absent
            ? row.maxBeforeUnits !== 0 || row.maxAfterUnits !== 0
            : row.maxBeforeUnits === 0 || row.maxAfterUnits === 0
        )
          throw new Error(
            `Native grounding quantized range/absence failed: ${rendererName}/${light}/${output}`,
          );
      }
    }
  }
  function close(
    rendererName: 'three' | 'babylon',
    layout: GroundingLayout,
    pixels: Map<string, Uint8Array>,
  ) {
    for (const output of ['native-diffuse', 'native-specular'] as const) {
      const metrics = groundingNativeClosure(
        pixels.get(key(layout, 'mixed', output))!,
        pixels.get(key(layout, 'sky', output))!,
        pixels.get(key(layout, 'sun', output))!,
        masks.get(layout.name)!,
      );
      closures.push({ renderer: rendererName, layout: layout.name, output, metrics });
    }
  }
  try {
    phases.push('original-reference');
    referenceMaterials();
    for (const layout of GROUNDING_LAYOUTS) {
      setGeometry(layout, false);
      lighting('mixed', false);
      setOriginalGroundingPose(layout, threeCamera, sun);
      await threeGpu.prepare(`original grounding ${layout.name}/IDs`, h.deadline, () =>
        renderer.compileAsync(scene, threeCamera).then(() => undefined),
      );
      references.forEach((r) => r.setOutput('receiver'));
      const identity = await captureThree();
      retain(identity, 'three', layout, 'mixed', 'receiver');
      ids.set(layout.name, identity.pixels);
      const mask = groundingReferenceMask(identity.pixels, SIZE);
      masks.set(layout.name, mask);
      if (Object.values(mask.counts).some((n) => n < GROUNDING_LIMITS.minInteriorPixelsPerReceiver))
        throw new Error('Original grounding receiver support insufficient');
      for (const light of GROUNDING_LIGHTS) {
        lighting(light, false);
        await threeGpu.prepare(`original grounding ${layout.name}/${light}`, h.deadline, () =>
          renderer.compileAsync(scene, threeCamera).then(() => undefined),
        );
        for (const output of nativeOutputs) {
          const actual = await captureReference(layout, light, output);
          referencePixels.set(key(layout, light, output), actual.pixels);
          nativeCheck('three', layout, light, output, actual.pixels);
        }
      }
      close('three', layout, referencePixels);
    }
    const referenceMaximum = Math.max(
      ...closures.flatMap((c) =>
        Object.values(c.metrics).flatMap((row) => [row.maxBeforeUnits, row.maxAfterUnits]),
      ),
    );
    closureBound = groundingClosureBound(referenceMaximum);
    const first = GROUNDING_LAYOUTS[0];
    setGeometry(first, false);
    lighting('mixed', false);
    await threeGpu.prepare('original grounding unchanged factors', h.deadline, () =>
      renderer.compileAsync(scene, threeCamera).then(() => undefined),
    );
    setOriginalGroundingPose(first, threeCamera, sun, 'original', true);
    const zeroNative = await captureReference(first, 'mixed', 'ratios', true);
    const expectedZero = new Uint8Array(zeroNative.pixels.length);
    for (const index of masks.get(first.name)!.indices) expectedZero.set([255, 255, 0, 255], index);
    const originalZeroMetrics = compareGroundingChannels(
      zeroNative.pixels,
      expectedZero,
      masks.get(first.name)!,
    );
    exact(originalZeroMetrics, 'original zero-count native application');
    zeroApplication.push({ renderer: 'three', metrics: originalZeroMetrics });
    referencePixels.set('zero-native-ratios', zeroNative.pixels);
    const zeroFactors = new Map<GroundingOutput, Uint8Array>();
    for (const zero of [true, false]) {
      setOriginalGroundingPose(first, threeCamera, sun, 'original', zero);
      for (const output of factorOutputs) {
        const actual = await captureReference(first, 'mixed', output, zero);
        if (zero) zeroFactors.set(output, actual.pixels);
        else {
          const metrics = compareGroundingChannels(
            actual.pixels,
            zeroFactors.get(output)!,
            masks.get(first.name)!,
          );
          factors.push({ renderer: 'three', output, metrics });
          exact(metrics, `original ${output} zero/nonzero`);
        }
      }
    }
    phases.push('original-negative-controls');
    clearThree();
    disposeReferences();
    for (const control of ['omitted', 'wrong-yaw', 'wrong-height', 'swapped-factors'] as const) {
      referenceMaterials(control);
      setGeometry(first, false);
      lighting('mixed', false);
      setOriginalGroundingPose(first, threeCamera, sun, control);
      await threeGpu.prepare(`original grounding negative ${control}`, h.deadline, () =>
        renderer.compileAsync(scene, threeCamera).then(() => undefined),
      );
      const actual = await captureReference(first, 'mixed', 'ratios', false, control, false),
        metrics = compareGroundingChannels(
          actual.pixels,
          referencePixels.get(key(first, 'mixed', 'ratios'))!,
          masks.get(first.name)!,
          [
            [0, 0],
            [1, 1],
          ],
        );
      controls.push({ name: control, metrics });
      for (const row of Object.values(metrics))
        if (
          row.missingPixels ||
          row.comparedPixels < GROUNDING_LIMITS.minInteriorPixelsPerReceiver ||
          row.changedPixels < GROUNDING_LIMITS.negativeMinChangedPixels ||
          row.maxChannelError < GROUNDING_LIMITS.negativeMinMaxError
        )
          throw new Error(
            `Original grounding control did not discriminate on both receivers: ${control}`,
          );
      clearThree();
      disposeReferences();
    }
    if (threeShaderErrors.length) throw new Error('Original grounding shader failure');
    referenceQualified = true;
    phases.push('reference-qualified');
    // Candidate resources do not exist until every original repeat, required
    // native term, independent control and own-baseline closure has qualified.
    await h.gpu.prepare('isolated grounding allocation', h.deadline, async () => {
      h.abort.signal.throwIfAborted();
      const warm = new PBRMaterial('scene-owned-brdf', h.scene);
      warm.dispose();
      baseline = surfaceProbeResources(h.scene);
      owner = createAsphaltSubstrate(h.scene);
      paint = new PBRMaterial('original offwhite paint', h.scene);
      paint.albedoColor = new Color3(
        ...([0xe9, 0xe7, 0xe0].map((v) => circuitPaintLinearChannel(v / 255)) as [
          number,
          number,
          number,
        ]),
      );
      paint.metallic = 0;
      paint.roughness = 0.55;
      paint.sideOrientation = Material.CounterClockWiseSideOrientation;
      new CircuitPaintFinishPlugin(paint);
      poses = new FormulaGroundingPoses(h.scene, h.abort.signal);
      const before = surfaceProbeResources(h.scene);
      for (const [i, material] of [owner.material, paint].entries()) {
        new GroundingNativeBefore(material);
        new FormulaGroundingPlugin(material, poses);
        observers.push(new GroundingNativeOutput(material, receivers[i]));
        h.observe(material);
        material.onEffectCreatedObservable.add(({ effect }) => {
          if (effect) actualEffects.set(effect, material.name);
        });
      }
      pluginResourceDelta = { before, after: surfaceProbeResources(h.scene) };
      camera = new UniversalCamera('isolated-grounding', new Vector3(0, 8, 9), h.scene);
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      camera.minZ = 0.1;
      camera.maxZ = 500;
      bSky = new HemisphericLight('native-sky', Vector3.Up(), h.scene);
      bSky.intensity = 0.7;
      bSun = new DirectionalLight('native-sun', new Vector3(-0.3, -1, 0.4), h.scene);
      bSun.intensity = 1.5;
      candidateDisplay = JSON.stringify(h.scene.imageProcessingConfiguration.serialize());
      candidateConstructed = true;
    });
    phases.push('candidate');
    const candidatePixels = new Map<string, Uint8Array>();
    for (const layout of GROUNDING_LAYOUTS) {
      setGeometry(layout, true);
      poses!.set(layout.count, frozenGroundingPoses(layout));
      lighting('mixed', true);
      await prepareSurfaceProbeMeshes(h, meshes);
      observers.forEach((o) => (o.mode = GROUNDING_OUTPUTS.indexOf('receiver')));
      const identity = await captureCandidate();
      retain(identity, 'babylon', layout, 'mixed', 'receiver');
      const support = compareGroundingCoverage(
        identity.pixels,
        ids.get(layout.name)!,
        masks.get(layout.name)!,
      );
      coverage.push({ layout: layout.name, metrics: support });
      if (Object.values(support).some((n) => n !== 0))
        throw new Error(`Candidate grounding coverage changed: ${layout.name}`);
      for (const light of GROUNDING_LIGHTS) {
        lighting(light, true);
        await prepareSurfaceProbeMeshes(h, meshes);
        for (const output of nativeOutputs) {
          observers.forEach((o) => (o.mode = GROUNDING_OUTPUTS.indexOf(output)));
          const actual = await captureCandidate();
          retain(actual, 'babylon', layout, light, output);
          candidatePixels.set(key(layout, light, output), actual.pixels);
          nativeCheck('babylon', layout, light, output, actual.pixels);
          if (output === 'ratios' && light !== 'mixed') {
            const metrics = compareGroundingChannels(
              actual.pixels,
              referencePixels.get(key(layout, light, output))!,
              masks.get(layout.name)!,
              light === 'sky'
                ? [
                    [0, 0],
                    [1, 0],
                  ]
                : [
                    [0, 0],
                    [1, 1],
                  ],
            );
            comparisons.push({
              layout: layout.name,
              light,
              metrics,
              mapping:
                light === 'sky'
                  ? 'native sky diffuse parity; original indirect factor mapped to additional Babylon hemisphere specular'
                  : 'native sun diffuse and specular parity',
            });
            for (const row of Object.values(metrics))
              if (
                row.missingPixels ||
                row.maxChannelError > GROUNDING_LIMITS.candidateMax ||
                row.meanChannelError > GROUNDING_LIMITS.candidateMean
              )
                throw new Error(`Candidate native attenuation mismatch: ${layout.name}/${light}`);
          }
        }
      }
      close('babylon', layout, candidatePixels);
    }
    for (const closure of closures.filter((c) => c.renderer === 'babylon'))
      for (const row of Object.values(closure.metrics))
        if (row.maxBeforeUnits > closureBound || row.maxAfterUnits > closureBound)
          throw new Error(
            `Candidate own-native mixed superposition failed: ${closure.layout}/${closure.output}`,
          );
    setGeometry(first, true);
    lighting('mixed', true);
    await prepareSurfaceProbeMeshes(h, meshes);
    zeroFactors.clear();
    poses!.set(0, []);
    observers.forEach((observer) => (observer.mode = 0));
    const zeroCandidate = await captureCandidate();
    retain(zeroCandidate, 'babylon', first, 'mixed', 'ratios', true);
    const candidateZeroMetrics = compareGroundingChannels(
      zeroCandidate.pixels,
      referencePixels.get('zero-native-ratios')!,
      masks.get(first.name)!,
    );
    exact(candidateZeroMetrics, 'candidate zero-count native application');
    zeroApplication.push({ renderer: 'babylon', metrics: candidateZeroMetrics });
    const countEffects = groundingEffectIdentity(meshes);
    for (const zero of [true, false]) {
      poses!.set(zero ? 0 : first.count, zero ? [] : frozenGroundingPoses(first));
      for (const output of factorOutputs) {
        observers.forEach((o) => (o.mode = GROUNDING_OUTPUTS.indexOf(output)));
        const actual = await captureCandidate();
        retain(actual, 'babylon', first, 'mixed', output, zero);
        if (zero) zeroFactors.set(output, actual.pixels);
        else {
          const metrics = compareGroundingChannels(
            actual.pixels,
            zeroFactors.get(output)!,
            masks.get(first.name)!,
          );
          factors.push({ renderer: 'babylon', output, metrics });
          exact(metrics, `candidate ${output} zero/nonzero`);
        }
      }
    }
    countCacheStable = groundingEffectIdentity(meshes).every(
      (effect, i) => effect === countEffects[i],
    );
    if (!countCacheStable) throw new Error('Grounding count changes rebuilt native effects');
    retained = surfaceProbeResources(h.scene);
    displayUnchanged =
      originalDisplay ===
        JSON.stringify({
          toneMapping: renderer.toneMapping,
          toneMappingExposure: renderer.toneMappingExposure,
          outputColorSpace: renderer.outputColorSpace,
        }) && candidateDisplay === JSON.stringify(h.scene.imageProcessingConfiguration.serialize());
    if (!displayUnchanged) throw new Error('Grounding modified renderer display configuration');
    await h.gpu.prepare('isolated grounding disposal', h.deadline, async () => {
      for (const mesh of meshes.splice(0)) mesh.dispose();
      owner!.dispose();
      paint!.dispose();
      poses!.dispose();
    });
    restored = surfaceProbeResources(h.scene);
    owner!.dispose();
    poses!.dispose();
    repeatDisposeUnchanged =
      JSON.stringify(restored) === JSON.stringify(surfaceProbeResources(h.scene));
    phases.push('disposed');
  } catch (error) {
    failure = message(error);
  }
  const nativeShaders = [...actualEffects].map(([effect, material]) => ({
    material,
    defines: effect.defines,
    error: effect.getCompilationError(),
    samplers: [...effect.getSamplers()],
    vertexSource: effect._vertexSourceCode,
    fragmentSource: effect._fragmentSourceCode,
  }));
  const diagnostics = { babylon: h.gpu.diagnostics(), three: threeGpu.diagnostics() },
    poseState = poses?.snapshot() ?? null;
  try {
    shaders = h.shaders(!!failure);
  } catch (error) {
    failure ??= message(error);
  }
  // Cached receipts only after first fault; no new driver readback/source query.
  for (const cleanup of [
    () => threeGpu.dispose(),
    () => clearThree(),
    () => disposeReferences(),
    () => {
      for (const mesh of meshes.splice(0)) mesh.dispose();
    },
    () => owner?.dispose(),
    () => paint?.dispose(),
    () => poses?.dispose(),
    () => new StudioFrame(studioUniforms).reset(),
    () => renderer.dispose(),
    () => canvas.remove(),
    () => h.dispose(),
  ])
    try {
      cleanup();
    } catch (error) {
      failure ??= message(error);
    }
  return {
    failure,
    phases,
    referenceQualified,
    candidateConstructed,
    captures,
    repeats,
    controls,
    comparisons,
    presence,
    nativeStats,
    closures,
    closureBound,
    factors,
    coverage,
    originalShaders,
    nativeShaders,
    countCacheStable,
    zeroApplication,
    shaders,
    threeShaderErrors,
    threeRevision: THREE.REVISION,
    baseline,
    retained,
    restored,
    repeatDisposeUnchanged,
    pluginResourceDelta,
    poseState,
    displayUnchanged,
    diagnostics,
    limits: GROUNDING_LIMITS,
    poseOracleSha256: GROUNDING_POSE_ORACLE_SHA256,
    productionActivated: false,
    encoding:
      'RGBA8 native ratio/presence and view factors; native before/after sums use two 16-bit words over [0,16), raw bottom-up RGBA bytes retained as base64 (PNG alpha is data, not coverage)',
    absentTerms:
      'Three sky direct diffuse/specular and no-environment indirect specular are exactly zero; sun indirect terms are exactly zero. Required active terms never use epsilon or a candidate-selected mask.',
    skySpecularPolicy:
      'Three has no positive no-environment sky-specular reference. Original identical indirect multipliers justify mapping its measured sky attenuation to Babylon additional native hemisphere specular; actual application is independently observed.',
    scope:
      'Opaque nonnegative dry original road/paint; HEMILIGHT and DIRLIGHT; post-AO native terms; mixed closure uses each renderer own baselines. No nontrivial AO or environment parity claim.',
    unported: [
      'live activation',
      'GP grounding',
      'shadow-map interaction',
      'environment/IBL mapping',
      'wet/scanned/road-state layers',
      'light pools',
      'complete PBR/display parity',
      'full-mode migration',
    ],
  };
}
