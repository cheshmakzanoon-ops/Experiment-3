/** Self-contained because Playwright serializes this function into the live page. */
export async function exerciseBabylonContextRecovery(keys: readonly string[]) {
  const canvas = document.querySelector('#game') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  const extension = gl?.getExtension('WEBGL_lose_context');
  if (!gl || !extension) throw new Error('Context-loss acceptance requires WEBGL_lose_context');
  if (gl.isContextLost()) throw new Error('Context was already lost before the acceptance probe');

  const afterEventDispatch = (type: 'webglcontextlost' | 'webglcontextrestored') =>
    new Promise<Event>((resolve) =>
      canvas.addEventListener(
        type,
        (event) => {
          // WEBGL_lose_context forbids restoration until loss dispatch finishes:
          // https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/
          // A microtask can run before the browser commits defaultPrevented.
          // MessageChannel yields to a new task, not an elapsed-time sleep.
          const { port1, port2 } = new MessageChannel();
          port1.onmessage = () => {
            port1.close();
            port2.close();
            resolve(event);
          };
          port2.postMessage(null);
        },
        { once: true },
      ),
    );
  const snapshot = () => {
    const status = document.querySelector('#status') as HTMLElement;
    return {
      contextLost: gl.isContextLost(),
      absent: keys.every((key) => status.dataset[key] === undefined),
      sceneReady: status.dataset.sceneReady,
      loadDisabled: (document.querySelector('#loadAsset') as HTMLButtonElement).disabled,
    };
  };

  const lost = afterEventDispatch('webglcontextlost');
  extension.loseContext();
  const lostEvent = await lost;
  // The application, not the acceptance fixture, must permit restoration.
  if (!lostEvent.defaultPrevented)
    throw new Error('The application did not permit WebGL context restoration');
  const lostState = snapshot();
  const restored = afterEventDispatch('webglcontextrestored');
  extension.restoreContext();
  await restored;
  return { lost: lostState, restored: snapshot() };
}
