import * as T from 'three';
import { HELMET, applyVisorLook } from './helmet-livery.ts';

/**
 * Supplied-driver look-dev (D16), one name-keyed call per material in the
 * SuppliedPlayer traversal. Runtime only: the hash-locked GLB, its meshes and
 * material counts are untouched, and the visor keeps its transparency, side
 * and single-pass flags.
 *
 *  - `F1CP_MAT_Visor`: the iridescent dark visor (helmet-livery VISOR).
 *  - `F1CP_MAT_HelmetPaint`: r 0.25 under a 1 / 0.03 clear coat.
 *  - Suit and glove fabrics: sheen colour 0.6× the base, sheen roughness 0.5.
 */
export const SUPPLIED_FABRICS = Object.freeze([
  'F1CP_MAT_Suit',
  'F1CP_MAT_Glove',
  'F1CP_MAT_GloveSuede',
]);
export const SUPPLIED_FABRIC_SHEEN = Object.freeze({ roughness: 0.5, colour: 0.6 });

/** Returns true when `material` was a driver material and was adjusted. */
export function applySuppliedCharacterLookdev(material: T.Material) {
  if (!(material instanceof T.MeshPhysicalMaterial)) return false;
  if (material.name === 'F1CP_MAT_Visor') {
    const { transparent, side, forceSinglePass, opacity } = material;
    applyVisorLook(material);
    Object.assign(material, { transparent, side, forceSinglePass, opacity });
    return true;
  }
  if (material.name === 'F1CP_MAT_HelmetPaint') {
    material.roughness = HELMET.roughness;
    material.clearcoat = HELMET.clearcoat;
    material.clearcoatRoughness = HELMET.clearcoatRoughness;
    return true;
  }
  if (SUPPLIED_FABRICS.includes(material.name)) {
    material.sheen = Math.max(material.sheen, 1);
    material.sheenRoughness = SUPPLIED_FABRIC_SHEEN.roughness;
    material.sheenColor.copy(material.color).multiplyScalar(SUPPLIED_FABRIC_SHEEN.colour);
    return true;
  }
  return false;
}
