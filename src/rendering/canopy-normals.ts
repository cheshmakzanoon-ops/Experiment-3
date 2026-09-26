import * as T from 'three';

/** Crossed foliage cards carry normals for the aggregate crown volume. Flipping
 * them on a back-facing card inverts that volume's lighting when the camera
 * crosses the plane. Undo ONLY that smooth, double-sided face correction; this
 * is not appropriate for actual thin leaves or flat-shaded geometry.
 *
 * No opacity, alpha-test, depth or shadow changes. Existing UV hooks are kept.
 */
export function installCanopyNormals(material: T.MeshStandardMaterial) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    const hook = '#include <normal_fragment_begin>';
    if (!shader.fragmentShader.includes(hook)) throw new Error('Canopy normal hook missing');
    shader.fragmentShader = shader.fragmentShader.replace(
      hook,
      `${hook}
#if defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)
  normal *= faceDirection;
  nonPerturbedNormal = normal;
#endif`,
    );
  };
  material.customProgramCacheKey = () => `${key}-aggregate-canopy-normals-v1`;
  return material;
}
