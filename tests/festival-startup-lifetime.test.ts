import { afterEach, expect, it, vi } from 'vitest';
import { FestivalSession, type FestivalHost } from '../src/session/free-roam.ts';
afterEach(() => vi.unstubAllGlobals());
it('does not begin loading for an already cancelled festival owner', async () => {
  const abort = new AbortController();
  abort.abort();
  const loading = vi.fn();
  await expect(
    FestivalSession.start({ loading } as unknown as FestivalHost, { signal: abort.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(loading).not.toHaveBeenCalled();
});
it('cancels a deferred saved-state read before constructing or publishing workers', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const workers = vi.fn();
  vi.stubGlobal('Worker', workers);
  let resolve!: (value: null) => void;
  const load = vi.fn(
    () =>
      new Promise<null>((done) => {
        resolve = done;
      }),
  );
  const loaded = vi.fn(),
    abort = new AbortController();
  const pending = FestivalSession.start(
    { loading: vi.fn(), load, loaded } as unknown as FestivalHost,
    { signal: abort.signal },
  );
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  resolve(null);
  await Promise.resolve();
  expect(workers).not.toHaveBeenCalled();
  expect(loaded).not.toHaveBeenCalled();
});
it('cancels the pre-start animation frame without waiting for a hidden document', async () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 17),
  );
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const abort = new AbortController(),
    load = vi.fn();
  const pending = FestivalSession.start({ loading: vi.fn(), load } as unknown as FestivalHost, {
    signal: abort.signal,
  });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancel).toHaveBeenCalledWith(17);
  expect(load).not.toHaveBeenCalled();
});
