import { crewPerformanceGeometry, CREW_PERFORMANCE } from './crew-performance.ts';

/** Compatibility entry point: both grid and pit now use the same refined kit. */
export const GRID_MECHANIC_ASSET = CREW_PERFORMANCE;
export function gridMechanicGeometry() {
  return crewPerformanceGeometry('suit_near');
}
