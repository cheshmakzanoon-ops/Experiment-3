import { describe, expect, it } from 'vitest';
import { EventLoop } from '../src/net/event-loop.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import { onlineFixture } from './net-helpers.ts';

/** The retained handle index is distinct from pending heap tombstones. */
function retainedHandles(loop: EventLoop) {
  return Object.values(loop).reduce(
    (total, value) => total + (value instanceof Map || value instanceof Set ? value.size : 0),
    0,
  );
}

interface Scheduler {
  now: number;
  readonly pending: number;
  at(time: number, callback: () => void): number;
  cancel(handle: number): void;
  runUntil(time: number): void;
  runWhile(predicate: () => boolean, limit: number): void;
}

/** Independent linear-list oracle: no heap, handle index or retirement policy. */
class OrderedList implements Scheduler {
  now = 0;
  private next = 0;
  private events: { id: number; time: number; callback: (() => void) | null }[] = [];
  get pending() {
    return this.events.length;
  }
  at(time: number, callback: () => void) {
    const id = this.next++;
    this.events.push({ id, time: Math.max(this.now, time), callback });
    this.events.sort((a, b) => a.time - b.time || a.id - b.id);
    return id;
  }
  cancel(handle: number) {
    const event = this.events.find(({ id }) => id === handle);
    if (event) event.callback = null;
  }
  runWhile(predicate: () => boolean, limit: number) {
    while (predicate() && this.events.length && this.events[0].time <= limit) {
      const event = this.events.shift()!;
      if (!event.callback) continue;
      this.now = event.time;
      event.callback();
    }
  }
  runUntil(time: number) {
    this.runWhile(() => true, time);
    this.now = Math.max(this.now, time);
  }
}

function mixedTrace(loop: Scheduler, seed: number) {
  const seen: [number, number][] = [];
  const cancelled: number[] = [];
  const handles: number[] = [];
  const checkpoints: { now: number; pending: number; delivered: number }[] = [];
  const checkpoint = () =>
    checkpoints.push({ now: loop.now, pending: loop.pending, delivered: seen.length });
  for (let i = 0; i < 1024; i++)
    cancelled.push(loop.at(1e9 + i, () => seen.push([-i - 1, loop.now])));
  for (const handle of cancelled) {
    loop.cancel(handle);
    loop.cancel(handle);
  }
  // Unknown handles must not reserve cancellation of later-created work.
  loop.cancel(1024);
  for (let i = 0; i < 256; i++) {
    const time = (i * 37 + seed * 13) % 97;
    handles.push(
      loop.at(time, () => {
        seen.push([i, loop.now]);
        if (i % 7 === 0) loop.cancel(handles[(i + 41) % handles.length]);
        if (i % 19 === 0) loop.at(loop.now, () => seen.push([256 + i, loop.now]));
      }),
    );
  }
  for (let i = 0; i < handles.length; i++)
    if ((i + seed) % 4 === 0) loop.cancel(handles[i]);
  checkpoint();
  loop.runWhile(() => seen.length < 23, 37);
  checkpoint();
  loop.runUntil(41);
  checkpoint();
  loop.runWhile(() => seen.length < 120, 83);
  checkpoint();
  loop.runUntil(100);
  checkpoint();
  loop.runUntil(1e9 + 1024);
  checkpoint();
  return { seen, checkpoints };
}

describe('immediate retirement of canceled event handles', () => {
  it('retains no handle records for thousands of canceled future deadlines without draining time', () => {
    const loop = new EventLoop();
    const seen: number[] = [];
    const handles = Array.from({ length: 4096 }, (_, i) =>
      loop.at(1e9 + i, () => seen.push(i)),
    );
    expect(retainedHandles(loop)).toBe(4096);
    for (const handle of handles) {
      loop.cancel(handle);
      loop.cancel(handle);
    }
    for (const handle of [NaN, Infinity, -1, 0.5, 1e8]) loop.cancel(handle);

    expect(loop.now).toBe(0);
    expect(loop.pending).toBe(4096);
    expect(retainedHandles(loop)).toBe(0);
    const heap = (loop as unknown as { heap: { fn: unknown }[] }).heap;
    expect(heap.every(({ fn }) => fn === null)).toBe(true);

    loop.at(5, () => seen.push(4096));
    expect(retainedHandles(loop)).toBe(1);
    loop.runUntil(5);
    expect(seen).toEqual([4096]);
    expect(loop.pending).toBe(4096);
    expect(retainedHandles(loop)).toBe(0);
    loop.runUntil(1e9 + 4096);
    expect(seen).toEqual([4096]);
    expect(loop.pending).toBe(0);
    expect(retainedHandles(loop)).toBe(0);
  });

  it.each([1, 17, 22039])(
    'preserves the independent event trace, partial-drain count and clock after churn (seed %s)',
    (seed) => {
      const loop = new EventLoop();
      const observed = mixedTrace(loop, seed);
      expect(observed).toEqual(mixedTrace(new OrderedList(), seed));
      expect(observed.seen.length).toBeGreaterThan(120);
      expect(observed.seen.every(([id]) => id >= 0)).toBe(true);
      expect(retainedHandles(loop)).toBe(0);
    },
  );

  it('retires stopped repetitions before their due time and keeps active exact multiples', () => {
    const loop = new EventLoop();
    const seen: number[] = [];
    const stops = Array.from({ length: 256 }, (_, i) =>
      loop.every(1000, () => seen.push(-i - 1), 1e9 + i),
    );
    for (const stop of stops) {
      stop();
      stop();
    }
    expect(retainedHandles(loop)).toBe(0);
    expect(loop.pending).toBe(256);
    const stopActive = loop.every(
      7,
      () => {
        seen.push(loop.now);
        if (seen.length === 3) {
          stopActive();
          stopActive();
          expect(retainedHandles(loop)).toBe(0);
        }
      },
      1,
    );
    expect(retainedHandles(loop)).toBe(1);
    loop.runUntil(100);
    expect(seen).toEqual([1, 8, 15]);
    expect(retainedHandles(loop)).toBe(0);
    expect(loop.pending).toBe(256);
    stops.forEach((stop) => stop());
    stopActive();
    loop.runUntil(1e9 + 256);
    expect(seen).toEqual([1, 8, 15]);
    expect(loop.pending).toBe(0);
  });

  it('retires a canceled successor even when the current callback throws and later work recovers', () => {
    const loop = new EventLoop();
    const seen: string[] = [];
    const failure = new Error('owner failed');
    let canceled = -1;
    const current = loop.at(4, () => {
      loop.cancel(canceled);
      loop.cancel(current); // It was already retired before this invocation.
      loop.at(4, () => seen.push('same-time survivor'));
      expect(retainedHandles(loop)).toBe(2);
      throw failure;
    });
    canceled = loop.at(4, () => seen.push('canceled'));
    loop.at(5, () => seen.push('later survivor'));
    expect(() => loop.runUntil(10)).toThrow(failure);
    expect(loop.now).toBe(4);
    expect(loop.pending).toBe(3); // Canceled slot plus both live survivors.
    expect(retainedHandles(loop)).toBe(2);
    loop.cancel(current);
    loop.cancel(canceled);
    loop.runUntil(10);
    expect(seen).toEqual(['same-time survivor', 'later survivor']);
    expect(loop.now).toBe(10);
    expect(loop.pending).toBe(0);
    expect(retainedHandles(loop)).toBe(0);
  });

  it('bounds retained handles by live server work across silent connection loss and teardown', () => {
    const f = onlineFixture({
      server: { autoStart: false, timeouts: { joinMs: 120000 } },
    });
    try {
      expect(retainedHandles(f.loop)).toBe(1); // The server sweep.
      for (let i = 0; i < 128; i++) {
        const connection = f.net.connect(PERFECT_LINK);
        f.server.accept(connection.server);
        expect(retainedHandles(f.loop)).toBe(2);
        connection.client.close('peer process departed');
        f.loop.runUntil(f.loop.now); // Actual transport close delivery only.
        expect(connection.server.onMessage).toBeNull();
        expect(connection.server.onClose).toBeNull();
        expect(retainedHandles(f.loop)).toBe(1);
      }
      expect(f.loop.now).toBe(0);
      expect(f.loop.pending).toBe(129); // Sweep plus 128 canceled join slots.
      f.server.teardown();
      expect(f.server.phase).toBe('teardown');
      expect(retainedHandles(f.loop)).toBe(0);
      expect(f.loop.pending).toBe(129);
      expect(f.server.stats.invalidMessages).toBe(0);
      expect(f.server.stats.transportErrorCount).toBe(0);
      f.loop.runUntil(120000);
      expect(retainedHandles(f.loop)).toBe(0);
      expect(f.loop.pending).toBe(0);
    } finally {
      f.server.teardown();
    }
  });
});
