import { describe, expect, it } from 'vitest';
import { racePayout } from '../src/career/economy.ts';
import { newCareer } from '../src/career/save.ts';
import {
  wildcardCareerEvent,
  wildcardEntry,
  wildcardKey,
  wildcardSeries,
} from '../src/career/wildcard-series.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { WEATHER_CATALOGUE } from '../src/simulation/weather-catalogue.ts';
import { CONTINUE_FIELDS, describeContinue, validateContinue } from '../src/ui/continue-entry.ts';
import {
  bestMedal,
  maximumPay,
  wildcardBoardHtml,
  wildcardProgress,
  wildcardResultHtml,
  type WildcardResultView,
} from '../src/ui/wildcard-board.ts';

/** A career with a few results on the Wildcard records (`save.results['wildcard.<id>']`). */
function played() {
  const save = newCareer();
  const put = (id: string, bestPosition: number, bestLap = 0, starts = 1) => {
    save.results[wildcardKey({ id })] = { bestPosition, bestLap, starts };
  };
  put('descent-in-the-cloud', 1); // gold
  put('formula-on-the-wall', 2); // silver (P3 or better)
  put('hypercars-in-the-harbour', 5); // bronze (P5 or better)
  put('karts-after-dark', 6); // started, no medal
  put('hypercar-roof-deck-attack', 1, 40.8); // time attack: gold needs 40.96 s
  return save;
}

describe('the Wildcard board', () => {
  const html = wildcardBoardHtml(played());
  const series = wildcardSeries();

  it('lists every event once, with a programme page for each and exactly one showing', () => {
    expect((html.match(/class="wc-row"/g) ?? []).length).toBe(series.length);
    expect((html.match(/class="wc-detail"/g) ?? []).length).toBe(series.length);
    expect((html.match(/class="wc-detail"[^>]*hidden/g) ?? []).length).toBe(series.length - 1);
    for (const e of series) {
      expect(html, e.id).toContain(`data-id="${e.id}"`);
      expect(html, e.id).toContain(`data-action="career:wildcardGo:${e.id}"`);
    }
  });
  it('keeps the rows a radio group with one tab stop, on the chosen event', () => {
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(series.length);
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    const chosen = wildcardBoardHtml(played(), 'knobblies-on-the-banking');
    expect(chosen).toMatch(
      /data-id="knobblies-on-the-banking"[^>]*>|aria-checked="true" tabindex="0" data-id="knobblies-on-the-banking"/,
    );
    expect(chosen).toContain('data-selected="knobblies-on-the-banking"');
    // Without a choice the board opens on the first event with no medal (the 4th here).
    expect(html).toContain('data-selected="karts-after-dark"');
    // An empty career opens on the first event.
    expect(wildcardBoardHtml(null)).toContain(`data-selected="${series[0].id}"`);
  });
  it('shows the machine, the real venue and the pitch from the data', () => {
    for (const e of series) {
      const detail = html.slice(html.indexOf(`<section class="wc-detail" data-id="${e.id}"`));
      const end = detail.indexOf('</section>');
      const page = detail.slice(0, end);
      expect(page, e.id).toContain(VEHICLES[[e.event.vehicles].flat()[0]].name);
      expect(page, e.id).toContain(
        CIRCUITS[e.event.circuit].catalogue!.venueName.toUpperCase().replace(/&/g, '&amp;'),
      );
      expect(page, e.id).toContain(WEATHER_CATALOGUE[e.event.weather].tag);
      // The venue's own line art (track-art.ts), not a placeholder.
      expect(page, e.id).toMatch(
        /<svg class="ta wc-map-art"[^>]*><path class="ta-road" d="M[\d.,L-]+Z"/,
      );
      expect(page, e.id).toContain('MACHINES ARE LOANED');
    }
  });
  it('prints the medal ladder and the player best from the career record', () => {
    const page = (id: string) => {
      const start = html.indexOf(`<section class="wc-detail" data-id="${id}"`);
      return html.slice(start, html.indexOf('</section>', start));
    };
    // Position ladder: gold P1 / silver P3 / bronze P5 on a six-car grid.
    expect(page('descent-in-the-cloud')).toContain('FINISH P1 OR BETTER');
    expect(page('descent-in-the-cloud')).toContain('FINISH P3 OR BETTER');
    expect(page('descent-in-the-cloud')).toContain('FINISH P5 OR BETTER');
    expect(page('descent-in-the-cloud')).toContain('BEST P1 · 1 START');
    // Time attack: the ladder is lap times and the record is a lap.
    expect(page('hypercar-roof-deck-attack')).toContain(
      'LAP 40.96 OR FASTER'.replace('40.96', '0:40.96'),
    );
    expect(page('hypercar-roof-deck-attack')).toContain('BEST 0:40.80 · 1 START');
    expect(page('knobblies-on-the-banking')).toContain('NOT RUN YET');
    // The earned rungs say EARNED; a started event with no medal earns none.
    expect((page('formula-on-the-wall').match(/<em>EARNED<\/em>/g) ?? []).length).toBe(2);
    expect(page('karts-after-dark')).not.toContain('EARNED');
    expect(page('karts-after-dark')).toContain('BEST P6 · 1 START');
  });
  it('reads the best medal with the series own rule, and tallies them', () => {
    const save = played();
    const medal = (id: string) => bestMedal(wildcardEntry(id)!, save);
    expect(medal('descent-in-the-cloud')).toBe('gold');
    expect(medal('formula-on-the-wall')).toBe('silver');
    expect(medal('hypercars-in-the-harbour')).toBe('bronze');
    expect(medal('karts-after-dark')).toBeNull();
    expect(medal('knobblies-on-the-banking')).toBeNull();
    expect(medal('hypercar-roof-deck-attack')).toBe('gold');
    expect(bestMedal(wildcardEntry('descent-in-the-cloud')!, null)).toBeNull();
    const progress = wildcardProgress(save);
    expect(progress.total).toBe(21);
    expect(progress.crossDiscipline).toBe(14);
    expect(progress.medals).toEqual({ gold: 2, silver: 1, bronze: 1 });
    expect(progress.medalled).toBe(4);
    // The next event is the first (in menu order) without a medal.
    expect(progress.next?.id).toBe('karts-after-dark');
    expect(wildcardProgress(null)).toMatchObject({ medalled: 0, next: { id: series[0].id } });
    expect(html).toContain('<b>2</b><span class="wc-tally-name">GOLD</span>');
    expect(html).toContain('<b>4</b><span class="wc-tally-name">OF 21 MEDALLED</span>');
  });
  it('states the most an event can pay by the career own payment rules', () => {
    for (const e of series) {
      const n = e.event.opponents + 1;
      const perfect = racePayout(wildcardCareerEvent(e), {
        session: 'x',
        position: 1,
        cars: n,
        classified: true,
        demonstration: false,
        penalties: 0,
        contactEnergy: 0,
        gridSlot: n - 1,
        bestLap: 1,
      });
      expect(maximumPay(e), e.id).toBe(perfect.total);
      expect(maximumPay(e), e.id).toBeGreaterThan(9000);
    }
    // A six-car win with every line: 9,000 + 5 beaten x 1,500 + clean 2,000 + contact 1,500 + 2,500 + 1,500.
    expect(maximumPay(wildcardEntry('descent-in-the-cloud')!)).toBe(24000);
  });
  it('escapes text and carries no placeholder copy', () => {
    expect(html).not.toMatch(/undefined|NaN|\[object|lorem|coming soon/i);
    expect(html).toContain('aria-label="Close Wildcard Series"');
  });
});

describe('the Wildcard result banner', () => {
  const entry = wildcardEntry('karts-after-dark')!;
  const base = (over: Partial<WildcardResultView> = {}): WildcardResultView => ({
    entry,
    position: 1,
    cars: 6,
    classified: true,
    bestLap: 58.4,
    demonstration: false,
    previous: null,
    payout: { paid: true, total: 28500, reason: null },
    state: 'saved',
    ...over,
  });
  it('names the medal, what it asked for and what was paid', () => {
    const gold = wildcardResultHtml(base(), 'gold');
    expect(gold).toContain('data-medal="gold"');
    expect(gold).toContain('GOLD MEDAL');
    expect(gold).toContain('P1 of 6. Gold asks P1 or better.');
    expect(gold).toContain('¤28,500');
    expect(gold).toContain('PAID');
    expect(gold).toContain('NEW BEST');
    expect(gold).toContain(`data-action="career:wildcard:${entry.id}"`);
  });
  it('marks a repeat of the best medal, and says nothing when a better one stands', () => {
    expect(wildcardResultHtml(base({ previous: 'gold' }), 'gold')).toContain('MATCHED YOUR BEST');
    const silver = wildcardResultHtml(base({ position: 3, previous: 'gold' }), 'silver');
    expect(silver).toContain('SILVER MEDAL');
    expect(silver).not.toMatch(/NEW BEST|MATCHED/);
    expect(wildcardResultHtml(base({ position: 3, previous: 'bronze' }), 'silver')).toContain(
      'NEW BEST',
    );
  });
  it('says why there is no medal: out of the ladder, not classified, AI driven', () => {
    const missed = wildcardResultHtml(base({ position: 6 }), null);
    expect(missed).toContain('NO MEDAL');
    expect(missed).toContain('P6 of 6. Bronze asks P5 or better.');
    expect(wildcardResultHtml(base({ classified: false }), 'gold')).toContain('Not classified');
    const ai = wildcardResultHtml(base({ demonstration: true }), 'gold');
    expect(ai).toContain('NO MEDAL');
    expect(ai).toContain('AI driver');
    expect(ai).toContain('data-medal="none"');
  });
  it('reads a time attack by its lap, and shows the payment state honestly', () => {
    const attack = wildcardEntry('hypercar-roof-deck-attack')!;
    const view = base({ entry: attack, position: 1, cars: 1, bestLap: 41.2 });
    expect(wildcardResultHtml(view, 'silver')).toContain(
      'Best lap 0:41.20. Silver asks 0:42.61 or faster.',
    );
    expect(wildcardResultHtml({ ...view, state: 'failed' }, 'silver')).toContain('NOT SAVED');
    expect(wildcardResultHtml({ ...view, state: 'saving' }, 'silver')).toContain('PAYING');
    expect(
      wildcardResultHtml({ ...view, payout: { paid: false, total: 0, reason: 'x' } }, 'silver'),
    ).toContain('NOT PAID');
  });
});

describe('CONTINUE: the remembered entry', () => {
  const form = {
    version: 1,
    kind: 'form',
    fields: {
      mode: 'race',
      circuit: 'vellamar',
      vehicle: 'apx01',
      laps: '3',
      weather: 'clear',
      opponents: '7',
      compound: 'medium',
      assist: 'sport',
      startSlot: 'pole',
    },
  };
  it('round-trips a form entry and a Wildcard entry, and refuses anything else', () => {
    expect(validateContinue(form)).toEqual(form);
    expect(validateContinue({ version: 1, kind: 'wildcard', id: 'karts-after-dark' })).toEqual({
      version: 1,
      kind: 'wildcard',
      id: 'karts-after-dark',
    });
    expect(validateContinue(JSON.parse(JSON.stringify(form)))).toEqual(form);
    for (const bad of [
      null,
      undefined,
      'x',
      {},
      { ...form, version: 2 },
      { ...form, kind: 'other' },
      { version: 1, kind: 'wildcard', id: 'no-such-event' },
      { ...form, fields: { ...form.fields, circuit: 'no-such-venue' } },
      { ...form, fields: { ...form.fields, mode: 'drift' } },
      { ...form, fields: { ...form.fields, laps: 3 } },
      { ...form, fields: { ...form.fields, vehicle: '' } },
    ])
      expect(validateContinue(bad), JSON.stringify(bad)).toBeNull();
    expect(Object.keys(validateContinue(form)!.kind === 'form' ? form.fields : {})).toEqual([
      ...CONTINUE_FIELDS,
    ]);
  });
  it('describes what CONTINUE will launch in the player language', () => {
    expect(describeContinue(validateContinue(form)!)).toEqual({
      title: 'APX-01 · VELLAMAR COAST',
      detail: '3 LAPS',
    });
    const timed = validateContinue({ ...form, fields: { ...form.fields, mode: 'time-trial' } })!;
    expect(describeContinue(timed).detail).toBe('TIME TRIAL');
    const festival = validateContinue({ ...form, fields: { ...form.fields, mode: 'festival' } })!;
    expect(describeContinue(festival)).toEqual({ title: 'APX-01 · SOLVANE', detail: 'FESTIVAL' });
    expect(
      describeContinue(validateContinue({ version: 1, kind: 'wildcard', id: 'karts-after-dark' })!),
    ).toEqual({ title: 'KARTS AFTER DARK', detail: 'WILDCARD SERIES' });
  });
});
