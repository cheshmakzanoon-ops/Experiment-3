/** Actual crossing-time samples at equal distance intervals. This is a measured
 * best-lap reference, never bestLapTime * distanceFraction (which invents an
 * assumed constant-speed lap). Stored data is bounded per vehicle. */
export class LapReference {
  readonly current = new Float64Array(257).fill(NaN);
  readonly best = new Float64Array(257).fill(NaN);
  bestTime = 0;
  private startTime = 0;
  private next = 1;
  constructor(readonly length: number) {
    if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid lap reference length');
  }
  start(time: number) {
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid reference start');
    this.startTime = time;
    this.next = 1;
    this.current.fill(NaN);
    this.current[0] = 0;
  }
  observe(from: number, to: number, fromTime: number, toTime: number) {
    if (
      ![from, to, fromTime, toTime].every(Number.isFinite) ||
      from < 0 ||
      to > this.length + 1e-6 ||
      toTime < fromTime
    )
      throw new Error('Invalid reference interval');
    if (to <= from) return;
    while (this.next < this.current.length) {
      const station = (this.next * this.length) / (this.current.length - 1);
      if (station > to + 1e-7) break;
      if (station < from - 1e-6) {
        this.next++;
        continue;
      }
      this.current[this.next++] =
        fromTime + ((toTime - fromTime) * (station - from)) / (to - from) - this.startTime;
    }
  }
  finish(time: number, accept: boolean) {
    if (
      !accept ||
      this.next !== this.current.length ||
      !this.current.every(Number.isFinite) ||
      !Number.isFinite(time) ||
      time <= 0 ||
      (this.bestTime > 0 && time >= this.bestTime)
    )
      return;
    this.bestTime = time;
    this.best.set(this.current);
  }
  delta(station: number, elapsed: number): number {
    if (!Number.isFinite(station + elapsed)) throw new Error('Invalid reference delta');
    if (!this.bestTime) return 0;
    const coordinate = Math.max(0, Math.min(1, station / this.length)) * (this.best.length - 1);
    const lower = Math.min(this.best.length - 2, Math.floor(coordinate));
    const reference =
      this.best[lower] + (this.best[lower + 1] - this.best[lower]) * (coordinate - lower);
    return elapsed - reference;
  }
}
