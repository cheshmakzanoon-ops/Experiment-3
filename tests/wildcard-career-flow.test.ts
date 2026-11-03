import { describe, expect, it } from 'vitest';
import { CareerController, type CareerHost } from '../src/career/controller.ts';
import {
  wildcardCareerEvent,
  wildcardEntry,
  wildcardKey,
  wildcardMedal,
  wildcardSession,
} from '../src/career/wildcard-series.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

/** The career controller and the Wildcard result, fed by the production simulation (a real
 * seeded AI race, as scripts/wildcard-races.ts runs it) instead of a hand-made frame: the
 * snapshot's own rank, finish and best-lap fields decide the medal, the pay and the record. */
function career() {
  const stored = new Map<string, unknown>();
  const shown = { lead: '', extra: '', modal: '', changed: 0 };
  const host: CareerHost = {
    store: {
      read: async (key) => stored.get(key),
      write: async (key, value) => void stored.set(key, value),
      writeWithBackup: async (key, value) => void stored.set(key, value),
    },
    modal: (html) => (shown.modal = html),
    modalRoot: () => ({ querySelector: () => null }) as unknown as HTMLElement,
    toast: () => {},
    setResultsExtra: (html) => (shown.extra = html),
    setResultsLead: (html) => (shown.lead = html),
    changed: () => void shown.changed++,
    start: () => {},
    pause: () => {},
    state: () => 'results',
    track: () => ({}) as never,
    setup: () => DEFAULT_OPTIONS.setup,
    assist: () => 'sport',
  };
  return { controller: new CareerController(host), shown, stored };
}
const session = (id: string) => {
  const entry = wildcardEntry(id)!;
  return {
    entry,
    context: {
      kind: 'race' as const,
      event: { ...wildcardCareerEvent(entry), tier: 'wildcard' },
      licence: null,
      vehicle: [entry.event.vehicles].flat()[0],
      setup: null,
      round: -1,
      light: entry.lighting,
    },
  };
};
const settled = async (controller: CareerController) => {
  // The payment is written through the controller's queue; let it drain.
  await controller.transact((save) => save);
};

describe('a Wildcard race through the career, from a real simulated session', () => {
  it('pays, medals and records a finished race exactly as the board then reads it', async () => {
    const { entry, context } = session('grand-prix-bikes-on-the-runway');
    const sim = new Simulation(wildcardSession(entry, DEFAULT_OPTIONS));
    sim.autoPlayer = true;
    const DT = 1 / 120;
    for (let t = 0; t < 600 && sim.race.phase !== PHASE.FINISHED; t += DT) sim.step(DT);
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    const frame = sim.makeFrame();
    expect(frame[H.PHASE]).toBe(3);
    const o = carBase(0);
    const position = Math.round(frame[o + F.RANK]);
    expect(position).toBeGreaterThanOrEqual(1);
    expect(position).toBeLessThanOrEqual(entry.event.opponents + 1);

    const { controller, shown } = career();
    controller.begin(context, 'flow-race');
    expect(controller.attackFinished(frame)).toBeNull(); // a race ends at the chequered flag
    expect(controller.finish(frame, undefined)).toBe(true);
    await settled(controller);

    const medal = wildcardMedal(entry, {
      position,
      classified: true,
      bestLap: frame[o + F.BEST_LAP],
    });
    expect(shown.lead).toContain('wc-result');
    expect(shown.lead).toContain(`P${position} of ${entry.event.opponents + 1}`);
    expect(shown.lead).toContain(medal ? `data-medal="${medal}"` : 'data-medal="none"');
    expect(shown.lead).toContain(`data-action="career:wildcard:${entry.id}"`);
    // Paid and recorded by the career's own rules, under the series' record key.
    const record = controller.save.results[wildcardKey(entry)];
    expect(record).toMatchObject({ bestPosition: position, starts: 1 });
    expect(controller.save.credits).toBeGreaterThan(0);
    expect(controller.save.ledger.at(-1)!.label).toContain(entry.title);
    expect(shown.lead).toContain('PAID');
    expect(shown.extra).toContain('career-payout');
    expect(shown.extra).not.toContain('data-action="career"'); // the board button replaces CAREER
    // The same session id is never paid twice (a restarted result page, a second finish).
    const before = controller.save.credits;
    controller.finish(frame, undefined);
    await settled(controller);
    expect(controller.save.credits).toBe(before);
    expect(controller.save.results[wildcardKey(entry)].starts).toBe(1);
  }, 180000);

  it('does not medal or pay a session the AI driver drove', async () => {
    const { entry, context } = session('grand-prix-bikes-on-the-runway');
    const sim = new Simulation(wildcardSession(entry, DEFAULT_OPTIONS));
    sim.autoPlayer = true;
    for (let i = 0; i < 120 * 4; i++) sim.step(1 / 120);
    const frame = sim.makeFrame();
    const { controller, shown } = career();
    controller.begin(context, 'flow-ai');
    controller.observe(frame, true); // the AI driver is on
    controller.finish(frame, undefined);
    await settled(controller);
    expect(shown.lead).toContain('NO MEDAL');
    expect(shown.lead).toContain('AI driver');
    expect(controller.save.results[wildcardKey(entry)]).toBeUndefined();
  });
});

describe('a Wildcard time attack (a time trial has no chequered flag)', () => {
  it('ends when the laps are done, then medals the best lap and pays', async () => {
    const { entry, context } = session('hypercar-roof-deck-attack');
    expect(entry.rules).toContain('time-attack');
    const sim = new Simulation(wildcardSession(entry, DEFAULT_OPTIONS));
    sim.autoPlayer = true;
    const { controller, shown } = career();
    controller.begin(context, 'flow-attack');
    const DT = 1 / 120;
    let ended: Float32Array | null = null,
      firstLap: Float32Array | null = null;
    for (let t = 0; t < 400 && !ended; t += DT) {
      sim.step(DT);
      if (Math.round(t / DT) % 60) continue; // look once a (simulated) half second
      const frame = sim.makeFrame();
      const lapsDone = Math.round(frame[carBase(0) + F.LAPS]);
      // It never ends early, and the session itself never reaches the chequered flag.
      if (lapsDone < entry.event.laps) {
        expect(controller.attackFinished(frame)).toBeNull();
        firstLap ??= lapsDone >= 1 ? frame : null;
      }
      ended = controller.attackFinished(frame);
      expect(frame[H.PHASE]).not.toBe(3);
    }
    expect(firstLap).not.toBeNull();
    expect(ended).not.toBeNull();
    const o = carBase(0);
    // The settled copy carries the race time as the player's finish, and a valid best lap.
    expect(ended![o + F.FINISH]).toBeGreaterThan(entry.event.laps * 30);
    expect(ended![o + F.BEST_LAP]).toBeGreaterThan(30);
    // Once only.
    expect(controller.attackFinished(sim.makeFrame())).toBeNull();

    controller.finish(ended!, undefined);
    await settled(controller);
    const best = ended![o + F.BEST_LAP];
    const medal = wildcardMedal(entry, { position: 1, classified: true, bestLap: best });
    expect(medal).not.toBeNull(); // the AI benchmark lap earns at least bronze
    expect(shown.lead).toContain(`data-medal="${medal}"`);
    expect(shown.lead).toMatch(/Best lap \d:\d\d\.\d\d\./);
    const record = controller.save.results[wildcardKey(entry)];
    expect(record.starts).toBe(1);
    expect(record.bestLap).toBeCloseTo(best, 3);
    expect(controller.save.credits).toBeGreaterThan(0);
  }, 180000);

  it('is not triggered by an ordinary event, a licence or no session at all', () => {
    const { controller } = career();
    const frame = new Float32Array(H.CARS + 8 + carBase(1));
    expect(controller.attackFinished(frame)).toBeNull(); // no session
    const { context } = session('grand-prix-bikes-on-the-runway');
    controller.begin(context, 'x');
    expect(controller.attackFinished(frame)).toBeNull(); // a race, not a time attack
    controller.begin(null, 'y');
    expect(controller.attackFinished(frame)).toBeNull();
  });
});
