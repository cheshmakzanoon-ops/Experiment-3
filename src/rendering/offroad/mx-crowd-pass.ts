import { Vector4 } from 'three';
import { clamp, smooth } from '../../core/math.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { CAR_STRIDE, F, H, HEADER, O, OFFROAD_BASE, carBase } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import { Track, trackPoint } from '../../simulation/track.ts';

/** Two leading competitors carry the spectators' attention through the venue.
 * Position and effort are sampled together from the displayed race snapshot;
 * a held shot or a backwards seek reproduces the same response. */
export class MxCrowdPass {
  readonly a = { value: new Vector4(0, 0, 0, 0) };
  readonly b = { value: new Vector4(0, 0, 0, 0) };
  /** Displayed horizontal velocities of A and B, in metres per second. */
  readonly velocity = { value: new Vector4(0, 0, 0, 0) };
  private readonly point = trackPoint();
  private readonly inverseReachSquared: number;
  constructor(reach: number) {
    this.inverseReachSquared = 1 / (reach * reach);
  }
  update(frame?: Float32Array, track?: Track) {
    this.a.value.set(0, 0, 0, 0);
    this.b.value.set(0, 0, 0, 0);
    this.velocity.value.set(0, 0, 0, 0);
    // A chequered frame can still show the same bikes rolling past the
    // stand. Their measured speed lets the gesture finish on the run-out.
    if (!frame || (frame[H.PHASE] !== PHASE.RACING && frame[H.PHASE] !== PHASE.FINISHED)) return;
    const count = Math.min(
      Math.floor(frame[H.CARS]),
      Math.floor((frame.length - HEADER) / CAR_STRIDE),
    );
    let first = -1,
      second = -1,
      best = Infinity,
      next = Infinity;
    for (let i = 0; i < count; i++) {
      const offset = carBase(i);
      if (
        !Number.isFinite(frame[offset + F.X]) ||
        !Number.isFinite(frame[offset + F.Z]) ||
        !Number.isFinite(frame[offset + F.SPEED])
      )
        continue;
      const rank = frame[offset + F.RANK] > 0 ? frame[offset + F.RANK] : count + i + 1;
      if (rank < best) {
        second = first;
        next = best;
        first = offset;
        best = rank;
      } else if (rank < next) {
        second = offset;
        next = rank;
      }
    }
    if (first >= 0) this.sample(frame, first, this.a.value, 0, track);
    if (second >= 0) this.sample(frame, second, this.b.value, 2, track);
  }
  private sample(frame: Float32Array, offset: number, out: Vector4, slot: 0 | 2, track?: Track) {
    const o = offset + OFFROAD_BASE;
    const x = frame[offset + F.X], y = frame[offset + F.Y], z = frame[offset + F.Z];
    // Spectators can already follow a bike before it reaches race speed.
    // Saturating the response avoids making a touchdown speed impulse jolt
    // the head a second time after the bike has settled into view.
    const effort = smooth(0.75, 10, frame[offset + F.SPEED]);
    let jump = 0;
    if (effort > 0 && frame[o + O.AIRBORNE] > 0.5) {
      jump = clamp(frame[o + O.AIR_TIME] * 2, 0, 1);
      const surface = track && Track.offroadOf(track);
      if (track && surface instanceof TrackTerrainSurface && Number.isFinite(y)) {
        // A seated spectator sees the bike settle toward the landing long
        // before the first loaded tyre flips the binary contact marker.
        // Use the displayed world position; lap station is a discrete field.
        const lateral = track.nearest(x, z, this.point);
        const aboveSoil = y - surface.terrain.baseHeight(this.point.s, lateral);
        // A sprung MX chassis rides roughly a metre above the soil on contact.
        jump *= smooth(1.15, 2.2, aboveSoil);
      }
    }
    out.set(x, z, effort * (0.53 + 0.47 * jump), this.inverseReachSquared);
    const vx = frame[offset + F.VX], vz = frame[offset + F.VZ];
    const speed = Math.hypot(vx, vz);
    if (Number.isFinite(speed) && speed > 0) {
      const scale = Math.min(1, 48 / speed);
      this.velocity.value.setComponent(slot, vx * scale);
      this.velocity.value.setComponent(slot + 1, vz * scale);
    }
  }
}
