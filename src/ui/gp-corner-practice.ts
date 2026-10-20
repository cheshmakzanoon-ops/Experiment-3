import { clamp, lerp, mod } from '../core/math.ts';
import { gpCornerShapes, isGpCourse } from '../simulation/gp-corner-shape.ts';
import { FLAG } from '../simulation/marshal.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { SURFACE, trackPoint, type Track } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';

export interface GpPracticeContext {
  /** Only free practice banks personal corner attempts. */
  practice: boolean;
  human: boolean;
  replay: boolean;
  assist: string;
}

export interface GpPracticeCorner {
  index: number;
  name: string;
  from: number;
  apex: number;
  length: number;
}

export interface GpCornerAttempt {
  corner: GpPracticeCorner;
  at: number;
  seconds: number;
  exitSpeed: number;
  condition: 'dry' | 'damp' | 'wet';
  delta: number | null;
}

interface Sample {
  time: number;
  s: number;
  speed: number;
  warnings: number;
  penalties: number;
  crashes: number;
  lapValid: number;
  compound: number;
  condition: GpCornerAttempt['condition'];
  valid: boolean;
}

/** Entry and exit match the existing curvature-based corner guide. These are
 * personal timing segments, never an ideal racing line or a target speed.
 * REF015/027/035/083 inform the compact training feedback, not its thresholds. */
export function gpPracticeCorners(track: Track): readonly GpPracticeCorner[] {
  if (!isGpCourse(track)) return [];
  return gpCornerShapes(track).flatMap((shape, index) =>
    shape.direction === 'straight' || shape.entry + shape.exit < 24
      ? []
      : [
          {
            index,
            name: track.circuit.corners[index].name,
            from: mod(track.circuit.corners[index].s - shape.entry, track.length),
            apex: shape.entry,
            length: shape.entry + shape.exit,
          },
        ],
  );
}

/** Session-only observed timings. A complete forward entry/apex/exit is
 * required. Crossings interpolate simulation time, so render rate cannot
 * improve a record. Paused equal-time snapshots do nothing; replay, control
 * handoffs, skipped snapshots and dirty runs cancel only the partial attempt.
 * No controls, physics, rewards, persistent storage or replay frames change. */
export class GpCornerPractice {
  active: {
    corner: GpPracticeCorner;
    elapsed: number;
    progress: number;
    best: number | null;
  } | null = null;
  last: GpCornerAttempt | null = null;
  private readonly best = new Map<string, number>();
  private track: Track | null = null;
  private corners: readonly GpPracticeCorner[] = [];
  private machine = '';
  private previous: Sample | null = null;
  private started = 0;
  private apexSeen = false;
  private key = '';
  private readonly road = trackPoint();

  get eligible() {
    return this.previous?.valid ?? false;
  }

  reset() {
    this.best.clear();
    this.active = this.last = null;
    this.track = null;
    this.machine = '';
    this.previous = null;
  }

  suspend() {
    this.active = null;
    this.previous = null;
  }

  observe(frame: Float32Array, track: Track, context: GpPracticeContext) {
    const o = carBase(0),
      b = o + BIKE_BASE;
    if (frame.length <= b + B.INTERVENTION || !context.practice) {
      this.suspend();
      return;
    }
    const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    const machine = `${definition.id}:${context.assist}`;
    if (track !== this.track || machine !== this.machine) {
      this.reset();
      this.track = track;
      this.corners = gpPracticeCorners(track);
      this.machine = machine;
    }
    if (
      !context.human ||
      context.replay ||
      definition.classId !== 'gp-bike' ||
      !this.corners.length
    ) {
      this.suspend();
      return;
    }
    const front = o + WHEEL_BASE,
      rear = front + 2 * WHEEL_STRIDE;
    const s = frame[o + F.S],
      time = frame[H.TIME],
      speed = frame[o + F.SPEED];
    const lateral = frame[o + F.LATERAL],
      water = Math.max(frame[front + W.WATER], frame[rear + W.WATER]);
    const sample: Sample = {
      s: mod(s, track.length),
      time,
      speed,
      warnings: frame[o + F.WARNINGS],
      penalties: frame[o + F.PENALTY],
      crashes: frame[b + B.CRASHES],
      lapValid: frame[o + F.LAP_VALID],
      compound: frame[o + F.COMPOUND],
      condition: water < 0.03 ? 'dry' : water < 0.2 ? 'damp' : 'wet',
      valid: false,
    };
    if (
      ![
        s,
        time,
        speed,
        lateral,
        water,
        sample.warnings,
        sample.penalties,
        sample.crashes,
        sample.lapValid,
        sample.compound,
      ].every(Number.isFinite)
    ) {
      this.suspend();
      return;
    }
    track.at(s, this.road);
    const forward = frame[o + F.VX] * this.road.tx + frame[o + F.VZ] * this.road.tz;
    sample.valid =
      frame[H.CARS] >= 1 &&
      frame[H.PHASE] === 2 &&
      frame[o + F.LOCAL_FLAG] === FLAG.GREEN &&
      frame[H.SC_PHASE] === 0 &&
      frame[b + B.STATE] === 0 &&
      !frame[o + F.RETIRED] &&
      !frame[o + F.FINISH] &&
      !frame[o + F.IN_PIT] &&
      // A pending pit request hands control to the AI before pit-lane entry.
      frame[o + RACE_BASE + R.NEXT_COMPOUND] < 0 &&
      !frame[o + F.IMPACT] &&
      speed >= 0 &&
      forward >= -0.05 &&
      Math.abs(lateral) + definition.halfExtents[0] <= this.road.width + 0.3 &&
      [front, rear].every(
        (p) =>
          frame[p + W.SURFACE] <= SURFACE.KERB &&
          frame[p + W.SURFACE] >= SURFACE.ASPHALT &&
          !frame[p + W.PUNCTURED],
      );
    const previous = this.previous;
    if (previous && time === previous.time) {
      if (!sample.valid) this.suspend();
      return;
    }
    this.previous = sample;
    if (!previous) return;
    const dt = time - previous.time;
    const distance = mod(sample.s - previous.s + track.length / 2, track.length) - track.length / 2;
    const continuous =
      dt > 0 &&
      dt <= 1.5 &&
      previous.valid &&
      sample.valid &&
      distance >= -0.02 &&
      distance <= Math.max(3, (previous.speed + speed) * 0.5 * dt * 1.6 + 1) &&
      sample.warnings === previous.warnings &&
      sample.penalties === previous.penalties &&
      sample.crashes === previous.crashes &&
      !(previous.lapValid > 0 && sample.lapValid <= 0) &&
      sample.compound === previous.compound &&
      sample.condition === previous.condition;
    if (!continuous) {
      this.active = null;
      return;
    }
    // A stopped bike keeps the clock running instead of winning by waiting.
    if (distance <= 0) {
      if (this.active) this.active.elapsed = time - this.started;
      return;
    }
    // Windows do not overlap. Handle an exit before looking for the next
    // entry, including when one presentation interval crosses both gates.
    if (this.active) this.advance(previous, sample, distance);
    if (!this.active) {
      for (const corner of this.corners) {
        const entry = mod(corner.from - previous.s, track.length);
        if (entry <= 0 || entry > distance) continue;
        this.key = `${corner.index}:${sample.compound}:${sample.condition}`;
        this.started = lerp(previous.time, time, entry / distance);
        this.apexSeen = false;
        this.active = {
          corner,
          elapsed: time - this.started,
          progress: 0,
          best: this.best.get(this.key) ?? null,
        };
        this.advance(previous, sample, distance);
        break;
      }
    }
  }

  private advance(previous: Sample, sample: Sample, distance: number) {
    const active = this.active!;
    const length = this.track!.length,
      corner = active.corner;
    const apex = mod(corner.from + corner.apex - previous.s, length);
    if (apex <= distance) this.apexSeen = true;
    const exit = mod(corner.from + corner.length - previous.s, length);
    active.elapsed = sample.time - this.started;
    active.progress = clamp(mod(sample.s - corner.from, length) / corner.length, 0, 1);
    if (exit > distance) return;
    const at = lerp(previous.time, sample.time, exit / distance),
      seconds = at - this.started;
    if (this.apexSeen && seconds > 0) {
      const best = this.best.get(this.key);
      this.last = {
        corner,
        at,
        seconds,
        exitSpeed: lerp(previous.speed, sample.speed, exit / distance),
        condition: sample.condition,
        delta: best === undefined ? null : seconds - best,
      };
      if (best === undefined || seconds < best) this.best.set(this.key, seconds);
    }
    this.active = null;
  }
}
