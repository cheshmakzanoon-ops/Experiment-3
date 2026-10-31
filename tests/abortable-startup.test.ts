import { expect, it, vi } from 'vitest';
import { abortableStartup } from '../src/core/abortable-startup.ts';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('rejects cancelled startup promptly and never publishes late completion', async () => {
  const work = deferred<object>(),
    abort = new AbortController(),
    dispose = vi.fn(),
    publish = vi.fn();
  const pending = abortableStartup(work.promise, abort.signal, dispose).then(publish);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  work.resolve({ ready: true });
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
});
it('handles an already aborted owner and observes a late rejection', async () => {
  const work = deferred<object>(),
    abort = new AbortController(),
    dispose = vi.fn();
  abort.abort();
  await expect(abortableStartup(work.promise, abort.signal, dispose)).rejects.toMatchObject({
    name: 'AbortError',
  });
  work.reject(new Error('late loader failure'));
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
});
it('removes cancellation ownership after successful startup or ordinary failure', async () => {
  const abort = new AbortController(),
    dispose = vi.fn(),
    value = {};
  expect(await abortableStartup(Promise.resolve(value), abort.signal, dispose)).toBe(value);
  await expect(
    abortableStartup(Promise.reject(new Error('load failed')), abort.signal, dispose),
  ).rejects.toThrow('load failed');
  abort.abort();
  expect(dispose).not.toHaveBeenCalled();
});
