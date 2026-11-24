import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RaceClient } from '../src/net/client.ts';
import { decodeClientMessage, decodeServerMessage, encodeSnapshot } from '../src/net/codec.ts';
import { LIMITS } from '../src/net/constants.ts';
import { NETWORK_METRIC_CAPACITY } from '../src/net/metric-samples.ts';
import { CAR_FLAG } from '../src/net/snapshot.ts';
import { PERFECT_LINK, TARGET_LINK } from '../src/net/transport.ts';
import { controls } from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

const clientMetrics = [
  'rttMs',
  'leadTicks',
  'interpolationDelayTicks',
  'snapshotBytes',
  'inputBytes',
] as const;
const predictorMetrics = [
  'positionError',
  'headingError',
  'positionErrorClean',
  'positionErrorContact',
  'positionErrorAi',
  'correction',
  'visualStep',
] as const;

/** All mutated values below are documented detached outputs. In particular,
 * the test does not promise that the public mutable `client.latest` is a copy. */
function mutateCopies(client: RaceClient) {
  for (const key of clientMetrics) {
    client.stats[key].fill(NaN);
    client.stats[key].push(Infinity);
    client.stats.sampleTotals[key].sum = NaN;
  }
  for (const key of predictorMetrics) {
    client.predictor.stats[key].fill(NaN);
    client.predictor.stats[key].push(Infinity);
    client.predictor.stats.sampleTotals[key].observations = -1;
  }
  const authoritative = client.predictor.authoritative;
  if (authoritative) {
    authoritative.tick = -1;
    authoritative.state.x = NaN;
    authoritative.state.vz = Infinity;
    authoritative.state.flags = CAR_FLAG.AI;
  }
  const predicted = client.predictor.predictedAt(client.predictor.tick);
  if (predicted) predicted.x = predicted.qw = NaN;
  for (const track of client.remotes.values()) {
    const latest = track.latest();
    if (latest) latest.x = latest.qw = NaN;
    const interpolated = track.sample(track.newest - 3);
    if (interpolated) interpolated.pose.z = interpolated.pose.qy = NaN;
  }
}

function assertFinitePose(pose: object) {
  for (const value of Object.values(pose)) expect(Number.isFinite(value)).toBe(true);
}

/** Run the real authoritative physics, wire codecs and both clients for 90
 * simulated seconds. A proxy changes only ACK metadata during the stale-ACK
 * interval; all state and command payloads still come from the real endpoints. */
function extendedSession(mutate: boolean) {
  const fixture = onlineFixture({
    capacity: 2,
    raceSeconds: 180,
    link: PERFECT_LINK,
    server: { timeouts: { gridCountdownMs: 1 } },
  });
  const driver =
    (offset: number) =>
    ({ tick }: { tick: number }) => ({
      ...controls(),
      throttle: Math.floor(tick / 240 + offset) % 4 === 3 ? 0.1 : 0.42,
      brake: tick % 960 >= 840 ? 0.1 : 0,
      steer: Math.sin((tick + offset * 37) / 300) * 0.018,
    });
  const first = fixture.connect('Primary', { input: driver(0) });
  const second = fixture.connect('Remote', { input: driver(1) });
  const peers = [first, second];
  const wire = createHash('sha256');
  const rendered = createHash('sha256');
  let packetCount = 0;
  let frameCount = 0;
  let staleAck = false;
  let maxHistory = 0;
  let latestInputSeq = -1;
  const phases: {
    time: number;
    snapshot: number;
    ack: number;
    commands: number;
    stalled: boolean;
  }[] = [];

  for (const [index, peer] of peers.entries()) {
    const send = peer.transport.send.bind(peer.transport);
    peer.transport.send = (data, channel) => {
      if (channel === 'unreliable') {
        const decoded = decodeClientMessage(data, channel);
        expect(decoded.ok).toBe(true);
        if (!decoded.ok || decoded.value.type !== 'input') throw new Error('Expected input packet');
        const commands = decoded.value.packet.commands;
        expect(commands.length).toBeLessThanOrEqual(LIMITS.inputRedundancy);
        expect(data.byteLength).toBeLessThanOrEqual(LIMITS.datagramBytes);
        for (let i = 1; i < commands.length; i++) {
          expect(commands[i].seq).toBeGreaterThan(commands[i - 1].seq);
          expect(commands[i].tick).toBeGreaterThanOrEqual(
            commands[i - 1].tick + commands[i - 1].ticks,
          );
        }
        if (index === 0 && commands.length) latestInputSeq = commands.at(-1)!.seq;
        wire.update(Buffer.from([index, 0])).update(data);
        packetCount++;
      }
      send(data, channel);
    };
    const sendDown = peer.link.server.send.bind(peer.link.server);
    peer.link.server.send = (data, channel) => {
      if (channel === 'unreliable') {
        const decoded = decodeServerMessage(data, channel);
        expect(decoded.ok).toBe(true);
        if (!decoded.ok || decoded.value.type !== 'snapshot') throw new Error('Expected snapshot');
        if (index === 0 && staleAck)
          data = encodeSnapshot({ ...decoded.value.snapshot, ackSeq: -1 });
        wire.update(Buffer.from([index, 1])).update(data);
      }
      sendDown(data, channel);
    };
    peer.client.config.onRender = (view) => {
      const poses = [view.local?.pose, ...view.remotes.map((remote) => remote.pose)].filter(
        (pose) => pose !== undefined,
      );
      for (const pose of poses) {
        assertFinitePose(pose);
        rendered.update(Buffer.from(Float64Array.from(Object.values(pose)).buffer));
        if (mutate) pose.x = pose.qw = NaN;
      }
      frameCount++;
    };
  }

  const advance = (until: number) => {
    for (let time = fixture.loop.now + 250; time <= until; time += 250) {
      fixture.loop.runUntil(time);
      for (const peer of peers) {
        maxHistory = Math.max(maxHistory, peer.client.commands.size);
        expect(peer.client.commands.size).toBeLessThanOrEqual(
          peer.client.commands.historyTicks + 1,
        );
        if (mutate && time % 1000 === 0) mutateCopies(peer.client);
      }
    }
    const c = first.client;
    phases.push({
      time: until,
      snapshot: c.lastSnapshotTick,
      ack: c.commands.ackSeq,
      commands: c.stats.commands,
      stalled: c.view().stalled,
    });
  };

  try {
    advance(5000);
    expect(first.client.state).toBe('race');
    expect(second.client.state).toBe('race');
    staleAck = true;
    const ackBefore = first.client.commands.ackSeq;
    advance(15000);
    expect(first.client.commands.ackSeq).toBe(ackBefore);
    expect(first.client.stats.commands).toBeGreaterThan(850);
    expect(first.client.commands.size).toBeLessThanOrEqual(185);
    staleAck = false;
    advance(20000);
    expect(first.client.commands.ackSeq).toBeGreaterThan(ackBefore + 600);

    const snapshotBefore = first.client.lastSnapshotTick;
    const issuedBefore = first.client.stats.commands;
    // Keep uplink commands flowing; the authoritative driver stays connected.
    first.link.server.conditions.loss = 1;
    advance(29000);
    expect(first.client.lastSnapshotTick).toBe(snapshotBefore);
    expect(first.client.stats.commands - issuedBefore).toBeGreaterThan(530);
    expect(first.client.commands.size).toBeLessThanOrEqual(185);
    expect(first.client.view().stalled).toBe(true);
    expect(fixture.server.playerByCar(first.client.car)).toMatchObject({
      connected: true,
      mode: 'human',
    });
    expect(latestInputSeq).toBeGreaterThan(first.client.commands.nextSeq - 4);

    Object.assign(first.link.server.conditions, TARGET_LINK);
    advance(50000);
    Object.assign(first.link.server.conditions, PERFECT_LINK);
    advance(90000);

    for (const peer of peers) {
      const client = peer.client;
      expect(client.state).toBe('race');
      expect(client.view().stalled).toBe(false);
      expect(client.lastSnapshotTick).toBeGreaterThan(10_700);
      expect(client.commands.ackSeq).toBeGreaterThan(client.commands.nextSeq - 16);
      expect(client.stats.invalidMessages).toBe(0);
      expect(client.stats.rejectedSamples).toBe(0);
      expect(client.stats.interpolationDelayTicks).toHaveLength(NETWORK_METRIC_CAPACITY);
      expect(client.stats.sampleTotals.interpolationDelayTicks.observations).toBeGreaterThan(5300);
      expect(client.predictor.stats.visualStep).toHaveLength(NETWORK_METRIC_CAPACITY);
      expect(client.predictor.authoritative?.tick).toBe(client.lastSnapshotTick);
      const auth = client.predictor.authoritative!.state;
      expect(auth).toEqual(client.carState(client.car));
      for (const [car, track] of client.remotes)
        expect(track.latest()).toEqual(client.carState(car));
      for (const key of clientMetrics) {
        expect(client.stats[key].length).toBeLessThanOrEqual(NETWORK_METRIC_CAPACITY);
        expect(client.stats[key].every(Number.isFinite)).toBe(true);
      }
      for (const key of predictorMetrics) {
        expect(client.predictor.stats[key].length).toBeLessThanOrEqual(NETWORK_METRIC_CAPACITY);
        expect(client.predictor.stats[key].every(Number.isFinite)).toBe(true);
      }
    }
    expect(fixture.server.stats.kicks).toEqual([]);
    expect(fixture.server.stats.takeovers).toEqual([]);
    expect(fixture.server.stats.invalidMessages).toBe(0);
    expect(fixture.server.stats.oversizeMessages).toBe(0);
    const report = {
      wire: wire.digest('hex'),
      rendered: rendered.digest('hex'),
      packetCount,
      frameCount,
      maxHistory,
      phases,
      tick: fixture.server.world!.tick,
      clients: peers.map(({ client }) => ({
        stats: client.stats,
        prediction: client.predictor.stats,
        authoritative: client.predictor.authoritative,
        remote: [...client.remotes.values()].map((track) => track.latest()),
      })),
      inputs: fixture.server.inputStats(),
    };
    // Materialize getter-based stats before teardown; neither run can retain
    // references to another live scenario's diagnostic getters.
    return structuredClone(report);
  } finally {
    peers.forEach(({ client }) => client.dispose());
    fixture.server.teardown();
    fixture.loop.runUntil(100000);
    expect(fixture.loop.pending).toBe(0);
    expect(peers.every(({ transport }) => !transport.open)).toBe(true);
  }
}

describe('bounded network histories across actual server recovery', () => {
  it('preserves exact wire and render output through stale ACKs, downlink loss, jitter and window wrap despite consumer mutation', () => {
    const reference = extendedSession(false);
    const mutated = extendedSession(true);
    expect(mutated).toEqual(reference);
    expect(reference.maxHistory).toBeLessThanOrEqual(185);
    expect(reference.packetCount).toBeGreaterThan(5300);
    expect(reference.frameCount).toBeGreaterThan(10700);
  }, 90000);

  it('rejoins a timed-out driver with fresh bounded history and retires the old client while a remote keeps racing', () => {
    const f = onlineFixture({
      capacity: 2,
      raceSeconds: 60,
      link: PERFECT_LINK,
      server: { timeouts: { gridCountdownMs: 1 } },
    });
    const first = f.connect('Original', {
      account: 'owner',
      input: () => ({ ...controls(), throttle: 0.7 }),
    });
    const other = f.connect('Remote');
    let replacement: ReturnType<typeof f.connect> | undefined;
    try {
      f.loop.runUntil(5000);
      const car = first.client.car;
      const token = first.client.token;
      const retiredReceive = first.transport.onMessage!;
      const oldNext = first.client.commands.nextSeq;
      const oldStats = structuredClone(first.client.stats);
      first.link.sever();
      first.client.dispose();
      f.loop.runUntil(8000);
      expect(f.server.playerByCar(car)).toMatchObject({ connected: false, mode: 'ai' });
      expect(other.client.state).toBe('race');
      expect(f.server.stats.takeovers).toHaveLength(1);
      replacement = f.connect('Restarted', {
        account: 'owner',
        token,
        input: () => ({ ...controls(), throttle: 0.15, brake: 0.2 }),
      });
      f.loop.runWhile(() => f.server.stats.rejoins.length === 0, 8100);
      expect(f.server.stats.rejoins).toHaveLength(1);
      expect(f.server.playerByCar(car)).toMatchObject({ connected: true, mode: 'ai' });
      expect(replacement.client.commands.started).toBe(false);
      f.loop.runUntil(15000);
      const client = replacement.client;
      expect(client.car).toBe(car);
      expect(client.player).toBe(first.client.player);
      expect(client.state).toBe('race');
      expect(f.server.playerByCar(car)).toMatchObject({ connected: true, mode: 'human' });
      expect(client.commands.nextSeq).toBeGreaterThan(400);
      expect(client.commands.nextSeq).toBeLessThan(430);
      expect(client.commands.size).toBeLessThanOrEqual(185);
      expect(client.commands.ackSeq).toBeGreaterThan(client.commands.nextSeq - 16);
      expect(client.predictor.authoritative!.state.flags & CAR_FLAG.AI).toBe(0);
      expect(
        client.events.some(
          (event) => event.type === 'driver' && event.car === car && event.reason === 'rejoined',
        ),
      ).toBe(true);
      expect(client.stats.invalidMessages).toBe(0);
      expect(f.server.stats.kicks).toEqual([]);
      expect(other.client.stats.snapshots).toBeGreaterThan(290);

      // A transport may retain its old callback even after process disposal.
      // Deliver a fresh legitimate snapshot to that retired owner explicitly.
      retiredReceive(encodeSnapshot(client.latest!), 'unreliable');
      expect(first.client.state).toBe('closed');
      expect(first.client.commands.nextSeq).toBe(oldNext);
      expect(first.client.stats).toEqual(oldStats);
      const before = client.predictor.authoritative;
      mutateCopies(first.client);
      expect(client.predictor.authoritative).toEqual(before);
      expect(client.view().stalled).toBe(false);
    } finally {
      first.client.dispose();
      other.client.dispose();
      replacement?.client.dispose();
      f.server.teardown();
      f.loop.runUntil(25000);
      expect(f.loop.pending).toBe(0);
      expect(other.transport.open).toBe(false);
      expect(replacement?.transport.open).toBe(false);
    }
  }, 30000);
});
