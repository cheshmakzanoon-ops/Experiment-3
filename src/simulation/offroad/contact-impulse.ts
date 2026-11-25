/** Inelastic normal impulse for a bottomed suspension contact. The contact
 * Jacobian is [-grade, -crossGrade, 1, lever, -yaw.arm] in the travel
 * frame. yaw.arm is the change in terrain height per radian of chassis yaw
 * at the particular tyre, signed separately for the front and rear axle.
 * Positive mass and inertia are required. Separating contacts receive no
 * impulse. Coupling translation and pitch prevents penetration recovery from
 * manufacturing vertical kinetic energy out of a prescribed road speed. */
export function hardStopImpulse(
  horizontal: number,
  vertical: number,
  pitchRate: number,
  grade: number,
  lever: number,
  mass: number,
  pitchInertia: number,
  lateral = 0,
  crossGrade = 0,
  yaw?: { arm: number; rate: number; inertia: number },
) {
  const closing =
    grade * horizontal +
    crossGrade * lateral -
    vertical -
    lever * pitchRate +
    (yaw ? yaw.arm * yaw.rate : 0);
  return (
    Math.max(0, closing) /
    ((1 + grade * grade + crossGrade * crossGrade) / mass +
      (lever * lever) / pitchInertia +
      (yaw ? (yaw.arm * yaw.arm) / yaw.inertia : 0))
  );
}

/** Bottomed axle geometry, in the same travel frame as hardStopImpulse.
 * Omit an axle entirely when its suspension has not reached the stop. */
export interface HardStopContact {
  grade: number;
  lever: number;
  crossGrade?: number;
  yawArm?: number;
}

export interface HardStopVelocity {
  horizontal: number;
  vertical: number;
  pitchRate: number;
  lateral?: number;
  yawRate?: number;
}

/** Resolve both unilateral stops together. A rear impulse must not close
 * the already-solved front contact again. A = J M⁻¹ Jᵀ is only 2×2, so its
 * zero-, one- and two-contact active sets can be solved without iterations.
 * Returned impulses are nonnegative; apply their summed linear/angular
 * changes once to the incoming velocity. There is no restitution or bias
 * velocity, and therefore no impact energy supplied by this solve. */
export function coupledHardStopImpulses(
  velocity: Readonly<HardStopVelocity>,
  mass: number,
  pitchInertia: number,
  front?: Readonly<HardStopContact>,
  rear?: Readonly<HardStopContact>,
  yawInertia = Infinity,
) {
  if (!(mass > 0 && Number.isFinite(mass) && pitchInertia > 0 && Number.isFinite(pitchInertia)) ||
      !(yawInertia > 0))
    throw new RangeError('Invalid motocross hard-stop mass/inertia');
  const result = { front: 0, rear: 0 };
  if (!front && !rear) return result;
  const inverseMass = 1 / mass, inversePitch = 1 / pitchInertia, inverseYaw = 1 / yawInertia;
  const closing = (contact: Readonly<HardStopContact>) =>
    contact.grade * velocity.horizontal + (contact.crossGrade ?? 0) * (velocity.lateral ?? 0) -
    velocity.vertical - contact.lever * velocity.pitchRate +
    (contact.yawArm ?? 0) * (velocity.yawRate ?? 0);
  const mobility = (a: Readonly<HardStopContact>, b: Readonly<HardStopContact>) =>
    (1 + a.grade * b.grade + (a.crossGrade ?? 0) * (b.crossGrade ?? 0)) * inverseMass +
    a.lever * b.lever * inversePitch + (a.yawArm ?? 0) * (b.yawArm ?? 0) * inverseYaw;
  if (!front) {
    result.rear = Math.max(0, closing(rear!)) / mobility(rear!, rear!);
    return result;
  }
  if (!rear) {
    result.front = Math.max(0, closing(front)) / mobility(front, front);
    return result;
  }
  const a = mobility(front, front), b = mobility(rear, rear), c = mobility(front, rear);
  const cf = closing(front), cr = closing(rear);
  if (cf <= 0 && cr <= 0) return result;
  const singleFront = Math.max(0, cf) / a, singleRear = Math.max(0, cr) / b;
  const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(cf), Math.abs(cr));
  const frontOnly = cr - c * singleFront <= tolerance;
  const rearOnly = cf - c * singleRear <= tolerance;
  if (frontOnly || rearOnly) {
    // Identical/redundant contacts can admit either single-axle solution.
    // Their average is equally passive and does not favor an axle order.
    result.front = frontOnly ? singleFront * (rearOnly ? 0.5 : 1) : 0;
    result.rear = rearOnly ? singleRear * (frontOnly ? 0.5 : 1) : 0;
    return result;
  }
  const gf = front.grade, gr = rear.grade,
    sf = front.crossGrade ?? 0, sr = rear.crossGrade ?? 0,
    lf = front.lever, lr = rear.lever,
    yf = front.yawArm ?? 0, yr = rear.yawArm ?? 0;
  // Gram determinant as squared 2×2 minors. Unlike a*b-c*c this remains
  // accurate when two contacts have almost the same normal and moment arm.
  const determinant =
    ((gf - gr) ** 2 + (sf - sr) ** 2 + (gf * sr - sf * gr) ** 2) * inverseMass ** 2 +
    ((lf - lr) ** 2 + (gf * lr - lf * gr) ** 2 + (sf * lr - lf * sr) ** 2) * inverseMass * inversePitch +
    ((yf - yr) ** 2 + (gf * yr - yf * gr) ** 2 + (sf * yr - yf * sr) ** 2) * inverseMass * inverseYaw +
    (lf * yr - yf * lr) ** 2 * inversePitch * inverseYaw;
  // Use sum/difference coordinates so nearly identical contact rows do not
  // subtract their large common vertical terms before the solve.
  const sum = (4 + (gf + gr) ** 2 + (sf + sr) ** 2) * inverseMass +
    (lf + lr) ** 2 * inversePitch + (yf + yr) ** 2 * inverseYaw;
  const difference = ((gf - gr) ** 2 + (sf - sr) ** 2) * inverseMass +
    (lf - lr) ** 2 * inversePitch + (yf - yr) ** 2 * inverseYaw;
  const cross = ((gf - gr) * (gf + gr) + (sf - sr) * (sf + sr)) * inverseMass +
    (lf - lr) * (lf + lr) * inversePitch + (yf - yr) * (yf + yr) * inverseYaw;
  const rhsSum = 2 * (cf + cr);
  const rhsDifference = 2 * ((gf - gr) * velocity.horizontal +
    (sf - sr) * (velocity.lateral ?? 0) - (lf - lr) * velocity.pitchRate +
    (yf - yr) * (velocity.yawRate ?? 0));
  let total: number, delta: number;
  if (sum >= difference) {
    delta = (rhsDifference - cross * rhsSum / sum) / (4 * determinant / sum);
    total = (rhsSum - cross * delta) / sum;
  } else {
    total = (rhsSum - cross * rhsDifference / difference) / (4 * determinant / difference);
    delta = (rhsDifference - cross * total) / difference;
  }
  result.front = Math.max(0, (total + delta) * 0.5);
  result.rear = Math.max(0, (total - delta) * 0.5);
  return result;
}

/** Closing speed along the unit terrain normal. Positive is into the soil.
 * Keeping the cross grade matters on an off-camber or sideways landing. */
export function landingNormalSpeed(
  forward: number,
  lateral: number,
  vertical: number,
  grade: number,
  crossGrade: number,
) {
  return (grade * forward + crossGrade * lateral - vertical) / Math.hypot(1, grade, crossGrade);
}
