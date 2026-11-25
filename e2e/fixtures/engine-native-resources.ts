import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { TextureBudget } from '../../src/rendering/texture-budget.ts';

export interface OwnerSources {
  festival: string;
  circuit: string;
}
type Owner = Record<string, unknown> & {
  disposed: boolean;
  outputPass: OutputPass;
  dispose(): void;
};
const inert = () => ({ dispose() {} });
const stages = {
  festival: [
    'atmosphere',
    'terrain',
    'roads',
    'streetLights',
    'practicalLights',
    'buildings',
    'dressing',
    'crops',
    'details',
    'streetDetails',
    'contacts',
    'vegetation',
    'photoVegetation',
    'water',
    'markers',
    'reflection',
    'cars',
    'trails',
    'guidance',
    'orbit',
    'environment',
    'wet',
    'shadows',
    'bloom',
    'grade',
    'fxaa',
    'imagePipeline',
    'ultra',
    'photoSky',
    'gpuFrames',
  ],
  circuit: [
    'gridPreparation',
    'pitCrew',
    'gridPerformance',
    'reflection',
    'shadowProxies',
    'farShadow',
    'gpuTimer',
    'gpuFrames',
    'motionBlur',
    'exposure',
    'weatherPresentation',
    'bloom',
    'fxaa',
    'scenePass',
    'grade',
    'ultra',
    'environment',
    'photoSky',
  ],
};

function renderer() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setSize(64, 64);
  renderer.outputColorSpace = T.LinearSRGBColorSpace;
  renderer.toneMapping = T.NoToneMapping;
  const gl = renderer.getContext();
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const backend = extension
    ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  return { renderer, canvas, gl, backend };
}
function memory(renderer: T.WebGLRenderer) {
  return {
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
    programs: renderer.info.programs?.length ?? 0,
    programUses: renderer.info.programs?.reduce((sum, program) => sum + program.usedTimes, 0) ?? 0,
  };
}
function paint(canvas: HTMLCanvasElement, solid = false) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Native Canvas 2D unavailable');
  if (solid) {
    context.fillStyle = '#ffff00';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  for (const [x, y, color] of [
    [0, 0, '#ff0000'],
    [1, 0, '#00ff00'],
    [0, 1, '#0000ff'],
    [1, 1, '#ffffff'],
  ] as const) {
    context.fillStyle = color;
    context.fillRect(
      (x * canvas.width) / 2,
      (y * canvas.height) / 2,
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}
function image() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  paint(canvas);
  return canvas;
}
function mesh(maps: T.Texture[]) {
  return new T.Mesh(
    new T.PlaneGeometry(2, 2),
    maps.map((map) => new T.MeshBasicMaterial({ map })),
  );
}
function difference(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) throw new Error('Pixel lengths differ');
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
  return changed;
}
function pixelHash(values: ArrayLike<number>) {
  let hash = 2166136261;
  for (let i = 0; i < values.length; i++) hash = Math.imul(hash ^ values[i], 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Observe the actual backend-owned VSM blur triangle. It is not in the scene
 * graph and Three 0.180 keeps its geometry counter after renderer.dispose(). */
function observeVsm(renderer: T.WebGLRenderer) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const draw = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (
      material instanceof T.ShaderMaterial &&
      material.defines.VSM_SAMPLES === 8 &&
      'shadow_pass' in material.uniforms
    ) {
      geometries.add(geometry);
      materials.add(material);
    } else if (material instanceof T.MeshDepthMaterial) materials.add(material);
    draw.call(this, camera, scene, geometry, material, object, group);
  };
  return {
    geometries,
    materials,
    restore: () => {
      renderer.renderBufferDirect = draw;
    },
  };
}
function bytes(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Native Canvas 2D unavailable');
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
function reference(source: HTMLCanvasElement, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Native Canvas 2D unavailable');
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}
function pixelReader(renderer: T.WebGLRenderer) {
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const material = new T.MeshBasicMaterial({
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  const plane = new T.Mesh(new T.PlaneGeometry(2, 2), material);
  const scene = new T.Scene().add(plane);
  const target = new T.WebGLRenderTarget(64, 32, { depthBuffer: false });
  return {
    read(map: T.Texture | null, color = 0xffffff) {
      material.map = map;
      material.color.setHex(color);
      material.needsUpdate = true;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const out = new Uint8Array(64 * 32 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 64, 32, out);
      renderer.setRenderTarget(null);
      return out;
    },
    dispose() {
      material.dispose();
      plane.geometry.dispose();
      target.dispose();
    },
  };
}

/** Native source pixels and GPU allocations are measured, not inferred from
 * version counters. No authored scene or material definition is loaded. */
export function textureRegistration() {
  const r = renderer();
  const generatedImage = image(),
    importedImage = image();
  const generated = new T.CanvasTexture(generatedImage);
  const supplied = new T.Texture(importedImage);
  supplied.flipY = false;
  supplied.userData.immutableAssetTexture = true;
  const generatedMaps = [generated, ...Array.from({ length: 511 }, () => generated.clone())];
  const importedMaps = [supplied, ...Array.from({ length: 511 }, () => supplied.clone())];
  const hero = generated.clone();
  hero.userData.textureBudgetScale = 2;
  hero.userData.cpuReadback = true;
  const maps = [...generatedMaps, ...importedMaps, hero];
  const originals = maps.map((map) => map.source);
  const root = mesh(maps);
  const budget = new TextureBudget();
  budget.configure(64, 2);
  const versions = maps.map((map) => map.version);
  let drawCalls = 0;
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...args: unknown[]) {
    drawCalls++;
    Reflect.apply(drawImage, this, args);
  };
  try {
    budget.register(root);
  } finally {
    CanvasRenderingContext2D.prototype.drawImage = drawImage;
  }
  const registration = {
    wrappers: maps.length,
    drawCalls,
    versionIncrements: maps.reduce((sum, map, i) => sum + map.version - versions[i], 0),
    groups: new Set(maps.map((map) => map.source)).size,
    sizes: [generated, supplied, hero].map((map) => [map.image.width, map.image.height]),
    filters: [generated, supplied, hero].map((map) => ({
      minFilter: map.minFilter,
      mipmaps: map.generateMipmaps,
      anisotropy: map.anisotropy,
    })),
  };
  const beforeUpload = memory(r.renderer);
  maps.forEach((map) => r.renderer.initTexture(map));
  const afterUpload = memory(r.renderer);
  const reader = pixelReader(r.renderer);
  const references: T.Texture[] = [];
  const pixels = [generated, supplied, hero].map((map, i) => {
    const cpu = reference(
      i === 1 ? importedImage : generatedImage,
      map.image.width,
      map.image.height,
    );
    const ref = new T.Texture(cpu);
    ref.flipY = map.flipY;
    ref.minFilter = map.minFilter;
    ref.anisotropy = map.anisotropy;
    ref.needsUpdate = true;
    references.push(ref);
    const actualCanvas = bytes(map.image as HTMLCanvasElement),
      expectedCanvas = bytes(cpu);
    const actualGpu = reader.read(map),
      expectedGpu = reader.read(ref);
    return {
      canvasDifferences: difference(actualCanvas, expectedCanvas),
      gpuDifferences: difference(actualGpu, expectedGpu),
      canvasHash: pixelHash(actualCanvas),
      referenceCanvasHash: pixelHash(expectedCanvas),
      gpuHash: pixelHash(actualGpu),
      referenceGpuHash: pixelHash(expectedGpu),
    };
  });
  paint(generatedImage, true);
  const late = generated.clone();
  const lateRoot = mesh([late]);
  budget.register(lateRoot);
  const refreshed = reader.read(generated);
  const refreshedCenter = Array.from(refreshed.slice((16 * 64 + 32) * 4, (16 * 64 + 32) * 4 + 4));
  budget.configure(256, 4);
  const fullSize = [generated, supplied, hero].map((map) => [map.image.width, map.image.height]);
  const originalImages =
    generated.image === generatedImage &&
    supplied.image === importedImage &&
    hero.image === generatedImage;
  budget.dispose();
  const restored = maps.every((map, i) => map.source === originals[i]);
  const lateRestored = late.source === originals[0];
  reader.dispose();
  references.forEach((map) => map.dispose());
  [...maps, late].forEach((map) => map.dispose());
  for (const value of [root, lateRoot]) {
    value.geometry.dispose();
    for (const material of value.material) material.dispose();
  }
  const afterCleanup = memory(r.renderer);
  const glError = r.gl.getError();
  const lost = r.gl.isContextLost();
  r.renderer.dispose();
  r.canvas.remove();
  return {
    backend: r.backend,
    registration,
    beforeUpload,
    afterUpload,
    pixels,
    refreshedCenter,
    fullSize,
    originalImages,
    restored,
    lateRestored,
    afterCleanup,
    glError,
    lost,
  };
}

function makeOwner(source: string, kind: keyof typeof stages, renderer: T.WebGLRenderer) {
  const Constructor = new Function(
    'T',
    'OutputPass',
    'scannedGround',
    'disposeTextureLoaders',
    'disposeSceneTexture',
    `${source}; return Owner;`,
  )(
    T,
    OutputPass,
    { detach() {} },
    async () => {},
    (texture: T.Texture) => texture.dispose(),
  ) as new () => Owner;
  const owner = new Constructor();
  const sky = new Sky();
  sky.scale.setScalar(20);
  sky.material.uniforms.sunPosition.value.set(0.2, 1, 0.1);
  const sun = new T.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(32, 32);
  const box = new T.Mesh(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshStandardMaterial({ color: 0xffffff }),
  );
  box.position.y = 0.5;
  box.castShadow = true;
  const floor = new T.Mesh(
    new T.PlaneGeometry(6, 6),
    new T.MeshStandardMaterial({ color: 0x808080 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const group = new T.Group().add(box, floor);
  const scene = new T.Scene().add(sky, sun, group);
  const camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 2, 4);
  camera.lookAt(0, 0.5, 0);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(owner.outputPass);
  // Allocate both buffers even though this small two-pass fixture can present
  // after writing only one of them in its first frame.
  renderer.initRenderTarget(composer.renderTarget1);
  renderer.initRenderTarget(composer.renderTarget2);
  Object.assign(owner, Object.fromEntries(stages[kind].map((key) => [key, inert()])), {
    disposed: false,
    renderer,
    scene,
    sky,
    sun,
    composer,
    vehiclePaint: [],
    vehicleRoots: [],
    effectPlayback: { reset() {} },
    effects: { group },
  });
  if (kind === 'circuit')
    Object.assign(owner, {
      textures: new TextureBudget(),
      cars: [],
      bikeShells: { disposeAll() {} },
      releaseCarTemplates: inert,
      circuit: {
        disposePlanting() {},
        secondaryStands: inert(),
        wetReflection: inert(),
        stateTexture: new T.Texture(),
        disposalMaterials: () => new Set<T.Material>(),
      },
    });
  composer.render();
  if (!sun.shadow.map || !sun.shadow.mapPass)
    throw new Error('Native VSM shadow targets were not allocated');
  const resources = {
    skyGeometry: sky.geometry,
    skyMaterial: sky.material,
    shadowMap: sun.shadow.map,
    shadowPass: sun.shadow.mapPass,
    outputMaterial: owner.outputPass.material,
    composerRead: composer.renderTarget1,
    composerWrite: composer.renderTarget2,
  };
  const events: Record<string, number> = {};
  for (const [name, resource] of Object.entries(resources)) {
    events[name] = 0;
    resource.addEventListener('dispose', () => events[name]++);
  }
  return { owner, resources, events, scene };
}

/** Repeat the exact Festival disposer against rendered native Sky, VSM shadow
 * targets, composer and output pass. Only unrelated scene owners are inert. */
export function festivalCycles(source: string) {
  const r = renderer();
  r.renderer.shadowMap.enabled = true;
  r.renderer.shadowMap.type = T.VSMShadowMap;
  const reader = pixelReader(r.renderer);
  reader.read(null, 0x00ff00);
  const baseline = memory(r.renderer);
  let backendDisposals = 0;
  const dispose = r.renderer.dispose.bind(r.renderer);
  r.renderer.dispose = () => {
    backendDisposals++;
    dispose();
  };
  const cycles = [];
  for (let cycle = 0; cycle < 6; cycle++) {
    const f = makeOwner(source, 'festival', r.renderer);
    const active = memory(r.renderer);
    const failure = new Error('controlled sky disposal listener');
    if (cycle === 3)
      f.resources.skyMaterial.addEventListener('dispose', () => {
        f.owner.dispose();
        throw failure;
      });
    let caught = false;
    try {
      f.owner.dispose();
    } catch (error) {
      if (error !== failure) throw error;
      caught = true;
    }
    f.owner.dispose();
    const pixels = reader.read(null, 0x00ff00);
    cycles.push({
      active,
      released: memory(r.renderer),
      events: f.events,
      caught,
      emptyScene: f.scene.children.length === 0,
      pixel: Array.from(pixels.slice(0, 4)),
      contextLost: r.gl.isContextLost(),
      glError: r.gl.getError(),
      backendDisposals,
    });
  }
  reader.dispose();
  dispose();
  r.canvas.remove();
  return { backend: r.backend, baseline, cycles, backendDisposals };
}

/** Both budgets and the full circuit disposer operate on uploaded native
 * textures. A callback failure cannot prevent later original-source handoff. */
export function mixedCircuitFailure(source: string, kind: 'imported' | 'generated') {
  const r = renderer();
  r.renderer.shadowMap.enabled = true;
  r.renderer.shadowMap.type = T.VSMShadowMap;
  const internal = observeVsm(r.renderer);
  const f = makeOwner(source, 'circuit', r.renderer);
  internal.restore();
  type Program = NonNullable<T.WebGLRenderer['info']['programs']>[number];
  const internalPrograms = new Set<Program>();
  for (const material of internal.materials) {
    const properties = r.renderer.properties.get(material) as { programs?: Map<string, Program> };
    for (const program of properties.programs?.values() ?? []) internalPrograms.add(program);
  }
  const generated = new T.CanvasTexture(image());
  const imported = new T.Texture(image());
  imported.flipY = false;
  imported.userData.immutableAssetTexture = true;
  imported.userData.foliageAlphaCutoff = 0.45;
  const maps = [generated, generated.clone(), imported, imported.clone()];
  const originals = maps.map((map) => map.source);
  const root = mesh(maps);
  f.scene.add(root);
  const budget = f.owner.textures as TextureBudget;
  budget.configure(64, 2);
  budget.register(root);
  maps.forEach((map) => r.renderer.initTexture(map));
  const active = memory(r.renderer);
  const snapshots: boolean[][] = [];
  f.owner.suppliedPlayerAsset = {
    dispose() {
      snapshots.push(maps.map((map, i) => map.source === originals[i]));
    },
  };
  let backendDisposals = 0;
  const dispose = r.renderer.dispose.bind(r.renderer);
  r.renderer.dispose = () => {
    backendDisposals++;
    dispose();
  };
  const throwing = kind === 'imported' ? imported : generated;
  const owned = throwing.source;
  const callbackSources: string[] = [];
  // Install the controlled failure after native upload so Three's existing GPU
  // release listener runs first; this does not assert that arbitrary listeners
  // registered before Three cannot block that same resource's event dispatch.
  const fault = () => {
    callbackSources.push(throwing.source === owned ? 'budget' : 'original');
    f.owner.dispose();
    throw undefined;
  };
  throwing.addEventListener('dispose', fault);
  let threw = false,
    firstWasUndefined = false;
  try {
    f.owner.dispose();
  } catch (error) {
    threw = true;
    firstWasUndefined = error === undefined;
  }
  f.owner.dispose();
  const restored = maps.every((map, i) => map.source === originals[i]);
  const foliageRestored = imported.mipmaps.length === 0 && imported.generateMipmaps;
  const released = memory(r.renderer);
  const glError = r.gl.getError();
  const contextLost = r.gl.isContextLost();
  const internalVsmGeometries = internal.geometries.size;
  const internalVsmPrograms = internalPrograms.size;
  const onlyBackendProgramsRemain = (r.renderer.info.programs ?? []).every((program) =>
    internalPrograms.has(program),
  );
  // Fixture cleanup only: the production owner does not own this private
  // renderer triangle. Releasing the observed native object identifies the
  // entire residual geometry count without hiding any scene allocation.
  for (const geometry of internal.geometries) geometry.dispose();
  for (const program of internalPrograms) program.destroy();
  const afterInternalCleanup = memory(r.renderer);
  const liveInternalPrograms = [...internalPrograms].filter(
    (program) => program.program && r.gl.isProgram(program.program),
  ).length;
  throwing.removeEventListener('dispose', fault);
  r.canvas.remove();
  return {
    backend: r.backend,
    active,
    released,
    snapshots,
    callbackSources,
    threw,
    firstWasUndefined,
    restored,
    foliageRestored,
    backendDisposals,
    events: f.events,
    glError,
    contextLost,
    internalVsmGeometries,
    internalVsmPrograms,
    onlyBackendProgramsRemain,
    afterInternalCleanup,
    liveInternalPrograms,
  };
}
