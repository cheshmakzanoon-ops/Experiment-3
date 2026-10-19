import { CAR_STRIDE, H, HEADER, R, RACE_BASE, carBase } from '../simulation/protocol.ts';

interface StoredFrame {
  frame: Float32Array;
  auxiliary: Float32Array | null;
  time: number;
}

export interface LiveFrameSample {
  a: Float32Array;
  b: Float32Array;
  alpha: number;
  /** Optional traffic or other presentation data belonging to these exact frames. */
  auxiliaryA: Float32Array | null;
  auxiliaryB: Float32Array | null;
}

/** Live presentation follows one continuous simulation-time clock, delayed by
 * two nominal worker snapshots. Arrival of a packet does not restart its
 * interpolation: irregular 2/3-tick batches therefore keep a constant-speed
 * vehicle moving at constant speed. A small history is needed because the
 * desired time may still belong to the preceding pair when a new frame arrives.
 *
 * Copies live in a bounded, reusable ring. The application's original frames
 * can be recycled to the physics worker immediately under its existing pool
 * contract; neither delayed drawing nor this history can starve that worker.
 * Recordings, race decisions and physics continue to use the originals.
 *
 * There is no extrapolation. Missing observations hold the newest measured
 * pose. After a substantial worker stall the anchor is rebuilt, and a backlog
 * over MAX_LATENCY is discarded instead of displaying seconds of old driving.
 * Pause exposes the exact final snapshot; resume starts a fresh clock without
 * admitting the wall time spent paused. Rewinds and field changes begin a new
 * history, so an old session can never be blended into its replacement. */
export class LiveFrameClock {
  static readonly DELAY = 1 / 30;
  static readonly MAX_LATENCY = 0.1;
  static readonly CAPACITY = 8;
  private readonly slots: StoredFrame[] = [];
  private first = 0;
  private count = 0;
  private paused = true;
  private originTime = NaN;
  private originWall = 0;
  private shownTime = NaN;
  private lastWall = 0;
  private readonly result: LiveFrameSample = {
    a: new Float32Array(0),
    b: new Float32Array(0),
    alpha: 1,
    auxiliaryA: null,
    auxiliaryB: null,
  };

  get bufferedFrames() {
    return this.count;
  }

  /** Discard the session's timeline while retaining reusable storage. */
  reset() {
    this.clear();
    this.paused = true;
  }

  setPaused(value: boolean) {
    if (this.paused === value) return;
    this.paused = value;
    this.originTime = NaN;
    // A paused final frame is the only valid baseline for the next drive.
    if (this.count) {
      this.first = (this.first + this.count - 1) % LiveFrameClock.CAPACITY;
      this.count = 1;
      this.shownTime = this.slot(0).time;
    }
  }

  /** Retain a snapshot before its original transferable buffer is recycled. */
  observe(frame: Float32Array, wallMs: number, auxiliary: Float32Array | null = null) {
    const cars = frame[H.CARS],
      time = frame[H.TIME];
    if (
      !Number.isFinite(wallMs) ||
      wallMs < 0 ||
      !Number.isFinite(time) ||
      !Number.isInteger(cars) ||
      cars < 1 ||
      cars > 32 ||
      frame.length !== HEADER + cars * CAR_STRIDE
    )
      throw new Error('Invalid live presentation snapshot');

    if (this.count) {
      const latest = this.slot(this.count - 1);
      let replaced = latest.frame.length !== frame.length;
      for (let id = 0; id < cars && !replaced; id++) {
        const vehicle = carBase(id) + RACE_BASE + R.VEHICLE;
        replaced = latest.frame[vehicle] !== frame[vehicle];
      }
      // Equal-time snapshots are explicit pause/command barriers. Their new
      // state is authoritative even when no simulation time has passed.
      if (time <= latest.time || replaced) this.clear();
    }

    if (this.paused && this.count) {
      this.first = (this.first + this.count - 1) % LiveFrameClock.CAPACITY;
      this.count = 0;
    }
    const index = (this.first + this.count) % LiveFrameClock.CAPACITY;
    let stored = this.slots[index];
    if (!stored) {
      stored = { frame: new Float32Array(frame.length), auxiliary: null, time };
      this.slots[index] = stored;
    } else if (stored.frame.length !== frame.length) stored.frame = new Float32Array(frame.length);
    stored.frame.set(frame);
    if (auxiliary) {
      if (stored.auxiliary?.length !== auxiliary.length)
        stored.auxiliary = new Float32Array(auxiliary.length);
      stored.auxiliary.set(auxiliary);
    } else stored.auxiliary = null;
    stored.time = time;
    if (this.count < LiveFrameClock.CAPACITY) this.count++;
    else this.first = (this.first + 1) % LiveFrameClock.CAPACITY;

    if (!Number.isFinite(this.shownTime)) this.shownTime = this.slot(0).time;
    if (!this.paused) {
      const predicted = this.originTime + (wallMs - this.originWall) / 1000 - LiveFrameClock.DELAY;
      // Ordinary arrival jitter never changes the clock rate or phase. A
      // worker whose simulation fell far behind wall time needs a new anchor.
      if (!Number.isFinite(this.originTime) || predicted - time > LiveFrameClock.MAX_LATENCY) {
        this.originTime = time;
        this.originWall = wallMs;
      }
    }
  }

  /** Select measured frames at this display time; the returned object is reused. */
  sample(wallMs: number): LiveFrameSample | null {
    if (!Number.isFinite(wallMs) || wallMs < 0) throw new Error('Invalid live presentation clock');
    if (!this.count) return null;
    const latest = this.slot(this.count - 1);
    if (this.paused || !Number.isFinite(this.originTime)) {
      this.shownTime = latest.time;
      this.lastWall = wallMs;
      return this.select(latest, latest, 1);
    }

    // RAF's supplied timestamp may predate a message handled in the same
    // display turn. Even a regressing caller clock must not rewind the pose.
    const now = Math.max(wallMs, this.lastWall);
    this.lastWall = now;
    let target = this.originTime + (now - this.originWall) / 1000 - LiveFrameClock.DELAY;
    if (latest.time - target > LiveFrameClock.MAX_LATENCY) {
      // A late initial delivery or a long transport backlog should not keep
      // the player watching old input. Rebase only outside the latency budget.
      this.originTime = latest.time;
      this.originWall = now;
      target = latest.time - LiveFrameClock.DELAY;
    }
    this.shownTime = Math.min(latest.time, Math.max(this.shownTime, this.slot(0).time, target));
    if (this.shownTime >= latest.time) return this.select(latest, latest, 1);
    let a = this.slot(0);
    for (let i = 1; i < this.count; i++) {
      const b = this.slot(i);
      if (b.time >= this.shownTime)
        return this.select(a, b, (this.shownTime - a.time) / (b.time - a.time));
      a = b;
    }
    return this.select(a, a, 1);
  }

  private slot(offset: number) {
    return this.slots[(this.first + offset) % LiveFrameClock.CAPACITY];
  }

  private clear() {
    this.first = this.count = 0;
    this.originTime = this.shownTime = NaN;
    this.originWall = this.lastWall = 0;
  }

  private select(a: StoredFrame, b: StoredFrame, alpha: number) {
    this.result.a = a.frame;
    this.result.b = b.frame;
    this.result.alpha = alpha;
    this.result.auxiliaryA = a.auxiliary;
    this.result.auxiliaryB = b.auxiliary;
    return this.result;
  }
}
