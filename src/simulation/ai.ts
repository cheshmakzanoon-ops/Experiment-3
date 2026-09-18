import { DriverBrain } from './driver-brain.ts';
import { FLAG, yellowFlag } from './marshal.ts';
import { TrafficPlanner, personality, type DriverPersonality } from './traffic.ts';
import {
  pitMergeConflict,
  pitYieldSpeed,
  pitPreparationDistance,
  pitApproachTrafficSpeed,
} from './pit-safety.ts';
import { peakGrip } from './tire.ts';
import { approach, clamp, mod, Vec3 } from '../core/math.ts';
import { VEHICLE } from './config.ts';
import { PHASE, type RaceDirector } from './race.ts';
import { trackPoint, type Track } from './track.ts';
import type { Vehicle } from './vehicle.ts';
/** Strategic 2 Hz, tactical 12 Hz, controller 120 Hz. All driving uses normal pedals. */
/** Braking envelope with explicit controller response distance. Solving
 * d = v*tau + v²/(2a) keeps a finite-bandwidth pedal controller inside its stop.
 */
export function stoppingTarget(distance: number, deceleration: number, responseSeconds = 0.8) {
  const a = Math.max(0.1, deceleration);
  return (
    Math.sqrt((a * responseSeconds) ** 2 + 2 * a * Math.max(0, distance)) - a * responseSeconds
  );
}
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
  private preparingPit = false;
  private planner = new TrafficPlanner();
  readonly personality: DriverPersonality;
  readonly brain: DriverBrain;
  decision = 'RACING LINE';
  constructor(
    readonly car: Vehicle,
    readonly skill = 0.96,
    seed = 73021,
  ) {
    this.personality = personality(seed, car.id);
    this.brain = new DriverBrain(this.personality, seed, car.id);
  }
  update(dt: number, track: Track, cars: Vehicle[], race: RaceDirector) {
    const c = this.car,
      command = c.input;
    command.shift = 0;
    command.manualClutch = false;
    command.clutch = 0;
    command.reverse = false;
    command.ers = this.brain.ers;
    if (race.phase === PHASE.LIGHTS || race.time < race.greenAt + this.brain.reactionSeconds) {
      command.throttle = 0;
      command.brake = 1;
      command.steer = 0;
      return;
    }
    this.strategyClock += dt;
    this.tacticalClock += dt;
    if (this.strategyClock >= 0.5) {
      this.brain.update(this.strategyClock, c, cars, track, race);
      this.strategyClock = 0;
      command.ers = this.brain.ers;
    }
    const entryGap = mod(track.length - 210 - c.s, track.length);
    // Once preparation starts, slower speed must not shrink its lookahead and
    // cancel the lane change. Only crossing/missing the entry ends this intent.
    if (!c.pitRequested || c.inPit || entryGap > track.length - 20) this.preparingPit = false;
    else if (entryGap < pitPreparationDistance(c.speed, c.lateral)) this.preparingPit = true;
    const preparingPit = this.preparingPit;
    if (this.tacticalClock > 1 / 12 && !c.inPit) {
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
        yellowFlag(race.control.flags[c.id]),
        preparingPit ? 6 : this.brain.preferredLine(c, cars, track, race),
        preparingPit,
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
    if (!c.inPit) desired = Math.min(desired * this.brain.pace, this.trafficSpeed);
    if (c.finishTime) desired = Math.min(desired, 38);
    if (preparingPit)
      desired = Math.min(
        desired,
        Math.sqrt(14 * 14 + 2 * braking * 0.85 * Math.max(0, entryGap - 30)),
      );
    if (preparingPit) {
      const yielding = pitApproachTrafficSpeed(c, cars, track, this.desiredOffset);
      if (yielding < desired) {
        desired = yielding;
        this.decision = 'YIELD FOR PIT APPROACH';
      }
    }
    desired = Math.min(desired, race.control.targetSpeed(c.id, braking * 0.7));
    if (race.control.flags[c.id] === FLAG.BLUE && c.speed > 10)
      desired = Math.min(desired, c.speed * 0.94);
    if (yellowFlag(race.control.flags[c.id])) {
      this.decision = 'LOCAL CAUTION / NO OVERTAKING';
      command.ers = 0;
    }
    if (pit) {
      desired = Math.min(desired, 21.1);
      if (c.s > track.length - 225 || (c.s > 210 && c.s < 335))
        desired = Math.min(desired, 9 + 5 * grip);
      const distance = mod(102 + c.id * 7 - c.s, track.length);
      if (c.pitPhase === 1 && distance < 125)
        desired = Math.min(desired, stoppingTarget(distance - 1.8, Math.max(1.1, 4.5 * grip)));
      if (c.pitPhase >= 2 && c.pitPhase <= 5) desired = 0;
      this.decision = 'PIT SERVICE';
      c.pitYielding = pitMergeConflict(c, cars, track);
      if (c.pitYielding) {
        desired = Math.min(desired, pitYieldSpeed(c, true, braking));
        this.decision = 'YIELD AT PIT EXIT';
      }
      for (const other of cars) {
        if (other === c || !other.inPit) continue;
        const gap = mod(other.s - c.s, track.length);
        // Fast-lane traffic queues in longitudinal order. A service-bay car
        // also blocks if our upcoming bay approach would sweep into it, even
        // while our current lateral separation still looks harmless.
        const conflict =
          other.pitPhase === 1 ||
          other.pitPhase === 6 ||
          Math.abs(other.lateral - c.lateral) < 2.7 ||
          Math.abs(other.lateral - this.pitLine(track, other.s)) < 3;
        if (conflict && gap > 0 && gap < 80)
          desired = Math.min(
            desired,
            Math.sqrt(
              Math.max(
                0,
                other.speed ** 2 + 2 * Math.max(1, braking * 0.7) * (gap - 7 - c.speed * 0.75),
              ),
            ),
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
    if (!pit && c.speed < 0.7 && desired > 6) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 5 && this.stuckTime < 9) {
      command.reverse = true;
      command.throttle = 0.25;
      command.brake = 0;
      command.steer = -command.steer;
      this.decision = 'RECOVERY';
    }
    if (this.stuckTime >= 10) this.stuckTime = 0;
    this.brain.errors.apply(
      dt,
      command,
      !pit &&
        !preparingPit &&
        !c.finishTime &&
        !c.retired &&
        !command.reverse &&
        race.control.flags[c.id] === FLAG.GREEN &&
        desired > 15 &&
        this.trafficSpeed > c.speed + 2,
    );
    // A missed service box is a drive-through, not a reverse maneuver across
    // queued cars. Preserve the request so the next lawful entry retries it.
    if (pit && c.pitPhase === 1 && c.s > box + 2.4 && c.s < box + 80) {
      c.pitPhase = 6;
      c.pitRequested = true;
      command.reverse = false;
      this.decision = 'MISSED BOX / RETRY NEXT LAP';
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
    const offset = base + (-1.5 + service * 3.6) * clamp(base / 22, 0, 1);
    return s > track.length - 235 ? Math.max(6, offset) : offset;
  }
}
