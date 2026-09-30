import { Vector3 } from 'three';
import { clamp } from '../core/math.ts';

/** Chassis-space calibration relative to the retained RB19/R06 eye socket.
 * Lens and pitch belong to the seated driver, independently from the pod.
 * No source mesh, skeleton, suspension datum or recorded pose is altered. */
export const COCKPIT_FRAMING = Object.freeze({
  revision: 'p0-rb19-r06-r01',
  eyeOffset: Object.freeze([0, -0.05, -0.12] as const),
  motionLimit: Object.freeze([0.02, 0.012, 0.018] as const),
  verticalFov: 64,
  pitchRadians: -0.045,
  finalArtApproved: false,
});

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
