import {
  disciplineEvents,
  disciplineTiers,
  licenceAvailability,
  licenceMissing,
  purchaseReasons,
  tierEntry,
  tierVehicles,
  vehiclePrice,
  type CareerEvent,
  type TierDefinition,
} from './ladder.ts';
import { LICENCE_TESTS, medalAtLeast, type LicenceId, type Medal } from './licences.ts';
import {
  DISCIPLINES,
  DISCIPLINE_IDS,
  disciplineStatus,
  type CareerRegistry,
  type DisciplineId,
} from './registry.ts';
import type { CareerSave } from './save.ts';

/** What the season board tells a driver to do next (GAME_DESIGN §3). Everything is
 * derived from the save and the registries by the same functions the career screens
 * use to lock and unlock events, so the board can never name a step the career
 * would refuse: the licences a tier asks for, the machine it needs, the reputation
 * it asks for, then its events. Pure: no DOM, no storage. */

/** A licence a rung asks for, and whether the driver holds it. */
export interface RungLicence {
  id: LicenceId;
  name: string;
  need: Medal;
  held: Medal | null;
  ok: boolean;
}
/** One rung of a discipline's ladder (a tier of `disciplineTiers`). `cleared`:
 * the licences and the reputation are held. `next`: the first rung that is not.
 * `locked`: beyond that. `coming`: no machine of the tier is registered. */
export interface Rung {
  tier: TierDefinition;
  /** Short caps label for the rung: the first word of the tier's name. */
  label: string;
  state: 'cleared' | 'next' | 'locked' | 'coming';
  licences: RungLicence[];
  /** Reputation the rung asks for, and whether the driver has it. */
  reputation: { need: number; have: number; ok: boolean };
  /** The machine the driver owns for this rung (id), else null. */
  entry: string | null;
  machines: number;
}
export function tierLabel(tier: Pick<TierDefinition, 'name'>) {
  return tier.name.split(/\s+/)[0].toUpperCase();
}
export function ladderOf(
  registry: CareerRegistry,
  save: CareerSave,
  discipline: DisciplineId,
): Rung[] {
  const open = disciplineStatus(registry, discipline).state === 'open';
  let nextTaken = false;
  return disciplineTiers(registry, discipline).map((tier) => {
    const machines = tierVehicles(registry, tier).length;
    const licences = tier.licences.map((need) => ({
      id: need.id,
      name: LICENCE_TESTS[need.id].name,
      need: need.medal,
      held: save.licences[need.id]?.medal ?? null,
      ok: medalAtLeast(save.licences[need.id]?.medal, need.medal),
    }));
    const have = save.reputation[discipline] ?? 0;
    const reputation = { need: tier.reputation, have, ok: have >= tier.reputation };
    const gated = licences.every((l) => l.ok) && reputation.ok;
    let state: Rung['state'];
    if (!open || !machines) state = 'coming';
    else if (gated) state = 'cleared';
    else if (!nextTaken) {
      state = 'next';
      nextTaken = true;
    } else state = 'locked';
    return {
      tier,
      label: tierLabel(tier),
      state,
      licences,
      reputation,
      entry: tierEntry(registry, save, tier)?.id ?? null,
      machines,
    };
  });
}

/** One of the three first steps in a discipline: a licence, a machine, a race. */
export interface FirstStep {
  id: 'licence' | 'machine' | 'race';
  done: boolean;
  title: string;
  detail: string;
}
/** What to do next: one action the board can put on a button. */
export interface NextUp {
  kind: 'round' | 'event' | 'licence' | 'machine' | 'meeting' | 'discipline';
  discipline: DisciplineId;
  /** Short title naming the thing (an event, a licence). */
  title: string;
  /** One sentence of why, from the rules. */
  why: string;
  /** Button text. Returning drivers see CONTINUE where the action starts a race. */
  label: string;
  /** The `data-action` the career controller already routes. */
  action: string;
  /** The circuit id the thing runs at (the board draws its real line art), if any. */
  venue: string | null;
}
export interface SeasonPlan {
  discipline: DisciplineId;
  /** No licence, no machine, no result, no season yet: the first-time path applies. */
  firstTime: boolean;
  /** The first rung's licence, machine and race steps; empty when the discipline has no ladder. */
  steps: FirstStep[];
  next: NextUp;
}

const credits = (value: number) => `¤${Math.round(value).toLocaleString('en')}`;

/** A driver with nothing earned yet. */
export function isFirstTime(save: CareerSave) {
  return (
    !Object.values(save.licences).some((l) => l?.medal) &&
    !save.owned.length &&
    !Object.keys(save.results).length &&
    !Object.keys(save.championships).length &&
    !Object.keys(save.festival).length
  );
}

/** The discipline to lead with: the open ladder (not the festival, which has no tiers
 * of licences) where the driver has the most reputation; the circuit ladder on a tie,
 * so a new driver starts where the menu starts. */
export function focusDiscipline(registry: CareerRegistry, save: CareerSave): DisciplineId {
  const order = DISCIPLINE_IDS.filter(
    (id) => DISCIPLINES[id].venue !== 'festival' && disciplineStatus(registry, id).state === 'open',
  );
  if (!order.length) return 'circuit-cars';
  return order.reduce((best, id) => (save.reputation[id] > save.reputation[best] ? id : best));
}

function licenceStep(registry: CareerRegistry, save: CareerSave, tier: TierDefinition) {
  const missing = licenceMissing(save, tier);
  if (!missing.length) return null;
  const need = tier.licences.find((l) => !medalAtLeast(save.licences[l.id]?.medal, l.medal))!;
  const test = LICENCE_TESTS[need.id];
  const availability = licenceAvailability(registry, save, need.id);
  const available = availability.status === 'open';
  return {
    need,
    test,
    action: available ? `career:licence:${need.id}` : 'career:page:licences',
    available,
    venue: availability.venue,
  };
}

/** The cheapest machine of a tier the driver could buy right now (it can race here). */
function cheapestMachine(registry: CareerRegistry, tier: TierDefinition) {
  return (
    tierVehicles(registry, tier)
      .filter((v) => !purchaseReasons(registry, v).length)
      .sort((a, b) => vehiclePrice(registry, a) - vehiclePrice(registry, b))[0] ?? null
  );
}

/** The open event to race in a tier: a season in progress first, then an invitational
 * not yet raced, then a championship not yet started, then the invitational the driver
 * placed worst in. */
function bestEvent(events: readonly CareerEvent[], save: CareerSave, tier: TierDefinition) {
  const open = events.filter(
    (e) => e.tier === tier.id && e.status === 'open' && e.kind !== 'recovery',
  );
  const season = open.find((e) => {
    const s = save.championships[e.key];
    return e.kind === 'championship' && !!s && s.season.results.length < s.season.rounds.length;
  });
  if (season) return { event: season, round: true };
  const unraced = open.find((e) => e.kind === 'invitational' && !save.results[e.key]);
  if (unraced) return { event: unraced, round: false };
  const championship = open.find((e) => e.kind === 'championship');
  if (championship) return { event: championship, round: false };
  const worst = open
    .filter((e) => e.kind === 'invitational')
    .sort(
      (a, b) => (save.results[b.key]?.bestPosition ?? 0) - (save.results[a.key]?.bestPosition ?? 0),
    )[0];
  return worst ? { event: worst, round: false } : null;
}

/** The first steps of the lowest rung with machines, and the single next action. */
export function seasonPlan(registry: CareerRegistry, save: CareerSave): SeasonPlan {
  const discipline = focusDiscipline(registry, save);
  const firstTime = isFirstTime(save);
  const tiers = disciplineTiers(registry, discipline).filter(
    (t) => tierVehicles(registry, t).length,
  );
  const events = disciplineEvents(registry, save, discipline);
  const meeting = events.find((e) => e.kind === 'recovery' && e.status === 'open') ?? null;
  const meetingNext = (why: string): NextUp => ({
    kind: 'meeting',
    discipline,
    title: meeting?.name ?? 'Club meeting',
    why,
    label: firstTime ? 'ENTER THE CLUB MEETING' : 'CONTINUE',
    action: `career:start:${discipline}.recovery`,
    venue: meeting?.definition?.circuit ?? null,
  });
  if (!tiers.length || !meeting) {
    return {
      discipline,
      firstTime,
      steps: [],
      next: {
        kind: 'discipline',
        discipline,
        title: DISCIPLINES[discipline].name,
        why: DISCIPLINES[discipline].skill,
        label: 'OPEN EVENTS',
        action: `career:discipline:${discipline}`,
        venue: null,
      },
    };
  }
  const first = tiers[0];
  // The three first steps are those of the lowest rung.
  const lic = licenceStep(registry, save, first);
  const entry = tierEntry(registry, save, first);
  const cheap = cheapestMachine(registry, first);
  const raced = Object.keys(save.results).some((k) => k.startsWith(`${discipline}.`));
  const steps: FirstStep[] = [];
  if (first.licences.length) {
    const need = lic?.need ?? first.licences[0];
    const test = LICENCE_TESTS[need.id];
    steps.push({
      id: 'licence',
      done: !lic,
      title: `${test.name} licence`,
      detail: `${test.skill}, scored from your own telemetry. ${need.medal[0].toUpperCase()}${need.medal.slice(1)} or better opens ${first.name} events. Solo, on a loaned machine.`,
    });
  }
  steps.push({
    id: 'machine',
    done: !!entry,
    title: entry ? 'Machine in your garage' : `Buy a machine for ${first.name}`,
    detail: cheap
      ? save.credits >= vehiclePrice(registry, cheap)
        ? `The ${cheap.name} costs ${credits(vehiclePrice(registry, cheap))}. You have ${credits(save.credits)}.`
        : `The ${cheap.name} costs ${credits(vehiclePrice(registry, cheap))}; you are ${credits(vehiclePrice(registry, cheap) - save.credits)} short. The club meeting pays a quarter of the full rate.`
      : 'Nothing in this rung can race in this build yet.',
  });
  steps.push({
    id: 'race',
    done: raced,
    title: 'Race an invitational',
    detail: `${first.laps} laps against seven cars of your class. Reputation comes from finishing and from the objectives on each card.`,
  });

  // The single next action.
  const ready = tiers.filter(
    (t) =>
      !licenceMissing(save, t).length &&
      (save.reputation[discipline] ?? 0) >= t.reputation &&
      tierEntry(registry, save, t),
  );
  let next: NextUp;
  if (ready.length) {
    const tier = ready[ready.length - 1];
    const pick = bestEvent(events, save, tier);
    if (pick) {
      const e = pick.event;
      next = {
        kind: pick.round ? 'round' : 'event',
        discipline,
        title: e.name,
        why: pick.round
          ? `Round ${(save.championships[e.key]?.season.results.length ?? 0) + 1} of ${save.championships[e.key]?.season.rounds.length ?? 0}. Your season is in progress.`
          : e.kind === 'championship'
            ? `A season of ${e.calendar.length} rounds in the ${tier.name} rung.`
            : save.results[e.key]
              ? `You finished P${save.results[e.key].bestPosition} here. Beat it for reputation.`
              : `${e.definition?.laps ?? tier.laps} laps, ${(e.definition?.opponents ?? 7) + 1} cars. Pays ×${e.stakes}.`,
        label: firstTime ? 'START THE EVENT' : 'CONTINUE',
        action: `career:start:${e.key}`,
        venue: e.definition?.circuit ?? null,
      };
    } else
      next = meetingNext(
        'Nothing in the open rung is free to start; the club meeting always runs.',
      );
  } else if (lic) {
    next = {
      kind: 'licence',
      discipline,
      title: `${lic.test.name} licence`,
      why: `${lic.test.brief} ${lic.need.medal[0].toUpperCase()}${lic.need.medal.slice(1)} or better opens ${first.name} events.`,
      label: firstTime ? `START THE ${lic.test.name.toUpperCase()} TEST` : 'START THE TEST',
      action: lic.action,
      venue: lic.venue,
    };
  } else if (!entry) {
    next = {
      kind: 'machine',
      discipline,
      title: `Buy a machine for ${first.name}`,
      why: cheap
        ? `Events race in a machine you own. The ${cheap.name} is ${credits(vehiclePrice(registry, cheap))}; you have ${credits(save.credits)}.`
        : 'Events race in a machine you own.',
      label: 'OPEN THE DEALERSHIP',
      action: 'career:page:dealership',
      venue: null,
    };
  } else {
    next = meetingNext(
      `${first.name} asks for ${first.reputation} reputation; you have ${save.reputation[discipline] ?? 0}. The club meeting pays a quarter of the full rate.`,
    );
  }
  return { discipline, firstTime, steps, next };
}
