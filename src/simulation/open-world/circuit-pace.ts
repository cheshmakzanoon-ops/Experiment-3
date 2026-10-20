/** Same-car, same-session practice comparison. These are measured sector
 * splits, not a predicted lap, a composite ideal lap, or career rewards. */
export type CircuitPaceReason =
  | 'off-road'
  | 'contact'
  | 'reset'
  | 'autopilot'
  | 'incomplete'
  | 'invalid-progress';

export interface CircuitPaceRecord {
  time: number;
  /** Elapsed times at the two sector lines and the finish. */
  crossings: readonly [number, number, number];
}
export interface CircuitPaceSplit {
  sector: number;
  time: number;
  /** This sector against the same sector of the best complete clean run. */
  delta: number | null;
}
export interface CircuitPaceStatus {
  sector: number;
  sectorElapsed: number;
  referenceTime: number | null;
  splits: CircuitPaceSplit[];
  valid: boolean;
  reason: CircuitPaceReason | null;
}
export interface CircuitPaceResult extends CircuitPaceStatus {
  time: number;
  delta: number | null;
  newBest: boolean;
}

export class CircuitPace {
  private distance = 0;
  private elapsed = 0;
  private readonly crossings: number[] = [];
  private reason: CircuitPaceReason | null = null;
  private result: CircuitPaceResult | null = null;
  readonly reference: CircuitPaceRecord | null;

  constructor(
    readonly length: number,
    reference: CircuitPaceRecord | null = null,
  ) {
    if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid practice distance');
    this.reference = reference
      ? { time: reference.time, crossings: [...reference.crossings] }
      : null;
  }

  invalidate(reason: CircuitPaceReason) {
    if (!this.result) this.reason ??= reason;
  }

  /** Read net route station, never RouteProgress's positive-distance tally:
   * reversing and repeating a stretch must not advance a sector line. */
  sample(distance: number, elapsed: number) {
    if (this.result) return;
    if (!Number.isFinite(distance) || !Number.isFinite(elapsed) || elapsed < this.elapsed) {
      this.invalidate('invalid-progress');
      return;
    }
    const next = Math.max(0, Math.min(this.length, distance));
    const moved = next - this.distance;
    // More than 150 m/s plus a small projection tolerance cannot be a
    // continuous road-car sample. Recovery invalidates separately as well.
    if (Math.abs(moved) > 4 + 150 * (elapsed - this.elapsed)) this.invalidate('invalid-progress');
    while (this.crossings.length < 2) {
      const line = (this.length * (this.crossings.length + 1)) / 3;
      if (next < line || moved <= 0) break;
      const fraction = Math.max(0, Math.min(1, (line - this.distance) / moved));
      this.crossings.push(this.elapsed + (elapsed - this.elapsed) * fraction);
    }
    this.distance = next;
    this.elapsed = elapsed;
  }

  status(elapsed = this.elapsed): CircuitPaceStatus {
    const clock = Number.isFinite(elapsed) ? Math.max(this.elapsed, elapsed) : this.elapsed;
    return {
      sector: Math.min(3, this.crossings.length + 1),
      sectorElapsed: this.result ? 0 : Math.max(0, clock - (this.crossings.at(-1) ?? 0)),
      referenceTime: this.reference?.time ?? null,
      splits: this.crossings.map((crossing, i) => {
        const time = crossing - (this.crossings[i - 1] ?? 0);
        return {
          sector: i + 1,
          time,
          delta: this.reference
            ? time - (this.reference.crossings[i] - (this.reference.crossings[i - 1] ?? 0))
            : null,
        };
      }),
      valid: this.reason === null,
      reason: this.reason,
    };
  }

  /** The legal checkpoint finish, not accumulated distance, closes sector 3. */
  finish(completed: boolean, elapsed: number): CircuitPaceResult {
    if (this.result) return this.result;
    if (!Number.isFinite(elapsed) || elapsed < this.elapsed) {
      this.invalidate('invalid-progress');
      elapsed = this.elapsed;
    }
    if (!completed || this.crossings.length !== 2) this.invalidate('incomplete');
    if (completed && this.crossings.length === 2) this.crossings.push(elapsed);
    this.elapsed = elapsed;
    const status = this.status();
    this.result = {
      ...status,
      sectorElapsed: 0,
      time: elapsed,
      delta: this.reference ? elapsed - this.reference.time : null,
      newBest: status.valid && (!this.reference || elapsed < this.reference.time),
    };
    return this.result;
  }

  record(): CircuitPaceRecord | null {
    return this.result?.newBest && this.crossings.length === 3
      ? { time: this.result.time, crossings: [...this.crossings] as [number, number, number] }
      : null;
  }
}
