import { Vector3 } from 'three';
import { clamp } from '../core/math.ts';
import { COCKPIT_FOV } from './options.ts';

/** Chassis-space calibration relative to the retained RB19/R06 eye socket.
 * Lens and pitch belong to the seated driver, independently from the pod.
 * No source mesh, skeleton, suspension datum or recorded pose is altered. */
export const COCKPIT_FRAMING = Object.freeze({
  revision: 'p6-rb19-r06-r02',
  // P6: a lower, further-forward eye (the halo top bar sits high in frame,
  // the wheel fills the lower centre) and a 54 deg default lens.
  eyeOffset: Object.freeze([0, -0.03, -0.04] as const),
  motionLimit: Object.freeze([0.02, 0.012, 0.018] as const),
  verticalFov: COCKPIT_FOV.default,
  pitchRadians: -0.035,
  finalArtApproved: false,
});

/** The cockpit lens from the `cockpitFov` graphics key, clamped to its range. */
export function cockpitFov(setting: number) {
  return Number.isFinite(setting)
    ? clamp(setting, COCKPIT_FOV.min, COCKPIT_FOV.max)
    : COCKPIT_FRAMING.verticalFov;
}
/** P7: T-cam vertical field of view, 58 deg plus up to 4 deg with speed (m/s). */
export const TCAM_FOV = Object.freeze({ base: 58, gain: 0.05, max: 4 });
export function tcamFov(speed: number) {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  return TCAM_FOV.base + Math.min(TCAM_FOV.max, v * TCAM_FOV.gain);
}

export function cockpitEye(socket: Vector3, motion: Vector3, out: Vector3) {
  if (![socket.x, socket.y, socket.z, motion.x, motion.y, motion.z].every(Number.isFinite))
    throw new Error('Invalid cockpit eye input');
  const { eyeOffset: e, motionLimit: m } = COCKPIT_FRAMING;
  return out.set(
    socket.x + e[0] + clamp(motion.x, -m[0], m[0]),
    socket.y + e[1] + clamp(motion.y, -m[1], m[1]),
    socket.z + e[2] + clamp(motion.z, -m[2], m[2]),
  );
}

export function cockpitDirection(out: Vector3) {
  const pitch = COCKPIT_FRAMING.pitchRadians;
  return out.set(0, Math.sin(pitch), Math.cos(pitch));
}
