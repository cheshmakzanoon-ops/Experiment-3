import { Quaternion, Vector3 } from 'three';
import { clamp } from '../core/math.ts';

/** Analytic critically-damped spring driven by presented acceleration. Forces
 * vary linearly between observations instead of applying the newest force for
 * the entire preceding frame. A relative offset, not a delayed world position,
 * keeps the driver's eyes inside the cockpit at constant velocity. */
export class InertialCamera {
  readonly offset = new Vector3();
  private velocity = new Vector3();
  private target = new Vector3();
  private previousTarget = new Vector3();
  private targetChange = new Vector3();
  private error = new Vector3();
  private coefficient = new Vector3();
  private previousImpact = 0;
  private initialized = false;
  reset() {
    this.offset.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.previousImpact = 0;
    this.initialized = false;
  }
  step(
    dt: number,
    lateralG: number,
    longitudinalG: number,
    verticalG: number,
    impact: number,
    gain: number,
  ) {
    if (![dt, lateralG, longitudinalG, verticalG, impact, gain].every(Number.isFinite) || dt < 0)
      throw new Error('Invalid camera state');
    const h = dt,
      omega = 22;
    gain = clamp(gain, 0, 1);
    this.target.set(
      clamp(-lateralG * 0.012, -0.04, 0.04) * gain,
      clamp(-verticalG * 0.004, -0.022, 0.022) * gain,
      clamp(-longitudinalG * 0.008, -0.04, 0.04) * gain,
    );
    // The first observation after a cut has no preceding force history. A
    // zero-time sample establishes that baseline without advancing the spring
    // or inventing another strike from a replay's already-decaying impact.
    if (!this.initialized || h === 0) {
      this.previousTarget.copy(this.target);
      this.previousImpact = impact;
      this.initialized = true;
      if (h === 0) return this.offset;
    }
    this.targetChange.copy(this.target).sub(this.previousTarget);
    this.error.copy(this.offset).sub(this.previousTarget);
    this.coefficient.copy(this.velocity).addScaledVector(this.error, omega);
    const z = omega * h,
      decay = Math.exp(-z),
      // [1 - (1 + z) exp(-z)] / z². Its series prevents subtractive
      // cancellation for tiny simulation-time advances, including slow replay.
      stepResponse =
        z < 0.001
          ? 0.5 + z * (-1 / 3 + z * (1 / 8 + z * (-1 / 30 + z / 144)))
          : (-Math.expm1(-z) - z * decay) / (z * z),
      // Response to a target changing by one unit over this interval.
      rampResponse =
        z < 0.001
          ? z * z * (1 / 6 + z * (-1 / 12 + z * (1 / 40 + z * (-1 / 180 + z / 1008))))
          : 1 + decay + (2 * Math.expm1(-z)) / z;
    this.offset
      .copy(this.error)
      .addScaledVector(this.coefficient, h)
      .multiplyScalar(decay)
      .add(this.previousTarget)
      .addScaledVector(this.targetChange, rampResponse);
    this.velocity
      .addScaledVector(this.coefficient, -z)
      .multiplyScalar(decay)
      .addScaledVector(this.targetChange, omega * z * stepResponse);
    // IMPACT is a recorded envelope, not a render-frame event. Integrate its
    // positive change across the observed interval. A per-frame 0.01 threshold
    // discarded the same strike at high refresh rates; an impulse at the start
    // of every frame also made low-refresh recoil arrive early.
    const impulse = Math.max(0, impact - this.previousImpact) * 0.1 * gain,
      displacement = impulse * h * stepResponse,
      speed = impulse * decay;
    this.offset.y -= displacement;
    this.offset.z += displacement;
    this.velocity.y -= speed;
    this.velocity.z += speed;
    this.previousTarget.copy(this.target);
    this.previousImpact = impact;
    return this.offset;
  }
  eye(position: Vector3, orientation: Quaternion, pod: boolean, out: Vector3) {
    out.set(0, pod ? 0.87 : 0.41, pod ? -0.78 : -0.48);
    return out.add(this.offset).applyQuaternion(orientation).add(position);
  }
}

/** A driver view follows heading, while the up-vector retains bounded body roll.
 * Angular filtering never delays translational motion out of the driver's seat. */
export class ViewOrientation {
  readonly rotation = new Quaternion();
  private initialized = false;
  reset() {
    this.initialized = false;
  }
  update(target: Quaternion, dt: number) {
    if (
      !Number.isFinite(dt + target.x + target.y + target.z + target.w) ||
      dt < 0 ||
      Math.abs(target.lengthSq() - 1) > 0.001
    )
      throw new Error('Invalid camera orientation');
    if (!this.initialized) {
      this.rotation.copy(target);
      this.initialized = true;
    } else if (dt > 0) {
      this.rotation.slerp(target, -Math.expm1(-32 * dt));
      const lag = this.rotation.angleTo(target);
      if (lag > 0.04) this.rotation.rotateTowards(target, lag - 0.04);
      this.rotation.normalize();
    }
    return this.rotation;
  }
}

/** Camera springs and pan/zoom consume the presented simulation clock. A paused
 * frame can still change camera mode/free look, but cannot advance its inertia.
 * Slow rendering must still converge to the observed pose, not freeze heading.
 * Work is capped at two seconds; explicit seeks call reset(). Menu orbiting is
 * separate, and rewinds establish a new clock baseline. */
export class CameraClock {
  private time = NaN;
  discontinuous = true;
  reset() {
    this.time = NaN;
  }
  step(time: number, menu = false) {
    if (!Number.isFinite(time)) throw new Error('Invalid camera presentation time');
    const elapsed = time - this.time;
    this.time = menu ? NaN : time;
    this.discontinuous = menu || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 2;
    return !menu && Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, 2) : 0;
  }
}
