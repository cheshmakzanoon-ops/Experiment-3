import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;

/** A boundary probe, not a replay: these initial speed/roll/support values
 * come from Valley's saved wrong-side-lean trace. Rolling wheel speeds remove
 * pre-existing spin so a slip-only TC cannot conceal a lost command limit.
 * The actual drivetrain, core, MX tyre solver and suspension still run. */
function driveProbe(definition: VehicleDefinition, mode: 'sport' | 'raw', overlap = false) {
  const track = rigTrack('valley-ridge-mx');
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, mode, definition);
  bike.place(track, 35);
  bike.gear = 3;
  bike.autoShift = false;
  const d = bike.dynamics, spec = definition.bike!;
  d.speed = 10.375327839627316;
  if (!overlap) {
    d.lean = -0.6469453638984276;
    d.leanRate = -0.9831039969256234;
    d.steer = -0.13274529637570942;
    bike.forceFront = 133.14882047903274;
    bike.forceRear = 1684.3477653113482;
    bike.input.steer = 1;
  }
  bike.input.throttle = overlap ? 0.2 : 0.3759326395292466;
  bike.input.clutch = overlap ? 0.45 : 0;
  bike.frontSpin = d.speed / spec.frontWheelRadius;
  bike.rearSpin = d.speed / spec.rearWheelRadius;
  const rearOmegaBefore = bike.rearSpin;
  let requested = NaN, intervention = NaN, coreNetDrive = NaN;
  const coreStep = d.step.bind(d);
  // Observe the completed core request without substituting a controller or
  // altering its output. Its later telemetry is overwritten by real tyres.
  d.step = (input, dt) => {
    const result = coreStep(input, dt);
    requested = input.drive!;
    intervention = d.intervention;
    coreNetDrive = d.driveForce;
    return result;
  };
  // One microstep makes the overlap brake's ABS scale exactly one from the
  // initially rolling rear. Ordinary drive cases exercise the full tick.
  const dt = overlap ? 1e-6 : DT;
  bike.step(dt, track);
  const rearPedal = d.assists.combinedBrakes
    ? Math.max(bike.input.clutch, bike.input.brake * 0.3) : bike.input.clutch;
  const brakeTorque = rearPedal * d.p.rearBrake * spec.rearWheelRadius;
  // I Δω = (engine torque - brake torque - tyre reaction torque) Δt.
  // The tyre force is the interval mean, so this reconstructs actuator
  // torque independently of the core's telemetry and adapter expression.
  const observedTorque = spec.offroad!.spinInertia * (bike.rearSpin - rearOmegaBefore) / dt +
    (d.driveForce - d.rearBrakeForce) * spec.rearWheelRadius + brakeTorque;
  return { bike, requested, intervention, coreNetDrive, observedTorque, radius: spec.rearWheelRadius };
}

describe('motocross Sport drive command reaches the wheel actuator', () => {
  it.each([MX_250, MX_450])('$id preserves the core cornering and front-support reserve before rear slip begins', (definition) => {
    const result = driveProbe(definition, 'sport');
    expect(result.bike.riding && !result.bike.airborne).toBe(true);
    expect(result.bike.dynamics.crashes).toBe(0);
    expect(result.requested).toBeGreaterThan(100);
    expect(result.intervention).toBeGreaterThan(0.9);
    // The core's gross engine request is distinct from tyre force. Its
    // limited request, followed by any further slip TC reduction, is the
    // maximum torque allowed to add wheel/chassis angular momentum.
    const torqueBudget = result.requested * (1 - result.intervention) * result.radius;
    expect(result.observedTorque).toBeGreaterThanOrEqual(-1e-9);
    expect(result.observedTorque).toBeLessThanOrEqual(torqueBudget + 1e-8);
  });

  it.each([MX_250, MX_450])('$id keeps raw engine torque and wheel momentum untrimmed', (definition) => {
    const result = driveProbe(definition, 'raw');
    expect(result.bike.riding && !result.bike.airborne).toBe(true);
    expect(result.intervention).toBe(0);
    expect(result.observedTorque).toBeCloseTo(result.requested * result.radius, 8);
    expect(result.bike.dynamics.driveForce).toBeGreaterThan(0);
  });

  it.each([MX_250, MX_450])('$id retains gross engine torque while a stronger rear pedal makes net rear force negative', (definition) => {
    const result = driveProbe(definition, 'sport', true);
    expect(result.bike.riding && !result.bike.airborne).toBe(true);
    expect(result.requested).toBeGreaterThan(100);
    expect(result.coreNetDrive).toBe(0);
    // Forwarding d.driveForce would erase this legitimate engine/brake
    // overlap because that field is already a clamped NET tyre force.
    expect(result.observedTorque).toBeCloseTo(
      result.requested * (1 - result.intervention) * result.radius, 7,
    );
  });
});
