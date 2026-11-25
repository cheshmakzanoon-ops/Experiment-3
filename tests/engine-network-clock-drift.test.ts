import { describe, expect, it } from 'vitest';
import { sessionIdentity } from '../src/core/session-identity.ts';
import { RaceClient, type ClientView, type RenderedCar } from '../src/net/client.ts';
import { encodeControl, encodeSnapshot } from '../src/net/codec.ts';
import { TICK_MS } from '../src/net/constants.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import type { ServerControl } from '../src/net/messages.ts';
import { CAR_FLAG, emptyCarState } from '../src/net/snapshot.ts';
import {
  NetworkSimulator,
  PERFECT_LINK,
  TARGET_LINK,
  type Channel,
  type LinkConditions,
} from '../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

const options: SessionOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'race',
  opponents: 1,
  vehicles: ['apx01', 'apx01'],
  grid: [0, 1],
  seed: 47,
};
const grid: Extract<ServerControl, { kind: 'grid' }> = {
  kind: 'grid',
  options,
  identity: sessionIdentity(options),
  entries: [
    { car: 0, name: 'Driver', player: 'guest:1', vehicle: 'apx01' },
    { car: 1, name: 'Remote', player: 'guest:2', vehicle: 'apx01' },
  ],
  car: 0,
  startTick: 0,
  serverTick: 0,
  startInMs: 0,
};

interface Frame {
  at: number;
  tick: number;
  z: number;
  kind: RenderedCar['kind'];
  target: number;
  headroom: number;
  stalled: boolean;
}

/** The audit's real client, timers, seeded transport and wire codecs. Only the
 * authoritative fixture's path is synthetic: exactly 20 m/s, one sample/50 ms. */
function stream(initialLatency = 50, clockOffsetMs = 0, startMs = 0) {
  const loop = new EventLoop();
  loop.runUntil(startMs);
  const net = new NetworkSimulator(loop, 17);
  const pair = net.connect(PERFECT_LINK, { ...PERFECT_LINK, latencyMs: initialLatency });
  const frames: Frame[] = [];
  const record = (view: ClientView, client: RaceClient) => {
    const remote = view.remotes[0];
    if (!remote) return;
    const arrival = client.clock.arrivalTick(view.now);
    frames.push({
      at: loop.now,
      tick: remote.tick,
      z: remote.pose.z,
      kind: remote.kind,
      target: arrival - client.jitter.delayTicks,
      headroom: arrival - remote.tick,
      stalled: view.stalled,
    });
  };
  const client = new RaceClient({
    loop,
    transport: pair.client,
    name: 'Driver',
    vehicle: 'apx01',
    advertised: options,
    input: controls,
    clockOffsetMs,
    onRender: record,
  });
  // An early consumer read must not seed presentation with an unsynced clock.
  expect(client.view().remotes).toEqual([]);
  client.join();
  pair.server.send(encodeControl(grid), 'reliable');
  const schedule = (count: number, change: (i: number, c: LinkConditions) => void) => {
    for (let i = 1; i <= count; i++)
      loop.at(startMs + i * 50, () => {
        change(i, pair.link.server.conditions);
        const tick = i * 6;
        pair.server.send(
          encodeSnapshot({
            tick,
            phase: 2,
            raceTime: tick / 120,
            ackSeq: -1,
            slack: 127,
            missing: 0,
            echo: 0,
            hold: 0,
            cars: [
              { ...emptyCarState(0), flags: CAR_FLAG.FULL, z: tick / 12, vz: 10 },
              { ...emptyCarState(1), z: tick / 6, vz: 20 },
            ],
          }),
          'unreliable',
        );
      });
  };
  return { loop, pair, client, frames, schedule, record };
}

function expectBoundedPlayback(frames: Frame[]) {
  expect(frames.length).toBeGreaterThan(200);
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1],
      current = frames[i],
      elapsed = (current.at - previous.at) / TICK_MS,
      advance = current.tick - previous.tick;
    expect(advance).toBeGreaterThanOrEqual(0.75 * elapsed - 1e-6);
    expect(advance).toBeLessThanOrEqual(1.25 * elapsed + 1e-6);
    expect(current.z).toBeGreaterThanOrEqual(previous.z - 1e-6);
  }
}

const increaseAt45 = (i: number, c: LinkConditions) => {
  if (i === 45) c.latencyMs = 200;
};

describe('remote presentation clock through real RaceClient timers', () => {
  it.each([0, 123_456_789, -86_400_000])(
    'removes the 16.5-tick / 2.75-m rewind at anchor expiry (local origin %d ms)',
    (origin) => {
      const f = stream(50, origin);
      try {
        f.schedule(120, increaseAt45);
        f.loop.runUntil(6250);
        expect(f.client.state).toBe('race');
        expect(f.client.stats.snapshots).toBe(120);
        expect(f.client.stats.invalidMessages).toBe(0);
        expect(f.client.stats.inputPackets).toBe(184);
        expectBoundedPlayback(f.frames);
        const before = f.frames.find((frame) => Math.abs(frame.at - 4385.333333333334) < 1e-6)!;
        const after = f.frames.find((frame) => frame.at === 4402)!;
        expect(before.kind).toBe('interpolated');
        expect(after.kind).toBe('interpolated');
        // The raw target still reproduces the original defect; only presentation slews.
        expect(after.target - before.target).toBeCloseTo(-16.5, 6);
        expect(after.tick - before.tick).toBeCloseTo(1.5, 6);
        expect(after.z - before.z).toBeCloseTo(0.25, 6);
        expect(after.tick - after.target).toBeCloseTo(18, 6);
        // An 18-tick step converges within 600 ms; the buffer is also relaxing.
        expect(
          f.frames
            .filter((frame) => frame.at >= 5002)
            .every((frame) => Math.abs(frame.tick - frame.target) < 1e-6),
        ).toBe(true);
        expect(Math.max(...f.frames.map((frame) => frame.headroom))).toBeLessThanOrEqual(36 + 1e-6);
      } finally {
        f.client.dispose();
      }
    },
  );

  const cases: {
    name: string;
    latency: number;
    count: number;
    change: (i: number, c: LinkConditions) => void;
  }[] = [
    {
      name: '200 to 50 ms latency decrease with late packets still in flight',
      latency: 200,
      count: 220,
      change: (i, c) => {
        if (i === 45) c.latencyMs = 50;
      },
    },
    {
      name: 'gradual 50 to 200 to 50 ms drift',
      latency: 50,
      count: 350,
      change: (i, c) => {
        if (i >= 45 && i <= 120) c.latencyMs = 50 + (i - 45) * 2;
        if (i >= 160 && i <= 235) c.latencyMs = 200 - (i - 160) * 2;
      },
    },
    {
      name: 'seeded ordinary jitter, loss, duplication and reordering',
      latency: 50,
      count: 300,
      change: (i, c) => {
        if (i === 1) Object.assign(c, TARGET_LINK);
        if (i === 180) Object.assign(c, PERFECT_LINK, { latencyMs: 50 });
      },
    },
    {
      name: 'one-way outage followed by slower recovery and a faster link',
      latency: 50,
      count: 320,
      change: (i, c) => {
        if (i === 45) c.loss = 1;
        if (i === 101) Object.assign(c, PERFECT_LINK, { latencyMs: 200 });
        if (i === 180) c.latencyMs = 50;
      },
    },
  ];
  it.each(cases)(
    'converges with bounded headroom after $name',
    ({ name, latency, count, change }) => {
      const f = stream(latency);
      try {
        f.schedule(count, change);
        f.loop.runUntil(count * 50 + 250);
        expectBoundedPlayback(f.frames);
        expect(f.client.state).toBe('race');
        expect(f.client.stats.invalidMessages).toBe(0);
        expect(f.client.stats.snapshots).toBeGreaterThan(count - 65);
        const tail = f.frames.filter((frame) => frame.at >= count * 50 - 1000);
        expect(tail.length).toBeGreaterThan(60);
        expect(tail.every((frame) => Math.abs(frame.tick - frame.target) < 1e-6)).toBe(true);
        expect(tail.every((frame) => frame.headroom >= 12 - 1e-6 && frame.headroom < 12.1)).toBe(
          true,
        );
        // Temporary catch-up is bounded too; a monotonic but permanently delayed
        // clock would pass the rate test and fail these headroom assertions.
        expect(Math.max(...f.frames.map((frame) => frame.headroom))).toBeLessThan(55);
        expect(Math.min(...f.frames.map((frame) => frame.headroom))).toBeGreaterThan(0);
        if (name.startsWith('one-way')) {
          expect(f.frames.some((frame) => frame.kind === 'held' && frame.stalled)).toBe(true);
          expect(tail.every((frame) => !frame.stalled)).toBe(true);
          expect(f.client.stats.inputPackets).toBeGreaterThan(470);
        }
        if (name.startsWith('200')) expect(f.client.stats.lateSnapshots).toBeGreaterThan(0);
      } finally {
        f.client.dispose();
      }
    },
  );

  it('spends no extra correction on repeated views at the same instant', () => {
    const f = stream(50, -100_000);
    try {
      f.schedule(120, increaseAt45);
      f.loop.runUntil(4402);
      const first = f.client.view().remotes[0];
      expect(
        first.tick - (f.client.clock.arrivalTick(f.client.now) - f.client.jitter.delayTicks),
      ).toBeGreaterThan(17);
      for (let i = 0; i < 100; i++) expect(f.client.view().remotes[0]).toEqual(first);
      f.loop.runUntil(5002);
      const after = f.client.view().remotes[0];
      expect(after.tick).toBeCloseTo(
        f.client.clock.arrivalTick(f.client.now) - f.client.jitter.delayTicks,
        6,
      );
    } finally {
      f.client.dispose();
    }
  });

  it('resets presentation during a reentrant grid replacement without resetting input timing', () => {
    const f = stream();
    try {
      f.schedule(120, increaseAt45);
      f.loop.runUntil(4402);
      let replacement:
        | { before: number; after: number; target: number; commands: number }
        | undefined;
      f.client.config.input = () => {
        if (!replacement) {
          const before = f.client.view().remotes[0].tick;
          const arrival = f.client.clock.arrivalTick(f.client.now);
          const target = arrival - f.client.jitter.delayTicks;
          const commands = f.client.stats.commands;
          // A valid synchronous transport delivery inside a user callback.
          f.pair.client.onMessage!(encodeControl({ ...grid, events: [] }), 'reliable');
          replacement = { before, after: f.client.view().remotes[0].tick, target, commands };
          expect(f.client.clock.arrivalTick(f.client.now)).toBe(arrival);
          expect(f.client.targetTick()).toBe(arrival + f.client.lead);
        }
        return controls();
      };
      f.loop.runUntil(4417);
      expect(replacement).toBeDefined();
      expect(replacement!.before - replacement!.target).toBeGreaterThan(10);
      expect(replacement!.after).toBe(replacement!.target);
      expect(f.client.stats.commands).toBe(replacement!.commands + 1);
      expect(f.client.state).toBe('race');
      expect(f.client.stats.snapshots).toBe(84);
    } finally {
      f.client.dispose();
    }
  });

  it('starts a reconnect and a subsequent race without inherited correction debt', () => {
    const f = stream();
    let replacement: RaceClient | undefined;
    const next = stream(50, -86_400_000, 60_000);
    try {
      f.schedule(120, increaseAt45);
      f.loop.runUntil(4402);
      expect(f.frames.at(-1)!.tick - f.frames.at(-1)!.target).toBeGreaterThan(17);
      const retired = f.pair.client.onMessage!;
      const previousTick = f.client.lastSnapshotTick;
      f.client.dispose();
      const freshFrames: Frame[] = [];
      replacement = new RaceClient({
        ...f.client.config,
        token: '0123456789abcdef0123456789abcdef',
        onRender: (view, client) => {
          const before = f.frames.length;
          f.record(view, client);
          if (f.frames.length > before) freshFrames.push(f.frames.at(-1)!);
        },
      });
      replacement.join();
      f.pair.server.send(
        encodeControl({ ...grid, serverTick: previousTick, events: [] }),
        'reliable',
      );
      f.loop.runUntil(5350);
      expect(replacement.state).toBe('race');
      expect(freshFrames.length).toBeGreaterThan(20);
      expect(freshFrames.every((frame) => Math.abs(frame.tick - frame.target) < 1e-6)).toBe(true);
      retired(encodeSnapshot(replacement.latest!), 'unreliable');
      expect(f.client.lastSnapshotTick).toBe(previousTick);
      expect(f.client.state).toBe('closed');

      // A new race uses a new client, as completed clients are terminal. Its
      // first authoritative tick is 6 even though this event loop starts at 60 s.
      next.schedule(120, () => {});
      next.loop.runUntil(66_150);
      expect(next.client.stats.snapshots).toBe(120);
      expectBoundedPlayback(next.frames);
      expect(next.frames[0].tick).toBeLessThan(8);
      expect(next.frames.every((frame) => Math.abs(frame.tick - frame.target) < 1e-6)).toBe(true);
    } finally {
      f.client.dispose();
      replacement?.dispose();
      next.client.dispose();
    }
  });
});

/** Independent pre-discipline rendering and input-target equations. No call
 * to the new presentation clock: accidental scheduler coupling changes wire
 * bytes against this reference. Connection-warning presentation is irrelevant
 * to these fixed controls and is intentionally omitted from the comparison. */
class RawArrivalClient extends RaceClient {
  override targetTick(now = this.now) {
    return this.clock.arrivalTick(now) + this.lead;
  }
  override view(): ClientView {
    const now = this.now;
    const tick = this.clock.arrivalTick(now) - this.jitter.delayTicks;
    const remotes: RenderedCar[] = [];
    for (const [car, track] of this.remotes) {
      const sample = track.sample(tick);
      if (sample) remotes.push({ car, tick, ...sample });
    }
    return {
      now,
      local:
        this.predictor.ready && this.car >= 0
          ? {
              car: this.car,
              pose: this.predictor.render(now),
              tick: this.predictor.tick,
              kind: 'predicted',
            }
          : null,
      remotes,
      stalled: false,
    };
  }
}

function realRaceWire(reference: boolean) {
  const f = onlineFixture({
    capacity: 2,
    raceSeconds: 20,
    server: { timeouts: { gridCountdownMs: 1 } },
  });
  const packets: { direction: string; channel: Channel; data: Uint8Array }[] = [];
  let correctingFrames = 0;
  const Client = reference ? RawArrivalClient : RaceClient;
  const peers = [0, 1].map((index) => {
    const link = { ...PERFECT_LINK, latencyMs: 50 };
    const pair = f.net.connect(link, link);
    for (const [direction, transport] of [
      ['up', pair.client],
      ['down', pair.server],
    ] as const) {
      const send = transport.send.bind(transport);
      transport.send = (data, channel) => {
        if (channel === 'unreliable')
          packets.push({ direction: `${index}:${direction}`, channel, data: data.slice() });
        send(data, channel);
      };
    }
    f.server.accept(pair.server);
    const client = new Client({
      loop: f.loop,
      transport: pair.client,
      name: `Driver ${index}`,
      vehicle: 'apx01',
      advertised: f.session,
      autoReady: true,
      clockOffsetMs: index ? -100_000 : 123_456,
      input: ({ tick }) => ({
        ...controls(),
        throttle: 0.3 + (Math.floor(tick / 60) % 3) * 0.1,
        brake: tick % 180 > 150 ? 0.05 : 0,
        rearBrake: tick % 240 > 210 ? 0.04 : 0,
        steer: Math.sin(tick / 120) * 0.01,
        shift: tick % 480 < 2 ? 1 : 0,
      }),
      onRender: (view, current) => {
        const target = current.clock.arrivalTick(view.now) - current.jitter.delayTicks;
        if (view.remotes.some((remote) => Math.abs(remote.tick - target) > 1e-6))
          correctingFrames++;
      },
    });
    client.join();
    return { client, pair };
  });
  const down = peers[0].pair.link.server.conditions;
  f.loop.at(2500, () => {
    down.latencyMs = 200;
  });
  f.loop.at(6000, () => {
    down.latencyMs = 25;
  });
  f.loop.at(8500, () => {
    down.loss = 1;
  });
  f.loop.at(9500, () => {
    Object.assign(down, TARGET_LINK);
  });
  f.loop.at(11_000, () => {
    Object.assign(down, PERFECT_LINK, { latencyMs: 50 });
  });
  try {
    f.loop.runUntil(12_500);
    expect(peers.every(({ client }) => client.state === 'race')).toBe(true);
    expect(f.server.stats.invalidMessages).toBe(0);
    expect(f.server.stats.kicks).toEqual([]);
    expect(packets.filter((packet) => packet.direction.endsWith(':up')).length).toBeGreaterThan(
      700,
    );
    expect(packets.filter((packet) => packet.direction.endsWith(':down')).length).toBeGreaterThan(
      480,
    );
    return {
      packets,
      correctingFrames,
      rawMetrics: peers.map(({ client }) => ({
        rtt: client.stats.rttMs,
        lead: client.stats.leadTicks,
        delay: client.stats.interpolationDelayTicks,
        targets: client.targetTick(),
        prediction: structuredClone(client.predictor.stats),
      })),
      inputs: f.server.inputStats(),
      worldTick: f.server.world!.tick,
    };
  } finally {
    peers.forEach(({ client }) => client.dispose());
    f.server.teardown();
  }
}

it('preserves every real-server snapshot and input-packet byte while presentation converges', () => {
  const reference = realRaceWire(true);
  const current = realRaceWire(false);
  expect(reference.correctingFrames).toBe(0);
  expect(current.correctingFrames).toBeGreaterThan(50);
  expect(current.packets).toEqual(reference.packets);
  expect(current.rawMetrics).toEqual(reference.rawMetrics);
  expect(current.inputs).toEqual(reference.inputs);
  expect(current.worldTick).toBe(reference.worldTick);
  console.log('clock discipline wire comparison:', {
    packets: current.packets.length,
    inputPackets: current.packets.filter((packet) => packet.direction.endsWith(':up')).length,
    snapshots: current.packets.filter((packet) => packet.direction.endsWith(':down')).length,
    correctingFrames: current.correctingFrames,
  });
});
