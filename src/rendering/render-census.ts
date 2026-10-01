import * as T from 'three';

export interface CensusEntry {
  owner: string;
  draws: number;
  instances: number;
}

const frustum = new T.Frustum();
const matrix = new T.Matrix4();

function drawable(object: T.Object3D): object is T.Mesh | T.Points | T.Line {
  return object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line;
}
function effectivelyVisible(object: T.Object3D) {
  for (let o: T.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
/** The nearest ancestor directly below one of `roots` (or the object itself). */
function ownerOf(object: T.Object3D, roots: ReadonlySet<T.Object3D>) {
  let o = object;
  while (o.parent && !roots.has(o.parent)) o = o.parent;
  return o.name || o.type;
}

/** On-demand, CPU-only estimate of draw submissions per owner group for the
 * given cameras, using the same visibility, layer and frustum tests Three.js
 * applies before submitting a draw. It ignores material arrays (counted once)
 * and does not predict shadow passes unless `casters` is set, in which case
 * only shadow casters count (a shadow camera's pass). For profiling, not
 * per-frame use. */
export function renderCensus(
  scene: T.Scene,
  cameras: readonly T.Camera[],
  roots: readonly T.Object3D[],
  casters = false,
): CensusEntry[] {
  const rootSet = new Set<T.Object3D>([scene, ...roots]);
  const table = new Map<string, CensusEntry>();
  scene.updateMatrixWorld();
  for (const camera of cameras) {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    scene.traverseVisible((object) => {
      if (!drawable(object) || !object.layers.test(camera.layers)) return;
      if (casters && !object.castShadow) return;
      if (!effectivelyVisible(object)) return;
      if (object.frustumCulled && !frustum.intersectsObject(object)) return;
      const owner = ownerOf(object, rootSet);
      const entry = table.get(owner) ?? { owner, draws: 0, instances: 0 };
      entry.draws += Array.isArray(object.material) ? object.material.length : 1;
      entry.instances += object instanceof T.InstancedMesh ? object.count : 1;
      table.set(owner, entry);
    });
  }
  return [...table.values()].sort((a, b) => b.draws - a.draws);
}

/** Sum per-owner entries of several censuses, largest first. */
export function mergeCensus(tables: readonly CensusEntry[][]): CensusEntry[] {
  const merged = new Map<string, CensusEntry>();
  for (const table of tables)
    for (const entry of table) {
      const total = merged.get(entry.owner) ?? { owner: entry.owner, draws: 0, instances: 0 };
      total.draws += entry.draws;
      total.instances += entry.instances;
      merged.set(entry.owner, total);
    }
  return [...merged.values()].sort((a, b) => b.draws - a.draws);
}

/** Six 90-degree cameras matching a CubeCamera at `position`. */
export function cubeCensusCameras(position: T.Vector3, far: number, layers?: T.Layers) {
  const directions: [T.Vector3, T.Vector3][] = [
    [new T.Vector3(1, 0, 0), new T.Vector3(0, -1, 0)],
    [new T.Vector3(-1, 0, 0), new T.Vector3(0, -1, 0)],
    [new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)],
    [new T.Vector3(0, -1, 0), new T.Vector3(0, 0, -1)],
    [new T.Vector3(0, 0, 1), new T.Vector3(0, -1, 0)],
    [new T.Vector3(0, 0, -1), new T.Vector3(0, -1, 0)],
  ];
  return directions.map(([dir, up]) => {
    const camera = new T.PerspectiveCamera(90, 1, 0.1, far);
    camera.position.copy(position);
    camera.up.copy(up);
    camera.lookAt(position.clone().add(dir));
    camera.updateMatrixWorld();
    if (layers) camera.layers.mask = layers.mask;
    return camera;
  });
}
