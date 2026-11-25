import { angleDifference, clamp, lerp, mod, smooth } from '../../core/math.ts';
import { relief, type OffroadCourse } from '../../simulation/offroad/course.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { GpRiderSight } from '../motorcycle-camera.ts';

/** Extra cues available when the race has a surveyed dirt course. */
export interface MotocrossSightSample extends GpRiderSight {
  /** Normalized crouch of the legs and shoulders on the takeoff face. */
  hipPreload?: number;
  shoulderPreload?: number;
  /** Sprung chassis height above its standing ground clearance (metres). */
  clearance?: number;
}

/** Seconds before the lip. A rider gathers over their pegs, then releases the
 * load as the wheels crest. Both ends have zero velocity. */
function takeoffPreload(seconds: number) {
  return smooth(-0.04, 0.20, seconds) * (1 - smooth(0.20, 0.52, seconds));
}

/** A rider looks through a berm or onto the far face of a jump. Work in
 * measured track coordinates so a whip, a crest or a lap wrap doesn't aim
 * the rider at the handlebars. The returned object is reused for each pose. */
export class MotocrossRiderSight {
  private readonly here = trackPoint();
  private readonly target = trackPoint();
  private readonly terrain = relief();
  private readonly sight: MotocrossSightSample = { yaw: 0, gradeChange: 0, weight: 0 };

  constructor(
    private readonly track: Track,
    private readonly course: OffroadCourse,
  ) {}

  sample(
    from: number,
    to: number,
    alpha: number,
    lateral: number,
    speed: number,
    heading: number,
    chassisY: number,
    cgHeight: number,
  ) {
    if (
      !(speed > 2) ||
      !Number.isFinite(from + to + alpha + lateral + speed + heading + chassisY + cgHeight)
    )
      return undefined;
    const lap = this.track.length;
    const s = mod(from + alpha * (mod(to - from + lap / 2, lap) - lap / 2), lap);
    const p = this.track.at(s, this.here);
    const alignment = Math.cos(angleDifference(Math.atan2(p.tx, p.tz), heading));
    const weight =
      smooth(2, 10, speed) *
      smooth(0.48, 0.91, alignment) *
      (1 - smooth(p.width - 0.3, p.width + 1.3, Math.abs(lateral)));
    if (weight <= 0) return undefined;

    // Acquire the landing progressively before the ramp and release it
    // before the front wheel reaches the landing centre.
    const reach = clamp(speed * 0.7 + 3, 7, this.course.kind === 'supercross' ? 17 : 26);
    let distance = reach, foundLanding = false;
    let hipPreload = 0, shoulderPreload = 0;
    const stationSpeed = speed * alignment;
    for (const jump of this.course.jumps) {
      const toLip = mod(jump.takeoff - s + lap / 2, lap) - lap / 2;
      const seconds = toLip / stationSpeed;
      if (seconds > -0.11 && seconds < 0.52) {
        hipPreload = Math.max(hipPreload, takeoffPreload(seconds));
        // The chest continues to fold briefly after the legs begin to drive.
        shoulderPreload = Math.max(shoulderPreload, takeoffPreload(seconds + 0.065));
      }
      const toLanding = toLip + jump.landing - jump.takeoff;
      if (foundLanding || toLip >= reach + 8 || toLanding <= 2) continue;
      const fixation = (1 - smooth(reach - 2, reach + 8, toLip)) * smooth(2, 10, toLanding);
      distance = lerp(reach, clamp(toLanding, 4, 42), fixation);
      foundLanding = true;
    }
    const q = this.track.at(s + distance, this.target);
    const targetLane = clamp(lateral, -q.width + 0.5, q.width - 0.5);
    const dx = q.x + q.nx * targetLane - p.x - p.nx * lateral;
    const dz = q.z + q.nz * targetLane - p.z - p.nz * lateral;
    const ground = this.course.groundAt(s, lateral, p, this.terrain);
    const landing = this.course.groundAt(s + distance, targetLane, q, this.terrain);
    const heave = Math.max(0, chassisY - cgHeight - ground);
    this.sight.yaw = clamp(angleDifference(Math.atan2(dx, dz), heading), -0.62, 0.62);
    this.sight.gradeChange = clamp(
      Math.atan2(landing - ground - heave, Math.max(1, Math.hypot(dx, dz))),
      -0.26,
      0.23,
    );
    this.sight.weight = weight;
    this.sight.hipPreload = hipPreload;
    this.sight.shoulderPreload = shoulderPreload;
    this.sight.clearance = heave;
    return this.sight;
  }
}
