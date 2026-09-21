import { Vector2 } from 'three';
/** Metre-scaled, closed rubber cross-section shared by the articulated carcass
 * and both reduced models. Tessellation changes, bead and shoulder dimensions do not. */
export function tireProfile(halfWidth: number) {
  if (!Number.isFinite(halfWidth) || halfWidth < 0.1 || halfWidth > 0.25)
    throw new Error('Invalid tyre half-width');
  return [
    [0.245, -halfWidth],
    [0.306, -halfWidth],
    [0.331, -halfWidth + 0.025],
    [0.335, -halfWidth + 0.065],
    [0.335, halfWidth - 0.065],
    [0.331, halfWidth - 0.025],
    [0.306, halfWidth],
    [0.245, halfWidth],
    [0.245, -halfWidth],
  ].map(([r, y]) => new Vector2(r, y));
}
