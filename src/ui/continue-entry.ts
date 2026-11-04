import { wildcardTitle } from '../i18n/data.ts';
import { t } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import { wildcardEntry } from '../career/wildcard-series.ts';
import { CIRCUITS, type CircuitId } from '../simulation/circuits.ts';
import { CIRCUIT_MENU_LABELS } from './circuit-menu.ts';
import { machineChoices } from './machine-options.ts';

/** CONTINUE: the last entry the player launched from the paddock board, kept
 * across launches in the save store (key `board:last:v1`). It is the board's
 * own form values (the same select ids and values the form owns) or a Wildcard
 * event id, never a copy of a session or its result. Reading it validates it:
 * a value that no longer exists in this build (a removed machine or venue)
 * simply yields no CONTINUE button. */
export const CONTINUE_KEY = 'board:last:v1';
/** The form fields an entry remembers, in the order they are applied (a mode
 * change adjusts laps and the grid, a weather change picks tyres, a venue
 * change resets the machine preview; the rest then overrides them). */
export const CONTINUE_FIELDS = [
  'mode',
  'circuit',
  'vehicle',
  'laps',
  'weather',
  'opponents',
  'compound',
  'assist',
  'startSlot',
] as const;
export type ContinueField = (typeof CONTINUE_FIELDS)[number];
export type ContinueEntry =
  | { version: 1; kind: 'form'; fields: Record<ContinueField, string> }
  | { version: 1; kind: 'wildcard'; id: string };

const MODES = ['race', 'practice', 'time-trial', 'qualifying', 'endurance', 'festival'];
const short = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length < 64;

export function validateContinue(raw: unknown): ContinueEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) return null;
  if (value.kind === 'wildcard')
    return typeof value.id === 'string' && wildcardEntry(value.id)
      ? { version: 1, kind: 'wildcard', id: value.id }
      : null;
  if (value.kind !== 'form' || !value.fields || typeof value.fields !== 'object') return null;
  const fields = value.fields as Record<string, unknown>;
  if (!CONTINUE_FIELDS.every((id) => short(fields[id]))) return null;
  if (!MODES.includes(fields.mode as string)) return null;
  if (!Object.hasOwn(CIRCUITS, fields.circuit as string)) return null;
  return {
    version: 1,
    kind: 'form',
    fields: Object.fromEntries(CONTINUE_FIELDS.map((id) => [id, fields[id] as string])) as Record<
      ContinueField,
      string
    >,
  };
}

const MODE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  race: N_('RACE'),
  practice: N_('PRACTICE'),
  'time-trial': N_('TIME TRIAL'),
  qualifying: N_('WEEKEND'),
  endurance: N_('ENDURANCE'),
  festival: N_('FESTIVAL'),
});
let machineLabels: Map<string, string> | null = null;
/** The machine's menu label ("APX-01 Formula · RWD") from its select value. */
function machineLabel(value: string) {
  machineLabels ??= new Map(
    machineChoices().flatMap((g) => g.options.map((o) => [o.value, o.label])),
  );
  return machineLabels.get(value) ?? value;
}
/** What CONTINUE will launch, in two short lines (machine and place, then the format). */
export function describeContinue(entry: ContinueEntry): { title: string; detail: string } {
  if (entry.kind === 'wildcard') {
    const event = wildcardEntry(entry.id);
    return {
      title: event ? wildcardTitle(event) : t('WILDCARD EVENT'),
      detail: t('WILDCARD SERIES'),
    };
  }
  const f = entry.fields;
  const machine = machineLabel(f.vehicle).split(' · ')[0].split(' ')[0].toUpperCase();
  if (f.mode === 'festival') return { title: `${machine} · SOLVANE`, detail: t('FESTIVAL') };
  // "Vellamar Coast Circuit" reads as "VELLAMAR COAST" in the narrow button.
  const venue = CIRCUIT_MENU_LABELS[f.circuit as CircuitId]
    .split(' · ')[0]
    .replace(/\s+(grand\s+)?(circuit|prix)$/i, '')
    .toUpperCase();
  const format =
    f.mode === 'race' || f.mode === 'endurance'
      ? t('{n, plural, one {# LAP} other {# LAPS}}', { n: Number(f.laps) })
      : t(MODE_LABEL[f.mode]);
  return { title: `${machine} · ${venue}`, detail: format };
}
