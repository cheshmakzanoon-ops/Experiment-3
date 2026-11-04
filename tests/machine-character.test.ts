import { describe, expect, it } from 'vitest';
import { findBrands } from '../scripts/ip-denylist.mjs';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { machineChoices } from '../src/ui/machine-options.ts';
import {
  MACHINE_CHARACTER,
  machineBlurb,
  machineFacts,
  machineSpecLine,
} from '../src/ui/machine-character.ts';

/** Model codes (APX-01, GP-R1, MX-450...) and engine layouts (V8, V12) are names, not figures. */
const withoutCodes = (text: string) =>
  text.replace(/\b[A-Z]{1,3}-[A-Z]?\d+[A-Z]*\b/g, '').replace(/\bV\d{1,2}\b/g, '');

describe('machine character lines', () => {
  const ids = Object.keys(VEHICLES);
  it('gives every machine one line and no line to an unknown machine', () => {
    expect(Object.keys(MACHINE_CHARACTER).sort()).toEqual([...ids].sort());
  });
  it('keeps each line distinct, one sentence long and free of figures', () => {
    const seen = new Set<string>();
    for (const id of ids) {
      const line = MACHINE_CHARACTER[id];
      expect(line.length, id).toBeGreaterThan(60);
      expect(line.length, id).toBeLessThanOrEqual(150);
      expect(line, id).toMatch(/\.$/);
      // Figures live in the derived spec line, where they cannot go stale.
      expect(withoutCodes(line), id).not.toMatch(/\d/);
      expect(seen.has(line), `${id} repeats a line`).toBe(false);
      seen.add(line);
    }
  });
  it('shares no opening three words between two machines of the same class', () => {
    const opening = (id: string) =>
      MACHINE_CHARACTER[id].split(/\s+/).slice(0, 3).join(' ').toLowerCase();
    const byClass = new Map<string, string[]>();
    for (const id of ids)
      (
        byClass.get(VEHICLES[id].classId) ??
        byClass.set(VEHICLES[id].classId, []).get(VEHICLES[id].classId)!
      ).push(opening(id));
    for (const [classId, list] of byClass) expect(new Set(list).size, classId).toBe(list.length);
  });
  it('names no real brand, team or series', () => {
    for (const id of ids) expect(findBrands(MACHINE_CHARACTER[id]), id).toEqual([]);
  });
  it('derives mass, power and drive from the definition', () => {
    for (const id of ids) {
      const def = VEHICLES[id],
        facts = machineFacts(def);
      expect(facts.massKg, id).toBe(Math.round(def.spec.dryMass));
      expect(facts.powerKw, id).toBeGreaterThan(20);
      expect(machineSpecLine(def), id).toContain(`${facts.massKg} kg`);
      expect(machineSpecLine(def), id).toContain(`${facts.powerKw} kW`);
      expect(machineBlurb(id), id).toBe(`${machineSpecLine(def)} — ${MACHINE_CHARACTER[id]}`);
    }
    // A motorcycle's rider is in its mass and its power is the stated peak.
    expect(machineFacts(VEHICLES.gpr1).powerKw).toBe(
      Math.round(VEHICLES.gpr1.spec.motorPowerW / 1000),
    );
    expect(machineSpecLine(VEHICLES.eh3)).toMatch(/AWD$/);
  });
  it('leaves the mixed-grid choices without a blurb', () => {
    expect(machineBlurb('mixed')).toBe('');
    expect(machineBlurb('multiclass')).toBe('');
    expect(machineBlurb('bikes')).toBe('');
  });
  it('covers every machine the MACHINE dial can pick', () => {
    for (const group of machineChoices())
      for (const option of group.options)
        if (Object.hasOwn(VEHICLES, option.value))
          expect(machineBlurb(option.value), option.value).not.toBe('');
  });
});
