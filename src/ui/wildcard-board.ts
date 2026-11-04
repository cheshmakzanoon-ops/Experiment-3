import { wildcardPitch, wildcardTitle } from '../i18n/data.ts';
import { fixed, t, ta, th, upper } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import {
  wildcardCareerEvent,
  wildcardDiscipline,
  wildcardKey,
  wildcardMedalFromRecord,
  wildcardSeries,
  type WildcardEntry,
} from '../career/wildcard-series.ts';
import { racePayout, type Payout } from '../career/economy.ts';
import { MEDALS, MEDAL_RANK, type Medal } from '../career/licences.ts';
import type { DisciplineId } from '../career/registry.ts';
import type { CareerSave } from '../career/save.ts';
import { CIRCUITS } from '../simulation/circuits.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { WEATHER_CATALOGUE } from '../simulation/weather-catalogue.ts';
import { LIGHT_CATALOGUE } from '../rendering/light-choice.ts';
import { credits } from './career-hub.ts';
import { CIRCUIT_MENU_LABELS } from './circuit-menu.ts';
import { DISCIPLINE_SPECS, type BoardDiscipline } from './disciplines.ts';
import { LIGHT_GLYPH, WEATHER_GLYPH, glyph, plateSvg } from './glyphs.ts';
import { circuitArt, circuitArtSvg } from './track-art.ts';
import { escapeHtml } from './team-hub.ts';
import { uiCue } from './ui-cue.ts';
import { FULL_GAME, demoPolicy, wildcardOpen } from '../release/demo.ts';
import { fullGameTag, lockedPanelHtml } from './demo-plate.ts';

/** The WILDCARD SERIES board: every event of the series on one screen, a
 * programme page per event (the venue's real line art, the machine, the
 * weather and light, the one-line pitch, the medal ladder, the pay) and the
 * player's best medal from the career save. It is built from the series data
 * (`wildcardSeries()`), the venue and machine registries and the career's own
 * payment rules (`racePayout`), so nothing on it can drift from what the
 * session then does. Starting an event is `career:wildcardGo:<id>`; the
 * career controller owns that (career/controller.ts). */
const MEDAL_LETTER: Readonly<Record<Medal, string>> = Object.freeze({
  gold: 'G',
  silver: 'S',
  bronze: 'B',
});
const MEDAL_NAME: Readonly<Record<Medal, string>> = Object.freeze({
  gold: N_('GOLD'),
  silver: N_('SILVER'),
  bronze: N_('BRONZE'),
});
const medalName = (medal: Medal) => t(MEDAL_NAME[medal]);
const LIGHTING_WORD = { day: N_('day'), sunset: N_('sunset'), night: N_('night') } as const;
/** The registry's discipline of a machine, as the board's plate vocabulary. */
const BOARD_OF: Readonly<Record<DisciplineId, BoardDiscipline>> = Object.freeze({
  'circuit-cars': 'circuit',
  'road-bikes': 'gp',
  'off-road': 'dirt',
  festival: 'festival',
});
const pad2 = (n: number) => String(n).padStart(2, '0');
const venueName = (entry: WildcardEntry) =>
  CIRCUIT_MENU_LABELS[entry.event.circuit].split(' · ')[0].toUpperCase();
const machineIds = (entry: WildcardEntry) => [...new Set([entry.event.vehicles].flat())];
/** Short machine code ("GP-R1"), or the codes of a mixed field. */
const machineCodes = (entry: WildcardEntry) =>
  machineIds(entry)
    .map((id) => VEHICLES[id].name.split(' ')[0])
    .join(' / ');
const machineNames = (entry: WildcardEntry) =>
  machineIds(entry)
    .map((id) => VEHICLES[id].name)
    .join(' / ');
const cars = (entry: WildcardEntry) => entry.event.opponents + 1;
const lapStamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${fixed(seconds % 60, 2).padStart(5, '0')}`;
/** What a medal asks for: "P3" on a position ladder, "0:42.61" on a time attack. */
const requirement = (entry: WildcardEntry, medal: Medal) =>
  entry.ladder.metric === 'position' ? `P${entry.ladder[medal]}` : lapStamp(entry.ladder[medal]);
/** The best medal on the player's record (null before a classified start). */
export const bestMedal = (entry: WildcardEntry, save: Pick<CareerSave, 'results'> | null) =>
  save ? wildcardMedalFromRecord(entry, save.results[wildcardKey(entry)]) : null;

/** The most a start can pay, by the career's own rules (a perfect result:
 * the win or best lap, no contact, no penalties, the grid places gained). */
export function maximumPay(entry: WildcardEntry): number {
  const n = cars(entry);
  return racePayout(wildcardCareerEvent(entry), {
    session: 'preview',
    position: 1,
    cars: n,
    classified: true,
    demonstration: false,
    penalties: 0,
    contactEnergy: 0,
    gridSlot: Math.max(0, n - 1),
    bestLap: 1,
  }).total;
}

export interface WildcardProgress {
  total: number;
  crossDiscipline: number;
  /** Events with at least one medal. */
  medalled: number;
  medals: Record<Medal, number>;
  /** The first event in menu order without a medal. */
  next: WildcardEntry | null;
}
/** Tally for the door on the paddock board and the board's header. */
export function wildcardProgress(save: Pick<CareerSave, 'results'> | null): WildcardProgress {
  // The Steam demo offers a slice of the series; the rest is FULL GAME and is not tallied.
  const series = wildcardSeries().filter((e) => wildcardOpen(e.id));
  const medals: Record<Medal, number> = { gold: 0, silver: 0, bronze: 0 };
  let next: WildcardEntry | null = null,
    medalled = 0;
  for (const entry of series) {
    const medal = bestMedal(entry, save);
    if (medal) {
      medals[medal]++;
      medalled++;
    } else next ??= entry;
  }
  return {
    total: series.length,
    crossDiscipline: series.filter((e) => e.kind === 'cross-discipline').length,
    medalled,
    medals,
    next,
  };
}

const medalDisc = (medal: Medal | null, large = false) =>
  `<span class="wc-medal${large ? ' wc-medal-lg' : ''}" data-medal="${medal ?? 'none'}" aria-hidden="true">${medal ? `<b>${MEDAL_LETTER[medal]}</b>` : ''}</span>`;
const weatherTag = (entry: WildcardEntry) => WEATHER_CATALOGUE[entry.event.weather];
const lightLabel = (entry: WildcardEntry) =>
  entry.lighting ? upper(t(LIGHT_CATALOGUE[entry.lighting].option)) : t('YOUR SETTING');
const lightGlyph = (entry: WildcardEntry) => LIGHT_GLYPH[entry.lighting ?? 'auto'];
const tint = (entry: WildcardEntry) =>
  `--tint:var(--mb-plate-${{ circuit: 'circuit', gp: 'gp', dirt: 'dirt', festival: 'fest' }[BOARD_OF[wildcardDiscipline(entry)]]})`;
const rulesOf = (entry: WildcardEntry) =>
  [
    entry.rules.includes('time-attack') ? t('TIME ATTACK · SOLO') : '',
    entry.rules.includes('no-assists') ? t('NO ABS · NO TRACTION CONTROL') : '',
  ].filter(Boolean);

function rowHtml(entry: WildcardEntry, index: number, save: CareerSave | null, selected: boolean) {
  const medal = bestMedal(entry, save);
  const weather = weatherTag(entry);
  const locked = !wildcardOpen(entry.id);
  const label = `${pad2(index + 1)} ${wildcardTitle(entry)}, ${t('{machines} at {venue}', { machines: machineCodes(entry), venue: venueName(entry) })}, ${t(weather.tag).toLowerCase()}${entry.lighting ? `, ${t(LIGHTING_WORD[entry.lighting])}` : ''}, ${locked ? t('full game only') : medal ? t('best {medal}', { medal: medalName(medal).toLowerCase() }) : t('no medal yet')}`;
  return `<li><button type="button" class="wc-row" role="radio" aria-checked="${selected}" tabindex="${selected ? 0 : -1}" data-id="${entry.id}" data-kind="${entry.kind}"${locked ? ' data-locked="true"' : ''} style="${tint(entry)}" aria-label="${escapeHtml(label)}"><span class="wc-no">${pad2(index + 1)}</span><span class="wc-mini">${circuitArtSvg(entry.event.circuit, { numbers: false, className: 'ta wc-mini-art' })}</span><span class="wc-row-text"><b>${escapeHtml(wildcardTitle(entry))}</b><span>${escapeHtml(machineCodes(entry))} <i>${th('on')}</i> ${escapeHtml(venueName(entry))}</span></span><span class="wc-row-flags">${glyph(WEATHER_GLYPH[entry.event.weather] ?? 'sun', 'wc-flag')}${entry.lighting ? glyph(lightGlyph(entry), 'wc-flag') : ''}${locked ? fullGameTag() : medalDisc(medal)}</span></button></li>`;
}

function detailHtml(entry: WildcardEntry, save: CareerSave | null, selected: boolean) {
  const medal = bestMedal(entry, save);
  const record = save?.results[wildcardKey(entry)];
  const art = circuitArt(entry.event.circuit);
  const venue = CIRCUITS[entry.event.circuit];
  const weather = weatherTag(entry);
  const board = BOARD_OF[wildcardDiscipline(entry)];
  const spec = DISCIPLINE_SPECS[board];
  const timed = entry.rules.includes('time-attack');
  const field = timed
    ? t('SOLO · {n} TIMED LAPS', { n: entry.event.laps })
    : `${t(machineIds(entry).every((id) => VEHICLES[id].dynamicsKind === 'four-wheel') ? '{n, plural, one {# CAR} other {# CARS}}' : '{n, plural, one {# RIDER} other {# RIDERS}}', { n: cars(entry) })} · ${t('{n, plural, one {# LAP} other {# LAPS}}', { n: entry.event.laps })}`;
  const ladder = MEDALS.slice()
    .reverse()
    .map(
      (m) =>
        `<li data-medal="${m}"${medal === m ? ' data-best="true"' : ''}>${medalDisc(m)}<span><b>${th(MEDAL_NAME[m])}</b><small>${th(entry.ladder.metric === 'position' ? 'FINISH {need} OR BETTER' : 'LAP {need} OR FASTER', { need: requirement(entry, m) })}</small></span>${medal && MEDAL_RANK[medal] >= MEDAL_RANK[m] ? `<em>${th('EARNED')}</em>` : ''}</li>`,
    )
    .join('');
  const locked = !wildcardOpen(entry.id);
  const best =
    locked
      ? t(FULL_GAME)
      : !record || record.starts < 1
      ? t('NOT RUN YET')
      : entry.ladder.metric === 'best-lap'
        ? t('BEST {best} · {starts, plural, one {# START} other {# STARTS}}', {
            best: record.bestLap > 0 ? lapStamp(record.bestLap) : '—',
            starts: record.starts,
          })
        : t('BEST P{best} · {starts, plural, one {# START} other {# STARTS}}', {
            best: record.bestPosition,
            starts: record.starts,
          });
  const rules = rulesOf(entry)
    .map((r) => `<span class="wc-rule">${r}</span>`)
    .join('');
  return `<section class="wc-detail" data-id="${entry.id}" data-kind="${entry.kind}" style="${tint(entry)}" aria-label="${escapeHtml(wildcardTitle(entry))}"${selected ? '' : ' hidden'}>
<div class="wc-detail-top"><div class="wc-map">${circuitArtSvg(entry.event.circuit, { numbers: true, className: 'ta wc-map-art' })}</div><div class="wc-detail-head"><span class="wc-kind">${entry.kind === 'cross-discipline' ? th('CROSS-DISCIPLINE') : th('CLASS MISMATCH')}</span><h3>${escapeHtml(wildcardTitle(entry))}</h3><dl class="wc-facts"><div><dt>${th('MACHINE')}</dt><dd><span class="wc-plate" aria-hidden="true">${plateSvg(spec.shape, spec.numeral)}</span>${escapeHtml(machineNames(entry))}</dd></div><div><dt>${th('VENUE')}</dt><dd>${escapeHtml(venueName(entry))} <small>${fixed(art.length / 1000, 1)} ${th('KM')} · ${venue.corners.length} ${th('TURNS')}</small></dd></div><div><dt>${th('FIELD')}</dt><dd>${field}</dd></div><div><dt>${th('SKY')}</dt><dd>${glyph(WEATHER_GLYPH[entry.event.weather] ?? 'sun', 'wc-flag')}${th(weather.tag)}<span class="wc-sep"></span>${glyph(lightGlyph(entry), 'wc-flag')}${lightLabel(entry)}</dd></div></dl>${rules ? `<div class="wc-rules">${rules}</div>` : ''}</div></div>
<p class="wc-pitch">${escapeHtml(wildcardPitch(entry))}</p>
<div class="wc-ladder"><ol aria-label="${ta('Medal ladder')}">${ladder}</ol><p class="wc-best" data-medal="${medal ?? 'none'}">${best}</p></div>
<div class="wc-foot"><p class="wc-pay"><small>${th('PAYS UP TO')}</small><b>${credits(maximumPay(entry))}</b><small>${entry.stakes === 1 ? th('MACHINES ARE LOANED') : th('STAKES × {stakes} · MACHINES ARE LOANED', { stakes: entry.stakes })}</small></p>${
    locked
      ? lockedPanelHtml(t('This event is in the full game: the machine, the venue and the sky are all waiting there.'), 'wildcard')
      : `<button type="button" class="primary wc-go" data-action="career:wildcardGo:${entry.id}">${th('START EVENT')} ${glyph('go', 'enter-glyph')}</button>`
  }</div>
</section>`;
}

/** The board. `selected`: the event id shown on the programme page (default:
 * the first event without a medal, else the first). */
export function wildcardBoardHtml(save: CareerSave | null, selected?: string): string {
  // The Steam demo lists its events first and the rest below as FULL GAME plates.
  const all = wildcardSeries();
  const series = demoPolicy()
    ? [...all.filter((e) => wildcardOpen(e.id)), ...all.filter((e) => !wildcardOpen(e.id))]
    : all;
  const progress = wildcardProgress(save);
  const chosen = series.find((e) => e.id === selected) ?? progress.next ?? series[0];
  const tally = MEDALS.slice()
    .reverse()
    .map(
      (m) =>
        `<li data-medal="${m}">${medalDisc(m)}<b>${progress.medals[m]}</b><span class="wc-tally-name">${th(MEDAL_NAME[m])}</span></li>`,
    )
    .join('');
  return `<div class="wc-board" data-selected="${chosen.id}">
<header class="wc-head"><div><span class="eyebrow">${th('WILDCARD SERIES')}${demoPolicy() ? ` · ${th('{total} OF {all} IN THE DEMO', { total: progress.total, all: all.length })}` : ''}</span><h2>${th('Machines on roads they were never built for.')}</h2></div><ul class="wc-tally" aria-label="${ta('Medals earned')}">${tally}<li class="wc-tally-total"><b>${progress.medalled}</b><span class="wc-tally-name">${th('OF {total} MEDALLED', { total: progress.total })}</span></li></ul><button type="button" data-action="modalClose" class="wc-close" aria-label="${ta('Close Wildcard Series')}">${glyph('close')}</button></header>
<div class="wc-body"><ul class="wc-list" role="radiogroup" aria-label="${ta('Wildcard event')}">${series.map((e, i) => rowHtml(e, i, save, e.id === chosen.id)).join('')}</ul><div class="wc-pages">${series.map((e) => detailHtml(e, save, e.id === chosen.id)).join('')}</div></div>
</div>`;
}

/** Scroll the event list, and only it, so `row` is in view. (scrollIntoView would
 * also scroll every ancestor, the dialog included, and leave the page stale.) */
export function revealInList(row: HTMLElement) {
  const list = row.closest<HTMLElement>('.wc-list');
  if (!list) return;
  const r = row.getBoundingClientRect(),
    l = list.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop -= l.top - r.top;
  else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
}

/** Selection and keys on a rendered board: the rows are a roving radio group
 * (arrow keys, Home and End move and select; focus selects, so a controller
 * walking the list also reads each event). Returns a disposer. */
export function bindWildcardBoard(root: HTMLElement): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const rows = () => [...root.querySelectorAll<HTMLButtonElement>('.wc-row')];
  const select = (id: string, focus = false) => {
    const board = root.querySelector<HTMLElement>('.wc-board');
    if (!board || board.dataset.selected === id) return;
    board.dataset.selected = id;
    for (const row of rows()) {
      const on = row.dataset.id === id;
      row.setAttribute('aria-checked', String(on));
      row.tabIndex = on ? 0 : -1;
      if (on && focus) row.focus({ preventScroll: true });
      if (on) revealInList(row);
    }
    for (const page of root.querySelectorAll<HTMLElement>('.wc-detail'))
      page.hidden = page.dataset.id !== id;
    uiCue('tick');
  };
  root.addEventListener(
    'focusin',
    (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('.wc-row');
      if (row?.dataset.id) select(row.dataset.id);
    },
    { signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('.wc-row');
      if (row?.dataset.id) select(row.dataset.id);
    },
    { signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (!(event.target as HTMLElement).closest?.('.wc-row')) return;
      const list = rows();
      const at = list.findIndex((r) => r === document.activeElement);
      let to = -1;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
        to = Math.min(list.length - 1, at + 1);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') to = Math.max(0, at - 1);
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = list.length - 1;
      if (to < 0) return;
      event.preventDefault();
      event.stopPropagation();
      select(list[to].dataset.id!, true);
    },
    { signal },
  );
  return () => abort.abort();
}

/** The medal banner at the head of a Wildcard result: the medal earned (or why
 * there is none), what it asked for, whether it beats the player's best, and
 * what the session paid. Trusted HTML (all text from the series data or escaped). */
export interface WildcardResultView {
  entry: WildcardEntry;
  position: number;
  cars: number;
  classified: boolean;
  bestLap: number;
  /** The AI driver drove part of the session: no payment, no medal. */
  demonstration: boolean;
  /** Medal on the record before this result. */
  previous: Medal | null;
  payout: Pick<Payout, 'paid' | 'total' | 'reason'>;
  state: 'saving' | 'saved' | 'unsaved' | 'failed';
}
export function wildcardResultHtml(view: WildcardResultView, medal: Medal | null): string {
  const { entry } = view;
  const awarded = view.demonstration ? null : medal;
  let headline: string,
    detail: string,
    mark = '';
  if (view.demonstration) {
    headline = t('NO MEDAL');
    detail = t('The AI driver drove part of this session. Medals and pay need your own driving.');
  } else if (!view.classified) {
    headline = t('NO MEDAL');
    detail = t('Not classified: a medal needs a finish.');
  } else if (awarded) {
    headline = t('{medal} MEDAL', { medal: medalName(awarded) });
    const result =
      entry.ladder.metric === 'position'
        ? t('P{position} of {cars}', { position: view.position, cars: view.cars })
        : t('Best lap {time}', { time: lapStamp(view.bestLap) });
    detail = t(
      entry.ladder.metric === 'position'
        ? '{result}. {medal} asks {need} or better.'
        : '{result}. {medal} asks {need} or faster.',
      {
        result,
        medal: medalName(awarded)[0] + medalName(awarded).slice(1).toLowerCase(),
        need: requirement(entry, awarded),
      },
    );
    if (!view.previous || MEDAL_RANK[awarded] > MEDAL_RANK[view.previous]) mark = t('NEW BEST');
    else if (view.previous === awarded) mark = t('MATCHED YOUR BEST');
  } else {
    headline = t('NO MEDAL');
    const result =
      entry.ladder.metric === 'position'
        ? t('P{position} of {cars}', { position: view.position, cars: view.cars })
        : view.bestLap > 0
          ? t('Best lap {time}', { time: lapStamp(view.bestLap) })
          : t('No valid lap');
    detail = t(
      entry.ladder.metric === 'position'
        ? '{result}. Bronze asks {need} or better.'
        : '{result}. Bronze asks {need} or faster.',
      { result, need: requirement(entry, 'bronze') },
    );
  }
  const pay =
    view.state === 'failed'
      ? [t('NOT SAVED'), '—']
      : view.payout.paid
        ? [view.state === 'saving' ? t('PAYING') : t('PAID'), credits(view.payout.total)]
        : [t('NOT PAID'), '—'];
  return `<section class="wc-result" data-medal="${awarded ?? 'none'}" aria-label="${ta('Wildcard result')}">${medalDisc(awarded, true)}<div class="wc-result-text"><span class="wc-kind">${th('WILDCARD SERIES')} · ${escapeHtml(wildcardTitle(entry))}</span><b class="wc-result-head">${headline}${mark ? ` <em>${mark}</em>` : ''}</b><p>${escapeHtml(detail)}</p></div><div class="wc-result-side"><p class="wc-result-pay"><small>${pay[0]}</small><b>${pay[1]}</b></p><button type="button" data-action="career:wildcard:${entry.id}">${th('WILDCARD BOARD')}</button></div></section>`;
}
