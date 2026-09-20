import { LapReference } from './lap-reference.ts';
import { MarshalControl } from './marshal.ts';
import { safePitRelease } from './pit-safety.ts';
import { mod, Random } from '../core/math.ts';
import type { SessionOptions } from './config.ts';
import type { Vehicle } from './vehicle.ts';
import type { Track } from './track.ts';
export const PHASE = { GRID: 0, LIGHTS: 1, RACING: 2, FINISHED: 3 } as const;
export class LapTracker {
  completed = 0;
  active = false;
  valid = true;
  nextGate = 0;
  lastS: number;
  distance = 0;
  lapStart = 0;
  lapTime = 0;
  best = 0;
  last = 0;
  penalty = 0;
  warnings = 0;
  outsideTime = 0;
  outsideEpisode = false;
  jumped = false;
  sector = 0;
  sectors = [0, 0, 0];
  sectorStart = 0;
  lastTime = 0;
  lastCrossingTime = 0;
  crossedFinish = false;
  lastValid = false;
  assisted = false;
  lastAssisted = false;
  lastPenalty = 0;
  private penaltyAtLapStart = 0;
  readonly lastSectors = [0, 0, 0];
  readonly reference: LapReference;
  constructor(
    readonly length: number,
    s: number,
  ) {
    this.lastS = s;
    this.distance = s - length;
    this.reference = new LapReference(length);
  }
  update(s: number, time: number, offTrack: boolean) {
    if (!Number.isFinite(s + time) || time < this.lastTime)
      throw new Error('Invalid timing sample');
    this.crossedFinish = false;
    const delta = mod(s - this.lastS + this.length / 2, this.length) - this.length / 2;
    const elapsed = time - this.lastTime;
    if (Math.abs(delta) < 15) this.distance += delta;
    else this.valid = false; // Discontinuous location changes cannot earn progress.
    if (offTrack) this.valid = false;
    if (delta > 0 && delta < 15) {
      const crossingTime = (distance: number) => this.lastTime + (elapsed * distance) / delta;
      if (this.active) {
        const end = Math.min(this.length, this.lastS + delta);
        this.reference.observe(this.lastS, end, this.lastTime, crossingTime(end - this.lastS));
      }
      const gate = (this.nextGate * this.length) / 8;
      const travelToGate = mod(gate - this.lastS, this.length);
      if (travelToGate > 1e-7 && travelToGate <= delta + 1e-7) {
        if (this.nextGate === 0) {
          const crossing = crossingTime(travelToGate);
          if (this.active) {
            this.completed++;
            this.crossedFinish = true;
            this.lastCrossingTime = crossing;
            this.last = crossing - this.lapStart;
            this.lastSectors[0] = this.sectors[0];
            this.lastSectors[1] = this.sectors[1];
            this.lastSectors[2] = crossing - this.sectorStart;
            this.lastValid = this.valid;
            this.lastAssisted = this.assisted;
            this.lastPenalty = this.penalty - this.penaltyAtLapStart;
            const improved = this.valid && (this.best === 0 || this.last < this.best);
            this.reference.finish(this.last, improved);
            if (improved) this.best = this.last;
          }
          this.assisted = false;
          this.penaltyAtLapStart = this.penalty;
          this.active = true;
          this.valid = !offTrack;
          this.lapStart = crossing;
          this.reference.start(crossing);
          this.reference.observe(0, s, crossing, time);
          this.sectorStart = crossing;
          this.sector = 0;
          this.sectors.fill(0);
        }
        this.nextGate = (this.nextGate + 1) % 8;
      }
      if (this.active && this.sector < 2) {
        const nextSector = ((this.sector + 1) * this.length) / 3;
        const travel = mod(nextSector - this.lastS, this.length);
        if (travel > 1e-7 && travel <= delta + 1e-7) {
          const crossing = crossingTime(travel);
          this.sectors[this.sector] = crossing - this.sectorStart;
          this.sectorStart = crossing;
          this.sector++;
        }
      }
    }
    this.lapTime = this.active ? time - this.lapStart : 0;
    this.lastS = s;
    this.lastTime = time;
  }
  limits(outside: boolean, dt: number) {
    if (outside) {
      this.outsideTime += dt;
      if (this.outsideTime > 0.4 && !this.outsideEpisode) {
        this.warnings++;
        this.valid = false;
        this.outsideEpisode = true;
        if (this.warnings % 4 === 0) this.penalty += 5;
      }
    } else {
      this.outsideTime = 0;
      this.outsideEpisode = false;
    }
  }
  invalidate() {
    this.valid = false;
  }
}
/** A tire counts as on track while any of its tread width overlaps the outer
 * paint edge. Kerbs/runoff beyond that edge do not extend legal track width.
 * Each wheel queries its own local ribbon width, rather than the chassis centre.
 */
export function outsideTrack(car: Vehicle): boolean {
  return (
    !car.inPit &&
    car.contacts.every(
      (surface, i) => Math.abs(surface.lateral) - (i < 2 ? 0.155 : 0.19) > surface.width + 1e-6,
    )
  );
}
export const FINISH_GRACE_SECONDS = 180;
export class RaceDirector {
  phase: number = PHASE.GRID;
  time = 0;
  raceTime = 0;
  lights = 0;
  finishStartedAt = -1;
  readonly greenAt: number;
  readonly laps: LapTracker[];
  readonly order: number[];
  readonly control: MarshalControl;
  flag: 'GREEN' | 'YELLOW' | 'CHEQUERED' = 'GREEN';
  message = 'SYSTEMS READY';
  private nextMessage = 0;
  constructor(
    readonly cars: Vehicle[],
    readonly track: Track,
    readonly options: SessionOptions,
  ) {
    this.greenAt = 5.6 + new Random(options.seed).next() * 0.9;
    this.laps = cars.map((c) => new LapTracker(track.length, c.s));
    this.order = cars.map((c) => c.id);
    this.control = new MarshalControl(track.length, cars.length, (car, seconds, code) =>
      this.penalize(car, seconds, code),
    );
  }
  penalize(car: number, seconds: number, code: string) {
    this.laps[car].penalty += seconds;
    if (this.cars[car].finishTime > 0) this.cars[car].finishTime += seconds;
    this.control.recordPenalty(car, seconds, code, this.raceTime);
  }
  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid race timestep');
    if (this.phase === PHASE.FINISHED) return;
    this.time += dt;
    if (this.phase === PHASE.GRID) this.phase = PHASE.LIGHTS;
    if (this.phase === PHASE.LIGHTS) {
      this.lights = Math.min(5, Math.floor(this.time));
      for (let i = 0; i < this.cars.length; i++) {
        const lap = this.laps[i],
          c = this.cars[i];
        if (c.speed > 0.8 && !lap.jumped && this.time < this.greenAt) {
          lap.jumped = true;
          this.penalize(i, 5, 'JUMP_START');
          this.message = 'JUMP START · +5 SECONDS';
          this.nextMessage = this.time + 5;
        }
      }
      if (this.time >= this.greenAt) {
        this.phase = PHASE.RACING;
        this.lights = 0;
        this.message = 'GREEN FLAG';
        this.nextMessage = this.time + 5;
      }
    }
    if (this.phase !== PHASE.RACING) return;
    this.raceTime = this.time - this.greenAt;
    this.control.update(dt, this.raceTime, this.cars, this.laps);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i],
        lap = this.laps[i];
      lap.crossedFinish = false;
      if (!c.finishTime && !c.retired) {
        const outside = outsideTrack(c);
        const previousPenalty = lap.penalty;
        lap.limits(outside, dt);
        if (lap.penalty > previousPenalty)
          this.control.recordPenalty(
            i,
            lap.penalty - previousPenalty,
            'TRACK_LIMITS',
            this.raceTime,
          );
        lap.update(c.s, this.raceTime, outside);
      }
    }
    if (this.options.mode === 'race') {
      // Resolve the first finisher by interpolated crossing time, not array order.
      if (this.finishStartedAt < 0) {
        let earliest = Infinity;
        for (const lap of this.laps)
          if (lap.crossedFinish && lap.completed >= this.options.laps)
            earliest = Math.min(earliest, lap.lastCrossingTime);
        if (Number.isFinite(earliest)) this.finishStartedAt = earliest;
      }
      if (this.finishStartedAt >= 0) {
        for (let i = 0; i < this.cars.length; i++) {
          const car = this.cars[i],
            lap = this.laps[i];
          if (
            !car.finishTime &&
            !car.retired &&
            lap.crossedFinish &&
            lap.lastCrossingTime >= this.finishStartedAt - 1e-8
          )
            car.finishTime = lap.lastCrossingTime + lap.penalty;
          else if (!car.finishTime && this.raceTime - this.finishStartedAt >= FINISH_GRACE_SECONDS)
            car.retired = true; // Explicit DNF, never a manufactured finishing time.
        }
      }
      if (this.cars.every((c) => c.finishTime > 0 || c.retired)) {
        this.control.settlePending(this.cars);
        this.phase = PHASE.FINISHED;
      }
    }
    this.order.sort((a, b) => {
      const ca = this.cars[a],
        cb = this.cars[b];
      const difference = this.laps[b].completed - this.laps[a].completed;
      if (difference) return difference;
      if (ca.finishTime && cb.finishTime) return ca.finishTime - cb.finishTime || a - b;
      if (ca.finishTime) return -1;
      if (cb.finishTime) return 1;
      return this.laps[b].distance - this.laps[a].distance || a - b;
    });
    this.flag =
      this.finishStartedAt >= 0 || this.phase === PHASE.FINISHED
        ? 'CHEQUERED'
        : this.control.hasIncident
          ? 'YELLOW'
          : 'GREEN';
    if (this.phase === PHASE.FINISHED) this.message = 'SESSION COMPLETE';
    else if (this.finishStartedAt >= 0) this.message = 'CHEQUERED FLAG · FIELD FINISHING';
    else if (this.time > this.nextMessage)
      this.message = this.control.hasIncident
        ? 'YELLOW · INCIDENT AHEAD'
        : this.cars[0].inPit
          ? 'PIT LANE · 80 KM/H'
          : this.laps[0].outsideEpisode
            ? 'TRACK LIMITS · LAP INVALID'
            : 'GREEN FLAG';
  }
}
/** Service requires physically reaching the box and stopping; never teleports. */
export function updatePit(
  car: Vehicle,
  track: Track,
  dt: number,
  traffic: readonly Vehicle[] = [],
) {
  const box = 102 + car.id * 7;
  const entry = track.length - 210;
  const crossedEntry = car.pitLastS < entry && car.s >= entry && car.s - car.pitLastS < 15;
  car.pitLastS = car.s;
  if (car.pitRequested && !car.inPit && crossedEntry && car.lateral > 1.5) {
    car.inPit = true;
    car.pitPhase = 1;
  }
  if (!car.inPit) return;
  if (
    car.pitPhase === 1 &&
    Math.abs(car.s - box) < 2.4 &&
    Math.abs(car.lateral - 24.1) < 1.9 &&
    car.speed < 0.35
  ) {
    car.pitPhase = 2;
    car.pitClock = 0;
  }
  if (car.pitPhase >= 2 && car.pitPhase <= 5) {
    car.pitClock += dt;
    if (car.pitClock < 0.8) car.pitPhase = 2;
    else if (car.pitClock < 2.2) car.pitPhase = 3;
    else if (car.pitClock < 3.5) {
      if (car.pitPhase === 3) car.replaceTires(car.nextCompound);
      car.pitPhase = 4;
    } else if (car.pitClock < 5.2) {
      car.pitPhase = 5;
      car.repairFrontWing(dt);
    } else if (safePitRelease(car, traffic, track)) {
      car.pitPhase = 6;
      car.pitStops++;
      car.pitRequested = false;
    }
  }
  if (car.pitPhase === 6 && car.s > 330 && car.s < track.length - 250) {
    car.inPit = false;
    car.pitPhase = 0;
  }
}
