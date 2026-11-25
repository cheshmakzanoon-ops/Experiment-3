import { describe, expect, it, vi } from 'vitest';
import { decodeServerMessage, encodeControl } from '../src/net/codec.ts';
import { NET_PROTOCOL_VERSION } from '../src/net/constants.ts';
import type { EventLoop } from '../src/net/event-loop.ts';
import type { ClientControl, ServerControl } from '../src/net/messages.ts';
import type { RaceServer } from '../src/net/server.ts';
import { PERFECT_LINK, type Transport } from '../src/net/transport.ts';
import { onlineFixture } from './net-helpers.ts';

/** Cancelled heap slots deliberately remain pending; only fn retains work. */
function queued(loop: EventLoop) {
  return (loop as unknown as { heap: { time: number; fn: (() => void) | null }[] }).heap;
}
const liveCallbacks = (loop: EventLoop) => queued(loop).filter((event) => event.fn !== null);

function peer(label = 'peer') {
  const messages: ServerControl[] = [];
  let open = true;
  const transport: Transport = {
    label,
    get open() {
      return open;
    },
    onMessage: null,
    onClose: null,
    send: vi.fn((data, channel) => {
      const decoded = decodeServerMessage(data, channel);
      if (!decoded.ok) throw new Error(decoded.reason);
      if (decoded.value.type === 'control') messages.push(decoded.value.control);
    }),
    close: vi.fn((reason) => {
      open = false;
      transport.onClose?.(reason);
    }),
  };
  return { transport, messages };
}

function control(transport: Transport, message: ClientControl) {
  transport.onMessage!(encodeControl(message), 'reliable');
}

function join(server: RaceServer, connection: ReturnType<typeof peer>, token?: string) {
  control(connection.transport, {
    kind: 'join',
    net: NET_PROTOCOL_VERSION,
    name: connection.transport.label,
    vehicle: 'apx01',
    identity: server.expectedIdentity('apx01'),
    ...(token ? { token } : {}),
  });
  const welcome = connection.messages.find((message) => message.kind === 'welcome');
  if (!welcome || welcome.kind !== 'welcome') throw new Error('Expected successful join');
  return welcome;
}

describe('server one-shot deadlines and transport callback ownership', () => {
  it('immediately releases a silent join deadline and handlers while preserving graceful close', () => {
    const f = onlineFixture({ server: { autoStart: false } });
    const pair = f.net.connect(PERFECT_LINK);
    const closed = vi.fn();
    pair.client.onClose = closed;
    f.server.accept(pair.server);
    const deadlines = [...queued(f.loop)];
    expect(liveCallbacks(f.loop)).toHaveLength(2); // Sweep and join deadline.

    f.server.teardown();

    expect(deadlines.every((event) => event.fn === null)).toBe(true);
    expect(pair.server.onMessage).toBeNull();
    expect(pair.server.onClose).toBeNull();
    // Only graceful transport delivery remains, and it runs at the same instant.
    f.loop.runUntil(0);
    expect(closed).toHaveBeenCalledExactlyOnceWith('session over');
    expect(liveCallbacks(f.loop)).toHaveLength(0);
    expect(f.loop.pending).toBe(2);
  });

  it('cancels a successful join deadline before publishing welcome', () => {
    const f = onlineFixture({ server: { autoStart: false } });
    const connection = peer();
    f.server.accept(connection.transport);
    const deadline = queued(f.loop).find((event) => event.time === f.server.timeouts.joinMs)!;
    const send = connection.transport.send;
    connection.transport.send = vi.fn((data, channel) => {
      expect(deadline.fn).toBeNull();
      send(data, channel);
    });

    join(f.server, connection);

    expect(connection.messages.map((message) => message.kind)).toEqual(['welcome', 'lobby']);
    expect(liveCallbacks(f.loop)).toHaveLength(1);
    expect(connection.transport.onMessage).toBeTypeOf('function');
    expect(connection.transport.onClose).toBeTypeOf('function');
    f.server.teardown();
    expect(liveCallbacks(f.loop)).toHaveLength(0);
  });

  it.each(['loss', 'leave', 'rejected join', 'join timeout'] as const)(
    'releases a silent connection immediately after %s and ignores saved callbacks',
    (reason) => {
      const f = onlineFixture({ server: { autoStart: false, timeouts: { joinMs: 1000 } } });
      const connection = peer();
      f.server.accept(connection.transport);
      const receive = connection.transport.onMessage!;
      const closed = connection.transport.onClose!;
      const close = connection.transport.close;
      connection.transport.close = vi.fn((message) => {
        expect(connection.transport.onMessage).toBeNull();
        expect(connection.transport.onClose).toBeNull();
        expect(liveCallbacks(f.loop)).toHaveLength(1); // The server's sweep only.
        close(message);
      });

      if (reason === 'loss') closed('peer shutdown');
      else if (reason === 'leave') control(connection.transport, { kind: 'leave' });
      else if (reason === 'join timeout') f.loop.runUntil(1000);
      else
        control(connection.transport, {
          kind: 'join',
          net: NET_PROTOCOL_VERSION + 1,
          name: 'Invalid protocol',
          vehicle: 'apx01',
          identity: f.server.expectedIdentity('apx01'),
        });

      expect(connection.transport.onMessage).toBeNull();
      expect(connection.transport.onClose).toBeNull();
      expect(liveCallbacks(f.loop)).toHaveLength(1);
      expect(connection.transport.close).toHaveBeenCalledTimes(reason === 'loss' ? 0 : 1);
      const sent = connection.messages.length;
      receive(encodeControl({ kind: 'ping', t: 1 }), 'reliable');
      closed('late old notification');
      expect(connection.messages).toHaveLength(sent);
      f.server.teardown();
      expect(liveCallbacks(f.loop)).toHaveLength(0);
    },
  );

  it('releases join ownership before containing both send and close failures', () => {
    const f = onlineFixture({ server: { autoStart: false } });
    const connection = peer();
    const closeFailure = new Error('close failed');
    f.server.accept(connection.transport);
    connection.transport.send = () => {
      throw undefined;
    };
    connection.transport.close = vi.fn(() => {
      expect(connection.transport.onMessage).toBeNull();
      expect(connection.transport.onClose).toBeNull();
      expect(liveCallbacks(f.loop)).toHaveLength(1);
      throw closeFailure;
    });

    expect(() => control(connection.transport, { kind: 'ping', t: 1 })).not.toThrow();

    expect(connection.transport.close).toHaveBeenCalledOnce();
    expect(f.server.stats.transportErrors.map(({ error }) => error)).toEqual([
      undefined,
      closeFailure,
    ]);
    const healthy = peer('Healthy');
    f.server.accept(healthy.transport);
    join(f.server, healthy);
    f.server.teardown();
    expect(liveCallbacks(f.loop)).toHaveLength(0);
  });

  it.each(['grid', 'results'] as const)(
    'releases a live %s deadline before shutdown observers without draining its due time',
    (phase) => {
      let observe = () => {};
      const f = onlineFixture({
        capacity: 1,
        server: {
          autoStart: false,
          maxTicks: 1,
          timeouts: {
            joinMs: 120000,
            gridCountdownMs: phase === 'grid' ? 60000 : 1,
            resultsLingerMs: 60000,
          },
          onPhase: (next) => {
            if (next === 'teardown') observe();
          },
        },
      });
      const connection = peer();
      f.server.accept(connection.transport);
      join(f.server, connection);
      control(connection.transport, { kind: 'ready', ready: true });
      f.server.startGrid();
      if (phase === 'results') f.loop.runUntil(1);
      expect(f.server.phase).toBe(phase);
      expect(liveCallbacks(f.loop)).toHaveLength(2);
      const deadline = liveCallbacks(f.loop).find((event) => event.time > 1000)!;
      const staleDeadline = deadline.fn!;
      const tick = f.server.world!.tick;
      observe = () => {
        expect(liveCallbacks(f.loop)).toHaveLength(0);
        expect(connection.transport.onMessage).toBeNull();
        expect(connection.transport.onClose).toBeNull();
      };

      f.server.teardown();

      expect(deadline.fn).toBeNull();
      expect(liveCallbacks(f.loop)).toHaveLength(0);
      expect(f.loop.pending).toBeGreaterThan(0);
      staleDeadline();
      expect(f.server.phase).toBe('teardown');
      expect(f.server.world!.tick).toBe(tick);
      expect(f.server.stats.phases.filter((entry) => entry.phase === 'teardown')).toHaveLength(1);
    },
  );

  it('releases every peer before a throwing phase observer and continues past a throwing close', () => {
    const phaseFailure = new Error('observer failed');
    const closeFailure = new Error('first close failed');
    let observe = () => {};
    const f = onlineFixture({
      server: {
        autoStart: false,
        onPhase: (phase) => {
          if (phase === 'teardown') observe();
        },
      },
    });
    const first = peer('Joined');
    const second = peer('Silent');
    f.server.accept(first.transport);
    join(f.server, first);
    f.server.accept(second.transport);
    const order: string[] = [];
    const released = () => {
      expect(liveCallbacks(f.loop)).toHaveLength(0);
      for (const connection of [first, second]) {
        expect(connection.transport.onMessage).toBeNull();
        expect(connection.transport.onClose).toBeNull();
      }
    };
    observe = () => {
      released();
      order.push('phase');
      throw phaseFailure;
    };
    first.transport.close = vi.fn(() => {
      released();
      order.push('first');
      throw closeFailure;
    });
    second.transport.close = vi.fn(() => {
      released();
      order.push('second');
    });

    expect(() => f.server.teardown()).toThrow(phaseFailure);

    expect(order).toEqual(['phase', 'first', 'second']);
    expect(f.server.phase).toBe('teardown');
    expect(liveCallbacks(f.loop)).toHaveLength(0);
    expect(() => f.server.teardown()).not.toThrow();
    expect(first.transport.close).toHaveBeenCalledOnce();
    expect(second.transport.close).toHaveBeenCalledOnce();
  });

  it('rejoins before old cleanup, releases both deadlines, and survives stale and throwing old callbacks', () => {
    const f = onlineFixture({
      capacity: 1,
      server: {
        autoStart: false,
        timeouts: { joinMs: 120000, gridCountdownMs: 60000, disconnectMs: 50 },
      },
    });
    const original = peer('Original');
    f.server.accept(original.transport);
    const welcome = join(f.server, original);
    control(original.transport, { kind: 'ready', ready: true });
    f.server.startGrid();
    f.loop.runUntil(51); // Holder is stale, before the sweep retires it.
    const retiredReceive = original.transport.onMessage!;
    const retiredClose = original.transport.onClose!;
    const replacement = peer('Replacement');
    f.server.accept(replacement.transport);
    const closeFailure = new Error('old close failed');
    const newerReceive = vi.fn();
    const newerClose = vi.fn();
    original.transport.close = vi.fn(() => {
      expect(original.transport.onMessage).toBeNull();
      expect(original.transport.onClose).toBeNull();
      expect(liveCallbacks(f.loop)).toHaveLength(2); // Sweep and countdown only.
      expect(f.server.playerByCar(0)).toMatchObject({ connected: true, mode: 'ai' });
      retiredReceive(encodeControl({ kind: 'leave' }), 'reliable');
      retiredClose('late old close');
      original.transport.onMessage = newerReceive;
      original.transport.onClose = newerClose;
      throw closeFailure;
    });

    const rejoined = join(f.server, replacement, welcome.token);

    expect(rejoined.player).toBe(welcome.player);
    expect(f.server.stats.rejoins).toHaveLength(1);
    expect(f.server.stats.takeovers).toHaveLength(0);
    expect(f.server.stats.transportErrors.map(({ error }) => error)).toEqual([closeFailure]);
    expect(replacement.messages.map((message) => message.kind)).toEqual(['welcome', 'grid']);
    expect(original.transport.onMessage).toBe(newerReceive);
    expect(original.transport.onClose).toBe(newerClose);
    f.server.teardown();
    expect(liveCallbacks(f.loop)).toHaveLength(0);
    expect(original.transport.onMessage).toBe(newerReceive);
    expect(original.transport.onClose).toBe(newerClose);
    expect(replacement.transport.onMessage).toBeNull();
    expect(replacement.transport.onClose).toBeNull();
  });

  it('does not detach or close a transport already owned by a newer server', () => {
    const older = onlineFixture({ server: { autoStart: false } });
    const newer = onlineFixture({ server: { autoStart: false } });
    const connection = peer();
    older.server.accept(connection.transport);
    const oldReceive = connection.transport.onMessage!;
    const oldClose = connection.transport.onClose!;
    newer.server.accept(connection.transport);
    join(newer.server, connection);
    const receive = connection.transport.onMessage;
    const close = connection.transport.onClose;

    older.server.teardown();
    oldReceive(encodeControl({ kind: 'leave' }), 'reliable');
    oldClose('retired transport owner');

    expect(liveCallbacks(older.loop)).toHaveLength(0);
    expect(connection.transport.onMessage).toBe(receive);
    expect(connection.transport.onClose).toBe(close);
    expect(connection.transport.close).not.toHaveBeenCalled();
    expect(connection.transport.open).toBe(true);
    control(connection.transport, { kind: 'ping', t: 19 });
    expect(connection.messages.at(-1)).toMatchObject({ kind: 'pong', t: 19 });
    newer.server.teardown();
    expect(connection.transport.close).toHaveBeenCalledOnce();
    expect(liveCallbacks(newer.loop)).toHaveLength(0);
  });

  it.each(['phase observer', 'earlier peer close'] as const)(
    'preserves an owner installed after detachment by a %s',
    (boundary) => {
      let observe = () => {};
      const older = onlineFixture({
        server: {
          autoStart: false,
          onPhase: (phase) => {
            if (phase === 'teardown') observe();
          },
        },
      });
      const newer = onlineFixture({ server: { autoStart: false } });
      const first = peer('First');
      const shared = peer('Shared');
      older.server.accept(first.transport);
      older.server.accept(shared.transport);
      const replace = () => {
        expect(liveCallbacks(older.loop)).toHaveLength(0);
        expect(shared.transport.onMessage).toBeNull();
        expect(shared.transport.onClose).toBeNull();
        newer.server.accept(shared.transport);
      };
      if (boundary === 'phase observer') observe = replace;
      else first.transport.close = vi.fn(replace);

      older.server.teardown();

      expect(first.transport.close).toHaveBeenCalledOnce();
      expect(shared.transport.close).not.toHaveBeenCalled();
      expect(shared.transport.open).toBe(true);
      join(newer.server, shared);
      expect(liveCallbacks(newer.loop)).toHaveLength(1);
      newer.server.teardown();
      expect(shared.transport.close).toHaveBeenCalledOnce();
      expect(shared.transport.onMessage).toBeNull();
      expect(shared.transport.onClose).toBeNull();
      expect(liveCallbacks(newer.loop)).toHaveLength(0);
    },
  );
});
