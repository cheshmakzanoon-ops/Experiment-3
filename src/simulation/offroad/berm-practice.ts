import { clamp, lerp, mod } from '../../core/math.ts';
import { trackPoint, type Track } from '../track.ts';
import type { OffroadCourse } from './course.ts';

export type BermLine = 'inside' | 'middle' | 'outside';
export type BermSoil = 'dry' | 'damp' | 'wet';

export interface BermPracticeSector {
  readonly id: number;
  readonly name: string;
  /** Entry, apex and exit use the actual authored bank's lap stations. */
  readonly from: number;
  readonly apex: number;
  readonly to: number;
  readonly length: number;
  /** Track lateral sign of the outside bank, not the bike's lean sign. */
  readonly outside: 1 | -1;
  readonly halfWidth: number;
}

/** Corner practice covers authored banks only. A jump or whoop overlapping a
 * bank is deliberately excluded: its flight belongs to the landing coach.
 * No alternate racing line, contact surface or artificial grip is authored. */
export function motocrossBermSectors(track: Track, course: OffroadCourse) {
  if (course.kind !== 'motocross' && course.kind !== 'supercross') return [];
  const point = trackPoint();
  const sectors: BermPracticeSector[] = [];
  for (const berm of course.spec.berms) {
    const length = mod(berm.to - berm.from, track.length);
    if (length < 12 || length > track.length / 2) continue;
    const overlaps = (from: number, to: number) =>
      mod(from - berm.from, track.length) < length ||
      mod(berm.from - from, track.length) < mod(to - from, track.length);
    if (
      course.jumps.some((jump) => overlaps(jump.start - 3, jump.end + 3)) ||
      course.rough.some((rough) => overlaps(rough.from, rough.to))
    )
      continue;
    const apex = mod(berm.from + length / 2, track.length);
    track.at(apex, point);
    const corner = track.circuit.corners.find(
      (candidate) => mod(candidate.s - berm.from, track.length) <= length,
    );
    sectors.push({
      id: sectors.length,
      name: corner?.name ?? `BERM ${sectors.length + 1}`,
      from: mod(berm.from, track.length),
      apex,
      to: mod(berm.to, track.length),
      length,
      outside: berm.side ?? (point.curvature > 0 ? -1 : 1),
      halfWidth: point.width,
    });
  }
  return sectors;
}

export function motocrossBermLine(lateral: number, sector: BermPracticeSector): BermLine {
  const outside = (lateral * sector.outside) / Math.max(1, sector.halfWidth);
  return outside < -0.28 ? 'inside' : outside > 0.28 ? 'outside' : 'middle';
}

export function motocrossBermSoil(moisture: number): BermSoil {
  return moisture > 0.58 ? 'wet' : moisture > 0.32 ? 'damp' : 'dry';
}

export interface BermPracticeSample {
  course: object;
  machine: string;
  sectors: readonly BermPracticeSector[];
  length: number;
  time: number;
  s: number;
  speed: number;
  lateral: number;
  /** Includes the authored outside bank, minus a small tyre clearance. */
  legalHalfWidth: number;
  moisture: number;
  airborne: boolean;
  crashed: boolean;
  /** Human control, green flags, on course, outside pit/replay/retirement. */
  eligible: boolean;
}

export interface BermPracticeResult {
  sector: BermPracticeSector;
  at: number;
  seconds: number;
  line: BermLine;
  soil: BermSoil;
  exitSpeed: number;
  /** Elapsed times at evenly spaced stations, including entry and exit.
   * A fixed spatial trace makes a live comparison independent of frame rate. */
  splitTimes: readonly number[];
  /** Signed difference from the earlier best in this soil category. */
  delta: number | null;
  improved: boolean;
}

export interface BermPracticeHistory {
  attempts: number;
  best: BermPracticeResult;
  last: BermPracticeResult;
  /** Compare real attempts through each broad line, without declaring an
   * untried line faster. The label describes lateral position at the apex. */
  lines: Partial<Record<BermLine, BermPracticeResult>>;
}

interface ActiveBerm {
  sector: BermPracticeSector;
  startedAt: number;
  elapsed: number;
  progress: number;
  line: BermLine;
  soil: BermSoil;
  apexSeen: boolean;
  splitTimes: number[];
  /** Seconds ahead of (negative) or behind the best at this same station. */
  delta: number | null;
}

const BERM_SPLITS = 32;

/** Interpolate the recorded passage time at a course station. The reference
 * is an actual completed traversal, never the fraction of a whole-sector PB. */
function passageTime(result: BermPracticeResult, progress: number) {
  if (result.splitTimes.length !== BERM_SPLITS + 1) return null;
  const at = clamp(progress, 0, 1) * BERM_SPLITS;
  const lower = Math.min(BERM_SPLITS - 1, Math.floor(at));
  return lerp(result.splitTimes[lower], result.splitTimes[lower + 1], at - lower);
}

/** Session-local, snapshot-driven corner timing. Only a complete, observed
 * forward traversal can establish a record. Entry/exit times are interpolated
 * between snapshots, so presentation rate does not define the winning time.
 * This measures a player's attempts; it makes no promise about an ideal line. */
export class MotocrossBermPractice {
  readonly history = new Map<number, BermPracticeHistory>();
  active: ActiveBerm | null = null;
  last: BermPracticeResult | null = null;
  private course: object | null = null;
  private machine = '';
  private time = -Infinity;
  private s = 0;
  private speed = 0;
  private lateral = 0;
  private moisture = 0;
  private ready = false;

  record(sector: BermPracticeSector, soil: BermSoil) {
    return this.history.get(sector.id * 3 + (soil === 'wet' ? 2 : soil === 'damp' ? 1 : 0));
  }

  reset() {
    this.history.clear();
    this.last = null;
    this.suspend();
    this.course = null;
    this.machine = '';
    this.time = -Infinity;
  }

  /** Replays/control handoffs retain earned records, never a partial corner. */
  suspend() {
    this.active = null;
    this.ready = false;
  }

  update(sample: BermPracticeSample) {
    if (
      !Number.isFinite(sample.time) ||
      !Number.isFinite(sample.s) ||
      !Number.isFinite(sample.speed) ||
      !Number.isFinite(sample.lateral) ||
      !Number.isFinite(sample.legalHalfWidth) ||
      !Number.isFinite(sample.moisture) ||
      !Number.isFinite(sample.length) ||
      !(sample.length > 0)
    ) {
      this.reset();
      return;
    }
    if (sample.course !== this.course || sample.machine !== this.machine) this.reset();
    // A rewind or a missed section invalidates continuity. Preserve earned
    // records so an ordinary pause/replay does not erase the practice session.
    if (sample.time < this.time || sample.time > this.time + 2) this.suspend();
    this.course = sample.course;
    this.machine = sample.machine;
    const valid =
      sample.eligible &&
      !sample.crashed &&
      !sample.airborne &&
      sample.speed >= 0 &&
      Math.abs(sample.lateral) <= sample.legalHalfWidth;
    if (sample.time === this.time) {
      if (!valid) this.suspend();
      return;
    }
    const s = mod(sample.s, sample.length);
    const dt = sample.time - this.time;
    const step = mod(s - this.s + sample.length / 2, sample.length) - sample.length / 2;
    // Centreline distance differs from wheel travel through inside/outside
    // arcs. This loose bound detects resets without rewarding teleportation.
    const plausible =
      this.ready &&
      valid &&
      step >= -0.03 &&
      step <= Math.max(3, (this.speed + sample.speed) * 0.5 * dt * 1.8 + 1);
    if (!plausible) this.active = null;
    if (plausible && step > 0) {
      if (!this.active) {
        for (const sector of sample.sectors) {
          const distance = mod(sector.from - this.s, sample.length);
          // A spawn inside a sector cannot infer an unobserved entry.
          if (distance > step || distance === 0) continue;
          const fraction = distance / step;
          this.active = {
            sector,
            startedAt: lerp(this.time, sample.time, fraction),
            elapsed: 0,
            progress: 0,
            line: motocrossBermLine(lerp(this.lateral, sample.lateral, fraction), sector),
            soil: motocrossBermSoil(lerp(this.moisture, sample.moisture, fraction)),
            apexSeen: false,
            splitTimes: [0],
            delta: null,
          };
          break;
        }
      }
      const active = this.active;
      if (active) {
        const apexDistance = mod(active.sector.apex - this.s, sample.length);
        if (!active.apexSeen && apexDistance <= step) {
          const fraction = apexDistance / step;
          active.line = motocrossBermLine(
            lerp(this.lateral, sample.lateral, fraction),
            active.sector,
          );
          active.soil = motocrossBermSoil(lerp(this.moisture, sample.moisture, fraction));
          active.apexSeen = true;
        } else if (!active.apexSeen) active.line = motocrossBermLine(sample.lateral, active.sector);
        const exitDistance = mod(active.sector.to - this.s, sample.length);
        active.elapsed = Math.max(0, sample.time - active.startedAt);
        active.progress = clamp(
          mod(s - active.sector.from, sample.length) / active.sector.length,
          0,
          1,
        );
        // Samples can cross several stations at low presentation rates. Each
        // crossing uses the observed segment's time, including its interpolated
        // entry/exit, rather than stamping every split with the current frame.
        const travelled = mod(s - active.sector.from, sample.length);
        const previousTravelled = travelled - step;
        while (active.splitTimes.length <= BERM_SPLITS) {
          const station = (active.splitTimes.length / BERM_SPLITS) * active.sector.length;
          if (station > travelled) break;
          const fraction = clamp((station - previousTravelled) / step, 0, 1);
          active.splitTimes.push(lerp(this.time, sample.time, fraction) - active.startedAt);
        }
        if (exitDistance <= step) {
          const fraction = exitDistance / step;
          const at = lerp(this.time, sample.time, fraction);
          const seconds = at - active.startedAt;
          if (active.apexSeen && seconds > 0) {
            const previous = this.record(active.sector, active.soil);
            const result: BermPracticeResult = {
              sector: active.sector,
              at,
              seconds,
              line: active.line,
              soil: active.soil,
              exitSpeed: lerp(this.speed, sample.speed, fraction),
              splitTimes: active.splitTimes,
              delta: previous ? seconds - previous.best.seconds : null,
              improved: !!previous && seconds < previous.best.seconds - 0.005,
            };
            const record = previous ?? { attempts: 0, best: result, last: result, lines: {} };
            record.attempts++;
            record.last = result;
            if (result.seconds < record.best.seconds) record.best = result;
            if (!record.lines[result.line] || result.seconds < record.lines[result.line]!.seconds)
              record.lines[result.line] = result;
            const key =
              active.sector.id * 3 + (active.soil === 'wet' ? 2 : active.soil === 'damp' ? 1 : 0);
            this.history.set(key, record);
            this.last = result;
          }
          this.active = null;
        }
      }
    }
    if (this.active && plausible) {
      this.active.elapsed = Math.max(0, sample.time - this.active.startedAt);
      const active = this.active;
      const reference = this.record(active.sector, active.soil)?.best;
      const passage =
        reference && motocrossBermSoil(sample.moisture) === active.soil
          ? passageTime(reference, active.progress)
          : null;
      active.delta = passage === null ? null : active.elapsed - passage;
    }
    this.time = sample.time;
    this.s = s;
    this.speed = sample.speed;
    this.lateral = sample.lateral;
    this.moisture = sample.moisture;
    this.ready = valid;
  }
}
