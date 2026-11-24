import { describe, expect, it, vi } from 'vitest';
import { sessionIdentity } from '../src/core/session-identity.ts';
import { RaceClient, type RaceClientConfig } from '../src/net/client.ts';
import { decodeClientMessage, encodeControl, encodeSnapshot } from '../src/net/codec.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import type { LobbyView, RaceResults, ServerControl } from '../src/net/messages.ts';
import { CAR_FLAG, emptyCarState } from '../src/net/snapshot.ts';
import type { Channel, Transport } from '../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';

const options: SessionOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'race',
  opponents: 0,
  vehicles: ['apx01'],
  grid: [0],
  seed: 47,
};
const identity = sessionIdentity(options);
const lobby: LobbyView = {
  id: 'lifetime',
  name: 'Lifecycle fixture',
  phase: 'lobby',
  capacity: 1,
  circuit: identity.circuit,
  ruleset: identity.ruleset,
  mode: options.mode,
  members: [{ player: 'guest:1', name: 'Driver', vehicle: 'apx01', ready: true }],
};
const welcome: ServerControl = {
  kind: 'welcome',
  player: 'guest:1',
  token: 'abcdef0123456789abcdef0123456789',
  lobby,
};
const grid: Extract<ServerControl, { kind: 'grid' }> = {
  kind: 'grid',
  options,
  identity,
  entries: [{ car: 0, name: 'Driver', player: 'guest:1', vehicle: 'apx01' }],
  car: 0,
  startTick: 0,
  serverTick: 0,
  startInMs: 0,
};
const results: RaceResults = {
  endTick: 120,
  reason: 'time-limit',
  classification: [
    {
      position: 1,
      car: 0,
      name: 'Driver',
      player: 'guest:1',
      laps: 0,
      lapTimes: [],
      best: 0,
      status: 'running',
    },
  ],
  recordDigest: '1a2b3c4d',
  progressDisputes: [],
};

function fixture(extra: Partial<RaceClientConfig> = {}) {
  const loop = new EventLoop();
  const sent: { data: Uint8Array; channel: Channel }[] = [];
  let onSend: ((data: Uint8Array, channel: Channel) => void) | undefined;
  const transport: Transport & { open: boolean } = {
    label: 'client-lifetime',
    open: true,
    onMessage: null,
    onClose: null,
    send: vi.fn((data, channel) => {
      onSend?.(data, channel);
      sent.push({ data: data.slice(), channel });
    }),
    close(reason) {
      transport.open = false;
      transport.onClose?.(reason);
    },
  };
  const client = new RaceClient({
    loop,
    transport,
    name: 'Driver',
    vehicle: 'apx01',
    advertised: options,
    input: controls,
    ...extra,
  });
  const deliver = (message: ServerControl) =>
    transport.onMessage?.(encodeControl(message), 'reliable');
  const snapshot = (tick = 6) =>
    encodeSnapshot({
      tick,
      phase: 1,
      raceTime: tick / 120,
      ackSeq: -1,
      slack: 127,
      missing: 0,
      echo: 0,
      hold: 0,
      cars: [{ ...emptyCarState(0), flags: CAR_FLAG.FULL, vx: 0, vz: 10 }],
    });
  const start = () => {
    client.join();
    deliver(welcome);
    deliver(grid);
    transport.onMessage?.(snapshot(), 'unreliable');
  };
  const messages = () =>
    sent.map(({ data, channel }) => {
      const decoded = decodeClientMessage(data, channel);
      if (!decoded.ok) throw new Error(decoded.reason);
      return decoded.value;
    });
  return {
    client,
    loop,
    transport,
    sent,
    deliver,
    snapshot,
    start,
    messages,
    setSend: (fn: typeof onSend) => (onSend = fn),
  };
}

function observed(client: RaceClient) {
  return structuredClone({
    state: client.state,
    reason: client.reason,
    player: client.player,
    token: client.token,
    car: client.car,
    grid: client.grid,
    lobby: client.lobby,
    events: client.events,
    results: client.results,
    latest: client.latest,
    lastSnapshotTick: client.lastSnapshotTick,
    stats: client.stats,
    commandCount: client.commands.size,
    nextSeq: client.commands.nextSeq,
  });
}

describe('RaceClient connection ownership', () => {
  it('joins once and retains one keep-alive through repeated join calls', () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) f.client.join();
    f.loop.runUntil(1000);
    const control = f.messages().filter((message) => message.type === 'control');
    expect(control.filter((message) => message.control.kind === 'join')).toHaveLength(1);
    expect(control.filter((message) => message.control.kind === 'ping')).toHaveLength(3);
    f.client.dispose();
    f.loop.runUntil(5000);
    expect(f.loop.pending).toBe(0);
  });

  it('allows an unsuccessful synchronous join send to be retried without retaining a timer', () => {
    const f = fixture(),
      failure = new Error('send failed');
    f.setSend(() => {
      throw failure;
    });
    expect(() => f.client.join()).toThrow(failure);
    expect(f.loop.pending).toBe(0);
    f.setSend(undefined);
    f.client.join();
    f.loop.runUntil(0);
    expect(f.messages().map((m) => m.type === 'control' && m.control.kind)).toEqual([
      'join',
      'ping',
    ]);
    f.client.dispose();
    f.loop.runUntil(500);
    expect(f.loop.pending).toBe(0);
  });

  it.each(['close', 'reject', 'results'] as const)(
    'does not create a keep-alive after synchronous %s during join delivery',
    (terminal) => {
      const f = fixture();
      f.setSend((data, channel) => {
        const decoded = decodeClientMessage(data, channel);
        if (
          !decoded.ok ||
          decoded.value.type !== 'control' ||
          decoded.value.control.kind !== 'join'
        )
          return;
        if (terminal === 'close') f.transport.close('closed during join');
        else if (terminal === 'reject') f.deliver({ kind: 'reject', reason: 'unavailable' });
        else f.deliver({ kind: 'results', results });
      });
      f.client.join();
      f.loop.runUntil(1000);
      expect(f.loop.pending).toBe(0);
      expect(f.messages()).toHaveLength(1);
      expect(f.client.state).toBe(
        terminal === 'close' ? 'closed' : terminal === 'reject' ? 'rejected' : 'results',
      );
      f.client.dispose();
    },
  );

  it('does not retain a timer when join is requested on an already closed transport', () => {
    const f = fixture();
    f.transport.open = false;
    f.client.join();
    f.loop.runUntil(1000);
    expect(f.sent).toEqual([]);
    expect(f.loop.pending).toBe(0);
    f.client.dispose();
  });

  it('does not retain a timer when join closes the local transport without a close callback', () => {
    const f = fixture();
    f.setSend(() => {
      f.transport.open = false;
    });
    f.client.join();
    f.loop.runUntil(1000);
    expect(f.messages()).toHaveLength(1);
    expect(f.loop.pending).toBe(0);
    f.client.dispose();
  });

  it('does not publish a join after its identity callback disposes the process', () => {
    const f = fixture({
      identity: (own) => {
        f.client.dispose();
        return own;
      },
    });
    f.client.join();
    f.loop.runUntil(1000);
    expect(f.client.state).toBe('closed');
    expect(f.sent).toEqual([]);
    expect(f.loop.pending).toBe(0);
  });

  const terminalActions: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['leave', (f) => f.client.leave()],
    ['dispose', (f) => f.client.dispose()],
    ['close', (f) => f.transport.close('connection gone')],
    ['reject', (f) => f.deliver({ kind: 'reject', reason: 'content rejected' })],
    ['kick', (f) => f.deliver({ kind: 'kicked', reason: 'removed' })],
  ];
  it.each(terminalActions)(
    'keeps %s terminal across retained callbacks and public requests',
    (_name, end) => {
      const f = fixture();
      f.start();
      f.loop.runUntil(25);
      expect(f.client.stats.commands).toBeGreaterThan(0);
      const message = f.transport.onMessage!,
        close = f.transport.onClose!;
      end(f);
      const before = observed(f.client),
        sent = f.sent.length;
      for (const late of [
        { ...grid, serverTick: 12, events: [] },
        { ...welcome, token: 'fedcba9876543210fedcba9876543210' },
        { kind: 'results', results },
        { kind: 'events', events: [{ type: 'finish', car: 0, tick: 120 }] },
        { kind: 'lapTimes', car: 0, from: 0, times: [1] },
        { kind: 'pong', t: 0, serverTick: 12 },
      ] satisfies ServerControl[])
        message(encodeControl(late), 'reliable');
      message(f.snapshot(12), 'unreliable');
      message(Uint8Array.of(255), 'reliable');
      close('late close must not replace the original reason');
      f.client.join();
      f.client.setReady(true);
      f.client.leave();
      f.loop.runUntil(2000);
      expect(observed(f.client)).toEqual(before);
      expect(f.sent).toHaveLength(sent);
      expect(f.loop.pending).toBe(0);
      expect(f.transport.onMessage).toBeNull();
      expect(f.transport.onClose).toBeNull();
    },
  );

  it('finishes local ownership even when sending leave fails', () => {
    const f = fixture(),
      failure = new Error('leave failed');
    f.start();
    f.loop.runUntil(10);
    f.setSend(() => {
      throw failure;
    });
    expect(() => f.client.leave()).toThrow(failure);
    expect(f.client.state).toBe('closed');
    expect(f.client.reason).toBe('left');
    expect(f.transport.onMessage).toBeNull();
    expect(f.transport.onClose).toBeNull();
    f.loop.runUntil(2000);
    expect(f.loop.pending).toBe(0);
  });

  it('retains callbacks installed by a replacement on the same transport', () => {
    const f = fixture();
    f.client.join();
    const stale = f.transport.onMessage!;
    const replacement = new RaceClient({ ...f.client.config, name: 'Replacement' });
    const currentMessage = f.transport.onMessage,
      currentClose = f.transport.onClose;
    f.client.dispose();
    f.client.dispose();
    expect(f.transport.onMessage).toBe(currentMessage);
    expect(f.transport.onClose).toBe(currentClose);
    f.deliver(welcome);
    expect(replacement.state).toBe('lobby');
    stale(encodeControl(grid), 'reliable');
    expect(f.client.state).toBe('closed');
    replacement.dispose();
    f.loop.runUntil(2000);
    expect(f.loop.pending).toBe(0);
  });

  it('does not send leave for a transport now owned by a replacement', () => {
    const f = fixture();
    f.client.join();
    const replacement = new RaceClient({ ...f.client.config, name: 'Replacement' });
    replacement.join();
    const sent = f.sent.length,
      current = f.transport.onMessage;
    f.client.leave();
    expect(f.client.state).toBe('closed');
    expect(f.sent).toHaveLength(sent);
    expect(f.transport.onMessage).toBe(current);
    f.deliver(welcome);
    expect(replacement.state).toBe('lobby');
    replacement.dispose();
    f.loop.runUntil(2000);
    expect(f.loop.pending).toBe(0);
  });

  it('does not issue a command after its input provider leaves the race', () => {
    const input = vi.fn(() => {
      client.leave();
      return { ...controls(), throttle: 1 };
    });
    const f = fixture({ input });
    const client = f.client;
    f.start();
    f.loop.runUntil(1000);
    expect(input).toHaveBeenCalledOnce();
    expect(client.state).toBe('closed');
    expect(client.commands.size).toBe(0);
    expect(client.stats.commands).toBe(0);
    expect(f.loop.pending).toBe(0);
  });

  it('does not finish an old input sample after the provider installs a replacement grid', () => {
    let replaced = false;
    const f = fixture({
      input: () => {
        if (!replaced) {
          replaced = true;
          f.deliver({ ...grid, events: [] });
          return { ...controls(), throttle: 1 };
        }
        return { ...controls(), brake: 1 };
      },
    });
    f.start();
    f.loop.runUntil(0);
    expect(f.client.stats.commands).toBe(1);
    expect(f.client.commands.at(f.client.commands.nextTick - 1)?.controls).toMatchObject({
      throttle: 0,
      brake: 1,
    });
    f.client.dispose();
    f.loop.runUntil(1000);
    expect(f.loop.pending).toBe(0);
  });

  it('retains completed results and their chunked lap times while stopping every timer', () => {
    const f = fixture();
    f.start();
    f.loop.runUntil(25);
    f.deliver({ kind: 'lapTimes', car: 0, from: 0, times: [61.5, 62] });
    f.deliver({ kind: 'results', results: { ...results, lapTimesSeparate: true } });
    const before = observed(f.client),
      sent = f.sent.length;
    expect(f.client.results?.classification[0].lapTimes).toEqual([61.5, 62]);
    const callback = f.transport.onMessage!;
    callback(encodeControl({ ...grid, events: [] }), 'reliable');
    callback(
      encodeControl({ kind: 'results', results: { ...results, recordDigest: 'ffffffff' } }),
      'reliable',
    );
    f.client.join();
    f.client.setReady(true);
    f.loop.runUntil(2000);
    expect(observed(f.client)).toEqual(before);
    expect(f.sent).toHaveLength(sent);
    expect(f.loop.pending).toBe(0);
    f.transport.close('session over');
    expect(f.client.state).toBe('results');
    expect(f.client.reason).toBe('session over');
    expect(f.client.results).toEqual(before.results);
    expect(f.transport.onMessage).toBeNull();
    expect(f.transport.onClose).toBeNull();
  });

  it('preserves the rejoin token for a new client process and retains content checks', () => {
    const first = fixture();
    first.start();
    const token = first.client.token;
    first.client.dispose();
    const next = fixture({ token });
    next.client.join();
    const sent = next.messages()[0];
    expect(sent.type).toBe('control');
    if (sent.type !== 'control') throw new Error('Expected join');
    expect(sent.control).toMatchObject({ kind: 'join', token });
    next.deliver(welcome);
    next.deliver({ ...grid, events: [] });
    expect(next.client.state).toBe('race');
    expect(next.client.needsKeepAlive).toBe(true);
    next.client.dispose();
    const mismatch = fixture();
    mismatch.client.join();
    mismatch.deliver({ ...grid, identity: { ...identity, circuitHash: '0badc0de' } });
    expect(mismatch.client.state).toBe('rejected');
    expect(mismatch.client.reason).toMatch(/cannot present this field/);
    expect(
      mismatch
        .messages()
        .some((message) => message.type === 'control' && message.control.kind === 'leave'),
    ).toBe(true);
    mismatch.client.dispose();
    for (const f of [first, next, mismatch]) {
      f.loop.runUntil(2000);
      expect(f.loop.pending).toBe(0);
    }
  });
});
