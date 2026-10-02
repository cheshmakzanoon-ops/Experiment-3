import * as T from 'three';
import { clamp } from '../core/math.ts';
import { CrewPerformanceSampler, type CrewAction } from './crew-performance.ts';

export type PitRole = 'gun' | 'remove' | 'install' | 'front-jack' | 'rear-jack' | 'release';
/** Authoring references only; physical hip height and tool positions remain
 * measured from the serviced car. Each action has its own authored performance. */
export const PIT_ROLE_ACTIONS = Object.freeze({
  gun: { action: 'gun_service', hip: 0.3, lean: 0.85 },
  remove: { action: 'tyre_remove', hip: 0.43, lean: 0.35 },
  install: { action: 'tyre_install', hip: 0.43, lean: 0.35 },
  'front-jack': { action: 'front_jack', hip: 0.6, lean: 0.52 },
  'rear-jack': { action: 'rear_jack', hip: 0.6, lean: 0.52 },
  release: { action: 'release_service', hip: 0.84, lean: 0.08 },
} as const);
const X = new T.Vector3(1, 0, 0);

/** Six reusable samplers per renderer, not one mixer per mechanic. The service
 * phase prevents a long traffic hold from replaying, looping or signalling GO.
 * No animation event writes to the worker or substitutes for safePitRelease. */
export class PitRolePerformance {
  readonly sampler = new CrewPerformanceSampler();
  private readonly reference = new T.Quaternion();
  hipOffset = 0;
  sample(role: PitRole, phase: number, clock: number, lean: number) {
    const spec = PIT_ROLE_ACTIONS[role];
    if (
      !spec ||
      !Number.isInteger(phase) ||
      phase < 2 ||
      phase > 6 ||
      !Number.isFinite(clock) ||
      clock < 0 ||
      !Number.isFinite(lean)
    ) {
      throw new Error('Invalid authored pit-role state');
    }
    // Every key is on the recorded service clock, never renderer wall time.
    // Earlier phases cannot advance into the subsequent wheel-exchange action.
    const end = phase === 2 ? 0.8 : phase === 3 ? 2.2 : phase === 4 ? 3.5 : 5.2;
    const time = clamp(clock, 0, end);
    this.sampler.sample(spec.action as CrewAction, time);
    this.hipOffset = this.sampler.joints[0].y - spec.hip;
    this.reference.setFromAxisAngle(X, lean - spec.lean);
    this.sampler.style.torso.premultiply(this.reference).normalize();
    return this;
  }
}
