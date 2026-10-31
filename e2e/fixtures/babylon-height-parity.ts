import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color4, Vector3 } from '@babylonjs/core/Maths/math.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import * as THREE from 'three';
import {
  loadExistingPlayer,
  existingPlayerPrimitiveBindings,
  decodeExistingPlayerBytes,
} from '../../src/engine/babylon/existing-player.ts';
import { ExistingPlayerSteering } from '../../src/engine/babylon/existing-player-steering.ts';
import {
  createExistingPlayerHeightAdapter,
  ScalarHeightPlugin,
  EXISTING_PLAYER_HEIGHT_SOURCES,
  type ExistingPlayerHeightAdapter,
} from '../../src/engine/babylon/existing-player-height.ts';
import { BabylonPresentationGpu } from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import { waitForPresentation } from '../../src/engine/babylon/presentation-ready.ts';
import {
  prepareOriginalMaterials,
  yieldPreparationTurn,
} from '../../src/engine/babylon/asset-preparation.ts';
import manifest from '../../src/rendering/supplied-player.manifest.json' with { type: 'json' };

// Isolated acceptance only. Never imported by either game entry. No shader-store
// writes, texture conversion, automatic LOD policy, physics or lookdev gains.
function harness(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.append(canvas);
  const engine = new Engine(canvas, false, { preserveDrawingBuffer: true });
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('Height acceptance requires WebGL2');
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 0);
  const gpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule();
  const abort = new AbortController(),
    deadline = performance.now() + 120000;
  const timer = setTimeout(
    () => abort.abort(new Error('Height probe exceeded 120000ms total budget')),
    120000,
  );
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      gpu.contextLost();
      abort.abort(new Error('Height probe lost WebGL context'));
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
  const presented = async () => {
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
        scene.render();
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
    engine,
    gl,
    scene,
    gpu,
    abort,
    deadline,
    presented,
    capture,
    observe,
    shaders,
    dispose() {
      clearTimeout(timer);
      abort.abort();
      gpu.dispose();
      scene.dispose();
      engine.dispose();
      canvas.remove();
    },
  };
}
const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Normal encoding matches Three r180 MeshNormalMaterial: VIEW-space [-1,1]
 * encoded into linear RGB, no lighting, tone mapping or image processing. */
class ViewNormalOutput extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(material, 'HeightProbeViewNormal', 300, {}, true, true);
  }
  getCustomCode(shaderType: string) {
    return shaderType === 'fragment'
      ? {
          CUSTOM_FRAGMENT_MAIN_END: 'gl_FragColor=vec4(normalize(mat3(view)*normalW)*0.5+0.5,1.0);',
        }
      : null;
  }
}

export async function babylonControlledHeightParity() {
  const h = harness(256, 256);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(256, 256);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0, 0);
  const threeShaderErrors: {
    program: string | null;
    vertex: string | null;
    fragment: string | null;
    vertexSource: string | null;
    fragmentSource: string | null;
  }[] = [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    threeShaderErrors.push({
      program: context.getProgramInfoLog(program as unknown as WebGLProgram),
      vertex: context.getShaderInfoLog(vertex),
      fragment: context.getShaderInfoLog(fragment),
      vertexSource: context.getShaderSource(vertex),
      fragmentSource: context.getShaderSource(fragment),
    });
  };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const threeGpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule();
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      threeGpu.contextLost();
      h.abort.abort(new Error('Three reference lost WebGL context'));
    },
    { signal: h.abort.signal },
  );
  const threeScene = new THREE.Scene();
  const camera = new UniversalCamera('normal-space-camera', new Vector3(2, 1, 4), h.scene);
  camera.setTarget(Vector3.Zero());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -2;
  camera.orthoRight = 2;
  camera.orthoTop = 2;
  camera.orthoBottom = -2;
  camera.minZ = 0.1;
  camera.maxZ = 20;
  const threeCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  threeCamera.position.set(2, 1, 4);
  threeCamera.lookAt(0, 0, 0);
  const positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1],
    indices = [0, 1, 2, 0, 2, 3];
  const data = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4,
        height = Math.round(127 + 90 * Math.sin(x * 0.61) * Math.cos(y * 0.43));
      data.set([height, height, height, 255], i);
    }
  const texture = RawTexture.CreateRGBATexture(
    data,
    32,
    32,
    h.scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.gammaSpace = false;
  const threeTexture = new THREE.DataTexture(data, 32, 32);
  threeTexture.wrapS = threeTexture.wrapT = THREE.RepeatWrapping;
  threeTexture.magFilter = threeTexture.minFilter = THREE.LinearFilter;
  threeTexture.needsUpdate = true;
  // Genuine non-flat tangent-normal control, not the mislabeled grayscale map.
  const normalPixels = new Uint8Array([178, 110, 240, 255]);
  const normalTexture = RawTexture.CreateRGBATexture(
    normalPixels,
    1,
    1,
    h.scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  normalTexture.gammaSpace = false;
  const threeNormalTexture = new THREE.DataTexture(normalPixels, 1, 1);
  threeNormalTexture.needsUpdate = true;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const rows: {
    name: string;
    scale: number;
    comparedPixels: number;
    maxChannelError: number;
    meanChannelError: number;
    changedFromRaw: number;
    diagnosticSignalChannels: number;
    babylonImage: string;
    threeImage: string;
    rawImage: string;
    completedFrames: number;
    babylonGlError: number;
    threeGlError: number;
    shaderSamplers: string[];
    scalarShaderCode: boolean;
    glError: number;
  }[] = [];
  let failure: string | null = null;
  let shaders: ReturnType<typeof h.shaders> | undefined;
  try {
    // Real source scales plus explicitly amplified diagnostic cases. The latter
    // expose derivative/sign errors above 8-bit quantization; not production gains.
    const cases = [
      { name: 'carbon-source-scale', scale: 0.00015, back: false, uv: false, scaled: false },
      { name: 'tyre-source-scale', scale: 0.0004, back: false, uv: true, scaled: true },
      { name: 'diagnostic-front', scale: 0.4, back: false, uv: false, scaled: false },
      { name: 'diagnostic-uv-nonuniform', scale: 0.4, back: false, uv: true, scaled: true },
      { name: 'diagnostic-backface', scale: 0.4, back: true, uv: true, scaled: true },
      { name: 'true-normal-control', scale: 0, back: false, uv: false, scaled: false },
    ];
    for (const probe of cases) {
      const mesh = new Mesh(probe.name, h.scene),
        vertex = new VertexData();
      vertex.positions = positions;
      vertex.normals = normals;
      vertex.uvs = uvs;
      vertex.indices = indices;
      vertex.applyToMesh(mesh);
      const material = new PBRMaterial(probe.name, h.scene);
      material.backFaceCulling = false;
      material.twoSidedLighting = true;
      material.forceNormalForward = false;
      material.sideOrientation = Material.CounterClockWiseSideOrientation;
      material.bumpTexture = probe.name === 'true-normal-control' ? normalTexture : texture;
      const plugin =
        probe.name === 'true-normal-control'
          ? null
          : new ScalarHeightPlugin(material, texture, probe.scale);
      new ViewNormalOutput(material);
      h.observe(material);
      mesh.material = material;
      const threeMaterial = new THREE.MeshNormalMaterial(
        probe.name === 'true-normal-control'
          ? { normalMap: threeNormalTexture, side: THREE.DoubleSide }
          : { bumpMap: threeTexture, bumpScale: probe.scale, side: THREE.DoubleSide },
      );
      const threeMesh = new THREE.Mesh(geometry, threeMaterial);
      threeScene.add(threeMesh);
      texture.uScale = threeTexture.repeat.x = probe.uv ? 1.75 : 1;
      texture.vScale = threeTexture.repeat.y = probe.uv ? 0.75 : 1;
      texture.uOffset = threeTexture.offset.x = probe.uv ? 0.125 : 0;
      texture.vOffset = threeTexture.offset.y = probe.uv ? 0.25 : 0;
      const angle = probe.back ? Math.PI + 0.35 : 0.35;
      mesh.rotation.y = threeMesh.rotation.y = angle;
      if (probe.scaled) {
        mesh.scaling.set(1.3, 0.7, 1);
        threeMesh.scale.set(1.3, 0.7, 1);
      }
      await prepareOriginalMaterials(
        { meshes: [mesh], scene: h.scene } as unknown as AssetContainer,
        h.gpu,
        h.abort.signal,
        h.deadline,
        () => {},
      );
      await h.presented();
      const raw = h.capture();
      plugin?.setEnabled(true);
      await h.presented();
      const actual = h.capture();
      await threeGpu.prepare(probe.name, h.deadline, async () => {
        await renderer.compileAsync(threeScene, threeCamera);
      });
      const before = threeGpu.diagnostics().completed;
      while (threeGpu.diagnostics().completed < before + 2) {
        h.abort.signal.throwIfAborted();
        threeGpu.ready();
        if (threeGpu.diagnostics().completed >= before + 2) break;
        threeGpu.frame(schedule, false, threeScene, () => {
          renderer.render(threeScene, threeCamera);
          return true;
        });
        await yieldPreparationTurn(h.abort.signal, h.deadline);
      }
      const expected = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, expected);
      let comparedPixels = 0,
        maxChannelError = 0,
        sum = 0,
        changedFromRaw = 0,
        diagnosticSignalChannels = 0;
      const geometricNormal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(
          new THREE.Matrix4().multiplyMatrices(
            threeCamera.matrixWorldInverse,
            threeMesh.matrixWorld,
          ),
        ),
      );
      if (probe.back) geometricNormal.negate();
      const flatNormalBytes = geometricNormal
        .toArray()
        .map((value) => Math.round((value * 0.5 + 0.5) * 255));
      // Compare only interior coverage in BOTH renders; avoid raster boundary
      // ownership and derivative helper pixels, never discard normal outliers.
      for (let y = 2; y < 254; y++)
        for (let x = 2; x < 254; x++) {
          const i = (y * 256 + x) * 4;
          const interior = [-2, -1, 0, 1, 2].every(
            (d) =>
              expected[i + d * 4 + 3] === 255 &&
              actual.pixels[i + d * 4 + 3] === 255 &&
              expected[i + d * 256 * 4 + 3] === 255 &&
              actual.pixels[i + d * 256 * 4 + 3] === 255,
          );
          if (!interior) continue;
          comparedPixels++;
          for (let c = 0; c < 3; c++) {
            const error = Math.abs(actual.pixels[i + c] - expected[i + c]);
            maxChannelError = Math.max(maxChannelError, error);
            sum += error;
            if (Math.abs(expected[i + c] - flatNormalBytes[c]) > 2) diagnosticSignalChannels++;
            if (actual.pixels[i + c] !== raw.pixels[i + c]) changedFromRaw++;
          }
        }
      const effect = mesh.subMeshes[0]?.effect;
      if (!effect) throw new Error(`Missing controlled material effect: ${probe.name}`);
      // Query each completed context independently: short-circuiting getError
      // hid the context identity of the first uniform-buffer collision.
      const threeImage = canvas.toDataURL('image/png');
      const babylonGlError = h.gl.getError(),
        threeGlError = gl.getError();
      rows.push({
        name: probe.name,
        scale: probe.scale,
        comparedPixels,
        maxChannelError,
        meanChannelError: sum / (comparedPixels * 3),
        changedFromRaw,
        diagnosticSignalChannels,
        babylonImage: actual.image,
        threeImage,
        rawImage: raw.image,
        completedFrames: threeGpu.diagnostics().completed - before,
        babylonGlError,
        threeGlError,
        shaderSamplers: [...effect.getSamplers()],
        scalarShaderCode:
          /existingPlayer(?:ScalarNormal|HeightSampler|HeightScale|HeightEnabled)/.test(
            effect._fragmentSourceCode,
          ),
        glError: babylonGlError || threeGlError,
      });
      threeScene.remove(threeMesh);
      threeMaterial.dispose();
      mesh.dispose();
      material.dispose();
    }
  } catch (error) {
    failure = message(error);
  } finally {
    try {
      shaders = h.shaders(!!failure);
    } catch (error) {
      failure ??= message(error);
    }
    for (const cleanup of [
      () => threeGpu.dispose(),
      () =>
        threeScene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        }),
      () => renderer.dispose(),
      () => canvas.remove(),
      () => geometry.dispose(),
      () => threeTexture.dispose(),
      () => threeNormalTexture.dispose(),
      () => h.dispose(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failure ??= message(error);
      }
    }
  }
  return {
    failure,
    rows,
    shaders,
    threeShaderErrors,
    threeMaxFragmentSamplers: renderer.capabilities.maxTextures,
    threeRevision: THREE.REVISION,
    normalSpace: 'view',
    encoding: 'linear RGB8 = normal * .5 + .5',
  };
}

export async function babylonOriginalHeightParity() {
  const h = harness(1440, 900);
  h.scene.clearColor = new Color4(0.1, 0.15, 0.2, 1);
  const camera = new UniversalCamera('frozen-full-detail', new Vector3(0, 3, -8), h.scene);
  camera.minZ = 0.01;
  camera.maxZ = 1000;
  camera.fov = Math.PI / 3;
  const sky = new HemisphericLight('fixed-sky', new Vector3(0, 1, 0), h.scene);
  sky.intensity = 0.7;
  const sun = new DirectionalLight('fixed-sun', new Vector3(-0.3, -1, 0.4), h.scene);
  sun.intensity = 1.5;
  let container: AssetContainer | undefined,
    steering: ExistingPlayerSteering | undefined,
    adapter: ExistingPlayerHeightAdapter | undefined;
  let failure: string | null = null,
    compiled = 0;
  const rows: {
    view: string;
    enabled: boolean;
    disposed: boolean;
    image: string;
    differentChannels: number;
    completedFrames: number;
    matchingResources: boolean;
    unchangedPose: boolean;
    trueNormalControls: boolean;
    visiblePixels: number;
    activeIndices: number;
    glError: number;
  }[] = [];
  let retained: Record<string, number> = {};
  let selected: {
    material: number;
    image: number;
    scale: number;
    textureName: string;
    linearSampling: boolean;
  }[] = [];
  let shaders: ReturnType<typeof h.shaders> | undefined;
  let graphics: ReturnType<BabylonPresentationGpu['diagnostics']> | undefined;
  try {
    const response = await fetch(new URL('models/supplied-player.glb.gz', document.baseURI), {
      signal: h.abort.signal,
    });
    if (!response.ok) throw new Error(`Height source fetch failed: ${response.status}`);
    const raw = await decodeExistingPlayerBytes(
      new Uint8Array(await response.arrayBuffer()),
      h.abort.signal,
    );
    container = await loadExistingPlayer(h.scene, document.baseURI, h.abort.signal);
    steering = new ExistingPlayerSteering(container.animationGroups);
    const bindings = existingPlayerPrimitiveBindings(container);
    adapter = await createExistingPlayerHeightAdapter(raw, bindings);
    selected = EXISTING_PLAYER_HEIGHT_SOURCES.map((source, i) => ({
      material: source.material,
      image: source.image,
      scale: adapter!.scales[i],
      textureName: adapter!.materials[i].bumpTexture!.name,
      linearSampling: !adapter!.materials[i].bumpTexture!.getInternalTexture()!._useSRGBBuffer,
    }));
    const owners = bindings.map(({ mesh }) => ({
      material: mesh.material,
      geometry: mesh.geometry,
      indices: mesh.getIndices(),
      skeleton: mesh.skeleton,
      parent: mesh.parent,
      vertices: mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)),
    }));
    const materials = container.materials.filter(
      (material): material is PBRMaterial => material instanceof PBRMaterial,
    );
    materials.forEach(h.observe);
    const materialState = materials.map((material) => ({
      material,
      texture: material.bumpTexture,
      internal: material.bumpTexture?.getInternalTexture(),
      level: material.bumpTexture?.level,
      uv: material.bumpTexture?.getTextureMatrix().asArray().slice(),
      normalScale: material.bumpTexture?.level,
      invertX: material.invertNormalMapX,
      invertY: material.invertNormalMapY,
    }));
    const textures = [...container.textures],
      geometries = [...container.geometries];
    const bones = container.skeletons.flatMap((skeleton) => skeleton.bones);
    retained = {
      primitives: bindings.length,
      meshes: container.meshes.length,
      geometries: geometries.length,
      materials: container.materials.length,
      textures: textures.length,
      bones: bones.length,
      triangles: bindings.reduce((n, { mesh }) => n + mesh.getTotalIndices() / 3, 0),
    };
    const bounds = (meshes: Mesh[]) => {
      let low = new Vector3(Infinity, Infinity, Infinity),
        high = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        low = Vector3.Minimize(low, box.minimumWorld);
        high = Vector3.Maximize(high, box.maximumWorld);
      }
      return { center: low.add(high).scale(0.5), span: high.subtract(low).length() };
    };
    const all = bounds(bindings.map(({ mesh }) => mesh));
    const detail = (material: number) => {
      const meshes = bindings
        .filter((binding) => binding.source.material === material)
        .map(({ mesh }) => mesh);
      meshes.sort((a, b) => b.getTotalIndices() - a.getTotalIndices());
      if (!meshes[0]) throw new Error(`Missing source material ${material}`);
      return bounds([meshes[0]]);
    };
    const views = [
      { name: 'overview', ...all },
      { name: 'carbon-source-74', ...detail(74) },
      { name: 'tyre-source-94', ...detail(94) },
    ];
    await prepareOriginalMaterials(container, h.gpu, h.abort.signal, h.deadline, (done) => {
      compiled = done;
    });
    container.addAllToScene();
    let pose: string | undefined;
    const snapshotPose = () =>
      JSON.stringify({
        nodes: container!.transformNodes.map((node) => [
          node.position.asArray(),
          node.rotation.asArray(),
          node.scaling.asArray(),
          node.rotationQuaternion?.asArray(),
        ]),
        bones: bones.map((bone) => [...bone.getLocalMatrix().asArray()]),
      });
    for (const view of views) {
      // Fixed per-pair camera and unchanged full-detail visibility: no isolating,
      // hiding, material replacement, environment or mesh-quality changes.
      camera.position.copyFrom(
        view.center.add(new Vector3(view.span * 0.8, view.span * 0.45, -view.span * 0.85)),
      );
      camera.setTarget(view.center);
      let baseline: Uint8Array | undefined;
      // Keep the last raw camera/pixel baseline and every container resource
      // alive across adapter disposal. The plugin cannot detach; this final draw
      // must prove its null borrowed sampler is inert, not just toggle-off.
      const stages: readonly (boolean | 'disposed')[] =
        view === views.at(-1) ? [false, true, false, 'disposed'] : [false, true, false];
      for (const stage of stages) {
        const disposed = stage === 'disposed',
          enabled = stage === true;
        if (disposed) adapter.dispose();
        else adapter.setEnabled(enabled);
        const before = h.gpu.diagnostics().completed;
        await h.presented();
        pose ??= snapshotPose();
        const shot = h.capture();
        baseline ??= shot.pixels;
        let differentChannels = 0,
          visiblePixels = 0;
        for (let i = 0; i < shot.pixels.length; i++)
          if (shot.pixels[i] !== baseline[i]) differentChannels++;
        for (let i = 0; i < shot.pixels.length; i += 4)
          if (
            shot.pixels[i] !== shot.pixels[0] ||
            shot.pixels[i + 1] !== shot.pixels[1] ||
            shot.pixels[i + 2] !== shot.pixels[2]
          )
            visiblePixels++;
        const sameMaterial = (entry: (typeof materialState)[number]) =>
          entry.material.bumpTexture === entry.texture &&
          entry.texture?.getInternalTexture() === entry.internal &&
          entry.texture?.level === entry.level &&
          entry.material.invertNormalMapX === entry.invertX &&
          entry.material.invertNormalMapY === entry.invertY &&
          (!entry.uv ||
            entry
              .texture!.getTextureMatrix()
              .asArray()
              .every((value, index) => value === entry.uv![index]));
        const matchingResources =
          bindings.every(
            ({ mesh }, i) =>
              mesh.material === owners[i].material &&
              mesh.geometry === owners[i].geometry &&
              mesh.getIndices() === owners[i].indices &&
              mesh.skeleton === owners[i].skeleton &&
              mesh.parent === owners[i].parent &&
              mesh
                .getVerticesDataKinds()
                .every((kind, j) => mesh.getVertexBuffer(kind) === owners[i].vertices[j]),
          ) &&
          materialState.every(sameMaterial) &&
          container.meshes.length === retained.meshes &&
          container.materials.length === retained.materials &&
          container.geometries.length === geometries.length &&
          container.textures.length === textures.length &&
          container.textures.every((texture, i) => texture === textures[i]) &&
          container.geometries.every((geometry, i) => geometry === geometries[i]);
        rows.push({
          view: view.name,
          enabled,
          disposed,
          image: shot.image,
          differentChannels,
          completedFrames: h.gpu.diagnostics().completed - before,
          matchingResources,
          unchangedPose: snapshotPose() === pose,
          trueNormalControls: materialState
            .filter((entry) => entry.texture && !adapter!.materials.includes(entry.material))
            .every(
              (entry) =>
                sameMaterial(entry) &&
                !entry.material.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe'),
            ),
          visiblePixels,
          activeIndices: h.scene.getActiveIndices(),
          glError: h.gl.getError(),
        });
      }
    }
    graphics = h.gpu.diagnostics();
  } catch (error) {
    failure = message(error);
    graphics = h.gpu.diagnostics();
  } finally {
    try {
      shaders = h.shaders(!!failure);
    } catch (error) {
      failure ??= message(error);
    }
    // Cleanup cannot replace the first shader/GPU/assertion failure. Report a
    // teardown failure only if no preceding failure exists.
    for (const cleanup of [
      () => adapter?.dispose(),
      () => steering?.dispose(),
      () => container?.dispose(),
      () => h.dispose(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failure ??= message(error);
      }
    }
  }
  return {
    failure,
    compiled,
    retained,
    selected,
    rows,
    graphics,
    shaders,
    sourceSHA256: manifest.sha256,
    productionActivated: false,
  };
}
