import { Vector3 } from 'three';
import { clamp, smooth } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';

/** The nearest silhouette point is the rear diffuser, over two metres behind
 * the chassis origin. Leave it a margin below the axle even at maximum speed. */
export const FORMULA_CHASE = Object.freeze({
  height: 1.31,
  heightPerMS: 0.0013,
  distance: 5.64,
  distancePerMS: 0.0012,
  lookAhead: 8.9,
  lookLift: -0.64,
  fov: 50,
  fovGain: 3,
});

export class FormulaChaseSightline {
  private readonly here = trackPoint();
  private readonly ahead = trackPoint();
  /** Add a bounded sightline lead in world metres. No interpolator state is
   * carried across a replay seek, a follow change, or a stationary pit stop. */
  apply(track: Track, s: number, lateral: number, speed: number, forward: Vector3, gaze: Vector3) {
    if (speed < 7) return;
    const here = track.at(s, this.here);
    const gain =
      smooth(7, 32, speed) *
      smooth(0.68, 0.94, forward.x * here.tx + forward.z * here.tz) *
      (1 - smooth(here.width - 0.5, here.width + 2, Math.abs(lateral)));
    if (!gain) return;
    const distance = clamp(0.42 * speed, 8, 33);
    const ahead = track.at(s + distance, this.ahead);
    const turn = ahead.tx * here.tz - ahead.tz * here.tx;
    const offset = gain * clamp(turn * 2.2, -0.68, 0.68);
    gaze.x += forward.z * offset;
    gaze.z -= forward.x * offset;
    const gradeChange =
      (ahead.y - here.y + (ahead.bank - here.bank) * lateral) / distance - here.gradient;
    gaze.y += gain * clamp(gradeChange * FORMULA_CHASE.lookAhead, -0.32, 0.32);
  }
}
