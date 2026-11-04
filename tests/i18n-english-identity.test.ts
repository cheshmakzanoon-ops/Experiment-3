import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { ACHIEVEMENTS } from '../src/steam/achievements.ts';
import { WILDCARD_SERIES } from '../src/career/wildcard-series.ts';
import { MACHINE_CHARACTER, machineBlurb } from '../src/ui/machine-character.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { LOADING_TIPS, loadingStage } from '../src/ui/loading-copy.ts';
import { loadingTipsFor, type TipContext, type TipDiscipline } from '../src/ui/loading-tips.ts';
import { firstLapHint, firstRunHtml } from '../src/ui/first-run.ts';
import { sessionRulesSummary } from '../src/ui/machine-options.ts';
import { describeContinue } from '../src/ui/continue-entry.ts';
import { DEFAULT_BINDINGS } from '../src/input/bindings.ts';
import { WEATHER_CATALOGUE, WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import { LIGHT_CATALOGUE } from '../src/rendering/light-choice.ts';
import { DISCIPLINE_SPECS } from '../src/ui/disciplines.ts';
import { weatherOptionsHtml } from '../src/simulation/weather-catalogue.ts';
import { lightOptionsHtml } from '../src/rendering/light-choice.ts';
import { circuitOptionsHtml } from '../src/ui/circuit-menu.ts';
import { machineSelectOptions } from '../src/ui/machine-options.ts';
import { boardPlatesHtml, dialHtml } from '../src/ui/launch-board.ts';
import { demoBoardPlateHtml, demoEndHtml, demoClockHtml } from '../src/ui/demo-plate.ts';
import { lapTime, timedGap, shortTime, conditions, SESSION_TITLES } from '../src/ui/interface.ts';
import { setLocale } from '../src/i18n/index.ts';

/** English is the source language, so localising a string must not change a single character
 * of what an English player reads. The DOM screens are covered by the browser check
 * (e2e/63-i18n-layout.spec.ts, e2e/fixtures/i18n-en); this file covers the data tables and the
 * string builders that fixture does not render. The baseline in
 * tests/fixtures/i18n-english-identity.json was captured from the code before any string was
 * localised; `I18N_CAPTURE=1` rewrites it (only ever to record a deliberate English change). */
const FILE = new URL('./fixtures/i18n-english-identity.json', import.meta.url);

/** HTML builders compare after entity normalisation: `&` and `&amp;` are the same text. */
const norm = (html: string) => html.replaceAll('&amp;', '&');

function gather() {
  const tips = new Set<string>();
  const disciplines: TipDiscipline[] = [
    'circuit',
    'gp',
    'motocross',
    'supercross',
    'rallycross',
    'stage',
    'festival',
  ];
  for (const discipline of disciplines)
    for (const weather of WEATHER_IDS)
      for (let flags = 0; flags < 32; flags++) {
        const ctx: TipContext = {
          discipline,
          weather,
          night: !!(flags & 1),
          drs: !!(flags & 2),
          hybrid: !!(flags & 4),
          race: !!(flags & 8),
          solo: !!(flags & 16),
          bindings: DEFAULT_BINDINGS,
        };
        for (const tip of loadingTipsFor(ctx)) tips.add(tip);
      }
  for (const entry of WILDCARD_SERIES)
    for (const tip of loadingTipsFor({
      discipline: 'circuit',
      weather: 'clear',
      night: false,
      drs: false,
      hybrid: false,
      race: true,
      solo: false,
      wildcard: entry,
      bindings: DEFAULT_BINDINGS,
    }))
      tips.add(tip);
  const rules = new Set<string>();
  for (const mode of ['race', 'practice', 'time-trial', 'qualifying', 'endurance'] as const)
    for (const vehicle of ['apx01', 'gpr1', 'mx450', 'hy9', 'dx8'])
      for (const circuit of ['aurel', 'vellamar', 'alpine-pass'] as const)
        for (const compound of ['soft', 'wet'] as const)
          for (const opponents of [0, 7])
            rules.add(sessionRulesSummary({ mode, opponents, compound, vehicle, circuit }));
  const stages = [
    'Preparing your vehicle showroom…',
    '37% · Loading A07 start gantry',
    '12% · Loading bodywork and car 3',
    '40% · pit lane tyre blankets',
    'car 3 / 8',
    'Building Vellamar Coast Circuit / VELLAMAR',
    'Building GP motorcycles and riders',
    'Scene ready',
    'baking festival materials',
    'compiling circuit and vehicle',
    'completed cockpit',
    'something unknown',
  ].map((raw) => loadingStage(raw, 0.2));
  return {
    machineCharacter: MACHINE_CHARACTER,
    machineBlurb: Object.fromEntries(Object.keys(VEHICLES).map((id) => [id, machineBlurb(id)])),
    achievements: ACHIEVEMENTS.map((a) => [a.id, a.name, a.description]),
    wildcard: WILDCARD_SERIES.map((e) => [e.id, e.title, e.pitch]),
    loadingTips: [...LOADING_TIPS],
    tips: [...tips].sort(),
    stages,
    rules: [...rules].sort(),
    firstLapHint: [firstLapHint('keys'), firstLapHint('pad')],
    firstRun: [
      norm(firstRunHtml({ device: 'keys' })),
      norm(firstRunHtml({ device: 'pad', discipline: 'gp' })),
    ],
    weather: WEATHER_CATALOGUE,
    light: LIGHT_CATALOGUE,
    disciplines: DISCIPLINE_SPECS,
    options: [
      norm(weatherOptionsHtml()),
      norm(lightOptionsHtml()),
      norm(circuitOptionsHtml()),
      norm(machineSelectOptions()),
    ],
    board: [
      norm(boardPlatesHtml()),
      norm(dialHtml('laps', 'DISTANCE', 'laps', '<select></select>')),
      norm(demoBoardPlateHtml()),
      norm(demoEndHtml(30)),
      demoClockHtml(125),
    ],
    continue: [
      describeContinue({ version: 1, kind: 'wildcard', id: 'karts-after-dark' }),
      describeContinue({
        version: 1,
        kind: 'form',
        fields: {
          mode: 'race',
          circuit: 'vellamar',
          vehicle: 'gpr1',
          laps: '5',
          weather: 'rain',
          opponents: '3',
          compound: 'wet',
          assist: 'raw',
          startSlot: 'back',
        },
      }),
    ],
    format: [
      lapTime(83.456),
      lapTime(0),
      timedGap(84.1, 83.456, false),
      shortTime(125),
      conditions(21.4, 0, 0),
      conditions(14, 2, 0.5),
      SESSION_TITLES,
    ],
  };
}

describe('English is untouched by localisation', () => {
  it('matches the capture taken before any string was localised', async () => {
    await setLocale('en');
    const now = JSON.parse(JSON.stringify(gather())) as unknown;
    if (process.env.I18N_CAPTURE === '1') {
      writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
      return;
    }
    const before = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
    for (const [part, value] of Object.entries(before))
      expect((now as Record<string, unknown>)[part], part).toEqual(value);
    expect(Object.keys(now as object).sort()).toEqual(Object.keys(before).sort());
  });
});
