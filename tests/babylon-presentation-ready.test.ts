import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
import { waitForPresentation } from '../src/engine/babylon/presentation-ready.ts';
function fixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera('test', Vector3.Zero(), scene);
  const listeners = new Set<(receipt: PresentationReceipt) => void>();
  const completions = {
    subscribe(listener: (receipt: PresentationReceipt) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  let sequence = 0;
  const complete = (ready = true) => {
    sequence++;
    for (const listener of [...listeners])
      listener({ kind: 'completed', owner: scene, ready, sequence });
  };
  return { engine, scene, completions, complete, listeners };
}
it('does not announce a decoded asset until ready materials have completed two render frames', async () => {
  const { engine, scene, completions, complete, listeners } = fixture();
  let ready = false,
    finished = false;
  scene.addIsReadyCheck({ isReady: () => ready });
  const pending = waitForPresentation(scene, new AbortController().signal, completions).then(() => {
    finished = true;
  });
  scene.render();
  scene.render();
  await Promise.resolve();
  expect(finished).toBe(false);
  complete(false);
  ready = true;
  scene.render();
  await Promise.resolve();
  expect(finished).toBe(false);
  scene.render();
  await Promise.resolve();
  expect(finished).toBe(false);
  complete();
  await Promise.resolve();
  expect(finished).toBe(false);
  complete();
  await pending;
  expect(listeners.size).toBe(0);
  expect(finished).toBe(true);
  expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
  // Babylon marks observers immediately, then removes their storage next turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scene.onAfterRenderObservable.observers.length).toBe(0);
  scene.dispose();
  engine.dispose();
});
it('cancels and releases presentation observers when a newer load replaces the asset', async () => {
  const { engine, scene, completions } = fixture(),
    controller = new AbortController();
  const baseline = scene.onDisposeObservable.observers.length;
  const pending = waitForPresentation(scene, controller.signal, completions);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);
  // Babylon marks observers immediately, then removes their storage next turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scene.onAfterRenderObservable.observers.length).toBe(0);
  expect(scene.onDisposeObservable.observers.length).toBe(baseline);
  scene.dispose();
  engine.dispose();
});
it('rejects both an already disposed scene and disposal during shader preparation', async () => {
  const { engine, scene, completions } = fixture(),
    signal = new AbortController().signal;
  const pending = waitForPresentation(scene, signal, completions);
  scene.dispose();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(waitForPresentation(scene, signal, completions)).rejects.toMatchObject({
    name: 'AbortError',
  });
  engine.dispose();
});

it('rejects owner cleanup and resets consecutive readiness after context loss', async () => {
  const { engine, scene, completions, complete, listeners } = fixture();
  let finished = false;
  const pending = waitForPresentation(scene, new AbortController().signal, completions).then(() => {
    finished = true;
  });
  complete();
  for (const listener of [...listeners]) listener({ kind: 'lost' });
  complete();
  await Promise.resolve();
  expect(finished).toBe(false);
  for (const listener of [...listeners]) listener({ kind: 'disposed' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(listeners.size).toBe(0);
  scene.dispose();
  engine.dispose();
});
