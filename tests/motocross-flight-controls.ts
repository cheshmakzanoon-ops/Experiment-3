import { clamp } from '../src/core/math.ts';
import type { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';

/** The existing player-dynamics benchmark's public-forecast rider. Native
 * animation traces need a complete ridden flight, not an assumption that
 * holding the launch throttle must survive every landing. Only ordinary
 * controls change: no AI ownership, pose, force, velocity or model override.
 * Manual body input stays neutral so automatic-posture oracles stay valid. */
export function rideMotocrossFlight(bike: DirtBikeVehicle) {
  const wanted = (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
    Math.max(0.12, bike.landingIn) - bike.pitchRate;
  bike.input.throttle = clamp(wanted * 1.2, 0, 1);
  bike.input.clutch = clamp(-wanted * 1.2, 0, 1);
  bike.input.brake = bike.input.steer = 0;
}
