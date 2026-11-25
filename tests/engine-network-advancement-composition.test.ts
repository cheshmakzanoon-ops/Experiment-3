import { describe, expect, it } from 'vitest';
import { RaceClient } from '../src/net/client.ts';
import { decodeClientMessage, decodeServerMessage } from '../src/net/codec.ts';
import { TICK_MS } from '../src/net/constants.ts';
import type { InputPacket } from '../src/net/input.ts';
import { CAR_FLAG, type Snapshot } from '../src/net/snapshot.ts';
import { NetworkSimulator, PERFECT_LINK, type Channel } from '../src/net/transport.ts';
import { controls } from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

interface WirePacket {
  peer: string;
  direction: 'up' | 'down';
  at: number;
  channel: Channel;
  data: Uint8Array;
  retained: Uint8Array;
  corrupted: boolean;
}
interface HeaderObservation {
  at: number;
  tick: number;
  ackSeq: number;
  slack: number;
  missing: number;
  echo: number;
  hold: number;
  full: number[];
}
interface PlaybackObservation {
  frames: number;
  bounded: boolean;
  rawRewinds: number;
  correcting: number;
  rawTargetErrors: number;
  lastError: number;
}
interface LivePeer {
  key: string;
  driver: number;
  client: RaceClient;
  pair: ReturnType<NetworkSimulator['connect']>;
  inputs: InputPacket[];
  headers: HeaderObservation[];
  playback: PlaybackObservation;
}

/** Uses the ordinary race fixture and actual wire codecs, timers, authoritative
 * physics and seeded transport. Only the one replacement join is delivered
 * synchronously by the transport hook, while a snapshot batch is dispatching.
 * The returned scalar/packet observations also let a disposable probe run this
 * identical workload against the actual original source tree. */
export function runLiveComposition(seed: number) {
  const f = onlineFixture({
    capacity: 3,
    raceSeconds: 60,
    server: {
      disconnectPolicy: 'ghost',
      timeouts: { gridCountdownMs: 1, disconnectMs: 2000, inputStarvationMs: 200 },
    },
  });
  const net = new NetworkSimulator(f.loop, seed);
  const peers: LivePeer[] = [];
  const active = new Map<number, LivePeer>();
  const wire: WirePacket[] = [];
  const boundaries: { at: number; tick: number; recipients: number }[] = [];
  const state = f.server as unknown as { snapshot(): void };
  const snapshot = state.snapshot.bind(f.server);
  state.snapshot = () => {
    boundaries.push({
      at: f.loop.now,
      tick: f.server.world!.tick,
      recipients: [0, 1, 2].filter((car) => f.server.playerByCar(car)?.connected).length,
    });
    snapshot();
  };
  let transitionTick = -1;
  const sendFailure = new Error('composition datagram refused');
  const lifetime = { pending: -1 };

  function connect(driver: number, token?: string, synchronousJoin = false): LivePeer {
    const generation = peers.filter((peer) => peer.driver === driver).length;
    const key = `${driver}:${generation}`;
    const pair = net.connect({ ...PERFECT_LINK, latencyMs: 50 });
    const inputs: InputPacket[] = [];
    const headers: HeaderObservation[] = [];
    const playback: PlaybackObservation = {
      frames: 0,
      bounded: true,
      rawRewinds: 0,
      correcting: 0,
      rawTargetErrors: 0,
      lastError: 0,
    };
    let previous: { at: number; remote: number; raw: number } | undefined;
    const client = new RaceClient({
      loop: f.loop,
      transport: pair.client,
      name: `Composition ${driver}`,
      vehicle: 'apx01',
      advertised: f.session,
      autoReady: true,
      token,
      clockOffsetMs: [123_456, -100_000, 0][driver],
      input: ({ tick, client: current }) => {
        if (current.targetTick() !== current.clock.arrivalTick(current.now) + current.lead)
          playback.rawTargetErrors++;
        return {
          ...controls(),
          throttle: 0.25 + driver * 0.07 + (Math.floor(tick / 90) % 3) * 0.04,
          steer: Math.sin(tick / 180 + driver) * 0.005,
          rearBrake: tick % 240 > 210 ? 0.043 : 0,
          shift: tick % 480 < 2 ? 1 : 0,
        };
      },
      onRender: (view, current) => {
        const remote = view.remotes[0];
        if (!remote) return;
        const raw = current.clock.arrivalTick(view.now) - current.jitter.delayTicks;
        if (previous) {
          const elapsed = (view.now - previous.at) / TICK_MS;
          const advance = remote.tick - previous.remote;
          playback.bounded &&= advance >= 0.75 * elapsed - 1e-6 && advance <= 1.25 * elapsed + 1e-6;
          if (raw < previous.raw - 1e-6) playback.rawRewinds++;
        }
        playback.frames++;
        playback.lastError = remote.tick - raw;
        if (Math.abs(playback.lastError) > 1e-6) playback.correcting++;
        previous = { at: view.now, remote: remote.tick, raw };
      },
    });
    const peer = { key, driver, client, pair, inputs, headers, playback };
    peers.push(peer);
    active.set(driver, peer);
    for (const [direction, transport] of [
      ['up', pair.client],
      ['down', pair.server],
    ] as const) {
      const send = transport.send.bind(transport);
      transport.send = (data, channel) => {
        const packet: WirePacket = {
          peer: key,
          direction,
          at: f.loop.now,
          channel,
          data,
          retained: data.slice(),
          corrupted: false,
        };
        let sentSnapshot: Snapshot | undefined;
        if (channel === 'unreliable') {
          wire.push(packet);
          if (direction === 'up') {
            const decoded = decodeClientMessage(data, channel);
            if (!decoded.ok || decoded.value.type !== 'input')
              throw new Error('The live client emitted an invalid input packet');
            inputs.push(decoded.value.packet);
          } else {
            const decoded = decodeServerMessage(data, channel);
            if (!decoded.ok || decoded.value.type !== 'snapshot')
              throw new Error('The live server emitted an invalid snapshot');
            const s = (sentSnapshot = decoded.value.snapshot);
            headers.push({
              at: f.loop.now,
              tick: s.tick,
              ackSeq: s.ackSeq,
              slack: s.slack,
              missing: s.missing,
              echo: s.echo,
              hold: s.hold,
              full: s.cars.filter((car) => car.flags & CAR_FLAG.FULL).map((car) => car.id),
            });
          }
        }
        if (sentSnapshot && key === '2:0' && sentSnapshot.tick === transitionTick) {
          // The failed adapter can mutate its owned packet before throwing.
          // Its sibling recipients and the nested captured batch must survive.
          packet.corrupted = true;
          data.fill(0);
          throw sendFailure;
        }
        if (synchronousJoin && direction === 'up' && channel === 'reliable') {
          const decoded = decodeClientMessage(data, channel);
          if (
            decoded.ok &&
            decoded.value.type === 'control' &&
            decoded.value.control.kind === 'join'
          ) {
            pair.server.onMessage!(data, channel);
            return;
          }
        }
        send(data, channel);
        if (!sentSnapshot || key !== '0:0') return;
        if (transitionTick < 0 && f.loop.now >= 6000) {
          transitionTick = sentSnapshot.tick;
          const replaced = active.get(1)!;
          replaced.client.dispose();
          // A synchronous transport close callback retires the captured owner.
          replaced.pair.server.onClose!('composition replacement');
          replaced.pair.client.close('composition replacement');
          connect(1, replaced.client.token, true);
          state.snapshot();
        } else if (sentSnapshot.tick === transitionTick) {
          state.snapshot(); // A second reentry must coalesce, not recurse.
        }
      };
    }
    f.server.accept(pair.server);
    client.join();
    return peer;
  }

  const initial = [0, 1, 2].map((driver) => connect(driver));
  f.loop.at(500, () => {
    Object.assign(initial[2].pair.link.client.conditions, {
      jitterMs: 6,
      loss: 0.12,
      duplicate: 0.3,
      reorder: 0.2,
    });
    Object.assign(initial[2].pair.link.server.conditions, {
      jitterMs: 6,
      loss: 0.06,
      duplicate: 0.2,
      reorder: 0.15,
    });
  });
  f.loop.at(1300, () => {
    initial[0].pair.link.server.conditions.latencyMs = 200;
  });
  f.loop.at(2200, () => {
    initial[1].pair.link.client.conditions.loss = 1;
  });
  f.loop.at(2550, () => {
    Object.assign(initial[1].pair.link.client.conditions, {
      latencyMs: 90,
      jitterMs: 9,
      loss: 0.05,
      duplicate: 0.2,
      reorder: 0.25,
    });
  });
  f.loop.at(3600, () => {
    Object.assign(initial[1].pair.link.client.conditions, PERFECT_LINK, { latencyMs: 50 });
  });
  f.loop.at(4250, () => {
    Object.assign(initial[0].pair.link.server.conditions, {
      latencyMs: 20,
      jitterMs: 12,
      loss: 0.08,
      duplicate: 0.2,
      reorder: 0.15,
    });
  });
  f.loop.at(5200, () => {
    Object.assign(initial[0].pair.link.server.conditions, PERFECT_LINK, { latencyMs: 50 });
  });
  const retire = (driver: number) => {
    const peer = active.get(driver)!;
    peer.client.dispose();
    peer.pair.client.close('composition recipient transition');
    active.delete(driver);
  };
  f.loop.at(6500, () => retire(1));
  f.loop.at(6800, () => retire(0));
  f.loop.at(7100, () => connect(0, initial[0].client.token));
  f.loop.at(7500, () => connect(2, initial[2].client.token));
  f.loop.at(7900, () => connect(1, initial[1].client.token));
  try {
    f.loop.runUntil(9000);
    return {
      seed,
      transitionTick,
      boundaries,
      wire,
      peers: peers.map(({ key, client, inputs, headers, playback }) => ({
        key,
        car: client.car,
        state: client.state,
        inputs,
        headers,
        playback,
        // Raw feedback and local prediction deliberately exclude remote render
        // kinds, which the presentation-clock change is intended to alter.
        commandState: {
          nextSeq: client.commands.nextSeq,
          nextTick: client.commands.nextTick,
          ackSeq: client.commands.ackSeq,
          lastSnapshotTick: client.lastSnapshotTick,
          rawTarget: client.targetTick(),
          lead: client.lead,
          rtt: [...client.stats.rttMs],
          leadHistory: [...client.stats.leadTicks],
          delayHistory: [...client.stats.interpolationDelayTicks],
          prediction: structuredClone(client.predictor.stats),
          predicted: client.predictor.predictedAt(client.predictor.tick),
          inputPackets: client.stats.inputPackets,
          commandCopies: client.stats.commandCopies,
          duplicateSnapshots: client.stats.duplicateSnapshots,
          invalidMessages: client.stats.invalidMessages,
        },
        events: structuredClone(client.events),
      })),
      server: {
        tick: f.server.world!.tick,
        inputs: f.server.inputStats(),
        snapshots: f.server.stats.snapshotsSent,
        invalidMessages: f.server.stats.invalidMessages,
        kicks: [...f.server.stats.kicks],
        rejoins: [...f.server.stats.rejoins],
        transportErrors: f.server.stats.transportErrors.map(({ error, operation }) => ({
          original: error === sendFailure,
          operation,
        })),
        connected: [0, 1, 2].map((car) => f.server.playerByCar(car)?.connected),
      },
      lifetime,
    };
  } finally {
    state.snapshot = snapshot;
    for (const peer of peers) {
      peer.client.dispose();
      peer.pair.client.close('fixture cleanup');
      peer.pair.server.close('fixture cleanup');
    }
    f.server.teardown();
    f.loop.runUntil(16_000);
    lifetime.pending = f.loop.pending;
  }
}

describe('network advancement composition through live peers', () => {
  it.each([17, 48_177])(
    'preserves ownership and raw feedback through reentry, replacement and 3/1/0/1/3 recipients (seed %i)',
    (seed) => {
      const result = runLiveComposition(seed);
      expect(result.server.invalidMessages).toBe(0);
      expect(result.server.kicks).toEqual([]);
      expect(result.server.transportErrors).toEqual([{ original: true, operation: 'send' }]);
      expect(result.server.rejoins).toHaveLength(4);
      expect(result.server.connected).toEqual([true, true, true]);
      expect(result.lifetime.pending).toBe(0);
      expect(new Set(result.boundaries.map(({ recipients }) => recipients))).toEqual(
        new Set([0, 1, 2, 3]),
      );
      const quietTicks = new Set(
        result.boundaries.filter((b) => b.recipients === 0).map((b) => b.tick),
      );
      expect(quietTicks.size).toBeGreaterThan(3);
      const allHeaders = result.peers.flatMap((peer) => peer.headers);
      expect(allHeaders.some((header) => quietTicks.has(header.tick))).toBe(false);
      expect(allHeaders.some((header) => header.slack < 0)).toBe(true);
      expect(allHeaders.some((header) => header.missing > 0)).toBe(true);

      for (const peer of result.peers) {
        expect(peer.commandState.invalidMessages).toBe(0);
        expect(peer.commandState.ackSeq).toBeLessThan(peer.commandState.nextSeq);
        expect(peer.playback.frames).toBeGreaterThan(15);
        expect(peer.playback.bounded).toBe(true);
        expect(peer.playback.rawTargetErrors).toBe(0);
        const sent = new Set(peer.inputs.map((packet) => packet.sentAt));
        const sequences = new Set(
          peer.inputs.flatMap((packet) => packet.commands.map((c) => c.seq)),
        );
        for (const header of peer.headers) {
          expect(header.full).toEqual([peer.car]);
          if (header.echo) expect(sent.has(header.echo)).toBe(true);
          if (header.ackSeq >= 0) expect(sequences.has(header.ackSeq)).toBe(true);
        }
      }
      const first = result.peers.find((peer) => peer.key === '0:0')!;
      expect(first.playback.rawRewinds).toBeGreaterThan(0);
      expect(first.playback.correcting).toBeGreaterThan(20);
      expect(first.commandState.duplicateSnapshots).toBeGreaterThan(0);
      expect(first.headers.filter((s) => s.tick === result.transitionTick)).toHaveLength(2);
      expect(
        result.peers
          .find((peer) => peer.key === '1:0')!
          .headers.every((s) => s.tick !== result.transitionTick),
      ).toBe(true);
      const replacement = result.peers.find((peer) => peer.key === '1:1')!;
      expect(replacement.headers[0]).toMatchObject({
        tick: result.transitionTick,
        ackSeq: -1,
        echo: 0,
        slack: 127,
        missing: 0,
      });
      expect(replacement.commandState.ackSeq).toBeGreaterThan(0);
      expect(result.server.inputs.every((stats) => stats.duplicates > 0)).toBe(true);
      expect(
        result.peers.some((peer) => peer.inputs.some((packet) => packet.commands.length === 12)),
      ).toBe(true);
      expect(result.wire.filter((packet) => packet.corrupted)).toHaveLength(1);
      expect(new Set(result.wire.map((packet) => packet.data.buffer)).size).toBe(
        result.wire.length,
      );
      for (const packet of result.wire) {
        if (!packet.corrupted) expect(packet.data).toEqual(packet.retained);
      }
    },
  );
});
