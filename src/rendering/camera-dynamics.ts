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
    if (!this.initialized) {
      this.rotation.copy(target);
      this.initialized = true;
    } else this.rotation.slerp(target, 1 - Math.exp(-32 * Math.min(dt, 0.1)));
    return this.rotation;
  }
}
