/** A bounded Saltmarsh patch made from production roads, terrain data,
 * dressing and vegetation. The runner freezes source for matched cameras.
 * The full Festival compositor, photographic packs and gameplay are omitted. */
import * as T from 'three';
import { HorizonDressing } from '../../src/rendering/open-world/horizon-dressing.ts';
import { Vegetation } from '../../src/rendering/open-world/vegetation.ts';
import { RoadMeshes } from '../../src/rendering/open-world/roads.ts';
import { buildTileData } from '../../src/rendering/open-world/tile-data.ts';
import { terrainMaterial } from '../../src/rendering/open-world/terrain-material.ts';
import { openWorld } from '../../src/simulation/open-world/world.ts';
import {
  StructureGrid,
  regionStructures,
  TREE_SPECIES,
} from '../../src/simulation/open-world/placement.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { textures } from '../../src/rendering/materials/library.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import type { TileMeshData } from '../../src/workers/open-world-protocol.ts';

const width = 1120,
  height = 700,
  world = openWorld(),
  structures = regionStructures(world),
  grid = new StructureGrid(structures),
  circuit = world.network.edges.find((edge) => edge.roadClass === 'circuit')!,
  p = trackPoint();
world.network.at(circuit.offset + 640, p);
const canvas = document.createElement('canvas');
document.body.append(canvas);
const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new T.Scene();
scene.background = new T.Color(0xbacbd8);
scene.fog = new T.Fog(0xbacbd8, 260, 650);
scene.add(new T.HemisphereLight(0xd7e6ff, 0x4d4d34, 1.2));
const sun = new T.DirectionalLight(0xffedcd, 3.1);
sun.position.set(p.x - 130, p.y + 160, p.z + 100);
sun.target.position.set(p.x, p.y, p.z);
scene.add(sun, sun.target);
studioUniforms.studioSunDir.value.set(-130, 160, 100).normalize();
studioUniforms.studioWind.value.set(2.2, 0.5, 8, 0.35);
const camera = new T.PerspectiveCamera(55, width / height, 0.1, 650),
  terrain = terrainMaterial(),
  vegetation = new Vegetation(),
  data = new Map<number, { data: TileMeshData; level: number }>();
const indices: number[] = [];
for (let row = 0; row < 64; row++)
  for (let col = 0; col < 64; col++) {
    const a = row * 65 + col;
    indices.push(a, a + 66, a + 1, a, a + 65, a + 66);
  }
const trees: number[][] = [];
for (let ix = -1; ix <= 1; ix++)
  for (let iz = -1; iz <= 1; iz++) {
    const x0 = (Math.floor(p.x / 256) + ix) * 256,
      z0 = (Math.floor(p.z / 256) + iz) * 256,
      id = data.size + 1,
      tile = buildTileData(world, grid, {
        type: 'tile',
        id,
        x0,
        z0,
        size: 256,
        res: 64,
        trees: 0.7,
        colliders: true,
      });
    data.set(id, { data: tile, level: 0 });
    for (let i = 0; i < tile.trees.length; i += 7)
      trees.push(Array.from(tile.trees.slice(i, i + 7)));
    const positions = new Float32Array(65 * 65 * 3);
    for (let row = 0; row <= 64; row++)
      for (let col = 0; col <= 64; col++) {
        const i = row * 65 + col;
        positions.set([x0 + col * 4, tile.heights[i], z0 + row * 4], i * 3);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(tile.normals, 3));
    geometry.setAttribute('splat', new T.BufferAttribute(tile.splat, 4));
    geometry.setAttribute('shade', new T.BufferAttribute(tile.shade, 4));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, terrain);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
vegetation.sync(data);
const roads = new RoadMeshes(world.network, world.field),
  dressing = new HorizonDressing(world, structures);
scene.add(roads.root, dressing.root, vegetation.root);
textures.bake(renderer);
const target = trackPoint();
world.network.at(circuit.offset + 684, target);
const broadleaf = trees
  .filter((tree) => tree[3] === TREE_SPECIES.BROADLEAF)
  .sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(b[0] - p.x, b[1] - p.z))[0];
if (!broadleaf) throw new Error('Review patch needs a real broadleaf placement');
const shots = {
  'club-verge': {
    eye: [p.x - p.tx * 10, p.y + 1.45, p.z - p.tz * 10],
    target: [target.x, target.y + 1, target.z],
    quality: 'medium',
  },
  'club-low': {
    eye: [p.x - p.tx * 10, p.y + 1.45, p.z - p.tz * 10],
    target: [target.x, target.y + 1, target.z],
    quality: 'low',
  },
  'club-planting': {
    eye: [broadleaf[0] + 28, broadleaf[6] + 4, broadleaf[1] + 27],
    target: [broadleaf[0], broadleaf[6] + broadleaf[2] * 0.44, broadleaf[1]],
    quality: 'medium',
  },
} as const;
function capture(name: keyof typeof shots) {
  const shot = shots[name];
  camera.position.fromArray(shot.eye);
  camera.lookAt(new T.Vector3().fromArray(shot.target));
  camera.updateMatrixWorld(true);
  dressing.update(8, 0, camera, shot.quality);
  vegetation.update(camera, shot.quality);
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const draw = () => {
    renderer.info.reset();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.finish();
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let bytes = '';
    for (let i = 0; i < pixels.length; i += 0x8000)
      bytes += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
    return {
      image: canvas.toDataURL('image/png'),
      rgba: btoa(bytes),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      memory: { ...renderer.info.memory },
      glError: gl.getError(),
    };
  };
  const first = draw(),
    repeat = draw(),
    gl = renderer.getContext(),
    debug = gl.getExtension('WEBGL_debug_renderer_info'),
    frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  let meadowCalls = 0,
    meadowInstances = 0,
    meadowTriangles = 0;
  dressing.root.traverseVisible((node) => {
    if (
      !(node instanceof T.InstancedMesh) ||
      !node.name.startsWith('Solvane meadow') ||
      !frustum.intersectsObject(node)
    )
      return;
    meadowCalls++;
    meadowInstances += node.count;
    meadowTriangles += node.count * (node.geometry.index!.count / 3);
  });
  return {
    camera: shot,
    first,
    repeat,
    meadow: {
      calls: meadowCalls,
      submittedInstances: meadowInstances,
      submittedTriangles: meadowTriangles,
    },
    planting: {
      trees: vegetation.stats,
      meadowClumps: dressing.stats.meadowClumps,
      meadowPlanMs: dressing.stats.meadowPlanMs,
    },
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    contextLost: gl.isContextLost(),
  };
}
Object.assign(window, { horizonVerge: { capture, shots: Object.keys(shots) } });
