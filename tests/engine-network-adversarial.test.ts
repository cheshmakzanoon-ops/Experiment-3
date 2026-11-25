import { describe, expect, it, vi } from 'vitest';
import { AuthoritativeWorld, DT, decodeJournal, encodeJournal } from '../src/net/authority.ts';
import { decodeServerMessage } from '../src/net/codec.ts';
import { verifyRecord, createRecord } from '../src/net/records.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import { DEFAULT_OPTIONS, controls, validateOptions } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { onlineFixture } from './net-helpers.ts';

/** Observe scheduling at the public loop boundary without replacing its work. */
function terminalSchedules(f: ReturnType<typeof onlineFixture>) {
  const scheduled: number[] = [];
  const after = f.loop.after.bind(f.loop);
  const spy = vi.spyOn(f.loop, 'after').mockImplementation((delay, callback) => {
    if (f.server.phase === 'teardown') scheduled.push(delay);
    return after(delay, callback);
  });
  return { scheduled, spy };
}

describe('server callback ownership at publication boundaries', () => {
  it.each(['grid', 'results'] as const)(
    'a previously scheduled %s deadline cannot revive a terminal server',
    (phase) => {
      const f = onlineFixture({
        capacity: 1,
        link: PERFECT_LINK,
        server: {
          maxTicks: 1,
          timeouts: { gridCountdownMs: phase === 'grid' ? 60000 : 1, resultsLingerMs: 60000 },
        },
      });
      const { client } = f.connect('Deadline observer');
      const schedules = terminalSchedules(f);
      try {
        f.loop.runUntil(10);
        expect(f.server.phase).toBe(phase);
        const world = f.server.world;
        const tick = world?.tick;
        const record = f.server.record;
        const results = f.server.results;
        const phases = f.server.stats.phases.map(({ phase }) => phase);
        f.server.teardown();
        f.loop.runUntil(70000);
        expect(f.server.phase).toBe('teardown');
        expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual([...phases, 'teardown']);
        expect(f.server.world === world).toBe(true);
        expect(f.server.world?.tick).toBe(tick);
        expect(f.server.record === record).toBe(true);
        expect(f.server.results === results).toBe(true);
        expect(client.state).toBe(phase === 'results' ? 'results' : 'closed');
        expect(schedules.scheduled).toEqual([]);
        expect(f.loop.pending).toBe(0);
      } finally {
        schedules.spy.mockRestore();
        client.dispose();
        f.server.teardown();
      }
    },
  );

  it('does not schedule a countdown after a grid transport callback ends the session', () => {
    const f = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      server: { timeouts: { gridCountdownMs: 60000 } },
    });
    const first = f.connect('Grid observer');
    const second = f.connect('Other driver');
    const schedules = terminalSchedules(f);
    const send = first.link.server.send.bind(first.link.server);
    let ended = 0;
    const intercepted = vi.spyOn(first.link.server, 'send').mockImplementation((data, channel) => {
      send(data, channel);
      const decoded = decodeServerMessage(data, channel);
      if (decoded.ok && decoded.value.type === 'control' && decoded.value.control.kind === 'grid') {
        ended++;
        f.server.teardown();
      }
    });
    try {
      f.loop.runUntil(10000);
      expect(ended).toBe(1);
      expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual([
        'lobby',
        'grid',
        'teardown',
      ]);
      expect(f.server.world?.tick).toBe(0);
      expect(first.client.state).toBe('closed');
      expect(second.client.state).toBe('closed');
      expect(schedules.scheduled).toEqual([]);
      expect(f.loop.pending).toBe(0);
      f.loop.runUntil(70000);
      expect(f.server.phase).toBe('teardown');
      expect(f.server.world?.tick).toBe(0);
      expect(f.loop.pending).toBe(0);
    } finally {
      intercepted.mockRestore();
      schedules.spy.mockRestore();
      first.client.dispose();
      second.client.dispose();
      f.server.teardown();
    }
  });

  it.each(['snapshot send', 'event send', 'failed-send close'] as const)(
    'abandons finalization when a final %s callback ends the session',
    (boundary) => {
      // A public kick in the last tick produces a real driver event after the
      // last scheduled snapshot. endRace must flush it before publishing results.
      const f: ReturnType<typeof onlineFixture> = onlineFixture({
        capacity: 3,
        link: PERFECT_LINK,
        server: {
          maxTicks: 7,
          timeouts: { gridCountdownMs: 1, resultsLingerMs: 60000 },
          onTick: (world) => {
            if (world.tick === 7) f.server.kick(departing.client.player, 'host removal');
          },
        },
      });
      const departing = f.connect('Departing driver');
      const observer = f.connect('Transport observer');
      const healthy = f.connect('Healthy driver');
      const schedules = terminalSchedules(f);
      const sendError = new Error('final datagram failed');
      const send = observer.link.server.send.bind(observer.link.server);
      const close = observer.link.server.close.bind(observer.link.server);
      let ended = 0;
      const intercepted = vi
        .spyOn(observer.link.server, 'send')
        .mockImplementation((data, channel) => {
          const decoded = decodeServerMessage(data, channel);
          const finalSnapshot =
            f.server.phase === 'results' && decoded.ok && decoded.value.type === 'snapshot';
          const finalEvents =
            f.server.phase === 'results' &&
            decoded.ok &&
            decoded.value.type === 'control' &&
            decoded.value.control.kind === 'events';
          if (finalSnapshot && boundary === 'failed-send close') throw sendError;
          send(data, channel);
          if (
            (finalSnapshot && boundary === 'snapshot send') ||
            (finalEvents && boundary === 'event send')
          ) {
            ended++;
            f.server.teardown();
          }
        });
      const closed = vi.spyOn(observer.link.server, 'close').mockImplementation((reason) => {
        close(reason);
        if (boundary === 'failed-send close') {
          ended++;
          f.server.teardown();
        }
      });
      try {
        expect(() => f.loop.runUntil(10000)).not.toThrow();
        expect(ended).toBe(1);
        expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual([
          'lobby',
          'grid',
          'race',
          'results',
          'teardown',
        ]);
        expect(f.server.world?.tick).toBe(7);
        expect(f.server.record === null).toBe(true);
        expect(f.server.results === null).toBe(true);
        expect(observer.client.results).toBeNull();
        expect(healthy.client.results).toBeNull();
        expect(healthy.client.stats.snapshots).toBe(boundary === 'event send' ? 2 : 1);
        expect(healthy.client.events).toEqual([]);
        expect(observer.client.state).toBe('closed');
        expect(healthy.client.state).toBe('closed');
        expect(schedules.scheduled).toEqual([]);
        expect(f.loop.pending).toBe(0);
        expect(f.server.stats.transportErrors.map(({ error }) => error)).toEqual(
          boundary === 'failed-send close' ? [sendError] : [],
        );
        f.loop.runUntil(70000);
        expect(f.server.world?.tick).toBe(7);
        expect(f.server.phase).toBe('teardown');
        expect(f.loop.pending).toBe(0);
      } finally {
        intercepted.mockRestore();
        closed.mockRestore();
        schedules.spy.mockRestore();
        departing.client.dispose();
        observer.client.dispose();
        healthy.client.dispose();
        f.server.teardown();
      }
    },
  );

  it('retains already-published results without scheduling new work after their send ends the session', () => {
    const f = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      server: { maxTicks: 7, timeouts: { gridCountdownMs: 1, resultsLingerMs: 60000 } },
    });
    const first = f.connect('Result observer');
    const second = f.connect('Other driver');
    const schedules = terminalSchedules(f);
    const send = first.link.server.send.bind(first.link.server);
    let ended = 0;
    const intercepted = vi.spyOn(first.link.server, 'send').mockImplementation((data, channel) => {
      send(data, channel);
      const decoded = decodeServerMessage(data, channel);
      if (
        decoded.ok &&
        decoded.value.type === 'control' &&
        decoded.value.control.kind === 'results'
      ) {
        ended++;
        f.server.teardown();
      }
    });
    try {
      f.loop.runUntil(10000);
      expect(ended).toBe(1);
      expect(f.server.phase).toBe('teardown');
      expect(first.client.results).toEqual(f.server.results);
      expect(first.client.state).toBe('results');
      expect(second.client.results).toBeNull();
      expect(second.client.state).toBe('closed');
      expect(verifyRecord(f.server.record)).toMatchObject({ ok: true, ticks: 7 });
      expect(schedules.scheduled).toEqual([]);
      expect(f.loop.pending).toBe(0);
      f.loop.runUntil(70000);
      expect(f.server.world?.tick).toBe(7);
      expect(f.server.phase).toBe('teardown');
      expect(f.loop.pending).toBe(0);
    } finally {
      intercepted.mockRestore();
      schedules.spy.mockRestore();
      first.client.dispose();
      second.client.dispose();
      f.server.teardown();
    }
  });

  it('isolates a result-chunk send failure and finishes delivery to a healthy client', () => {
    const f = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      server: {
        maxTicks: 1,
        timeouts: { gridCountdownMs: 1, resultsLingerMs: 25 },
        onTick: (world) => {
          // Seed the stored lap list at the existing harness boundary to
          // exercise real result chunking without simulating a six-hour race.
          for (const times of world.lapTimes)
            for (let lap = 0; lap < 1500; lap++) times.push(50 + lap / 7);
        },
      },
    });
    const bad = f.connect('Failed results');
    const good = f.connect('Healthy results');
    const failure = new Error('first lap-time chunk refused');
    const send = bad.link.server.send.bind(bad.link.server);
    const intercepted = vi.spyOn(bad.link.server, 'send').mockImplementation((data, channel) => {
      const decoded = decodeServerMessage(data, channel);
      if (
        decoded.ok &&
        decoded.value.type === 'control' &&
        decoded.value.control.kind === 'lapTimes'
      )
        throw failure;
      send(data, channel);
    });
    try {
      expect(() => f.loop.runUntil(10000)).not.toThrow();
      expect(f.server.stats.transportErrors.map(({ error }) => error)).toEqual([failure]);
      expect(f.server.playerByCar(bad.client.car)?.connected).toBe(false);
      expect(good.client.state).toBe('results');
      expect(good.client.results?.recordDigest).toBe(f.server.record?.digest);
      expect(good.client.results?.classification.map(({ lapTimes }) => lapTimes)).toEqual(
        f.server.results?.classification.map(({ lapTimes }) => lapTimes),
      );
      expect(good.client.results?.classification[0].lapTimes).toHaveLength(1500);
      expect(f.server.phase).toBe('teardown');
      expect(f.server.stats.oversizeMessages).toBe(0);
      expect(f.loop.pending).toBe(0);
    } finally {
      intercepted.mockRestore();
      bad.client.dispose();
      good.client.dispose();
      f.server.teardown();
    }
  });
});

it('replays archived shift levels across AI handoff and a rear-brake tag change', () => {
  const options = validateOptions({
    ...DEFAULT_OPTIONS,
    mode: 'time-trial',
    circuit: 'vellamar',
    ruleset: 'gp-motorcycle',
    opponents: 0,
    vehicles: ['gpr1'],
    seed: 417,
  });
  // Hand-authored pre-edge journal: +1 at tick 0, AI at 2, -1/rear brake
  // while AI owns ticks 4..6, human at 7, and shift neutral at 10.
  const bytes = Uint8Array.of(
    5,
    0,
    0,
    0,
    0,
    0,
    255,
    0,
    0,
    21,
    0,
    2,
    0,
    2,
    1,
    2,
    0,
    4,
    73,
    51,
    255,
    0,
    0,
    22,
    0,
    128,
    3,
    0,
    2,
    0,
    3,
    0,
    0,
    26,
    0,
    255,
    0,
    0,
    20,
    0,
  );
  const entries = decodeJournal(bytes);
  const reference = new Simulation(options);
  for (let tick = 0; tick < 18; tick++) {
    reference.autoPlayer = tick >= 2 && tick < 7;
    if (!reference.autoPlayer)
      reference.setInput({
        ...controls(),
        manualClutch: true,
        clutch: 1,
        throttle: tick < 4 ? 0 : tick < 10 ? 73 / 255 : 26 / 255,
        brake: tick >= 4 && tick < 10 ? 51 / 255 : 0,
        rearBrake: tick >= 4 && tick < 10 ? 128 / 255 : 0,
        shift: tick < 4 ? 1 : tick < 10 ? -1 : 0,
      });
    reference.step(DT);
  }
  const replay = AuthoritativeWorld.replay(options, entries, 18);
  expect(encodeJournal(entries)).toEqual(bytes);
  expect(replay.sim.makeFrame()).toEqual(reference.makeFrame());
  expect(replay.journal).toEqual(entries);
  expect(replay.drivers[0].controls.shift).toBe(0);
  expect(verifyRecord(createRecord(replay))).toMatchObject({ ok: true, ticks: 18 });
});
