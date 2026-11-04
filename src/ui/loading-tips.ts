import { fixed, t } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import type { WildcardEntry } from '../career/wildcard-series.ts';
import { keyName, type Bindings } from '../input/bindings.ts';
import { DRS } from '../simulation/drs.ts';
import { WEATHER_CATALOGUE, type WeatherId } from '../simulation/weather-catalogue.ts';

/** Loading-screen tips, chosen for the session being loaded. Every line is a fact
 * of this game, taken from the rules, the weather catalogue or the in-game
 * coaching copy it repeats (the motocross technique card, the GP riding cues,
 * the driving academy), and the keys are the player's own bindings. No filler:
 * a discipline with nothing true to say about it says nothing. */
export type TipDiscipline =
  | 'circuit'
  | 'gp'
  | 'motocross'
  | 'supercross'
  | 'rallycross'
  | 'stage'
  | 'festival';
export interface TipContext {
  discipline: TipDiscipline;
  weather: WeatherId;
  /** The session runs under floodlights. */
  night: boolean;
  /** The race has DRS (rules allow it and the machine has the flap). */
  drs: boolean;
  /** The machine is a hybrid formula car with a deployment mode. */
  hybrid: boolean;
  /** A race (not practice or a timed session): joker laps and pit stops matter. */
  race: boolean;
  /** Solo practice or a time trial at a surveyed terrain venue. */
  solo: boolean;
  wildcard?: WildcardEntry;
  bindings: Pick<Bindings, 'camera' | 'pit' | 'ers' | 'drs' | 'riderForward' | 'riderBack'>;
}

const key = (code: string) => keyName(code);
const WEATHER_TIP: Readonly<Partial<Record<WeatherId, string>>> = Object.freeze({
  rain: N_('Heavy rain leaves standing water: use full wets and stay off the painted kerbs.'),
  changeable: N_('{brief} Be ready to change tyres.'),
  fog: N_(
    'Fog: visibility starts near 110 m and thins over about a quarter of an hour. The cold, damp surface costs a slick about a seventh of its grip.',
  ),
  storm: N_(
    'Storm: standing water about twice as deep as heavy rain, and gusts to 20 m/s push cars and bikes sideways. Give the wind room.',
  ),
  dust: N_(
    'Dust storm: visibility drops to about 170 m and a loose film settles on the tarmac, thinner on the racing line.',
  ),
  snow: N_(
    'Snow: the road starts covered. Deep snow grips about a quarter of dry; the worn, polished wheel tracks along the racing line about two-fifths. Stay in the tracks, brake early, and use full wets or a winter tread.',
  ),
});

/** Every tip that is true of this session, most specific first. */
export function loadingTipsFor(ctx: TipContext): string[] {
  const tips: string[] = [];
  const { bindings: keys } = ctx;
  if (ctx.wildcard) {
    const { ladder, event } = ctx.wildcard;
    const asks = (value: number) =>
      ladder.metric === 'position' ? `P${value}` : `${fixed(value, 2)} ${t('s')}`;
    tips.push(
      t(
        ladder.metric === 'position'
          ? 'Gold asks {gold}, silver {silver}, bronze {bronze} or better. The machine is loaned: nothing to buy.'
          : 'Gold asks {gold}, silver {silver}, bronze {bronze} or faster. The machine is loaned: nothing to buy.',
        { gold: asks(ladder.gold), silver: asks(ladder.silver), bronze: asks(ladder.bronze) },
      ),
    );
    if (ctx.wildcard.rules.includes('no-assists'))
      tips.push(
        t(
          'This event runs with no ABS and no traction control: the throttle and brake are yours alone.',
        ),
      );
    if (event.laps === 1)
      tips.push(t('One lap decides it. A clean first corner is worth more than a brave last one.'));
  }
  const weatherKey = WEATHER_TIP[ctx.weather];
  if (weatherKey)
    tips.push(
      ctx.weather === 'changeable'
        ? t(weatherKey, { brief: t(WEATHER_CATALOGUE.changeable.brief) })
        : t(weatherKey),
    );
  if (ctx.night)
    tips.push(
      t('Night sessions run under floodlights. Lighting is visual only and never changes grip or weather.'),
    );
  switch (ctx.discipline) {
    case 'circuit':
      tips.push(
        t('Brake in a straight line, then release smoothly as you turn in.'),
        t('Cold tyres have less grip. Build temperature on your first lap.'),
        t('A smooth exit is worth more than a late apex.'),
        t('Press {key} to change camera. The cockpit view gives the best sense of speed.', {
          key: key(keys.camera),
        }),
      );
      if (ctx.race)
        tips.push(
          t('Press {key} to request a pit stop and choose your next set of tyres.', {
            key: key(keys.pit),
          }),
        );
      if (ctx.drs)
        tips.push(
          t(
            'DRS opens inside a marked zone when you are within {gap} s of the car ahead, in the dry, from lap {lap}. Press {key}; braking closes it.',
            { gap: fixed(DRS.gap, 1), lap: DRS.fromLap, key: key(keys.drs) },
          ),
        );
      if (ctx.hybrid)
        tips.push(
          t(
            'Harvest energy on the straights you do not need, deploy where you do. {key} changes the hybrid mode.',
            { key: key(keys.ers) },
          ),
        );
      break;
    case 'gp':
      tips.push(
        t('Set your speed before turn-in, then ease the brake as lean builds.'),
        t('Use the front brake for a strong stop; the rear pedal is a light touch.'),
        t('Unwind lean, then add power gently.'),
        t('Cold tyres have less grip. Build temperature on your first lap.'),
      );
      break;
    case 'motocross':
    case 'supercross':
      tips.push(
        t('Brake before the face of a jump, not on it.'),
        t('{forward} / {back} shift rider weight forward and back; release to settle.', {
          forward: key(keys.riderForward),
          back: key(keys.riderBack),
        }),
        t('In the air, tap a brake to lower the nose, then release for touchdown.'),
      );
      if (ctx.solo)
        tips.push(
          t('In solo practice, land smoothly on each surveyed downslope to clear its target.'),
        );
      break;
    case 'rallycross':
      tips.push(t('Cold tyres have less grip. Build temperature on your first lap.'));
      if (ctx.race)
        tips.push(
          t('A rallycross heat needs its joker laps: every one you are short costs a time penalty.'),
        );
      break;
    case 'stage':
      tips.push(t('Cold tyres have less grip. Build temperature on your first lap.'));
      break;
    case 'festival':
      tips.push(
        t('Drive to an event marker, or travel to any discovered route from the world map.'),
        t('Press {key} to change camera.', { key: key(keys.camera) }),
      );
      break;
  }
  return tips;
}
