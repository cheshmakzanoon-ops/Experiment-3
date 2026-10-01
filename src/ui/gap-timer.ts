/** Broadcast-style race intervals from timing loops.
 *
 * Each car's lap position is unwrapped into a race distance (the standing
 * start sits just behind the line, so a grid slot near the end of the lap
 * starts negative, as in the race order). Every `loopM` metres a loop records
 * the race time at which the car passed it. The interval of a car to the car
 * ahead is the time since that car passed the follower's current distance:
 * the delay a stopwatch at the follower's position would read. No speed or
 * distance-to-time estimate is involved. */
export class GapTimer {
  static readonly MAX_FRAME_SECONDS = 8;
  private distance: Float64Array;
  private lastS: Float64Array;
  private marks: number[][];
  private time = -Infinity;
  constructor(
    readonly length: number,
    readonly cars: number,
    readonly loopM = 10,
  ) {
    if (!(length > 0) || !(cars > 0) || !(loopM > 0)) throw new Error('Invalid gap timer');
    this.distance = new Float64Array(cars);
    this.lastS = new Float64Array(cars);
    this.marks = Array.from({ length: cars }, () => []);
  }
  /** Forget every loop (new session, replay seek or time running backwards). */
  reset() {
    this.time = -Infinity;
    for (const marks of this.marks) marks.length = 0;
  }
  /** Race distance of a car, metres from the start line on the first lap. */
  raceDistance(car: number) {
    return this.distance[car];
  }
  /** Record one presented frame. `s[i]` is car i's position along the lap. */
  observe(time: number, s: ArrayLike<number>) {
    if (!Number.isFinite(time)) return;
    // Presentation jitter of a few milliseconds is ignored. A replay seek or a
    // new session (time stepping back, or forward by more than any real
    // frame, including multi-second software-rendered frames) restarts the
    // loops; crossings inside an ordinary slow frame are interpolated.
    if (time <= this.time && this.time - time < 0.05) return;
    if (time < this.time || time - this.time > GapTimer.MAX_FRAME_SECONDS) this.reset();
    const first = this.time === -Infinity;
    const elapsed = time - this.time;
    for (let car = 0; car < this.cars; car++) {
      const position = s[car];
      if (!Number.isFinite(position)) continue;
      if (first) {
        this.distance[car] = position > this.length / 2 ? position - this.length : position;
        this.lastS[car] = position;
        continue;
      }
      const half = this.length / 2;
      const delta = ((((position - this.lastS[car] + half) % this.length) + this.length) % this.length) - half;
      const before = this.distance[car];
      this.distance[car] += delta;
      this.lastS[car] = position;
      if (delta > 0) this.stamp(car, before, this.distance[car], time - elapsed, time);
    }
    this.time = time;
  }
  private loopIndex(distance: number) {
    return Math.floor((distance + this.length) / this.loopM);
  }
  /** Times for every loop crossed between two distances, interpolated linearly
   * within the frame (as the race timing interpolates its line crossings). */
  private stamp(car: number, from: number, to: number, t0: number, t1: number) {
    const marks = this.marks[car];
    const last = this.loopIndex(to);
    // Only the first pass of a loop counts; loops before the first observed
    // crossing stay empty.
    for (let k = Math.max(marks.length, this.loopIndex(from) + 1); k <= last; k++) {
      const at = k * this.loopM - this.length;
      const f = Math.min(1, Math.max(0, (at - from) / (to - from)));
      while (marks.length < k) marks.push(NaN);
      marks[k] = t0 + (t1 - t0) * f;
    }
  }
  /** When `car` passed race distance `distance`, or null if it has not. */
  passed(car: number, distance: number): number | null {
    const marks = this.marks[car];
    const position = (distance + this.length) / this.loopM;
    const k = Math.floor(position);
    if (k < 0 || k + 1 >= marks.length) return null;
    const a = marks[k],
      b = marks[k + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a + (b - a) * (position - k);
  }
  /** Seconds between `ahead` and `behind`, or null before both are timed. */
  interval(ahead: number, behind: number): number | null {
    const at = this.passed(ahead, this.distance[behind]);
    return at === null ? null : Math.max(0, this.time - at);
  }
  /** Whole laps between two cars by race distance (0 on the same lap). */
  lapsBetween(ahead: number, behind: number) {
    return Math.max(0, Math.floor((this.distance[ahead] - this.distance[behind]) / this.length));
  }
}

/** Three-letter timing code from a display name ("K. SATO" -> "SAT"). */
export function driverCode(name: string) {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z\s.]/g, '')
    .split(/[\s.]+/)
    .filter(Boolean);
  const surname = words.at(-1) ?? '';
  return (surname + 'XXX').slice(0, 3);
}

/** Interval text as on a broadcast timing tower. */
export function formatInterval(seconds: number | null, laps: number) {
  if (laps > 0) return `+${laps} LAP${laps > 1 ? 'S' : ''}`;
  if (seconds === null) return '—';
  return seconds >= 60
    ? `+${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
    : `+${seconds.toFixed(3)}`;
}
