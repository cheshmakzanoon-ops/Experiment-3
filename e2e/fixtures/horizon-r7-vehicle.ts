/** Isolated production-car geometry review. Camera and neutral studio lighting
 * are authored test inputs; this is not a full-world or human-driving capture.
 * The runner serves frozen source bytes for both variants. There is no product
 * feature toggle or comparison-only change to the vehicle builder. */
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import { buildVehicleBody } from '../../src/rendering/vehicle-bodies/index.ts';
import { bodySheetFor } from '../../src/rendering/vehicle-bodies/body-sheet.ts';
import { textures } from '../../src/rendering/materials/library.ts';

declare const __APEX_SOURCE_FINGERPRINT__: string;
declare const __APEX_SOURCE_COMMIT__: string | null;

const WIDTH = 1120,
  HEIGHT = 700;
const SHOTS = [
  {
    name: 'rh3-front-quarter',
    vehicle: 'rh3',
    eye: [3.5, 2.35, 4.5],
    target: [0, 0.96, 0.15],
    fov: 38,
  },
  {
    name: 'rh3-windscreen',
    vehicle: 'rh3',
    eye: [1.35, 2.05, 2.8],
    target: [0.08, 1.12, 0.47],
    fov: 34,
  },
  {
    name: 'rh3-side-glass',
    vehicle: 'rh3',
    eye: [2.1, 1.63, 0.32],
    target: [0.42, 1.15, -0.17],
    fov: 38,
  },
  {
    name: 'sc7-rear-glass',
    vehicle: 'sc7',
    eye: [1.5, 2.36, -3.0],
    target: [0, 1.08, -0.65],
    fov: 34,
  },
  {
    name: 'rh3-front-wheel',
    vehicle: 'rh3',
    eye: [2.08, 0.71, 2.05],
    target: [0.79, 0.34, 1.22],
    fov: 34,
  },
  {
    name: 'sc7-front-quarter',
    vehicle: 'sc7',
    eye: [3.5, 2.05, 4.65],
    target: [0, 0.77, 0.15],
    fov: 38,
  },
  {
    name: 'sc7-front-wheel',
    vehicle: 'sc7',
    eye: [2.15, 0.72, 2.02],
    target: [0.83, 0.35, 1.22],
    fov: 34,
  },
  {
    name: 'rh3-rear-quarter',
    vehicle: 'rh3',
    eye: [3.45, 1.75, -4.55],
    target: [0, 0.82, -0.28],
    fov: 38,
  },
  {
    name: 'sc7-rear-quarter',
    vehicle: 'sc7',
    eye: [3.45, 1.4, -4.65],
    target: [0, 0.69, -0.3],
    fov: 38,
  },
  {
    name: 'sc7-side-duct',
    vehicle: 'sc7',
    eye: [2.4, 1.08, -0.2],
    target: [0.82, 0.63, -0.6],
    fov: 36,
  },
] as const;

const canvas = document.createElement('canvas');
document.body.append(canvas);
const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = false;
const scene = new T.Scene();
scene.background = new T.Color(0x343b42);
scene.environmentIntensity = 0.65;
const room = new RoomEnvironment();
const pmrem = new T.PMREMGenerator(renderer);
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
room.dispose();
pmrem.dispose();
scene.add(new T.HemisphereLight(0xe2edff, 0x3e3b35, 1.15));
const sun = new T.DirectionalLight(0xffeedc, 2.8);
sun.position.set(5, 7, 4);
scene.add(sun);
const floor = new T.Mesh(
  new T.PlaneGeometry(200, 200),
  new T.MeshStandardMaterial({ color: 0x565957, roughness: 0.93, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.005;
scene.add(floor);
const camera = new T.PerspectiveCamera(38, WIDTH / HEIGHT, 0.03, 220);
const bodies = new Map<string, ReturnType<typeof buildVehicleBody>>();
for (const id of ['rh3', 'sc7']) {
  const definition = VEHICLES[id];
  const sheet = bodySheetFor(definition);
  if (!sheet) throw new Error(`Missing production body sheet ${id}`);
  const body = buildVehicleBody(0, definition, sheet);
  body.root.position.y = -body.frame.ground;
  body.root.visible = false;
  if (body.lods[0].cabin) {
    body.lods[0].cabin.detail.visible = true;
    for (const part of body.lods[0].cabin.wheelDetail) part.visible = true;
  }
  body.materials.head.emissiveIntensity = 0;
  body.materials.tail.emissiveIntensity = 0;
  scene.add(body.root);
  bodies.set(id, body);
}
const proceduralBakes = textures.bake(renderer);
scene.updateMatrixWorld(true);
let disposed = false;

const sourceIdentity = () => ({
  fingerprint: typeof __APEX_SOURCE_FINGERPRINT__ === 'string' ? __APEX_SOURCE_FINGERPRINT__ : null,
  commit: typeof __APEX_SOURCE_COMMIT__ === 'string' ? __APEX_SOURCE_COMMIT__ : null,
});

function bytesBase64(bytes: Uint8Array) {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

function resources(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  let attributeBytes = 0,
    indexBytes = 0,
    nonFinite = 0;
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      materials.add(material);
  });
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) {
      attributeBytes += attribute.array.byteLength;
      for (const value of attribute.array) if (!Number.isFinite(value)) nonFinite++;
    }
    indexBytes += geometry.index?.array.byteLength ?? 0;
  }
  return {
    geometries: geometries.size,
    materials: materials.size,
    attributeBytes,
    indexBytes,
    nonFinite,
  };
}

function draw() {
  renderer.info.reset();
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  gl.finish();
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return {
    image: canvas.toDataURL('image/png'),
    rgba: bytesBase64(rgba),
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    memory: { ...renderer.info.memory },
    glError: gl.getError(),
  };
}

function capture(name: string) {
  if (disposed) throw new Error('Vehicle review is disposed');
  const shot = SHOTS.find((candidate) => candidate.name === name);
  if (!shot) throw new Error(`Unknown vehicle view ${name}`);
  for (const [id, body] of bodies) body.root.visible = id === shot.vehicle;
  const body = bodies.get(shot.vehicle)!;
  camera.position.fromArray(shot.eye);
  camera.lookAt(new T.Vector3().fromArray(shot.target));
  camera.fov = shot.fov;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const first = draw(),
    repeated = draw();
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const glass =
    body.lods[0].cabin?.glass.map((mesh) => ({
      name: mesh.name,
      groups: mesh.geometry.groups.length,
      construction: mesh.geometry.userData.festivalGlazing ?? null,
    })) ?? [];
  return {
    name,
    vehicle: shot.vehicle,
    camera: shot,
    sourceIdentity: sourceIdentity(),
    rendererName: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
    dimensions: { width: WIDTH, height: HEIGHT },
    first,
    repeated,
    resourceInventory: resources(body.root),
    glazing: glass,
    shaderDiagnostics: (renderer.info.programs ?? []).map((program) => {
      const diagnostic = (
        program as unknown as {
          diagnostics?: {
            runnable?: boolean;
            programLog?: string;
            vertexShader?: { log?: string };
            fragmentShader?: { log?: string };
          };
        }
      ).diagnostics;
      return {
        runnable: diagnostic?.runnable ?? true,
        programLog: diagnostic?.programLog ?? '',
        vertexLog: diagnostic?.vertexShader?.log ?? '',
        fragmentLog: diagnostic?.fragmentShader?.log ?? '',
      };
    }),
    proceduralBakes,
    limitation:
      'Static isolated production vehicle geometry at LOD0 with a visible near cabin and fixed studio light; no worker, motion, full-world compositor or target-device performance claim.',
  };
}

function dispose() {
  if (disposed) return;
  disposed = true;
  const geometrySet = new Set<T.BufferGeometry>(),
    materialSet = new Set<T.Material>(),
    textureSet = new Set<T.Texture>();
  scene.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    geometrySet.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materialSet.add(material);
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textureSet.add(value);
    }
  });
  for (const body of bodies.values()) body.lods[0].cabin?.display?.dispose();
  for (const geometry of geometrySet) geometry.dispose();
  for (const material of materialSet) material.dispose();
  for (const texture of textureSet) texture.dispose();
  environment.dispose();
  textures.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  canvas.remove();
}

declare global {
  interface Window {
    horizonR7Vehicle: {
      shots: string[];
      capture: typeof capture;
      sourceIdentity: typeof sourceIdentity;
      dispose: typeof dispose;
    };
  }
}
window.horizonR7Vehicle = {
  shots: SHOTS.map((shot) => shot.name),
  capture,
  sourceIdentity,
  dispose,
};
