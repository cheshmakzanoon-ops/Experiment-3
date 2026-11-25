import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { LIMITS } from '../src/net/constants.ts';
import {
  ServerInputQueue,
  type InputCommand,
  type QueueStats,
  type Slot,
} from '../src/net/input.ts';

// Frozen queue and boundary guards from dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc.
// Keep the original full-map expiry algorithm independent of the optimized queue.
const MAX_WIRE_INDEX = 0xffffffff;
const wireIndex = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= MAX_WIRE_INDEX;
/** Match the decoder's unsigned counters and exclusive-end overflow check.
 * The final sequence value is also reserved for an absent acknowledgement. */
const commandRange = (command: InputCommand) =>
  wireIndex(command.seq) &&
  command.seq < MAX_WIRE_INDEX &&
  wireIndex(command.tick) &&
  Number.isInteger(command.ticks) &&
  command.ticks >= 1 &&
  command.ticks <= LIMITS.commandTicksMax &&
  command.tick + command.ticks <= MAX_WIRE_INDEX;

class FrozenServerInputQueue {
  private pending = new Map<number, Slot>();
  /** seq → first tick, for received commands above the contiguous ack. */
  private seen = new Map<number, number>();
  contiguousSeq = -1;
  private slack = Infinity;
  readonly stats: QueueStats = {
    packets: 0,
    commands: 0,
    duplicates: 0,
    late: 0,
    lateTicks: 0,
    rejected: 0,
    missingTicks: 0,
    appliedTicks: 0,
  };
  /** Accept a decoded command run at server tick `now` (next tick to
   * simulate). Returns how many commands were rejected (outside the tick or
   * sequence window): a well-behaved client never sends one. */
  accept(commands: readonly InputCommand[], now: number) {
    if (!wireIndex(now)) throw new Error('Invalid server input tick');
    this.stats.packets++;
    let rejected = 0;
    for (const c of commands) {
      // Keep the public queue boundary finite too: a fractional or NaN sequence
      // cannot be found by the bounded integer gap walk in take().
      if (!commandRange(c)) {
        this.stats.rejected++;
        rejected++;
        continue;
      }
      if (c.seq <= this.contiguousSeq || this.seen.has(c.seq)) {
        this.stats.duplicates++;
        continue;
      }
      if (c.seq > this.contiguousSeq + LIMITS.seqWindow || c.tick > now + LIMITS.leadTicksMax) {
        // Not remembered: a legitimate resend may still be accepted later,
        // and a flood of far-away commands cannot grow `seen`.
        this.stats.rejected++;
        rejected++;
        continue;
      }
      this.stats.commands++;
      this.mark(c.seq, c.tick);
      // Margin of this command's first tick, negative when it arrived late:
      // a client whose lead is too short learns it from this alone (a fully
      // late command is never applied, so nothing else would tell it).
      this.slack = Math.min(this.slack, c.tick - now);
      if (c.tick + c.ticks <= now) {
        this.stats.late++;
        this.stats.lateTicks += c.ticks;
        continue;
      }
      for (let t = c.tick; t < c.tick + c.ticks; t++) {
        if (t < now) {
          this.stats.lateTicks++;
          continue;
        }
        if (!this.pending.has(t))
          this.pending.set(t, { controls: c.controls, first: t === c.tick });
      }
    }
    return rejected;
  }
  private mark(seq: number, tick: number) {
    this.seen.set(seq, tick);
    while (this.seen.has(this.contiguousSeq + 1)) this.seen.delete(++this.contiguousSeq);
  }
  /** Lowest remembered sequence number. Every key lies in (contiguousSeq,
   * contiguousSeq + seqWindow], so the scan is bounded by the window and is
   * normally a step or two (the next command or a short loss gap). */
  private lowestSeen() {
    let seq = this.contiguousSeq + 1;
    while (!this.seen.has(seq)) seq++;
    return seq;
  }
  /** The command slot for `tick`, or null when none arrived in time. */
  take(tick: number): Slot | null {
    if (!wireIndex(tick)) throw new Error('Invalid server input tick');
    const slot = this.pending.get(tick) ?? null;
    for (const t of this.pending.keys()) if (t <= tick) this.pending.delete(t);
    // A gap whose successor already started is in the past: never wait on it.
    while (this.seen.size) {
      const next = this.lowestSeen();
      if ((this.seen.get(next) as number) > tick) break;
      this.contiguousSeq = next - 1;
      while (this.seen.has(this.contiguousSeq + 1)) this.seen.delete(++this.contiguousSeq);
    }
    if (slot) this.stats.appliedTicks++;
    return slot;
  }
  /** Remembered sequence numbers above the contiguous acknowledgement. */
  get remembered() {
    return this.seen.size;
  }
  /** Smallest margin (ticks) by which a new command beat its first tick since
   * the last call; Infinity when nothing new arrived. */
  takeSlack() {
    const s = this.slack;
    this.slack = Infinity;
    return s;
  }
  get depth() {
    return this.pending.size;
  }
}

type Queue = Pick<
  ServerInputQueue,
  'accept' | 'take' | 'takeSlack' | 'depth' | 'remembered' | 'contiguousSeq' | 'stats'
>;
const command = (seq: number, tick: number, ticks = 1): InputCommand => ({
  seq,
  tick,
  ticks,
  controls: {
    ...controls(),
    throttle: ((seq % 9) + 1) / 10,
    steer: ((seq % 3) - 1) / 2,
    rearBrake: 0.4,
    riderLean: -0.25,
    shift: seq % 2 ? 1 : -1,
    pit: true,
    overtake: true,
  },
});
const state = (queue: Queue) => ({
  depth: queue.depth,
  remembered: queue.remembered,
  contiguousSeq: queue.contiguousSeq,
  stats: { ...queue.stats },
});
function pairedQueues() {
  const current = new ServerInputQueue();
  const original = new FrozenServerInputQueue();
  const check = () => expect(state(current)).toEqual(state(original));
  return {
    current,
    original,
    accept(commands: readonly InputCommand[], now: number) {
      const rejected = current.accept(commands, now);
      expect(rejected).toBe(original.accept(commands, now));
      check();
      return rejected;
    },
    take(tick: number) {
      const slot = current.take(tick);
      const expected = original.take(tick);
      expect(slot).toEqual(expected);
      expect(slot?.controls).toBe(expected?.controls);
      check();
      return slot;
    },
    slack() {
      const slack = current.takeSlack();
      expect(slack).toBe(original.takeSlack());
      check();
      return slack;
    },
  };
}
function pendingOperations(queue: Queue, budget = Infinity) {
  const pending = (queue as unknown as { pending: Map<number, Slot> }).pending;
  const counts = { keys: 0, deletes: 0 };
  const checkBudget = () => {
    if (counts.keys + counts.deletes > budget) throw new Error('Unbounded queue expiry work');
  };
  const keys = pending.keys.bind(pending);
  pending.keys = () => {
    const iterator = keys();
    const next = iterator.next.bind(iterator);
    iterator.next = () => {
      const entry = next();
      if (!entry.done) counts.keys++;
      checkBudget();
      return entry;
    };
    return iterator;
  };
  const remove = pending.delete.bind(pending);
  pending.delete = (tick) => {
    counts.deletes++;
    checkBudget();
    return remove(tick);
  };
  return counts;
}

describe('server input queue expiry compatibility', () => {
  it('retains reordered first writers, late admission, ACK gaps, and skipped or backward reads', () => {
    const pair = pairedQueues();
    const later = command(2, 18, 4);
    const first = command(0, 10, 4);
    const overlap = command(1, 12, 8);
    pair.accept([later, first, overlap], 10);
    expect(pair.current.contiguousSeq).toBe(2);
    expect(pair.take(10)).toEqual({ controls: first.controls, first: true });
    expect(pair.take(12)).toEqual({ controls: first.controls, first: false });
    expect(pair.take(14)).toEqual({ controls: overlap.controls, first: false });
    expect(pair.take(18)).toEqual({ controls: later.controls, first: true });
    expect(pair.take(17)).toBeNull();
    expect(pair.take(19)).toEqual({ controls: later.controls, first: false });
    pair.accept([overlap], 20);

    const partial = command(4, 17, 8);
    pair.accept([partial], 20);
    expect(pair.current.remembered).toBe(1);
    expect(pair.take(20)).toEqual({ controls: later.controls, first: false });
    expect(pair.current.contiguousSeq).toBe(4);
    pair.accept([command(3, 18, 8), command(5, 5, 2)], 20);
    expect(pair.slack()).toBe(-15);
    expect(pair.slack()).toBe(Infinity);
    const resend = command(6, 1000, 2);
    expect(pair.accept([resend], 20)).toBe(1);
    expect(pair.accept([resend], 1000)).toBe(0);
    expect(pair.take(21)).toEqual({ controls: later.controls, first: false });
    expect(pair.take(23)).toEqual({ controls: partial.controls, first: false });
    expect(pair.take(23)).toBeNull();
    expect(pair.take(0)).toBeNull();

    // Public accept() permits an older server clock after a take() advance.
    // These newly admitted slots must remain readable and expire normally.
    const rewound = command(7, 0, 8);
    pair.accept([rewound], 0);
    expect(pair.take(4)).toEqual({ controls: rewound.controls, first: false });
    expect(pair.take(24)).toEqual({ controls: partial.controls, first: false });
    expect(pair.current.depth).toBe(2);
    expect(pair.take(1000)).toEqual({ controls: resend.controls, first: true });
    expect(pair.take(1001)).toEqual({ controls: resend.controls, first: false });
    expect(pair.current.depth).toBe(0);
    expect(pair.current.stats).toMatchObject({ late: 1, lateTicks: 5, duplicates: 2 });
    pair.slack();
  });

  it.each([17, 0x1234abcd, 0xfedcba98])(
    'matches the frozen queue over mixed admission and expiry stream %s',
    (seed) => {
      let randomState = seed >>> 0;
      const random = (n: number) => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return Math.floor((randomState / 0x100000000) * n);
      };
      const pair = pairedQueues();
      const delivered: InputCommand[] = [];
      let now = 20;
      for (let step = 0; step < 1200; step++) {
        const action = random(10);
        if (action < 5) {
          const batch: InputCommand[] = [];
          const count = 1 + random(5);
          for (let i = 0; i < count; i++) {
            if (delivered.length && random(5) === 0) {
              batch.push(delivered[random(delivered.length)]);
              continue;
            }
            const seq = pair.original.contiguousSeq + 1 + random(12);
            const c = command(seq, Math.max(0, now + random(72) - 18), 1 + random(8));
            if (random(9) === 0) c.tick = now + LIMITS.leadTicksMax + 1;
            if (random(13) === 0) c.seq += LIMITS.seqWindow;
            if (step % 53 === 0) c.ticks = 0;
            batch.push(c);
            delivered.push(c);
          }
          pair.accept(batch, now);
        } else if (action < 9) {
          if (step % 79 === 0) now = random(400);
          else now += step % 41 === 0 ? 100000 : 1 + random(5);
          pair.take(Math.max(0, now - (random(5) === 0 ? random(50) : 0)));
        } else {
          pair.slack();
        }
      }
      pair.take(MAX_WIRE_INDEX);
      pair.slack();
      expect(pair.current.depth).toBe(0);
      expect(pair.current.remembered).toBe(0);
      for (const counter of [
        'commands',
        'duplicates',
        'rejected',
        'late',
        'lateTicks',
        'appliedTicks',
      ] as const)
        expect(pair.current.stats[counter]).toBeGreaterThan(0);
    },
  );

  it('preserves unsigned wire endpoints and gaps without cursor overflow', () => {
    const pair = pairedQueues();
    pair.current.contiguousSeq = pair.original.contiguousSeq = MAX_WIRE_INDEX - 5;
    const head = command(MAX_WIRE_INDEX - 4, MAX_WIRE_INDEX - 12, 2);
    const middle = command(MAX_WIRE_INDEX - 3, MAX_WIRE_INDEX - 10, 8);
    const tail = command(MAX_WIRE_INDEX - 2, MAX_WIRE_INDEX - 2, 2);
    const overlap = command(MAX_WIRE_INDEX - 1, MAX_WIRE_INDEX - 1);
    pair.accept([middle, head, tail, overlap], MAX_WIRE_INDEX - 12);
    expect(pair.current.contiguousSeq).toBe(MAX_WIRE_INDEX - 1);
    expect(
      pair.accept(
        [
          command(MAX_WIRE_INDEX, MAX_WIRE_INDEX - 1),
          command(0, MAX_WIRE_INDEX),
          command(1, MAX_WIRE_INDEX - 1, 2),
          command(NaN, MAX_WIRE_INDEX - 10),
          command(0.5, MAX_WIRE_INDEX - 10),
        ],
        MAX_WIRE_INDEX - 12,
      ),
    ).toBe(5);
    expect(pair.take(MAX_WIRE_INDEX - 12)?.first).toBe(true);
    expect(pair.take(MAX_WIRE_INDEX - 9)).toEqual({ controls: middle.controls, first: false });
    expect(pair.take(MAX_WIRE_INDEX - 11)).toBeNull();
    expect(pair.take(MAX_WIRE_INDEX - 2)).toEqual({ controls: tail.controls, first: true });
    expect(pair.take(MAX_WIRE_INDEX - 1)).toEqual({ controls: tail.controls, first: false });
    expect(pair.take(MAX_WIRE_INDEX)).toBeNull();
    expect(pair.take(MAX_WIRE_INDEX)).toBeNull();
    expect(pair.current.depth).toBe(0);
    pair.slack();
  });

  it('uses 248 consumed-slot deletes instead of 30,876 key visits for the accepted lead window', () => {
    const pair = pairedQueues();
    const current = pendingOperations(pair.current);
    const original = pendingOperations(pair.original);
    const commands = Array.from({ length: 31 }, (_, seq) => command(seq, seq * 8, 8));
    pair.accept(commands, 0);
    let edges = 0;
    for (let tick = 0; tick < 248; tick++) if (pair.take(tick)?.first) edges++;
    expect(edges).toBe(31);
    expect(pair.current.stats.appliedTicks).toBe(248);
    expect(pair.current.depth).toBe(0);
    expect(original).toEqual({ keys: 30876, deletes: 248 });
    expect(current).toEqual({ keys: 0, deletes: 248 });
  });

  it('bounds sparse large jumps by pending size and rewinds expiry for newly accepted old slots', () => {
    const pair = pairedQueues();
    pair.accept([command(0, 5)], 0);
    const distant = command(1, 2000000000);
    pair.accept([distant], distant.tick);
    const last = command(2, MAX_WIRE_INDEX - 1);
    pair.accept([last], last.tick);
    const work = pendingOperations(pair.current, 12);
    expect(pair.take(distant.tick)).toEqual({ controls: distant.controls, first: true });
    expect(work).toEqual({ keys: 3, deletes: 2 });
    expect(pair.current.depth).toBe(1);
    expect(pair.take(1000000000)).toBeNull();
    expect(work).toEqual({ keys: 3, deletes: 2 });
    const old = command(3, 4);
    pair.accept([old], 4);
    expect(pair.take(4)).toEqual({ controls: old.controls, first: true });
    expect(work).toEqual({ keys: 3, deletes: 3 });
    expect(pair.take(last.tick)).toEqual({ controls: last.controls, first: true });
    expect(work).toEqual({ keys: 4, deletes: 4 });
    expect(pair.current.depth).toBe(0);
  });
});
