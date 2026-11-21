import * as T from 'three';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { MxVenueWind } from '../../src/rendering/offroad/mx-venue-wind.ts';
import { MxCourseDressing } from '../../src/rendering/offroad/mx-course-dressing.ts';
import { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys } from '../../src/rendering/studio/shader-hooks.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';

const WIDTH = 1120,
  HEIGHT = 700;
const names = ['MX shoulder grass islands', 'MX shoulder fern fans', 'MX shoulder broadleaf scrub'];

/** Production terrain and course dressing at a fixed, mixed shoulder patch.
 * This isolated component view verifies plant shaders and absolute-time wind;
 * it is not the full game's lighting, scenery, or a gameplay FPS measurement. */
export async function captureMotocrossShoulderPlants() {
  const track = rigTrack('valley-ridge-mx'),
    surface = Track.offroadOf(track) as TrackTerrainSurface,
    sourceHash = surface.terrain.hash(),
    terrain = new TerrainView(track),
    wind = new MxVenueWind(),
    dressing = new MxCourseDressing(track, wind),
    plants = names.map((name) => dressing.root.getObjectByName(name) as T.InstancedMesh);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0xb7c7d2);
  const camera = new T.PerspectiveCamera(48, WIDTH / HEIGHT, 0.1, 250),
    key = new T.DirectionalLight(0xfff2dd, 2.8),
    p = track.at(710, trackPoint()),
    q = track.at(704, trackPoint()),
    targetLateral = -10.2,
    cameraLateral = -5.5,
    target = new T.Vector3(
      p.x + p.nx * targetLateral,
      surface.terrain.baseHeight(p.s, targetLateral) + 0.32,
      p.z + p.nz * targetLateral,
    );
  camera.position.set(
    q.x + q.nx * cameraLateral,
    surface.terrain.baseHeight(q.s, cameraLateral) + 2.6,
    q.z + q.nz * cameraLateral,
  );
  camera.lookAt(target);
  key.position.set(
    target.x - p.tx * 18 + p.nx * 20,
    target.y + 20,
    target.z - p.tz * 18 + p.nz * 20,
  );
  key.target.position.copy(target);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {
    left: -22,
    right: 22,
    top: 22,
    bottom: -22,
    near: 0.1,
    far: 100,
  });
  key.shadow.normalBias = 0.025;
  scene.add(
    terrain.group,
    dressing.root,
    key,
    key.target,
    new T.HemisphereLight(0xc9ddee, 0x65523f, 1.05),
  );
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    ),
    matrix = new T.Matrix4(),
    root = new T.Vector3(),
    foliage = plants.map((mesh) => {
      let rootsInView = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        root.setFromMatrixPosition(matrix);
        root.y += 0.3;
        if (frustum.containsPoint(root)) rootsInView++;
      }
      return {
        name: mesh.name,
        instances: mesh.count,
        rootsInView,
        triangles:
          ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
          mesh.count,
        attributeBytes: Object.values(mesh.geometry.attributes).reduce(
          (sum, a) => sum + a.array.byteLength,
          0,
        ),
        instanceBytes:
          mesh.instanceMatrix.array.byteLength + (mesh.instanceColor?.array.byteLength ?? 0),
      };
    });
  const capture = (
    label: string, time: number, view: 'review' | 'full' | 'culled' = 'review',
    pixels = new Uint8Array(WIDTH * HEIGHT * 4),
  ) => {
    dressing.update(time);
    if (view === 'culled') dressing.inCameraView(camera, () => renderer.render(scene, camera));
    else renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return {
      label,
      time,
      hash,
      image: view === 'review' ? renderer.domElement.toDataURL('image/png') : '',
      glError: gl.getError(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
      },
    };
  };
  try {
    materials.prepare(renderer);
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000)))
      throw new Error(
        `Shoulder soil scans unavailable: ${JSON.stringify(scannedGround.diagnostics())}`,
      );
    const soilMaterial = terrain.material as T.MeshPhysicalMaterial & {
      defines?: Record<string, string>;
    };
    if (!('APEX_SCAN' in (soilMaterial.defines ?? {})))
      throw new Error('The shoulder review did not enter the production scanned-soil path');
    dressing.update(10);
    // Compile the resident material and shadow variants before measuring.
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    const samples = [
      capture('wind-10', 10),
      capture('wind-11', 11),
      capture('wind-11-held', 11),
      capture('wind-10-seek', 10),
    ];
    // A frozen race clock isolates the direction response from the animation.
    // At zero wind, two different race times must produce identical pixels.
    const weather = [];
    for (const [x, z, t] of [
      [8, 2, 10],
      [-8, -2, 10],
      [0, 0, 10],
      [0, 0, 17],
      [8, 2, 10],
    ]) {
      wind.set(x, z);
      const { hash, calls, triangles, glError } = capture('recorded-wind', t, 'full');
      weather.push({ x, z, t, hash, calls, triangles, glError });
    }
    scene.add(dressing.turf);
    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = false;
    const comparePlants = () => {
      const original = new Uint32Array(WIDTH * HEIGHT),
        compact = new Uint32Array(original.length);
      const measure = (view: 'full' | 'culled', rgba: Uint32Array<ArrayBuffer>) => {
        const { hash, triangles, calls, glError } = capture(
          'all-plants',
          10,
          view,
          new Uint8Array(rgba.buffer),
        );
        return { hash, triangles, calls, error: glError };
      };
      const full = measure('full', original),
        culled = measure('culled', compact);
      let changedPixels = 0;
      for (let i = 0; i < original.length; i++) if (original[i] !== compact[i]) changedPixels++;
      return { full, culled, comparedPixels: original.length, changedPixels };
    };
    const cameraPlants = comparePlants();
    // Retain a nonidentity venue transform in the same frozen-matrix render
    // order as the live game. An identity camera batch produces different pixels.
    dressing.root.position.set(0.45, 0.12, -0.25);
    dressing.turf.position.copy(dressing.root.position);
    scene.updateMatrixWorld(true);
    const movedPlants = comparePlants();
    return {
      cameraPlants,
      movedPlants,
      weather,
      scope:
        'Isolated production TerrainView and MxCourseDressing; fixed component-review lighting.',
      circuit: 'valley-ridge-mx',
      cameraPose: {
        station: p.s,
        side: -1,
        position: camera.position.toArray(),
        target: target.toArray(),
      },
      samples,
      sourceUnchanged: sourceHash === surface.terrain.hash(),
      foliage,
      sharedPlantMaterial: plants.every((mesh) => mesh.material === plants[0].material),
      plantTextures: (plants[0].material as T.MeshStandardMaterial).map !== null,
      windHooks: studioHookKeys(plants[0].material as T.Material),
      soilHooks: studioHookKeys(terrain.material),
      scans: scannedGround.diagnostics(),
    };
  } finally {
    scannedGround.detach(renderer);
    dressing.dispose();
    terrain.dispose();
    key.shadow.map?.dispose();
    key.shadow.mapPass?.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
