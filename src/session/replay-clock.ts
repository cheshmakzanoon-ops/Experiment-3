import { clamp } from '../core/math.ts';

function validDuration(duration: number) {
  return Number.isFinite(duration) && duration >= 0;
}

function validRange(floor: number, duration: number) {
  return Number.isFinite(floor) && floor >= 0 && validDuration(duration) && floor <= duration;
}

/** Native range inputs can serialize their values with 15 significant digits.
 * Recover an authoritative endpoint only for that exact decimal representation;
 * a general epsilon would also move nearby, deliberately requested interior seeks.
 * Exact bounds win first. If both bounds serialize alike, use the nearest one. */
function seekPosition(value: number, floor: number, duration: number) {
  const position = clamp(value, floor, duration);
  if (position === floor || position === duration) return position;
  const atFloor = position === Number(floor.toPrecision(15));
  const atEnd = position === Number(duration.toPrecision(15));
  if (atFloor && atEnd) return position - floor <= duration - position ? floor : duration;
  if (atFloor) return floor;
  if (atEnd) return duration;
  return position;
}

/** Replay playback clock (masterplan §6.2 replay service, §24.2 four
 * clocks). It owns the recorded-session position in seconds from the
 * recording start, the play/pause state, rate and seek acknowledgement.
 * Conversion: recorded time = recording start + position; presented time is
 * whatever the renderer draws for that position. Wall time only advances it
 * through `target()`, capped per callback so a stall cannot jump the clock.
 * Malformed timing and invalid recording bounds leave the last valid position
 * and pending seek intact; the next valid update can resume normally.
 * It never depends on a scene being drawn to make logical progress. */
export class ReplayClock {
  position = 0;
  playing = true;
  rate = 1;
  /** A seek waits to be presented once before playback advances again. */
  seekPending = false;
  /** Largest wall interval a single callback may advance (s). */
  static readonly MAX_STEP = 0.5;
  setRate(value: number) {
    if (Number.isFinite(value)) this.rate = clamp(value, 0.25, 2);
  }
  seek(value: number, floor: number, duration: number) {
    if (!Number.isFinite(value) || !validRange(floor, duration)) return;
    this.position = seekPosition(value, floor, duration);
    this.seekPending = true;
  }
  /** Position to present after `wallDelta` seconds; `advancing` is false when
   * playback is covered (dialogs, hidden tab) or paused. */
  target(wallDelta: number, duration: number, advancing: boolean) {
    if (
      !this.playing ||
      this.seekPending ||
      !advancing ||
      !Number.isFinite(wallDelta) ||
      !validDuration(duration)
    )
      return this.position;
    return Math.min(
      duration,
      this.position + Math.min(Math.max(0, wallDelta), ReplayClock.MAX_STEP) * this.rate,
    );
  }
  /** The target was presented: commit it; playback stops at the end. */
  presented(target: number, duration: number) {
    if (!Number.isFinite(target) || !validDuration(duration) || target < 0 || target > duration)
      return;
    this.position = target;
    this.seekPending = false;
    if (this.position >= duration) this.playing = false;
  }
  /** PLAY/PAUSE control; playing again from the end restarts from `floor`. */
  toggle(floor: number, duration: number) {
    if (!validRange(floor, duration)) return this.playing;
    if (!this.playing && this.position >= duration) this.seek(floor, floor, duration);
    this.playing = !this.playing;
    return this.playing;
  }
}
