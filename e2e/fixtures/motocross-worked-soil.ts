import * as T from 'three';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys } from '../../src/rendering/studio/shader-hooks.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';

type Circuit = 'valley-ridge-mx' | 'arena-nord-sx';
const WIDTH = 1120,
  HEIGHT = 700;

/** The production terrain alone, photographed from a normal approach and an
 * oblique berm inspection. This isolates soil changes; it is not application
 * lighting, a gameplay performance test, or a replacement collision surface. */
export async function captureMotocrossWorkedSoil(circuit: Circuit) {
  const track = rigTrack(circuit),
    surface = Track.offroadOf(track) as TrackTerrainSurface,
    terrain = surface.terrain,
    view = new TerrainView(track),
    sourceHash = terrain.hash();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0xb7c7d2);
  const camera = new T.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 700),
    key = new T.DirectionalLight(0xfff2dd, 2.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  Object.assign(key.shadow.camera, {
    left: -36,
    right: 36,
    top: 36,
    bottom: -36,
    near: 0.1,
    far: 130,
  });
  key.shadow.normalBias = 0.025;
  scene.add(view.group, key, key.target, new T.HemisphereLight(0xc9ddee, 0x65523f, 1.05));
  const meshes = view.group.children as T.Mesh[],
    p = trackPoint(),
    q = trackPoint();
  const position = (kind: 'approach' | 'berm') => {
    const berm = surface.course.spec.berms[0],
      station = kind === 'approach' ? surface.course.jumps[0].start - 1 : (berm.from + berm.to) / 2;
    track.at(station, p);
    const side = berm.side ?? -Math.sign(p.curvature),
      targetLateral = kind === 'berm' ? side * p.width * 0.45 : 0,
      target = new T.Vector3(
        p.x + p.nx * targetLateral,
        terrain.baseHeight(station, targetLateral) + 0.35,
        p.z + p.nz * targetLateral,
      );
    if (kind === 'approach') {
      track.at(station - 13, q);
      camera.position.set(q.x, terrain.baseHeight(q.s, 0) + 3.2, q.z);
      track.at(station + 6, q);
      camera.lookAt(q.x, terrain.baseHeight(q.s, 0) + 0.6, q.z);
    } else {
      camera.position.set(
        target.x - p.tx * 8 - p.nx * side * 8,
        target.y + 6.2,
        target.z - p.tz * 8 - p.nz * side * 8,
      );
      camera.lookAt(target);
    }
    key.target.position.copy(target);
    key.position.set(
      target.x - p.tx * 24 + p.nx * 29,
      target.y + 23,
      target.z - p.tz * 24 + p.nz * 29,
    );
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    return { station, width: p.width, camera: camera.position.toArray(), target: target.toArray() };
  };
  const capture = (label: string) => {
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return {
      label,
      image: renderer.domElement.toDataURL('image/png'),
      hash,
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
        `Worked-soil scans unavailable: ${JSON.stringify(scannedGround.diagnostics())}`,
      );
    const results = [];
    for (const angle of ['approach', 'berm'] as const) {
      const cameraPose = position(angle);
      view.record({ reset: true, wetness: 0, blocks: new Float32Array() }, 0, true);
      const prepared = capture(`${angle}-prepared`);
      view.record({ reset: false, wetness: 0.72, blocks: new Float32Array() }, 8, true);
      const wet = capture(`${angle}-wet`),
        held = capture(`${angle}-wet-held`);
      view.showAt(0);
      const restored = capture(`${angle}-prepared-restored`);
      results.push({ angle, cameraPose, samples: [prepared, wet, held, restored] });
    }
    return {
      circuit,
      results,
      sourceUnchanged: sourceHash === terrain.hash(),
      geometry: {
        meshes: meshes.length,
        vertices: meshes.reduce(
          (sum, mesh) => sum + mesh.geometry.getAttribute('position').count,
          0,
        ),
        courseWidthBytes: meshes.reduce(
          (sum, mesh) => sum + (mesh.geometry.getAttribute('mxCourseWidth')?.array.byteLength ?? 0),
          0,
        ),
        attributesBytes: meshes.reduce(
          (sum, mesh) =>
            sum +
            Object.values(mesh.geometry.attributes).reduce(
              (bytes, attribute) => bytes + attribute.array.byteLength,
              0,
            ),
          0,
        ),
      },
      hooks: studioHookKeys(view.material),
      scans: scannedGround.diagnostics(),
    };
  } finally {
    scannedGround.detach(renderer);
    view.dispose();
    key.shadow.map?.dispose();
    key.shadow.mapPass?.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
