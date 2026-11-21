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
interface SoilCaptureOptions {
  /** A bounded local software-renderer capture; normal browser CI keeps
   * the original full-size viewport and shadow coverage. */
  compact?: boolean;
  compareEvaluation?: boolean;
  /** Export the three PNGs per camera that the full review attaches. Every frame is read and hashed. */
  evidenceImagesOnly?: boolean;
}

function soilPhotoEncoder(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const photo = context.createImageData(width, height);
  const rowBytes = width * 4;
  return (pixels: Uint8Array) => {
    // The real WebGL readback begins at the lower left. Copy those same
    // bytes into the photograph without another multisampled GPU readback.
    for (let y = 0; y < height; y++) {
      const start = (height - 1 - y) * rowBytes;
      photo.data.set(pixels.subarray(start, start + rowBytes), y * rowBytes);
    }
    context.putImageData(photo, 0, 0);
    // toBlob snapshots the canvas now, so the next colour pass can start
    // while the browser encodes this PNG.
    return new Promise<string>((resolve, reject) => canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Could not encode the soil photograph'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }, 'image/png'));
  };
}

// Remove only the zero-contribution exits from the assembled production shader.
// Both programs still execute the same relief, scan, light and shadow equations.
const zeroSoilExits = [
  'if ( d >= spacing * 0.82 ) return vec4( 0.0 );',
  'if ( tearFade == 0.0 ) return traffic;',
  'if ( mxShoulder( p, f ) == 0.0 ) return vec4( 0.0 );',
  'if ( amount == 0.0 || footprint >= 0.65 ) return vec2( 0.0 );',
];

function compareSoilPixels(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  material: T.MeshPhysicalMaterial,
  exhaustiveFirst: boolean,
) {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  const referenceKey = cacheKey.call(material) + '-exhaustive-soil-review';
  const compileReference: typeof compile = (shader, context) => {
    compile.call(material, shader, context);
    for (const exit of zeroSoilExits) {
      if (!shader.fragmentShader.includes(exit))
        throw new Error('Missing soil comparison exit: ' + exit);
      shader.fragmentShader = shader.fragmentShader.replace(exit, '');
    }
  };
  const draw = (exhaustive: boolean) => {
    material.onBeforeCompile = exhaustive ? compileReference : compile;
    material.customProgramCacheKey = exhaustive ? () => referenceKey : cacheKey;
    material.needsUpdate = true;
    // Compile and complete a warm frame before timing the same view on this driver.
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const pixels = new Uint8Array(width * height * 4);
    const start = performance.now();
    renderer.render(scene, camera);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const elapsedMs = performance.now() - start;
    const stats = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      error: gl.getError(),
    };
    return { pixels, stats, elapsedMs };
  };
  try {
    const first = draw(exhaustiveFirst), second = draw(!exhaustiveFirst);
    const optimized = exhaustiveFirst ? second : first;
    const exhaustive = exhaustiveFirst ? first : second;
    const a = optimized.pixels, b = exhaustive.pixels;
    let changedPixels = 0, variedPixels = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        a[i] !== b[i] || a[i + 1] !== b[i + 1] ||
        a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]
      ) changedPixels++;
      if (b[i] !== b[0] || b[i + 1] !== b[1] || b[i + 2] !== b[2]) variedPixels++;
    }
    return {
      width, height, changedPixels, variedPixels,
      optimized: optimized.stats, exhaustive: exhaustive.stats,
      optimizedMs: optimized.elapsedMs, exhaustiveMs: exhaustive.elapsedMs,
    };
  } finally {
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = cacheKey;
    material.needsUpdate = true;
  }
}

/** The production terrain alone, photographed from a normal approach and an
 * oblique berm inspection. This isolates soil changes; it is not application
 * lighting, a gameplay performance test, or a replacement collision surface. */
export async function captureMotocrossWorkedSoil(
  circuit: Circuit,
  options: SoilCaptureOptions = {},
) {
  const width = options.compact ? 640 : 1120,
    height = options.compact ? 400 : 700;
  const track = rigTrack(circuit),
    surface = Track.offroadOf(track) as TrackTerrainSurface,
    terrain = surface.terrain,
    view = new TerrainView(track),
    sourceHash = terrain.hash();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color(0xb7c7d2);
  const camera = new T.PerspectiveCamera(55, width / height, 0.1, 700),
    key = new T.DirectionalLight(0xfff2dd, 2.8);
  key.castShadow = true;
  // During the material review this terrain is the only shadow caster.
  // The separately timed shader comparison keeps its usual full shadow pass.
  key.shadow.autoUpdate = options.compareEvaluation === true;
  key.shadow.mapSize.setScalar(options.compact ? 512 : 1536);
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
  let shadowRevision = -1, shadowRefreshes = 0;
  let encodePhoto: ReturnType<typeof soilPhotoEncoder> | undefined;
  let readback: Uint8Array<ArrayBuffer> | undefined;
  const position = (kind: 'approach' | 'berm' | 'jump') => {
    const berm = surface.course.spec.berms[0],
      jump = surface.course.jumps.find((jump) => jump.kind === 'double') ?? surface.course.jumps[0],
      station =
        kind === 'approach'
          ? surface.course.jumps[0].start - 1
          : kind === 'jump'
            ? (jump.takeoff + jump.landing) / 2
            : (berm.from + berm.to) / 2;
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
    } else if (kind === 'berm') {
      camera.position.set(
        target.x - p.tx * 8 - p.nx * side * 8,
        target.y + 6.2,
        target.z - p.tz * 8 - p.nz * side * 8,
      );
      camera.lookAt(target);
    } else {
      const span = Math.max(22, jump.end - jump.start);
      camera.position.set(
        target.x - p.nx * span * 0.7 - p.tx * span * 0.25,
        target.y + span * 0.53,
        target.z - p.nz * span * 0.7 - p.tz * span * 0.25,
      );
      camera.lookAt(target);
    }
    key.target.position.copy(target);
    key.position.set(
      target.x - p.tx * 24 + p.nx * 29,
      target.y + 23,
      target.z - p.tz * 24 + p.nz * 29,
    );
    key.shadow.needsUpdate = true;
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    return { station, width: p.width, camera: camera.position.toArray(), target: target.toArray() };
  };
  const capture = (label: string, retainImage = true) => {
    // A different light position or a moved terrain vertex needs a fresh
    // depth map. All six colour frames still run the complete soil shader.
    if (view.geometryRevision !== shadowRevision) key.shadow.needsUpdate = true;
    const refreshShadow = key.shadow.needsUpdate;
    renderer.render(scene, camera);
    if (refreshShadow) {
      if (!key.shadow.map || key.shadow.needsUpdate) throw new Error('The soil shadow map was not rendered');
      shadowRevision = view.geometryRevision;
      shadowRefreshes++;
    }
    const gl = renderer.getContext();
    const pixels = readback ??= new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    let image: string | Promise<string> = '';
    if (retainImage) {
      encodePhoto ??= soilPhotoEncoder(width, height);
      image = encodePhoto(pixels);
    }
    return {
      label,
      image,
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
    const comparisons = [];
    const retainRepeatImages = !options.evidenceImagesOnly;
    for (const angle of ['approach', 'berm', 'jump'] as const) {
      const cameraPose = position(angle);
      const wetness = options.compareEvaluation && angle === 'berm' ? 0.72 : 0;
      view.record({ reset: true, wetness, blocks: new Float32Array() }, 0, true);
      if (options.compareEvaluation) {
        const exhaustiveFirst = circuit === 'valley-ridge-mx' ? angle === 'berm' : angle !== 'berm';
        const comparison = compareSoilPixels(renderer, scene, camera, view.material, exhaustiveFirst);
        comparisons.push({ angle, wetness, ...comparison });
        continue;
      }
      const prepared = capture(`${angle}-prepared`);
      view.record({ reset: false, wetness: 0.72, blocks: new Float32Array() }, 8, true);
      const wet = capture(`${angle}-wet`),
        held = capture(`${angle}-wet-held`, retainRepeatImages);
      view.showAt(0);
      const restored = capture(`${angle}-prepared-restored`, retainRepeatImages);
      // Disable only the added feature weights, preserving the same geometry,
      // scans, light, shader and camera. Restore those exact bytes afterwards.
      const attributes = meshes.map((mesh) => {
        const attribute = mesh.geometry.getAttribute('mxCourseWear') as T.BufferAttribute;
        return { attribute, original: attribute.array.slice() };
      });
      for (const { attribute } of attributes) {
        attribute.array.fill(0);
        attribute.needsUpdate = true;
      }
      const generic = capture(`${angle}-generic-traffic`);
      for (const { attribute, original } of attributes) {
        attribute.array.set(original);
        attribute.needsUpdate = true;
      }
      const featureRestored = capture(`${angle}-course-wear-restored`, retainRepeatImages);
      const samples = await Promise.all(
        [prepared, wet, held, restored, generic, featureRestored].map(async sample =>
          ({ ...sample, image: await sample.image })),
      );
      results.push({
        angle,
        cameraPose,
        samples,
      });
    }
    return {
      circuit,
      capture: { width, height, shadowMapSize: key.shadow.mapSize.x, shadowRefreshes },
      results,
      comparisons,
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
        courseWearBytes: meshes.reduce(
          (sum, mesh) => sum + (mesh.geometry.getAttribute('mxCourseWear')?.array.byteLength ?? 0),
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
      renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER) as string,
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
