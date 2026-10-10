import { Simulation } from '../simulation/world.ts';
import type { Compound, Controls, SessionOptions } from '../simulation/config.ts';

/**
 * Flashback (D31 gameplay-flashback).
 *
 * The simulation is deterministic per tick (fixed 1/120 s, seeded), so a past
 * state is recreated exactly by re-simulating the session from its start with
 * the same inputs. The worker logs every input it applies, stamped with the
 * simulation tick it was applied before (`Simulation.tick` at that moment):
 * driver controls (including the pause reset and the 0.4 watchdog brake), pit
 * requests and the AI-demonstration toggle. `Resimulation` replays the log in
 * slices of `FLASHBACK.slice` steps so the worker stays responsive.
 */
export const FLASHBACK = Object.freeze({
  /** How far back a flashback may go (s). */
  window: 30,
  /** Flashbacks per race. */
  perRace: 5,
  /** Physics steps per worker turn while re-simulating. */
  slice: 2000,
  dt: 1 / 120,
});

export type FlashbackEntry =
  | { tick: number; kind: 'input'; input: Controls }
  | { tick: number; kind: 'pit'; compound?: Compound }
  | { tick: number; kind: 'autopilot'; value: boolean };

const sameInput = (a: Controls, b: Controls) =>
  a.throttle === b.throttle &&
  a.brake === b.brake &&
  a.clutch === b.clutch &&
  a.manualClutch === b.manualClutch &&
  a.steer === b.steer &&
  a.shift === b.shift &&
  a.ers === b.ers &&
  a.pit === b.pit &&
  a.reverse === b.reverse &&
  !!a.drs === !!b.drs &&
  !!a.overtake === !!b.overtake;

/** Every input applied to a session, in application order. */
export class InputLog {
  readonly entries: FlashbackEntry[] = [];
  private lastInput: Controls | null = null;
  /** Record an applied input; an unchanged repeat (watchdog, held keys) is skipped. */
  input(tick: number, input: Controls) {
    if (this.lastInput && sameInput(this.lastInput, input)) return;
    this.lastInput = { ...input };
    this.entries.push({ tick, kind: 'input', input: { ...input } });
  }
  pit(tick: number, compound?: Compound) {
    this.entries.push({ tick, kind: 'pit', compound });
  }
  autopilot(tick: number, value: boolean) {
    this.entries.push({ tick, kind: 'autopilot', value });
  }
  /** Forget everything applied at or after `tick` (the resumed timeline replaces it). */
  truncate(tick: number) {
    let n = this.entries.length;
    while (n > 0 && this.entries[n - 1].tick >= tick) n--;
    this.entries.length = n;
    let last: Controls | null = null;
    for (let i = n - 1; i >= 0 && !last; i--) {
      const entry = this.entries[i];
      if (entry.kind === 'input') last = entry.input;
    }
    this.lastInput = last ? { ...last } : null;
  }
}

/** Apply one logged input to a simulation, exactly as the worker did. */
export function applyEntry(simulation: Simulation, entry: FlashbackEntry) {
  if (entry.kind === 'input') simulation.setInput(entry.input);
  else if (entry.kind === 'pit') simulation.requestPit(entry.compound);
  else simulation.autoPlayer = entry.value;
}

/** Re-simulate a session from its start to `target` ticks, in slices. */
export class Resimulation {
  readonly simulation: Simulation;
  private index = 0;
  constructor(
    options: SessionOptions,
    private readonly entries: readonly FlashbackEntry[],
    readonly target: number,
  ) {
    if (!Number.isInteger(target) || target < 0) throw new Error('Invalid flashback tick');
    this.simulation = new Simulation(options);
  }
  get done() {
    return this.simulation.tick >= this.target;
  }
  /** Advance at most `steps` physics steps; true once the target tick is reached. */
  run(steps: number = FLASHBACK.slice) {
    const sim = this.simulation;
    for (let n = 0; n < steps && sim.tick < this.target; n++) {
      while (this.index < this.entries.length && this.entries[this.index].tick <= sim.tick)
        applyEntry(sim, this.entries[this.index++]);
      sim.step(FLASHBACK.dt);
    }
    if (sim.tick >= this.target)
      // Inputs applied at the target tick itself belong to the resumed timeline.
      while (this.index < this.entries.length && this.entries[this.index].tick < this.target)
        applyEntry(sim, this.entries[this.index++]);
    return this.done;
  }
}

/** The earliest tick a flashback may return to from `tick`. */
export function flashbackFloor(tick: number) {
  return Math.max(0, tick - Math.round(FLASHBACK.window / FLASHBACK.dt));
}
