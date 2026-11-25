import { Vector4 } from 'three';
import { clamp } from '../../core/math.ts';
import { CAR_STRIDE, F, H, HEADER, O, OFFROAD_BASE, carBase } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';

/** Two leading competitors carry the spectators' attention through the venue.
 * Position and effort are sampled together from the displayed race snapshot;
 * a held shot or a backwards seek reproduces the same response. */
export class MxCrowdPass {
  readonly a = { value: new Vector4(0, 0, 0, 0) };
  readonly b = { value: new Vector4(0, 0, 0, 0) };
  /** Displayed horizontal velocities of A and B, in metres per second. */
  readonly velocity = { value: new Vector4(0, 0, 0, 0) };
  private readonly inverseReachSquared: number;
  constructor(reach: number) {
    this.inverseReachSquared = 1 / (reach * reach);
  }
  update(frame?: Float32Array) {
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
    if (first >= 0) this.sample(frame, first, this.a.value, 0);
    if (second >= 0) this.sample(frame, second, this.b.value, 2);
  }
  private sample(frame: Float32Array, offset: number, out: Vector4, slot: 0 | 2) {
    const o = offset + OFFROAD_BASE;
    const airborne = frame[o + O.AIRBORNE] > 0.5 ? clamp(frame[o + O.AIR_TIME] * 2, 0, 1) : 0;
    const response = clamp((frame[offset + F.SPEED] - 1) / 18, 0, 1) * (0.53 + 0.47 * airborne);
    out.set(frame[offset + F.X], frame[offset + F.Z], response, this.inverseReachSquared);
    const vx = frame[offset + F.VX], vz = frame[offset + F.VZ];
    const speed = Math.hypot(vx, vz);
    if (Number.isFinite(speed) && speed > 0) {
      const scale = Math.min(1, 48 / speed);
      this.velocity.value.setComponent(slot, vx * scale);
      this.velocity.value.setComponent(slot + 1, vz * scale);
    }
  }
}
