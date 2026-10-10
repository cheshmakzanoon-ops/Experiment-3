import type * as T from 'three';
import { SHOWROOM } from '../menu-preview.ts';
import { TELEPHOTO } from '../trackside.ts';
import type { DepthOfFieldPass } from './dof-pass.ts';

/**
 * Depth of field on the subject car outside photo mode (D29 showroom, D30
 * broadcast telephoto): the menu's showroom lens, or a trackside lens tighter
 * than `TELEPHOTO.dofBelow` degrees. Photo mode keeps its own lens settings.
 */
export interface SubjectLens {
  aperture: number;
  maxblur: number;
}
export function subjectLens(
  menu: boolean,
  photo: boolean,
  camera: string,
  fov: number,
): SubjectLens | null {
  if (photo) return null;
  if (menu) return SHOWROOM;
  return camera === 'trackside' && fov < TELEPHOTO.dofBelow ? TELEPHOTO : null;
}

/** Focus the pass on `subject` (optical-axis depth, as the depth shader sees it). */
export function focusOnSubject(
  pass: DepthOfFieldPass,
  camera: T.PerspectiveCamera,
  subject: T.Vector3,
  lens: SubjectLens,
  scratch: T.Vector3,
) {
  camera.updateMatrixWorld();
  const uniforms = pass.materialBokeh.uniforms;
  uniforms.focus.value = -scratch.copy(subject).applyMatrix4(camera.matrixWorldInverse).z;
  uniforms.aperture.value = lens.aperture;
  uniforms.maxblur.value = lens.maxblur;
  pass.enabled = true;
}
