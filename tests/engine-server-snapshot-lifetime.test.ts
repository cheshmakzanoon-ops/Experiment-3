import { describe, expect, it, vi } from 'vitest';
import { AuthoritativeWorld } from '../src/net/authority.ts';
import { decodeServerMessage, encodeControl, encodeSnapshot } from '../src/net/codec.ts';
import { NET_PROTOCOL_VERSION } from '../src/net/constants.ts';
import type { ServerInputQueue } from '../src/net/input.ts';
import type { RaceEvent, ServerControl } from '../src/net/messages.ts';
import type { RaceServer } from '../src/net/server.ts';
import { CAR_FLAG, emptyCarState, type CarNetState, type Snapshot } from '../src/net/snapshot.ts';
import { PERFECT_LINK, type Channel, type Transport } from '../src/net/transport.ts';
import { controls } from '../src/simulation/config.ts';
import { PHASE } from '../src/simulation/race.ts';
import { onlineFixture } from './net-helpers.ts';

interface ConnectionView {
  id: number;
  player: PlayerView | null;
  closed: boolean;
  transport: Transport;
  echo: number;
  echoAt: number;
}
interface PlayerView {
  id: string;
  car: number | null;
  connection: ConnectionView | null;
  disconnectedAt: number | null;
  ghost: boolean;
  queue: ServerInputQueue;
  missingWindow: number;
}
interface ServerView {
  players: Map<string, PlayerView>;
  connections: Set<ConnectionView>;
  byCar: (PlayerView | null)[];
  scratch: CarNetState[];
  pendingEvents: RaceEvent[];
  snapshot(): void;
  tick(): void;
  emit(event: RaceEvent): void;
  eventMessages(events: readonly RaceEvent[]): ServerControl[];
  send(conn: ConnectionView, message: ServerControl): void;
}
const inside = (server: RaceServer) => server as unknown as ServerView;
interface Packet {
  data: Uint8Array;
  channel: Channel;
}
function recordingTransport(label: string) {
  const packets: Packet[] = [];
  const transport: Transport = {
    label,
    open: true,
    onMessage: null,
    onClose: null,
    send: (data, channel) => packets.push({ data, channel }),
    close: () => {},
  };
  return { transport, packets };
}

/** Real capture/codec/queue methods over a deterministic twelve-car boundary.
 * No physics world needs to be constructed for a packet-equivalence check. */
function snapshotFixture(recipients: number) {
  const f = onlineFixture({ capacity: Math.max(1, recipients), server: { autoStart: false } });
  const state = inside(f.server);
  const peers = Array.from({ length: recipients }, (_, car) => {
    const peer = recordingTransport(`peer-${car}`);
    f.server.accept(peer.transport);
    peer.transport.onMessage!(
      encodeControl({
        kind: 'join',
        net: NET_PROTOCOL_VERSION,
        name: `Driver ${car}`,
        vehicle: 'apx01',
        identity: f.server.expectedIdentity('apx01'),
      }),
      'reliable',
    );
    return peer;
  });
  const count = 12;
  const contact = Uint8Array.from({ length: count }, (_, car) => Number(car % 2 === 0));
  const sim = {
    tick: 120,
    cars: Array.from({ length: count }, (_, car) => ({
      body: {
        position: { x: car * 1.25 - 90, y: car * 0.17, z: 250 - car * 2.125 },
        orientation: { x: 0, y: Math.sin(car / 8), z: 0, w: Math.cos(car / 8) },
        velocity: { x: -2.123 * car, y: 0.125 * car, z: 16.789 * car },
        omega: { x: 0.133 * car, y: -0.234 * car, z: 0.999 * car },
      },
      inPit: car % 5 === 1,
      retired: car % 7 === 2,
      finishTime: car % 5 === 3 ? 90 : 0,
      pitRequested: car % 6 === 4,
      drsOpen: car % 2 === 1,
      steer: car / 7 - 0.8,
      throttle: car / 9,
      brake: car / 11,
      gear: car - 2,
      rpm: 1234 + car * 1500,
      s: 123.456 + car * 77,
    })),
    race: {
      phase: PHASE.RACING,
      time: 11.125,
      order: Array.from({ length: count }, (_, car) => count - car - 1),
      laps: Array.from({ length: count }, (_, car) => ({ completed: car })),
    },
  };
  const world = Object.assign(Object.create(AuthoritativeWorld.prototype), {
    sim,
    drivers: Array.from({ length: count }, (_, car) => ({ mode: car % 3 ? 'human' : 'ai' })),
    history: Float64Array.from({ length: count * 12 }, (_, index) => index * 0.02345),
    contact,
    journal: [],
  }) as AuthoritativeWorld;
  f.server.world = world;
  f.server.phase = 'race';
  f.loop.now = 1000;
  state.scratch = Array.from({ length: count }, (_, car) => emptyCarState(car));
  const players = [...state.players.values()];
  players.forEach((player, car) => {
    player.car = car;
    player.ghost = car % 4 === 1;
    player.missingWindow = car * 25;
    player.connection!.echo = 0xffffffff - car * 19;
    player.connection!.echoAt = 999.5 - car * 33;
    state.byCar[car] = player;
    if (car)
      player.queue.accept(
        Array.from({ length: car + 1 }, (_, seq) => ({
          seq,
          tick: sim.tick + car - 3 + seq,
          ticks: 1,
          controls: controls(),
        })),
        sim.tick,
      );
  });
  const event: RaceEvent = { type: 'lap', car: 0, lap: 1, time: 80, valid: true, tick: 120 };
  state.emit(event);
  for (const peer of peers) peer.packets.length = 0;
  return { ...f, state, peers, players, sim, world, contact, event };
}

/** The pre-change server snapshot method, retained as an independent oracle. */
function originalSnapshot(server: RaceServer) {
  const s = inside(server);
  const world = server.world!;
  const now = server.loop.now;
  const race = world.sim.race;
  for (const player of s.players.values()) {
    const conn = player.connection;
    if (!conn || conn.closed || player.car === null) continue;
    const cars = s.scratch.map((state, car) =>
      world.capture(car, car === player.car, state, s.byCar[car]?.ghost === true),
    );
    const slack = player.queue.takeSlack();
    conn.transport.send(
      encodeSnapshot({
        tick: world.tick,
        phase: race.phase,
        raceTime: race.time,
        ackSeq: player.queue.contiguousSeq,
        slack: slack === Infinity ? 127 : slack,
        missing: player.missingWindow,
        echo: conn.echo,
        hold: now - conn.echoAt,
        cars,
      }),
      'unreliable',
    );
    player.missingWindow = 0;
    server.stats.snapshotsSent++;
  }
  world.clearContacts();
  if (s.pendingEvents.length) {
    const messages = s.eventMessages(s.pendingEvents);
    s.pendingEvents = [];
    for (const player of s.players.values())
      if (player.connection && player.car !== null)
        for (const message of messages) s.send(player.connection, message);
  }
}
function snapshots(packets: readonly Packet[]): Snapshot[] {
  return packets.flatMap(({ data, channel }) => {
    const decoded = decodeServerMessage(data, channel);
    if (!decoded.ok) throw new Error(decoded.reason);
    return decoded.value.type === 'snapshot' ? [decoded.value.snapshot] : [];
  });
}
function events(packets: readonly Packet[]): RaceEvent[] {
  return packets.flatMap(({ data, channel }) => {
    const decoded = decodeServerMessage(data, channel);
    if (!decoded.ok) throw new Error(decoded.reason);
    return decoded.value.type === 'control' && decoded.value.control.kind === 'events'
      ? decoded.value.control.events
      : [];
  });
}

describe('server snapshot boundary ownership', () => {
  it.each([0, 1, 4, 12])(
    'preserves every packet byte for %i recipients with one field capture',
    (n) => {
      const actual = snapshotFixture(n);
      const reference = snapshotFixture(n);
      const capture = vi.spyOn(actual.world, 'capture');
      const referenceCapture = vi.spyOn(reference.world, 'capture');
      const ranks = vi.spyOn(actual.sim.race.order, 'indexOf');
      const referenceRanks = vi.spyOn(reference.sim.race.order, 'indexOf');
      try {
        originalSnapshot(reference.server);
        actual.state.snapshot();
        expect(referenceCapture).toHaveBeenCalledTimes(n * 12);
        expect(referenceRanks).toHaveBeenCalledTimes(n * 12);
        expect(capture).toHaveBeenCalledTimes(n ? 12 : 0);
        expect(ranks).toHaveBeenCalledTimes(n ? 12 : 0);
        for (let car = 0; car < n; car++) {
          expect(actual.peers[car].packets).toEqual(reference.peers[car].packets);
          const packet = snapshots(actual.peers[car].packets)[0];
          expect(
            packet.cars.filter((state) => state.flags & CAR_FLAG.FULL).map((state) => state.id),
          ).toEqual([car]);
          expect(actual.players[car].missingWindow).toBe(0);
          expect(actual.players[car].queue.takeSlack()).toBe(Infinity);
        }
        expect(new Set(actual.peers.map((peer) => peer.packets[0].data.buffer)).size).toBe(n);
        expect(actual.contact.some(Boolean)).toBe(false);
        expect(actual.state.pendingEvents).toEqual([]);
        expect(actual.server.stats.snapshotsSent).toBe(n);
        // Reusing capture storage must neither repeat contacts nor retain a
        // recipient's FULL bit in another driver's next packet.
        originalSnapshot(reference.server);
        actual.state.snapshot();
        for (let car = 0; car < n; car++)
          expect(actual.peers[car].packets).toEqual(reference.peers[car].packets);
      } finally {
        vi.restoreAllMocks();
        actual.server.teardown();
        reference.server.teardown();
      }
    },
  );

  it('isolates retained packets and bounds recursive sends while preserving later contacts and events', () => {
    const f = snapshotFixture(2);
    const reference = snapshotFixture(2);
    originalSnapshot(reference.server);
    const peer = f.peers[0];
    const send = peer.transport.send;
    const second: RaceEvent = { type: 'finish', car: 1, tick: 126 };
    const deferred: RaceEvent = { type: 'finish', car: 2, tick: 126 };
    let calls = 0;
    peer.transport.send = (data, channel) => {
      send(data, channel);
      if (channel !== 'unreliable') return;
      calls++;
      if (calls === 1) {
        f.sim.tick = 126;
        f.sim.race.time += 0.05;
        f.sim.cars[1].body.position.x += 100;
        f.players[1].connection!.echo = 72;
        f.players[1].queue.accept([{ seq: 2, tick: 129, ticks: 1, controls: controls() }], 126);
        f.contact[1] = 1;
        f.state.emit(second);
        // A transport owns this buffer; corrupting it cannot corrupt another
        // recipient or a queued snapshot which reuses the capture scratch.
        data.fill(0);
      } else {
        f.contact[2] = 1;
        f.players[1].missingWindow = 7;
        f.state.emit(deferred);
      }
      f.state.snapshot();
    };
    try {
      f.state.snapshot();
      expect(calls).toBe(2); // At most one follow-up, even if every send reenters.
      expect(f.peers[1].packets[0]).toEqual(reference.peers[1].packets[0]);
      const received = snapshots(f.peers[1].packets);
      expect(received.map((packet) => packet.tick)).toEqual([120, 126]);
      expect(received[0].echo).toBe(0xffffffff - 19);
      expect(received[1]).toMatchObject({ ackSeq: 2, slack: 3, echo: 72 });
      expect(received[1].cars[1].x - received[0].cars[1].x).toBe(100);
      expect(received[1].cars[1].flags & CAR_FLAG.CONTACT).not.toBe(0);
      expect(events(f.peers[1].packets)).toEqual([f.event, second]);
      expect(f.state.pendingEvents).toEqual([deferred]);
      expect(f.contact[2]).toBe(1);
      expect(f.players[1].missingWindow).toBe(7);
      peer.transport.send = send;
      f.state.snapshot();
      const next = snapshots(f.peers[1].packets).at(-1)!;
      expect(next.missing).toBe(7);
      expect(next.cars[2].flags & CAR_FLAG.CONTACT).not.toBe(0);
      expect(events(f.peers[1].packets)).toEqual([f.event, second, deferred]);
    } finally {
      peer.transport.send = send;
      f.server.teardown();
      reference.server.teardown();
    }
  });

  it('propagates capture and physics faults instead of treating them as peer failures', () => {
    const f = snapshotFixture(1);
    const captureError = new Error('capture fault');
    const physicsError = new Error('physics fault');
    const capture = vi.spyOn(f.world, 'capture').mockImplementation(() => {
      throw captureError;
    });
    try {
      expect(() => f.state.snapshot()).toThrow(captureError);
      capture.mockRestore();
      vi.spyOn(f.world, 'step').mockImplementation(() => {
        throw physicsError;
      });
      expect(() => f.state.tick()).toThrow(physicsError);
      expect(f.server.stats.transportErrorCount).toBe(0);
      expect(f.server.playerByCar(0)?.connected).toBe(true);
    } finally {
      vi.restoreAllMocks();
      f.server.teardown();
    }
  });
});

describe('active peer failure isolation', () => {
  it.each(['timeout close', 'snapshot send', 'event send'] as const)(
    'keeps a healthy client and future ticks running after a failing %s',
    (failure) => {
      const f = onlineFixture({
        capacity: 2,
        link: PERFECT_LINK,
        raceSeconds: 60,
        server: {
          disconnectPolicy: 'ghost',
          timeouts: { gridCountdownMs: 1, disconnectMs: 150 },
        },
      });
      const bad = f.connect('Faulty');
      const good = f.connect('Healthy');
      f.loop.runUntil(100);
      const state = inside(f.server);
      const player = state.players.get(bad.client.player)!;
      const connection = player.connection!;
      const receive = bad.link.server.onMessage!;
      const closeError = new Error('close failed');
      const observations: unknown[] = [];
      const close = vi.spyOn(bad.link.server, 'close').mockImplementation(() => {
        observations.push({
          connection: player.connection,
          player: connection.player,
          retained: state.connections.has(connection),
          closed: connection.closed,
          disconnected: player.disconnectedAt !== null,
          mode: f.server.world!.drivers[bad.client.car].mode,
        });
        receive(encodeControl({ kind: 'ping', t: 999 }), 'reliable');
        bad.link.server.onClose?.('stale callback');
        throw closeError;
      });
      const normalSend = bad.link.server.send.bind(bad.link.server);
      const send = vi.spyOn(bad.link.server, 'send').mockImplementation((data, channel) => {
        const message = decodeServerMessage(data, channel);
        if (
          (failure === 'snapshot send' && channel === 'unreliable') ||
          (failure === 'event send' &&
            message.ok &&
            message.value.type === 'control' &&
            message.value.control.kind === 'events')
        )
          throw undefined;
        normalSend(data, channel);
      });
      if (failure === 'timeout close') {
        bad.client.dispose();
        bad.link.sever();
      } else if (failure === 'event send') {
        state.emit({
          type: 'driver',
          car: good.client.car,
          mode: 'human',
          reason: 'test',
          tick: f.server.world!.tick,
        });
      }
      const previous = good.client.stats.snapshots;
      try {
        expect(() => f.loop.runUntil(450)).not.toThrow();
        expect(observations).toEqual([
          {
            connection: null,
            player: null,
            retained: false,
            closed: true,
            disconnected: true,
            mode: 'ai',
          },
        ]);
        expect(f.server.stats.takeovers).toHaveLength(1);
        expect(f.server.playerByCar(bad.client.car)).toMatchObject({
          connected: false,
          mode: 'ai',
        });
        expect(good.client.stats.snapshots).toBeGreaterThan(previous);
        expect(
          good.client.events.some(
            (event) =>
              event.type === 'driver' && event.car === bad.client.car && event.mode === 'ai',
          ),
        ).toBe(true);
        expect(good.client.carState(bad.client.car)!.flags & (CAR_FLAG.AI | CAR_FLAG.GHOST)).toBe(
          CAR_FLAG.AI | CAR_FLAG.GHOST,
        );
        expect(f.server.stats.transportErrors.map((error) => error.operation)).toEqual(
          failure === 'timeout close' ? ['close'] : ['send', 'close'],
        );
        expect(f.server.stats.transportErrors.at(-1)!.error).toBe(closeError);
        if (failure !== 'timeout close')
          expect(f.server.stats.transportErrors[0].error).toBeUndefined();
        const tick = f.server.world!.tick;
        const snapshotsBefore = good.client.stats.snapshots;
        f.loop.runUntil(700);
        expect(f.server.world!.tick).toBeGreaterThan(tick);
        expect(good.client.stats.snapshots).toBeGreaterThan(snapshotsBefore);
        expect(f.server.playerByCar(good.client.car)).toMatchObject({
          connected: true,
          mode: 'human',
        });
        expect(f.server.stats.takeovers).toHaveLength(1);
      } finally {
        send.mockRestore();
        close.mockRestore();
        bad.client.dispose();
        good.client.dispose();
        f.server.teardown();
        bad.link.server.close('fixture cleanup');
      }
    },
  );

  it('bounds original transport-error retention while counting every failed operation', () => {
    const f = onlineFixture({ server: { autoStart: false } });
    const failures = Array.from({ length: 80 }, (_, index) => new Error(`failure ${index}`));
    try {
      for (let i = 0; i < 40; i++) {
        const { transport } = recordingTransport(`failing-${i}`);
        transport.send = () => {
          throw failures[i * 2];
        };
        transport.close = () => {
          throw failures[i * 2 + 1];
        };
        f.server.accept(transport);
        transport.onMessage!(encodeControl({ kind: 'ping', t: i }), 'reliable');
      }
      expect(f.server.stats.transportErrorCount).toBe(80);
      expect(f.server.stats.transportErrors.map((entry) => entry.error)).toEqual(
        failures.slice(16),
      );
      expect(inside(f.server).connections.size).toBe(0);
    } finally {
      f.server.teardown();
    }
  });
});
