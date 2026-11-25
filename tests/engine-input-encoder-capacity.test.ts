import { describe, expect, it, vi } from 'vitest';
import { ByteWriter } from '../src/net/bytes.ts';
import { decodeClientMessage, encodeInput, MSG } from '../src/net/codec.ts';
import { LIMITS } from '../src/net/constants.ts';
import { writeInputPacket, type InputPacket } from '../src/net/input.ts';
import { controls } from '../src/simulation/config.ts';

/** Previous allocation policy, retaining the unchanged production wire writer. */
function previousEncode(packet: InputPacket) {
  const writer = new ByteWriter(16 + packet.commands.length * 8).u8(MSG.INPUT);
  writeInputPacket(writer, packet);
  return writer.finish();
}

function packet(count: number, variant = 0): InputPacket {
  const pedals = [0, 1, -0.1, 1.1, 0.5, 0.5 / 255, 127.5 / 255, 0.999],
    signed = [-1.1, -1, -0.5 / 63, -0, 0.5 / 63, 1, 1.1, 0.6],
    counters = [0, -1, 0xffffffff, 0x100000000, 0x100000001, 129.9],
    commands = Array.from({ length: count }, (_, i) => {
      const k = variant + i;
      return {
        seq: [0, 0x7fffffff, 0xffffffff - count, 0x100000007][variant % 4] + i,
        tick: 0,
        ticks: 1 + (k % LIMITS.commandTicksMax),
        controls: {
          ...controls(),
          throttle: pedals[k % 8],
          brake: pedals[(k + 1) % 8],
          clutch: pedals[(k + 2) % 8],
          rearBrake: pedals[(k + 3) % 8],
          steer: signed[k % 8],
          riderLean: signed[(k + 1) % 8],
          shift: (k % 3) - 1,
          ers: ((k + 1) % 3) as 0 | 1 | 2,
          manualClutch: !!(k & 1),
          reverse: !!(k & 2),
          drs: !!(k & 4),
          overtake: !!(k & 8),
          pit: !!(k & 16),
        },
      };
    });
  let tick = [
    0,
    1200,
    0xffffffff - commands.reduce((sum, command) => sum + command.ticks, 0),
    0x1000004b0,
  ][variant % 4];
  for (const command of commands) {
    command.tick = tick;
    tick += command.ticks;
  }
  return {
    sentAt: counters[variant % counters.length],
    ackTick: counters[(variant + 1) % counters.length],
    commands,
  };
}

interface WriterView {
  buffer: Uint8Array;
  view: DataView;
  length: number;
  reserve(bytes: number): void;
  finish(): Uint8Array;
  finishOwned(): Uint8Array;
}

/** Observe the actual writer and returned backing buffers, without replacing
 * any write, growth, copy or finish operation. */
function traceEncode(encode: typeof encodeInput, input: InputPacket) {
  const prototype = ByteWriter.prototype as unknown as WriterView,
    originalReserve = prototype.reserve,
    originalFinish = prototype.finish,
    originalFinishOwned = prototype.finishOwned,
    buffers = new Set<ArrayBufferLike>(),
    views = new Set<DataView>();
  let initialCapacity = -1,
    finalCapacity = -1,
    growths = 0,
    copiedBytes = 0,
    writerBuffer: ArrayBufferLike | undefined;
  const reserve = vi.spyOn(prototype, 'reserve').mockImplementation(function (this: WriterView, n) {
    if (initialCapacity < 0) initialCapacity = this.buffer.length;
    const before = this.buffer,
      length = this.length;
    buffers.add(before.buffer);
    views.add(this.view);
    originalReserve.call(this, n);
    if (this.buffer !== before) {
      growths++;
      copiedBytes += length;
    }
    buffers.add(this.buffer.buffer);
    views.add(this.view);
  });
  const finish = vi.spyOn(prototype, 'finish').mockImplementation(function (this: WriterView) {
    finalCapacity = this.buffer.length;
    writerBuffer = this.buffer.buffer;
    const output = originalFinish.call(this);
    buffers.add(output.buffer);
    return output;
  });
  const finishOwned = vi.spyOn(prototype, 'finishOwned').mockImplementation(function (
    this: WriterView,
  ) {
    finalCapacity = this.buffer.length;
    writerBuffer = this.buffer.buffer;
    const output = originalFinishOwned.call(this);
    buffers.add(output.buffer);
    return output;
  });
  try {
    const output = encode(input);
    return {
      output,
      writerBuffer,
      initialCapacity,
      finalCapacity,
      growths,
      copiedBytes,
      backingBuffers: buffers.size,
      dataViews: views.size,
    };
  } finally {
    reserve.mockRestore();
    finish.mockRestore();
    finishOwned.mockRestore();
  }
}

describe('input encoder capacity', () => {
  it('preserves complete packets for counts 0–16, durations, counter boundaries and all control flags', () => {
    for (let count = 0; count <= LIMITS.commandsPerPacket; count++) {
      for (let variant = 0; variant < 32; variant++) {
        const input = packet(count, variant),
          expected = previousEncode(input),
          output = encodeInput(input);
        expect(output).toEqual(expected);
        expect(output.length).toBe(count ? 18 + 9 * count : 10);
        expect(decodeClientMessage(output, 'unreliable')).toEqual(
          decodeClientMessage(expected, 'unreliable'),
        );
      }
    }
  });

  it('consumes an exact writer as the owned result with no growth for every allowed count', () => {
    for (let count = 0; count <= LIMITS.commandsPerPacket; count++) {
      const input = packet(count),
        previous = traceEncode(previousEncode, input),
        current = traceEncode(encodeInput, input),
        size = count ? 18 + 9 * count : 10;
      expect(previous.initialCapacity).toBe(16 + 8 * count);
      expect(previous.finalCapacity).toBe(count ? 2 * (16 + 8 * count) : 16);
      expect(previous.growths).toBe(count ? 1 : 0);
      expect(previous.backingBuffers).toBe(count ? 3 : 2);
      expect(previous.dataViews).toBe(count ? 2 : 1);
      expect(current).toMatchObject({
        initialCapacity: size,
        finalCapacity: size,
        growths: 0,
        copiedBytes: 0,
        backingBuffers: 1,
        dataViews: 1,
      });
      // Consuming finalization releases the writer's ownership without copying.
      expect(current.output.buffer).toBe(current.writerBuffer);
      expect(current.output).toEqual(previous.output);
    }
  });

  it('keeps retained outputs independent of later encodes, output mutation and source mutation', () => {
    const input = packet(LIMITS.commandsPerPacket, 31),
      expected = previousEncode(input),
      first = encodeInput(input),
      second = encodeInput(input);
    expect(first.buffer).not.toBe(second.buffer);
    for (let count = 0; count <= LIMITS.commandsPerPacket; count++) encodeInput(packet(count));
    expect(first).toEqual(expected);
    input.sentAt = 7;
    input.commands[0].controls.throttle = 0;
    input.commands.length = 0;
    expect(first).toEqual(expected);
    first.fill(0);
    expect(second).toEqual(expected);
  });

  it('retains command-count and sequence/tick contiguity rejection', () => {
    const tooMany = packet(LIMITS.commandsPerPacket + 1),
      sequenceGap = packet(2),
      tickGap = packet(2),
      wrappedSequence = packet(2);
    sequenceGap.commands[1].seq++;
    tickGap.commands[1].tick++;
    wrappedSequence.commands[0].seq = 0xffffffff;
    wrappedSequence.commands[1].seq = 0;
    for (const encode of [previousEncode, encodeInput]) {
      expect(() => encode(tooMany)).toThrow('Too many commands for one packet');
      for (const input of [sequenceGap, tickGap, wrappedSequence])
        expect(() => encode(input)).toThrow('Commands in a packet must be contiguous');
    }
  });

  it('retains wire coercion and decoder rejection at duration and sequence/tick overflow boundaries', () => {
    const invalid = [packet(1), packet(1), packet(1), packet(1)];
    invalid[0].commands[0].ticks = 0;
    invalid[1].commands[0].ticks = LIMITS.commandTicksMax + 1;
    invalid[2].commands[0].seq = 0xffffffff;
    invalid[3].commands[0].tick = 0xffffffff;
    for (const input of invalid) {
      const expected = previousEncode(input),
        output = encodeInput(input);
      expect(output).toEqual(expected);
      expect(decodeClientMessage(output, 'unreliable')).toEqual(
        decodeClientMessage(expected, 'unreliable'),
      );
      expect(decodeClientMessage(output, 'unreliable').ok).toBe(false);
    }
    const wrapped = packet(2, 3),
      decoded = decodeClientMessage(encodeInput(wrapped), 'unreliable');
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.value.type === 'input') {
      expect(decoded.value.packet.commands[0].seq).toBe(7);
      expect(decoded.value.packet.commands[0].tick).toBe(1200);
    }
  });
});
