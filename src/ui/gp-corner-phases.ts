import { clamp } from '../core/math.ts';
import type { GPCornerShape } from '../simulation/gp-corner-shape.ts';

export { gpCornerShapes } from '../simulation/gp-corner-shape.ts';
export type { GPCornerShape, GPCornerPhase } from '../simulation/gp-corner-shape.ts';

/** Equal thirds in the small phase strip correspond to entry, the immediate
 * apex region and exit. Their physical lengths vary with the actual bend. */
export function gpCornerPhase(shape: GPCornerShape, distance: number) {
  const apex = shape.apexWindow;
  if (distance > shape.entry) return { phase: 'approach' as const, progress: 0 };
  if (distance > apex)
    return {
      phase: 'entry' as const,
      progress: clamp((shape.entry - distance) / (shape.entry - apex), 0, 1) / 3,
    };
  if (distance >= -apex)
    return {
      phase: 'apex' as const,
      progress: (1 + clamp((apex - distance) / (2 * apex), 0, 1)) / 3,
    };
  return {
    phase: 'exit' as const,
    progress: (2 + clamp((-distance - apex) / (shape.exit - apex), 0, 1)) / 3,
  };
}
