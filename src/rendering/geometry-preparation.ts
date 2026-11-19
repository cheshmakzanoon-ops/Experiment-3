import * as T from 'three';

interface GeometryObject extends T.Object3D {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  isBatchedMesh?: boolean;
  geometry?: T.BufferGeometry;
}

/** Native geometry arrays only. Instance matrices/colours retain the real
 * InstancedMesh's upload/disposal path; skinned, morph, dynamic and external
 * owners also keep their normal first-use behaviour. */
function staticGeometry(object: GeometryObject) {
  const geometry = object.geometry;
  if (
    !object.isMesh ||
    object.isSkinnedMesh ||
    object.isBatchedMesh ||
    !geometry?.isBufferGeometry ||
    (geometry as T.InstancedBufferGeometry).isInstancedBufferGeometry ||
    !geometry.attributes.position ||
    Object.values(geometry.morphAttributes).some((entries) => entries.length)
  )
    return null;
  const attributes = [
    ...Object.values(geometry.attributes),
    ...(geometry.index ? [geometry.index] : []),
  ];
  for (const attribute of attributes) {
    const owner = (attribute as T.InterleavedBufferAttribute).isInterleavedBufferAttribute
      ? (attribute as T.InterleavedBufferAttribute).data
      : (attribute as T.BufferAttribute);
    if (owner.usage !== T.StaticDrawUsage || !ArrayBuffer.isView(owner.array)) return null;
  }
  return geometry;
}

/** Populate this renderer's retained WebGLGeometries/WebGLAttributes cache.
 * The native index cache is filled in renderBufferDirect before its zero-count
 * draw; a separate attribute cache or geometry clone would not be reused.
 * No original material, transform, object callback or instance attribute is
 * borrowed. Original geometry disposal remains responsible for its buffers.
 * Only canvas entry is prepared; offscreen callers keep their native first use
 * and physical viewport/scissor state without extra driver queries. */
export function prepareRetainedStaticGeometry(
  renderer: T.WebGLRenderer,
  objects: readonly T.Object3D[],
  cancelled: () => boolean = () => false,
) {
  if (cancelled()) return { prepared: 0, skipped: 0, cancelled: true };
  if (renderer.getRenderTarget() !== null)
    return { prepared: 0, skipped: objects.length, cancelled: cancelled() };
  const geometries = new Set<T.BufferGeometry>();
  let skipped = 0;
  for (const object of objects) {
    const geometry = staticGeometry(object);
    if (geometry) geometries.add(geometry);
    else skipped++;
  }
  if (!geometries.size) return { prepared: 0, skipped, cancelled: cancelled() };
  const previous = {
    target: renderer.getRenderTarget(),
    face: renderer.getActiveCubeFace(),
    mip: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new T.Vector4()),
    scissor: renderer.getScissor(new T.Vector4()),
    scissorTest: renderer.getScissorTest(),
    autoClear: renderer.autoClear,
    sortObjects: renderer.sortObjects,
    xr: renderer.xr.enabled,
  };
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    material = new T.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
  scene.matrixWorldAutoUpdate = false;
  let prepared = 0;
  try {
    renderer.autoClear = false;
    renderer.sortObjects = false;
    renderer.xr.enabled = false;
    // Zero primitives and no clear leave the canvas untouched; no unrelated
    // render target is allocated, resolved or mipmapped by this preparation.
    renderer.setRenderTarget(null);
    for (const geometry of geometries) {
      if (cancelled()) break;
      const range = geometry.drawRange,
        proxy = new T.Mesh(geometry, material);
      proxy.frustumCulled = false;
      scene.add(proxy);
      try {
        geometry.drawRange = { start: 0, count: 0 };
        renderer.render(scene, camera);
        prepared++;
      } finally {
        geometry.drawRange = range;
        scene.remove(proxy);
      }
    }
  } finally {
    try {
      material.dispose();
    } finally {
      renderer.autoClear = previous.autoClear;
      renderer.sortObjects = previous.sortObjects;
      renderer.xr.enabled = previous.xr;
      renderer.setRenderTarget(previous.target, previous.face, previous.mip);
      renderer.setViewport(previous.viewport);
      renderer.setScissor(previous.scissor);
      renderer.setScissorTest(previous.scissorTest);
    }
  }
  return { prepared, skipped, cancelled: cancelled() };
}

/** Select the actual first capture's visible retained geometry after its
 * subject/exclusions have been hidden. Use its native face frustums and layer
 * masks; automatic LOD branches keep native selection and first-use uploads.
 * The caller gates this once, before any face rasterization, not every refresh. */
export function prepareProbeGeometry(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  cube: T.CubeCamera,
  cancelled: () => boolean,
) {
  if (cancelled()) return false;
  if (renderer.getRenderTarget() !== null) return true;
  // The first native face performs this update too. Owners that manage their
  // world matrices explicitly (the main scene) retain that existing policy.
  if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
  const candidates: T.Object3D[] = [];
  const visit = (object: T.Object3D) => {
    if (!object.visible || ((object as T.LOD).isLOD && (object as T.LOD).autoUpdate)) return;
    if (staticGeometry(object)) candidates.push(object);
    for (const child of object.children) visit(child);
  };
  visit(scene);
  if (!candidates.length) return true;
  if (cube.coordinateSystem !== renderer.coordinateSystem) {
    cube.coordinateSystem = renderer.coordinateSystem;
    cube.updateCoordinateSystem();
  }
  cube.updateMatrixWorld();
  const cameras = cube.children as T.PerspectiveCamera[],
    frustums = cameras.map((camera) =>
      new T.Frustum().setFromProjectionMatrix(
        new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        T.WebGLCoordinateSystem,
        camera.reversedDepth,
      ),
    );
  const visible = candidates.filter((object) =>
    cameras.some(
      (camera, i) =>
        object.layers.test(camera.layers) &&
        (!object.frustumCulled || frustums[i].intersectsObject(object)),
    ),
  );
  return !prepareRetainedStaticGeometry(renderer, visible, cancelled).cancelled;
}
