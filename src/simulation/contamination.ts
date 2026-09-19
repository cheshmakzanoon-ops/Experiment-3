import { clamp } from '../core/math.ts';
import { MARBLE_CELL_CAPACITY, SURFACE, type SurfaceSample } from './track.ts';

/** Reduced coverage model, NOT kilograms or a measured tire-material calibration.
 * One fully covered road cell holds 100 tread-cover equivalents. Both pickup and
 * track depletion use this conversion. The integration is exact for the contact
 * velocities and cell density held during one physics substep. */
export interface ContaminatedTread {
  dirt: number;
  /** Total collected tread-cover equivalents since this tire was fitted. */
  marblePickup: number;
}
export function updateContamination(
  tire: ContaminatedTread,
  surface: SurfaceSample,
  load: number,
  longitudinalSpeed: number,
  omega: number,
  dt: number,
) {
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid contamination timestep');
  if (load <= 1) return;
  const speed = Math.abs(longitudinalSpeed),
    rotation = Math.abs(omega);
  const looseGround = surface.surface === SURFACE.GRASS || surface.surface === SURFACE.GRAVEL;
  const road =
    surface.surface === SURFACE.ASPHALT ||
    surface.surface === SURFACE.PAINT ||
    surface.surface === SURFACE.KERB;
  // No pickup from an adjacent/clamped road cell while in grass or the pit lane.
  const density = road ? clamp(surface.marbles, 0, 1) : 0;
  const pickupRate = looseGround
    ? 0.35 * clamp(speed + rotation * 0.1, 0, 1)
    : density * speed * 0.025;
  const cleaningRate = looseGround ? 0 : rotation * 0.0009;
  const rate = pickupRate + cleaningRate;
  if (rate === 0) return;
  const old = clamp(tire.dirt, 0, 1),
    target = pickupRate / rate;
  const decay = -Math.expm1(-rate * dt);
  // Integral of coverage over this step; pickup and shedding can coexist.
  const coveredTime = target * dt + ((old - target) * decay) / rate;
  let collected = Math.max(0, pickupRate * (dt - coveredTime));
  const shed = Math.max(0, cleaningRate * coveredTime);
  if (!looseGround) collected = Math.min(collected, density * MARBLE_CELL_CAPACITY);
  tire.dirt = clamp(old + collected - shed, 0, 1);
  if (road) tire.marblePickup += collected;
}
