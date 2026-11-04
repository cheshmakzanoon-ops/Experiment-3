/** The time of day a player asks for (the LIGHT dial on the paddock board and
 * the CIRCUIT LIGHTING buttons in the driving academy). Pure data and storage:
 * no renderer, so the menu can import it without pulling in the sky.
 *
 * The renderer already supports the three presets (`LightingMode`, daylight.ts)
 * and LIVE (live-sky.ts follows the real sun). What did not exist was a choice
 * that survives a circuit change (a new circuit rebuilds the presentation and
 * the preset fell back to day) or a restart. `auto` is the old behaviour:
 * floodlit at night venues, daylight everywhere else. Lighting is visual only;
 * it never changes grip, weather or the simulation. */
import { N_ } from '../i18n/mark.ts';

export const LIGHT_CHOICES = ['auto', 'day', 'sunset', 'night', 'live'] as const;
export type LightChoice = (typeof LIGHT_CHOICES)[number];
/** The renderer's own presets (same vocabulary as `LightingMode`). */
export type LightPreset = 'day' | 'sunset' | 'night';

export interface LightDescriptor {
  readonly id: LightChoice;
  /** Menu <option> text. */
  readonly option: string;
  /** One sentence: what the player gets. */
  readonly brief: string;
}
export const LIGHT_CATALOGUE: Readonly<Record<LightChoice, LightDescriptor>> = Object.freeze({
  auto: {
    id: 'auto',
    option: N_('Venue'),
    brief: N_("The venue's own light: floodlit at the night venues, daylight everywhere else."),
  },
  day: { id: 'day', option: N_('Midday'), brief: N_('High sun, hard shadows.') },
  sunset: { id: 'sunset', option: N_('Sunset'), brief: N_('A low sun and long shadows.') },
  night: { id: 'night', option: N_('Night'), brief: N_('Moon and floodlights.') },
  live: {
    id: 'live',
    option: N_('Live sky'),
    brief: N_('The real sun, moon and stars over your location, on your clock.'),
  },
});
export function isLightChoice(value: unknown): value is LightChoice {
  return typeof value === 'string' && (LIGHT_CHOICES as readonly string[]).includes(value);
}
/** `<option>` markup for the LIGHT select, in catalogue order. */
export function lightOptionsHtml(tr: (text: string) => string = (text) => text) {
  return LIGHT_CHOICES.map(
    (id) => `<option value="${id}">${tr(LIGHT_CATALOGUE[id].option)}</option>`,
  ).join('');
}

/** The preset a choice resolves to. `venueNight`: the venue is a night
 * venue (`catalogue.night`). `live`: what the real sun calls for right now
 * (live-sky.ts), or null before the first reading. */
export function resolveLighting(
  choice: LightChoice,
  venueNight: boolean,
  live: LightPreset | null = null,
): LightPreset {
  if (choice === 'live') return live ?? 'day';
  if (choice === 'auto') return venueNight ? 'night' : 'day';
  return choice;
}
/** An event that names its own light (a Wildcard event run after dark) wins
 * over the player's standing choice, for that session only. */
export function sessionLight(choice: LightChoice, advisory: LightPreset | null): LightChoice {
  return advisory ?? choice;
}

/** Storage keys: LIVE keeps the key live-sky.ts has always used. */
export const LIVE_SKY_KEY = 'apex.sky.live.v1';
export const LIGHT_PRESET_KEY = 'apex.sky.light.v1';
type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): KeyValue | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};
/** The saved choice (per browser or desktop profile): LIVE, else a saved preset, else `auto`. */
export function readLightChoice(store: KeyValue | undefined = storage()): LightChoice {
  try {
    if (store?.getItem(LIVE_SKY_KEY) === '1') return 'live';
    const preset = store?.getItem(LIGHT_PRESET_KEY);
    if (preset === 'day' || preset === 'sunset' || preset === 'night') return preset;
  } catch {
    /* A preference that cannot be read is the default. */
  }
  return 'auto';
}
/** Save the choice. A preference that cannot be stored still applies to this session. */
export function writeLightChoice(choice: LightChoice, store: KeyValue | undefined = storage()) {
  try {
    if (choice === 'live') store?.setItem(LIVE_SKY_KEY, '1');
    else store?.removeItem(LIVE_SKY_KEY);
    if (choice === 'day' || choice === 'sunset' || choice === 'night')
      store?.setItem(LIGHT_PRESET_KEY, choice);
    else store?.removeItem(LIGHT_PRESET_KEY);
  } catch {
    /* See above. */
  }
}
