import type { CircuitId } from '../simulation/circuits.ts';
import { festivalDefaultVehicle } from '../simulation/open-world/festival-machines.ts';

/** Entry points select real existing controls. They never auto-start a session,
 * mutate saved progress, or introduce an alternate physics/rendering path. */
export const DISCIPLINE_PRESETS = Object.freeze({
  formula: { title: 'FORMULA', circuit: 'aurel', vehicle: 'apx01', mode: 'practice' },
  gp: { title: 'GP MOTORCYCLES', circuit: 'poggio-alto', vehicle: 'gpr1', mode: 'practice' },
  festival: {
    title: 'OPEN WORLD',
    circuit: 'aurel',
    vehicle: festivalDefaultVehicle(),
    mode: 'festival',
  },
} satisfies Record<string, { title: string; circuit: CircuitId; vehicle: string; mode: string }>);

export type DisciplinePresetId = keyof typeof DISCIPLINE_PRESETS;
export function disciplinePreset(id: string) {
  return Object.hasOwn(DISCIPLINE_PRESETS, id)
    ? DISCIPLINE_PRESETS[id as DisciplinePresetId]
    : null;
}
