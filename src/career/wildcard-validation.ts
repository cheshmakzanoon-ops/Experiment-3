import { canonical, contentHash } from '../core/session-identity.ts';
import { CIRCUITS } from '../simulation/circuits.ts';
import { PROTECTED_NAMES } from '../simulation/content-validation.ts';
import { RULESETS } from '../simulation/events.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { WILDCARD_SERIES, wildcardSession, type WildcardEntry } from './wildcard-series.ts';

/** Content checks for the Wildcard series (run by `npm run validate:content`).
 * Kept apart from the accessor so a menu that lists the series does not pull
 * the validation modules into its bundle. */
/** Hash of everything a race-evidence record depends on from the entry's own
 * data (docs/wildcard-races.json is stale when this differs). */
export const wildcardHash = (entry: Pick<WildcardEntry, 'event' | 'rules'>) =>
  contentHash(canonical({ event: entry.event, rules: entry.rules }));
/** Real series, circuits, brands and corners the series' copy must not use
 * (on top of content-validation's PROTECTED_NAMES for circuits). */
const BANNED_COPY = Object.freeze([
  'formula 1',
  'formula one',
  'f1',
  'motogp',
  'moto gp',
  'forza',
  'gran turismo',
  'nascar',
  'indycar',
  'dakar',
  'wrc',
  'le mans',
  'daytona',
  'indianapolis',
  'nurburgring',
  'nürburgring',
  'nordschleife',
  'pikes peak',
  'isle of man',
  'red bull',
  'ferrari',
  'porsche',
  'lamborghini',
  'mclaren',
  'yamaha',
  'honda',
  'ducati',
  'ktm',
  'suzuki',
  'kawasaki',
  'ford',
  'toyota',
  'bmw',
  'audi',
  'mercedes',
]);
const bannedCopy = new RegExp(
  `(^|[^a-z0-9])(${[...PROTECTED_NAMES, ...BANNED_COPY]
    .map((n) => n.replace(/[-.]/g, '\\$&'))
    .join('|')})([^a-z0-9]|$)`,
  'i',
);
export const WILDCARD_COPY_LIMITS = Object.freeze({ title: 48, pitch: 140 });
/** Every problem with the series' data (empty when sound): unique ids, real
 * machines and venues, a pairing the rules allow, one-line original copy, an
 * ordered medal ladder. `npm run validate:content` runs this. */
export function validateWildcardSeries(
  series: readonly WildcardEntry[] = WILDCARD_SERIES,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>(),
    seeds = new Set<number>();
  for (const e of series) {
    const at = `wildcard ${e.id}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) errors.push(`${at}: id must be kebab-case`);
    if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    ids.add(e.id);
    if (e.event.id !== e.id) errors.push(`${at}: event id ${e.event.id} differs`);
    if (seeds.has(e.event.seed)) errors.push(`${at}: seed ${e.event.seed} reused`);
    seeds.add(e.event.seed);
    for (const id of [e.event.vehicles].flat())
      if (!Object.hasOwn(VEHICLES, id)) errors.push(`${at}: unknown vehicle ${id}`);
    if (!Object.hasOwn(CIRCUITS, e.event.circuit))
      errors.push(`${at}: unknown venue ${e.event.circuit}`);
    if (!Object.hasOwn(RULESETS, e.event.ruleset))
      errors.push(`${at}: unknown ruleset ${e.event.ruleset}`);
    try {
      wildcardSession(e);
    } catch (error) {
      errors.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const [field, text, limit] of [
      ['title', e.title, WILDCARD_COPY_LIMITS.title],
      ['pitch', e.pitch, WILDCARD_COPY_LIMITS.pitch],
    ] as const) {
      if (!text || text.length > limit)
        errors.push(`${at}: ${field} must be 1-${limit} characters`);
      if (/[\r\n]/.test(text)) errors.push(`${at}: ${field} must be one line`);
      if (bannedCopy.test(text)) errors.push(`${at}: "${text}" uses a protected real-world name`);
    }
    if (e.title !== e.title.toUpperCase()) errors.push(`${at}: title is uppercase menu text`);
    if (e.event.name !== e.title) errors.push(`${at}: event name differs from the title`);
    const { gold, silver, bronze, metric } = e.ladder;
    if (
      !(
        [gold, silver, bronze].every((v) => Number.isFinite(v) && v > 0) &&
        gold < silver &&
        silver < bronze
      )
    )
      errors.push(`${at}: medal ladder must be positive and ordered gold < silver < bronze`);
    if (metric === 'position' && bronze > e.event.opponents + 1)
      errors.push(
        `${at}: bronze position ${bronze} is outside a ${e.event.opponents + 1}-car grid`,
      );
    if (e.rules.includes('time-attack') !== (metric === 'best-lap'))
      errors.push(`${at}: a time attack uses the best-lap ladder, a race the position ladder`);
  }
  return errors;
}
