import { describe, expect, it } from 'vitest';
import { ByteWriter } from '../src/net/bytes.ts';
import {
  encodeInput,
  encodePreparedSnapshot,
  encodeSnapshot,
  MSG,
  prepareSnapshotCars,
} from '../src/net/codec.ts';
import { LIMITS } from '../src/net/constants.ts';
import { writeInputPacket, type InputPacket } from '../src/net/input.ts';
import {
  CAR_COMPACT_BYTES,
  CAR_FLAG,
  CAR_FULL_BYTES,
  emptyCarState,
  SNAPSHOT_HEADER_BYTES,
  writeSnapshot,
  type Snapshot,
} from '../src/net/snapshot.ts';
import { controls } from '../src/simulation/config.ts';

const backing = (writer: ByteWriter) => (writer as unknown as { buffer: Uint8Array }).buffer;
function expectExactBuffer(data: Uint8Array) {
  expect(data.byteOffset).toBe(0);
  expect(data.buffer.byteLength).toBe(data.byteLength);
}
function transfer(data: Uint8Array<ArrayBuffer>) {
  const received = structuredClone(data, { transfer: [data.buffer] });
  expect(data.byteLength).toBe(0);
  expectExactBuffer(received);
  return received;
}
function input(count: number): InputPacket {
  let tick = 1200;
  return {
    sentAt: 0x100000003,
    ackTick: 0xffffffff,
    commands: Array.from({ length: count }, (_, i) => {
      const command = {
        seq: 40 + i,
        tick,
        ticks: 1 + (i % LIMITS.commandTicksMax),
        controls: {
          ...controls(),
          throttle: i % 2 ? 1 : 0.5,
          brake: i % 3 ? 0 : 0.3,
          steer: (i % 3) - 1,
          riderLean: i % 2 ? -0.6 : 0.7,
          rearBrake: (i % 4) / 3,
          pit: !!(i & 1),
          reverse: !!(i & 2),
          overtake: !!(i & 4),
        },
      };
      tick += command.ticks;
      return command;
    }),
  };
}
function snapshot(count: number): Snapshot {
  return {
    tick: 0xffffffff,
    phase: 3,
    raceTime: -0,
    ackSeq: -1,
    slack: -200.5,
    missing: 300,
    echo: 0x100000003,
    hold: 65535.5,
    cars: Array.from({ length: count }, (_, i) => ({
      ...emptyCarState(count - i - 1),
      flags: (i * 39) & ~CAR_FLAG.FULL,
      x: i * -123.456,
      vx: i * 100,
      wx: i * -20,
      ay: i * 500,
      steer: i - 1.5,
      rpm: i * 1024 + 32,
      laps: i * 27,
      rank: i * 17,
    })),
  };
}
function inputReference(packet: InputPacket) {
  const writer = new ByteWriter().u8(MSG.INPUT);
  writeInputPacket(writer, packet);
  return writer.finish();
}
function snapshotReference(packet: Snapshot) {
  const writer = new ByteWriter().u8(MSG.SNAPSHOT);
  writeSnapshot(writer, packet);
  return writer.finish();
}

describe('consuming writer ownership', () => {
  it('preserves finish as a defensive copy without resetting the writer', () => {
    const writer = new ByteWriter(8).u16(0x1234),
      first = writer.finish();
    expect(first.buffer).not.toBe(backing(writer).buffer);
    expectExactBuffer(first);
    expect(writer.length).toBe(2);
    writer.u16(0x5678);
    expect(first).toEqual(Uint8Array.of(0x34, 0x12));
    first.fill(0);
    expect(writer.finish()).toEqual(Uint8Array.of(0x34, 0x12, 0x78, 0x56));
  });

  it('moves an exactly filled buffer and gives later scalar writes independent storage', () => {
    const writer = new ByteWriter(4).u32(0x12345678),
      original = backing(writer),
      packet = writer.finishOwned();
    expect(packet).toBe(original);
    expectExactBuffer(packet);
    expect(writer.length).toBe(0);
    expect(backing(writer).buffer).not.toBe(packet.buffer);
    writer.u8(1).i8(-2).u16(3).i16(-4).u32(5).f32(1.5).f64(-0.25);
    writer.varint(16384).bytes(Uint8Array.of(6, 7));
    const expected = new ByteWriter()
      .u8(1)
      .i8(-2)
      .u16(3)
      .i16(-4)
      .u32(5)
      .f32(1.5)
      .f64(-0.25)
      .varint(16384)
      .bytes(Uint8Array.of(6, 7))
      .finish();
    expect(writer.finish()).toEqual(expected);
    expect(packet).toEqual(Uint8Array.of(0x78, 0x56, 0x34, 0x12));
    packet.fill(0);
    expect(writer.finishOwned()).toEqual(expected);
  });

  it.each([0, 2, 32])('trims spare capacity after starting at %i bytes', (capacity) => {
    const writer = new ByteWriter(capacity).u16(0x1234).u8(0x56),
      original = backing(writer),
      packet = writer.finishOwned();
    expect(original.length).toBeGreaterThan(packet.length);
    expect(packet.buffer).not.toBe(original.buffer);
    expectExactBuffer(packet);
    expect(transfer(packet)).toEqual(Uint8Array.of(0x34, 0x12, 0x56));
    writer.bytes(Uint8Array.of(7, 8));
    expect(writer.finishOwned()).toEqual(Uint8Array.of(7, 8));
  });

  it('survives whole-buffer transfer of exact and repeatedly empty results', () => {
    const writer = new ByteWriter(2).u16(0xabcd),
      packet = writer.finishOwned();
    expect(transfer(packet)).toEqual(Uint8Array.of(0xcd, 0xab));
    for (let i = 0; i < 3; i++) {
      expect(transfer(writer.finishOwned())).toEqual(new Uint8Array());
      // Transferring an empty result must not detach shared reset storage.
      expect(() => writer.bytes(new Uint8Array())).not.toThrow();
      expect(writer.finish()).toEqual(new Uint8Array());
    }
    writer.u8(19);
    expect(writer.finishOwned()).toEqual(Uint8Array.of(19));
    const other = new ByteWriter(1).u8(23);
    other.finishOwned();
    expect(() => other.bytes(new Uint8Array())).not.toThrow();
    expect(other.u8(29).finishOwned()).toEqual(Uint8Array.of(29));
  });

  it('preserves retained bytes and permits recovery after a rejected write', () => {
    const writer = new ByteWriter(1).u8(42),
      retained = writer.finishOwned();
    for (const value of [-1, 0.5, NaN, Infinity, 2 ** 53]) {
      expect(() => writer.varint(value)).toThrow('varint must be a non-negative integer');
      expect(writer.length).toBe(0);
      expect(retained).toEqual(Uint8Array.of(42));
    }
    expect(writer.varint(128).finishOwned()).toEqual(Uint8Array.of(0x80, 1));
    expect(retained).toEqual(Uint8Array.of(42));
  });
});

describe('packet buffer ownership', () => {
  it('preserves exact input bytes for all command counts and survives transfer and reuse', () => {
    for (let count = 0; count <= LIMITS.commandsPerPacket; count++) {
      const source = input(count),
        expected = inputReference(source),
        first = encodeInput(source),
        second = encodeInput(source);
      expect(first).toEqual(expected);
      expectExactBuffer(first);
      expect(first.buffer).not.toBe(second.buffer);
      expect(transfer(first)).toEqual(expected);
      expect(encodeInput(source)).toEqual(expected);
      source.commands.length = 0;
      source.sentAt = 99;
      expect(second).toEqual(expected);
    }
  });

  it('sizes ordinary snapshots exactly for no, one, alternating and all FULL cars', () => {
    for (const count of [0, 1, 2, 12, LIMITS.carsPerSnapshot]) {
      for (const full of [
        () => false,
        (i: number) => i === count - 1,
        (i: number) => !!(i & 1),
        () => true,
      ]) {
        const source = snapshot(count);
        let fullCount = 0;
        for (let i = 0; i < count; i++) {
          if (full(i)) {
            source.cars[i].flags |= CAR_FLAG.FULL;
            fullCount++;
          }
        }
        const expected = snapshotReference(source),
          first = encodeSnapshot(source),
          retained = encodeSnapshot(source);
        expect(first).toEqual(expected);
        expect(first.length).toBe(
          1 +
            SNAPSHOT_HEADER_BYTES +
            count * CAR_COMPACT_BYTES +
            fullCount * (CAR_FULL_BYTES - CAR_COMPACT_BYTES),
        );
        expectExactBuffer(first);
        expect(first.buffer).not.toBe(retained.buffer);
        expect(transfer(first)).toEqual(expected);
        expect(encodeSnapshot(source)).toEqual(expected);
        source.cars.forEach((car) => {
          car.x = 999;
          car.flags = CAR_FLAG.FULL;
        });
        expect(retained).toEqual(expected);
      }
    }
  });

  it('keeps recipient packets independent of transferred peers and subsequent preparation', () => {
    for (const count of [2, 12, LIMITS.carsPerSnapshot]) {
      const source = snapshot(count),
        original = structuredClone(source),
        prepared = prepareSnapshotCars(source.cars),
        packets: Uint8Array<ArrayBuffer>[] = [],
        expected: Uint8Array[] = [];
      expectExactBuffer(prepared.full);
      expectExactBuffer(prepared.compact);
      expect(prepared.full.buffer).not.toBe(prepared.compact.buffer);
      for (let own = 0; own < count; own++) {
        const reference = snapshotReference({
            ...source,
            cars: source.cars.map((car, i) => ({
              ...car,
              flags: (car.flags & ~CAR_FLAG.FULL) | (i === own ? CAR_FLAG.FULL : 0),
            })),
          }),
          packet = encodePreparedSnapshot(source, prepared, own);
        expect(packet).toEqual(reference);
        expectExactBuffer(packet);
        expect(packet.buffer).not.toBe(prepared.full.buffer);
        expect(packet.buffer).not.toBe(prepared.compact.buffer);
        packets.push(packet);
        expected.push(reference);
      }
      expect(new Set(packets.map((packet) => packet.buffer)).size).toBe(count);
      expect(source).toEqual(original);
      expect(transfer(packets[0])).toEqual(expected[0]);
      expect(encodePreparedSnapshot(source, prepared, 0)).toEqual(expected[0]);
      source.cars.forEach((car) => {
        car.x = 999;
        car.flags = CAR_FLAG.FULL;
      });
      prepareSnapshotCars(source.cars);
      prepared.compact.fill(0);
      prepared.full.fill(0);
      expect(packets.slice(1)).toEqual(expected.slice(1));
    }
    const empty = prepareSnapshotCars([]);
    expectExactBuffer(empty.compact);
    expectExactBuffer(empty.full);
    expect(() => encodePreparedSnapshot(snapshot(0), empty, 0)).toThrow('Invalid full car index');
  });

  it('retains encoder errors and good packets across failed encodes', () => {
    const goodInput = input(2),
      goodSnapshot = snapshot(2),
      prepared = prepareSnapshotCars(goodSnapshot.cars),
      retainedInput = encodeInput(goodInput),
      retainedSnapshot = encodePreparedSnapshot(goodSnapshot, prepared, 1);
    expect(() => encodeInput(input(LIMITS.commandsPerPacket + 1))).toThrow('Too many commands');
    const gap = input(2);
    gap.commands[1].seq++;
    expect(() => encodeInput(gap)).toThrow('Commands in a packet must be contiguous');
    for (const encode of [encodeSnapshot, (value: Snapshot) => prepareSnapshotCars(value.cars)])
      expect(() => encode(snapshot(LIMITS.carsPerSnapshot + 1))).toThrow(
        'Too many cars in snapshot',
      );
    for (const index of [-1, 0.5, 2, NaN, Infinity])
      expect(() => encodePreparedSnapshot(goodSnapshot, prepared, index)).toThrow(
        'Invalid full car index',
      );
    expect(encodeInput(goodInput)).toEqual(retainedInput);
    expect(encodePreparedSnapshot(goodSnapshot, prepared, 1)).toEqual(retainedSnapshot);
  });
});
