import { RaceClient } from '../../src/net/client.ts';
import { decodeClientMessage, decodeServerMessage } from '../../src/net/codec.ts';
import { TICK_MS } from '../../src/net/constants.ts';
import { EventLoop } from '../../src/net/event-loop.ts';
import { Lobby } from '../../src/net/lobby.ts';
import { RaceServer } from '../../src/net/server.ts';
import { CAR_FLAG } from '../../src/net/snapshot.ts';
import type { Channel, Transport } from '../../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS, validateOptions } from '../../src/simulation/config.ts';

interface Envelope {
  id: number;
  data: Uint8Array;
  channel: Channel;
  due: number;
  drop: boolean;
}
interface Sent {
  peer: number;
  direction: 'up' | 'down';
  data: Uint8Array;
  retained: Uint8Array;
  channel: Channel;
  received: boolean;
}
interface Header {
  tick: number;
  ack: number;
  full: number[];
  bytes: number;
  missing: number;
  slack: number;
}
interface Peer {
  client: RaceClient;
  close(): void;
  headers: Header[];
  inputLengths: number[];
  receivedInputs: { seq: number; dropped: boolean }[];
  playback: {
    frames: number;
    bounded: boolean;
    rawRewinds: number;
    correctionFrames: number;
    rawCommandTargetErrors: number;
  };
}

/** Actual browser MessagePorts transfer every encoded packet. Logical delay
 * and three intentionally dropped inputs are applied only after native receipt.
 * This is not a WebRTC/socket or physical-network benchmark. */
export async function transferredRace() {
  const loop = new EventLoop();
  const session = validateOptions({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    laps: 1,
    opponents: 2,
    seed: 99,
  });
  const created = Lobby.create('NATIVE', {
    name: 'Native transfer race',
    options: session,
    capacity: 3,
    fieldSize: 3,
    minPlayers: 3,
  });
  if (!created.ok) throw new Error(created.reasons.join('; '));
  const server = new RaceServer({
    loop,
    lobby: created.lobby,
    raceSeconds: 30,
    timeouts: { gridCountdownMs: 1, disconnectMs: 2000 },
  });
  const sent: Sent[] = [];
  const nativeErrors: string[] = [];
  const receivedBuffers = new Set<ArrayBufferLike>();
  const retainedReceivers = new Map<string, { data: Uint8Array; expected: Uint8Array }>();
  const peers: Peer[] = [];
  let pendingNative = 0;
  let matchedBytes = 0;
  let detached = 0;
  let dropped = 0;
  let closedPorts = 0;
  let settle: (() => void) | null = null;
  const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.byteLength === b.byteLength && a.every((value, i) => value === b[i]);

  function connect(index: number): Peer {
    const channel = new MessageChannel();
    let open = true;
    const headers: Header[] = [];
    const inputLengths: number[] = [];
    const receivedInputs: Peer['receivedInputs'] = [];
    const playback: Peer['playback'] = {
      frames: 0,
      bounded: true,
      rawRewinds: 0,
      correctionFrames: 0,
      rawCommandTargetErrors: 0,
    };
    let previous: { at: number; tick: number; raw: number } | null = null;
    let portsClosed = false;
    const close = (reason = 'fixture closed') => {
      if (open) {
        open = false;
        clientTransport.onClose?.(reason);
        serverTransport.onClose?.(reason);
      }
      if (portsClosed) return;
      portsClosed = true;
      channel.port1.onmessage = channel.port2.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      closedPorts += 2;
    };
    function endpoint(port: MessagePort, direction: Sent['direction']): Transport {
      return {
        label: `native MessagePort ${index} ${direction}`,
        get open() {
          return open;
        },
        onMessage: null,
        onClose: null,
        close,
        send(data, kind) {
          if (!open) throw new Error('Transfer on a closed fixture port');
          const record: Sent = {
            peer: index,
            direction,
            data,
            retained: data.slice(),
            channel: kind,
            received: false,
          };
          const id = sent.push(record) - 1;
          let drop = false;
          if (kind === 'unreliable') {
            if (direction === 'down') {
              const decoded = decodeServerMessage(data, kind);
              if (!decoded.ok || decoded.value.type !== 'snapshot')
                throw new Error('Server emitted an invalid native snapshot');
              const snapshot = decoded.value.snapshot;
              headers.push({
                tick: snapshot.tick,
                ack: snapshot.ackSeq,
                full: snapshot.cars.filter((car) => car.flags & CAR_FLAG.FULL).map((car) => car.id),
                bytes: data.byteLength,
                missing: snapshot.missing,
                slack: snapshot.slack,
              });
            } else {
              const decoded = decodeClientMessage(data, kind);
              if (!decoded.ok || decoded.value.type !== 'input')
                throw new Error('Client emitted an invalid native input');
              inputLengths.push(data.byteLength);
              // Loss happens beyond the native transfer boundary. Subsequent
              // original client packets must recover unacknowledged commands.
              drop = index === 1 && inputLengths.length >= 9 && inputLengths.length <= 11;
            }
          }
          const delay =
            kind === 'reliable'
              ? 15
              : direction === 'up'
                ? 20
                : index === 0 && loop.now >= 1200 && loop.now < 4000
                  ? 200
                  : 50;
          const envelope: Envelope = { id, data, channel: kind, due: loop.now + delay, drop };
          pendingNative++;
          try {
            port.postMessage(envelope, [data.buffer as ArrayBuffer]);
          } catch (error) {
            pendingNative--;
            throw error;
          }
          if (data.byteLength !== 0 || data.buffer.byteLength !== 0)
            throw new Error('Native MessagePort failed to detach the sender');
          detached++;
        },
      };
    }
    const clientTransport = endpoint(channel.port1, 'up');
    const serverTransport = endpoint(channel.port2, 'down');
    function receive(transport: Transport, message: MessageEvent<Envelope>) {
      try {
        const envelope = message.data;
        const source = sent[envelope.id];
        if (!source || source.received) throw new Error('Unowned or duplicate native envelope');
        if (!(envelope.data instanceof Uint8Array) || !sameBytes(source.retained, envelope.data))
          throw new Error('Native transfer changed an encoded packet');
        source.received = true;
        matchedBytes += envelope.data.byteLength;
        if (receivedBuffers.has(envelope.data.buffer))
          throw new Error('Recipients shared a received packet buffer');
        receivedBuffers.add(envelope.data.buffer);
        if (envelope.channel === 'unreliable') {
          const key = `${source.peer}:${source.direction}`;
          if (!retainedReceivers.has(key))
            retainedReceivers.set(key, { data: envelope.data, expected: source.retained });
          if (source.direction === 'up') {
            const decoded = decodeClientMessage(envelope.data, envelope.channel);
            if (!decoded.ok || decoded.value.type !== 'input')
              throw new Error('Transferred input failed decoding');
            for (const command of decoded.value.packet.commands)
              receivedInputs.push({ seq: command.seq, dropped: envelope.drop });
          }
        }
        if (envelope.drop) dropped++;
        else
          loop.at(envelope.due, () => {
            if (open) transport.onMessage?.(envelope.data, envelope.channel);
          });
      } catch (error) {
        nativeErrors.push(String(error));
      } finally {
        pendingNative--;
        if (pendingNative === 0) settle?.();
      }
    }
    channel.port1.onmessage = (event) => receive(clientTransport, event);
    channel.port2.onmessage = (event) => receive(serverTransport, event);
    server.accept(serverTransport);
    const client = new RaceClient({
      loop,
      transport: clientTransport,
      name: `Native driver ${index}`,
      vehicle: 'apx01',
      advertised: session,
      autoReady: true,
      clockOffsetMs: [123456, -100000, 0][index],
      input: ({ tick, client: current }) => {
        if (current.targetTick() !== current.clock.arrivalTick(current.now) + current.lead)
          playback.rawCommandTargetErrors++;
        return {
          ...controls(),
          throttle: 0.3 + index * 0.05,
          steer: Math.sin(tick / 180 + index) * 0.003,
        };
      },
      onRender: (view, current) => {
        const remote = view.remotes[0];
        if (!remote) return;
        const raw = current.clock.arrivalTick(view.now) - current.jitter.delayTicks;
        if (previous) {
          const elapsed = (view.now - previous.at) / TICK_MS;
          const advanced = remote.tick - previous.tick;
          playback.bounded &&=
            advanced >= 0.75 * elapsed - 1e-6 && advanced <= 1.25 * elapsed + 1e-6;
          if (raw < previous.raw - 1e-6) playback.rawRewinds++;
        }
        if (Math.abs(remote.tick - raw) > 1e-6) playback.correctionFrames++;
        playback.frames++;
        previous = { at: view.now, tick: remote.tick, raw };
      },
    });
    client.join();
    return { client, close, headers, inputLengths, receivedInputs, playback };
  }

  async function advance(time: number) {
    loop.runUntil(time);
    while (pendingNative) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle = null;
          reject(new Error('Native transfer timed out'));
        }, 5000);
        settle = () => {
          clearTimeout(timer);
          settle = null;
          resolve();
        };
      });
      if (nativeErrors.length) throw new Error(nativeErrors.join('; '));
      // Native handlers enqueue engine delivery at the controlled logical time;
      // a reply may itself create another actual transferable message.
      loop.runUntil(time);
    }
  }
  try {
    for (let i = 0; i < 3; i++) peers.push(connect(i));
    for (let time = 0; time <= 5000; time += 5) await advance(time);
    const report = {
      transport: 'native MessageChannel transfer; controlled logical latency/loss',
      nativeErrors,
      simulatedMs: loop.now,
      server: {
        phase: server.phase,
        tick: server.world?.tick,
        snapshots: server.stats.snapshotsSent,
        invalidMessages: server.stats.invalidMessages,
        transportErrors: server.stats.transportErrorCount,
        kicks: server.stats.kicks,
        inputs: server.inputStats(),
      },
      wire: {
        packets: sent.length,
        detached,
        received: sent.filter((record) => record.received).length,
        uniqueReceivedBuffers: receivedBuffers.size,
        matchedBytes,
        sentBytes: sent.reduce((sum, record) => sum + record.retained.byteLength, 0),
        dropped,
        senderViewsRemainDetached: sent.every((record) => record.data.byteLength === 0),
        retainedReceivers: retainedReceivers.size,
        retainedReceiversUnchanged: [...retainedReceivers.values()].every(({ data, expected }) =>
          sameBytes(data, expected),
        ),
      },
      peers: peers.map(({ client, headers, inputLengths, receivedInputs, playback }) => {
        const delivered = new Set(
          receivedInputs.filter((entry) => !entry.dropped).map((entry) => entry.seq),
        );
        const droppedSequences = new Set(
          receivedInputs.filter((entry) => entry.dropped).map((entry) => entry.seq),
        );
        const firstObserved = new Map<number, boolean>();
        for (const { seq, dropped: lost } of receivedInputs)
          if (!firstObserved.has(seq)) firstObserved.set(seq, lost);
        return {
          car: client.car,
          state: client.state,
          invalidMessages: client.stats.invalidMessages,
          snapshots: client.stats.snapshots,
          lastSnapshotTick: client.lastSnapshotTick,
          inputPackets: client.stats.inputPackets,
          commands: client.stats.commands,
          commandCopies: client.stats.commandCopies,
          sentInputLengths: inputLengths,
          recordedInputLengths: client.stats.inputBytes,
          recordedInputTotal: client.stats.sampleTotals.inputBytes.sum,
          actualInputTotal: inputLengths.reduce((sum, length) => sum + length, 0),
          ack: client.commands.ackSeq,
          droppedSequences: [...droppedSequences],
          initiallyDroppedSequences: [...firstObserved]
            .filter(([, lost]) => lost)
            .map(([seq]) => seq),
          recoveredDroppedSequences: [...droppedSequences].filter((seq) => delivered.has(seq)),
          headers,
          playback,
        };
      }),
    };
    for (const peer of peers) peer.client.dispose();
    server.teardown();
    loop.runUntil(6000);
    return { ...report, cleanup: { closedPorts, pendingNative, pendingEvents: loop.pending } };
  } finally {
    for (const peer of peers) peer.client.dispose();
    server.teardown();
    for (const peer of peers) peer.close();
  }
}
