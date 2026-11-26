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

export interface HardStopImpulses {
  front: number;
  rear: number;
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
  out?: HardStopImpulses,
): HardStopImpulses {
  if (!(mass > 0 && Number.isFinite(mass) && pitchInertia > 0 && Number.isFinite(pitchInertia)) ||
      !(yawInertia > 0))
    throw new RangeError('Invalid motocross hard-stop mass/inertia');
  const result = out ?? { front: 0, rear: 0 };
  result.front = result.rear = 0;
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

/** Direction whose horizontal velocity must remain nonnegative. The vector
 * is normalized internally. A yawed final tyre frame uses
 * { horizontal: cos(yaw), lateral: sin(yaw) } in the incoming travel frame. */
export interface HardStopForwardAxis {
  horizontal: number;
  lateral?: number;
}

export interface BoundedHardStopImpulses extends HardStopImpulses {
  /** Linear impulse along the normalized forward axis, in N s. */
  forward: number;
}

/** Project the two bottomed stops and the no-reverse speed bound together.
 * The default bound row is [1, 0, 0, 0, 0]; a supplied axis rotates that row
 * within the horizontal plane. Apply `forward * axis / mass` along with the
 * front/rear normal impulses, then store velocity in that same bounded frame.
 * A later basis rotation requires a bound in its new actual storage frame.
 *
 * When the normal-only projection satisfies the bound it is already the
 * three-constraint solution. Otherwise the bound is active: eliminate its
 * velocity coordinate, solve the same two-contact problem in the remaining
 * mass metric, and recover the bound reaction from horizontal momentum.
 * This exhausts the active sets in fixed work without a sequential clamp. */
export function boundedHardStopImpulses(
  velocity: Readonly<HardStopVelocity>,
  mass: number,
  pitchInertia: number,
  front?: Readonly<HardStopContact>,
  rear?: Readonly<HardStopContact>,
  yawInertia = Infinity,
  forwardAxis?: Readonly<HardStopForwardAxis>,
  out?: BoundedHardStopImpulses,
): BoundedHardStopImpulses {
  const x = forwardAxis?.horizontal ?? 1, z = forwardAxis?.lateral ?? 0;
  const length = Math.hypot(x, z);
  if (!(length > 0 && Number.isFinite(length)))
    throw new RangeError('Invalid motocross forward-stop axis');
  const bx = x / length, bz = z / length;
  const result = out ?? { front: 0, rear: 0, forward: 0 };
  result.forward = 0;
  coupledHardStopImpulses(velocity, mass, pitchInertia, front, rear, yawInertia, result);
  const incoming = bx * velocity.horizontal + bz * (velocity.lateral ?? 0);
  const frontGrade = front ? bx * front.grade + bz * (front.crossGrade ?? 0) : 0;
  const rearGrade = rear ? bx * rear.grade + bz * (rear.crossGrade ?? 0) : 0;
  const normalMomentum = frontGrade * result.front + rearGrade * result.rear;
  const speedTolerance = 64 * Number.EPSILON * Math.max(1,
    Math.abs(bx * velocity.horizontal), Math.abs(bz * (velocity.lateral ?? 0)),
    Math.abs(frontGrade * result.front / mass), Math.abs(rearGrade * result.rear / mass));
  // A rounded zero must stay in its existing active set. If two rows become
  // identical after removing forward motion, the reduced solve can choose a
  // different nonunique axle split whose bound multiplier has the wrong sign.
  // The tolerance is floating-point roundoff, independent of any timestep.
  if (incoming - normalMomentum / mass >= -speedTolerance) return result;

  const perpendicular = -bz * velocity.horizontal + bx * (velocity.lateral ?? 0);
  // Setting grade to zero removes the bound-axis mobility as well as its
  // incoming speed. The remaining lateral/vertical mass and inertias are
  // unchanged because this is an orthogonal horizontal coordinate change.
  coupledHardStopImpulses(
    { horizontal: 0, lateral: perpendicular, vertical: velocity.vertical,
      pitchRate: velocity.pitchRate, yawRate: velocity.yawRate },
    mass, pitchInertia,
    front ? { grade: 0, crossGrade: -bz * front.grade + bx * (front.crossGrade ?? 0),
      lever: front.lever, yawArm: front.yawArm } : undefined,
    rear ? { grade: 0, crossGrade: -bz * rear.grade + bx * (rear.crossGrade ?? 0),
      lever: rear.lever, yawArm: rear.yawArm } : undefined,
    yawInertia, result,
  );
  const constrainedMomentum = frontGrade * result.front + rearGrade * result.rear;
  const reaction = constrainedMomentum - mass * incoming;
  const tolerance = 64 * Number.EPSILON *
    Math.max(1, Math.abs(constrainedMomentum), Math.abs(mass * incoming));
  if (reaction < -tolerance)
    throw new RangeError('Invalid motocross forward-stop active set');
  result.forward = Math.max(0, reaction);
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
