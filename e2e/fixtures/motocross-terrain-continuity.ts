import * as T from 'three';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';

/** Controlled material-lighting comparison on the production receiver. The
 * independent sample explicitly recomputes normals per strip, reproducing
 * the previous lighting seam while retaining identical, correct positions.
 * It is not a claim that this isolated fixture is full gameplay lighting. */
export async function captureMotocrossTerrainContinuity(
  circuit: 'valley-ridge-mx' | 'arena-nord-sx',
) {
  const track = rigTrack(circuit),
    terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
    sourceHash = terrain.hash(),
    view = new TerrainView(track),
    meshes = view.group.children as T.Mesh[],
    rowSize = terrain.renderColumns + 1,
    centre = Math.round(-terrain.lateralMin / 0.5),
    renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const width = 1000,
    height = 680,
    scene = new T.Scene(),
    camera = new T.PerspectiveCamera(48, width / height, 0.1, 500),
    key = new T.DirectionalLight(0xffeed9, 3.1),
    p = trackPoint(),
    q = trackPoint();
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  scene.background = new T.Color(0xb7c6d2);
  scene.add(view.group, key, key.target, new T.HemisphereLight(0xc9ddec, 0x624f39, 0.85));
  const normals = () =>
    meshes.map((mesh) => mesh.geometry.getAttribute('normal') as T.BufferAttribute);
  const restore = (saved: T.TypedArray[]) => {
    normals().forEach((normal, index) => {
      normal.array.set(saved[index]);
      normal.needsUpdate = true;
    });
  };
  const seamError = () => {
    let maximum = 0,
      station = 96,
      lateral = 0;
    const n = normals();
    for (let i = 0; i < meshes.length; i++) {
      const next = (i + 1) % meshes.length,
        end = n[i].count - rowSize;
      for (let c = centre - 4; c <= centre + 4; c++) {
        const error = Math.hypot(
          n[i].getX(end + c) - n[next].getX(c),
          n[i].getY(end + c) - n[next].getY(c),
          n[i].getZ(end + c) - n[next].getZ(c),
        );
        if (error > maximum) {
          maximum = error;
          station = meshes[next].geometry.getAttribute('mxCourse').getY(c);
          lateral = meshes[next].geometry.getAttribute('mxCourse').getX(c);
        }
      }
    }
    return { maximum, station, lateral };
  };
  const capture = (label: string) => {
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return {
      label,
      image: renderer.domElement.toDataURL('image/png'),
      hash,
      glError: gl.getError(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 },
    };
  };
  try {
    materials.prepare(renderer);
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000)))
      throw new Error('Terrain continuity scans unavailable');
    const baseNormals = normals().map((normal) => normal.array.slice());
    for (const mesh of meshes) mesh.geometry.computeVertexNormals();
    const selected = seamError();
    restore(baseNormals);
    // Add actual displayed wear on and beside the selected row. The normal
    // seam comparison never modifies these positions or this soil state.
    const blocks: number[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const row = (Math.round(selected.station) + dr + terrain.renderRows) % terrain.renderRows;
        blocks.push(
          row * terrain.renderColumns + centre + dc,
          0.1 / (1 + Math.abs(dr) + Math.abs(dc)),
          0.65,
        );
      }
    view.record({ reset: true, wetness: 0.58, blocks: new Float32Array(blocks) }, 8, true);
    track.at(selected.station, p);
    const target = new T.Vector3(
      p.x + p.nx * selected.lateral,
      view.heightAt(selected.station, selected.lateral) + 0.1,
      p.z + p.nz * selected.lateral,
    );
    track.at(selected.station - 6.5, q);
    camera.position.set(
      q.x + q.nx * (selected.lateral + 1.8),
      view.heightAt(q.s, selected.lateral + 1.8) + 2.8,
      q.z + q.nz * (selected.lateral + 1.8),
    );
    camera.lookAt(target);
    key.target.position.copy(target);
    key.position.set(
      target.x - p.tx * 12 + p.nx * 18,
      target.y + 9,
      target.z - p.tz * 12 + p.nz * 18,
    );
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const continuousError = seamError().maximum,
      saved = normals().map((normal) => normal.array.slice()),
      continuous = capture('continuous-area-normals');
    for (const mesh of meshes) mesh.geometry.computeVertexNormals();
    const independentError = seamError().maximum,
      independent = capture('independent-strip-normals');
    restore(saved);
    const restored = capture('continuous-restored');
    return {
      circuit,
      selected,
      continuousError,
      independentError,
      samples: [continuous, independent, restored],
      sourceUnchanged: terrain.hash() === sourceHash,
      camera: camera.position.toArray(),
      target: target.toArray(),
      scans: scannedGround.diagnostics(),
    };
  } finally {
    scannedGround.detach(renderer);
    view.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
