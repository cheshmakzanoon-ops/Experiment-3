import * as T from 'three';

/** Dispose shared geometry/material/texture ownership exactly once, including
 * the custom depth material used by the production crowd shadow pass. */
export function disposePhase27Scene(scene: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const addMaterial = (material: T.Material) => {
    materials.add(material);
    for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
  };
  scene.traverse((object) => {
    if (object instanceof T.InstancedMesh) object.dispose();
    if (object instanceof T.Light && 'shadow' in object) {
      const shadow = (object as T.DirectionalLight).shadow;
      shadow?.map?.dispose(); shadow?.mapPass?.dispose();
    }
    if (!(object instanceof T.Mesh || object instanceof T.Points)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(addMaterial);
    if (object instanceof T.Mesh) {
      if (object.customDepthMaterial) addMaterial(object.customDepthMaterial);
      if (object.customDistanceMaterial) addMaterial(object.customDistanceMaterial);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
