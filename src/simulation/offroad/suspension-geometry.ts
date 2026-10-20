import { G } from '../../core/math.ts';
import type { VehicleDefinition } from '../vehicles.ts';

/** Inverse of the off-road spring's k*x*(1 + progression*(x/travel)^2)
 * law. Preserve the calibrated six fixed-point iterations; preload is
 * already-wound spring travel, not a change to the free wheel geometry. */
export function risingRateSag(
  load: number,
  rate: number,
  travel: number,
  progression: number,
  preload = 0,
) {
  let compression = Math.max(0, load) / rate;
  for (let i = 0; i < 6; i++)
    compression = Math.max(0, load) / (rate * (1 + progression * (compression / travel) ** 2));
  return Math.max(0, compression - preload);
}

/** Fixed factory sag used to author the chassis and its fully extended
 * wheel geometry. Nominal full-fuel mass and zero preload are intentional:
 * fuel burn or setup changes move the sprung equilibrium, not its mounts. */
export function factoryBikeSag(definition: VehicleDefinition) {
  const b = definition.bike!,
    mass = definition.spec.dryMass + b.fuel,
    wheelbase = definition.spec.wheelbase,
    progression = b.offroad?.progression ?? 0;
  return {
    fork: risingRateSag((mass * G * b.cgToRear) / wheelbase, b.forkRate, b.forkTravel, progression),
    shock: risingRateSag(
      (mass * G * b.cgToFront) / wheelbase,
      b.shockRate,
      b.shockTravel,
      progression,
    ),
  };
}
