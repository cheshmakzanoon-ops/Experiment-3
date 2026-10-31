import { describe, expect, it } from 'vitest';
import { DISCIPLINE_PRESETS, disciplinePreset } from '../src/ui/discipline-presets.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { machineOptions } from '../src/ui/machine-options.ts';
import { sessionIncompatibilities } from '../src/simulation/events.ts';
import { festivalAdmits } from '../src/simulation/open-world/festival-machines.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

describe('visible discipline entry points', () => {
  it('uses existing compatible machines and circuits, with a road-ready festival car', () => {
    for (const preset of Object.values(DISCIPLINE_PRESETS)) {
      expect(VEHICLES[preset.vehicle]).toBeDefined();
      if (preset.mode === 'festival') {
        expect(festivalAdmits(VEHICLES[preset.vehicle])).toBe(true);
        expect(VEHICLES[preset.vehicle].dynamicsKind).toBe('four-wheel');
      } else {
        const options = {
          ...DEFAULT_OPTIONS,
          circuit: preset.circuit,
          mode: 'practice' as const,
          opponents: 0,
        };
        Object.assign(options, machineOptions(options, preset.vehicle));
        expect(sessionIncompatibilities(validateOptions(options))).toEqual([]);
      }
    }
  });
  it('rejects arbitrary and inherited names without falling back to the wrong mode', () => {
    for (const name of ['', 'unknown', '__proto__', 'constructor'])
      expect(disciplinePreset(name)).toBeNull();
    expect(disciplinePreset('gp')?.vehicle).toBe('gpr1');
  });
});
