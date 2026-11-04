import type { VehicleDefinition } from '../simulation/vehicles.ts';

/** Peak power (kW) of a machine from its own definition: the solver's net crank torque (the
 * sheet's gross curve less the power unit's friction) times engine speed, plus the electric
 * motor of a hybrid or electric machine; a motorcycle states its power directly. Derived, not
 * quoted, so it cannot drift from the numbers the solver uses. */
export function peakPowerKw(def: VehicleDefinition): number {
  const s = def.spec;
  if (def.dynamicsKind === 'bike') return s.motorPowerW / 1000;
  const friction = s.engine ?? { frictionBase: 12, frictionPerRad: 0.04 },
    curve = s.torqueCurve;
  let best = 0;
  for (let rpm = s.idleRPM; rpm <= s.limiterRPM; rpm += 50) {
    // Piecewise-linear interpolation of the gross torque curve (flat beyond its ends).
    let gross = curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      if (rpm <= curve[i][0]) {
        gross =
          curve[i - 1][1] +
          ((curve[i][1] - curve[i - 1][1]) * (rpm - curve[i - 1][0])) /
            (curve[i][0] - curve[i - 1][0]);
        break;
      }
      gross = curve[i][1];
    }
    const omega = (rpm * Math.PI) / 30;
    best = Math.max(
      best,
      (gross - friction.frictionBase - friction.frictionPerRad * omega) * omega,
    );
  }
  // A front-axle hybrid motor adds only above its own speed, so it is left out of the peak.
  return (best + (def.hybridAxle ? 0 : s.motorPowerW)) / 1000;
}
