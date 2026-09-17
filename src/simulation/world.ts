import { clamp } from '../core/math.ts';
import { AIDriver } from './ai.ts';
import { wakeOverlap } from './aero.ts';
import { CollisionSolver } from './collision.ts';
import { COMPOUNDS, type Controls, type SessionOptions, validateOptions } from './config.ts';
import { CAR_STRIDE, F, H, HEADER, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from './protocol.ts';
import { PHASE, RaceDirector, updatePit } from './race.ts';
import { Track } from './track.ts';
import { Vehicle } from './vehicle.ts';
export class Simulation {
  readonly options: SessionOptions;
  readonly track: Track;
  readonly cars: Vehicle[];
  readonly ai: AIDriver[];
  readonly race: RaceDirector;
  readonly collisions = new CollisionSolver();
  tick = 0;
  autoPlayer = false;
  private pitSpeedClock = 0;
  private pitSpeedPenalized = false;
  constructor(options: SessionOptions) {
    this.options = validateOptions(options);
    this.track = new Track(this.options.weather);
    this.cars = Array.from({ length: this.options.opponents + 1 }, (_, i) => {
      const c = new Vehicle(i, this.options.compound, this.options.setup, this.options.assist);
      c.place(
        this.track,
        this.track.length - 32 - Math.floor(i / 2) * 10,
        i % 2 === 0 ? -2.2 : 2.2,
      );
      return c;
    });
    this.ai = this.cars.map((c) => new AIDriver(c, 0.92 + (c.id % 4) * 0.014, this.options.seed));
    this.race = new RaceDirector(this.cars, this.track, this.options);
    if (this.options.mode === 'practice') {
      this.race.phase = PHASE.RACING;
      this.race.time = this.race.greenAt;
    }
  }
  setInput(input: Controls) {
    const dst = this.cars[0].input;
    dst.throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0;
    dst.brake = Number.isFinite(input.brake) ? clamp(input.brake, 0, 1) : 0;
    dst.steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    dst.shift = Number.isFinite(input.shift) ? Math.sign(input.shift) : 0;
    dst.ers = input.ers === 0 ? 0 : input.ers === 2 ? 2 : 1;
    dst.reverse = !!input.reverse;
  }
  requestPit() {
    const c = this.cars[0];
    c.pitRequested = !c.pitRequested;
    c.nextCompound =
      this.track.meanWater() > 0.85
        ? 'wet'
        : this.track.meanWater() > 0.3
          ? 'intermediate'
          : 'medium';
  }
  step(dt: number) {
    this.tick++;
    const player = this.cars[0];
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (i > 0 || this.autoPlayer || c.pitRequested || c.inPit)
        this.ai[i].update(dt, this.track, this.cars, this.race);
      else if (this.race.phase === PHASE.LIGHTS && c.input.throttle === 0) c.input.brake = 1;
      if (c.finishTime) {
        c.input.throttle = 0;
        c.input.brake = 0.7;
      }
      c.wake = 0;
      for (const other of this.cars)
        if (other !== c)
          c.wake = Math.max(
            c.wake,
            wakeOverlap(c.body.position, other.body.position, other.forward, other.speed),
          );
    }
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, this.track);
      this.collisions.solve(this.cars, this.track);
    }
    for (const c of this.cars) updatePit(c, this.track, dt, this.cars);
    if (player.inPit && player.speed > 23) {
      this.pitSpeedClock += dt;
      if (this.pitSpeedClock > 1 && !this.pitSpeedPenalized) {
        this.race.laps[0].penalty += 5;
        this.pitSpeedPenalized = true;
      }
    } else this.pitSpeedClock = 0;
    if (!player.inPit) this.pitSpeedPenalized = false;
    this.track.evolve(dt, Math.max(0, this.race.time - this.race.greenAt));
    this.race.step(dt);
  }
  writeFrame(out: Float32Array, stepMs = 0, dropped = 0) {
    out[H.TIME] = this.race.time;
    out[H.PHASE] = this.race.phase;
    out[H.RACE_TIME] = this.race.raceTime;
    out[H.LIGHTS] = this.race.lights;
    out[H.RAIN] = this.track.rain;
    out[H.CLOUD] = this.track.cloud;
    out[H.AMBIENT] = this.track.ambient;
    out[H.FLAG] = this.race.flag === 'GREEN' ? 0 : this.race.flag === 'YELLOW' ? 1 : 2;
    out[H.STEP_MS] = stepMs;
    out[H.DROPPED] = dropped;
    out[H.WATER] = this.track.meanWater();
    out[H.TICK] = this.tick;
    out[H.CARS] = this.cars.length;
    out[H.LENGTH] = this.track.length;
    const compounds = Object.keys(COMPOUNDS);
    for (let id = 0; id < this.cars.length; id++) {
      const c = this.cars[id],
        b = c.body,
        t = this.race.laps[id],
        o = carBase(id),
        q = b.orientation;
      const values = [
        b.position.x,
        b.position.y,
        b.position.z,
        q.x,
        q.y,
        q.z,
        q.w,
        b.velocity.x,
        b.velocity.y,
        b.velocity.z,
        b.omega.x,
        b.omega.y,
        b.omega.z,
        c.speed,
        c.steer,
        c.rpm,
        c.gear,
        c.throttle,
        c.brake,
        c.fuel,
        c.battery,
        c.aero.front + c.aero.floor * 0.46,
        c.aero.rear + c.aero.floor * 0.54,
        c.aero.drag,
        c.frontHealth,
        c.floorHealth,
        c.rearHealth,
        c.s,
        c.lateral,
        t.completed,
        t.lapTime,
        t.best,
        t.last,
        t.penalty,
        c.pitPhase,
        Number(c.inPit),
        c.aiTarget,
        c.gLong,
        c.gLat,
        c.gVert,
        this.race.order.indexOf(id) + 1,
        c.finishTime,
        c.wake,
        c.tires.reduce((sum, w) => sum + w.energy, 0),
        c.bottomEnergy,
        c.impact,
        compounds.indexOf(c.tires[0].compound),
        c.pitStops,
      ];
      out.set(values, o);
      for (let i = 0; i < 4; i++) {
        const w = c.tires[i],
          p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        out[p + W.OMEGA] = w.omega;
        out[p + W.LOAD] = w.load;
        out[p + W.FX] = w.fx;
        out[p + W.FY] = w.fy;
        out[p + W.SLIP] = w.slip;
        out[p + W.ANGLE] = w.angle;
        out[p + W.SURFACE_TEMP] = w.surfaceTemp;
        out[p + W.CARCASS_TEMP] = w.carcassTemp;
        out[p + W.WEAR] = w.wear;
        out[p + W.DIRT] = w.dirt;
        out[p + W.COMPRESSION] = w.compression;
        out[p + W.DISC_TEMP] = w.discTemp;
        out[p + W.WATER] = w.water;
        out[p + W.SURFACE] = w.surface;
        out[p + W.ROTATION] = w.rotation;
        out[p + W.FLAT] = w.flatSpot;
      }
    }
    return out;
  }
  makeFrame() {
    return this.writeFrame(new Float32Array(HEADER + this.cars.length * CAR_STRIDE));
  }
}
// Export field constants through protocol.ts; keep the simulation renderer-free.
void F;
