/** Same-car, same-session practice comparison. Measured sector splits and
 * elapsed time at the same route station; never a predicted or ideal lap. */
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
  /** First forward crossing of equally spaced stations, including 0/finish.
   * Optional for sector-only records created before live comparison. */
  trace?: CircuitPaceTrace;
}
export interface CircuitPaceTrace {
  length: number;
  times: readonly number[];
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
  /** Current elapsed minus the clean reference at the same net route station.
   * Negative is ahead. Null/absent means no valid distance trace to compare. */
  liveDelta?: number | null;
}
export interface CircuitPaceResult extends CircuitPaceStatus {
  time: number;
  delta: number | null;
  newBest: boolean;
}

/** Roughly ten metres per interval, with a fixed memory ceiling even for an
 * unusually long course. No per-frame history is retained. */
export const CIRCUIT_PACE_TRACE = Object.freeze({ spacing: 10, maxSamples: 2049 });
const traceIntervals = (length: number) =>
  Math.max(
    1,
    Math.min(CIRCUIT_PACE_TRACE.maxSamples - 1, Math.ceil(length / CIRCUIT_PACE_TRACE.spacing)),
  );

function copyReference(
  reference: CircuitPaceRecord | null,
  length: number,
): CircuitPaceRecord | null {
  if (
    !reference ||
    !Number.isFinite(reference.time) ||
    reference.time <= 0 ||
    !Array.isArray(reference.crossings) ||
    reference.crossings.length !== 3 ||
    Array.from(reference.crossings).some(
      (time, i, all) => !Number.isFinite(time) || time <= (all[i - 1] ?? 0),
    ) ||
    Math.abs(reference.crossings[2] - reference.time) > 1e-6
  )
    return null;
  const source = reference.trace;
  const times =
    source && Array.isArray(source.times) && source.times.length === traceIntervals(length) + 1
      ? [...source.times]
      : null;
  const validTrace =
    source &&
    times &&
    Number.isFinite(source.length) &&
    source.length > 0 &&
    Math.abs(source.length - length) <= 0.001 &&
    times[0] === 0 &&
    times.every((time, i, all) => Number.isFinite(time) && (i === 0 || time > all[i - 1])) &&
    Math.abs(times.at(-1)! - reference.time) <= 1e-6;
  return Object.freeze({
    time: reference.time,
    crossings: Object.freeze([...reference.crossings] as [number, number, number]),
    ...(validTrace
      ? { trace: Object.freeze({ length: source.length, times: Object.freeze(times) }) }
      : {}),
  });
}

export class CircuitPace {
  private distance = 0;
  private elapsed = 0;
  private readonly crossings: number[] = [];
  private readonly traceTimes = [0];
  private readonly intervals: number;
  private reason: CircuitPaceReason | null = null;
  private result: CircuitPaceResult | null = null;
  readonly reference: CircuitPaceRecord | null;

  constructor(
    readonly length: number,
    reference: CircuitPaceRecord | null = null,
  ) {
    if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid practice distance');
    this.intervals = traceIntervals(length);
    this.reference = copyReference(reference, length);
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
    const dt = elapsed - this.elapsed;
    // More than 150 m/s plus a small projection tolerance cannot be a
    // continuous road-car sample. Recovery invalidates separately as well.
    if (Math.abs(moved) > 4 + 150 * dt || (dt === 0 && Math.abs(moved) > 1e-6))
      this.invalidate('invalid-progress');
    while (this.crossings.length < 2) {
      const line = (this.length * (this.crossings.length + 1)) / 3;
      if (next < line || moved <= 0) break;
      const fraction = Math.max(0, Math.min(1, (line - this.distance) / moved));
      this.crossings.push(this.elapsed + (elapsed - this.elapsed) * fraction);
    }
    // Keep the first arrival at each station. Stopping or reversing adds time
    // before the next new station; re-driving old metres never rewrites history.
    while (!this.reason && moved > 0 && this.traceTimes.length < this.intervals) {
      const station = this.length * (this.traceTimes.length / this.intervals);
      if (next < station) break;
      const fraction = Math.max(0, Math.min(1, (station - this.distance) / moved));
      this.traceTimes.push(this.elapsed + dt * fraction);
    }
    this.distance = next;
    this.elapsed = elapsed;
  }

  status(elapsed = this.elapsed): CircuitPaceStatus {
    const clock =
      this.result?.time ??
      (Number.isFinite(elapsed) ? Math.max(this.elapsed, elapsed) : this.elapsed);
    const trace = this.reference?.trace;
    let liveDelta: number | null = null;
    if (!this.reason && trace) {
      const at = Math.max(
        0,
        Math.min(trace.times.length - 1, (this.distance / trace.length) * (trace.times.length - 1)),
      );
      const i = Math.min(trace.times.length - 2, Math.floor(at));
      const referenceElapsed = trace.times[i] + (trace.times[i + 1] - trace.times[i]) * (at - i);
      liveDelta = clock - referenceElapsed;
    }
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
      liveDelta,
    };
  }

  /** The legal checkpoint finish, not accumulated distance, closes sector 3. */
  finish(completed: boolean, elapsed: number): CircuitPaceResult {
    if (this.result) return this.result;
    if (!Number.isFinite(elapsed) || elapsed < this.elapsed) {
      this.invalidate('invalid-progress');
      elapsed = this.elapsed;
    }
    if (!completed || this.crossings.length !== 2 || this.distance < this.length - 1e-6)
      this.invalidate('incomplete');
    if (completed && this.crossings.length === 2) this.crossings.push(elapsed);
    if (!this.reason && this.traceTimes.length === this.intervals) this.traceTimes.push(elapsed);
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
    return this.result?.newBest &&
      this.crossings.length === 3 &&
      this.traceTimes.length === this.intervals + 1
      ? {
          time: this.result.time,
          crossings: [...this.crossings] as [number, number, number],
          trace: { length: this.length, times: [...this.traceTimes] },
        }
      : null;
  }
}
