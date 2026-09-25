import { Quaternion, Vector3 } from 'three';
import { smooth } from '../core/math.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

/** One eligibility rule for actual service actors and the broadcast subject.
 * Approaching cars never acquire mechanics, and a corrupt state never caches. */
export function pitServiceActive(phase: number, clock: number, speed: number) {
  if (![phase, clock, speed].every(Number.isFinite)) throw new Error('Invalid pit crew state');
  return phase >= 2 && phase <= 5 && Math.abs(speed) <= 0.5;
}

/** Car-local envelope for all fifteen actors, carried tyres, jacks and release
 * sign throughout service. Tested against the actual skinned/instanced vertices,
 * not only character roots. Includes the car without moving or hiding anything. */
export const PIT_SERVICE_CENTER = Object.freeze(new Vector3(0.3, 0.3, 0));
export const PIT_SERVICE_HALF_EXTENTS = Object.freeze(new Vector3(4.05, 1.15, 3.85));
export const PIT_SERVICE_RADIUS = PIT_SERVICE_HALF_EXTENTS.length();

export class PitComposition {
  private readonly rotation = new Quaternion();
  private readonly offset = new Vector3();
  apply(frame: Float32Array, o: number, target: Vector3) {
    const phase = frame[o + F.PIT_PHASE],
      speed = frame[o + F.SPEED];
    pitServiceActive(phase, frame[o + F.PIT_CLOCK], speed);
    if (!frame[o + F.IN_PIT] || phase < 1 || phase > 6) return 3.1;
    // Widen before stopping, hold the entire service, then tighten as the car
    // leaves. This is a function of recorded speed, not a replay-history timer.
    const weight = 1 - smooth(0.5, 8, Math.abs(speed));
    if (weight === 0) return 3.1;
    this.rotation.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    if (!Number.isFinite(this.rotation.lengthSq()) || this.rotation.lengthSq() < 0.5)
      throw new Error('Invalid pit composition transform');
    this.rotation.normalize();
    this.offset.copy(PIT_SERVICE_CENTER).applyQuaternion(this.rotation);
    target.addScaledVector(this.offset, weight);
    return 3.1 + (PIT_SERVICE_RADIUS - 3.1) * weight;
  }
}

const TRANSFORM = [F.X, F.Y, F.Z, F.QX, F.QY, F.QZ, F.QW, F.JACK_HEIGHT] as const;
const CAPACITY = 12;
/** Exact, bounded comparison of the values consumed by crew poses. Inactive
 * cars have no pose; camera motion matters only when visibility or detail changes.
 * No hash collisions, clock-only shortcuts, new geometry or simulation writes. */
export class PitPoseCache {
  readonly levels = new Int8Array(CAPACITY).fill(-1);
  private readonly previous = new Float64Array(512);
  private readonly next = new Float64Array(512);
  private length = -1;
  private nextLength = 0;
  private pending = false;
  private readonly position = new Vector3();
  builds = 0;
  reuses = 0;
  prepare(frame: Float32Array, camera: Vector3, visible: boolean) {
    const count = frame[H.CARS];
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      count > CAPACITY ||
      frame.length < HEADER + count * CAR_STRIDE ||
      !Number.isFinite(camera.x + camera.y + camera.z)
    )
      throw new Error('Invalid pit crew frame');
    // A previous build which threw cannot reuse stale counts or transforms.
    if (this.pending) this.length = -1;
    this.pending = false;
    this.levels.fill(-1);
    let n = 0;
    for (let id = 0; id < count && visible; id++) {
      const o = carBase(id),
        phase = frame[o + F.PIT_PHASE],
        clock = frame[o + F.PIT_CLOCK],
        speed = frame[o + F.SPEED];
      if (!pitServiceActive(phase, clock, speed)) continue;
      this.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      const distance = this.position.distanceTo(camera);
      if (distance > 160) continue;
      const level = distance < 45 ? 0 : 1;
      this.levels[id] = level;
      this.next[n++] = id;
      this.next[n++] = level;
      this.next[n++] = phase;
      this.next[n++] = clock;
      for (const field of TRANSFORM) {
        const value = frame[o + field];
        if (!Number.isFinite(value)) throw new Error('Invalid pit crew transform');
        this.next[n++] = value;
      }
      const q2 =
        frame[o + F.QX] ** 2 + frame[o + F.QY] ** 2 + frame[o + F.QZ] ** 2 + frame[o + F.QW] ** 2;
      if (q2 < 0.5) throw new Error('Invalid pit crew transform');
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        const length = frame[p + W.LENGTH],
          load = frame[p + W.LOAD];
        if (!Number.isFinite(length) || length < 0 || !Number.isFinite(load))
          throw new Error('Invalid crew wheel contact');
        this.next[n++] = length;
        this.next[n++] = load;
      }
    }
    let same = n === this.length;
    for (let i = 0; same && i < n; i++) same = this.next[i] === this.previous[i];
    if (same) {
      this.reuses++;
      return false;
    }
    this.nextLength = n;
    this.pending = true;
    return true;
  }
  /** Publish cache identity only after every actor/prop pose succeeded. */
  commit() {
    if (!this.pending) throw new Error('No completed pit pose to cache');
    this.previous.set(this.next.subarray(0, this.nextLength));
    this.length = this.nextLength;
    this.pending = false;
    this.builds++;
  }
}
