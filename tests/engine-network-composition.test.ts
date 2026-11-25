import { describe, expect, it, vi } from 'vitest';
import { AuthoritativeWorld, decodeJournal, encodeJournal } from '../src/net/authority.ts';
import { fromBase64 } from '../src/net/bytes.ts';
import { decodeServerMessage } from '../src/net/codec.ts';
import { type InputCommand } from '../src/net/input.ts';
import { createRecord, verifyRecord } from '../src/net/records.ts';
import { CAR_FLAG } from '../src/net/snapshot.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import {
  DEFAULT_OPTIONS,
  controls,
  validateOptions,
  type Controls,
} from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

describe('network composition at the completed physics boundary', () => {
  it.each([
    { failureTick: 54, closeFails: false },
    { failureTick: 54, closeFails: true },
    { failureTick: 60, closeFails: false },
    { failureTick: 60, closeFails: true },
  ])(
    'keeps the final record verifiable after snapshot $failureTick fails (close failure: $closeFails)',
    ({ failureTick, closeFails }) => {
      const f = onlineFixture({
        capacity: 2,
        link: PERFECT_LINK,
        raceSeconds: 60,
        server: { maxTicks: 60, timeouts: { gridCountdownMs: 1 } },
      });
      const bad = f.connect('Final snapshot fault');
      const good = f.connect('Healthy finisher');
      const sendError = new Error('final datagram refused');
      const closeError = new Error('final close refused');
      const send = bad.link.server.send.bind(bad.link.server);
      const sendSpy = vi.spyOn(bad.link.server, 'send').mockImplementation((data, channel) => {
        if (channel === 'unreliable' && f.server.world?.tick === failureTick) throw sendError;
        send(data, channel);
      });
      const closeSpy = closeFails
        ? vi.spyOn(bad.link.server, 'close').mockImplementation(() => {
            throw closeError;
          })
        : null;
      try {
        expect(() => f.loop.runUntil(700)).not.toThrow();
        expect(f.server.world!.tick).toBe(60);
        expect(f.server.phase).toBe('results');
        expect(good.client.state).toBe('results');
        expect(good.client.results?.recordDigest).toBe(f.server.record?.digest);
        expect(f.server.stats.transportErrors.map(({ error }) => error)).toEqual(
          closeFails ? [sendError, closeError] : [sendError],
        );
        // The takeover belongs to the next physics tick. A takeover at the
        // final boundary stays in the live journal for supervision, while an
        // earlier one remains part of the completed session's physics claim.
        expect(f.server.world!.journal.at(-1)).toEqual({
          tick: failureTick,
          car: bad.client.car,
          kind: 'mode',
          mode: 'ai',
        });
        const record = f.server.record!;
        expect(verifyRecord(record)).toMatchObject({ ok: true, ticks: 60 });
        const archived = decodeJournal(fromBase64(record.journal));
        expect(archived.every(({ tick }) => tick < record.endTick)).toBe(true);
        expect(archived).toEqual(f.server.world!.journal.filter(({ tick }) => tick < 60));
        expect(encodeJournal(archived)).toEqual(fromBase64(record.journal));
        expect(good.client.events.filter((event) => event.type === 'driver')).toEqual([
          {
            type: 'driver',
            car: bad.client.car,
            mode: 'ai',
            reason: 'transport send failed',
            tick: failureTick,
          },
        ]);
      } finally {
        sendSpy.mockRestore();
        closeSpy?.mockRestore();
        bad.client.dispose();
        good.client.dispose();
        bad.link.server.close('fixture cleanup');
        f.server.teardown();
      }
    },
  );

  it('preserves future-entry and order rejection instead of filtering unrelated corruption', () => {
    const options = validateOptions({ ...DEFAULT_OPTIONS, mode: 'time-trial', opponents: 0 });
    const world = new AuthoritativeWorld(options);
    world.setControls(0, { ...controls(), throttle: 0.37 }, true);
    for (let tick = 0; tick < 12; tick++) world.step();
    world.setMode(0, 'ai');
    const complete = createRecord(world);
    expect(verifyRecord(complete)).toMatchObject({ ok: true, ticks: 12 });
    expect(world.journal.at(-1)).toMatchObject({ tick: 12, kind: 'mode' });

    world.journal.push({ tick: 13, car: 0, kind: 'mode', mode: 'human' });
    expect(verifyRecord(createRecord(world))).toMatchObject({
      ok: false,
      stage: 'journal',
      reason: 'journal entry outside the session',
    });
    world.journal.pop();
    world.journal.push(
      { tick: 11, car: 0, kind: 'mode', mode: 'human' },
      { tick: 12, car: 0, kind: 'mode', mode: 'ai' },
    );
    expect(() => createRecord(world)).toThrow('Journal is not in tick order');
  });
});

describe('codec, command edges and shared snapshots through impaired real peers', () => {
  it('preserves accepted shifts and quantized inputs through loss, reordering and an AI handoff', () => {
    const conditions = { latencyMs: 25, jitterMs: 5, loss: 0.08, duplicate: 0.3, reorder: 0.2 };
    const f = onlineFixture({
      capacity: 2,
      link: conditions,
      raceSeconds: 60,
      session: { circuit: 'vellamar', ruleset: 'gp-motorcycle', vehicles: ['gpr1', 'gpr1'] },
      server: {
        maxTicks: 240,
        timeouts: { gridCountdownMs: 1, inputStarvationMs: 100, disconnectMs: 2000 },
      },
    });
    let sample = 0;
    const issued: InputCommand[] = [];
    const first = f.connect('Intermittent rider', {
      vehicle: 'gpr1',
      input: () => {
        sample++;
        return {
          ...controls(),
          throttle: sample % 7 === 0 ? NaN : 0.287,
          steer: sample % 2 ? 0.111 : -0.137,
          riderLean: sample % 2 ? -0.213 : 0.193,
          rearBrake: 0.347,
          manualClutch: true,
          clutch: 1,
          shift: sample % 9 === 1 ? (sample % 18 === 1 ? 1 : -1) : 0,
        };
      },
    });
    const second = f.connect('Continuous rider', {
      vehicle: 'gpr1',
      input: () => ({
        ...controls(),
        throttle: 0.473,
        rearBrake: 0.219,
        clutch: 1,
        manualClutch: true,
      }),
    });
    const originalIssue = first.client.commands.issue.bind(first.client.commands);
    const issue = vi.spyOn(first.client.commands, 'issue').mockImplementation((ticks, input) => {
      const command = originalIssue(ticks, input);
      issued.push(structuredClone(command));
      return command;
    });
    const observed: { recipient: number; tick: number; full: number[] }[] = [];
    const receivers = [first, second].map((peer) => {
      const receive = peer.transport.onMessage!;
      peer.transport.onMessage = (bytes, channel) => {
        const decoded = decodeServerMessage(bytes, channel);
        // An unreliable snapshot can beat the reliable grid announcement.
        // The client deliberately ignores those unowned early packets.
        if (decoded.ok && decoded.value.type === 'snapshot' && peer.client.car >= 0)
          observed.push({
            recipient: peer.client.car,
            tick: decoded.value.snapshot.tick,
            full: decoded.value.snapshot.cars
              .filter((car) => car.flags & CAR_FLAG.FULL)
              .map((car) => car.id),
          });
        receive(bytes, channel);
      };
      return receive;
    });
    try {
      f.loop.runUntil(450);
      const world = f.server.world!;
      const accepted: { tick: number; shift: number; first: boolean; controls: Controls }[] = [];
      const setControls = world.setControls.bind(world);
      const apply = vi.spyOn(world, 'setControls').mockImplementation((car, input, edge) => {
        if (car === first.client.car)
          accepted.push({
            tick: world.tick,
            shift: input.shift,
            first: edge,
            controls: structuredClone(input),
          });
        setControls(car, input, edge);
      });
      const before = world.journal.length;
      first.link.sever();
      f.loop.runUntil(950);
      expect(world.drivers[first.client.car].mode).toBe('ai');
      first.link.severed = false;
      f.loop.runUntil(2400);
      apply.mockRestore();
      expect(f.server.phase).toBe('results');
      expect(first.client.state).toBe('results');
      expect(second.client.state).toBe('results');
      expect(f.server.stats.starvations).toBeGreaterThanOrEqual(1);
      expect(f.server.stats.takeovers).toEqual([]);
      expect(world.drivers[first.client.car].mode).toBe('human');
      const appliedShifts = world.journal
        .slice(before)
        .filter((entry) => entry.car === first.client.car && entry.kind === 'shift');
      expect(appliedShifts).toEqual(
        accepted
          .filter((entry) => entry.first && entry.shift)
          .map(({ tick, shift }) => ({
            tick,
            car: first.client.car,
            kind: 'shift',
            shift,
          })),
      );
      expect(appliedShifts.length).toBeGreaterThan(2);
      expect(f.server.inputStats()[0].duplicates).toBeGreaterThan(0);
      expect(first.link.upStats.reordered + first.link.downStats.reordered).toBeGreaterThan(0);
      expect(first.link.upStats.dropped + first.link.downStats.dropped).toBeGreaterThan(0);
      expect(first.client.stats.rejectedSamples).toBeGreaterThan(0);
      expect(first.client.stats.invalidMessages + second.client.stats.invalidMessages).toBe(0);
      expect(observed.length).toBeGreaterThan(30);
      expect(
        observed.every(({ recipient, full }) => full.length === 1 && full[0] === recipient),
      ).toBe(true);
      // Compare the client's actual sampled objects with the values decoded
      // and consumed by the authoritative server after redundant delivery.
      for (const entry of accepted) {
        const command = issued.find(
          ({ tick, ticks }) => tick <= entry.tick && entry.tick < tick + ticks,
        );
        expect(command).toBeDefined();
        expect(entry.controls).toEqual(command!.controls);
      }
      expect(issued.every((command) => command.controls.rearBrake === 88 / 255)).toBe(true);
      expect(issued.some((command) => command.ticks > 1)).toBe(true);
      expect(first.client.predictor.model.observations).toBeGreaterThan(0);
      expect(verifyRecord(f.server.record)).toMatchObject({ ok: true, ticks: 240 });
      expect(second.client.results?.recordDigest).toBe(first.client.results?.recordDigest);
    } finally {
      issue.mockRestore();
      [first, second].forEach((peer, index) => {
        peer.transport.onMessage = receivers[index];
        peer.client.dispose();
      });
      f.server.teardown();
    }
  });
});
