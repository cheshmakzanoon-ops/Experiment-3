import { fixed, t, ta, th } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { DISCIPLINES } from '../career/registry.ts';
import type { SeasonPlan } from '../career/next-up.ts';

/** The results screen as a board (art direction section 1: "results: a timing sheet with
 * the player's row highlighted by the marshal's highlighter"). Pure markup over a final
 * snapshot: the podium of the top three, the player's own result with the gaps that
 * matter (to the winner, to the fastest lap), the classification, what the career pays
 * and the next thing to do. Nothing here is a guess: every figure is read from the
 * snapshot the simulation ended with, or from the career's own plan. */
export interface ResultRow {
  id: number;
  position: number;
  name: string;
  laps: number;
  /** Race time including penalties, seconds; 0 when the car did not finish. */
  finish: number;
  best: number;
  penalty: number;
  retired: boolean;
  you: boolean;
}
export const clock = (seconds: number) =>
  seconds > 0
    ? `${Math.floor(seconds / 60)}:${fixed(seconds % 60, 3).padStart(6, '0')}`
    : '—:——.———';
const gap = (seconds: number) => `+${fixed(seconds, 3)} ${t('s')}`;
const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Every car in finishing order. `name(id)` supplies the display name (the player's own for car 0). */
export function resultRows(frame: Float32Array, name: (id: number) => string): ResultRow[] {
  return Array.from({ length: Math.round(frame[H.CARS]) }, (_, id) => id)
    .sort((a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK])
    .map((id, index) => {
      const p = carBase(id);
      return {
        id,
        position: index + 1,
        name: name(id),
        laps: Math.round(frame[p + F.LAPS]),
        finish: frame[p + F.FINISH] > 0 ? frame[p + F.FINISH] : 0,
        best: frame[p + F.BEST_LAP],
        penalty: frame[p + F.PENALTY],
        retired: !!frame[p + F.RETIRED],
        you: id === 0,
      };
    });
}

/** The figures under the podium. A null gap means there is nothing honest to compare. */
export interface ResultFacts {
  position: number;
  field: number;
  finished: boolean;
  raceTime: number;
  /** Seconds behind the winner; for the winner, the margin over second place. */
  toWinner: number | null;
  winner: boolean;
  bestLap: number;
  /** The session's fastest lap and who set it; `toFastest` is the player's gap to it (0: the player). */
  fastest: { name: string; time: number; you: boolean } | null;
  toFastest: number | null;
}
export function resultFacts(rows: readonly ResultRow[]): ResultFacts | null {
  const you = rows.find((r) => r.you);
  if (!you) return null;
  const winner = rows[0];
  const second = rows[1];
  const timed = rows.filter((r) => r.best > 0);
  const fastest = timed.length ? timed.reduce((a, b) => (b.best < a.best ? b : a)) : null;
  const gapTo =
    you.finish > 0 && winner.finish > 0
      ? you.position === 1
        ? second && second.finish > 0
          ? second.finish - you.finish
          : null
        : you.finish - winner.finish
      : null;
  // A gap that is not positive means the snapshot's order and times disagree: say nothing.
  const toWinner = gapTo !== null && gapTo > 0 ? gapTo : null;
  return {
    position: you.position,
    field: rows.length,
    finished: you.finish > 0,
    raceTime: you.finish,
    toWinner,
    winner: you.position === 1,
    bestLap: you.best,
    fastest: fastest ? { name: fastest.name, time: fastest.best, you: fastest.you } : null,
    toFastest: fastest && you.best > 0 ? you.best - fastest.best : null,
  };
}

const ordinal = (n: number) => `P${n}`;
const PLACE_MEDAL = ['gold', 'silver', 'bronze'] as const;
/** The top three on three steps (second, first, third in view; first, second, third in the
 * reading order, so a screen reader hears them in order). The player's step is the amber one. */
export function podiumHtml(rows: readonly ResultRow[]) {
  if (rows.length < 3) return '';
  return `<ol class="rs-podium" aria-label="${ta('Podium')}">${rows
    .slice(0, 3)
    .map(
      (r, i) =>
        `<li class="rs-step" data-place="${i + 1}"${r.you ? ' data-you="true"' : ''}><span class="wc-medal" data-medal="${PLACE_MEDAL[i]}" aria-hidden="true"><b>${i + 1}</b></span><strong>${esc(r.name)}</strong><small>${r.finish > 0 ? clock(r.finish) : r.retired ? th('DNF') : th('RUNNING')}</small>${r.you ? `<em>${th('YOU')}</em>` : ''}</li>`,
    )
    .join('')}</ol>`;
}

/** The player's result: the position, and the gaps. */
export function factsHtml(f: ResultFacts) {
  const rows: [string, string, string?][] = [];
  if (f.finished) rows.push([N_('RACE TIME'), clock(f.raceTime)]);
  if (f.toWinner !== null)
    rows.push([
      f.winner ? N_('MARGIN OVER 2ND') : N_('GAP TO WINNER'),
      gap(f.toWinner),
      f.winner ? 'good' : '',
    ]);
  rows.push([N_('BEST LAP'), clock(f.bestLap)]);
  if (f.fastest && f.toFastest !== null)
    rows.push([
      N_('VS FASTEST LAP'),
      f.fastest.you ? t('FASTEST LAP') : gap(f.toFastest),
      f.fastest.you ? 'good' : '',
    ]);
  return `<dl class="rs-facts">${rows
    .map(
      ([k, v, tone]) =>
        `<div${tone ? ` data-tone="${tone}"` : ''}><dt>${th(k)}</dt><dd>${v}</dd></div>`,
    )
    .join('')}</dl>`;
}

/** The position as a stencil numeral with the field beside it. */
export function positionHtml(f: ResultFacts) {
  const medal =
    f.finished && f.position <= 3
      ? `<span class="wc-medal wc-medal-lg" data-medal="${PLACE_MEDAL[f.position - 1]}" aria-hidden="true"><b>${f.position}</b></span>`
      : '';
  return `<div class="rs-position" data-place="${f.position <= 3 ? f.position : 'out'}"><b>${f.finished ? ordinal(f.position) : th('END')}</b><span>${f.finished ? th('OF {field}', { field: f.field }) : th('SESSION ENDED')}</span>${medal}</div>`;
}

/** The next thing to do, from the career's own plan (career/next-up.ts). */
export interface ResultsNext {
  title: string;
  why: string;
  label: string;
  action: string;
  /** The discipline's short name (CIRCUIT, BIKES...). */
  discipline: string;
}
export function nextFromPlan(plan: SeasonPlan): ResultsNext {
  const n = plan.next;
  return {
    title: n.title,
    why: n.why,
    label: n.label,
    action: n.action,
    discipline: DISCIPLINES[n.discipline].short,
  };
}
export function nextHtml(next: ResultsNext | null) {
  if (!next) return '<section class="rs-next" hidden></section>';
  return `<section class="rs-next" aria-label="${ta('Next up')}"><h3 class="rs-label">${th('NEXT UP')} · ${esc(next.discipline)}</h3><h4>${esc(next.title)}</h4><p>${esc(next.why)}</p><button type="button" data-action="${esc(next.action)}">${esc(next.label)}</button></section>`;
}

/** The classification: the same six columns as before, the player's row highlighted. */
export function classificationHtml(rows: readonly ResultRow[]) {
  return `<table class="results rs-table"><thead><tr><th>${th('POS')}</th><th>${th('DRIVER')}</th><th>${th('LAPS')}</th><th>${th('TIME + PEN.')}</th><th>${th('BEST LAP')}</th><th>${th('PEN.')}</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr${r.you ? ' class="you"' : ''}><td>${r.position}</td><td>${esc(r.name)}</td><td>${r.laps}</td><td>${r.finish > 0 ? clock(r.finish) : r.retired ? th('DNF') : th('RUNNING')}</td><td>${clock(r.best)}</td><td>${r.penalty.toFixed(0)}s</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

/** The whole body of the race results screen. `lead`, `extra` and `offroad` are trusted HTML
 * built elsewhere (the Wildcard banner, the career payment, the terrain results). */
export function resultsBoardHtml(parts: {
  rows: readonly ResultRow[];
  heading: string;
  lead: string;
  extra: string;
  offroad: string;
  note: string;
  next: ResultsNext | null;
  standings: boolean;
}) {
  const facts = resultFacts(parts.rows);
  const next = nextHtml(parts.next);
  // The next step sits under the figures when there are figures, else under the sheet.
  const hero = facts
    ? `${positionHtml(facts)}${podiumHtml(parts.rows)}${factsHtml(facts)}${next}`
    : '';
  return `<section class="rs" data-place="${facts && facts.finished && facts.position <= 3 ? facts.position : 'out'}"><span class="eyebrow">${th('CHEQUERED FLAG / SESSION CLASSIFICATION')}</span><h2>${esc(parts.heading)}</h2>${parts.lead}<div class="rs-board"><div class="rs-hero">${hero}</div><div class="rs-sheet">${classificationHtml(parts.rows)}${parts.offroad}${parts.note ? `<p class="championship-note">${esc(parts.note)}</p>` : ''}${parts.extra}${facts ? '' : next}</div></div><div class="dialog-buttons inline"><button class="primary" data-action="replay">${th('WATCH REPLAY')}</button><button data-action="restart">${th('RACE AGAIN')}</button><button data-action="resultsShare">${th('SHARE CARD')}</button><button data-action="telemetry">${th('TELEMETRY')}</button>${parts.standings ? `<button data-action="championship">${th('STANDINGS')}</button>` : ''}<button data-action="photo">${th('PHOTO STUDIO')}</button><button data-action="menu">${th('PADDOCK')}</button></div></section>`;
}
