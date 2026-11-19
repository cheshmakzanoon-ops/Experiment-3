import * as T from 'three';
import type { AurelVegetationKit } from '../aurel-vegetation.ts';
import type { StaticTransformGroup } from '../static-transform-group.ts';
import type { VegetationLibrary } from './library.ts';
import type { PhotoPlanting } from './planting.ts';

/** One complete vegetation tier. It can be prepared off scene and restored
 * without rebuilding the circuit, moving its camera or resetting the race. */
export interface CircuitPlanting {
  readonly root: StaticTransformGroup;
  readonly library: VegetationLibrary | null;
  readonly authored: AurelVegetationKit | null;
  photo: PhotoPlanting | null;
  disposed: boolean;
}

/** The asset owners remove their roots first; remaining meshes are procedural
 * belts/trees with resources exclusive to this planting. Idempotence matters
 * when a settings preparation finishes after its renderer has been torn down. */
export function disposeCircuitPlanting(planting: CircuitPlanting) {
  if (planting.disposed) return;
  planting.disposed = true;
  planting.root.removeFromParent();
  planting.photo?.dispose();
  planting.library?.dispose();
  planting.authored?.dispose();
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  planting.root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    if (object instanceof T.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      materials.add(material);
    if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
    if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  planting.root.clear();
}
