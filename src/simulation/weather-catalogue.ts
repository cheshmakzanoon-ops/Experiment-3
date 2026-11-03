/** The weather presets a session can be started with, as DATA: one record per
 * preset carries every player-facing word (menu option, loading line, event
 * card note, HUD tag) and the menu's suggested tyre, so the select, the
 * loading screen, event cards and validation cannot drift apart. The physics
 * of each preset lives in weather.ts (keyframes); this file owns names only.
 *
 * Original scenario names and wording; no real-world forecast or series
 * branding. */
export const WEATHER_IDS = ['clear', 'changeable', 'rain', 'fog', 'storm', 'dust', 'snow'] as const;
export type WeatherId = (typeof WEATHER_IDS)[number];

export type WeatherTyre = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';

export interface WeatherDescriptor {
  readonly id: WeatherId;
  /** Menu <option> text. */
  readonly option: string;
  /** One word for the loading line ("Dry", "Wet", ...). */
  readonly loading: string;
  /** Event-card expectation sentence fragment. */
  readonly card: string;
  /** Short tag for championship and career lists (upper case). */
  readonly tag: string;
  /** One sentence stating what the preset does to the cars and the view. */
  readonly brief: string;
  /** Tyre the menu pre-selects when this weather is picked (null: leave). */
  readonly suggestedTyre: WeatherTyre | null;
}

export const WEATHER_CATALOGUE: Readonly<Record<WeatherId, WeatherDescriptor>> = Object.freeze({
  clear: {
    id: 'clear',
    option: 'Clear / Dry',
    loading: 'Dry',
    card: 'Dry',
    tag: 'DRY',
    brief: 'Dry, mild and clear.',
    suggestedTyre: null,
  },
  changeable: {
    id: 'changeable',
    option: 'Dry → Rain',
    loading: 'Changeable',
    card: 'Dry, rain expected',
    tag: 'CHANGEABLE',
    brief: 'Dry at the start; a storm arrives and later clears.',
    suggestedTyre: null,
  },
  rain: {
    id: 'rain',
    option: 'Heavy rain',
    loading: 'Wet',
    card: 'Wet',
    tag: 'RAIN',
    brief: 'Steady heavy rain from the start; standing water.',
    suggestedTyre: 'wet',
  },
  fog: {
    id: 'fog',
    option: 'Dawn fog',
    loading: 'Fog',
    card: 'Cold fog, damp track, lifting',
    tag: 'FOG',
    brief:
      'Cold dawn fog. Visibility starts near 110 m and thins over a quarter of an hour; the damp, cold surface costs a slick about a seventh of its grip and the tyres are slow to warm.',
    suggestedTyre: 'medium',
  },
  storm: {
    id: 'storm',
    option: 'Thunderstorm',
    loading: 'Storm',
    card: 'Thunderstorm, gusting crosswind',
    tag: 'STORM',
    brief:
      'A 60 to 76 mm/h cell: standing water about twice as deep as heavy rain, gusts to 20 m/s that push cars and bikes sideways, a dark sky and lightning.',
    suggestedTyre: 'wet',
  },
  dust: {
    id: 'dust',
    option: 'Dust storm',
    loading: 'Dust',
    card: 'Hot dust storm, loose surface',
    tag: 'DUST',
    brief:
      'Hot desert dust storm: visibility drops to about 170 m, a strong gusting wind loads the bodywork, and a loose dust film settles on the tarmac, thinner on the racing line.',
    suggestedTyre: 'medium',
  },
  snow: {
    id: 'snow',
    option: 'Snow and ice',
    loading: 'Snow',
    card: 'Snowfall, packed snow and ice, sub-zero',
    tag: 'SNOW',
    brief:
      'Sub-zero snowfall on a snow-covered road: loose snow gives about a quarter of dry grip and the polished racing line a tenth, so the line is the slippery part. Visibility closes to 400 m in the squall. Winter tread helps.',
    suggestedTyre: 'wet',
  },
});

export function isWeatherId(value: unknown): value is WeatherId {
  return typeof value === 'string' && Object.hasOwn(WEATHER_CATALOGUE, value);
}

/** `<option>` markup for the session form's weather select, in catalogue order. */
export function weatherOptionsHtml() {
  return WEATHER_IDS.map(
    (id) => `<option value="${id}">${WEATHER_CATALOGUE[id].option}</option>`,
  ).join('');
}
