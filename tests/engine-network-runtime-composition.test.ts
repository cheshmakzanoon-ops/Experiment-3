import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeControl,
  encodeInput,
} from '../src/net/codec.ts';
import type { EventLoop } from '../src/net/event-loop.ts';
import type { InputCommand } from '../src/net/input.ts';
import { verifyRecord } from '../src/net/records.ts';
import { CAR_FLAG, type Snapshot } from '../src/net/snapshot.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import { controls, type Controls } from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

type Fixture = ReturnType<typeof onlineFixture>;
type Peer = ReturnType<Fixture['connect']>;
interface OwnedPacket {
  departed: Uint8Array;
  packet: Uint8Array;
  retained: Uint8Array;
}
interface PublishedSnapshot extends OwnedPacket {
  recipient: string;
  car: number;
  snapshot: Snapshot;
}

/** Native buffer transfer at a synthetic adapter boundary. Delivery still uses
 * the real seeded in-memory transport and EventLoop, not a physical network. */
function takePacket(data: Uint8Array): OwnedPacket {
  expect(data.byteOffset).toBe(0);
  expect(data.buffer.byteLength).toBe(data.byteLength);
  const packet = structuredClone(data, { transfer: [data.buffer as ArrayBuffer] });
  return { departed: data, packet, retained: packet.slice() };
}

function observeSnapshots(peer: Peer, recipient: string, published: PublishedSnapshot[]) {
  const send = peer.link.server.send.bind(peer.link.server);
  peer.link.server.send = (data, channel) => {
    if (channel !== 'unreliable') return send(data, channel);
    const owned = takePacket(data);
    const decoded = decodeServerMessage(owned.packet, channel);
    if (!decoded.ok || decoded.value.type !== 'snapshot')
      throw new Error('Expected an actual server snapshot');
    published.push({
      ...owned,
      recipient,
      car: peer.client.car,
      snapshot: decoded.value.snapshot,
    });
    send(owned.packet, channel);
  };
  return () => {
    peer.link.server.send = send;
  };
}

function compactCars(snapshot: Snapshot) {
  return snapshot.cars.map((car) => ({
    ...car,
    flags: car.flags & ~CAR_FLAG.FULL,
    wx: 0,
    wy: 0,
    wz: 0,
    ax: 0,
    ay: 0,
    az: 0,
  }));
}

function expectOwnedPackets(packets: OwnedPacket[]) {
  expect(packets.length).toBeGreaterThan(0);
  expect(new Set(packets.map(({ packet }) => packet.buffer)).size).toBe(packets.length);
  for (const { departed, packet, retained } of packets) {
    expect(departed.byteLength).toBe(0);
    expect(departed.buffer.byteLength).toBe(0);
    expect(packet).toEqual(retained);
  }
}

/** Canceled heap slots remain pending; fn is the retained callback owner. */
function queued(loop: EventLoop) {
  return (loop as unknown as { heap: { time: number; fn: (() => void) | null }[] }).heap;
}
const liveCallbacks = (loop: EventLoop) => queued(loop).filter(({ fn }) => fn !== null);

describe('network runtime composition on the deterministic transport', () => {
  it('admits a reordered command remainder without reviving its expired shift', () => {
    const delivery: {
      held?: { command: InputCommand; data: Uint8Array };
      successor?: InputCommand;
      released: boolean;
      releaseTick: number;
      remainder?: Controls;
    } = { released: false, releaseTick: -1 };
    const published: PublishedSnapshot[] = [];
    const departedInputs: OwnedPacket[] = [];
    const f: Fixture = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      raceSeconds: 60,
      server: {
        maxTicks: 72,
        timeouts: { gridCountdownMs: 1 },
        onTick: (world) => {
          const held = delivery.held;
          if (!held) return;
          if (!delivery.released && world.tick === held.command.tick + 1) {
            delivery.released = true;
            delivery.releaseTick = world.tick;
            send(held.data, 'unreliable');
          }
          if (world.tick === held.command.tick + 2)
            delivery.remainder = { ...world.drivers[first.client.car].controls };
        },
      },
    });
    let sample = 0;
    const first = f.connect('Reordered command', {
      input: () => {
        const n = sample++;
        return {
          ...controls(),
          throttle: n === 0 ? 0.173 : n === 1 ? 0.281 : 0.389,
          manualClutch: true,
          clutch: 1,
          shift: n === 0 ? -1 : n === 1 ? 1 : 0,
        };
      },
    });
    const second = f.connect('Continuous command');
    first.link.client.conditions.duplicate = 1;
    const send = first.transport.send.bind(first.transport);
    first.transport.send = (data, channel) => {
      if (channel !== 'unreliable') return send(data, channel);
      const owned = takePacket(data);
      departedInputs.push(owned);
      const decoded = decodeClientMessage(owned.packet, channel);
      if (!decoded.ok || decoded.value.type !== 'input')
        throw new Error('Expected an actual client input packet');
      const packet = decoded.value.packet;
      const initial = packet.commands.find(({ seq }) => seq === 0);
      if (!delivery.held && initial)
        delivery.held = { command: initial, data: encodeInput({ ...packet, commands: [initial] }) };
      delivery.successor ??= packet.commands.find(({ seq }) => seq === 1);
      // Remove every redundant copy of seq 0 until its scripted delivery.
      // The remaining run retains the client's actual sequences and tick range.
      send(
        encodeInput({ ...packet, commands: packet.commands.filter(({ seq }) => seq !== 0) }),
        channel,
      );
    };
    const restores = [
      observeSnapshots(first, 'first', published),
      observeSnapshots(second, 'second', published),
    ];
    try {
      f.loop.runUntil(45);
      expect(first.client.state).toBe('race');
      expect(first.client.commands.started).toBe(false);
      // A legal larger lead leaves successors queued before the held edge
      // expires, exercising the expiry cursor's rewind through live traffic.
      first.client.lead = 40;
      f.loop.runUntil(700);

      const delayed = delivery.held!;
      expect(delayed.command.seq).toBe(0);
      expect(delayed.command.ticks).toBeGreaterThan(1);
      expect(delivery.successor?.tick).toBe(delayed.command.tick + delayed.command.ticks);
      expect(delivery.released).toBe(true);
      expect(delivery.releaseTick).toBe(delayed.command.tick + 1);
      expect(delivery.remainder).toEqual({ ...delayed.command.controls, shift: 0 });
      const world = f.server.world!;
      expect(
        world.journal.filter((entry) => entry.car === first.client.car && entry.kind === 'shift'),
      ).toEqual([
        { tick: delivery.successor!.tick, car: first.client.car, kind: 'shift', shift: 1 },
      ]);
      const stats = f.server.inputStats().find(({ car }) => car === first.client.car)!;
      expect(stats.lateTicks).toBe(1);
      expect(stats.late).toBe(0);
      expect(stats.duplicates).toBeGreaterThan(0);
      expect(stats.rejected).toBe(0);
      expect(
        published.some(({ recipient, snapshot }) => recipient === 'first' && snapshot.slack === -1),
      ).toBe(true);
      expect(first.client.commands.ackSeq).toBeGreaterThanOrEqual(1);
      expect(first.client.stats.inputBytes).toEqual(
        departedInputs.map(({ packet }) => packet.length),
      );
      expectOwnedPackets(departedInputs);
      expectOwnedPackets(published);
      for (const { car, snapshot } of published)
        expect(
          snapshot.cars.filter((state) => state.flags & CAR_FLAG.FULL).map((state) => state.id),
        ).toEqual([car]);
      expect(f.server.stats.invalidMessages).toBe(0);
      expect(f.server.stats.transportErrorCount).toBe(0);
      expect(first.client.stats.invalidMessages + second.client.stats.invalidMessages).toBe(0);
      expect(first.client.results).toEqual(f.server.results);
      expect(second.client.results).toEqual(f.server.results);
      expect(verifyRecord(f.server.record)).toMatchObject({ ok: true, ticks: 72 });
    } finally {
      first.transport.send = send;
      restores.forEach((restore) => restore());
      first.client.dispose();
      second.client.dispose();
      f.server.teardown();
      f.loop.runUntil(f.loop.now);
    }
  });

  it('keeps transferred snapshots and input ownership across 12, 11 and 12 recipients', () => {
    const f = onlineFixture({
      capacity: 12,
      link: PERFECT_LINK,
      raceSeconds: 60,
      server: {
        disconnectPolicy: 'ghost',
        timeouts: { gridCountdownMs: 1, joinMs: 120000 },
      },
    });
    const published: PublishedSnapshot[] = [];
    const peers = Array.from({ length: 12 }, (_, i) => f.connect('Driver ' + i));
    const restores = peers.map((peer, i) => observeSnapshots(peer, String(i), published));
    let replacement: Peer | undefined;
    try {
      f.loop.runUntil(100);
      expect(peers.every(({ client }) => client.state === 'race')).toBe(true);
      const old = peers[11];
      const oldReceive = old.link.server.onMessage!;
      const oldClose = old.link.server.onClose!;
      const oldCommand = old.client.commands.at(old.client.commands.nextTick - 1)!;
      expect(oldCommand.tick + oldCommand.ticks).toBeGreaterThan(f.server.world!.tick);
      const staleInput = encodeInput({
        sentAt: 0xf0000000,
        ackTick: old.client.lastSnapshotTick,
        commands: [oldCommand],
      });
      // A lost process may rejoin; a voluntary leave forfeits its token.
      old.client.dispose();
      old.transport.close('connection lost');
      f.loop.runUntil(100);
      expect(old.link.server.onMessage).toBeNull();
      expect(old.link.server.onClose).toBeNull();
      expect(f.server.playerByCar(11)).toMatchObject({ connected: false, mode: 'ai' });
      f.loop.runUntil(160);

      replacement = f.connect('Returning driver', { token: old.client.token });
      restores.push(observeSnapshots(replacement, 'replacement', published));
      const joinDeadline = liveCallbacks(f.loop).find(
        ({ time }) => time === f.loop.now + f.server.timeouts.joinMs,
      )!;
      const staleDeadline = joinDeadline.fn!;
      f.loop.runUntil(160);
      expect(joinDeadline.fn).toBeNull();
      expect(replacement.client.car).toBe(11);
      expect(replacement.client.player).toBe(old.client.player);
      expect(f.server.playerByCar(11)).toMatchObject({ connected: true, mode: 'ai' });

      // These are callbacks saved from the actual retired connection, not
      // callbacks fabricated by a test transport. They must not touch its heir.
      oldReceive(staleInput, 'unreliable');
      oldReceive(encodeControl({ kind: 'leave' }), 'reliable');
      oldClose('late notification from retired peer');
      staleDeadline();
      f.loop.runUntil(350);

      expect(f.server.playerByCar(11)).toMatchObject({ connected: true, mode: 'human' });
      expect(f.server.stats.rejoins).toHaveLength(1);
      expect(f.server.stats.takeovers).toHaveLength(1);
      expect(f.server.stats.invalidMessages).toBe(0);
      expect(f.server.stats.transportErrorCount).toBe(0);
      expect(f.server.stats.kicks).toEqual([]);
      const returning = published.filter(({ recipient }) => recipient === 'replacement');
      expect(returning[0].snapshot).toMatchObject({ ackSeq: -1, echo: 0, slack: 127 });
      expect(replacement.client.commands.ackSeq).toBeGreaterThanOrEqual(0);
      expect(replacement.client.commands.ackSeq).toBeLessThan(replacement.client.commands.nextSeq);

      // The production server selects shared preparation at 12 recipients
      // and ordinary encoding at 11, while the field still contains 12 cars.
      for (const [tick, recipients] of [[6, 12], [18, 11], [24, 12]]) {
        const boundary = published.filter(({ snapshot }) => snapshot.tick === tick);
        expect(boundary).toHaveLength(recipients);
        for (const { car, snapshot } of boundary) {
          expect(snapshot.cars).toHaveLength(12);
          expect(
            snapshot.cars.filter((state) => state.flags & CAR_FLAG.FULL).map((state) => state.id),
          ).toEqual([car]);
          expect(compactCars(snapshot)).toEqual(compactCars(boundary[0].snapshot));
          expect(snapshot.cars[11].flags & CAR_FLAG.GHOST).toBe(tick === 18 ? CAR_FLAG.GHOST : 0);
        }
      }
      for (const [index, peer] of [...peers.slice(0, 11), replacement].entries()) {
        const key = index === 11 ? 'replacement' : String(index);
        expect(peer.client.stats.invalidMessages).toBe(0);
        expect(peer.client.latest).toEqual(
          published.filter(({ recipient }) => recipient === key).at(-1)!.snapshot,
        );
      }
      expectOwnedPackets(published);
    } finally {
      restores.forEach((restore) => restore());
      peers.forEach(({ client }) => client.dispose());
      replacement?.client.dispose();
      f.server.teardown();
      f.loop.runUntil(f.loop.now);
    }
  });

  it('releases completed-race and silent-join work before teardown observers', () => {
    let observeRelease = () => {};
    const f = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      raceSeconds: 60,
      server: {
        maxTicks: 60,
        timeouts: { gridCountdownMs: 1, joinMs: 120000, resultsLingerMs: 60000 },
        onPhase: (phase) => {
          if (phase === 'teardown') observeRelease();
        },
      },
    });
    const peers = [f.connect('First result'), f.connect('Second result')];
    try {
      f.loop.runUntil(600);
      expect(f.server.phase).toBe('results');
      const results = f.server.results!;
      const record = f.server.record!;
      const hash = f.server.world!.stateHash();
      for (const { client } of peers) {
        expect(client.results).toEqual(results);
        expect(client.stats.inputPackets).toBeGreaterThan(0);
        expect(client.stats.snapshots).toBeGreaterThan(0);
      }
      const silent = f.net.connect(PERFECT_LINK);
      const closeReasons: string[] = [];
      silent.client.onClose = (reason) => closeReasons.push(reason);
      f.server.accept(silent.server);
      const endpoints = [...peers.map(({ link }) => link.server), silent.server];
      const savedReceive = endpoints.map((endpoint) => endpoint.onMessage!);
      const savedClose = endpoints.map((endpoint) => endpoint.onClose!);
      const live = liveCallbacks(f.loop);
      expect(live).toHaveLength(3); // Sweep, result linger, silent join.
      const savedDeadlines = live.map(({ fn }) => fn!);
      const future = queued(f.loop).filter(({ time }) => time > f.loop.now + 5000);
      expect(future.length).toBeGreaterThanOrEqual(4); // Includes canceled successful joins.
      let observerCalls = 0;
      observeRelease = () => {
        observerCalls++;
        expect(liveCallbacks(f.loop)).toHaveLength(0);
        for (const endpoint of endpoints) {
          expect(endpoint.onMessage).toBeNull();
          expect(endpoint.onClose).toBeNull();
        }
      };

      f.server.teardown();

      expect(observerCalls).toBe(1);
      expect(live.every(({ fn }) => fn === null)).toBe(true);
      expect(future.every(({ fn }) => fn === null)).toBe(true);
      expect(f.loop.now).toBe(600);
      // Only same-instant transport close delivery is drained. The canceled
      // 60 s and 120 s heap slots remain, with no retained callback.
      f.loop.runUntil(f.loop.now);
      expect(closeReasons).toEqual(['session over']);
      expect(liveCallbacks(f.loop)).toHaveLength(0);
      expect(f.loop.pending).toBeGreaterThan(0);
      for (const { client, transport } of peers) {
        expect(client.state).toBe('results');
        expect(client.results).toEqual(results);
        expect(transport.onMessage).toBeNull();
        expect(transport.onClose).toBeNull();
        expect(transport.open).toBe(false);
      }
      const sent = f.server.stats.snapshotsSent;
      const invalid = f.server.stats.invalidMessages;
      savedDeadlines.forEach((callback) => callback());
      savedReceive.forEach((receive) => receive(encodeControl({ kind: 'ping', t: 1 }), 'reliable'));
      savedClose.forEach((closed) => closed('stale close after results'));
      expect(f.server.phase).toBe('teardown');
      expect(f.server.results).toBe(results);
      expect(f.server.record).toBe(record);
      expect(f.server.world!.tick).toBe(60);
      expect(f.server.world!.stateHash()).toBe(hash);
      expect(f.server.stats.snapshotsSent).toBe(sent);
      expect(f.server.stats.invalidMessages).toBe(invalid);
      expect(liveCallbacks(f.loop)).toHaveLength(0);
    } finally {
      peers.forEach(({ client }) => client.dispose());
      f.server.teardown();
      f.loop.runUntil(f.loop.now);
    }
  });
});
