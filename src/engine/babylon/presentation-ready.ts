import type { Scene } from '@babylonjs/core/scene.js';

/** Asset decoding is not a rendered-frame guarantee. Wait for two completed
 * ready frames so an asynchronously compiled material has actually had a
 * chance to draw. Never leave observers or a pending load behind on restart. */
export function waitForPresentation(scene: Scene, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || scene.isDisposed) {
      reject(new DOMException('Model presentation cancelled', 'AbortError'));
      return;
    }
    let readyFrames = 0;
    const clean = () => {
      scene.onAfterRenderObservable.remove(rendered);
      scene.onDisposeObservable.remove(disposed);
      signal.removeEventListener('abort', cancelled);
    };
    const cancelled = () => {
      clean();
      reject(new DOMException('Model presentation cancelled', 'AbortError'));
    };
    const rendered = scene.onAfterRenderObservable.add(() => {
      readyFrames = scene.isReady() ? readyFrames + 1 : 0;
      if (readyFrames >= 2) {
        clean();
        resolve();
      }
    });
    const disposed = scene.onDisposeObservable.add(cancelled);
    signal.addEventListener('abort', cancelled, { once: true });
  });
}
