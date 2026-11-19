import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FarShadow } from '../../src/rendering/far-shadow.ts';
import {
  TERRAIN_EXTENT,
  TERRAIN_MORPH_SECONDS,
  TerrainStreamer,
} from '../../src/rendering/open-world/terrain.ts';
import type {
  FromTileWorker,
  TileMeshData,
  TileRequest,
  ToTileWorker,
} from '../../src/workers/open-world-protocol.ts';

const SIZE = 128;
const surface = (x: number, z: number) =>
  120 +
  70 * Math.sin((x * Math.PI) / 512) * Math.cos(z / 420) +
  35 * Math.cos(z / 180) +
  1.5 * Math.sin(x / 9) * Math.cos(z / 11);

/** Deliberately different parent/child samples, including fine contact detail.
 * No worker, region, artwork, download, or WebGL capability is mocked. Only the
 * deterministic data source replaces the asynchronous terrain tile worker. */
function tileData(request: TileRequest): TileMeshData {
  const side = request.res + 1,
    heights = new Float32Array(side * side),
    normals = new Float32Array(side * side * 3),
    splat = new Float32Array(side * side * 4),
    shade = new Float32Array(side * side * 4),
    step = request.size / request.res;
  let minY = Infinity,
    maxY = -Infinity;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const index = j * side + i,
        x = request.x0 + i * step,
        z = request.z0 + j * step,
        h = surface(x, z),
        nx = -(surface(x + 0.01, z) - surface(x - 0.01, z)) / 0.02,
        nz = -(surface(x, z + 0.01) - surface(x, z - 0.01)) / 0.02,
        length = Math.hypot(nx, 1, nz);
      heights[index] = h;
      normals.set([nx / length, 1 / length, nz / length], index * 3);
      // Road pinning is zero here, so masks cannot accidentally hide a broken
      // position morph. CPU terrain tests separately cover pinned road beds.
      splat.set([0.12, 0.1, 0.08, 0.5 + 0.45 * Math.sin(((x + 128) * Math.PI) / 512)], index * 4);
      shade.set([0, 0.3 + 0.25 * Math.cos(z / 150), 0.2, 0], index * 4);
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
    }
  return {
    type: 'tile',
    id: request.id,
    heights,
    normals,
    splat,
    shade,
    trees:
      request.size <= 512
        ? new Float32Array([request.x0 + step, request.z0 + step, 10, 0, 0, 0.5, heights[side + 1]])
        : new Float32Array(),
    minY,
    maxY,
    ms: 0,
  };
}

function stream(maxTiles: number) {
  const pending = new Map<number, TileRequest>();
  let receive: (event: MessageEvent<FromTileWorker>) => void = () => {},
    removed = 0;
  const worker = {
    addEventListener: (_: string, listener: typeof receive) => (receive = listener),
    removeEventListener: () => removed++,
    postMessage(message: ToTileWorker) {
      if (message.type === 'tile') pending.set(message.id, message);
      else pending.delete(message.id);
    },
  } as unknown as Worker;
  const terrain = new TerrainStreamer(worker, { maxTiles, split: 1.6, inFlight: 4, trees: 1 }),
    camera = new T.PerspectiveCamera();
  camera.position.set(1200, surface(1200, 900) + 8, 900);
  camera.updateMatrixWorld();
  const deliver = (accept: (request: TileRequest) => boolean = () => true) => {
    for (const request of [...pending.values()]) {
      if (!accept(request)) continue;
      pending.delete(request.id);
      receive({ data: tileData(request) } as MessageEvent<FromTileWorker>);
    }
  };
  return { terrain, camera, pending, deliver, removed: () => removed };
}

const visible = (terrain: TerrainStreamer) =>
  terrain.root.children.filter((child) => child.visible) as T.Mesh[];

/** Independently bake the documented absolute morph contract on the CPU. The
 * oracle has NO morph attributes, so it cannot share a broken GPU morph path.
 * It retains production indices, skirts, material, lights and draw placement. */
function reference(terrain: TerrainStreamer, control?: 'height' | 'normal' | 'mask') {
  const group = new T.Group();
  for (const source of visible(terrain)) {
    const geometry = source.geometry.clone(),
      factor = source.morphTargetInfluences?.[0] ?? 0;
    for (const [name, parent, wrong] of [
      ['position', source.geometry.morphAttributes.position?.[0], control === 'height'],
      ['normal', source.geometry.morphAttributes.normal?.[0], control === 'normal'],
      ['splat', source.geometry.getAttribute('parentSplat'), control === 'mask'],
      ['shade', source.geometry.getAttribute('parentShade'), control === 'mask'],
    ] as const) {
      if (!parent || wrong) continue;
      const base = source.geometry.getAttribute(name),
        values = new Float32Array(base.count * base.itemSize);
      for (let i = 0; i < values.length; i++)
        values[i] = base.array[i] * (1 - factor) + parent.array[i] * factor;
      geometry.setAttribute(name, new T.BufferAttribute(values, base.itemSize));
    }
    geometry.morphAttributes = {};
    geometry.deleteAttribute('parentSplat');
    geometry.deleteAttribute('parentShade');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, terrain.material);
    mesh.position.copy(source.position);
    mesh.receiveShadow = source.receiveShadow;
    group.add(mesh);
  }
  return group;
}

function difference(a: Float32Array, b: Float32Array, channels = 3) {
  let maximum = 0,
    sum = 0,
    covered = 0,
    coverageMismatch = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] > 0.5 !== b[i + 3] > 0.5) coverageMismatch++;
    if (a[i + 3] < 0.5 || b[i + 3] < 0.5) continue;
    covered++;
    for (let c = 0; c < channels; c++) {
      const error = Math.abs(a[i + c] - b[i + c]);
      maximum = Math.max(maximum, error);
      sum += error;
    }
  }
  return { maximum, mean: sum / Math.max(1, covered * channels), covered, coverageMismatch };
}

/** Real-WebGL correctness evidence at 128². This exercises the procedural
 * production terrain material (scan textures intentionally unattached), native
 * normal/depth shaders and the production far-shadow bake. It is not a quality
 * screenshot, streaming benchmark, or device frame-rate measurement. */
export function capture() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context: gl });
  if (!renderer.extensions.has('EXT_color_buffer_float'))
    throw new Error('Terrain contract requires float colour attachments');
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0, 0);
  renderer.toneMapping = T.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new T.Scene(),
    sun = new T.DirectionalLight(0xffffff, 2),
    far = new FarShadow(SIZE);
  sun.position.set(3000, 6000, 2000);
  scene.add(
    sun,
    sun.target,
    new T.HemisphereLight(0xdceaff, 0x34452c, 1.4),
    far.light,
    far.light.target,
  );
  const camera = new T.OrthographicCamera(-4096, 4096, 4096, -4096, 1, 4000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 2000, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const oblique = new T.OrthographicCamera(-11500, 11500, 11500, -11500, 1, 50000);
  oblique.position.set(11000, 9500, 14000);
  oblique.lookAt(0, 120, 0);
  oblique.updateMatrixWorld();
  const target = new T.WebGLRenderTarget(SIZE, SIZE, {
    type: T.FloatType,
    minFilter: T.NearestFilter,
    magFilter: T.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const normal = new T.MeshNormalMaterial(),
    depth = new T.MeshDepthMaterial({ depthPacking: T.BasicDepthPacking }),
    coverage = new T.MeshBasicMaterial({
      color: new T.Color(0.125, 0.125, 0.125),
      transparent: true,
      blending: T.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  const copy = new T.ShaderMaterial({
    uniforms: { source: { value: target.texture } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:
      'uniform sampler2D source;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(source,vUv).rgb,1.);}',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new FullScreenQuad(copy),
    images: Record<string, string> = {},
    buffers: Float32Array[] = [];
  const read = () => {
    const data = new Float32Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, data);
    buffers.push(data);
    return data;
  };
  const image = (name: string) => {
    renderer.setRenderTarget(null);
    quad.render(renderer);
    images[name] = canvas.toDataURL('image/png');
  };
  const draw = (root: T.Group, material: T.Material | null = null, view = camera) => {
    scene.add(root);
    scene.overrideMaterial = material;
    far.light.visible = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, view);
    scene.overrideMaterial = null;
    scene.remove(root);
    return read();
  };
  const discard = (group: T.Group) => {
    for (const mesh of group.children as T.Mesh[]) mesh.geometry.dispose();
    group.clear();
  };
  const shadow = (root: T.Group) => {
    scene.add(root);
    far.bake(renderer, scene, {
      direction: new T.Vector3(0.35, 1, 0.22),
      bounds: new T.Box3(new T.Vector3(-8192, -400, -8192), new T.Vector3(8192, 350, 8192)),
      hidden: [],
      farCasters: root.children,
      sun,
    });
    const map = far.light.shadow.map;
    if (!map) throw new Error('Far shadow did not allocate a map');
    const packed = new Uint8Array(SIZE * SIZE * 4),
      data = new Float32Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(map, 0, 0, SIZE, SIZE, packed);
    // Three 0.180 packing.glsl: unpackRGBAToDepth, with byte normalization.
    for (let i = 0; i < packed.length; i += 4) {
      data[i] =
        packed[i] / 256 +
        packed[i + 1] / 65536 +
        packed[i + 2] / 16777216 +
        packed[i + 3] / (255 * 16777216);
      data[i + 3] = data[i] < 0.999 ? 1 : 0;
    }
    buffers.push(data);
    far.light.visible = false;
    scene.remove(root);
    return data;
  };
  const cover = (root: T.Group) => {
    const pixels = draw(root, coverage);
    let holes = 0,
      overlaps = 0,
      maximumError = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 0.0625) holes++;
      if (pixels[i] > 0.1875) overlaps++;
      maximumError = Math.max(maximumError, Math.abs(pixels[i] - 0.125));
    }
    return { holes, overlaps, maximumError };
  };
  const f = stream(5);
  f.terrain.update(f.camera, 0);
  f.deliver();
  f.terrain.update(f.camera, 0);
  f.deliver();
  const checkpoint = (name: string) => {
    const oracle = reference(f.terrain),
      colour = draw(f.terrain.root);
    image(name);
    const materialError = difference(colour, draw(oracle)),
      normalError = difference(draw(f.terrain.root, normal), draw(oracle, normal)),
      depthError = difference(draw(f.terrain.root, depth), draw(oracle, depth), 1),
      silhouetteError = difference(
        draw(f.terrain.root, depth, oblique),
        draw(oracle, depth, oblique),
        1,
      ),
      shadowError = difference(shadow(f.terrain.root), shadow(oracle), 1),
      coverage = cover(f.terrain.root),
      meshes = visible(f.terrain);
    const result = {
      name,
      influence: meshes[0].morphTargetInfluences?.[0] ?? 0,
      drawn: meshes.length,
      resident: f.terrain.stats.resident,
      morphBytes: f.terrain.stats.morphBytes,
      materialError,
      normalError,
      depthError,
      silhouetteError,
      shadowError,
      coverage,
    };
    discard(oracle);
    return result;
  };
  const stages = [checkpoint('parent')];
  f.terrain.update(f.camera, 0.07);
  stages.push(checkpoint('quarter'));
  f.terrain.update(f.camera, 0.14);
  const midpoint = checkpoint('midpoint');
  stages.push(midpoint);
  const midColour = draw(f.terrain.root),
    midDepth = draw(f.terrain.root, depth),
    midNormal = draw(f.terrain.root, normal),
    wrongHeight = reference(f.terrain, 'height'),
    wrongNormal = reference(f.terrain, 'normal'),
    wrongMask = reference(f.terrain, 'mask');
  const negativeControls = {
    height: difference(midDepth, draw(wrongHeight, depth), 1),
    normal: difference(midNormal, draw(wrongNormal, normal)),
    mask: difference(midColour, draw(wrongMask)),
    missingChild: { holes: 0, overlaps: 0, maximumError: 0 },
    duplicateParent: { holes: 0, overlaps: 0, maximumError: 0 },
  };
  image('wrong-mask-control');
  for (const root of [wrongHeight, wrongNormal, wrongMask]) discard(root);
  const child = visible(f.terrain)[0];
  child.visible = false;
  negativeControls.missingChild = cover(f.terrain.root);
  child.visible = true;
  const parent = f.terrain.root.children.find((mesh) => !mesh.visible)!;
  parent.visible = true;
  negativeControls.duplicateParent = cover(f.terrain.root);
  parent.visible = false;
  const revision = f.terrain.shadowRevision;
  for (let i = 0; i < 8; i++) f.terrain.update(f.camera, 0.14);
  f.camera.position.x = 80000;
  f.camera.updateMatrixWorld();
  f.terrain.update(f.camera, 0.14);
  const held = {
    error: difference(midColour, draw(f.terrain.root)),
    influence: child.morphTargetInfluences![0],
    revisionUnchanged: f.terrain.shadowRevision === revision,
  };
  f.terrain.update(f.camera, 0.21);
  stages.push(checkpoint('reverse'));
  f.camera.position.x = 1200;
  f.camera.updateMatrixWorld();
  f.terrain.update(f.camera, 0.28);
  f.terrain.update(f.camera, 0.35);
  f.terrain.update(f.camera, 0.42);
  stages.push(checkpoint('fine'));
  f.camera.position.x = 80000;
  f.camera.updateMatrixWorld();
  for (const time of [0.49, 0.56, 0.63, 0.7, 0.77]) f.terrain.update(f.camera, time);
  stages.push(checkpoint('coarsened'));

  // Fine tiles arrive while presentation time is held. Their exact contact
  // height and tree ownership must activate together on the next advancing tick.
  const near = stream(29);
  for (let i = 0; i < 35; i++) {
    near.terrain.update(near.camera);
    near.deliver((request) => request.size > 256);
  }
  near.terrain.update(near.camera, 0);
  for (let i = 0; i < 8; i++) {
    near.deliver();
    near.terrain.update(near.camera, 0);
  }
  const readyHeld = near.terrain.readyAround(1200, 900);
  near.terrain.update(near.camera, 1 / 60);
  camera.left = -96;
  camera.right = 96;
  camera.top = 96;
  camera.bottom = -96;
  camera.position.set(1200, 2000, 900);
  camera.lookAt(1200, 0, 900);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const nearReference = reference(near.terrain),
    nearDepth = draw(near.terrain.root, depth),
    nearDepthError = difference(nearDepth, draw(nearReference, depth), 1),
    nearCoverage = cover(near.terrain.root);
  draw(near.terrain.root);
  image('contact-snap');
  let contactHeightError = 0,
    treeHeightError = 0,
    contactVertices = 0;
  for (const mesh of visible(near.terrain)) {
    if (!mesh.name.startsWith('Terrain L0 ')) continue;
    const bounds = mesh.geometry.boundingBox!.clone().translate(mesh.position);
    if (1200 < bounds.min.x || 1200 > bounds.max.x || 900 < bounds.min.z || 900 > bounds.max.z)
      continue;
    const position = mesh.geometry.getAttribute('position'),
      parentPosition = mesh.geometry.morphAttributes.position![0],
      influence = mesh.morphTargetInfluences![0];
    for (let i = 0; i < 65 * 65; i++) {
      contactHeightError = Math.max(
        contactHeightError,
        Math.abs((parentPosition.getY(i) - position.getY(i)) * influence),
      );
      contactVertices++;
    }
  }
  for (const { data } of near.terrain.treeTiles.values()) {
    const side = Math.sqrt(data.heights.length);
    if (data.trees.length)
      treeHeightError = Math.max(treeHeightError, Math.abs(data.trees[6] - data.heights[side + 1]));
  }
  const contact = {
    readyHeld,
    readyAfterTick: near.terrain.readyAround(1200, 900),
    contactHeightError,
    treeHeightError,
    contactVertices,
    depthError: nearDepthError,
    coverage: nearCoverage,
    resident: near.terrain.stats.resident,
    morphBytes: near.terrain.stats.morphBytes,
  };
  discard(nearReference);
  const cleanups = [f, near].map((owner) => {
    const meshes = owner.terrain.root.children as T.Mesh[];
    let geometriesDisposed = 0,
      materialDisposals = 0;
    for (const mesh of meshes)
      mesh.geometry.addEventListener('dispose', () => geometriesDisposed++);
    owner.terrain.material.addEventListener('dispose', () => materialDisposals++);
    const geometries = meshes.length;
    owner.terrain.dispose();
    owner.terrain.dispose();
    owner.deliver();
    return {
      geometries,
      geometriesDisposed,
      materialDisposals,
      listenersRemoved: owner.removed(),
      children: owner.terrain.root.children.length,
      resident: owner.terrain.stats.resident,
      requested: owner.terrain.stats.requested,
      morphBytes: owner.terrain.stats.morphBytes,
    };
  });
  const finite = buffers.every((buffer) => buffer.every(Number.isFinite)),
    backend = gl.getParameter(gl.RENDERER) as string;
  far.dispose();
  target.dispose();
  for (const material of [normal, depth, coverage, copy]) material.dispose();
  quad.dispose();
  renderer.dispose();
  const glErrors: number[] = [];
  for (
    let i = 0, error = gl.getError();
    error !== gl.NO_ERROR && i < 16;
    i++, error = gl.getError()
  )
    glErrors.push(error);
  return {
    images,
    backend,
    width: SIZE,
    height: SIZE,
    terrainExtent: TERRAIN_EXTENT,
    morphSeconds: TERRAIN_MORPH_SECONDS,
    midpointInfluence: midpoint.influence,
    stages,
    negativeControls,
    held,
    contact,
    cleanups,
    finite,
    glErrors,
    contextAlive: !gl.isContextLost(),
  };
}
