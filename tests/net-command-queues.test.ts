import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeInput,
  encodeSnapshot,
} from '../src/net/codec.ts';
import { LIMITS } from '../src/net/constants.ts';
import { NetRandom } from '../src/net/event-loop.ts';
import {
  ClientCommandLog,
  ServerInputQueue,
  quantizeControls,
  type InputCommand,
  type Slot,
} from '../src/net/input.ts';

const MAX_WIRE = 0xffffffff;
const command = (seq = 0, tick = 100, ticks = 2): InputCommand => ({
  seq,
  tick,
  ticks,
  controls: quantizeControls({
    ...controls(),
    throttle: 0.7,
    steer: -0.123,
    rearBrake: 0.31,
    riderLean: -0.4,
    pit: true,
    overtake: true,
  }),
});
const packet = (commands: InputCommand[]) => {
  const result = decodeClientMessage(
    encodeInput({ sentAt: 123, ackTick: 99, commands }),
    'unreliable',
  );
  expect(result.ok && result.value.type).toBe('input');
  if (!result.ok || result.value.type !== 'input') throw new Error('Input did not round-trip');
  return result.value.packet.commands;
};
const logState = (log: ClientCommandLog) => ({
  nextSeq: log.nextSeq,
  nextTick: log.nextTick,
  ackSeq: log.ackSeq,
  started: log.started,
  size: log.size,
  pending: log.resend(16, 0),
});

describe('client command-history integrity', () => {
  it('ignores an acknowledgement of an unissued command instead of suppressing future resends', () => {
    const log = new ClientCommandLog();
    log.acknowledge(0);
    expect(log.ackSeq).toBe(-1);
    log.start(100);
    const first = log.issue(2, controls());
    const reply = decodeServerMessage(
      encodeSnapshot({
        tick: 100,
        phase: 2,
        raceTime: 1,
        ackSeq: 500,
        slack: 127,
        missing: 0,
        echo: 0,
        hold: 0,
        cars: [],
      }),
      'unreliable',
    );
    expect(reply.ok && reply.value.type).toBe('snapshot');
    if (!reply.ok || reply.value.type !== 'snapshot') throw new Error('Snapshot did not decode');
    log.acknowledge(reply.value.snapshot.ackSeq);
    expect(log.ackSeq).toBe(-1);
    expect(log.resend(12, 100)).toEqual([first]);
    log.acknowledge(first.seq);
    expect(log.resend(12, 100)).toEqual([]);
    const next = log.issue(2, controls());
    expect(log.resend(12, 100)).toEqual([next]);
  });

  it.each([NaN, Infinity, -Infinity, -2, 0.5, MAX_WIRE])(
    'keeps the last valid acknowledgement after %s',
    (ack) => {
      const log = new ClientCommandLog();
      log.start(100);
      log.issue(2, controls());
      const pending = log.issue(2, controls());
      log.acknowledge(0);
      log.acknowledge(ack);
      expect(log.ackSeq).toBe(0);
      expect(log.resend(12, 100)).toEqual([pending]);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite duration %s without consuming history',
    (ticks) => {
      const log = new ClientCommandLog();
      log.start(100);
      log.issue(2, controls());
      const before = logState(log);
      expect(() => log.issue(ticks, controls())).toThrow();
      expect(logState(log)).toEqual(before);
      expect(log.issue(2, controls())).toMatchObject({ seq: 1, tick: 102, ticks: 2 });
    },
  );

  it('does not consume a sequence when controls cannot be encoded', () => {
    const log = new ClientCommandLog();
    log.start(100);
    log.issue(2, controls());
    const failure = new Error('device sample unavailable');
    const input = controls();
    Object.defineProperty(input, 'steer', {
      get: () => {
        throw failure;
      },
    });
    const before = logState(log);
    expect(() => log.issue(2, input)).toThrow(failure);
    expect(logState(log)).toEqual(before);
    expect(log.issue(2, controls())).toMatchObject({ seq: 1, tick: 102 });
    expect(packet(log.resend(12, 100)).map((c) => c.seq)).toEqual([0, 1]);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0.25, MAX_WIRE + 1])(
    'rejects invalid start %s without clearing a running history',
    (tick) => {
      const log = new ClientCommandLog();
      log.start(100);
      log.issue(2, controls());
      const before = logState(log);
      expect(() => log.start(tick)).toThrow();
      expect(logState(log)).toEqual(before);
    },
  );

  it('preserves sequence and acknowledgement continuity when moving a log to a new start tick', () => {
    const log = new ClientCommandLog();
    log.start(100);
    log.issue(2, controls());
    log.issue(3, controls());
    log.acknowledge(0);
    log.start(400);
    expect(logState(log)).toMatchObject({ nextSeq: 2, nextTick: 400, ackSeq: 0, size: 0 });
    expect(log.at(100)).toBeUndefined();
    expect(log.issue(2, controls())).toMatchObject({ seq: 2, tick: 400 });
    // Rejoin uses a new client and server queue; it does not reuse start() as a reset.
    const rejoined = new ClientCommandLog();
    rejoined.start(400);
    const first = rejoined.issue(2, controls());
    const queue = new ServerInputQueue();
    expect(queue.accept(packet([first]), 400)).toBe(0);
    expect(first.seq).toBe(0);
    expect(queue.contiguousSeq).toBe(0);
  });

  it('keeps the last representable command and refuses wire-counter overflow atomically', () => {
    const log = new ClientCommandLog();
    log.start(MAX_WIRE - 2);
    log.nextSeq = MAX_WIRE - 1;
    const last = log.issue(2, controls());
    expect(packet([last])).toEqual([last]);
    const before = logState(log);
    expect(() => log.issue(1, controls())).toThrow();
    expect(logState(log)).toEqual(before);
  });

  it.each([NaN, Infinity, -Infinity])(
    'does not return arbitrary controls for lookup %s',
    (tick) => {
      const log = new ClientCommandLog();
      log.start(100);
      for (let i = 0; i < 5; i++) log.issue(2, { ...controls(), throttle: i / 5 });
      expect(log.at(tick)).toBeUndefined();
      expect(log.at(104)?.seq).toBe(2);
    },
  );

  it('preserves finite duration rounding, clamping, and copied quantized controls', () => {
    const log = new ClientCommandLog();
    log.start(100);
    const source = command().controls;
    const commands = [-100, 0, 0.6, 1.5, 3.4, 100].map((ticks) => log.issue(ticks, source));
    expect(commands.map((c) => c.ticks)).toEqual([1, 1, 1, 2, 3, 8]);
    expect(commands.map((c) => c.tick)).toEqual([100, 101, 102, 103, 105, 108]);
    expect(packet(commands)).toEqual(commands);
    const expected = { ...commands[0].controls };
    source.throttle = 0;
    source.rearBrake = 1;
    expect(commands[0].controls).toEqual(expected);
    expect(commands[0].controls).not.toBe(source);
  });
});

describe('server command-queue finite boundaries', () => {
  const invalid: [string, Partial<InputCommand>][] = [
    ...[NaN, Infinity, -Infinity, -1, -0.5, 0.5, MAX_WIRE, MAX_WIRE + 1].map(
      (seq): [string, Partial<InputCommand>] => [`sequence ${seq}`, { seq }],
    ),
    ...[NaN, Infinity, -Infinity, -1, -0.5, 0.5, MAX_WIRE, MAX_WIRE + 1].map(
      (tick): [string, Partial<InputCommand>] => [`start ${tick}`, { tick }],
    ),
    ...[NaN, Infinity, -Infinity, -1, 0, 0.5, 1.5, LIMITS.commandTicksMax + 1].map(
      (ticks): [string, Partial<InputCommand>] => [`duration ${ticks}`, { ticks }],
    ),
  ];
  it.each(invalid)(
    'rejects %s before it can poison bounded sequence bookkeeping',
    (_name, patch) => {
      const queue = new ServerInputQueue();
      expect(queue.accept([{ ...command(), ...patch }], 100)).toBe(1);
      // Check rejection before take(): NaN/fractional sequence keys used to make
      // the integer gap walk nonterminating, so the failing baseline stays safe.
      expect(queue.remembered).toBe(0);
      expect(queue.depth).toBe(0);
      expect(queue.contiguousSeq).toBe(-1);
      expect(queue.takeSlack()).toBe(Infinity);
      expect(queue.stats).toMatchObject({ commands: 0, duplicates: 0, rejected: 1 });
      expect(queue.accept([command()], 100)).toBe(0);
      expect(queue.take(100)).toEqual({ controls: command().controls, first: true });
      expect(queue.take(101)?.first).toBe(false);
      expect(queue.take(101)).toBeNull();
    },
  );

  it.each([NaN, Infinity, -Infinity, -1, 0.5, MAX_WIRE + 1])(
    'rejects invalid server clock %s without acknowledging or expiring queued work',
    (tick) => {
      const queue = new ServerInputQueue();
      queue.accept([command(1, 102)], 100);
      const stats = { ...queue.stats };
      expect(() => queue.accept([command(0, 100)], tick)).toThrow();
      expect(() => queue.take(tick)).toThrow();
      expect(queue.stats).toEqual(stats);
      expect(queue.contiguousSeq).toBe(-1);
      expect(queue.depth).toBe(2);
      expect(queue.remembered).toBe(1);
      expect(queue.take(102)?.first).toBe(true);
      expect(queue.contiguousSeq).toBe(1);
    },
  );

  it('accepts valid members of a run even when other entries are rejected', () => {
    const queue = new ServerInputQueue();
    expect(queue.accept([command(NaN), command(), command(0.5)], 100)).toBe(2);
    expect(queue.stats).toMatchObject({ commands: 1, rejected: 2, duplicates: 0 });
    expect(queue.take(100)?.first).toBe(true);
    expect(queue.take(101)?.first).toBe(false);
    expect(queue.depth).toBe(0);
    expect(queue.remembered).toBe(0);
  });

  it('accepts the final representable wire indices and first-tick edge semantics', () => {
    const queue = new ServerInputQueue();
    queue.contiguousSeq = MAX_WIRE - 2;
    const last = command(MAX_WIRE - 1, MAX_WIRE - 2, 2);
    expect(queue.accept(packet([last]), MAX_WIRE - 2)).toBe(0);
    expect(queue.take(MAX_WIRE - 2)).toEqual({ controls: last.controls, first: true });
    expect(queue.take(MAX_WIRE - 1)).toEqual({ controls: last.controls, first: false });
    expect(queue.contiguousSeq).toBe(MAX_WIRE - 1);
  });
});

describe('decoded command-flow compatibility', () => {
  it('matches an independent per-tick delivery oracle through seeded loss, duplication and reordering', () => {
    const random = new NetRandom(45);
    const commands: InputCommand[] = [];
    let start = 20;
    for (let seq = 0; seq < 512; seq++) {
      const ticks = 1 + Math.floor(random.next() * 4);
      const c = command(seq, start, ticks);
      c.controls.throttle = Math.round(random.next() * 255) / 255;
      commands.push(c);
      start += ticks;
    }
    const deliveries: { at: number; commands: InputCommand[] }[] = [];
    for (let i = 0; i < commands.length; i++) {
      if (i % 11 === 4) continue;
      const run = packet(commands.slice(Math.max(0, i - 3), i + 1));
      const at = Math.max(0, commands[i].tick - 8 + Math.floor(random.next() * 14));
      deliveries.push({ at, commands: run });
      if (i % 5 === 0) deliveries.push({ at: at + 2, commands: run });
    }
    deliveries.sort((a, b) => a.at - b.at);
    const queue = new ServerInputQueue();
    const seen = new Set<number>();
    const expected = new Map<number, Slot>();
    let delivery = 0,
      applied = 0;
    for (let tick = 0; tick < start + 20; tick++) {
      while (delivery < deliveries.length && deliveries[delivery].at === tick) {
        const run = deliveries[delivery++].commands;
        expect(queue.accept(run, tick)).toBe(0);
        for (const c of run) {
          if (seen.has(c.seq)) continue;
          seen.add(c.seq);
          for (let t = Math.max(tick, c.tick); t < c.tick + c.ticks; t++)
            expected.set(t, { controls: c.controls, first: t === c.tick });
        }
      }
      const want = expected.get(tick) ?? null;
      expect(queue.take(tick)).toEqual(want);
      if (want) applied++;
      expect(queue.remembered).toBeLessThanOrEqual(LIMITS.seqWindow);
      expect(queue.depth).toBeLessThanOrEqual(LIMITS.leadTicksMax + LIMITS.commandTicksMax);
    }
    expect(delivery).toBe(deliveries.length);
    expect(queue.stats.appliedTicks).toBe(applied);
    expect(queue.stats.duplicates).toBeGreaterThan(500);
    expect(queue.depth).toBe(0);
    expect(queue.remembered).toBe(0);
    expect(queue.contiguousSeq).toBe(511);
  });
});
