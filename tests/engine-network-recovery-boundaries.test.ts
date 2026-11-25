import { describe, expect, it } from 'vitest';
import { encodeControl } from '../src/net/codec.ts';
import { CAR_FLAG } from '../src/net/snapshot.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import { onlineFixture } from './net-helpers.ts';

describe('voluntary departure at the real network recovery boundary', () => {
  it('keeps a deliberately forfeited token retired while the other client continues racing', () => {
    const f = onlineFixture({
      capacity: 2,
      link: PERFECT_LINK,
      raceSeconds: 60,
      server: {
        disconnectPolicy: 'ghost',
        timeouts: { gridCountdownMs: 1 },
      },
    });
    const original = f.connect('Departing driver');
    const healthy = f.connect('Continuing driver');
    let replacement: ReturnType<typeof f.connect> | undefined;
    try {
      f.loop.runUntil(100);
      expect(original.client.state).toBe('race');
      expect(healthy.client.state).toBe('race');
      const { token, car } = original.client;
      const oldReceive = original.link.server.onMessage!;
      const oldClose = original.link.server.onClose!;
      expect(token).not.toBe('');
      expect(car).toBe(0);

      // This is an intentional race exit, unlike process disposal followed by
      // transport loss. The public client must send the real leave control.
      original.client.leave();
      f.loop.runUntil(100);

      expect(original.client.state).toBe('closed');
      expect(original.client.reason).toBe('left');
      expect(original.transport.open).toBe(false);
      expect(original.link.server.onMessage).toBeNull();
      expect(original.link.server.onClose).toBeNull();
      expect(f.server.playerByCar(car)).toMatchObject({
        token,
        connected: false,
        mode: 'ai',
      });
      expect(f.server.stats.takeovers).toHaveLength(1);
      expect(f.server.stats.takeovers[0]).toMatchObject({
        car,
        at: 100,
        reason: 'left the session',
      });

      // Retained callbacks from the departed connection cannot produce an
      // additional departure or return ownership to the forfeited player.
      oldReceive(encodeControl({ kind: 'leave' }), 'reliable');
      oldReceive(encodeControl({ kind: 'ping', t: 100 }), 'reliable');
      oldClose('late departed callback');
      replacement = f.connect('Attempted recovery', { token });
      f.loop.runUntil(100);

      expect(replacement.client.state).toBe('rejected');
      expect(replacement.client.reason).toBe('unknown or forfeited session token');
      expect(replacement.client.car).toBe(-1);
      expect(replacement.transport.open).toBe(false);
      expect(replacement.link.server.onMessage).toBeNull();
      expect(replacement.link.server.onClose).toBeNull();
      expect(f.server.stats.rejoins).toEqual([]);
      expect(f.server.stats.takeovers).toHaveLength(1);
      expect(f.server.stats.rejectedJoins).toEqual([
        { reason: 'unknown or forfeited session token', at: 100 },
      ]);

      const before = healthy.client.lastSnapshotTick;
      f.loop.runUntil(350);
      expect(healthy.client.state).toBe('race');
      expect(healthy.client.lastSnapshotTick).toBeGreaterThan(before);
      expect(healthy.client.commands.ackSeq).toBeGreaterThanOrEqual(0);
      expect(healthy.client.carState(car)!.flags & CAR_FLAG.GHOST).toBe(CAR_FLAG.GHOST);
      expect(healthy.client.carState(car)!.flags & CAR_FLAG.AI).toBe(CAR_FLAG.AI);
      expect(f.server.playerByCar(car)).toMatchObject({ connected: false, mode: 'ai' });
      expect(f.server.stats.invalidMessages).toBe(0);
      expect(f.server.stats.transportErrorCount).toBe(0);
      expect(f.server.stats.kicks).toEqual([]);
      expect(healthy.client.stats.invalidMessages).toBe(0);
    } finally {
      original.client.dispose();
      healthy.client.dispose();
      replacement?.client.dispose();
      f.server.teardown();
      f.loop.runUntil(f.loop.now);
    }
  });
});
