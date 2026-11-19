import * as T from 'three';

/** Material properties hold this venue's texture handles. Shader uniforms may
 * reference the shared scanned-ground cache and are deliberately not visited.
 * Capture fallback maps before a scanned hook temporarily removes them. */
export function collectOffroadMaps(material: T.Material, textures: Set<T.Texture>) {
  for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
}

/** Release an offroad owner's exclusive scene roots and detached palette/maps.
 * Texture handles can share source pixels with the scan/procedural libraries;
 * disposing the handle must never close that shared image or the source map. */
export function disposeOffroadResources(
  roots: readonly T.Object3D[],
  extraMaterials: Iterable<T.Material> = [],
  extraTextures: Iterable<T.Texture> = [],
  extraGeometries: Iterable<T.BufferGeometry> = [],
) {
  const geometries = new Set(extraGeometries),
    materials = new Set(extraMaterials),
    textures = new Set(extraTextures),
    instances = new Set<T.InstancedMesh>();
  for (const root of roots) {
    root.removeFromParent();
    root.traverse((object) => {
      if (!(object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line))
        return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
      if (object instanceof T.Mesh) {
        if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
        if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
      }
      if (object instanceof T.InstancedMesh) instances.add(object);
    });
  }
  for (const material of materials) collectOffroadMaps(material, textures);
  for (const instance of instances) instance.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  for (const root of roots) root.clear();
}
