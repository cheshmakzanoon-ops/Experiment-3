import * as T from 'three';

export const GRIP_RADIUS = 0.023;
export const HAND_ANCHOR = Object.freeze({ x: 0.178, y: -0.009, z: -0.01 });
const PROFILE = [
  [-0.081, 0.154, 0],
  [-0.046, 0.18, 0],
  [0.011, 0.185, -0.002],
  [0.05, 0.17, 0],
] as const;
/** Both the molded suede grip and curled fingers use this same centreline.
 * No independent artistic hand offset can slowly detach them from one another. */
export function wheelGripPoint(side: number, y: number, out = new T.Vector3()) {
  if ((side !== -1 && side !== 1) || !Number.isFinite(y))
    throw new Error('Invalid grip coordinate');
  y = T.MathUtils.clamp(y, PROFILE[0][0], PROFILE.at(-1)![0]);
  let i = 0;
  while (i < PROFILE.length - 2 && y > PROFILE[i + 1][0]) i++;
  const a = PROFILE[i],
    b = PROFILE[i + 1],
    before = PROFILE[Math.max(0, i - 1)],
    after = PROFILE[Math.min(PROFILE.length - 1, i + 2)];
  const dy = b[0] - a[0],
    t = (y - a[0]) / dy;
  const at = (axis: 1 | 2) =>
    T.MathUtils.clamp(
      (2 * t ** 3 - 3 * t ** 2 + 1) * a[axis] +
        ((t ** 3 - 2 * t ** 2 + t) * dy * (b[axis] - before[axis])) / (b[0] - before[0]) +
        (-2 * t ** 3 + 3 * t ** 2) * b[axis] +
        ((t ** 3 - t ** 2) * dy * (after[axis] - a[axis])) / (after[0] - a[0]),
      Math.min(a[axis], b[axis]),
      Math.max(a[axis], b[axis]),
    );
  return out.set(side * at(1), y, at(2));
}
class GripCurve extends T.Curve<T.Vector3> {
  constructor(readonly side: number) {
    super();
  }
  getPoint(t: number, out = new T.Vector3()) {
    return wheelGripPoint(this.side, T.MathUtils.lerp(PROFILE[0][0], PROFILE.at(-1)![0], t), out);
  }
}
export function wheelGripGeometry(side: number) {
  wheelGripPoint(side, 0);
  return new T.TubeGeometry(new GripCurve(side), 48, GRIP_RADIUS, 12, false);
}

export function fingerGripCurve(side: number, finger: number) {
  if ((side !== -1 && side !== 1) || !Number.isInteger(finger) || finger < 0 || finger > 3)
    throw new Error('Invalid glove finger');
  const y = 0.028 - finger * 0.018;
  const centre = wheelGripPoint(side, y + HAND_ANCHOR.y).sub(
    new T.Vector3(side * HAND_ANCHOR.x, HAND_ANCHOR.y, HAND_ANCHOR.z),
  );
  // Finger centreline is offset by its real thickness from the grip surface.
  // A short distal release leaves the fingertip free; the proximal phalanx
  // contacts the suede without burying the glove in the wheel.
  const points = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8,
      angle = T.MathUtils.lerp(-1.7, 1.72 + finger * 0.018, t);
    const thickness = (0.0088 - t * 0.0034) * (1 + 0.11 * Math.sin(t * Math.PI * 3) ** 8);
    const radius = GRIP_RADIUS + thickness + 0.0008 + 0.0012 * t ** 4;
    return new T.Vector3(
      centre.x + side * Math.cos(angle) * radius,
      y - t * 0.0015,
      centre.z + Math.sin(angle) * radius,
    );
  });
  return new T.CatmullRomCurve3(points);
}
