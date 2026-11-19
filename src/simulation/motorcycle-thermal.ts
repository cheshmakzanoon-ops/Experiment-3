import { G } from '../core/math.ts';
import type { BrakeThermalParameters } from './brake-thermal.ts';
import type { TyreThermalParameters } from './tyre-thermal.ts';

/** Effective heat reservoirs for one complete physical motorcycle wheel.
 * Front and rear are different sizes; the two legacy telemetry slots at
 * each end are aliases, never two heat reservoirs. Original engineering
 * calibration, not manufacturer or measured tyre/rotor data. SI units:
 * capacities J/K, conductances W/K (speed terms per m/s).
 *
 * The rolling input is the mechanical resistance already removed by the
 * dynamics core. Compatibility hysteresis is zero so missing work cannot
 * silently turn into a second speed-based source. No ideal-temperature
 * target appears anywhere in this thermal network. */
const frontTyre: TyreThermalParameters = Object.freeze({
  surfaceCapacity: 1800,
  carcassCapacity: 10000,
  coreCapacity: 1400,
  surfaceCarcass: 42,
  carcassCore: 14,
  airBase: 4,
  airSpeed: 0.14,
  trackContact: 5,
  waterBase: 45,
  waterSpeed: 0.22,
  sidewallBase: 1.2,
  sidewallSpeed: 0.025,
  rimBase: 0.4,
  rimSpeed: 0.01,
  discToCore: 0.18,
  slipShare: 0.62,
  hysteresis: 0,
  hysteresisCarcassShare: 0.72,
  wearCapacityLoss: 0.35,
});
const rearTyre: TyreThermalParameters = Object.freeze({
  ...frontTyre,
  surfaceCapacity: 2500,
  carcassCapacity: 14000,
  coreCapacity: 1900,
  surfaceCarcass: 52,
  carcassCore: 18,
  airBase: 5,
  airSpeed: 0.175,
  trackContact: 6.25,
  waterBase: 56.25,
  waterSpeed: 0.275,
  sidewallBase: 1.5,
  sidewallSpeed: 0.03125,
  rimBase: 0.5,
  rimSpeed: 0.0125,
  discToCore: 0.15,
});

/** A front wheel's two discs are represented by one finite reservoir.
 * Rear engine braking is an engine loss and must not enter either rotor. */
const frontBrake: BrakeThermalParameters = Object.freeze({
  capacity: 3200,
  airBase: 20,
  airSpeed: 1.2,
});
const rearBrake: BrakeThermalParameters = Object.freeze({
  capacity: 1800,
  airBase: 12,
  airSpeed: 0.65,
});

export const MOTORCYCLE_THERMAL = Object.freeze({
  front: Object.freeze({ tyre: frontTyre, brake: frontBrake }),
  rear: Object.freeze({ tyre: rearTyre, brake: rearBrake }),
});

/** Irreversible power at one steered contact, in watts. Forces are in the
 * tyre frame, while the incoming contact velocity is in the chassis frame.
 * A force perpendicular to a perfectly rolling path does no work. Clamp
 * the total signed contact power, rather than turning positive mechanical
 * work from a reduced camber/relaxation model into heat with abs(). */
export function motorcycleContactSlipPower(
  fx: number,
  fy: number,
  forward: number,
  lateral: number,
  rimSpeed: number,
  steer = 0,
) {
  const cs = Math.cos(steer),
    sn = Math.sin(steer),
    along = forward * cs + lateral * sn,
    across = lateral * cs - forward * sn;
  return Math.max(0, fx * (rimSpeed - along) - fy * across);
}

/** Share the exact rolling-resistance work of the reduced bike core between
 * its loaded contacts. The core removes Crr*m*g, not Crr*sum(N), so using
 * independently scaled axle loads would manufacture heat on landing.
 * Unsupported contacts get zero. Surface bulldozing/compaction is a road
 * loss and deliberately stays outside the tyre's heat budget. */
export function motorcycleRollingPower(
  coefficient: number,
  mass: number,
  speed: number,
  wheelLoad: number,
  totalLoad: number,
) {
  if (!(wheelLoad > 1e-6 && totalLoad > 1e-6 && Math.abs(speed) > 0.05)) return 0;
  return (
    Math.max(0, coefficient) *
    Math.max(0, mass) *
    G *
    Math.abs(speed) *
    Math.min(1, wheelLoad / totalLoad)
  );
}

/** Actual frictional rotor work for a reduced contact-force model.
 * `brakeForce` includes engine braking in the rear contact telemetry;
 * `engineBrakeForce` removes that share before applying the rotor's angular
 * velocity. A locked rotor cannot receive continuous F*v brake heat. */
export function motorcycleBrakePower(
  brakeForce: number,
  engineBrakeForce: number,
  radius: number,
  omega: number,
) {
  return Math.max(0, brakeForce - engineBrakeForce) * Math.max(0, radius) * Math.abs(omega);
}

/** Work of a friction brake during a constant-acceleration wheel microstep.
 * Integrate only the positive rotation before a wheel stops. Keeping torque
 * applied after omega reaches zero cannot keep generating heat. Returns J;
 * the dynamics owner divides the accumulated work by its outer dt for W. */
export function motorcycleRotorBrakeWork(
  omega: number,
  acceleration: number,
  brakeTorque: number,
  dt: number,
) {
  const start = Math.max(0, omega),
    movingTime = acceleration < 0 ? Math.min(dt, start / -acceleration) : dt,
    finish = Math.max(0, start + acceleration * movingTime);
  return Math.max(0, brakeTorque) * 0.5 * (start + finish) * movingTime;
}
