import { clamp, smooth } from '../../core/math.ts';

/** Unit displacement of the existing flexible mudguard mesh and its rate (s⁻¹).
 * The clamp and the wheel stay rigid. Only the unsupported tip can overshoot. */
class FenderFlex {
  position = 0;
  rate = 0;

  update(target: number, mode: FenderMode) {
    const offset = this.position - target;
    const next = target + mode.position * offset + mode.fromRate * this.rate;
    this.rate = mode.toRate * offset + mode.velocity * this.rate;
    // Precomputed mesh bounds cover precisely this displacement envelope.
    this.position = clamp(next, -0.32, 1);
    if (this.position !== next) this.rate = 0;
  }

  reset() {
    this.position = this.rate = 0;
  }
}

/** Closed-form step of a damped beam mode for constant load. All entrants
 * use the same fixed tick, so compute the transition once for each beam. */
class FenderMode {
  private dt = 0;
  position = 1;
  fromRate = 0;
  toRate = 0;
  velocity = 1;

  constructor(private readonly frequency: number, private readonly damping: number) {}

  at(dt: number) {
    if (dt !== this.dt) {
      this.dt = dt;
      const omega = 2 * Math.PI * this.frequency;
      const decay = omega * this.damping;
      const angular = Math.sqrt(omega * omega - decay * decay);
      const envelope = Math.exp(-decay * dt);
      const cosine = envelope * Math.cos(angular * dt);
      this.fromRate = envelope * Math.sin(angular * dt) / angular;
      this.position = cosine + decay * this.fromRate;
      this.velocity = cosine - decay * this.fromRate;
      this.toRate = -omega * omega * this.fromRate;
    }
    return this;
  }
}

// The longer front overhang takes longer to return than the supported tail.
const frontMode = new FenderMode(4.2, 0.44);
const rearMode = new FenderMode(5.6, 0.53);

function flexTarget(localG: number, strokeRate: number, speed: number) {
  // One-axle landings load the plastic at that end first. Air unloads it;
  // small static weight differences on a held grid produce no motion.
  const moving = Math.max(smooth(0.5, 4, Math.abs(speed)), smooth(1.3, 2.2, localG));
  return clamp(0.24 * (localG - 1) + 0.035 * clamp(strokeRate, -2, 2), -0.26, 0.78) * moving;
}

/** Samples the existing motocross rig after a solver tick. These values
 * are read only by the frame writer, never by the vehicle's force model. */
export class MxMachineMotion {
  valid = false;
  forkRate = 0;
  shockRate = 0;
  steerRate = 0;
  chainPull = 0;
  readonly front = new FenderFlex();
  readonly rear = new FenderFlex();
  private previousFork = NaN;
  private previousShock = 0;
  private previousSteer = 0;

  reset(fork = NaN, shock = 0, steer = 0) {
    this.valid = false;
    this.previousFork = fork;
    this.previousShock = shock;
    this.previousSteer = steer;
    this.forkRate = this.shockRate = this.steerRate = this.chainPull = 0;
    this.front.reset();
    this.rear.reset();
  }

  step(
    dt: number, fork: number, shock: number, steer: number,
    speed: number, frontG: number, rearG: number, engineTorque: number, engineBrakeForce: number,
  ) {
    if (!(dt > 0 && dt <= 0.12) || !Number.isFinite(fork + shock + steer + speed + frontG + rearG)) {
      this.reset();
      return;
    }
    if (!Number.isFinite(this.previousFork)) this.reset(fork, shock, steer);
    this.forkRate = (fork - this.previousFork) / dt;
    this.shockRate = (shock - this.previousShock) / dt;
    this.steerRate = (steer - this.previousSteer) / dt;
    this.previousFork = fork;
    this.previousShock = shock;
    this.previousSteer = steer;
    this.front.update(flexTarget(frontG, this.forkRate, speed), frontMode.at(dt));
    this.rear.update(flexTarget(rearG, this.shockRate, speed), rearMode.at(dt));
    // Drive pulls the upper span taut; only engine overrun pulls the other way.
    // The foot brake reacts through the caliper. The short take-up follows the
    // gearbox cut and torque reversal, even on a held or airborne wheel.
    const demand = engineTorque / 45 - engineBrakeForce / 600;
    const pull = Number.isFinite(demand) ? clamp(demand, -1, 1) : 0;
    this.chainPull += (pull - this.chainPull) * -Math.expm1(-dt / 0.035);
    this.valid = true;
  }
}
