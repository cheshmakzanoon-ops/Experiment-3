import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionLifetime } from '../src/session/session-lifetime.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function observe<T>(promise: Promise<T>) {
  let outcome: { value: T } | { error: unknown } | undefined;
  void promise.then(
    (value) => {
      outcome = { value };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );
  return () => outcome;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionLifetime exception-safe settlement', () => {
  it('rejects successful work with its cleanup failure instead of stranding the wait', async () => {
    const lifetime = new SessionLifetime('Closed');
    const failure = new Error('Cleanup failed');
    const cancel = vi.fn(() => {
      throw failure;
    });
    const result = observe(lifetime.wait(Promise.resolve(42), cancel));
    await flush();
    expect(result()).toEqual({ error: failure });
    lifetime.close();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['Error', new Error('Loader failed')],
    ['undefined', undefined],
  ])('preserves an original %s rejection when cleanup also throws', async (_name, failure) => {
    const lifetime = new SessionLifetime('Closed');
    const cancel = vi.fn(() => {
      throw new Error('Cleanup failed');
    });
    const result = observe(lifetime.wait(Promise.reject(failure), cancel));
    await flush();
    expect(result()).toEqual({ error: failure });
    lifetime.close();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['before', 'during'] as const)(
    'settles cancellation %s a wait even when cleanup throws',
    async (timing) => {
      const lifetime = new SessionLifetime('Closed');
      const work = deferred<number>();
      const reason = new Error('Session left');
      const cancel = vi.fn(() => {
        throw new Error('Cleanup failed');
      });
      if (timing === 'before') lifetime.close(reason);
      const result = observe(lifetime.wait(work.promise, cancel));
      if (timing === 'during') lifetime.close(reason);
      await flush();
      expect(result()).toEqual({ error: reason });
      // Shared loader failure is still consumed after the session owns no work.
      work.reject(new Error('Late shared loader failure'));
      await flush();
      expect(result()).toEqual({ error: reason });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'settles once when %s cleanup closes the lifetime reentrantly',
    async (completion) => {
      const lifetime = new SessionLifetime('Closed');
      const failure = new Error('Loader failed');
      const cancel = vi.fn(() => lifetime.close(new Error('Reentrant close')));
      const work = completion === 'resolve' ? Promise.resolve(42) : Promise.reject(failure);
      const result = observe(lifetime.wait(work, cancel));
      await flush();
      expect(result()).toEqual(completion === 'resolve' ? { value: 42 } : { error: failure });
      expect(lifetime.signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('keeps cancellation authoritative over already resolved work awaiting its microtask', async () => {
    const lifetime = new SessionLifetime('Closed');
    const reason = new Error('Leaving now');
    const cancel = vi.fn(() => {
      lifetime.close(new Error('Reentrant close'));
      throw new Error('Cleanup failed');
    });
    const result = observe(lifetime.wait(Promise.resolve(42), cancel));
    lifetime.close(reason);
    await flush();
    expect(result()).toEqual({ error: reason });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a completed delay when timer cleanup fails', async () => {
    vi.useFakeTimers();
    const lifetime = new SessionLifetime('Closed');
    const failure = new Error('Timer cleanup failed');
    vi.spyOn(globalThis, 'clearTimeout').mockImplementationOnce(() => {
      throw failure;
    });
    const result = observe(lifetime.delay(20));
    await vi.advanceTimersByTimeAsync(20);
    expect(result()).toEqual({ error: failure });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a completed animation frame when frame cleanup fails', async () => {
    const lifetime = new SessionLifetime('Closed');
    const failure = new Error('Frame cleanup failed');
    let callback!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 17;
    });
    const cancel = vi.fn(() => {
      throw failure;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const result = observe(lifetime.frame());
    callback(100);
    await flush();
    expect(result()).toEqual({ error: failure });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(17);
  });
});
