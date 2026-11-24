import { describe, expect, it, vi } from 'vitest';
import { sessionIdentity } from '../src/core/session-identity.ts';
import { RaceClient } from '../src/net/client.ts';
import { decodeClientMessage, encodeControl, encodeSnapshot } from '../src/net/codec.ts';
import { LIMITS, TICK_MS, TICKS_PER_SNAPSHOT } from '../src/net/constants.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import {
  CLIENT_COMMAND_HISTORY_TICKS,
  ClientCommandLog,
  type InputCommand,
} from '../src/net/input.ts';
import type { PredictorOptions } from '../src/net/prediction.ts';
import { CAR_FLAG, emptyCarState } from '../src/net/snapshot.ts';
import type { Transport } from '../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';

const MAX_WIRE = 0xffffffff;
const input = (seq: number) => ({
  ...controls(),
  throttle: (seq % 11) / 10,
  steer: ((seq % 17) - 8) / 8,
});
const observed = (log: ClientCommandLog) => ({
  nextSeq: log.nextSeq,
  nextTick: log.nextTick,
  ackSeq: log.ackSeq,
  size: log.size,
  resend: log.resend(16, 0),
});

describe('finite client command history', () => {
  it('bounds 100,000 unacknowledged commands while keeping the latest wire run and lookups', () => {
    const log = new ClientCommandLog();
    log.start(0);
    let maximum = 0;
    for (let i = 0; i < 100_000; i++) {
      log.issue(2, input(i));
      maximum = Math.max(maximum, log.size);
    }
    expect(log.historyTicks).toBe(368);
    expect(maximum).toBe(185);
    expect(log.size).toBe(185);
    expect(log.ackSeq).toBe(-1);
    expect(log.nextSeq).toBe(100_000);
    expect(log.nextTick).toBe(200_000);
    const recent = log.resend(LIMITS.commandsPerPacket, 0);
    expect(recent.map((c) => c.seq)).toEqual(
      Array.from({ length: LIMITS.commandsPerPacket }, (_, i) => 99_984 + i),
    );
    for (const c of recent) {
      expect(c.tick).toBe(c.seq * 2);
      expect(log.at(c.tick)).toBe(c);
      expect(log.at(c.tick + 1)).toBe(c);
    }
    expect(log.at(199_630)?.seq).toBe(99_815);
    expect(log.at(199_629)).toBeUndefined();
    expect(log.at(200_000)).toBeUndefined();
    log.prune(200_000);
    expect(log.size).toBe(1); // Preserve the existing strict-end boundary.
    expect(log.resend(16, 200_000)).toEqual([]);
  });

  it('retains the maximum contiguous resend run through mixed command durations', () => {
    const log = new ClientCommandLog();
    log.start(200);
    const recent: InputCommand[] = [];
    let maximum = 0;
    for (let seq = 0; seq < 100_000; seq++) {
      const ticks = [1, 2, 4, 8][seq % 4];
      recent.push(log.issue(ticks, input(seq)));
      if (recent.length > LIMITS.commandsPerPacket) recent.shift();
      maximum = Math.max(maximum, log.size);
      if (seq % 10_000 === 9999) {
        expect(log.resend(16, 0)).toEqual(recent);
        for (const c of recent)
          for (let tick = c.tick; tick < c.tick + c.ticks; tick++) expect(log.at(tick)).toBe(c);
      }
    }
    expect(maximum).toBeLessThanOrEqual(CLIENT_COMMAND_HISTORY_TICKS + 1);
    expect(log.nextTick).toBe(375_200);
    log.acknowledge(log.nextSeq - 9);
    expect(log.resend(16, 0)).toEqual(recent.slice(-8));
  });

  it('expires a stale unacknowledged prefix without changing sequence or ACK counters', () => {
    const log = new ClientCommandLog();
    log.start(100);
    const issued = Array.from({ length: 8 }, (_, i) => log.issue(2, input(i)));
    log.prune(108);
    expect(log.size).toBe(5);
    expect(log.at(105)).toBeUndefined();
    expect(log.at(106)).toBe(issued[3]);
    expect(log.at(108)).toBe(issued[4]);
    expect(log.nextSeq).toBe(8);
    expect(log.nextTick).toBe(116);
    expect(log.ackSeq).toBe(-1);
    expect(log.resend(16, 110)).toEqual(issued.slice(5));
    log.acknowledge(6);
    expect(log.resend(16, 0)).toEqual([issued[7]]);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0, 50])(
    'ignores an invalid or backwards floor %s without reviving expired commands',
    (floor) => {
      const log = new ClientCommandLog();
      log.start(0);
      for (let i = 0; i < 400; i++) log.issue(1, input(i));
      log.prune(300);
      const before = observed(log);
      log.prune(floor);
      expect(observed(log)).toEqual(before);
      expect(log.at(0)).toBeUndefined();
    },
  );

  it('restarts a lower tick range without retaining an old expiry floor or resetting sequences', () => {
    const log = new ClientCommandLog();
    log.start(1000);
    for (let i = 0; i < 500; i++) log.issue(2, controls());
    log.acknowledge(490);
    log.start(12);
    const next = log.issue(2, input(500));
    expect(next).toMatchObject({ seq: 500, tick: 12, ticks: 2 });
    expect(log.size).toBe(1);
    expect(log.ackSeq).toBe(490);
    expect(log.at(12)).toBe(next);
    expect(log.at(1900)).toBeUndefined();
    const rejoined = new ClientCommandLog();
    rejoined.start(12);
    expect(rejoined.issue(2, controls()).seq).toBe(0);
  });

  it('does not prune or consume a sequence if issuance fails at a full retention boundary', () => {
    const log = new ClientCommandLog();
    log.start(0);
    for (let i = 0; i < 500; i++) log.issue(1, controls());
    const before = observed(log);
    expect(() => log.issue(NaN, controls())).toThrow();
    const failure = new Error('sample failed');
    const broken = controls();
    Object.defineProperty(broken, 'steer', {
      get: () => {
        throw failure;
      },
    });
    expect(() => log.issue(8, broken)).toThrow(failure);
    expect(observed(log)).toEqual(before);
    expect(log.issue(1, controls())).toMatchObject({ seq: 500, tick: 500 });
    expect(log.size).toBe(CLIENT_COMMAND_HISTORY_TICKS + 1);
  });

  it('retains terminal wire-counter failure atomicity with the automatic expiry path', () => {
    const log = new ClientCommandLog();
    log.start(MAX_WIRE - 2);
    log.nextSeq = MAX_WIRE - 1;
    log.issue(2, controls());
    const before = observed(log);
    expect(() => log.issue(1, controls())).toThrow();
    expect(observed(log)).toEqual(before);
  });

  it.each([0, 367, 368.5, Infinity, NaN])('refuses an unusable history window %s', (span) => {
    expect(() => new ClientCommandLog(span)).toThrow('Invalid client command history window');
  });
});

const options: SessionOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'race',
  opponents: 0,
  vehicles: ['apx01'],
  grid: [0],
  seed: 731,
};

function clientFixture(predictor: Partial<PredictorOptions> = {}) {
  const loop = new EventLoop();
  let latestPacket: InputCommand[] = [];
  let packets = 0;
  const transport: Transport = {
    label: 'command-retention',
    open: true,
    onMessage: null,
    onClose: null,
    send(data, channel) {
      const decoded = decodeClientMessage(data, channel);
      if (!decoded.ok) throw new Error(decoded.reason);
      if (decoded.value.type === 'input') {
        latestPacket = decoded.value.packet.commands;
        packets++;
      }
    },
    close() {},
  };
  const client = new RaceClient({
    loop,
    transport,
    advertised: options,
    name: 'Retention',
    vehicle: 'apx01',
    predictor,
    input: ({ tick }) => input(tick),
  });
  client.player = 'guest:retention';
  transport.onMessage?.(
    encodeControl({
      kind: 'grid',
      options,
      identity: sessionIdentity(options),
      car: 0,
      startTick: 0,
      serverTick: 0,
      startInMs: 0,
      entries: [{ car: 0, player: client.player, name: 'Retention', vehicle: 'apx01' }],
    }),
    'reliable',
  );
  const snapshot = (tick: number, ackSeq = -1) =>
    transport.onMessage?.(
      encodeSnapshot({
        tick,
        phase: 1,
        raceTime: tick / 120,
        ackSeq,
        slack: 127,
        missing: 0,
        echo: 0,
        hold: 0,
        cars: [{ ...emptyCarState(), flags: CAR_FLAG.FULL, z: tick / 12, vz: 10 }],
      }),
      'unreliable',
    );
  snapshot(0);
  loop.runUntil(50);
  snapshot(6);
  return {
    client,
    loop,
    transport,
    snapshot,
    latestPacket: () => latestPacket,
    packets: () => packets,
  };
}

describe('actual client downlink outages', () => {
  it('keeps issuing and resending through 100,000 scheduled samples with bounded retention', () => {
    const f = clientFixture();
    f.loop.runUntil(1_700_000);
    expect(f.client.stats.commands).toBeGreaterThan(100_000);
    expect(f.packets()).toBeGreaterThan(50_000);
    expect(f.client.state).toBe('race');
    expect(f.transport.open).toBe(true);
    expect(f.client.view().stalled).toBe(true);
    expect(f.client.commands.ackSeq).toBe(-1);
    expect(f.client.commands.size).toBeLessThanOrEqual(185);
    const packet = f.latestPacket();
    expect(packet.length).toBe(LIMITS.inputRedundancy);
    expect(packet.at(-1)!.seq).toBeGreaterThan(f.client.commands.nextSeq - 4);
    for (let i = 1; i < packet.length; i++) {
      expect(packet[i].seq).toBe(packet[i - 1].seq + 1);
      expect(packet[i].tick).toBe(packet[i - 1].tick + packet[i - 1].ticks);
    }
    const tick = Math.round(f.loop.now / TICK_MS);
    const expected = {
      ...f.client.commands.at(tick - f.client.predictor.options.responseLagTicks)!.controls,
    };
    const learn = vi.spyOn(f.client.predictor.model, 'observe');
    f.snapshot(tick); // Recovery is useful even when the ACK itself remains stale.
    expect(learn).toHaveBeenCalledTimes(1);
    expect(learn.mock.calls[0][3]).toEqual(expected);
    expect(f.client.predictor.authoritative?.tick).toBe(tick);
    expect(f.client.view().stalled).toBe(false);
    expect(f.client.commands.ackSeq).toBe(-1);
    f.loop.runUntil(f.loop.now + 1000);
    expect(f.client.commands.size).toBeLessThanOrEqual(185);
    expect(f.client.commands.at(f.client.commands.nextTick - 1)).toBeDefined();
    f.client.dispose();
  });

  it('enlarges retention for a custom prediction horizon and delayed response lookup', () => {
    const f = clientFixture({ maxHorizonTicks: 300, responseLagTicks: 80 });
    expect(f.client.commands.historyTicks).toBe(
      LIMITS.leadTicksMax + 300 + 2 * 80 + 2 * TICKS_PER_SNAPSHOT,
    );
    f.loop.runUntil(20_000);
    const tick = f.client.commands.nextTick - LIMITS.leadTicksMax - 300;
    const lagged = f.client.commands.at(tick - 80);
    expect(lagged).toBeDefined();
    const learn = vi.spyOn(f.client.predictor.model, 'observe');
    f.snapshot(tick);
    expect(learn).toHaveBeenCalledTimes(1);
    expect(learn.mock.calls[0][3]).toEqual(lagged!.controls);
    expect(f.client.predictor.authoritative?.tick).toBe(tick);
    expect(f.client.commands.size).toBeLessThanOrEqual(f.client.commands.historyTicks + 1);
    f.client.dispose();
  });

  it('re-seeds an expired snapshot from authoritative state without inventing past input', () => {
    const f = clientFixture();
    f.loop.runUntil(20_000);
    expect(f.client.commands.at(6)).toBeUndefined();
    const observations = f.client.predictor.model.observations;
    f.snapshot(12);
    expect(f.client.predictor.model.observations).toBe(observations);
    expect(f.client.predictor.authoritative?.tick).toBe(12);
    expect(f.client.predictor.tick).toBe(72);
    expect(Object.values(f.client.view().local!.pose).every(Number.isFinite)).toBe(true);
    const fresh = Math.round(f.loop.now / TICK_MS);
    f.snapshot(fresh);
    expect(f.client.predictor.model.observations).toBe(observations + 1);
    expect(f.client.predictor.authoritative?.tick).toBe(fresh);
    expect(f.client.commands.size).toBeLessThanOrEqual(CLIENT_COMMAND_HISTORY_TICKS + 1);
    f.client.dispose();
  });

  it('preserves recent commands through bounded lead adjustments and stale ACKs', () => {
    const f = clientFixture();
    for (const lead of [120, 2, 75, 4, 120, 16]) {
      f.client.lead = lead;
      f.loop.runUntil(f.loop.now + 2500);
      const recent = f.client.commands.resend(16, f.client.lastSnapshotTick + 1);
      expect(recent).toHaveLength(16);
      for (const c of recent) expect(f.client.commands.at(c.tick)).toEqual(c);
      expect(f.client.commands.size).toBeLessThanOrEqual(CLIENT_COMMAND_HISTORY_TICKS + 1);
      const tick = Math.round(f.loop.now / TICK_MS);
      f.snapshot(tick, 0);
      expect(
        f.client.commands.at(tick - f.client.predictor.options.responseLagTicks),
      ).toBeDefined();
    }
    f.client.dispose();
  });
});
