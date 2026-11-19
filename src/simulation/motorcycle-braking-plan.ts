import { G } from '../core/math.ts';
import { envelopeProfile } from './ai.ts';
import type { BikeParameters } from './bike.ts';
import type { CapabilityEnvelope } from './vehicles.ts';

/** Horizontal travel per centreline station metre for p(s)=r(s)+d(s)n(s).
 * Its tangent components are (1-kappa*d) and d'. Braking work and dy/distance
 * must use this same metric; offset curvature alone does not correct either. */
export function motorcyclePathMetric(curvature: number, offset: number, offsetSlope: number) {
  return Math.hypot(1 - curvature * offset, offsetSlope);
}

/** Longitudinal stopping capacity before road grade. Motorcycle cornering
 * ABS must leave the rear enough normal load to carry its lateral share.
 * With Nrear=Nrear0-Fx*h/L and FyRear=m*ay*a/L, the transfer bound is linear
 * in ay. A friction ellipse by itself overestimates trail-braking capacity. */
export function motorcycleBrakeCapacity(
  p: BikeParameters,
  mass: number,
  grip: number,
  speed: number,
  lateral: number,
  reserveScale = 1,
  riderGain = 0,
) {
  const rearNormal =
      (mass * G * p.cgToFront) / p.wheelbase +
      (p.downforce ?? 0) * speed * speed * (1 - (p.downforceFront ?? 0.6)),
    // Ordinary road intent is chassis lean; its offset rider adds a moment.
    // GP intent already represents the combined CG and passes zero here.
    reserve = (Math.abs(lateral) + G * riderGain * Math.hypot(1, lateral / G)) * reserveScale,
    rearLateral = (mass * reserve * p.cgToFront) / p.wheelbase,
    rearKeep = rearLateral / Math.max(1e-6, 0.85 * p.mu * grip),
    transfer = Math.max(0, ((rearNormal - rearKeep) * p.wheelbase) / p.cgHeight),
    lift = ((p.stoppieMargin ?? 0.92) * rearNormal * p.wheelbase) / p.cgHeight,
    lever = p.frontBrake * 0.78 + p.rearBrake * 0.3;
  return (Math.min(transfer, lift, lever) + p.drag * speed * speed) / mass;
}

/** The shared profile owns sampling, the backward solve and positive-uphill
 * grade. This adds only the motorcycle's normal-load-preserving brake bound;
 * unrelated vehicle profiles retain their original arithmetic. */
export function motorcycleApproachProfile(
  curvatures: ArrayLike<number>,
  corners: ArrayLike<number>,
  grip: number,
  aero: number,
  env: CapabilityEnvelope,
  count: number,
  profile: Float64Array,
  gradients: ArrayLike<number>,
  parameters: BikeParameters,
  mass: number,
  reserveScale = 1,
  riderGain = 0,
  distances?: ArrayLike<number>,
  lateralReserve = 0,
) {
  return envelopeProfile(
    curvatures,
    corners,
    grip,
    aero,
    env,
    count,
    profile,
    gradients,
    (speed, lateral) =>
      motorcycleBrakeCapacity(parameters, mass, grip, speed, lateral, reserveScale, riderGain) *
      env.brakingMargin,
    distances,
    lateralReserve,
  );
}
