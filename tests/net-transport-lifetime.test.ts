import { describe, expect, it, vi } from 'vitest';
import { EventLoop, NetRandom } from '../src/net/event-loop.ts';
import { NetworkSimulator as ReferenceNetworkSimulator } from './helpers/reference-net-transport.ts';
import {
  NetworkSimulator,
  PERFECT_LINK,
  SimulatedLink,
  TARGET_LINK,
  type LinkConditions,
} from '../src/net/transport.ts';

function held(loss = 1) {
  const loop = new EventLoop();
  let draws = 0;
  const random = new NetRandom(1);
  vi.spyOn(random, 'gaussian').mockReturnValue(0);
  vi.spyOn(random, 'next').mockImplementation(() => {
    // Fail promptly on the original unbounded loop instead of hanging Vitest.
    if (++draws > 256) throw new Error('retry work exceeded one caller turn');
    return 0.5;
  });
  const link = new SimulatedLink(
    loop,
    random,
    { ...PERFECT_LINK, latencyMs: 5, loss },
    PERFECT_LINK,
    'held',
  );
  return { loop, link, random, draws: () => draws };
}

function normalTrace(seed: number, loss: number, reference = false) {
  const loop = new EventLoop();
  const net = reference
    ? new ReferenceNetworkSimulator(loop, seed)
    : new NetworkSimulator(loop, seed);
  const conditions = { ...TARGET_LINK, loss, duplicate: 0.03, reorder: 0.07 };
  const { client, server, link } = net.connect(conditions);
  const seen: unknown[] = [];
  client.onMessage = (data, channel) => seen.push(['client', loop.now, channel, [...data]]);
  server.onMessage = (data, channel) => seen.push(['server', loop.now, channel, [...data]]);
  server.onClose = (reason) => seen.push(['close', loop.now, reason]);
  for (let i = 0; i < 160; i++) {
    loop.at(i * 7, () => {
      const data = new Uint8Array([i, i ^ 117]);
      (i % 3 ? client : server).send(data, i % 5 ? 'reliable' : 'unreliable');
      data.fill(255); // Sending owns a copy, including before delayed retries.
    });
  }
  loop.at(1200, () => client.close('finished'));
  loop.runUntil(100000);
  return { seen, up: link.upStats, down: link.downStats, open: server.open };
}

// Compare the frozen algorithm in the same runtime so every floating arrival
// time remains exact without pinning a platform-specific math implementation.
const traces = [1, 7, 91, 334].flatMap((seed) =>
  [0, 0.02, 0.2, 0.8].map((loss) => [seed, loss] as const),
);

describe('simulated transport retry ownership', () => {
  it.each([1, 1 - Number.EPSILON])(
    'yields under sustained loss %s without blocking the scheduler',
    (loss) => {
      const { loop, link, draws } = held(loss);
      const received = vi.fn();
      link.server.onMessage = received;
      expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
      expect(draws()).toBeLessThanOrEqual(64);
      expect(link.upStats.retransmits).toBe(64);
      const independent = vi.fn();
      loop.at(100, independent);
      loop.runUntil(1000);
      expect(independent).toHaveBeenCalledOnce();
      expect(received).not.toHaveBeenCalled();
      expect(draws()).toBe(64);
      expect(link.server.open).toBe(true);
    },
  );

  it('bounds every retry continuation and keeps a permanently lost stream silent', () => {
    const { loop, link, random } = held();
    let draws = 0;
    vi.mocked(random.next).mockImplementation(() => {
      draws++;
      return 0;
    });
    const work: number[] = [];
    const at = loop.at.bind(loop);
    vi.spyOn(loop, 'at').mockImplementation((time, callback) =>
      at(time, () => {
        const before = draws;
        callback();
        work.push(draws - before);
      }),
    );
    const received = vi.fn();
    link.server.onMessage = received;
    // The original source is checked with a bounded scripted RNG in the cases
    // above; this case runs only after that guard has made the new path concrete.
    let initial = 0;
    vi.mocked(random.next).mockImplementation(() => {
      draws++;
      if (++initial > 256) throw new Error('unbounded initial retry loop');
      return 0;
    });
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    vi.mocked(random.next).mockImplementation(() => {
      draws++;
      return 0;
    });
    loop.runUntil(100000);
    expect(work.length).toBeGreaterThan(4);
    expect(work.every((n) => n <= 64)).toBe(true);
    expect(received).not.toHaveBeenCalled();
    expect(link.upStats.retransmits).toBe(draws);
    expect(link.upStats.wireBytes).toBe(29 * (draws + 1));
  });

  it('recovers an ordered backlog without aliasing payloads or blocking the reverse direction', () => {
    const { loop, link } = held();
    const incoming: number[] = [],
      outgoing: number[] = [];
    link.server.onMessage = (data) => incoming.push(data[0]);
    link.client.onMessage = (data) => outgoing.push(data[0]);
    const payload = new Uint8Array([1]);
    expect(() => link.client.send(payload, 'reliable')).not.toThrow();
    payload[0] = 99;
    link.client.send(new Uint8Array([2]), 'reliable');
    link.server.send(new Uint8Array([3]), 'reliable');
    loop.runUntil(1000);
    expect(incoming).toEqual([]);
    expect(outgoing).toEqual([3]);
    link.client.conditions.loss = 0;
    loop.runUntil(20000);
    expect(incoming).toEqual([1, 2]);
    expect(link.upStats).toMatchObject({ packets: 2, retransmits: 64, delivered: 2 });
  });

  it('drains queued reliable packets before graceful close and refuses later sends', () => {
    const { loop, link } = held();
    const seen: (number | string)[] = [];
    link.server.onMessage = (data) => seen.push(data[0]);
    link.server.onClose = (reason) => seen.push(reason);
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    link.client.send(new Uint8Array([2]), 'reliable');
    link.client.close('done');
    link.client.send(new Uint8Array([3]), 'reliable');
    loop.runUntil(1000);
    expect(seen).toEqual([]);
    expect(link.server.open).toBe(true);
    link.client.conditions.loss = 0;
    loop.runUntil(20000);
    expect(seen).toEqual([1, 2, 'done']);
    expect(link.client.open).toBe(false);
    expect(link.server.open).toBe(false);
    expect(link.upStats.packets).toBe(2);
  });

  it('severing abandons deferred ownership and never revives it after reconnection', () => {
    const { loop, link, draws } = held();
    const seen: number[] = [];
    link.server.onMessage = (data) => seen.push(data[0]);
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    link.client.send(new Uint8Array([2]), 'reliable');
    link.sever();
    const atSever = draws();
    loop.runUntil(50000);
    expect(draws()).toBe(atSever);
    link.severed = false;
    link.client.conditions.loss = 0;
    link.client.send(new Uint8Array([3]), 'reliable');
    loop.runUntil(100000);
    expect(seen).toEqual([3]);
  });

  it('a peer closing retires retries destined for that closed endpoint', () => {
    const { loop, link, draws } = held();
    const received = vi.fn();
    link.server.onMessage = received;
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    const attempted = draws();
    link.server.close('gone');
    loop.runUntil(100000);
    expect(draws()).toBe(attempted);
    expect(received).not.toHaveBeenCalled();
    expect(link.client.open).toBe(false);
  });

  it('a severed link drops a close notification that was already in flight', () => {
    const loop = new EventLoop();
    const { client, server, link } = new NetworkSimulator(loop).connect({
      ...PERFECT_LINK,
      latencyMs: 100,
    });
    const closed = vi.fn();
    server.onClose = closed;
    client.close('left');
    loop.runUntil(50);
    link.sever();
    loop.runUntil(1000);
    expect(closed).not.toHaveBeenCalled();
    expect(server.open).toBe(true);
  });

  it('receiver mutation cannot change a separately delivered duplicate', () => {
    const loop = new EventLoop(),
      random = new NetRandom(1);
    vi.spyOn(random, 'gaussian').mockReturnValue(0);
    vi.spyOn(random, 'next').mockReturnValue(0);
    const link = new SimulatedLink(
      loop,
      random,
      { ...PERFECT_LINK, duplicate: 1 },
      PERFECT_LINK,
      'copy',
    );
    const received: number[] = [];
    link.server.onMessage = (data) => {
      received.push(data[0]);
      data[0] = 99;
    };
    link.client.send(new Uint8Array([1]), 'unreliable');
    loop.runUntil(10);
    expect(received).toEqual([1, 1]);
    expect(link.upStats).toMatchObject({ packets: 1, duplicated: 1, delivered: 2 });
  });

  it('a throwing receiver does not retain or replay an already delivered retry', () => {
    const { loop, link } = held();
    const seen: number[] = [],
      failure = new Error('receiver failed');
    link.server.onMessage = (data) => {
      seen.push(data[0]);
      if (data[0] === 1) throw failure;
    };
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    link.client.send(new Uint8Array([2]), 'reliable');
    link.client.conditions.loss = 0;
    expect(() => loop.runUntil(20000)).toThrow(failure);
    loop.runUntil(20000);
    expect(seen).toEqual([1, 2]);
    expect(link.upStats.delivered).toBe(2);
  });

  it('a captured retry callback cannot affect a replacement after sever', () => {
    const { loop, link, draws } = held();
    const callbacks: (() => void)[] = [];
    const at = loop.at.bind(loop);
    vi.spyOn(loop, 'at').mockImplementation((time, callback) => {
      callbacks.push(callback);
      return at(time, callback);
    });
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    const stale = callbacks[0];
    link.sever();
    link.severed = false;
    const before = draws();
    // A replacement retry owner exists for the same direction.
    link.client.send(new Uint8Array([2]), 'reliable');
    const replacement = draws();
    expect(replacement - before).toBe(64);
    stale();
    expect(draws()).toBe(replacement);
    const received: number[] = [];
    link.server.onMessage = (data) => received.push(data[0]);
    link.client.conditions.loss = 0;
    loop.runUntil(20000);
    expect(received).toEqual([2]);
  });

  it('drains a long deferred FIFO without retaining consumed payloads or a retry timer', () => {
    const { loop, link, random } = held();
    const received: number[] = [];
    link.server.onMessage = (data) => received.push(data[0] * 256 + data[1]);
    for (let n = 0; n < 2000; n++) {
      const data = new Uint8Array([n >> 8, n & 255]);
      expect(() => link.client.send(data, 'reliable')).not.toThrow();
      data.fill(255);
    }
    link.client.conditions.loss = 0;
    // Replace the fail-fast test RNG budget: each recovered packet needs one
    // success draw, while each continuation still has its fixed loss budget.
    vi.mocked(random.next).mockReturnValue(0.5);
    loop.runUntil(20000);
    expect(received).toEqual(Array.from({ length: 2000 }, (_, i) => i));
    expect(link.upStats).toMatchObject({ packets: 2000, delivered: 2000, retransmits: 64 });
    expect(loop.pending).toBe(0);
    expect((link as unknown as { deferred: Map<unknown, unknown> }).deferred.size).toBe(0);
  });

  it.each(traces)('preserves exact seeded transport trace %s / loss %s', (seed, loss) => {
    expect(normalTrace(seed, loss)).toEqual(normalTrace(seed, loss, true));
  });
});

describe('link condition boundaries', () => {
  const invalid: Partial<LinkConditions>[] = [
    { latencyMs: NaN },
    { latencyMs: Infinity },
    { latencyMs: -1 },
    { jitterMs: NaN },
    { jitterMs: Infinity },
    { jitterMs: -1 },
    { loss: NaN },
    { loss: Infinity },
    { loss: -0.01 },
    { loss: 1.01 },
    { duplicate: NaN },
    { duplicate: -1 },
    { duplicate: 2 },
    { reorder: NaN },
    { reorder: -1 },
    { reorder: 2 },
  ];
  it.each(invalid)(
    'rejects malformed initial conditions %j before registering a link',
    (change) => {
      const net = new NetworkSimulator(new EventLoop());
      expect(() => net.connect({ ...PERFECT_LINK, ...change })).toThrow();
      expect(net.links).toEqual([]);
    },
  );
  it('rejects invalid changed conditions before consuming data or randomness', () => {
    const { link, draws } = held(0);
    const before = { ...link.upStats };
    link.client.conditions.loss = NaN;
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).toThrow();
    expect(draws()).toBe(0);
    expect(link.upStats).toEqual(before);
    link.client.conditions.loss = 0;
    expect(() => link.client.send(new Uint8Array([2]), 'reliable')).not.toThrow();
  });

  it('retires a retry whose changed configuration is invalid, allowing a corrected retry', () => {
    const { loop, link } = held();
    const received: number[] = [];
    link.server.onMessage = (data) => received.push(data[0]);
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).not.toThrow();
    link.client.send(new Uint8Array([2]), 'reliable');
    link.client.conditions.loss = NaN;
    expect(() => loop.runUntil(20000)).toThrow('Invalid link probability');
    link.client.conditions.loss = 0;
    link.client.send(new Uint8Array([3]), 'reliable');
    loop.runUntil(20000);
    expect(received).toEqual([3]);
  });

  it('rejects a retry deadline that cannot advance at the current clock precision', () => {
    const { loop, link } = held();
    loop.runUntil(1e20);
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).toThrow(
      'Reliable retry clock cannot advance',
    );
    expect(loop.pending).toBe(0);
    link.client.conditions.loss = 0;
    const received = vi.fn();
    link.server.onMessage = received;
    link.client.send(new Uint8Array([2]), 'reliable');
    loop.runUntil(1e20);
    expect(received).toHaveBeenCalledOnce();
  });

  it('rejects an overflowing retry deadline without poisoning later delivery', () => {
    const { loop, link } = held();
    link.client.conditions.latencyMs = 4e307;
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).toThrow(
      'Reliable retry clock cannot advance',
    );
    expect(loop.pending).toBe(0);
    link.client.conditions.latencyMs = 0;
    link.client.conditions.loss = 0;
    const received = vi.fn();
    link.server.onMessage = received;
    link.client.send(new Uint8Array([2]), 'reliable');
    loop.runUntil(1000);
    expect(received).toHaveBeenCalledOnce();
  });

  it('rejects overflowing delivery time before replacing the reliable deadline', () => {
    const { loop, link } = held(0);
    loop.runUntil(1e308);
    link.client.conditions.latencyMs = 8e307;
    expect(() => link.client.send(new Uint8Array([1]), 'reliable')).toThrow(
      'Invalid reliable delivery time',
    );
    expect(link.client.reliableClock).toBe(0);
    link.client.conditions.latencyMs = 0;
    link.client.send(new Uint8Array([2]), 'reliable');
    expect(link.client.reliableClock).toBe(1e308);
  });

  it('validates the reverse direction before registering either endpoint', () => {
    const net = new NetworkSimulator(new EventLoop());
    expect(() => net.connect(PERFECT_LINK, { ...PERFECT_LINK, loss: NaN })).toThrow();
    expect(net.links).toEqual([]);
  });
});
