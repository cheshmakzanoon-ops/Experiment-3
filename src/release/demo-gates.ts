import { WILDCARD_SERIES, wildcardEntry } from '../career/wildcard-series.ts';
import { LICENCE_IDS } from '../career/licences.ts';
import { CIRCUITS, CIRCUIT_IDS } from '../simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../simulation/config.ts';
import { DEFAULT_VEHICLE_ID, VEHICLES, VEHICLE_IDS } from '../simulation/vehicles.ts';
import { FULL_GAME, demoPolicy, type DemoPolicy } from './demo.ts';

/** Session-level gates of the Steam demo edition (the data is `DEMO_SLICE` in demo.ts).
 * These read the catalogues, so they live apart from demo.ts, which every module may import
 * without a cycle. The full game has no policy and every function here answers "open". */

/** The part of a session the demo gates. */
export interface GatedSession {
  /** Absent means the default circuit (Aurel). */
  circuit?: string;
  mode: string;
  /** Per-entry machines; absent means the default formula field (APX-01). */
  vehicles?: readonly string[];
}

const circuitName = (id: string) => CIRCUITS[id as keyof typeof CIRCUITS]?.name ?? id;
const machineName = (id: string) => VEHICLES[id]?.name ?? id;

/** Does an unlocked Wildcard event loan exactly this venue and these machines? The series
 * lends its machine and venue for that event, so a session that IS one of the open events
 * (the board, CONTINUE, the career record) is playable whatever the slice says about the
 * venue or machine on their own. Matched on content, not on a flag the caller sets. */
function loanedByOpenEvent(policy: DemoPolicy, circuit: string, machines: readonly string[]) {
  return WILDCARD_SERIES.some(
    (entry) =>
      policy.wildcardOpen(entry.id) &&
      entry.event.circuit === circuit &&
      machines.every((id) => [entry.event.vehicles].flat().includes(id)),
  );
}

/**
 * Why a session cannot start in the demo, or null when it can. `eventKey` is the career event
 * key (`wildcard.<id>`) when the career starts the session.
 */
export function demoSessionLock(
  session: GatedSession,
  eventKey: string | null = null,
): string | null {
  const policy = demoPolicy();
  if (!policy) return null;
  if (eventKey?.startsWith('wildcard.')) {
    const id = eventKey.slice('wildcard.'.length);
    return policy.wildcardOpen(id)
      ? null
      : `${wildcardEntry(id)?.title ?? 'This Wildcard event'} is in the ${FULL_GAME}`;
  }
  const circuit = session.circuit ?? DEFAULT_OPTIONS.circuit ?? 'aurel';
  const machines = [...new Set(session.vehicles?.length ? session.vehicles : [DEFAULT_VEHICLE_ID])];
  if (session.mode === 'festival') {
    const locked = machines.find((id) => !policy.machineOpen(id, 'festival'));
    return locked ? `${machineName(locked)} is in the ${FULL_GAME}` : null;
  }
  if (loanedByOpenEvent(policy, circuit, machines)) return null;
  if (!policy.circuitOpen(circuit)) return `${circuitName(circuit)} is in the ${FULL_GAME}`;
  const locked = machines.find((id) => !policy.machineOpen(id, 'circuit'));
  return locked ? `${machineName(locked)} is in the ${FULL_GAME}` : null;
}

export interface FullGameCounts {
  circuits: number;
  machines: number;
  wildcard: number;
  licences: number;
}
/** How much of each catalogue the demo leaves for the full game (null in the full game).
 * The festival's lent road cars count as in the demo. */
export function fullGameCounts(): FullGameCounts | null {
  const policy = demoPolicy();
  if (!policy) return null;
  const inDemo = (id: string) => policy.machineOpen(id);
  return {
    circuits: CIRCUIT_IDS.filter((id) => !policy.circuitOpen(id)).length,
    machines: VEHICLE_IDS.filter((id) => !inDemo(id)).length,
    wildcard: WILDCARD_SERIES.filter((entry) => !policy.wildcardOpen(entry.id)).length,
    licences: LICENCE_IDS.filter((id) => !policy.licenceOpen(id)).length,
  };
}
