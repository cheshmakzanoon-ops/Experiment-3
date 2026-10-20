import { clamp } from '../core/math.ts';
import { chassisLean } from '../simulation/bike-definitions.ts';
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
import { SURFACE } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';

export type GpMomentKind =
  | 'knee'
  | 'elbow'
  | 'stop'
  | 'wheelie'
  | 'stoppie'
  | 'overtake'
  | 'top-speed'
  | 'reset';

export interface GpMoment {
  kind: GpMomentKind;
  /** Simulation time of the snapshot that completed the moment (s). */
  at: number;
  title: string;
  detail: string;
  /** Points banked (after the flow multiplier); 0 for informational moments. */
  points: number;
  /** Flow multiplier after this moment. */
  flow: number;
}

/** Authored thresholds. REF 004/027/030/060 show knee and elbow contact at
 * extreme lean; REF 052/092 a late, hard stop; REF 046/087 a power wheelie.
 * They are presentation thresholds, not tyre limits or scoring of the AI. */
export const GP_MOMENTS = Object.freeze({
  /** Chassis lean (deg) for knee and elbow contact, and to end a corner. */
  knee: 50,
  elbow: 59,
  upright: 22,
  /** Speed lost (km/h) in one continuous front-brake application. */
  stop: 140,
  brakeOn: 0.45,
  brakeOff: 0.12,
  /** Nose-up / nose-down pitch (rad) and minimum wheelie time (s). */
  wheelie: 0.08,
  stoppie: -0.05,
  wheelieSeconds: 0.45,
  /** A moment within this window of the previous one raises the flow. */
  flowWindow: 9,
  flowMax: 5,
  points: Object.freeze({
    knee: 100,
    elbow: 250,
    stop: 150,
    wheelie: 120,
    stoppie: 160,
    overtake: 300,
  }),
});

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** Highlights of the player's own riding, read from original worker snapshots
 * (never interpolated presentation), so HUD cadence cannot change a result.
 * Edges are detected between consecutive snapshots of increasing simulation
 * time; a reversal (replay seek, restart) clears the partial state. Points
 * are a light-hearted flow score for a human rider only and never affect the
 * simulation, the AI, lap validity or classification. */
export class GpRideMoments {
  readonly moments: GpMoment[] = [];
  score = 0;
  flow = 1;
  best = { lean: 0, speed: 0 };
  private lastTime = -Infinity;
  private lastMomentAt = -Infinity;
  private corner = { peak: 0, knee: false, elbow: false };
  private brake: { from: number; at: number } | null = null;
  private wheelie: { from: number; peak: number; sign: number } | null = null;
  private rank = 0;
  private straight = { peak: 0, at: 0 };
  private offTrack = false;

  reset() {
    this.moments.length = 0;
    this.score = 0;
    this.flow = 1;
    this.best = { lean: 0, speed: 0 };
    this.suspend();
  }

  /** Abandon partial corners/stops (replay, photo, pit, rider down). */
  suspend() {
    this.lastTime = -Infinity;
    this.corner = { peak: 0, knee: false, elbow: false };
    this.brake = null;
    this.wheelie = null;
    this.rank = 0;
    this.straight = { peak: 0, at: 0 };
    this.offTrack = false;
  }

  /** The most recent moment still on screen at `time`, if any. */
  latest(time: number, seconds = 2.6) {
    const moment = this.moments[this.moments.length - 1];
    return moment && time >= moment.at && time - moment.at < seconds ? moment : null;
  }

  observe(frame: Float32Array, context: { live: boolean; human: boolean }) {
    const o = carBase(0),
      b = o + BIKE_BASE,
      time = finite(frame[H.TIME], NaN);
    const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    if (!context.live || !definition.bike || definition.classId !== 'gp-bike') {
      this.suspend();
      return;
    }
    if (!Number.isFinite(time) || time < this.lastTime) {
      this.suspend();
      if (!Number.isFinite(time)) return;
    }
    if (time === this.lastTime) return;
    const first = this.lastTime === -Infinity;
    this.lastTime = time;
    const riding = Math.round(frame[b + B.STATE]) === 0,
      inPit = frame[o + F.IN_PIT] > 0,
      speed = Math.max(0, finite(frame[o + F.SPEED])) * 3.6,
      lean = Math.abs((chassisLean(finite(frame[b + B.LEAN]), definition.bike) * 180) / Math.PI),
      pitch = finite(frame[b + B.PITCH]),
      brake = clamp(finite(frame[o + F.BRAKE]), 0, 1),
      rank = Math.round(finite(frame[o + F.RANK])),
      cars = Math.round(finite(frame[H.CARS]));
    if (!riding || inPit) {
      // A fall or a pit visit ends the flow; restart quietly on the next run.
      if (!riding && this.flow > 1) this.emit('reset', time, 'FLOW LOST', 'Rider down', 0, context);
      this.flow = 1;
      this.suspend();
      this.lastTime = time;
      return;
    }
    const wheels = [0, 2].map((w) => frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.SURFACE]);
    const off = wheels.some((s) => s === SURFACE.GRASS || s === SURFACE.GRAVEL);
    if (off && !this.offTrack && this.flow > 1)
      this.emit('reset', time, 'FLOW LOST', 'Off the track', 0, context);
    if (off) this.flow = 1;
    this.offTrack = off;

    // ---- Corner: knee/elbow contact once per bend, peak lean at the exit.
    this.corner.peak = Math.max(this.corner.peak, lean);
    if (!off && lean >= GP_MOMENTS.knee) this.corner.knee = true;
    if (!off && lean >= GP_MOMENTS.elbow) this.corner.elbow = true;
    if (lean < GP_MOMENTS.upright && this.corner.peak > 0) {
      const peak = Math.round(this.corner.peak);
      if (this.corner.elbow)
        this.emit('elbow', time, 'ELBOW DOWN', `${peak}° lean`, GP_MOMENTS.points.elbow, context);
      else if (this.corner.knee)
        this.emit('knee', time, 'KNEE DOWN', `${peak}° lean`, GP_MOMENTS.points.knee, context);
      if (this.corner.knee) this.best.lean = Math.max(this.best.lean, peak);
      this.corner = { peak: 0, knee: false, elbow: false };
    }

    // ---- One continuous hard stop: entry speed to release speed.
    if (!this.brake && brake >= GP_MOMENTS.brakeOn) this.brake = { from: speed, at: time };
    else if (this.brake) {
      // The lever can lead the speed peak by a snapshot or two.
      if (time - this.brake.at < 0.2) this.brake.from = Math.max(this.brake.from, speed);
      if (brake <= GP_MOMENTS.brakeOff) {
        const lost = this.brake.from - speed;
        if (lost >= GP_MOMENTS.stop && !off)
          this.emit(
            'stop',
            time,
            'HARD STOP',
            `${Math.round(this.brake.from)} → ${Math.round(speed)} km/h`,
            GP_MOMENTS.points.stop,
            context,
          );
        this.brake = null;
      }
    }

    // ---- Wheelie (power) or stoppie (brakes), banked when the wheel lands.
    const lifted = pitch >= GP_MOMENTS.wheelie ? 1 : pitch <= GP_MOMENTS.stoppie ? -1 : 0;
    if (lifted && (!this.wheelie || this.wheelie.sign !== lifted))
      this.wheelie = { from: time, peak: Math.abs(pitch), sign: lifted };
    else if (lifted && this.wheelie)
      this.wheelie.peak = Math.max(this.wheelie.peak, Math.abs(pitch));
    else if (!lifted && this.wheelie) {
      const seconds = time - this.wheelie.from;
      if (this.wheelie.sign > 0 && seconds >= GP_MOMENTS.wheelieSeconds)
        this.emit(
          'wheelie',
          time,
          'WHEELIE',
          `${seconds.toFixed(1)} s · ${Math.round((this.wheelie.peak * 180) / Math.PI)}°`,
          GP_MOMENTS.points.wheelie,
          context,
        );
      else if (this.wheelie.sign < 0 && seconds >= 0.2)
        this.emit(
          'stoppie',
          time,
          'STOPPIE',
          `${Math.round((this.wheelie.peak * 180) / Math.PI)}° rear lift`,
          GP_MOMENTS.points.stoppie,
          context,
        );
      this.wheelie = null;
    }

    // ---- Places gained on track (rank 1 = leader). Not on the first frame.
    if (cars > 1 && rank >= 1) {
      if (!first && this.rank && rank < this.rank && !off)
        this.emit(
          'overtake',
          time,
          'OVERTAKE',
          `Up to P${rank} of ${cars}`,
          GP_MOMENTS.points.overtake * (this.rank - rank),
          context,
        );
      this.rank = rank;
    }

    // ---- Session top speed, announced as the bike leaves the straight.
    if (speed > this.straight.peak) this.straight = { peak: speed, at: time };
    if (brake >= GP_MOMENTS.brakeOn && this.straight.peak > 0) {
      const peak = Math.round(this.straight.peak);
      if (peak >= 250 && peak > this.best.speed + 1) {
        this.best.speed = peak;
        this.emit('top-speed', time, 'TOP SPEED', `${peak} km/h · session best`, 0, context);
      }
      this.straight = { peak: 0, at: time };
    }
  }

  private emit(
    kind: GpMomentKind,
    at: number,
    title: string,
    detail: string,
    base: number,
    context: { human: boolean },
  ) {
    let points = 0;
    if (kind === 'reset') this.flow = 1;
    else if (base > 0) {
      if (at - this.lastMomentAt <= GP_MOMENTS.flowWindow)
        this.flow = Math.min(GP_MOMENTS.flowMax, this.flow + 1);
      else this.flow = 1;
      this.lastMomentAt = at;
      points = context.human ? base * this.flow : 0;
      this.score += points;
    }
    this.moments.push({ kind, at, title, detail, points, flow: this.flow });
    if (this.moments.length > 24) this.moments.splice(0, this.moments.length - 24);
  }
}
