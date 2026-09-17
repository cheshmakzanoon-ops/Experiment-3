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
  constructor(
    readonly length: number,
    s: number,
  ) {
    this.lastS = s;
    this.distance = s - length;
  }
  update(s: number, time: number, offTrack: boolean) {
    const delta = mod(s - this.lastS + this.length / 2, this.length) - this.length / 2;
    this.distance += delta;
    if (delta > 0 && delta < 15) {
      const gate = (this.nextGate * this.length) / 8,
        travelToGate = mod(gate - this.lastS, this.length);
      if (travelToGate > 1e-7 && travelToGate <= delta + 1e-7) {
        if (this.nextGate === 0) {
          if (this.active) {
            this.completed++;
            this.last = time - this.lapStart;
            if (this.valid && (this.best === 0 || this.last < this.best)) this.best = this.last;
          }
          this.active = true;
          this.valid = true;
          this.lapStart = time;
          this.sectorStart = time;
          this.sector = 0;
          this.sectors = [0, 0, 0];
        }
        this.nextGate = (this.nextGate + 1) % 8;
      }
      if (this.active) {
        const sector = Math.min(2, Math.floor((s / this.length) * 3));
        if (sector > this.sector) {
          this.sectors[this.sector] = time - this.sectorStart;
          this.sectorStart = time;
          this.sector = sector;
        }
      }
    }
    if (offTrack) this.valid = false;
    this.lapTime = this.active ? time - this.lapStart : 0;
    this.lastS = s;
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
export class RaceDirector {
  phase: number = PHASE.GRID;
  time = 0;
  raceTime = 0;
  lights = 0;
  readonly greenAt: number;
  readonly laps: LapTracker[];
  readonly order: number[];
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
  }
  step(dt: number) {
    this.time += dt;
    if (this.phase === PHASE.GRID) this.phase = PHASE.LIGHTS;
    if (this.phase === PHASE.LIGHTS) {
      this.lights = Math.min(5, Math.floor(this.time));
      for (let i = 0; i < this.cars.length; i++) {
        const lap = this.laps[i],
          c = this.cars[i];
        if (c.speed > 0.8 && !lap.jumped && this.time < this.greenAt) {
          lap.jumped = true;
          lap.penalty += 5;
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
    let incident = false;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i],
        lap = this.laps[i],
        outside = !c.inPit && c.contacts.every((s) => Math.abs(s.lateral) > 9.7);
      lap.limits(outside, dt);
      lap.update(c.s, this.raceTime, outside);
      if (c.impact > 0.18 || c.retired) incident = true;
      if (c.finishTime === 0 && lap.completed >= this.options.laps && this.options.mode === 'race')
        c.finishTime = this.raceTime + lap.penalty;
    }
    this.flag = incident ? 'YELLOW' : 'GREEN';
    this.order.sort((a, b) => {
      const ca = this.cars[a],
        cb = this.cars[b];
      if (ca.finishTime && cb.finishTime) return ca.finishTime - cb.finishTime;
      if (ca.finishTime) return -1;
      if (cb.finishTime) return 1;
      return this.laps[b].distance - this.laps[a].distance;
    });
    if (this.cars[0].finishTime) {
      this.phase = PHASE.FINISHED;
      this.flag = 'CHEQUERED';
      this.message = 'CHEQUERED FLAG';
    } else if (this.time > this.nextMessage)
      this.message = incident
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
  if (car.pitRequested && !car.inPit && car.s > track.length - 210) {
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
      car.frontHealth = Math.min(1, car.frontHealth + dt * 0.3);
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
