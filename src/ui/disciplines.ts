import { CIRCUITS, CIRCUIT_IDS, type CircuitId } from '../simulation/circuits.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { offroadCourse, venueAdmits } from '../simulation/offroad/venues.ts';
import {
  festivalAdmits,
  festivalDefaultVehicle,
  festivalVehicles,
} from '../simulation/open-world/festival-machines.ts';
import { SOLVANE } from '../simulation/open-world/region-data.ts';
import { DISCIPLINES } from '../career/registry.ts';
import { BIKE_MACHINES } from './bike-machines.ts';
import { machineChoices } from './machine-options.ts';

/** The four ways to race, as the menu presents them (art direction section 2).
 * A discipline is a *view* over the session form: the form's selects stay the
 * single source of truth, so the discipline is derived from them (`disciplineOf`)
 * and entering one writes sensible defaults back (`entryDefaults`). The career's
 * own ladder is `career/registry.ts` (circuit-cars, road-bikes, off-road, festival). */
export const BOARD_DISCIPLINES = ['circuit', 'gp', 'dirt', 'festival'] as const;
export type BoardDiscipline = (typeof BOARD_DISCIPLINES)[number];
export type PlateShape = 'roundel' | 'fairing' | 'arch' | 'licence';
export interface DisciplineSpec {
  id: BoardDiscipline;
  label: string;
  numeral: string;
  shape: PlateShape;
  /** Pit-board message: the menu headline for this discipline. */
  motto: string;
  /** What the first stage of the board is called. */
  venueNoun: string;
  /** What the discipline tests, in the career's words (career/registry.ts). */
  skill: string;
}
export const DISCIPLINE_SPECS: Readonly<Record<BoardDiscipline, DisciplineSpec>> = Object.freeze({
  circuit: {
    id: 'circuit',
    label: 'CIRCUIT',
    numeral: '1',
    shape: 'roundel',
    motto: 'EVERY INPUT. EVERY FORCE.',
    venueNoun: 'CIRCUIT',
    skill: DISCIPLINES['circuit-cars'].skill,
  },
  gp: {
    id: 'gp',
    label: 'GP BIKE',
    numeral: '2',
    shape: 'fairing',
    motto: 'LEAN IN. LET GO LATE.',
    venueNoun: 'CIRCUIT',
    skill: DISCIPLINES['road-bikes'].skill,
  },
  dirt: {
    id: 'dirt',
    label: 'DIRT',
    numeral: '3',
    shape: 'arch',
    motto: 'FIND YOUR FLOW.',
    venueNoun: 'VENUE',
    skill: DISCIPLINES['off-road'].skill,
  },
  festival: {
    id: 'festival',
    label: 'FESTIVAL',
    numeral: '4',
    shape: 'licence',
    motto: 'ONE COAST. NO FENCES.',
    venueNoun: 'REGION',
    skill: DISCIPLINES.festival.skill,
  },
});

/** The form values that decide the discipline. */
export interface EntryFields {
  mode: string;
  circuit: string;
  vehicle: string;
}
/** Festival wins (it is a session mode), then the machine family, then the
 * venue. A road car at a circuit stays CIRCUIT: mismatched entries are welcome. */
export function disciplineOf(fields: EntryFields): BoardDiscipline {
  if (fields.mode === 'festival') return 'festival';
  const machine = Object.hasOwn(VEHICLES, fields.vehicle) ? VEHICLES[fields.vehicle] : null;
  if (machine?.bike) return machine.bike.offroad ? 'dirt' : 'gp';
  if (Object.hasOwn(BIKE_MACHINES, fields.vehicle)) return 'gp';
  if (Object.hasOwn(CIRCUITS, fields.circuit) && CIRCUITS[fields.circuit as CircuitId].offroad)
    return 'dirt';
  return 'circuit';
}

/** Circuits listed under a discipline, in menu order. */
export function venuesFor(discipline: BoardDiscipline): CircuitId[] {
  switch (discipline) {
    case 'circuit':
      return CIRCUIT_IDS.filter((id) => !CIRCUITS[id].offroad);
    case 'gp':
      return CIRCUIT_IDS.filter((id) => !CIRCUITS[id].offroad && CIRCUITS[id].bikeSafe === true);
    case 'dirt':
      return CIRCUIT_IDS.filter((id) => !!CIRCUITS[id].offroad);
    default:
      return [];
  }
}
/** Machine ids (MACHINE select values) a discipline offers at a venue, in menu order. */
export function machinesFor(discipline: BoardDiscipline, circuit: string): string[] {
  const all = machineChoices().flatMap((group) => group.options.map((o) => ({ ...o, group })));
  switch (discipline) {
    case 'gp':
      return Object.keys(BIKE_MACHINES);
    case 'dirt': {
      const venue = Object.hasOwn(CIRCUITS, circuit) ? CIRCUITS[circuit as CircuitId] : null;
      return all
        .map((o) => o.value)
        .filter((id) => {
          const def = Object.hasOwn(VEHICLES, id) ? VEHICLES[id] : null;
          if (!def) return false;
          const dirt = def.bike ? !!def.bike.offroad : venue?.offroad !== undefined;
          return dirt && (!venue || venueAdmits(venue, def.classId));
        });
    }
    case 'festival':
      return festivalVehicles().map((d) => d.id);
    default:
      // Every four-wheel machine and the mixed grids: nothing is hidden, so a
      // rally car on a road circuit is one step away.
      return all
        .map((o) => o.value)
        .filter((id) => !Object.hasOwn(BIKE_MACHINES, id) && !(VEHICLES[id]?.bike ?? false));
  }
}

/** Plate captions drawn from the registries: what is on offer under each plate. */
export function disciplineFacts(discipline: BoardDiscipline) {
  if (discipline === 'festival')
    return { count: SOLVANE.events.length, noun: 'EVENTS', machines: festivalVehicles().length };
  const venues = venuesFor(discipline).length;
  return {
    count: venues,
    noun: venues === 1 ? 'VENUE' : 'VENUES',
    machines: machinesFor(discipline, venuesFor(discipline)[0] ?? '').length,
  };
}

/** Select values written when a discipline is entered for the first time.
 * Keys are form ids. Only the fields that must change are returned. */
export function entryDefaults(
  discipline: BoardDiscipline,
  current: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const raceMode = current.mode === 'festival' ? 'race' : current.mode;
  switch (discipline) {
    case 'circuit': {
      const venues = venuesFor('circuit');
      if (!venues.includes(current.circuit as CircuitId)) out.circuit = venues[0];
      if (!machinesFor('circuit', '').includes(current.vehicle)) out.vehicle = 'apx01';
      if (current.mode === 'festival') out.mode = raceMode;
      break;
    }
    case 'gp': {
      const venues = venuesFor('gp');
      if (!venues.includes(current.circuit as CircuitId)) out.circuit = venues[0];
      if (!Object.hasOwn(BIKE_MACHINES, current.vehicle)) out.vehicle = Object.keys(BIKE_MACHINES)[0];
      if (current.mode === 'festival') out.mode = raceMode;
      break;
    }
    case 'dirt':
      // Handled by the existing OUTDOOR MX shortcut (motocross-presentation.ts),
      // which also sets the field, tyres and assists for a motocross moto.
      break;
    case 'festival': {
      out.mode = 'festival';
      // The festival ignores the circuit, but the dirt presenter keys on it: do
      // not leave a motocross track selected under the open-world plate.
      if (Object.hasOwn(CIRCUITS, current.circuit) && CIRCUITS[current.circuit as CircuitId].offroad)
        out.circuit = venuesFor('circuit')[0];
      const def = Object.hasOwn(VEHICLES, current.vehicle) ? VEHICLES[current.vehicle] : null;
      // The festival admits every road-legal car, but a single-seater is a poor
      // first drive on public roads: start from the festival's own default.
      if (!def || !festivalAdmits(def) || def.classId === 'formula')
        out.vehicle = festivalDefaultVehicle();
      break;
    }
  }
  return out;
}

/** The machine a terrain venue is built for: the class that races its format
 * (rallycross at the rallycross venue, rally at the stage road, motocross bike
 * at the motocross track), else the first machine the venue admits. */
export function dirtMachineFor(circuit: string): string | null {
  const list = machinesFor('dirt', circuit);
  const kind = Object.hasOwn(CIRCUITS, circuit)
    ? offroadCourse(CIRCUITS[circuit as CircuitId])?.kind
    : undefined;
  const wanted: Record<string, string> = {
    motocross: 'motocross',
    supercross: 'supercross',
    rallycross: 'rallycross',
    'rally-stage': 'rally',
    stage: 'rally',
  };
  const classId = kind ? wanted[kind] : undefined;
  const match = list.find((id) => VEHICLES[id].classId === classId);
  return match ?? list[0] ?? null;
}
