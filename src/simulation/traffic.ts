import { approach, clamp, G, lerp, mod, Random, Vec3 } from '../core/math.ts';
import type { Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';

export interface DriverPersonality {
  aggression: number;
  consistency: number;
  wetSkill: number;
  overtakingSkill: number;
  tireManagement: number;
  defensiveBias: number;
  errorRate: number;
}
export function personality(seed: number, id: number): DriverPersonality {
  const rng = new Random((seed ^ Math.imul(id + 1, 0x9e3779b9)) >>> 0);
  return {
    aggression: 0.3 + rng.next() * 0.5,
    consistency: 0.92 + rng.next() * 0.07,
    wetSkill: 0.7 + rng.next() * 0.25,
    overtakingSkill: 0.7 + rng.next() * 0.25,
    tireManagement: 0.65 + rng.next() * 0.3,
    defensiveBias: rng.next(),
    errorRate: 0.002 + rng.next() * 0.005,
  };
}
/** A car ahead that has stayed below `speed` (m/s along the track) for
 * `seconds` without gaining `gain` (stalled on the grid, spun, recovering,
 * crawling) will not clear the lane by itself: following it would mean
 * waiting behind it for ever. A car launching from rest gains speed within a
 * few hundredths of a second, so a field leaving the grid is never mistaken
 * for a stalled one. From `holdAfter` cars behind it keep `holdGap` back
 * (bumper to bumper), room to steer out at low speed; once it is stalled they
 * wait there until a lane past it is free of traffic, then take that lane:
 * at `creep` while their nose still overlaps it and only while a full-lock
 * arc from where they are still clears its corner, stopping `contactGap`
 * short of it at the latest. A lane past it leaves `sideMargin` beyond both
 * bodies (its heading included: a spun car is wide). A lane that ends behind
 * it costs `blockedCost`, more than any lane change. */
export const STALLED = Object.freeze({
  speed: 3,
  seconds: 0.5,
  holdAfter: 0.2,
  gain: 0.3,
  holdGap: 4,
  creep: 2,
  contactGap: 0.8,
  sideMargin: 0.8,
  blockedCost: 30,
});
/** What a rider that opts in to pace-aware passing tells the planner about itself. */
export interface PassPace {
  /** Top speed (m/s) of its class: it is only quicker than a rider of a slower one. */
  topSpeed: number;
  /** Speed (m/s) it would hold if nobody were ahead. */
  freeSpeed: number;
  /** Distance (m) of road ahead on which it can keep accelerating (the straight, up to
   * where its own plan starts to brake). */
  runway: number;
  /** Lateral speed (m/s) of its lane changes. */
  laneRate: number;
}
/** Pace-aware passing, opt-in per rider (`evaluate`'s `pace`; the bike AI's GP
 * riders). Following a car at the follow reserve is the right plan for a rider that
 * is no quicker than the car ahead and a poor one for a rider that is: held to the
 * leader's speed it never closes, so every attempt ends in `NOT CLOSING` or
 * `GAP OPENED` and no pass is ever completed (0 in 12 seeded mixed GP/superbike
 * races: the GP is held up for the whole race although it is 2.5 % quicker alone).
 * A GP gains its time on the straights (it is 10 m/s faster at the end of one) and
 * is level in the corners, so a pass is made on a straight or not at all.
 *
 * Only a class whose top speed beats that of the car by `classMargin` m/s is affected
 * (a GP prototype over a superbike, 12 m/s; not over the other prototype, 3; a field
 * of one class is untouched), and a blocker is a car slower than the rider's free
 * speed by `margin`. Towards such a car the rider
 *  - closes by the relative-motion rule: it may approach at the speed it can shed
 *    over the gap at `settleDecel`, down to `settleReserve` m + a quarter-second,
 *    instead of the follow reserve, which treats the car as an obstacle to stop
 *    short of and so lets the gap close only a few m/s at a time (and brakes hard
 *    when it was closing faster: leaning at 250 km/h, that braking threw riders
 *    down). The rule holds on a straight (`settleRunway` m of it left) and for
 *    `settle` s after a pass; into a corner the follow reserve is back, because
 *    a GP that tails a superbike through a braking zone has no more brake than it
 *    has, and went wide at hairpins with the car it was following (qa-bikes-3);
 *  - is held at that distance from the lane the car will be in when it gets there,
 *    not where it is now (`meets`: the lines cross in a chicane), with the car kept
 *    to the lane limit, not off the road where the line leaves it;
 *  - gets a "blocker" when it is closing on the car (`closeMin` m/s), its runway is
 *    at least `startRunway` m and long enough to gain `gap + finish` metres on it (it
 *    closes at `gain` of the speed difference on average over an acceleration
 *    zone). Of 484 attempts started on corner exits by the runway alone, 4 were
 *    completed and 302 ended at the end of the straight, 20 % of those at 250 km/h
 *    in a rear slide. Until fewer than `brakeBy` metres of runway are left it
 *      - considers the lanes either side of the blocker itself (the fixed lane steps
 *        from its own position can land on the car) and takes the cheapest safe one
 *        that clears it, `edge` m short of the edge limit, rather than the cheapest
 *        overall; the side it began on keeps the lane unless the other is `side`
 *        cheaper (that side can run out of track);
 *      - weighs a lane that ends behind the blocker `1 + urgency` times as heavily
 *        over `look` m rather than 70, so it pulls out as the straight begins;
 *      - closes on the blocker as fast as the remaining lateral move allows (it
 *        must still have `closeGap` m `lanePad` s after its lane clears the car);
 *      - is judged `NOT CLOSING` only after `stall` s free of the car's corridor
 *        without gaining a metre, may try again `retry` s after an abort, has
 *        `timeout` s, and a gap only counts as opened beyond `look + gapMargin`.
 *    A pass that runs out of runway (`STRAIGHT ENDED`) leaves the rider close behind
 *    the car, so it keeps to the line through the corner: no new attempt for
 *    `corner` s, a lane off the line costs `cornerCost`, and the distance it keeps
 *    opens from `closeGap` to the full `settleReserve` over `ease` s, not at once.
 * The swept lane test and every abort that is about safety are unchanged. */
export const PASS_PACE = Object.freeze({
  margin: 3,
  classMargin: 6,
  settle: 6,
  settleDecel: 3,
  settleReserve: 10,
  gain: 0.4,
  finish: 12,
  brakeBy: 220,
  look: 110,
  edge: 1.5,
  urgency: 2,
  side: 6,
  lanePad: 0.5,
  closeGap: 9,
  gapMargin: 10,
  stall: 4,
  timeout: 20,
  retry: 0.8,
  corner: 8,
  cornerCost: 20,
  /** How far ahead (m) a slower class counts for the rider's braking (`slower`). */
  slowerReach: 250,
  /** `meets`: the longitudinal overlap (m) that counts, and the least gap (m) at which
   * it is asked: alongside, the swept lane test has the say. */
  meetReach: 8,
  meetGap: 12,
  /** Closing speed (m/s) and straight (m) a new attempt needs; straight (m) below which
   * the follow reserve is back; seconds over which the distance opens after a pass. */
  closeMin: 1.5,
  startRunway: 600,
  settleRunway: 400,
  ease: 3,
});
export interface TrafficPlan {
  offset: number;
  speedLimit: number;
  decision: string;
}

/** Swept track-coordinate footprints over a four-second horizon. Lane changes
 * are evaluated at their achievable slew rate, never as instantaneous offsets.
 * Acceleration uncertainty inflates longitudinal separation requirements. */
export class TrafficPlanner {
  readonly result: TrafficPlan = { offset: 0, speedLimit: 110, decision: 'RACING LINE' };
  /** Committed lane, as a distance from the racing line (which moves with s). */
  private heldOffset = 0;
  private holdUntil = 0;
  private preferred = 0;
  private candidates = new Float64Array(10);
  private laneSafe = new Uint8Array(10);
  private laneScore = new Float64Array(10);
  /** Last time each car (by id) was seen moving along the track (STALLED). */
  private movingAt = new Float64Array(0);
  /** Speed along the track when that clock last restarted. */
  private movedAlong = new Float64Array(0);
  /** Per car id this evaluation: ahead and slow (1, STALLED.holdAfter) or
   * stalled (2, STALLED.seconds), with its footprint across and along. */
  private stalled = new Uint8Array(0);
  private across = new Float64Array(0);
  private along = new Float64Array(0);
  private axis = new Vec3();
  private cosine = 1;
  /** The stalled car being passed (its id) this evaluation, or -1. */
  bypass = -1;
  /** The stalled car this car is held behind, waiting for a free lane, or -1. */
  waiting = -1;
  /** Explicit passing commitment (masterplan §13.4, WP20): the car being
   * passed, when the attempt began and since when it stopped closing. */
  passTarget = -1;
  private passSince = 0;
  private notClosingSince = -1;
  /** Pace-aware passing (PASS_PACE) is on for this rider; the lateral scale of the
   * evaluation in progress; the slower car it is getting past (id, or -1) and the
   * side of it the pass is made on (-1, +1, or 0 until chosen). */
  private paced = false;
  private classTop = 0;
  private runway = 0;
  /** The deceleration (m/s2) the rider needs to stay clear of the worst car ahead of it:
   * the one that sheds its closing speed 6 m behind that car, plus the car's own braking. */
  needDecel = 0;
  private scale = 1;
  blocker = -1;
  /** A car of a class PASS_PACE.classMargin slower is within `slowerReach` m ahead. */
  slower = false;
  private passSide = 0;
  /** Until when the rider's closing speed on cars ahead is shed by the relative-motion
   * rule instead of the follow reserve (a pass is on, or ended a moment ago). */
  private settleUntil = 0;
  /** When the last pace-aware pass ended (the follow distance opens up from there). */
  private easeFrom = -Infinity;
  /** The pass in hand is a pace-aware one (its target was the blocker). */
  private passPaced = false;
  /** Since when the pass lane has been clear of the target, and the gap then. */
  private clearSince = -1;
  private clearGap = 0;
  /** After an abort, lanes off the line cost more until this time (hysteresis). */
  private retryAfter = 0;
  /** What a lane off the line costs while `retryAfter` runs. */
  private retryCost = 4;
  /** Which rule set the speed limit of the last evaluation ('' if none did). */
  limitedBy = '';
  passes = 0;
  aborts = 0;
  lastAbort = '';
  evaluate(
    car: Vehicle,
    cars: readonly Vehicle[],
    track: Track,
    now: number,
    braking: number,
    traits: DriverPersonality,
    yellow: boolean,
    preferredOffset = 0,
    approachingPit = false,
    /** Racing line offset at distance s (the centreline when not given). The
     * car follows it, so a lane is a distance from the line, and a path's
     * lateral position ahead includes the line's own shift. */
    line: (s: number) => number = () => 0,
    /** Lateral separation scale for narrow machines (1: car widths). */
    lateralScale = 1,
    /** Extra lane-target room for finite tracking response; never reduces
     * collision corridors, braking distance or the swept safety tests. */
    trackingMargin = 0,
    /** Opt in to PASS_PACE. */
    pace: PassPace | null = null,
  ) {
    this.paced = pace !== null;
    this.classTop = pace?.topSpeed ?? 0;
    this.runway = pace?.runway ?? 0;
    this.needDecel = 0;
    this.scale = lateralScale;
    const lineOffset = line(car.s);
    // Lateral shift of a line-relative path between here and distance `s`.
    // The pit approach is an absolute corridor and does not follow the line.
    const shiftAt = (s: number) => (approachingPit ? 0 : line(s) - lineOffset);
    // Pit-lane centre used by queued/released cars (venue data, signed side).
    const pitLaneAt = (s: number) =>
      track.pitOffset(s) * ((track.pit.offset - 1.5) / track.pit.offset);
    // A new tactical purpose (pit entry or an early defensive choice) may
    // release the previous lane commitment; the swept safety tests still apply.
    if (Math.abs(preferredOffset - this.preferred) > 0.5) this.holdUntil = 0;
    this.preferred = preferredOffset;
    const result = this.result;
    const limit = Math.max(1, car.trackPosition.width - 2.4 * lateralScale);
    const closest = clamp(car.lateral, -limit, limit);
    const held = lineOffset + this.heldOffset;
    this.candidates[0] = clamp(now < this.holdUntil ? held : lineOffset, -limit, limit);
    this.candidates[1] = closest;
    const laneStep = 3.5 * lateralScale + Math.max(0, trackingMargin);
    this.candidates[2] = clamp(closest - laneStep, -limit, limit);
    this.candidates[3] = clamp(closest + laneStep, -limit, limit);
    this.candidates[4] = clamp(lineOffset, -limit, limit);
    this.candidates[5] = clamp(preferredOffset, -limit, limit);
    // Stalled cars ahead (STALLED), each with its footprint across and along
    // the track, and our own nose: its lateral position and reach ahead.
    const brake = Math.max(1, braking * 0.72);
    const [width, , length] = car.definition.halfExtents;
    const ourSin = this.heading(car),
      ourCos = this.cosine;
    // The leading end (the tail, should the car face backwards).
    const nose = car.lateral + length * ourSin * (ourCos < 0 ? -1 : 1),
      noseHalf = width * Math.abs(ourCos),
      front = length * Math.abs(ourCos) + width * Math.abs(ourSin);
    const passing = (other: Vehicle) =>
      Math.max(2.75 * lateralScale, this.across[other.id] + width + STALLED.sideMargin);
    let count = 6,
      nearest = Infinity;
    this.bypass = -1;
    this.waiting = -1;
    for (const other of cars) {
      const id = other.id;
      if (id >= this.movingAt.length) this.grow(id + 1);
      const p = other.trackPosition;
      const along = other.body.velocity.x * p.tx + other.body.velocity.z * p.tz;
      if (
        Number.isNaN(this.movingAt[id]) ||
        other.inPit ||
        along >= STALLED.speed ||
        along > this.movedAlong[id] + STALLED.gain
      ) {
        this.movingAt[id] = now;
        this.movedAlong[id] = along;
      }
      const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
      const slow = now - this.movingAt[id];
      this.stalled[id] =
        other === car || other.inPit || gap <= 0 || slow < STALLED.holdAfter
          ? 0
          : slow < STALLED.seconds
            ? 1
            : 2;
      if (!this.stalled[id]) continue;
      const [w, , l] = other.definition.halfExtents,
        sin = Math.abs(this.heading(other)),
        cos = Math.abs(this.cosine);
      this.across[id] = w * cos + l * sin;
      this.along[id] = l * cos + w * sin;
      // Lanes just clear of the nearest one in our path, on either side.
      if (this.stalled[id] === 2 && gap < nearest && gap < 180) {
        const side = passing(other),
          at = other.lateral - shiftAt(other.s);
        if (Math.abs(at - closest) < side) {
          nearest = gap;
          count = 8;
          this.candidates[6] = clamp(at - side, -limit, limit);
          this.candidates[7] = clamp(at + side, -limit, limit);
        }
      }
    }
    // The slower car a pace-aware rider is getting past (PASS_PACE). It stays the
    // blocker until it is behind, not just while it is in the rider's corridor, so
    // a rider that has pulled out keeps going.
    let blocker: Vehicle | null = null;
    if (pace && car.speed > 15) {
      let near: number = PASS_PACE.look;
      const mean = Math.max(30, (car.speed + pace.freeSpeed) / 2);
      for (const other of cars) {
        if (
          other === car ||
          other.inPit ||
          other.retired ||
          other.finishTime ||
          this.stalled[other.id] ||
          other.speed <= 15 ||
          other.speed >= pace.freeSpeed - PASS_PACE.margin ||
          other.definition.ai.topSpeed > pace.topSpeed - PASS_PACE.classMargin
        )
          continue;
        const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
        const inWay =
          (other.id === this.blocker && gap > -6.5) ||
          (gap > 0 &&
            Math.abs(other.lateral - (car.lateral + shiftAt(other.s))) < 3 * lateralScale);
        // Worth starting when the straight left is long enough to gain the gap
        // and a little more; once under way it goes on until the straight ends.
        const gains = (PASS_PACE.gain * (pace.freeSpeed - other.speed) * pace.runway) / mean,
          worth =
            other.id === this.blocker
              ? pace.runway >= PASS_PACE.brakeBy
              : gains >= gap + PASS_PACE.finish &&
                pace.runway >= PASS_PACE.startRunway &&
                car.speed - other.speed >= PASS_PACE.closeMin;
        if (gap < near && inWay && worth) {
          near = gap;
          blocker = other;
        }
      }
    }
    this.slower = false;
    if (pace)
      for (const other of cars) {
        if (other === car || other.inPit || other.retired || other.finishTime) continue;
        const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
        if (
          gap > 0 &&
          gap < PASS_PACE.slowerReach &&
          other.definition.ai.topSpeed <= pace.topSpeed - PASS_PACE.classMargin
        ) {
          this.slower = true;
          break;
        }
      }
    if ((blocker ? blocker.id : -1) !== this.blocker) {
      this.passSide = 0;
    }
    this.blocker = blocker ? blocker.id : -1;
    // While a pass is on and for a while after it, the rider is carrying closing speed.
    if (blocker) this.settleUntil = now + PASS_PACE.settle;
    // Only a pass on a straight is a quick lane change; the rest is as before.
    const laneRate = blocker && pace ? pace.laneRate : 1.6;
    if (blocker) {
      // Lanes either side of the blocker itself: the fixed lane steps from the
      // rider's own position can land on the car it is trying to get past.
      const side =
          Math.max(2.75 * lateralScale, blocker.definition.halfExtents[0] + width + 0.5) + 0.35,
        at = blocker.lateral - shiftAt(blocker.s);
      // Fast and well off the line, a rider needs room beyond the lane for its
      // tracking error: the lane stays PASS_PACE.edge short of the edge limit.
      const reach = Math.max(1, limit - PASS_PACE.edge);
      this.candidates[count++] = clamp(at - side, -reach, reach);
      this.candidates[count++] = clamp(at + side, -reach, reach);
    }
    let best = Infinity,
      bestOffset = this.candidates[0],
      found = false;
    for (let k = 0; k < count; k++) {
      const candidate = this.candidates[k];
      // A service approach is a merge, not a new passing attempt. When its
      // destination corridor is occupied, hold and yield longitudinally rather
      // than taking an apparently clear overtaking lane away from the entry.
      if (
        approachingPit &&
        Math.abs(candidate - preferredOffset) > Math.abs(closest - preferredOffset) + 0.1
      )
        continue;
      // Queueing behind cars that are themselves slowing for the entry is the
      // purpose of that corridor, so slower traffic ahead in it is not a reason
      // to stay out. The swept separation test below still decides safety.
      const queueing = approachingPit && Math.abs(candidate - preferredOffset) < 1.4;
      // Under yellow, safe changes around stationary hazards remain legal.
      // The speed planner below prevents gaining on moving competitors.
      let score =
        Math.abs(candidate - preferredOffset) * 1.0 +
        Math.abs(candidate - closest) * (0.2 + (1 - traits.overtakingSkill) * 0.45);
      if (now < this.holdUntil && Math.abs(candidate - held) > 0.6) score += 6;
      if (now < this.retryAfter && Math.abs(candidate - lineOffset) > 1) score += this.retryCost;
      let safe = true;
      for (const other of cars) {
        if (
          other === car ||
          (other.inPit !== car.inPit &&
            !(
              Math.abs(other.lateral) < other.trackPosition.width + 2.8 ||
              (other.pitPhase === 6 && other.s > 250)
            ))
        )
          continue;
        const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
        if (Math.abs(gap) > 180) continue;
        const closing = other.speed - car.speed;
        // Other cars on track follow the line too: predict them along it, and
        // extrapolate only the part of their lateral velocity that is a lane
        // change (not the line's own drift across the track).
        const theirLine = other.inPit ? 0 : line(other.s);
        const lineDrift = other.inPit
          ? 0
          : ((line(other.s + 1) - line(other.s - 1)) / 2) * other.speed;
        const lateralVelocity = clamp(
          other.body.velocity.x * other.trackPosition.nx +
            other.body.velocity.z * other.trackPosition.nz -
            lineDrift,
          -2,
          2,
        );
        if (this.stalled[other.id] === 2) {
          // A stationary obstacle is passed in a lane clear of its body, now
          // and as it drifts; any other lane ends behind it. That is no
          // collision course while we can still stop short of it (the speed
          // plan below holds us there), only a lane going nowhere.
          const at = candidate + shiftAt(other.s);
          const clearance = Math.min(
            Math.abs(at - other.lateral),
            Math.abs(at - other.lateral - lateralVelocity * 1.2),
          );
          if (clearance >= passing(other)) continue;
          const room = gap - front - this.along[other.id] - STALLED.contactGap;
          if (room < (car.speed * car.speed) / (2 * brake)) {
            safe = false;
            break;
          }
          score += STALLED.blockedCost;
          continue;
        }
        for (let t = 0.2; t <= 4; t += 0.4) {
          const dx = gap + closing * t;
          const ours = approach(closest, candidate, laneRate * t) + shiftAt(car.s + car.speed * t);
          const theirs = other.inPit
            ? other.pitPhase === 6
              ? pitLaneAt(other.s + other.speed * t)
              : track.pit.side * Math.max(6, track.pit.side * pitLaneAt(other.s + other.speed * t))
            : this.onTrack(
                other,
                other.lateral +
                  line(other.s + other.speed * t) -
                  theirLine +
                  lateralVelocity * Math.min(t, 1.2),
                limit,
              );
          const dy = Math.abs(theirs - ours);
          if (Math.abs(dx) < 6.5 + Math.min(4, t * 0.5) && dy < 2.75 * lateralScale) {
            safe = false;
            break;
          }
          // A lane that ends behind the car being passed is not a place to wait for
          // a rider quicker than it, and one to leave from further back (PASS_PACE).
          const horizon = other.id === this.blocker ? PASS_PACE.look : 70;
          if (!queueing && dx > 0 && dx < horizon && dy < 2.9 * lateralScale)
            score +=
              ((horizon - dx) / horizon) *
              (1 + traits.aggression) *
              (other.id === this.blocker ? 1 + PASS_PACE.urgency : 1);
        }
        if (!safe) break;
      }
      this.laneSafe[k] = safe ? 1 : 0;
      this.laneScore[k] = score;
      if (safe && score < best) {
        best = score;
        bestOffset = candidate;
        found = true;
      }
    }
    // Pulling out is not a matter of a few points of lane cost for a rider that is
    // quicker than the car in its way: of the safe lanes that clear it, take the
    // cheapest; only when none does is the overall best kept (PASS_PACE).
    if (blocker) {
      const at = blocker.lateral - shiftAt(blocker.s),
        need = 2.75 * lateralScale + 0.1;
      let pick = -1,
        pickScore = Infinity;
      for (let k = 0; k < count; k++) {
        if (!this.laneSafe[k] || Math.abs(this.candidates[k] - at) < need) continue;
        const cost =
          this.laneScore[k] +
          (this.passSide !== 0 && Math.sign(this.candidates[k] - at) !== this.passSide
            ? PASS_PACE.side
            : 0);
        if (cost < pickScore) {
          pick = k;
          pickScore = cost;
        }
      }
      if (pick >= 0) {
        bestOffset = this.candidates[pick];
        found = true;
        this.passSide = Math.sign(bestOffset - at);
      }
    }
    // When no lane is safe, hold the currently occupied corridor and brake.
    // Emergency avoidance must not weave across a second car to dodge the first.
    result.offset = found ? bestOffset : closest;
    result.speedLimit = 110;
    this.limitedBy = '';
    // Lowers the speed limit and records which rule it was (diagnostics).
    const cap = (limit: number, rule: string) => {
      if (limit < result.speedLimit) {
        result.speedLimit = limit;
        this.limitedBy = rule;
      }
    };
    result.decision = !found
      ? 'ABORT / FOLLOW'
      : Math.abs(bestOffset - lineOffset) > 1
        ? 'PASS / HOLD LANE'
        : 'RACING LINE';
    if (found && Math.abs(bestOffset - held) > 0.6) {
      this.heldOffset = bestOffset - lineOffset;
      this.holdUntil = now + 3;
    }
    this.trackPass(car, cars, track, now, found, lineOffset, traits);
    for (const other of cars) {
      if (
        other === car ||
        (other.inPit !== car.inPit &&
          !(
            Math.abs(other.lateral) < other.trackPosition.width + 2.8 ||
            (other.pitPhase === 6 && other.s > 250)
          ))
      )
        continue;
      const gap = mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
      if (gap <= 0 || gap > 180) continue;
      if (yellow && !other.retired && other.speed > 5 && gap < 55)
        cap(Math.max(5, other.speed - 1), 'yellow');
      // Our path reaches the other car's distance shifted with the line.
      const shift = shiftAt(other.s);
      if (this.stalled[other.id] === 2) {
        // Held back only while our nose overlaps it or our lane ends behind
        // it: alongside in a clear lane is passing it, not following it.
        const overlap =
          Math.abs(other.lateral - (nose + shift)) < this.across[other.id] + noseHalf + 0.3;
        const clear = Math.abs(other.lateral - (result.offset + shift)) >= passing(other);
        if (!overlap && clear) continue;
        const room = gap - front - this.along[other.id] - STALLED.contactGap;
        const reserve = 7 + car.speed * (0.45 + 0.12 * (1 - traits.consistency));
        const creep =
          clear && this.arcClears(car, other, gap, ourSin, ourCos, result.offset + shift);
        const limited =
          room <= 0
            ? 0
            : creep
              ? Math.sqrt(STALLED.creep ** 2 + 2 * brake * Math.max(0, gap - reserve))
              : Math.sqrt(
                  2 *
                    brake *
                    Math.max(
                      0,
                      gap - Math.max(reserve, front + this.along[other.id] + STALLED.holdGap),
                    ),
                );
        cap(limited, 'stalled');
        if (creep) this.bypass = other.id;
        else this.waiting = other.id;
        continue;
      }
      const corridor =
        Math.abs(other.lateral - (car.lateral + shift)) < 3 * lateralScale ||
        Math.abs(other.lateral - (result.offset + shift)) < 3 * lateralScale ||
        // A rider quicker than the car ahead reaches it where the lines will have
        // moved, not where they are now (PASS_PACE).
        (this.paced &&
          gap >= PASS_PACE.meetGap &&
          !this.stalled[other.id] &&
          other.definition.ai.topSpeed <= this.classTop - PASS_PACE.classMargin &&
          this.meets(
            car,
            other,
            gap,
            result.offset,
            closest,
            laneRate,
            limit,
            lateralScale,
            line,
            shiftAt,
          ));
      if (!corridor) continue;
      {
        // What it takes to stay clear of the car ahead: shed the speed it is closing at
        // by 6 m behind it, and keep up with it while it brakes (a leader slowing for a
        // corner or the flag is a moving target).
        const closing = Math.max(0, car.speed - other.speed),
          braking = Math.min(10, Math.max(0, -other.gLong * G)) * clamp(1 - (gap - 6) / 60, 0, 1);
        this.needDecel = Math.max(
          this.needDecel,
          closing ** 2 / (2 * Math.max(1, gap - 6)) + braking,
        );
      }
      if (other.id === this.blocker) {
        // Passing the car in the way in a lane that clears it: close on it only as
        // fast as the remaining lateral move allows (PASS_PACE).
        const reach = 2.75 * lateralScale,
          clear = Math.abs(other.lateral - (result.offset + shift)) >= reach,
          toGo = Math.max(0, reach - Math.abs(other.lateral - (car.lateral + shift))),
          seconds = toGo / laneRate + PASS_PACE.lanePad;
        if (clear && gap > PASS_PACE.closeGap + 2) {
          cap(other.speed + (gap - PASS_PACE.closeGap) / seconds, 'clear');
          continue;
        }
      }
      if (
        this.paced &&
        !this.stalled[other.id] &&
        (now < this.settleUntil ||
          (other.definition.ai.topSpeed <= this.classTop - PASS_PACE.classMargin &&
            this.runway >= PASS_PACE.settleRunway))
      ) {
        // The follow reserve below treats the car as an obstacle to stop short of. A
        // quicker class closes on a moving car and sheds the difference in speed over
        // the gap instead (as does a rider that has just been closing on one, so it
        // is not braked hard at once: at 250 km/h, leaning, that braking threw it
        // down), which also keeps it from crawling up to the car at the reserve.
        // Just out of a pass the rider is alongside or a few metres back: the distance it
        // keeps opens up over `ease` s, not at once (at 250 km/h that step was a hard stop).
        const settled = clamp((now - this.easeFrom) / PASS_PACE.ease, 0, 1),
          keep = lerp(PASS_PACE.closeGap, PASS_PACE.settleReserve + 0.25 * car.speed, settled);
        cap(other.speed + Math.sqrt(2 * PASS_PACE.settleDecel * Math.max(0, gap - keep)), 'settle');
        if (gap >= 7) continue;
      }
      let reserve = 7 + car.speed * (0.45 + 0.12 * (1 - traits.consistency));
      // Not closing up to a car that has stopped leaves room to steer past it.
      if (this.stalled[other.id])
        reserve = Math.max(reserve, front + this.along[other.id] + STALLED.holdGap);
      const safeSpeed = Math.sqrt(
        Math.max(0, other.speed * other.speed + 2 * Math.max(1, braking * 0.72) * (gap - reserve)),
      );
      cap(safeSpeed, 'follow');
      if (gap < 7) cap(Math.max(0, other.speed - 4), 'close');
    }
    if (this.waiting >= 0) result.decision = 'WAIT / STALLED CAR';
    else if (
      this.bypass >= 0 &&
      result.decision !== 'PASS / COMPLETE' &&
      !result.decision.includes('ABORT')
    )
      result.decision = 'PASS / STALLED CAR';
    return result;
  }
  /** Where a slower-class car is predicted to be, kept to the lanes it may use: one
   * that sits on the lane limit while the line moves away does not follow the line
   * off the road (PASS_PACE; every other car is predicted as before). */
  private onTrack(other: Vehicle, lateral: number, limit: number) {
    return this.paced && other.definition.ai.topSpeed <= this.classTop - PASS_PACE.classMargin
      ? clamp(lateral, -limit, limit)
      : lateral;
  }
  /** Whether, on the lane `lane` (reached from `from` at `rate`), the swept path
   * of this car meets the footprint of `other` (`gap` ahead) within the 4 s
   * horizon, at the moment it gets there rather than where the car is now. */
  private meets(
    car: Vehicle,
    other: Vehicle,
    gap: number,
    lane: number,
    from: number,
    rate: number,
    limit: number,
    lateralScale: number,
    line: (s: number) => number,
    shiftAt: (s: number) => number,
  ) {
    const closing = other.speed - car.speed,
      theirLine = line(other.s),
      drift = ((line(other.s + 1) - line(other.s - 1)) / 2) * other.speed,
      lateralVelocity = clamp(
        other.body.velocity.x * other.trackPosition.nx +
          other.body.velocity.z * other.trackPosition.nz -
          drift,
        -2,
        2,
      );
    for (let t = 0.2; t <= 4; t += 0.4) {
      const dx = gap + closing * t;
      if (Math.abs(dx) > PASS_PACE.meetReach) continue;
      const ours = approach(from, lane, rate * t) + shiftAt(car.s + car.speed * t),
        theirs = clamp(
          other.lateral +
            line(other.s + other.speed * t) -
            theirLine +
            lateralVelocity * Math.min(t, 1.2),
          -limit,
          limit,
        );
      if (Math.abs(theirs - ours) < 3 * lateralScale) return true;
    }
    return false;
  }
  /** Sine of a car's heading from the track direction (positive: towards
   * positive lateral offsets); its cosine is left in `cosine`. */
  private heading(v: Vehicle) {
    const p = v.trackPosition;
    v.body.orientation.rotate(this.axis.set(0, 0, 1), this.axis);
    this.cosine = this.axis.x * p.tx + this.axis.z * p.tz;
    return this.axis.x * p.nx + this.axis.z * p.nz;
  }
  /** Whether a full-lock turn from our pose towards `lane` sweeps clear of
   * the stalled car's near corner (`gap` ahead): its distance from the turn
   * centre exceeds the radius of our outer front corner, with a margin. */
  private arcClears(
    car: Vehicle,
    other: Vehicle,
    gap: number,
    sin: number,
    cos: number,
    lane: number,
  ) {
    const side = lane >= other.lateral ? 1 : -1,
      [width, , length] = car.definition.halfExtents,
      half = car.spec.wheelbase / 2,
      radius = car.spec.wheelbase / Math.tan(car.spec.maxSteer);
    // Track frame: along from our centre, across as lateral offset.
    const centreAlong = -half * cos - side * radius * sin,
      centreAcross = car.lateral - half * sin + side * radius * cos;
    const corner = Math.hypot(
      gap - this.along[other.id] - centreAlong,
      other.lateral + side * this.across[other.id] - centreAcross,
    );
    return corner > Math.hypot(radius + width, length + half) + 0.25;
  }
  private grow(size: number) {
    const moving = new Float64Array(size).fill(NaN),
      moved = new Float64Array(size);
    moving.set(this.movingAt);
    moved.set(this.movedAlong);
    this.movingAt = moving;
    this.movedAlong = moved;
    this.stalled = new Uint8Array(size);
    this.across = new Float64Array(size);
    this.along = new Float64Array(size);
  }
  /** Commit to one target per attempt; complete when clear ahead, abort when
   * the gap opens, closing speed is lost for a second, the defender covers the
   * chosen lane before overlap, or no lane is safe. */
  private trackPass(
    car: Vehicle,
    cars: readonly Vehicle[],
    track: Track,
    now: number,
    found: boolean,
    lineOffset: number,
    traits: DriverPersonality,
  ) {
    const result = this.result;
    const gapTo = (other: Vehicle) =>
      mod(other.s - car.s + track.length / 2, track.length) - track.length / 2;
    if (this.passTarget < 0) {
      if (!found || Math.abs(result.offset - lineOffset) <= 1 || now < this.retryAfter) return;
      let target: Vehicle | null = null,
        nearest = 70;
      for (const other of cars) {
        if (other === car || other.inPit || other.retired || other.finishTime) continue;
        const gap = gapTo(other);
        if (gap > 0 && gap < nearest && Math.abs(other.lateral - car.lateral) < 3) {
          nearest = gap;
          target = other;
        }
      }
      // The car a pace-aware rider is getting past is the one its attempt is about.
      if (this.paced && this.blocker >= 0)
        target = cars.find((o) => o.id === this.blocker) ?? target;
      if (!target) return;
      this.passPaced = this.paced && target.id === this.blocker;
      this.passTarget = target.id;
      this.passSince = now;
      this.notClosingSince = -1;
      this.clearSince = -1;
      return;
    }
    const target = cars.find((other) => other.id === this.passTarget);
    const gap = target ? gapTo(target) : Infinity;
    if (target && gap < -6.5) {
      this.passes++;
      this.passTarget = -1;
      result.decision = 'PASS / COMPLETE';
      return;
    }
    let reason = '';
    if (!target || target.inPit || target.retired) reason = 'TARGET GONE';
    else if (this.passPaced && this.blocker !== this.passTarget && gap > -6.5)
      reason = 'STRAIGHT ENDED';
    else if (!found) reason = 'NO SAFE LANE';
    else if (gap > (this.passPaced ? PASS_PACE.look + PASS_PACE.gapMargin : 45))
      reason = 'GAP OPENED';
    else {
      let notClosing: boolean;
      if (this.passPaced) {
        // Judged on progress once free of the target's corridor, not on speed
        // while the follow cap (or the lane change itself) is what holds the rider.
        if (Math.abs(target.lateral - car.lateral) < 3 * this.scale) this.clearSince = -1;
        else if (this.clearSince < 0 || gap < this.clearGap - 1) {
          this.clearSince = now;
          this.clearGap = gap;
        }
        notClosing = this.clearSince >= 0 && now - this.clearSince > PASS_PACE.stall;
      } else {
        if (car.speed - target.speed < -0.5) {
          if (this.notClosingSince < 0) this.notClosingSince = now;
        } else this.notClosingSince = -1;
        notClosing = this.notClosingSince >= 0 && now - this.notClosingSince > 1;
      }
      if (notClosing) reason = 'NOT CLOSING';
      else if (gap > 7 && gap < 25 && Math.abs(target.lateral - result.offset) < 2)
        reason = 'COVERED';
      else if (now - this.passSince > (this.passPaced ? PASS_PACE.timeout : 12))
        reason = 'TIMED OUT';
    }
    if (!reason) {
      // A pace-aware rider keeps its lane until the pass is made or given up.
      if (this.passPaced) this.holdUntil = Math.max(this.holdUntil, now + 1);
      result.decision = 'PASS / COMMITTED';
      return;
    }
    if (this.passPaced) this.easeFrom = now;
    this.aborts++;
    this.lastAbort = reason;
    this.passTarget = -1;
    this.holdUntil = 0;
    const cornered = reason === 'STRAIGHT ENDED';
    this.retryAfter =
      now +
      (cornered
        ? PASS_PACE.corner
        : this.passPaced
          ? PASS_PACE.retry
          : 2.5 + (1 - traits.overtakingSkill) * 2);
    this.retryCost = cornered ? PASS_PACE.cornerCost : 4;
    result.decision = `PASS / ABORT ${reason}`;
  }
}
