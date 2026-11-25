import { describe, expect, it, vi } from 'vitest';
import { AuthoritativeWorld } from '../src/net/authority.ts';
import { ByteWriter } from '../src/net/bytes.ts';
import * as codec from '../src/net/codec.ts';
import { LIMITS, NET_PROTOCOL_VERSION } from '../src/net/constants.ts';
import { ServerInputQueue } from '../src/net/input.ts';
import type { RaceEvent, ServerControl } from '../src/net/messages.ts';
import type { RaceServer } from '../src/net/server.ts';
import * as wire from '../src/net/snapshot.ts';
import { CAR_FLAG, emptyCarState, type CarNetState, type Snapshot } from '../src/net/snapshot.ts';
import type { Channel, Transport } from '../src/net/transport.ts';
import { controls } from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

interface ConnectionView {
  transport: Transport;
  closed: boolean;
  echo: number;
  echoAt: number;
}
interface PlayerView {
  car: number | null;
  connection: ConnectionView | null;
  queue: ServerInputQueue;
  ghost: boolean;
  missingWindow: number;
}
interface ServerView {
  players: Map<string, PlayerView>;
  byCar: (PlayerView | null)[];
  scratch: CarNetState[];
  pendingEvents: RaceEvent[];
  snapshotBatches: unknown[];
  snapshot(): void;
  emit(event: RaceEvent): void;
  eventMessages(events: readonly RaceEvent[]): ServerControl[];
}
interface Packet {
  data: Uint8Array;
  channel: Channel;
}
const inside = (server: RaceServer) => server as unknown as ServerView;

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

/** Real server, capture, queues and codec; deterministic authoritative scalar
 * state avoids spending physics ticks reaching quantization/header boundaries. */
function fixture(recipients: number) {
  const f = onlineFixture({
    capacity: Math.max(1, recipients),
    server: { autoStart: false, disconnectPolicy: 'ghost' },
  });
  const state = inside(f.server);
  const peers = Array.from({ length: recipients }, (_, i) => {
    const peer = recordingTransport(`batch-${i}`);
    f.server.accept(peer.transport);
    peer.transport.onMessage!(
      codec.encodeControl({
        kind: 'join',
        net: NET_PROTOCOL_VERSION,
        name: `Driver ${i}`,
        vehicle: 'apx01',
        identity: f.server.expectedIdentity('apx01'),
      }),
      'reliable',
    );
    return peer;
  });
  const count = 12;
  const sim = {
    tick: 1200,
    cars: Array.from({ length: count }, () => ({
      body: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 0, y: 0, z: 0 },
        omega: { x: 0, y: 0, z: 0 },
      },
      inPit: false,
      retired: false,
      finishTime: 0,
      pitRequested: false,
      drsOpen: false,
      steer: 0,
      throttle: 0,
      brake: 0,
      gear: 0,
      rpm: 0,
      s: 0,
    })),
    race: {
      phase: 2,
      time: 11.125,
      order: Array.from({ length: count }, (_, car) => car),
      laps: Array.from({ length: count }, () => ({ completed: 0 })),
    },
  };
  const contact = new Uint8Array(count);
  const history = new Float64Array(count * 12);
  const world = Object.assign(Object.create(AuthoritativeWorld.prototype), {
    sim,
    contact,
    history,
    drivers: Array.from({ length: count }, () => ({ mode: 'human' })),
    journal: [],
  }) as AuthoritativeWorld;
  f.server.world = world;
  f.server.phase = 'race';
  state.scratch = Array.from({ length: count }, (_, car) => emptyCarState(car));
  const players = [...state.players.values()];
  players.forEach((player, car) => {
    player.car = car;
    state.byCar[car] = player;
  });
  for (const peer of peers) peer.packets.length = 0;
  return { ...f, state, peers, players, sim, world, contact, history };
}
type Fixture = ReturnType<typeof fixture>;

function vary(f: Fixture, boundary: number) {
  const { sim, state, players } = f;
  sim.tick = 1200 + boundary * 6;
  sim.race.phase = boundary % 4;
  sim.race.time = [-0, 11.125, 0.1, 12345.678][boundary % 4];
  sim.race.order = Array.from({ length: 12 }, (_, i) => (i * 5 + boundary) % 12);
  if (boundary % 3 === 1) sim.race.order.splice(4, 3, sim.race.order[0]);
  f.loop.now = 1000 + boundary * 50;
  state.byCar.fill(null);
  for (let i = 0; i < sim.cars.length; i++) {
    const car = sim.cars[i],
      k = i + boundary,
      sign = k % 2 ? -1 : 1;
    Object.assign(car.body.position, { x: sign * (k * 17.123 + 0.005), y: -k / 7, z: k * 1e5 });
    Object.assign(car.body.orientation, {
      x: Math.sin(k / 5) * 1.01,
      y: Math.cos(k / 5),
      z: Math.sin(k / 3),
      w: 1,
    });
    Object.assign(car.body.velocity, { x: sign * k * 120, y: sign * 0.005, z: -sign * 327.665 });
    Object.assign(car.body.omega, { x: sign * k * 10, y: sign * 0.0005, z: -sign * 32.7665 });
    Object.assign(car, {
      inPit: k % 5 === 1,
      retired: k % 7 === 2,
      finishTime: k % 5 === 3 ? 90 : 0,
      pitRequested: k % 6 === 4,
      drsOpen: k % 2 === 1,
      steer: k / 7 - 1.5,
      throttle: (k % 7) / 3 - 0.5,
      brake: (k % 9) / 5,
      gear: [-3, -1, 0, 1.49, 1.5, 9, 12][k % 7],
      rpm: (k - 3) * 2000 + 32,
      s: sign * (123.456 + k * 77),
    });
    sim.race.laps[i].completed = [-1, 0, 1, 17.9, 255, 300][k % 6];
    f.contact[i] = Number(k % 3 === 0);
    f.world.drivers[i].mode = k % 3 ? 'human' : 'ai';
  }
  f.history.forEach((_, i) => {
    f.history[i] = Math.sin(i + boundary) * 10000;
  });
  players.forEach((player, i) => {
    const k = i + boundary;
    // Every peer owns every possible car across these twelve boundaries.
    player.car = (i * 5 + boundary) % 12;
    player.ghost = k % 4 === 1;
    state.byCar[player.car] = player;
    player.queue = new ServerInputQueue();
    const margin = [Infinity, -200, -128, -1, 0, 1, 127, 128, 239][k % 9];
    if (margin !== Infinity)
      player.queue.accept(
        [{ seq: 0, tick: sim.tick + margin, ticks: 1, controls: controls() }],
        sim.tick,
      );
    if (k % 4 === 3) player.queue.contiguousSeq = 0xfffffffe;
    player.missingWindow = [0, 256, 300, -2, 17.49, 17.5][k % 6];
    player.connection!.echo = [0, -1, 0xffffffff, 0x100000001, 0xfffffffd, 129.9][k % 6];
    player.connection!.echoAt = f.loop.now - [-10, 0.49, 0.5, 1.5, 65534.6, 90000][k % 6];
  });
  state.emit({
    type: 'lap',
    car: boundary % 12,
    lap: boundary + 1,
    time: 80,
    valid: true,
    tick: sim.tick,
  });
}

/** Independent ordinary writer, with one capture per recipient as before the
 * shared-capture optimization. Reference peers only record; no reentrant I/O. */
function referenceBoundary(f: Fixture) {
  for (const player of f.players) {
    const conn = player.connection;
    if (!conn || conn.closed || player.car === null) continue;
    const cars = f.sim.cars.map((_, car) =>
      f.world.capture(
        car,
        car === player.car,
        emptyCarState(car),
        f.state.byCar[car]?.ghost === true,
      ),
    );
    const slack = player.queue.takeSlack();
    conn.transport.send(
      codec.encodeSnapshot({
        tick: f.world.tick,
        phase: f.sim.race.phase,
        raceTime: f.sim.race.time,
        ackSeq: player.queue.contiguousSeq,
        slack: slack === Infinity ? 127 : slack,
        missing: player.missingWindow,
        echo: conn.echo,
        hold: f.loop.now - conn.echoAt,
        cars,
      }),
      'unreliable',
    );
    player.missingWindow = 0;
  }
  f.world.clearContacts();
  const messages = f.state.eventMessages(f.state.pendingEvents);
  f.state.pendingEvents = [];
  for (const player of f.players)
    if (player.connection && player.car !== null)
      for (const message of messages)
        player.connection.transport.send(codec.encodeControl(message), 'reliable');
}

function snapshots(packets: readonly Packet[]): Snapshot[] {
  return packets.flatMap(({ data, channel }) => {
    const decoded = codec.decodeServerMessage(data, channel);
    if (!decoded.ok) throw new Error(decoded.reason);
    return decoded.value.type === 'snapshot' ? [decoded.value.snapshot] : [];
  });
}

describe('shared snapshot car serialization', () => {
  it.each([0, 1, 2, 4, 11, 12])(
    'matches complete reference packets for %i recipients over varied boundaries',
    (n) => {
      const actual = fixture(n),
        reference = fixture(n);
      try {
        for (let boundary = 0; boundary < 12; boundary++) {
          vary(actual, boundary);
          vary(reference, boundary);
          referenceBoundary(reference);
          actual.state.snapshot();
          for (let i = 0; i < n; i++) {
            expect(actual.peers[i].packets).toEqual(reference.peers[i].packets);
            const decoded = snapshots(actual.peers[i].packets).at(-1)!;
            expect(decoded.cars.map((car) => car.id)).toEqual(
              Array.from({ length: 12 }, (_, car) => car),
            );
            expect(
              decoded.cars.filter((car) => car.flags & CAR_FLAG.FULL).map((car) => car.id),
            ).toEqual([actual.players[i].car]);
            expect(actual.players[i].missingWindow).toBe(0);
            expect(actual.players[i].queue.takeSlack()).toBe(Infinity);
          }
          expect(actual.contact.some(Boolean)).toBe(false);
          expect(actual.state.pendingEvents).toEqual([]);
          expect(actual.state.scratch.every((car) => !(car.flags & CAR_FLAG.FULL))).toBe(true);
        }
        const packets = actual.peers.flatMap((peer) => peer.packets);
        expect(new Set(packets.map((packet) => packet.data.buffer)).size).toBe(packets.length);
        expect(actual.server.stats.snapshotsSent).toBe(n * 12);
        // A quiet next boundary has no retained contacts/events/slack/missing.
        referenceBoundary(reference);
        actual.state.snapshot();
        for (let i = 0; i < n; i++)
          expect(actual.peers[i].packets).toEqual(reference.peers[i].packets);
        expect(actual.state.snapshotBatches).toEqual([]);
      } finally {
        actual.server.teardown();
        reference.server.teardown();
      }
    },
  );

  it.each([0, 1, 2, 4, 11, 12])(
    'does bounded scalar work and owns every buffer for %i recipients',
    (n) => {
      const f = fixture(n),
        prepared = n >= 12;
      vary(f, 0);
      const carWrites = vi.spyOn(wire, 'writeCar');
      const floatWrites = vi.spyOn(ByteWriter.prototype, 'f32');
      const quantizedWrites = vi.spyOn(ByteWriter.prototype, 'i16');
      const prepare = vi.spyOn(codec, 'prepareSnapshotCars');
      // Observe actual writer backing/output buffers separately from timing.
      const backing = new Set<ArrayBufferLike>();
      const outputs = new Set<ArrayBufferLike>();
      const prototype = ByteWriter.prototype as unknown as { reserve(n: number): void };
      const reserve = prototype.reserve;
      vi.spyOn(prototype, 'reserve').mockImplementation(function (this: ByteWriter, n: number) {
        const writer = this as unknown as { buffer: Uint8Array };
        backing.add(writer.buffer.buffer);
        reserve.call(this, n);
        backing.add(writer.buffer.buffer);
      });
      const finish = ByteWriter.prototype.finish;
      vi.spyOn(ByteWriter.prototype, 'finish').mockImplementation(function (this: ByteWriter) {
        backing.add((this as unknown as { buffer: Uint8Array }).buffer.buffer);
        const result = finish.call(this);
        outputs.add(result.buffer);
        return result;
      });
      try {
        f.state.snapshot();
        expect(prepare).toHaveBeenCalledTimes(prepared ? 1 : 0);
        // The shared codec calls the actual scalar writer once per field car.
        // Ordinary encoding uses its lexical writer, checked by its
        // scalar counts here rather than replacing the reference implementation.
        expect(carWrites).toHaveBeenCalledTimes(prepared ? 12 : 0);
        expect(floatWrites).toHaveBeenCalledTimes(12 * 4 * (prepared ? 1 : n) + n);
        expect(quantizedWrites).toHaveBeenCalledTimes(prepared ? 12 * 13 : n * (12 * 7 + 6));
        expect(backing.size).toBe(n + Number(prepared));
        expect(outputs.size).toBe(backing.size);
        const allBuffers = new Set([...backing, ...outputs]);
        if (prepared) {
          const shared = prepare.mock.results[0].value as codec.PreparedSnapshotCars;
          expect(shared.compact.byteLength).toBe(12 * 39);
          expect(shared.full.byteLength).toBe(12 * 51);
          expect(outputs.has(shared.full.buffer)).toBe(true);
          allBuffers.add(shared.compact.buffer);
        }
        expect(allBuffers.size).toBe(2 * n + (prepared ? 3 : 0));
        expect([...allBuffers].reduce((bytes, buffer) => bytes + buffer.byteLength, 0)).toBe(
          prepared ? 1692 + 1006 * n : 1159 * n,
        );
        const emitted = f.peers.map((peer) => peer.packets[0].data);
        expect(new Set(emitted.map((data) => data.buffer)).size).toBe(n);
        for (const data of emitted) {
          expect(outputs.has(data.buffer)).toBe(true);
          expect(backing.has(data.buffer)).toBe(false);
          expect(data.byteLength).toBe(23 + 12 * 39 + 12);
        }
      } finally {
        vi.restoreAllMocks();
        f.server.teardown();
      }
    },
  );

  it('keeps preparation bounded and source-independent, including arbitrary car order and flags', () => {
    for (const count of [1, 4, 12, LIMITS.carsPerSnapshot]) {
      const cars = Array.from({ length: count }, (_, i) => ({
        ...emptyCarState(count - i - 1),
        flags: (i * 39) & 255,
        x: i * -123.456,
        vx: i * 100,
        wx: i * -20,
        ay: i * 500,
        steer: i - 1.5,
        rpm: i * 1024 + 32,
        laps: i * 27,
        rank: i * 17,
      }));
      const before = structuredClone(cars);
      const prepared = codec.prepareSnapshotCars(cars);
      const header = {
        tick: 0xffffffff,
        phase: 3,
        raceTime: -0,
        ackSeq: -1,
        slack: -200.5,
        missing: 300,
        echo: 0x100000003,
        hold: 65535.5,
      };
      const retained: Uint8Array[] = [];
      for (let own = 0; own < count; own++) {
        const expected = codec.encodeSnapshot({
          ...header,
          cars: cars.map((car, i) => ({
            ...car,
            flags: (car.flags & ~CAR_FLAG.FULL) | (i === own ? CAR_FLAG.FULL : 0),
          })),
        });
        const actual = codec.encodePreparedSnapshot(header, prepared, own);
        expect(actual).toEqual(expected);
        retained.push(actual);
      }
      expect(cars).toEqual(before);
      const copy = retained.map((data) => data.slice());
      cars.forEach((car) => {
        car.x = 999;
        car.flags = 0;
      });
      expect(codec.encodePreparedSnapshot(header, prepared, 0)).toEqual(copy[0]);
      prepared.compact.fill(0);
      prepared.full.fill(0);
      expect(retained).toEqual(copy);
      retained[0].fill(0);
      expect(retained.slice(1)).toEqual(copy.slice(1));
      expect(() => codec.encodePreparedSnapshot(header, prepared, count)).toThrow(
        'Invalid full car index',
      );
    }
    expect(() =>
      codec.prepareSnapshotCars(
        Array.from({ length: LIMITS.carsPerSnapshot + 1 }, (_, i) => emptyCarState(i)),
      ),
    ).toThrow('Too many cars in snapshot');
  });

  it.each([4, 12])(
    'retains packet/event order and latches across reentry with %i recipients',
    (n) => {
      const f = fixture(n),
        reference = fixture(n);
      vary(f, 0);
      vary(reference, 0);
      referenceBoundary(reference);
      const record = f.peers[0].transport.send;
      const deferred: RaceEvent = { type: 'finish', car: 2, tick: 1206 };
      let sends = 0;
      f.peers[0].transport.send = (data, channel) => {
        record(data, channel);
        if (channel !== 'unreliable') return;
        if (++sends === 1) {
          vary(f, 1);
          vary(reference, 1);
          referenceBoundary(reference);
          data.fill(0);
        } else {
          f.contact[2] = 1;
          f.players[1].missingWindow = 7;
          f.players[1].queue.accept([{ seq: 1, tick: 1209, ticks: 1, controls: controls() }], 1206);
          f.state.emit(deferred);
        }
        f.state.snapshot();
      };
      try {
        f.state.snapshot();
        expect(sends).toBe(2);
        for (let i = 1; i < n; i++) expect(f.peers[i].packets).toEqual(reference.peers[i].packets);
        expect(f.peers[1].packets.map((packet) => packet.channel)).toEqual([
          'unreliable',
          'reliable',
          'unreliable',
          'reliable',
        ]);
        expect(snapshots(f.peers[1].packets).map((snapshot) => snapshot.tick)).toEqual([
          1200, 1206,
        ]);
        expect(f.state.pendingEvents).toEqual([deferred]);
        expect(f.contact[2]).toBe(1);
        expect(f.players[1].missingWindow).toBe(7);
        f.peers[0].transport.send = record;
        reference.contact[2] = 1;
        reference.players[1].missingWindow = 7;
        reference.players[1].queue.accept(
          [{ seq: 1, tick: 1209, ticks: 1, controls: controls() }],
          1206,
        );
        reference.state.emit(deferred);
        referenceBoundary(reference);
        f.state.snapshot();
        for (let i = 1; i < n; i++) expect(f.peers[i].packets).toEqual(reference.peers[i].packets);
        expect(snapshots(f.peers[1].packets).at(-1)).toMatchObject({ missing: 7, slack: 3 });
        expect(f.state.pendingEvents).toEqual([]);
        expect(f.state.snapshotBatches).toEqual([]);
      } finally {
        f.peers[0].transport.send = record;
        f.server.teardown();
        reference.server.teardown();
      }
    },
  );

  it.each(['snapshot', 'events'] as const)(
    'isolates a %s send failure after all recipient bytes are prepared',
    (failure) => {
      const f = fixture(4),
        reference = fixture(4);
      vary(f, 0);
      vary(reference, 0);
      referenceBoundary(reference);
      const record = f.peers[0].transport.send;
      const fault = new Error(`${failure} send failed`);
      f.peers[0].transport.send = (data, channel) => {
        if (channel === (failure === 'snapshot' ? 'unreliable' : 'reliable')) {
          data.fill(0);
          // Failure can synchronously change the world, but later peers still
          // receive the captured batch. The following boundary reflects it.
          f.sim.cars[7].body.position.x += 100;
          throw fault;
        }
        record(data, channel);
      };
      try {
        expect(() => f.state.snapshot()).not.toThrow();
        expect(f.server.stats.transportErrorCount).toBe(1);
        expect(f.server.stats.transportErrors[0].error).toBe(fault);
        expect(f.players[0].connection).toBeNull();
        for (let i = 1; i < 4; i++) expect(f.peers[i].packets).toEqual(reference.peers[i].packets);
        f.state.snapshot();
        const next = snapshots(f.peers[1].packets);
        expect(next[1].cars[7].x - next[0].cars[7].x).toBeCloseTo(100, 4);
        expect(next[1].cars[0].flags & (CAR_FLAG.AI | CAR_FLAG.GHOST)).toBe(
          CAR_FLAG.AI | CAR_FLAG.GHOST,
        );
        expect(f.server.stats.snapshotsSent).toBe(failure === 'snapshot' ? 6 : 7);
      } finally {
        f.peers[0].transport.send = record;
        f.server.teardown();
        reference.server.teardown();
      }
    },
  );

  it('skips a replaced connection without giving its captured packet to the new owner', () => {
    const f = fixture(4);
    vary(f, 0);
    const replacement = recordingTransport('replacement');
    const record = f.peers[0].transport.send;
    const car = f.players[1].car!;
    let replaced = false;
    f.peers[0].transport.send = (data, channel) => {
      record(data, channel);
      if (channel !== 'unreliable' || replaced) return;
      replaced = true;
      f.peers[1].transport.onClose!('reconnect');
      f.server.accept(replacement.transport);
      replacement.transport.onMessage!(
        codec.encodeControl({
          kind: 'join',
          net: NET_PROTOCOL_VERSION,
          name: 'Driver 1',
          vehicle: 'apx01',
          identity: f.server.expectedIdentity('apx01'),
          token: f.server.playerByCar(car)!.token,
        }),
        'reliable',
      );
    };
    try {
      f.state.snapshot();
      expect(f.players[1].connection!.transport).toBe(replacement.transport);
      expect(f.peers[1].packets).toEqual([]);
      expect(snapshots(replacement.packets)).toEqual([]);
      expect(f.server.stats.snapshotsSent).toBe(3);
      f.state.snapshot();
      const delivered = snapshots(replacement.packets);
      expect(delivered).toHaveLength(1);
      expect(
        delivered[0].cars.filter((state) => state.flags & CAR_FLAG.FULL).map((state) => state.id),
      ).toEqual([car]);
      expect(f.server.stats.snapshotsSent).toBe(7);
    } finally {
      f.peers[0].transport.send = record;
      f.server.teardown();
    }
  });
});
