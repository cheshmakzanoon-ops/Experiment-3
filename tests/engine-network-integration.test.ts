import { describe, expect, it, vi } from 'vitest';
import { decodeServerMessage, encodeControl } from '../src/net/codec.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import { onlineFixture } from './net-helpers.ts';

describe('network service ownership across real codec delivery', () => {
  it.each(['after', 'during'] as const)(
    'rejects a new transport %s teardown without registering another owner',
    (when) => {
      const f = onlineFixture({
        server: {
          onPhase: (phase) => {
            if (phase === 'teardown' && when === 'during') accept();
          },
        },
      });
      const pair = f.net.connect(PERFECT_LINK);
      const observed: string[] = [];
      pair.client.onMessage = (data, channel) => {
        const decoded = decodeServerMessage(data, channel);
        expect(decoded.ok).toBe(true);
        if (
          decoded.ok &&
          decoded.value.type === 'control' &&
          decoded.value.control.kind === 'reject'
        )
          observed.push(decoded.value.control.reason);
      };
      pair.client.onClose = (reason) => observed.push(reason);
      function accept() {
        f.server.accept(pair.server);
      }
      f.server.teardown();
      if (when === 'after') accept();
      expect(pair.server.open).toBe(false);
      expect(pair.server.onMessage).toBeNull();
      expect(pair.server.onClose).toBeNull();
      expect(f.server.stats.connections).toBe(0);
      f.loop.runUntil(10000);
      expect(observed).toEqual(['the session has already started', 'session over']);
      expect(pair.client.open).toBe(false);
      expect(f.loop.pending).toBe(0);
    },
  );

  it('attempts terminal transport cleanup when rejection send throws, preserving its first value', () => {
    for (const closeFails of [false, true]) {
      const f = onlineFixture();
      const pair = f.net.connect(PERFECT_LINK);
      f.server.teardown();
      const originalClose = pair.server.close.bind(pair.server);
      const close = vi.spyOn(pair.server, 'close').mockImplementation((reason) => {
        if (closeFails) throw new Error('close also failed');
        originalClose(reason);
      });
      const send = vi.spyOn(pair.server, 'send').mockImplementation(() => {
        throw undefined;
      });
      let failed = false;
      let failure: unknown = 'no failure';
      try {
        try {
          f.server.accept(pair.server);
        } catch (error) {
          failed = true;
          failure = error;
        }
        expect(failed).toBe(true);
        expect(failure).toBeUndefined();
        expect(close).toHaveBeenCalledExactlyOnceWith('session over');
        expect(pair.server.open).toBe(closeFails);
        expect(pair.server.onMessage).toBeNull();
        expect(pair.server.onClose).toBeNull();
        expect(f.server.stats.connections).toBe(0);
      } finally {
        send.mockRestore();
        close.mockRestore();
        pair.server.close('fixture cleanup');
        f.loop.runUntil(10000);
      }
      expect(f.loop.pending).toBe(0);
    }
  });

  it.each(['grid', 'race', 'results'] as const)(
    'honors terminal teardown requested by the %s phase observer',
    (terminalPhase) => {
      const f: ReturnType<typeof onlineFixture> = onlineFixture({
        capacity: 1,
        link: PERFECT_LINK,
        server: {
          maxTicks: 1,
          timeouts: { gridCountdownMs: 1 },
          onPhase: (phase) => {
            if (phase === terminalPhase) f.server.teardown();
          },
        },
      });
      const { client, transport } = f.connect('Observer');
      try {
        // Includes the original join deadline and all close deliveries. A
        // repeating callback installed after teardown would remain queued.
        f.loop.runUntil(10000);
        const expected = ['lobby', 'grid'];
        if (terminalPhase !== 'grid') expected.push('race');
        if (terminalPhase === 'results') expected.push('results');
        expected.push('teardown');
        expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual(expected);
        expect(f.server.phase).toBe('teardown');
        expect(f.server.record).toBeNull();
        expect(f.server.results).toBeNull();
        expect(client.state).toBe('closed');
        expect(transport.open).toBe(false);
        expect(f.loop.pending).toBe(0);
        // Avoid serializing an entire physics world if the ownership check
        // fails while exercising the preceding implementation.
        if (terminalPhase === 'grid') expect(f.server.world === null).toBe(true);
        else expect(f.server.world?.tick).toBe(terminalPhase === 'race' ? 0 : 1);
      } finally {
        client.dispose();
        f.server.teardown();
      }
    },
  );

  it('does not revive results after the final tick observer tears down the race', () => {
    const f: ReturnType<typeof onlineFixture> = onlineFixture({
      capacity: 1,
      link: PERFECT_LINK,
      server: {
        maxTicks: 1,
        timeouts: { gridCountdownMs: 1 },
        onTick: () => f.server.teardown(),
      },
    });
    const { client } = f.connect('Final tick');
    try {
      f.loop.runUntil(10000);
      expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual([
        'lobby',
        'grid',
        'race',
        'teardown',
      ]);
      expect(f.server.world?.tick).toBe(1);
      expect(f.server.results).toBeNull();
      expect(f.server.record).toBeNull();
      expect(client.results).toBeNull();
      expect(client.state).toBe('closed');
      expect(f.loop.pending).toBe(0);
    } finally {
      client.dispose();
      f.server.teardown();
    }
  });

  it('retires local owners and preserves an undefined observer error through a later close error', () => {
    const closeError = new Error('first transport close failed');
    const f: ReturnType<typeof onlineFixture> = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      server: {
        onPhase: (phase) => {
          if (phase !== 'teardown') return;
          f.server.teardown(); // A repeated terminal call cannot recurse.
          throw undefined;
        },
      },
    });
    const first = f.connect('First', { autoReady: false });
    const second = f.connect('Second', { autoReady: false });
    f.loop.runUntil(20);
    const oldReceive = second.link.server.onMessage!;
    const close = vi.spyOn(first.link.server, 'close').mockImplementation(() => {
      throw closeError;
    });
    let threw = false;
    let failure: unknown = 'no failure';
    try {
      try {
        f.server.teardown();
      } catch (error) {
        threw = true;
        failure = error;
      }
      expect(threw).toBe(true);
      expect(failure).toBeUndefined();
      expect(close).toHaveBeenCalledExactlyOnceWith('session over');
      expect(first.link.server.open).toBe(true); // External close did fail.
      expect(second.link.server.open).toBe(false);
      expect(() => f.server.teardown()).not.toThrow();
      const delivered = second.link.downStats.packets;
      oldReceive(encodeControl({ kind: 'ping', t: 20 }), 'reliable');
      expect(second.link.downStats.packets).toBe(delivered);
      first.client.dispose();
      f.loop.runUntil(10000);
      expect(second.client.state).toBe('closed');
      expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual(['lobby', 'teardown']);
      expect(f.loop.pending).toBe(0);
    } finally {
      close.mockRestore();
      first.client.dispose();
      second.client.dispose();
      first.link.server.close('fixture cleanup');
    }
  });

  it('attempts every independent close after the first close throws', () => {
    const f = onlineFixture({ capacity: 2, link: PERFECT_LINK });
    const first = f.connect('First', { autoReady: false });
    const second = f.connect('Second', { autoReady: false });
    f.loop.runUntil(20);
    const error = new Error('close refused');
    const close = vi.spyOn(first.link.server, 'close').mockImplementation(() => {
      throw error;
    });
    try {
      expect(() => f.server.teardown()).toThrow(error);
      expect(first.link.server.open).toBe(true);
      expect(second.link.server.open).toBe(false);
      const sent = first.link.downStats.packets;
      first.transport.send(encodeControl({ kind: 'ping', t: 20 }), 'reliable');
      f.loop.runUntil(20);
      expect(first.link.downStats.packets).toBe(sent);
      first.client.dispose();
      f.loop.runUntil(10000);
      expect(second.client.state).toBe('closed');
      expect(f.loop.pending).toBe(0);
      expect(f.server.stats.phases.map(({ phase }) => phase)).toEqual(['lobby', 'teardown']);
    } finally {
      close.mockRestore();
      first.client.dispose();
      second.client.dispose();
      first.link.server.close('fixture cleanup');
    }
  });

  it('expires a completely lost join without blocking a healthy lobby connection', () => {
    const f = onlineFixture({ capacity: 2, link: PERFECT_LINK });
    const good = f.connect('Healthy', { autoReady: false });
    const lost = f.connect('Lost', {
      autoReady: false,
      link: { ...PERFECT_LINK, loss: 1 },
    });
    // The return direction remains healthy so the real server timeout can
    // retire both the delayed join and the client's keep-alive backlog.
    lost.link.server.conditions.loss = 0;
    try {
      f.loop.runUntil(6000);
      expect(f.server.phase).toBe('lobby');
      expect(f.lobby.members.map(({ name }) => name)).toEqual(['Healthy']);
      expect(good.client.state).toBe('lobby');
      expect(good.client.pingRttMs).toBe(0);
      expect(lost.client.state).toBe('closed');
      expect(lost.client.reason).toBe('no join received');
      expect(lost.transport.open).toBe(false);
      // At the 5 s timeout, an already queued 5 s keep-alive may start one
      // final bounded batch before the peer's close notification is delivered.
      const attempted = lost.link.upStats.retransmits;
      expect(attempted).toBeGreaterThan(0);
      expect(attempted).toBeLessThanOrEqual(128);
      expect(f.server.stats.invalidMessages).toBe(0);
      expect(f.server.stats.rateLimited).toBe(0);
      f.loop.runUntil(20000);
      expect(lost.link.upStats.retransmits).toBe(attempted);
      expect(f.lobby.members.map(({ name }) => name)).toEqual(['Healthy']);
      expect(good.client.state).toBe('lobby');
      expect(lost.client.state).toBe('closed');
    } finally {
      good.client.dispose();
      lost.client.dispose();
      f.server.teardown();
    }
    f.loop.runUntil(30000);
    expect(f.loop.pending).toBe(0);
  });

  it('delivers loss-delayed results before graceful close after server teardown', () => {
    const f = onlineFixture({
      capacity: 1,
      link: PERFECT_LINK,
      server: {
        maxTicks: 12,
        timeouts: { gridCountdownMs: 1, resultsLingerMs: 25 },
      },
    });
    const { client, link, transport } = f.connect('Delayed results');
    try {
      f.loop.runUntil(50);
      expect(client.state).toBe('race');
      expect(client.stats.snapshots).toBeGreaterThan(0);
      link.server.conditions.loss = 1;
      f.loop.runUntil(200);
      expect(f.server.phase).toBe('teardown');
      expect(f.server.results).not.toBeNull();
      expect(client.results).toBeNull();
      expect(link.server.open).toBe(false);
      expect(transport.open).toBe(true);
      expect(link.downStats.retransmits).toBe(64);
      link.server.conditions.loss = 0;
      f.loop.runUntil(14000);
      expect(client.results).toEqual(f.server.results);
      expect(client.results?.recordDigest).toBe(f.server.record?.digest);
      expect(client.reason).toBe('session over');
      expect(client.state).toBe('results');
      expect(transport.open).toBe(false);
      expect(link.server.open).toBe(false);
      expect(f.loop.pending).toBe(0);
      const tick = f.server.world?.tick,
        snapshots = client.stats.snapshots;
      f.loop.runUntil(20000);
      expect(f.server.world?.tick).toBe(tick);
      expect(client.stats.snapshots).toBe(snapshots);
      expect(client.state).toBe('results');
      expect(f.loop.pending).toBe(0);
    } finally {
      client.dispose();
      f.server.teardown();
    }
  });
});
