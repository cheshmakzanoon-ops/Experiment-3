import type { Quaternion } from 'three';

/** Differentiate SLERP(a(t), b(t), t), including both moving endpoints.
 * Rates are quaternion derivatives with respect to the segment parameter,
 * not angular velocities. This lets spherical de Casteljau carry the exact
 * tangent of its rendered curve without sampling nearby frames or allocating.
 * `pose` and `rate` are updated in place; target inputs must be distinct. */
export function slerpDerivative(
  pose: Quaternion,
  rate: Quaternion,
  target: Quaternion,
  targetRate: Quaternion,
  t: number,
) {
  const ax = pose.x,
    ay = pose.y,
    az = pose.z,
    aw = pose.w,
    dax = rate.x,
    day = rate.y,
    daz = rate.z,
    daw = rate.w,
    sign = pose.dot(target) < 0 ? -1 : 1,
    bx = sign * target.x,
    by = sign * target.y,
    bz = sign * target.z,
    bw = sign * target.w,
    dbx = sign * targetRate.x,
    dby = sign * targetRate.y,
    dbz = sign * targetRate.z,
    dbw = sign * targetRate.w,
    cosine = Math.min(1, Math.max(0, ax * bx + ay * by + az * bz + aw * bw)),
    sine2 = Math.max(0, 1 - cosine * cosine);
  let weightA = 1 - t,
    weightB = t,
    rateA = -1,
    rateB = 1;
  // At coincident rotations the normalized linear limit avoids division by
  // sin(theta) and cancellation in d(acos(dot))/dt. Its error is O(theta³).
  if (sine2 > 1e-10) {
    const sine = Math.sqrt(sine2),
      angle = Math.atan2(sine, cosine),
      cosineRate =
        dax * bx + day * by + daz * bz + daw * bw + ax * dbx + ay * dby + az * dbz + aw * dbw,
      angleRate = -cosineRate / sine,
      denominatorRate = (cosine * angleRate) / sine;
    weightA = Math.sin((1 - t) * angle) / sine;
    weightB = Math.sin(t * angle) / sine;
    rateA =
      (Math.cos((1 - t) * angle) * ((1 - t) * angleRate - angle)) / sine -
      weightA * denominatorRate;
    rateB = (Math.cos(t * angle) * (t * angleRate + angle)) / sine - weightB * denominatorRate;
  }
  const dx = rateA * ax + weightA * dax + rateB * bx + weightB * dbx,
    dy = rateA * ay + weightA * day + rateB * by + weightB * dby,
    dz = rateA * az + weightA * daz + rateB * bz + weightB * dbz,
    dw = rateA * aw + weightA * daw + rateB * bw + weightB * dbw,
    length = Math.hypot(
      weightA * ax + weightB * bx,
      weightA * ay + weightB * by,
      weightA * az + weightB * bz,
      weightA * aw + weightB * bw,
    );
  // Preserve the exact existing pose evaluation, including its shortest-arc
  // convention. Differentiate normalization too, keeping rates tangent to S³.
  pose.slerp(target, t);
  const radial = (pose.x * dx + pose.y * dy + pose.z * dz + pose.w * dw) / pose.lengthSq();
  rate.set(
    (dx - pose.x * radial) / length,
    (dy - pose.y * radial) / length,
    (dz - pose.z * radial) / length,
    (dw - pose.w * radial) / length,
  );
}
