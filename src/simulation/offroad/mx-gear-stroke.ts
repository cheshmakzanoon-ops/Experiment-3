import { smooth } from '../../core/math.ts';

function smoothRate(from: number, to: number, time: number) {
  const u = (time - from) / (to - from);
  return u > 0 && u < 1 ? 6 * u * (1 - u) / (to - from) : 0;
}

const selector = (t: number, direction: number) => direction > 0
  ? -.24 * (smooth(0, .045, t) - smooth(.052, .140, t))
  : .22 * (smooth(.078, .115, t) - smooth(.125, .175, t));
const selectorRate = (t: number, direction: number) => direction > 0
  ? -.24 * (smoothRate(0, .045, t) - smoothRate(.052, .140, t))
  : .22 * (smoothRate(.078, .115, t) - smoothRate(.125, .175, t));
const cover = (t: number, direction: number) => direction > 0 ? 0
  : smooth(.022, .059, t) - smooth(.203, .237, t);
const coverRate = (t: number, direction: number) => direction > 0 ? 0
  : smoothRate(.022, .059, t) - smoothRate(.203, .237, t);
const clearance = (t: number, direction: number) => direction > 0 ? 0
  : smooth(0, .030, t) - smooth(.055, .080, t)
    + smooth(.167, .194, t) - smooth(.230, .260, t);
const clearanceRate = (t: number, direction: number) => direction > 0 ? 0
  : smoothRate(0, .030, t) - smoothRate(.055, .080, t)
    + smoothRate(.167, .194, t) - smoothRate(.230, .260, t);

export const MX_GEAR_EVENT_MODULUS = 0x1000000;
export type MxGearChannel = 0 | 1 | 2;

/** The accepted command's complete initial condition. Positions and rates
 * determine each bounded tangent continuation and clearance waypoint. */
export interface MxGearStrokeSeed {
  event: number;
  direction: number;
  angle: number;
  cover: number;
  clear: number;
  angleRate: number;
  coverRate: number;
  clearRate: number;
}

function routeValue(channel: MxGearChannel, t: number, direction: number, covered: boolean, restingCover: number) {
  if (channel === 0) return selector(t, direction);
  if (!covered) return channel === 1 ? cover(t, direction) : clearance(t, direction);
  if (channel === 1) return restingCover
    + ((direction > 0 ? 0 : 1) - restingCover) * smooth(.010, .032, t)
    - (direction < 0 ? smooth(.203, .237, t) : 0);
  return direction > 0 ? 1 - smooth(.032, .045, t)
    : 1 - smooth(.055, .080, t) + smooth(.167, .194, t) - smooth(.230, .260, t);
}

function routeRate(channel: MxGearChannel, t: number, direction: number, covered: boolean, restingCover: number) {
  if (channel === 0) return selectorRate(t, direction);
  if (!covered) return channel === 1 ? coverRate(t, direction) : clearanceRate(t, direction);
  if (channel === 1) return ((direction > 0 ? 0 : 1) - restingCover) * smoothRate(.010, .032, t)
    - (direction < 0 ? smoothRate(.203, .237, t) : 0);
  return direction > 0 ? -smoothRate(.032, .045, t)
    : -smoothRate(.055, .080, t) + smoothRate(.167, .194, t) - smoothRate(.230, .260, t);
}

/** Absolute, allocation-free evaluator shared by the controller and recorded
 * presentation. Reconstruct the original bounded Bézier from its seed, rather
 * than a cubic between snapshots which can skip the boot's outward waypoint. */
export function sampleMxGearChannel(
  direction: number, time: number, channel: MxGearChannel, initial: number, initialRate: number,
  initialCover: number, initialCoverRate: number, velocity = false,
) {
  if (!direction) return 0;
  const covered = initialCover > 0;
  const coverRoom = initialCoverRate > 0 ? 1 - initialCover : initialCover;
  const coastTime = initialCoverRate === 0 ? .010 : Math.min(.010, 2 * coverRoom / Math.abs(initialCoverRate));
  const restingCover = Math.max(0, Math.min(1, initialCover + initialCoverRate * coastTime / 2));
  const maximumTime = channel === 0 ? .045 : covered ? (channel === 1 ? coastTime : .010)
    : channel === 1 ? .022 : .030;
  const minimum = channel === 0 ? -.24 : 0, maximum = channel === 0 ? .22 : 1;
  const room = initialRate > 0 ? maximum - initial : initial - minimum;
  const duration = initial === routeValue(channel, 0, direction, covered, restingCover) &&
      initialRate === routeRate(channel, 0, direction, covered, restingCover) ? 0
    : maximumTime;
  // Isolated strokes retain the original 260 ms envelopes. The maximum
  // bridge time joins their first polynomial, or a constant covered waypoint.
  if (!(duration > 0) || time >= duration) {
    const position = routeValue(channel, time, direction, covered, restingCover);
    if (!velocity) return position || 0;
    const rate = routeRate(channel, time, direction, covered, restingCover);
    // Large-clock subtraction can round a canonical peak to its exact travel
    // limit while leaving a tiny outward derivative. That impossible tangent
    // would collapse the next tangent continuation despite a nonzero pose.
    return ((position >= maximum && rate > 0) || (position <= minimum && rate < 0) ? 0 : rate) || 0;
  }
  // Keep far-target motion on the established handoff time. Only shorten
  // the incoming tangent's local continuation near a travel limit; shrinking
  // the whole bridge would send the full stroke through that tiny interval.
  const continuation = initialRate === 0 ? duration
    : Math.max(0, Math.min(duration, .99 * 3 * room / Math.abs(initialRate)));
  const ordinary = continuation === duration;
  const p1 = initial + (ordinary ? initialRate * duration / 3 : 0);
  const p3 = routeValue(channel, duration, direction, covered, restingCover);
  const p2 = p3 - routeRate(channel, duration, direction, covered, restingCover) * duration / 3;
  const t = Math.max(0, time), u = t / duration, v = 1 - u;
  let value = velocity ? 3 / duration * (
    v * v * (p1 - initial) + 2 * v * u * (p2 - p1) + u * u * (p3 - p2)
  ) : v ** 3 * initial + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u ** 3 * p3;
  if (!ordinary && t < continuation) {
    // This compact cubic starts with the measured velocity and reaches
    // zero position/rate at continuation. On that subinterval it adds only
    // initialRate*continuation/3 to the base curve's first Bezier control,
    // within 99% of its available travel. All other controls stay bounded.
    // Its rate lies between -initialRate/3 and initialRate, independent of
    // how short the continuation becomes. Float32 room rounding therefore
    // changes only a small local correction, not the far-target timing.
    const remaining = 1 - t / continuation;
    value += velocity ? initialRate * remaining * (1 - 3 * t / continuation)
      : initialRate * t * remaining * remaining;
  }
  return value || 0;
}

/** The return spring recentres the steel selector after every shift. The
 * left boot normally rides below the sleeve. For a downshift it clears the
 * outside end, covers the sleeve, presses it, then returns below the tip.
 * All values are sampled on the fixed simulation clock. */
export class MxGearStroke {
  angle = 0;
  cover = 0;
  clear = 0;
  angleRate = 0;
  coverRate = 0;
  clearRate = 0;
  private start = -Infinity;
  readonly seed: MxGearStrokeSeed = {
    event: 0, direction: 0, angle: 0, cover: 0, clear: 0, angleRate: 0, coverRate: 0, clearRate: 0,
  };

  reset() {
    this.start = -Infinity;
    this.angle = this.cover = this.clear = 0;
    this.angleRate = this.coverRate = this.clearRate = 0;
    const seed = this.seed;
    seed.event = (seed.event + 1) % MX_GEAR_EVENT_MODULUS;
    seed.direction = seed.angle = seed.cover = seed.clear = 0;
    seed.angleRate = seed.coverRate = seed.clearRate = 0;
  }

  engage(direction: number, clock: number) {
    if (!Number.isFinite(clock)) return;
    if (!direction || !Number.isFinite(direction)) {
      this.reset();
      return;
    }
    this.sample(clock);
    this.start = clock;
    const seed = this.seed;
    seed.event = (seed.event + 1) % MX_GEAR_EVENT_MODULUS;
    seed.direction = Math.sign(direction);
    seed.angle = this.angle;
    seed.cover = this.cover;
    seed.clear = this.clear;
    seed.angleRate = this.angleRate;
    seed.coverRate = this.coverRate;
    seed.clearRate = this.clearRate;
  }

  ageAt(clock: number) {
    return this.seed.direction ? Math.max(0, clock - this.start) : 0;
  }

  sample(clock: number) {
    if (!Number.isFinite(clock)) return this;
    const seed = this.seed;
    if (!seed.direction) {
      this.angle = this.cover = this.clear = 0;
      this.angleRate = this.coverRate = this.clearRate = 0;
      return this;
    }
    const time = this.ageAt(clock), { direction, cover, coverRate } = seed;
    this.angle = sampleMxGearChannel(direction, time, 0, seed.angle, seed.angleRate, cover, coverRate);
    this.cover = sampleMxGearChannel(direction, time, 1, cover, coverRate, cover, coverRate);
    this.clear = sampleMxGearChannel(direction, time, 2, seed.clear, seed.clearRate, cover, coverRate);
    this.angleRate = sampleMxGearChannel(direction, time, 0, seed.angle, seed.angleRate, cover, coverRate, true);
    this.coverRate = sampleMxGearChannel(direction, time, 1, cover, coverRate, cover, coverRate, true);
    this.clearRate = sampleMxGearChannel(direction, time, 2, seed.clear, seed.clearRate, cover, coverRate, true);
    return this;
  }
}
