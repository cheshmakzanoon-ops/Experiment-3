import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { RaceClient } from '../src/net/client.ts';
import { decodeClientMessage } from '../src/net/codec.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import type { Transport } from '../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';

function sender(send: Transport['send']) {
  const transport: Transport = {
    label: 'native transfer accounting',
    open: true,
    onMessage: null,
    onClose: null,
    send,
    close() {},
  };
  const client = new RaceClient({
    loop: new EventLoop(),
    transport,
    name: 'Transfer',
    vehicle: 'apx01',
    advertised: DEFAULT_OPTIONS,
    input: controls,
  });
  client.commands.start(120);
  client.commands.issue(2, { ...controls(), throttle: 0.5 });
  client.commands.issue(2, { ...controls(), steer: -0.25 });
  return {
    client,
    sendInputs: () => (client as unknown as { sendInputs(): void }).sendInputs(),
  };
}

describe('input accounting across an owning transfer transport', () => {
  it('retains the sent byte count when native MessageChannel detaches each packet', async () => {
    const { port1, port2 } = new MessageChannel();
    const lengths: number[] = [];
    const departed: Uint8Array[] = [];
    const { client, sendInputs } = sender((data, channel) => {
      expect(channel).toBe('unreliable');
      lengths.push(data.byteLength);
      departed.push(data);
      port1.postMessage(data, [data.buffer as ArrayBuffer]);
    });
    try {
      const first = new Promise<Uint8Array>((resolve) => port2.once('message', resolve));
      sendInputs();
      const delivered = await first;
      const decoded = decodeClientMessage(delivered, 'unreliable');
      expect(
        decoded.ok && decoded.value.type === 'input' && decoded.value.packet.commands.length,
      ).toBe(2);
      expect(delivered.byteLength).toBe(36);
      client.commands.acknowledge(1);
      const second = new Promise<Uint8Array>((resolve) => port2.once('message', resolve));
      sendInputs();
      const empty = await second;
      const emptyDecoded = decodeClientMessage(empty, 'unreliable');
      expect(
        emptyDecoded.ok &&
          emptyDecoded.value.type === 'input' &&
          emptyDecoded.value.packet.commands,
      ).toEqual([]);
      expect(empty.byteLength).toBe(10);
      expect(departed.map((data) => data.byteLength)).toEqual([0, 0]);
      expect(departed.map((data) => data.buffer.byteLength)).toEqual([0, 0]);
      expect(client.stats.inputPackets).toBe(2);
      expect(client.stats.commandCopies).toBe(2);
      expect(client.stats.inputBytes).toEqual(lengths);
      expect(client.stats.sampleTotals.inputBytes).toMatchObject({
        samples: 2,
        sum: 46,
        mean: 23,
        max: 36,
      });
    } finally {
      client.dispose();
      port1.close();
      port2.close();
    }
  });

  it.each([false, true])(
    'retains failed-send accounting when detachment is %s',
    async (transfer) => {
      const { port1, port2 } = new MessageChannel();
      const failure = new Error('adapter refused the send');
      let sent: Uint8Array | undefined;
      const delivered = transfer
        ? new Promise<Uint8Array>((resolve) => port2.once('message', resolve))
        : Promise.resolve(null);
      const { client, sendInputs } = sender((data) => {
        sent = data;
        if (transfer) port1.postMessage(data, [data.buffer as ArrayBuffer]);
        throw failure;
      });
      try {
        expect(sendInputs).toThrow(failure);
        const received = await delivered;
        expect(sent!.byteLength).toBe(transfer ? 0 : 36);
        if (transfer) expect(received!.byteLength).toBe(36);
        expect(client.stats.inputPackets).toBe(0);
        expect(client.stats.commandCopies).toBe(0);
        expect(client.stats.inputBytes).toEqual([]);
        expect(client.stats.sampleTotals.inputBytes.samples).toBe(0);
      } finally {
        client.dispose();
        port1.close();
        port2.close();
      }
    },
  );
});
