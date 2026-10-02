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
  distancePhase: number;
  visible: boolean;
  phase:
    | 'standby'
    | 'approach'
    | 'kneel'
    | 'inspect'
    | 'gather'
    | 'rise'
    | 'turn'
    | 'carry'
    | 'clear';
  position: T.Vector3;
  yaw: number;
  hip: number;
  lean: number;
  headYaw: number;
  grip: number;
  fold: number;
  blanket: T.Vector3;
  blanketYaw: number;
  feet: [T.Vector3, T.Vector3];
  planted: [boolean, boolean];
}
export function gridMechanicMotion(): GridMechanicMotion {
  return {
    time: 0,
    distancePhase: 0,
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
    blanketYaw: 0,
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
  actorId = 0,
  exitX = (Math.sign(hub.x) || 1) * 9.5,
): GridMechanicMotion {
  if (!Number.isFinite(time) || wheel < 0 || wheel > 3 || !Number.isInteger(wheel))
    throw new Error('Invalid grid mechanic sample');
  // Small repeatable offsets separate the crew performances without changing
  // task order or simulation time. The last actor clears before the ready stage.
  const offset = [0, 0.12, 0.24, 0.08][wheel] + (actorId % 3) * 0.18;
  const t = Math.max(0, Math.min(GRID_PRESENTATION_SECONDS, time - offset));
  const side = Math.sign(hub.x) || 1;
  const approach = between(t, 4, 7),
    kneel = between(t, 7, 9),
    rise = between(t, 15, 17);
  const sideExit = Math.sign(exitX) || side;
  const startX = hub.x + side * 0.62;
  // Separate inner/outer wheel teams longitudinally. Inboard crew go around
  // the nose/tail before crossing the row, not through a neighbouring car.
  const routeZ = Math.sign(hub.z) * (sideExit === side ? 4.85 : 3.95);
  const length1 = Math.abs(routeZ - hub.z);
  const length2 = Math.abs(exitX - startX);
  const longTravel = length1 * between(t, 20, 23);
  const sideTravel = length2 * between(t, 26, 34);
  const initialYaw = (-side * Math.PI) / 2;
  const longYaw = hub.z > 0 ? 0 : Math.PI;
  const exitYaw = (sideExit * Math.PI) / 2;
  const shortest = (from: number, to: number) =>
    Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const delta1 = shortest(initialYaw, longYaw);
  const delta2 = shortest(longYaw, exitYaw);
  const turnAngle = (foot: number, start: number, angle: number) =>
    angle *
    0.5 *
    (between(t, start + foot * 0.75, start + 0.75 + foot * 0.75) +
      between(t, start + 1.5 + foot * 0.75, start + 2.25 + foot * 0.75));
  out.time = t;
  const stridePhase = (distance: number, length: number) =>
    distance / ((2 * length) / Math.max(2, Math.ceil(length / 0.24)));
  out.distancePhase =
    t < 7
      ? stridePhase(0.9 * approach, 0.9)
      : t >= 20 && t < 23
        ? stridePhase(longTravel, length1)
        : t >= 26
          ? stridePhase(sideTravel, length2)
          : 0;
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
                : t < 20 || (t >= 23 && t < 26)
                  ? 'turn'
                  : t < 34
                    ? 'carry'
                    : 'clear';
  out.visible = true;
  out.position.set(
    hub.x + side * (1.52 - 0.9 * approach) + sideExit * sideTravel,
    GRID_MECHANIC_FLOOR,
    hub.z + Math.sign(hub.z) * longTravel,
  );
  out.yaw =
    t < 23
      ? initialYaw + (turnAngle(0, 17, delta1) + turnAngle(1, 17, delta1)) / 2
      : initialYaw + delta1 + (turnAngle(0, 23, delta2) + turnAngle(1, 23, delta2)) / 2;
  out.blanketYaw = out.yaw - initialYaw;
  const crouch = kneel * (1 - rise);
  out.hip = 0.86 - 0.4 * crouch;
  out.lean = 0.035 + 0.15 * crouch;
  out.headYaw = 0.08 * Math.sin(t * 0.65 + wheel);
  out.grip = between(t, 7, 9);
  out.fold = between(t, 12, 15);
  out.blanket.copy(hub);
  const carried = between(t, 12, 15);
  out.blanket.x += (out.position.x + Math.sin(out.yaw) * 0.42 - hub.x) * carried;
  out.blanket.z += (out.position.z + Math.cos(out.yaw) * 0.42 - hub.z) * carried;
  out.blanket.y += (GRID_MECHANIC_FLOOR + 0.69 + 0.19 * rise - hub.y) * carried;
  for (const foot of [0, 1] as const) {
    const approachStep = gridStep(0.9 * approach, 0.9, foot);
    const approachEnd = gridStep(0.9, 0.9, foot).forward - 0.9;
    const leg1End = approachEnd + gridStep(length1, length1, foot).forward - length1;
    let forward = approachStep.forward - 0.9 * approach;
    let lifting = approachStep.lift;
    let planted = approachStep.planted;
    if (t >= 7 && t < 17) {
      const lowerStart = 7 + foot,
        riseStart = foot === 1 ? 15 : 16;
      const lowering = between(t, lowerStart, lowerStart + 1),
        standing = between(t, riseStart, riseStart + 1);
      forward =
        approachEnd + ((foot === 0 ? 0.29 : -0.32) - approachEnd) * lowering * (1 - standing);
      const shiftStart = t < 15 ? lowerStart : riseStart;
      planted = !(t > shiftStart && t < shiftStart + 1);
      lifting = planted ? 0 : 0.055 * Math.sin(Math.PI * (t - shiftStart)) ** 2;
    } else if (t >= 20 && t < 23) {
      const step = gridStep(longTravel, length1, foot);
      forward = approachEnd + step.forward - longTravel;
      lifting = step.lift;
      planted = step.planted;
    } else if (t >= 26) {
      const step = gridStep(sideTravel, length2, foot);
      forward = leg1End + step.forward - sideTravel;
      lifting = step.lift;
      planted = step.planted;
    }
    out.feet[foot].set(foot === 0 ? -0.14 : 0.14, 0.055 + lifting, 0.035 + forward);
    out.planted[foot] = planted;
    if ((t >= 17 && t < 20) || (t >= 23 && t < 26)) {
      const start = t < 20 ? 17 : 23,
        delta = t < 20 ? delta1 : delta2;
      const baseYaw = t < 20 ? initialYaw : initialYaw + delta1;
      const angle = turnAngle(foot, start, delta) + baseYaw - out.yaw;
      const x = foot === 0 ? -0.14 : 0.14,
        z = 0.035 + (t < 20 ? approachEnd : leg1End);
      const swingStart = t < start + 1.5 ? start + foot * 0.75 : start + 1.5 + foot * 0.75;
      const swing = t > swingStart && t < swingStart + 0.75;
      out.feet[foot].set(
        x * Math.cos(angle) + z * Math.sin(angle),
        0.055 + (swing ? 0.065 * Math.sin((Math.PI * (t - swingStart)) / 0.75) ** 2 : 0),
        z * Math.cos(angle) - x * Math.sin(angle),
      );
      out.planted[foot] = !swing;
    }
  }
  // Lower the pelvis when a long planted stance would otherwise stretch a leg.
  for (let f = 0; f < 2; f++) {
    const foot = out.feet[f],
      dx = foot.x - (f === 0 ? -0.092 : 0.092);
    out.hip = Math.min(
      out.hip,
      foot.y + Math.sqrt(Math.max(0.01, 0.817 ** 2 - foot.z ** 2 - dx ** 2)),
    );
  }
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
    wide = between(time, 29, 35);
  const mix = close * (1 - wide);
  eye.set(-6.4 + 3.55 * mix, 2.4 - 1.48 * mix, 5.5 - 1.92 * mix);
  target.set(-1.28 * mix, 0.4 - 0.08 * mix, 0.3 + 1.12 * mix);
  return 46 + 6 * mix;
}
