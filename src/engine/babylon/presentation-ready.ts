import type { Scene } from '@babylonjs/core/scene.js';
import type { PresentationCompletions } from './presentation-gpu.ts';

/** Two ready scene submissions must actually complete on the GPU. CPU
 * onAfterRender notifications alone cannot establish this receipt. */
export function waitForPresentation(
  scene: Scene,
  signal: AbortSignal,
  completions: PresentationCompletions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || scene.isDisposed) {
      reject(new DOMException('Model presentation cancelled', 'AbortError'));
      return;
    }
    let readyFrames = 0;
    let unsubscribe = () => {};
    const clean = () => {
      unsubscribe();
      scene.onDisposeObservable.remove(disposed);
      signal.removeEventListener('abort', cancelled);
    };
    const cancelled = () => {
      clean();
      reject(new DOMException('Model presentation cancelled', 'AbortError'));
    };
    const disposed = scene.onDisposeObservable.add(cancelled);
    signal.addEventListener('abort', cancelled, { once: true });
    unsubscribe = completions.subscribe((receipt) => {
      if (receipt.kind === 'disposed') {
        cancelled();
        return;
      }
      if (receipt.kind === 'lost') {
        readyFrames = 0;
        return;
      }
      if (receipt.owner !== scene) return;
      readyFrames = receipt.ready ? readyFrames + 1 : 0;
      if (readyFrames >= 2) {
        clean();
        resolve();
      }
    });
  });
}
