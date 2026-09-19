import { Quaternion, Vector3 } from 'three';
import { clamp } from '../core/math.ts';

/** Analytic critically-damped spring. A relative offset, not a delayed world
 * position, keeps the driver's eyes inside the cockpit at constant velocity. */
export class InertialCamera {
  readonly offset = new Vector3();
  private velocity = new Vector3();
  private target = new Vector3();
  private error = new Vector3();
  private coefficient = new Vector3();
  private previousImpact = 0;
  reset() {
    this.offset.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.previousImpact = 0;
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
    const h = Math.min(dt, 0.25),
      omega = 22;
    gain = clamp(gain, 0, 1);
    this.target.set(
      clamp(-lateralG * 0.012, -0.04, 0.04) * gain,
      clamp(-verticalG * 0.004, -0.022, 0.022) * gain,
      clamp(-longitudinalG * 0.008, -0.04, 0.04) * gain,
    );
    if (impact > this.previousImpact + 0.01) {
      this.velocity.y -= (impact - this.previousImpact) * 0.1 * gain;
      this.velocity.z += (impact - this.previousImpact) * 0.1 * gain;
    }
    this.previousImpact = impact;
    this.error.copy(this.offset).sub(this.target);
    this.coefficient.copy(this.velocity).addScaledVector(this.error, omega);
    const decay = Math.exp(-omega * h);
    this.offset
      .copy(this.error)
      .addScaledVector(this.coefficient, h)
      .multiplyScalar(decay)
      .add(this.target);
    this.velocity.addScaledVector(this.coefficient, -omega * h).multiplyScalar(decay);
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
      !Number.isFinite(dt) ||
      dt < 0 ||
      !Number.isFinite(target.x + target.y + target.z + target.w) ||
      Math.abs(target.lengthSq() - 1) > 0.001
    )
      throw new Error('Invalid view orientation');
    if (!this.initialized) {
      this.rotation.copy(target);
      this.initialized = true;
    } else if (dt > 0) {
      this.rotation.slerp(target, -Math.expm1(-32 * Math.min(dt, 0.1)));
      // Heading lag is a small driver response, not a world-locked view. Even a
      // slow frame through a hairpin must keep the instruments ahead of the eyes.
      const lag = this.rotation.angleTo(target);
      if (lag > 0.04) this.rotation.rotateTowards(target, lag - 0.04);
      this.rotation.normalize();
    }
    return this.rotation;
  }
}

/** Camera springs and pan/zoom consume the presented simulation clock. A paused
 * frame can still change camera mode/free look, but cannot advance its inertia.
 * Menu orbiting is separate, and seeks establish a new clock baseline. */
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
    // A slow render is not a pause. Springs retain a bounded integration step;
    // true discontinuities are explicitly rebaselined by the renderer.
    return !this.discontinuous && elapsed > 0 ? Math.min(elapsed, 0.08) : 0;
  }
}
