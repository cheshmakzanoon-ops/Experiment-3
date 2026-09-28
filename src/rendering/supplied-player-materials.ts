import * as T from 'three';

const coverageControls = new WeakMap<T.Material, { value: boolean }>();
/** The switch is retained for an independent same-frame GPU oracle. Normal
 * rendering always enables the optimization; it never changes source alpha. */
export function suppliedDecalCoverageControl(material: T.Material) {
  return coverageControls.get(material) ?? null;
}

function skipEmptyDecalCoverage(material: T.MeshStandardMaterial) {
  if (
    coverageControls.has(material) ||
    !material.name.startsWith('Decal |') ||
    !material.transparent ||
    material.blending !== T.NormalBlending ||
    material.depthWrite ||
    material.stencilWrite ||
    material.alphaToCoverage ||
    material.alphaHash ||
    material.alphaTest !== 0 ||
    (material instanceof T.MeshPhysicalMaterial && material.transmission > 0)
  )
    return;
  const enabled = { value: true },
    previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  coverageControls.set(material, enabled);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    const marker = '#include <alphatest_fragment>';
    if (!shader.fragmentShader.includes(marker))
      throw new Error('Missing supplied decal alpha stage');
    shader.uniforms.apexDiscardEmptyDecal = enabled;
    // At this point source opacity/map/vertex alpha is known. Exactly zero
    // coverage under normal alpha blending cannot affect colour or depth on
    // these non-depth-writing sheets. Retain every positive filtered edge;
    // this is not a raised alpha-test threshold or an opaque-material change.
    shader.fragmentShader =
      'uniform bool apexDiscardEmptyDecal;\n' +
      shader.fragmentShader.replace(
        marker,
        marker + '\nif (apexDiscardEmptyDecal && diffuseColor.a == 0.0) discard;',
      );
  };
  material.customProgramCacheKey = () => `${key}:supplied-empty-coverage-v1`;
  material.needsUpdate = true;
}

/** These named decals are surface sheets, not transparent volumes. Render both
 * sides once instead of submitting the entire sheet for separate back/front
 * passes. Keep alpha blending, depth, source UVs and all other materials intact. */
export function configureSuppliedMaterial(material: T.MeshStandardMaterial) {
  skipEmptyDecalCoverage(material);
  if (
    material.name.startsWith('Decal |') &&
    material.transparent &&
    material.side === T.DoubleSide
  ) {
    material.forceSinglePass = true;
  }
  for (const value of Object.values(material)) {
    if (
      value instanceof T.Texture &&
      !(value instanceof T.DataTexture) &&
      !(value instanceof T.CompressedTexture) &&
      !value.isRenderTargetTexture &&
      !value.userData.dynamic &&
      !value.flipY &&
      !value.premultiplyAlpha
    )
      value.userData.suppliedPlayerTexture = true;
  }
}
