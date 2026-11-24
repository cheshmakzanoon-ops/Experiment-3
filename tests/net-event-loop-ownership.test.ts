import { describe, expect, it, vi } from 'vitest';
import { EventLoop, NetRandom } from '../src/net/event-loop.ts';

/** Count retained handle records without depending on the choice of collection. */
function handleRecords(loop: EventLoop) {
  return Object.values(loop).reduce(
    (total, value) => total + (value instanceof Set || value instanceof Map ? value.size : 0),
    0,
  );
}

describe('event-loop handle ownership', () => {
  it('cannot cancel an event that has not been scheduled yet', () => {
    const loop = new EventLoop(),
      seen: number[] = [];
    loop.cancel(0);
    loop.cancel(2);
    for (let i = 0; i < 3; i++) loop.at(1, () => seen.push(i));
    loop.runUntil(1);
    expect(seen).toEqual([0, 1, 2]);
    expect(handleRecords(loop)).toBe(0);
  });

  it('does not retain malformed, unknown or already-fired handles', () => {
    const loop = new EventLoop();
    for (const handle of [NaN, Infinity, -Infinity, -1, 0.5, 123456]) loop.cancel(handle);
    for (let i = 0; i < 10000; i++) {
      const handle = loop.at(i, () => undefined);
      loop.runUntil(i);
      loop.cancel(handle);
      loop.cancel(handle);
    }
    expect(loop.pending).toBe(0);
    expect(handleRecords(loop)).toBe(0);
  });

  it.each(['runUntil', 'runWhile'] as const)(
    'retires a recurring handle before its callback stops itself through %s',
    (method) => {
      const loop = new EventLoop();
      let calls = 0;
      for (let i = 0; i < 2000; i++) {
        const stop = loop.every(10, () => {
          calls++;
          stop();
          stop();
        });
        if (method === 'runUntil') loop.runUntil(i);
        else loop.runWhile(() => true, i);
        stop();
        expect(loop.pending).toBe(0);
      }
      expect(calls).toBe(2000);
      expect(handleRecords(loop)).toBe(0);
    },
  );

  it('releases the cancelled callback without changing the queued-event count contract', () => {
    const loop = new EventLoop(),
      callback = vi.fn();
    const handle = loop.at(1e9, callback);
    loop.cancel(handle);
    loop.cancel(handle);
    // The small heap slot remains until its due time, but no longer retains
    // whatever session or payload the cancelled callback closed over.
    const queued = (loop as unknown as { heap: { fn: unknown }[] }).heap;
    expect(queued.some((entry) => entry.fn === callback)).toBe(false);
    expect(loop.pending).toBe(1);
    expect(handleRecords(loop)).toBeLessThanOrEqual(loop.pending);
    loop.runUntil(1e9);
    expect(callback).not.toHaveBeenCalled();
    expect(handleRecords(loop)).toBe(0);
  });

  it('keeps cancellation and new equal-time callbacks in deterministic order', () => {
    const loop = new EventLoop(),
      seen: string[] = [];
    loop.at(4, () => {
      seen.push('a');
      loop.cancel(second);
      loop.at(4, () => seen.push('d'));
    });
    const second = loop.at(4, () => seen.push('b'));
    loop.at(4, () => seen.push('c'));
    loop.runUntil(4);
    expect(seen).toEqual(['a', 'c', 'd']);
    expect(handleRecords(loop)).toBe(0);
  });

  it('retires a throwing event and preserves later queued work', () => {
    const loop = new EventLoop(),
      failure = new Error('event failed'),
      later = vi.fn();
    const failed = loop.at(5, () => {
      throw failure;
    });
    loop.at(6, later);
    expect(() => loop.runUntil(10)).toThrow(failure);
    expect(loop.now).toBe(5);
    loop.cancel(failed);
    expect(handleRecords(loop)).toBeLessThanOrEqual(loop.pending);
    loop.runUntil(10);
    expect(later).toHaveBeenCalledOnce();
    expect(loop.now).toBe(10);
    expect(handleRecords(loop)).toBe(0);
  });

  it('stopping a recurring event after its callback throws cannot retain the retired handle', () => {
    const loop = new EventLoop(),
      failure = new Error('period failed');
    const stop = loop.every(10, () => {
      throw failure;
    });
    expect(() => loop.runUntil(100)).toThrow(failure);
    stop();
    expect(loop.pending).toBe(0);
    expect(handleRecords(loop)).toBe(0);
  });
});

describe('event-loop clock boundaries', () => {
  it.each([NaN, Infinity, -Infinity])(
    'rejects runUntil(%s) without advancing or running work',
    (time) => {
      const loop = new EventLoop(),
        callback = vi.fn();
      loop.at(2, callback);
      expect(() => loop.runUntil(time)).toThrow(/time/i);
      expect(loop.now).toBe(0);
      expect(loop.pending).toBe(1);
      expect(callback).not.toHaveBeenCalled();
      loop.runUntil(3);
      expect(callback).toHaveBeenCalledOnce();
      expect(loop.now).toBe(3);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    'rejects runWhile limit %s before calling its predicate',
    (limit) => {
      const loop = new EventLoop(),
        callback = vi.fn(),
        predicate = vi.fn(() => true);
      loop.at(2, callback);
      expect(() => loop.runWhile(predicate, limit)).toThrow(/time/i);
      expect(loop.now).toBe(0);
      expect(loop.pending).toBe(1);
      expect(predicate).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      loop.runWhile(() => true, 3);
      expect(callback).toHaveBeenCalledOnce();
      expect(loop.now).toBe(2); // runWhile stands at the last event, not its limit.
    },
  );

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'rejects an invalid recurring period %s before scheduling',
    (period) => {
      const loop = new EventLoop(),
        callback = vi.fn();
      expect(() => loop.every(period, callback)).toThrow(/period/i);
      expect(loop.pending).toBe(0);
      expect(loop.now).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it('preserves finite past-time clamping, backwards limits and exact recurring multiples', () => {
    const loop = new EventLoop(),
      seen: number[] = [];
    loop.runUntil(10);
    loop.at(-20, () => seen.push(loop.now));
    loop.after(-5, () => seen.push(loop.now));
    loop.runUntil(9);
    expect(loop.now).toBe(10);
    expect(seen).toEqual([]);
    loop.runUntil(10);
    expect(seen).toEqual([10, 10]);
    const start = 11.25,
      period = 1000 / 120,
      times: number[] = [];
    const stop = loop.every(period, () => times.push(loop.now), start);
    loop.runUntil(start + 360 * period);
    stop();
    expect(times).toEqual(Array.from({ length: 361 }, (_, k) => start + k * period));
    loop.runUntil(4000);
    expect(handleRecords(loop)).toBe(0);
  });
});

interface Scheduler {
  now: number;
  readonly pending: number;
  at(time: number, fn: () => void): number;
  cancel(handle: number): void;
  runUntil(time: number): void;
  runWhile(predicate: () => boolean, limit: number): void;
}

/** Deliberately simple sorted-list reference, independent of heap bookkeeping. */
class SortedReference implements Scheduler {
  now = 0;
  private sequence = 0;
  private events: { time: number; sequence: number; callback: (() => void) | null }[] = [];
  get pending() {
    return this.events.length;
  }
  at(time: number, callback: () => void) {
    const sequence = this.sequence++;
    this.events.push({ time: Math.max(this.now, time), sequence, callback });
    this.events.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
    return sequence;
  }
  cancel(handle: number) {
    const event = this.events.find((event) => event.sequence === handle);
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

function trace(loop: Scheduler, seed: number) {
  const random = new NetRandom(seed),
    seen: [number, number][] = [],
    handles: number[] = [];
  for (let i = 0; i < 512; i++) {
    const time = Math.floor(random.next() * 400);
    handles.push(
      loop.at(time, () => {
        seen.push([i, loop.now]);
        if (i % 17 === 0) loop.at(loop.now + (i % 5), () => seen.push([512 + i, loop.now]));
        if (i % 7 === 0) loop.cancel(handles[(i + 3) % handles.length]);
      }),
    );
  }
  for (const handle of handles) if (random.next() < 0.3) loop.cancel(handle);
  loop.runWhile(() => seen.length < 30, 100);
  loop.runUntil(101);
  loop.runWhile(() => seen.length < 150, 200);
  loop.runUntil(500);
  return { seen, now: loop.now, pending: loop.pending };
}

it('matches a sorted reference across seeded cancellation, ties and reentrant scheduling', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const loop = new EventLoop();
    expect(trace(loop, seed), `seed ${seed}`).toEqual(trace(new SortedReference(), seed));
    expect(handleRecords(loop)).toBe(0);
  }
});
