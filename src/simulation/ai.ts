import { TrafficPlanner, personality, type DriverPersonality } from './traffic.ts';
import { pitMergeConflict, pitYieldSpeed } from './pit-safety.ts';
import { peakGrip } from './tire.ts';
import { approach, clamp, mod, Vec3 } from '../core/math.ts';
import { VEHICLE } from './config.ts';
import { PHASE, type RaceDirector } from './race.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';
/** Strategic 2 Hz, tactical 12 Hz, controller 120 Hz. All driving uses normal pedals. */
export class AIDriver {
  private target = trackPoint();
  private sample = trackPoint();
  private delta = new Vec3();
  private local = new Vec3();
  private strategyClock = 0;
  private tacticalClock = 0;
  private offset = 0;
  private desiredOffset = 0;
  private trafficSpeed = 100;
  private stuckTime = 0;
  private pitRecovery = false;
  private planner = new TrafficPlanner();
  readonly personality: DriverPersonality;
  decision = 'RACING LINE';
  constructor(
    readonly car: Vehicle,
    readonly skill = 0.96,
    seed = 73021,
  ) {
    this.personality = personality(seed, car.id);
  }
  update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    const c = this.car,
      command = c.input;
    command.shift = 0;
    command.reverse = false;
    command.ers = c.battery < 4e5 ? 0 : 1;
    if (race.phase === PHASE.LIGHTS || race.time < race.greenAt + 0.18 + c.id * 0.016) {
      command.throttle = 0;
      command.brake = 1;
      command.steer = 0;
      return;
    }
    this.strategyClock += dt;
    this.tacticalClock += dt;
    if (this.strategyClock > 0.5) {
      this.strategyClock = 0;
      const wet = track.meanWater(),
        compound = c.tires[0].compound;
      if (
        !c.inPit &&
        c.s < track.length - 250 &&
        ((wet > 0.18 && compound !== 'intermediate' && compound !== 'wet') ||
          c.tires.some((t) => t.wear > 0.67 || t.punctured) ||
          (wet < 0.05 && (compound === 'wet' || compound === 'intermediate')))
      ) {
        c.pitRequested = true;
        c.nextCompound = wet > 0.9 ? 'wet' : wet > 0.16 ? 'intermediate' : 'medium';
      }
    }
    if (this.tacticalClock > 1 / 12) {
      this.tacticalClock = 0;
      const grip = clamp(
        peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38)) / 1.82,
        0.1,
        1,
      );
      const plan = this.planner.evaluate(
        c,
        cars,
        track,
        race.time,
        8.5 * grip,
        this.personality,
        race.flag === 'YELLOW',
      );
      this.desiredOffset = plan.offset;
      this.trafficSpeed = plan.speedLimit;
      this.decision = plan.decision;
    }
    if (!c.inPit) c.pitYielding = false;
    const pit = c.inPit,
      box = 102 + c.id * 7,
      boxGap = mod(box - c.s, track.length);
    this.offset = approach(
      this.offset,
      pit ? this.pitLine(track, c.s) : this.desiredOffset,
      dt * (pit ? 6 : 1.6),
    );
    let lookahead = clamp(6 + c.speed * 0.48, 8, 46);
    if (pit && c.pitPhase === 1 && boxGap < 35)
      lookahead = Math.min(lookahead, Math.max(1, boxGap));
    track.at(c.s + lookahead, this.target);
    const pathOffset = pit ? this.pitLine(track, c.s + lookahead) : this.offset;
    this.delta.set(
      this.target.x + this.target.nx * pathOffset - c.body.position.x,
      0,
      this.target.z + this.target.nz * pathOffset - c.body.position.z,
    );
    c.body.orientation.inverseRotate(this.delta, this.local);
    const purePursuit = Math.atan2(
        2 * VEHICLE.wheelbase * this.local.x,
        Math.max(10, this.local.x * this.local.x + this.local.z * this.local.z),
      ),
      speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
    command.steer = clamp(purePursuit / (VEHICLE.maxSteer * speedSteer), -1, 1);
    let desired = 92 * this.skill;
    const grip = clamp(
        peakGrip(c.tires[0], 2500, c.contacts[0], Math.max(c.speed, 38)) / 1.82,
        0.1,
        1,
      ),
      braking = 8.5 * grip;
    // Backwards braking envelope, not a distance-to-waypoint switch.
    for (let d = 0; d <= 240; d += 12) {
      track.at(c.s + d, this.sample);
      const curvature = this.sample.curvature / (1 - this.sample.curvature * this.offset),
        massFactor = 794 / (VEHICLE.dryMass + c.fuel),
        aeroHealth = 0.45 + 0.55 * Math.min(c.frontHealth, c.floorHealth);
      const corner =
        Math.sqrt(
          ((10.5 + Math.min(11, c.speed * c.speed * 0.0017) * aeroHealth) * grip * massFactor) /
            (Math.abs(curvature) + 0.0001),
        ) * this.skill;
      desired = Math.min(desired, Math.sqrt(corner * corner + 2 * braking * d));
    }
    desired = Math.min(desired, this.trafficSpeed);
    if (race.flag === 'YELLOW') desired *= 0.68;
    if (pit) {
      desired = Math.min(desired, 21.1);
      if (c.s > track.length - 225 || (c.s > 210 && c.s < 335))
        desired = Math.min(desired, 9 + 5 * grip);
      const distance = mod(102 + c.id * 7 - c.s, track.length);
      if (c.pitPhase === 1 && distance < 125)
        desired = Math.min(
          desired,
          Math.sqrt(Math.max(0, distance - 1.8) * 2 * Math.max(1.1, 4.5 * grip)),
        );
      if (c.pitPhase >= 2 && c.pitPhase <= 5) desired = 0;
      this.decision = 'PIT SERVICE';
      c.pitYielding = pitMergeConflict(c, cars, track);
      if (c.pitYielding) {
        desired = Math.min(desired, pitYieldSpeed(c, true, braking));
        this.decision = 'YIELD AT PIT EXIT';
      }
      for (const other of cars) {
        if (other === c || !other.inPit || Math.abs(other.lateral - c.lateral) > 2.7) continue;
        const gap = mod(other.s - c.s, track.length);
        if (gap > 0 && gap < 80)
          desired = Math.min(
            desired,
            Math.sqrt(other.speed ** 2 + 2 * Math.max(1, braking * 0.7) * Math.max(0, gap - 7)),
          );
      }
    }
    const lateralError = Math.abs(c.lateral - (pit ? this.pitLine(track, c.s) : this.offset));
    if (lateralError > 4) desired = Math.min(desired, Math.max(10, 34 - lateralError * 2));
    c.aiTarget = desired;
    c.aiOffset = pathOffset;
    const error = desired - c.speed;
    command.throttle = clamp(error * 0.25 + 0.13, 0, 1);
    command.brake = clamp(-error * 0.18, 0, 1);
    if (desired < 0.15) {
      command.throttle = 0;
      command.brake = 1;
    }
    if (c.speed < 0.7 && desired > 6) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 5 && this.stuckTime < 9) {
      command.reverse = true;
      command.throttle = 0.25;
      command.brake = 0;
      command.steer = -command.steer;
      this.decision = 'RECOVERY';
    }
    if (this.stuckTime >= 10) this.stuckTime = 0;
    if (pit && c.pitPhase === 1 && c.s > box + 2 && c.s < box + 40) this.pitRecovery = true;
    if (this.pitRecovery) {
      this.decision = 'PIT BOX RECOVERY';
      command.steer = clamp((c.lateral - 24.1) * 0.12, -0.3, 0.3);
      if (c.pitPhase !== 1) {
        this.pitRecovery = false;
        command.reverse = false;
      } else if (c.s - box < 1.5) {
        command.throttle = 0;
        command.brake = 1;
        command.reverse = true;
      } else if (c.gear >= 0 && c.speed > 0.3) {
        command.throttle = 0;
        command.brake = 1;
      } else {
        command.reverse = true;
        command.throttle = c.speed < 2.5 ? 0.14 : 0;
        command.brake = c.speed > 3 ? 0.25 : 0;
      }
    }
  }
  private pitLine(track: Track, s: number) {
    const base = track.pitOffset(s),
      c = this.car,
      box = 102 + c.id * 7,
      gap = mod(box - s, track.length);
    const service =
      c.pitPhase >= 2 && c.pitPhase <= 5
        ? 1
        : c.pitPhase === 1
          ? s > box && s < box + 40
            ? 1
            : clamp((55 - gap) / 45, 0, 1)
          : 0;
    return base + (-1.5 + service * 3.6) * clamp(base / 22, 0, 1);
  }
}
