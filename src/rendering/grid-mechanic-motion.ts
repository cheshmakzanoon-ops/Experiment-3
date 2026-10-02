import * as T from 'three';
import { GRID_PRESENTATION_SECONDS } from '../core/grid-presentation.ts';

export const GRID_MECHANIC_VERSION = 1;
export const GRID_BLANKET_RADIUS = 0.392;
export const GRID_MECHANIC_FLOOR = -0.52;
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
const between = (t: number, a: number, b: number) => smooth((t - a) / (b - a));

/** A planted foot remains at its last world-space step until its next swing.
 * Distances are along the actor's heading, not elapsed wall time. */
export function gridStep(distance: number, length: number, foot: 0 | 1) {
  const d = Math.max(0, Math.min(length, distance));
  const steps = Math.max(2, Math.ceil(length / 0.24));
  const stride = length / steps;
  if (stride === 0) return { forward: 0, lift: 0, planted: true };
  const phase = Math.min(steps - 1e-8, d / stride);
  const index = Math.floor(phase);
  const swing = index % 2 === foot;
  const last = index - (index % 2 === foot ? 2 : 1);
  const from = last < 0 ? 0 : (last + 1.5) * stride;
  const to = (index + 1.5) * stride;
  const u = phase - index;
  return {
    forward: swing ? from + (to - from) * smooth(u) : from,
    lift: swing ? 0.085 * Math.sin(Math.PI * u) ** 2 : 0,
    planted: !swing || d === 0 || d === length,
  };
}

/** Metre-scale blanket mesh and hand sockets share this exact deformation. */
export function gridBlanketPoint(u: number, angle: number, fold: number, out: T.Vector3) {
  const radius = GRID_BLANKET_RADIUS;
  const wrappedY = radius * Math.cos(angle),
    wrappedZ = radius * Math.sin(angle);
  const foldedY = 0.035 * Math.cos(angle * 4) + 0.014 * Math.cos(angle),
    foldedZ = 0.31 * Math.sin(angle);
  return out.set(u, wrappedY + (foldedY - wrappedY) * fold, wrappedZ + (foldedZ - wrappedZ) * fold);
}

export interface GridMechanicMotion {
  time: number;
  visible: boolean;
  phase: 'standby' | 'approach' | 'kneel' | 'inspect' | 'gather' | 'rise' | 'carry' | 'clear';
  position: T.Vector3;
  yaw: number;
  hip: number;
  lean: number;
  headYaw: number;
  grip: number;
  fold: number;
  blanket: T.Vector3;
  feet: [T.Vector3, T.Vector3];
  planted: [boolean, boolean];
}
export function gridMechanicMotion(): GridMechanicMotion {
  return {
    time: 0,
    visible: true,
    phase: 'standby',
    position: new T.Vector3(),
    yaw: 0,
    hip: 0.86,
    lean: 0.03,
    headYaw: 0,
    grip: 0,
    fold: 0,
    blanket: new T.Vector3(),
    feet: [new T.Vector3(), new T.Vector3()],
    planted: [true, true],
  };
}

/** Original key poses plus distance-locked stepping. Coordinates are car-local;
 * feet are actor-local. The sequence is independent of the live race snapshot. */
export function poseGridMechanic(
  time: number,
  wheel: number,
  hub: T.Vector3,
  out = gridMechanicMotion(),
): GridMechanicMotion {
  if (!Number.isFinite(time) || wheel < 0 || wheel > 3 || !Number.isInteger(wheel))
    throw new Error('Invalid grid mechanic sample');
  const t = Math.max(0, Math.min(GRID_PRESENTATION_SECONDS, time));
  const side = Math.sign(hub.x) || 1;
  const approach = between(t, 4, 7),
    kneel = between(t, 7, 9),
    rise = between(t, 15, 17);
  const outbound = between(t, 17, 22);
  const distance = t < 17 ? 0.9 * approach : 2.7 * outbound;
  out.time = t;
  out.phase =
    t < 4
      ? 'standby'
      : t < 7
        ? 'approach'
        : t < 9
          ? 'kneel'
          : t < 12
            ? 'inspect'
            : t < 15
              ? 'gather'
              : t < 17
                ? 'rise'
                : t < 22
                  ? 'carry'
                  : 'clear';
  out.visible = t < 22;
  out.position.set(
    hub.x + side * (1.52 - 0.9 * approach + 2.7 * outbound),
    GRID_MECHANIC_FLOOR,
    hub.z,
  );
  // Face the wheel; carry backwards into the clearance corridor, without a
  // sudden 180-degree root turn that would drag planted feet around the car.
  out.yaw = (-side * Math.PI) / 2;
  const crouch = kneel * (1 - rise);
  out.hip = 0.86 - 0.4 * crouch;
  out.lean = 0.035 + 0.15 * crouch;
  out.headYaw = 0.08 * Math.sin(t * 0.65 + wheel);
  out.grip = between(t, 7, 9);
  out.fold = between(t, 12, 15);
  out.blanket.copy(hub);
  const carried = between(t, 12, 15);
  out.blanket.x += (out.position.x - side * 0.42 - hub.x) * carried;
  out.blanket.y += (GRID_MECHANIC_FLOOR + 0.69 + 0.19 * rise - hub.y) * carried;
  for (const foot of [0, 1] as const) {
    const step = gridStep(distance, t < 17 ? 0.9 : 2.7, foot);
    const finalApproach = gridStep(0.9, 0.9, foot).forward - 0.9;
    let forward = t < 17 ? step.forward - distance : -(step.forward - distance);
    if (t >= 17) forward += finalApproach;
    const kneelFoot = foot === 0 ? 0.29 : -0.32;
    // Reposition one foot at a time; the other remains at a fixed contact.
    // Simultaneous lifts made the previous crouch/rise float above the grid.
    const lowerStart = 7 + foot;
    const riseStart = foot === 1 ? 15 : 16;
    const lowering = between(t, lowerStart, lowerStart + 1);
    const standing = between(t, riseStart, riseStart + 1);
    if (t >= 7 && t < 17)
      forward = finalApproach + (kneelFoot - finalApproach) * lowering * (1 - standing);

    const shiftStart = t < 15 ? lowerStart : riseStart;
    const reposition = t > shiftStart && t < shiftStart + 1;
    const repositioningStage = t >= 7 && t < 17;
    const lifting = repositioningStage
      ? reposition
        ? 0.055 * Math.sin(Math.PI * (t - shiftStart)) ** 2
        : 0
      : step.lift;
    out.feet[foot].set(foot === 0 ? -0.14 : 0.14, 0.055 + lifting, 0.035 + forward);
    out.planted[foot] = repositioningStage ? !reposition : step.planted;
  }
  // Lower the pelvis when a long planted stance would otherwise stretch a leg.
  for (const foot of out.feet)
    out.hip = Math.min(
      out.hip,
      foot.y + Math.sqrt(Math.max(0.01, 0.817 ** 2 - foot.z ** 2 - 0.048 ** 2)),
    );
  return out;
}

/** Purposeful static-to-static camera moves; reduced-motion uses one wide view. */
export function gridPresentationCamera(
  time: number,
  reducedMotion: boolean,
  eye: T.Vector3,
  target: T.Vector3,
) {
  if (reducedMotion) {
    eye.set(-6.4, 2.4, 5.5);
    target.set(0, 0.4, 0.3);
    return 46;
  }
  const close = between(time, 3, 5),
    wide = between(time, 17, 21);
  const mix = close * (1 - wide);
  eye.set(-6.4 + 3.55 * mix, 2.4 - 1.48 * mix, 5.5 - 1.92 * mix);
  target.set(-1.28 * mix, 0.4 - 0.08 * mix, 0.3 + 1.12 * mix);
  return 46 + 6 * mix;
}
