import { angleDifference, clamp, mod, smooth } from '../core/math.ts';
import { trackPoint, type Track } from '../simulation/track.ts';

/** Rider's sightline relative to the chassis heading and the road under it. */
export interface GpRiderSight {
  yaw: number;
  gradeChange: number;
  weight: number;
}

/** GP chase looks down the approaching road before the rider begins to lean.
 * The pitch follows road grade rather than fork dive or a wheelie. Bounded
 * anticipation leaves the rider centered and releases if riding off-line or
 * backwards. Reusable samples keep the camera path allocation-free. */
export class MotorcycleRoadPreview {
  private readonly here = trackPoint();
  private readonly ahead = trackPoint();
  private readonly view = { yaw: 0, pitch: 0 };
  private readonly sight: GpRiderSight = { yaw: 0, gradeChange: 0, weight: 0 };

  /** Aim at a point the bike will pass, offset by its current lane. A
   * tangent at a hairpin can point away from the actual road. Looking along
   * the chord also lets the head anticipate the next turn in a chicane.
   * Stored station wraps across the finish, including when scrubbing replay. */
  rider(track: Track, from: number, to: number, alpha: number, lateral: number, speed: number, heading: number) {
    if (!(speed > 4) || !Number.isFinite(from + to + alpha + lateral + speed + heading)) return undefined;
    const lap = track.length;
    const s = from + alpha * (mod(to - from + lap / 2, lap) - lap / 2);
    track.at(s, this.here);
    const alignment = Math.cos(angleDifference(Math.atan2(this.here.tx, this.here.tz), heading));
    const weight = smooth(4, 16, speed) * smooth(.62, .90, alignment)
      * (1 - smooth(this.here.width - .8, this.here.width + 1.1, Math.abs(lateral)));
    if (weight <= 0) return undefined;
    track.at(s + clamp(12 + speed * .62, 16, 63), this.ahead);
    const dx = this.ahead.x - this.here.x + (this.ahead.nx - this.here.nx) * lateral;
    const dz = this.ahead.z - this.here.z + (this.ahead.nz - this.here.nz) * lateral;
    this.sight.yaw = clamp(angleDifference(Math.atan2(dx, dz), heading), -.53, .53);
    this.sight.gradeChange = clamp(Math.atan2(this.ahead.y - this.here.y, Math.max(1, Math.hypot(dx, dz)))
      - Math.atan(this.here.gradient), -.15, .15);
    this.sight.weight = weight;
    return this.sight;
  }


  read(
    track: Track,
    station: number,
    lateral: number,
    speed: number,
    heading: number,
    reducedMotion = false,
  ) {
    if (
      !Number.isFinite(station) ||
      !Number.isFinite(lateral) ||
      !Number.isFinite(speed) ||
      !Number.isFinite(heading)
    )
      return null;
    track.at(station, this.here);
    if (
      Math.abs(lateral) > this.here.width + 0.3 ||
      speed < 4 ||
      Math.cos(angleDifference(Math.atan2(this.here.tx, this.here.tz), heading)) < 0.65
    )
      return null;
    const reach = clamp(12 + speed * 0.3, 14, 40);
    track.at(station + reach, this.ahead);
    this.view.yaw = reducedMotion
      ? 0
      : clamp(angleDifference(Math.atan2(this.ahead.tx, this.ahead.tz), heading), -0.14, 0.14) *
        smooth(4, 16, speed);
    this.view.pitch = clamp(
      Math.atan(this.here.gradient) * 0.75 + Math.atan(this.ahead.gradient) * 0.25,
      -0.24,
      0.24,
    );
    return this.view;
  }
}

/** Rider-scale chase composition. Distances are relative to the bike's CG,
 * not the Formula car's longer body. The modest look into a bend is derived
 * from the recorded lean and speed, so seeking/holding a replay is reversible.
 * REF 013/055/074/077/089: retain the rider, useful road and apex together. */
export function motorcycleChase(speed: number, brake: number, lean: number, reducedMotion = false) {
  const v = Number.isFinite(speed) ? clamp(Math.abs(speed), 0, 110) : 0;
  const braking = Number.isFinite(brake) ? clamp(brake, 0, 1) : 0;
  const angle = Number.isFinite(lean) ? clamp(lean, -1.12, 1.12) : 0;
  return {
    height: 0.88 + (reducedMotion ? 0 : 0.08 * braking),
    heightPerMS: reducedMotion ? 0 : 0.0008,
    distance: 3.2,
    distancePerMS: reducedMotion ? 0 : 0.0025,
    lookAhead: 9.5 + Math.min(4.5, v * 0.065),
    lookLift: 0.06,
    fov: 51,
    fovGain: reducedMotion ? 0 : 4,
    // Preview ~0.22 s of the steady-turn angular rate; cap at 6.3 degrees.
    // Below walking speed there is no corner anticipation from a static lean.
    yaw: reducedMotion
      ? 0
      : clamp((9.81 * Math.tan(angle) * 0.22) / Math.max(12, v), -0.11, 0.11) * Math.min(1, v / 8),
  };
}
