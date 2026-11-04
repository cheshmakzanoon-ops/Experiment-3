import { CIRCUITS } from '../simulation/circuits.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { WEATHER_CATALOGUE } from '../simulation/weather-catalogue.ts';
import { wildcardEntry } from '../career/wildcard-series.ts';
import type { SteamPresence } from '../desktop/bridge.ts';

/**
 * Steam Rich Presence: the statuses the game reports, their English text for the Steamworks
 * localisation file (generated: `npm run export:presence` writes
 * docs/studio/store/RICH_PRESENCE.vdf, which tests/steam-presence.test.ts pins) and the step that
 * turns the ids the game knows into the names a friends list should show.
 *
 * The game sets `steam_display` to `#Status_<status>` and the keys the text uses, and nothing
 * else: every `%key%` in a status' text is a key `describePresence` always provides for that
 * status (tested), because Steam renders an unset key as an empty word.
 */

export const PRESENCE_STATUSES = [
  'Menu',
  'Loading',
  'Racing',
  'TimeTrial',
  'Wildcard',
  'Paused',
  'Results',
  'Replay',
  'Photo',
  'Festival',
] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** English tokens. `%key%` substitutes the presence key of that name. */
export const PRESENCE_TEXT: Readonly<Record<PresenceStatus, string>> = Object.freeze({
  Menu: 'In the paddock',
  Loading: 'Loading a session',
  Racing: '%discipline% at %venue% in the %vehicle%',
  TimeTrial: 'Chasing a lap at %venue% in the %vehicle%',
  Wildcard: 'Wildcard Series: %event%',
  Paused: 'Paused at %venue%',
  Results: 'Reading the results from %venue%',
  Replay: 'Watching a replay from %venue%',
  Photo: 'In photo mode',
  Festival: 'Roaming the Solvane coast in the %vehicle%',
});

/** The keys a status' text needs, read off the text itself. */
export const presenceKeys = (status: PresenceStatus) =>
  [...PRESENCE_TEXT[status].matchAll(/%([a-z]+)%/g)].map((m) => m[1]);

const DISCIPLINE_NAME: Readonly<Record<string, string>> = Object.freeze({
  circuit: 'Circuit racing',
  'gp-bike': 'GP bike racing',
  motocross: 'Motocross',
  supercross: 'Supercross',
  festival: 'Festival',
});
const titleCase = (text: string) =>
  text
    .toLowerCase()
    .replace(/(^|[\s/-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());

/** "Aurel Grand Circuit" for a circuit id (the catalogue's venue name, else the display name), else the id. */
function venueName(id: string): string {
  const circuit = (
    CIRCUITS as Record<string, (typeof CIRCUITS)[keyof typeof CIRCUITS] | undefined>
  )[id];
  if (!circuit) return id;
  const meta = circuit.catalogue;
  if (meta)
    return meta.layout === 'Grand Prix' ? meta.venueName : `${meta.venueName} ${meta.layout}`;
  return titleCase(circuit.name.replace(/\s*\/\s*/g, ' '));
}
/** "APX-01 Formula" for a machine id, else the id. */
function vehicleName(id: string): string {
  const def = Object.hasOwn(VEHICLES, id) ? VEHICLES[id] : undefined;
  if (!def) return id;
  const [code, ...rest] = def.name.split(' ');
  return [code, ...rest.map((w) => (w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase()))].join(
    ' ',
  );
}
const weatherName = (id: string) =>
  Object.hasOwn(WEATHER_CATALOGUE, id)
    ? titleCase(WEATHER_CATALOGUE[id as keyof typeof WEATHER_CATALOGUE].tag)
    : id;

/**
 * The presence the shell sends: the ids in `state` become names, and `event` (a Wildcard event id)
 * becomes its title. Unknown ids pass through unchanged, so a new circuit or machine never breaks
 * presence. The status is returned as given.
 */
export function describePresence(state: SteamPresence): SteamPresence {
  const out: SteamPresence = { status: state.status };
  if (state.venue) out.venue = venueName(state.venue);
  if (state.vehicle) out.vehicle = vehicleName(state.vehicle);
  if (state.weather) out.weather = weatherName(state.weather);
  if (state.discipline) out.discipline = DISCIPLINE_NAME[state.discipline] ?? state.discipline;
  if (state.event) {
    const entry = wildcardEntry(state.event);
    out.event = entry ? titleCase(entry.title) : state.event;
  }
  return out;
}

/** The Steamworks "Rich Presence" localisation file (Community -> Rich Presence), English. */
export function presenceVdf(): string {
  const lines = PRESENCE_STATUSES.map((status) => {
    const token = `"#Status_${status}"`;
    return `            ${token.padEnd(20)} "${PRESENCE_TEXT[status]}"`;
  });
  return `"lang"\n{\n    "english"\n    {\n        "tokens"\n        {\n${lines.join('\n')}\n        }\n    }\n}\n`;
}
