import { describe, expect, it } from 'vitest';
import { newChampionship } from '../src/core/championship.ts';
import { buyVehicle } from '../src/career/economy.ts';
import { disciplineEvents } from '../src/career/ladder.ts';
import {
  focusDiscipline,
  isFirstTime,
  ladderOf,
  seasonPlan,
  tierLabel,
} from '../src/career/next-up.ts';
import {
  DISCIPLINE_IDS,
  liveRegistry,
  venueKind,
  type CareerRegistry,
} from '../src/career/registry.ts';
import { newCareer, type CareerSave } from '../src/career/save.ts';
import { careerHub } from '../src/ui/career-hub.ts';

const live = liveRegistry();
const withBraking = (
  save: CareerSave,
  medal: 'bronze' | 'silver' | 'gold' = 'bronze',
): CareerSave => ({
  ...save,
  licences: { ...save.licences, braking: { medal, best: 3, attempts: 1 } },
});
const hubHtml = (save: CareerSave, registry: CareerRegistry = live) =>
  careerHub(save, registry, { page: 'hub', discipline: 'circuit-cars' });

describe('season plan (what a driver does next)', () => {
  it('sends a brand-new driver to the first licence, with three steps', () => {
    const save = newCareer();
    expect(isFirstTime(save)).toBe(true);
    expect(focusDiscipline(live, save)).toBe('circuit-cars');
    const plan = seasonPlan(live, save);
    expect(plan.firstTime).toBe(true);
    expect(plan.steps.map((s) => s.id)).toEqual(['licence', 'machine', 'race']);
    expect(plan.steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(plan.next.kind).toBe('licence');
    // The action is one the career controller routes (career:licence:<id>).
    expect(plan.next.action).toBe('career:licence:braking');
    expect(plan.next.label).toMatch(/^START THE BRAKING MARKER TEST$/);
  });
  it('after the licence it sends the driver to buy a machine, naming a real price', () => {
    const plan = seasonPlan(live, withBraking(newCareer()));
    expect(plan.firstTime).toBe(false);
    expect(plan.steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(plan.next.kind).toBe('machine');
    expect(plan.next.action).toBe('career:page:dealership');
    expect(plan.steps[1].detail).toMatch(/costs ¤[\d,]+/);
  });
  it('with licence and machine it offers an event the career would start, as CONTINUE', () => {
    const save = buyVehicle(withBraking(newCareer()), live, 'tc1');
    const plan = seasonPlan(live, save);
    expect(plan.steps.map((s) => s.done)).toEqual([true, true, false]);
    expect(plan.next.kind).toBe('event');
    expect(plan.next.label).toBe('CONTINUE');
    const key = plan.next.action.replace('career:start:', '');
    const event = disciplineEvents(live, save, 'circuit-cars').find((e) => e.key === key);
    expect(event?.status).toBe('open');
    expect(event?.kind).toBe('invitational');
  });
  it('resumes a season in progress before anything else', () => {
    let save = buyVehicle(withBraking(newCareer()), live, 'tc1');
    save = { ...save, reputation: { ...save.reputation, 'circuit-cars': 8 } };
    const championship = disciplineEvents(live, save, 'circuit-cars').find(
      (e) => e.kind === 'championship' && e.tier === 'club',
    )!;
    expect(championship.status).toBe('open');
    save = {
      ...save,
      championships: {
        [championship.key]: {
          vehicle: 'tc1',
          season: newChampionship(8, championship.calendar),
          sessions: [],
        },
      },
    };
    const plan = seasonPlan(live, save);
    expect(plan.next.kind).toBe('round');
    expect(plan.next.action).toBe(`career:start:${championship.key}`);
    expect(plan.next.why).toMatch(/^Round 1 of \d+/);
  });
  it('leads with the discipline where the driver has the most reputation', () => {
    const save = newCareer();
    save.reputation['road-bikes'] = 9;
    expect(focusDiscipline(live, save)).toBe('road-bikes');
    const plan = seasonPlan(live, save);
    expect(plan.discipline).toBe('road-bikes');
    expect(plan.next.action).toBe('career:licence:lean');
  });
});

describe('ladder rungs', () => {
  it('marks the first unmet rung NEXT, later ones LOCKED, and says what each asks', () => {
    const rungs = ladderOf(live, newCareer(), 'circuit-cars');
    expect(rungs.map((r) => r.state)).toEqual(['next', 'locked', 'locked', 'locked', 'locked']);
    expect(rungs[0].licences).toEqual([
      { id: 'braking', name: 'Braking marker', need: 'bronze', held: null, ok: false },
    ]);
    expect(rungs[1].reputation).toEqual({ need: 18, have: 0, ok: false });
  });
  it('clears a rung when its licences and reputation are held', () => {
    const save = withBraking(newCareer(), 'silver');
    save.reputation['circuit-cars'] = 20;
    save.licences.cornering = { medal: 'bronze', best: 2, attempts: 1 };
    const rungs = ladderOf(live, save, 'circuit-cars');
    expect(rungs.slice(0, 3).map((r) => r.state)).toEqual(['cleared', 'cleared', 'next']);
    expect(rungs[2].licences.map((l) => l.ok)).toEqual([true, true, false]);
  });
  it('labels a rung with the first word of the tier', () => {
    expect(tierLabel({ name: 'Club and touring' })).toBe('CLUB');
    expect(tierLabel({ name: 'GP prototype' })).toBe('GP');
  });
});

describe('season board markup', () => {
  const html = hubHtml(newCareer());
  it('keeps the contracts the career e2e relies on', () => {
    // One element per discipline carries data-discipline; OPEN or COMING with reasons.
    expect(html.match(/data-discipline="/g)).toHaveLength(DISCIPLINE_IDS.length);
    expect(html.match(/class="career-state" data-state="open"/g)?.length).toBeGreaterThan(0);
    expect(html).toContain('data-action="career:discipline:circuit-cars"');
    // Native buttons only; no animation or transition authored; no focus-skipping.
    expect(html).not.toMatch(/animation|transition|onclick=|<a\s|tabindex="-1"/);
    const tags = [...html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-action="/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(['button']));
  });
  it('shows ONE primary action, the next step, on a new career', () => {
    expect(html).toContain('data-first-time="true"');
    const primary = html.match(/<button class="primary" data-action="([^"]+)">([^<]+)<\/button>/g)!;
    expect(primary).toHaveLength(1);
    expect(primary[0]).toContain('career:licence:braking');
    expect(html).toContain('START HERE');
    expect(html.match(/<li data-state="(now|later|done)">/g)).toHaveLength(3);
    expect(html).toContain('data-state="now"');
  });
  it('shows a returning driver CONTINUE and the wallet and garage', () => {
    const save = buyVehicle(withBraking(newCareer(), 'silver'), live, 'tc1');
    const page = hubHtml(save);
    expect(page).toContain('data-first-time="false"');
    expect(page).toMatch(
      /<button class="primary" data-action="career:start:[^"]+">CONTINUE<\/button>/,
    );
    expect(page).toContain('NEXT UP');
    expect(page).toContain('TC-1 TOURING');
    expect(page).toContain('GARAGE · 1 MACHINE');
    expect(page).toContain(`¤${save.credits.toLocaleString('en')}`);
    // Licence medals are discs with a letter and a text label, never colour alone.
    expect(page).toMatch(/data-medal="silver"[^>]*aria-label="Braking marker: silver"/);
  });
  it('names reputation as a meter with a text value and rung words, never colour alone', () => {
    expect(html).toMatch(/role="meter" aria-label="Circuit cars reputation"/);
    expect(html).toContain('<small>NEXT</small>');
    expect(html).toContain('<small>LOCKED</small>');
    expect(html).toContain('NEXT · CLUB AND TOURING');
  });
  it('lists what is missing for a discipline that cannot run, with no OPEN EVENTS', () => {
    const registry: CareerRegistry = {
      ...live,
      venues: live.venues.filter((v) => venueKind(v) === 'circuit'),
    };
    const page = hubHtml(newCareer(), registry);
    const dirt = page.slice(page.indexOf('data-discipline="off-road"'));
    const lane = dirt.slice(0, dirt.indexOf('</article>'));
    expect(lane).toContain('data-state="coming"');
    expect(lane).toContain('registered yet');
    expect(lane).toContain('VIEW STATUS');
  });
  it('escapes a hostile machine name in the garage', () => {
    const hostile: CareerRegistry = {
      ...live,
      vehicles: live.vehicles.map((v) =>
        v.id === 'tc1' ? { ...v, name: '<img src=x onerror=alert(1)>' } : v,
      ),
    };
    const save = buyVehicle(withBraking(newCareer()), live, 'tc1');
    const page = hubHtml(save, hostile);
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
