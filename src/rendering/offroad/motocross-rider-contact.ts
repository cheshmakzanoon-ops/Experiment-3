import * as T from 'three';

/** Landmarks in the existing MX equipment, measured in its bind frame.
 * The curled fingers hold a cylinder ahead of the wrist; the sole rests
 * below the ankle. Aiming the bone endpoint at the control collapses these
 * two distinct locations and lets the equipment rotate through the bike. */
export const MX_GLOVE_GRIP = Object.freeze([0, -0.014, 0.052] as const);
export const MX_GLOVE_WRIST = Object.freeze([0, 0, -0.024] as const);
export const MX_BOOT_ANKLE = Object.freeze([0, -0.074, -0.012] as const);
export const MX_BOOT_PEG = Object.freeze([0, 0.031, 0.02] as const);
/** The peg anchor is 8.5 mm below the tips of the authored serrations. */
export const MX_PEG_TOP = 0.0085;

const bootEuler = new T.Euler();

/** The forefoot points along the bike, with its sole down and a small heel
 * lift. The calf has its own skin transform; it follows the solved shin.
 * A dab smoothly extends the same boot, without inheriting a previous pose. */
export function motocrossBootFrame(target: T.Quaternion, dab = 0) {
  const down = Number.isFinite(dab) ? T.MathUtils.clamp(dab, 0, 1) : 0;
  return target.setFromEuler(bootEuler.set(0.06 + down * 0.12, 0, Math.PI));
}

/** A sole contact moves ahead and out for a foot dab. The opposite boot
 * remains planted. This target is shared by riding and its visual checks. */
export function motocrossSoleContact(peg: T.Vector3, side: number, dab: number, target: T.Vector3) {
  const down = Number.isFinite(dab) ? T.MathUtils.clamp(side * dab, 0, 1) : 0;
  target.copy(peg);
  target.x += side * 0.2 * down;
  target.y += MX_PEG_TOP - 0.015 * down;
  target.z += 0.32 * down;
  return target;
}
