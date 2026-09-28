import * as T from 'three';

/** These named decals are surface sheets, not transparent volumes. Render both
 * sides once instead of submitting the entire sheet for separate back/front
 * passes. Keep alpha blending, depth, source UVs and all other materials intact. */
export function configureSuppliedMaterial(material: T.MeshStandardMaterial) {
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
