/** Cancel ownership promptly even when an asset/worker promise cannot itself
 * be interrupted. Late resolution/rejection is observed but never published. */
export function abortableStartup<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  dispose: () => void,
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const remove = () => signal.removeEventListener('abort', cancel);
    const cancel = () => {
      if (settled) return;
      settled = true;
      remove();
      try {
        dispose();
      } catch (error) {
        reject(error);
        return;
      }
      reject(signal.reason ?? new DOMException('Startup cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        remove();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        remove();
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}
