import { GraphicsRecovery } from './graphics-recovery.ts';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { RestartOwnership } from './restart-ownership.ts';
import { BabylonPresentationGpu, cleanupPresentation } from './presentation-gpu.ts';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { BabylonCircuitScene } from './circuit-scene.ts';
import { waitForPresentation } from './presentation-ready.ts';
import { ExistingPlayerSteering } from './existing-player-steering.ts';
import { ExistingPlayerWheels } from './existing-player-wheels.ts';
import { PresentationSchedule } from './presentation-schedule.ts';
import { installGraphicsObservation } from '../../core/graphics-observation.ts';
import { SimulationComponent } from '../simulation-component.ts';
import { DEFAULT_OPTIONS } from '../../simulation/config.ts';
import { InputController, type TouchAction } from '../../input/controller.ts';
import { InputPump } from '../../input/pump.ts';
import { DEFAULT_SETTINGS, SaveStore, validateSettings } from '../../storage/data.ts';
import { F, carBase } from '../../simulation/protocol.ts';
import './preview.css';

installGraphicsObservation();
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const loadAsset = document.querySelector<HTMLButtonElement>('#loadAsset')!;
const assetStatus = document.querySelector<HTMLOutputElement>('#assetStatus')!;
let assetLoad = new AbortController();
let playerSteering: ExistingPlayerSteering | undefined;
let playerWheels: ExistingPlayerWheels | undefined;
const controlStatus = document.querySelector<HTMLOutputElement>('#controlStatus')!;
let input: InputController | undefined;
let inputPump: InputPump | undefined;
let settings = structuredClone(DEFAULT_SETTINGS);
const abort = new AbortController();
const eventOptions = { signal: abort.signal };
let engine: Engine | undefined;
let scene: BabylonCircuitScene | undefined;
let gpu: BabylonPresentationGpu | undefined;
declare global {
  interface Window {
    babylonGraphicsDiagnostics: () => ReturnType<BabylonPresentationGpu['diagnostics']> | null;
  }
}
Object.defineProperty(window, 'babylonGraphicsDiagnostics', {
  value: () => gpu?.diagnostics() ?? null,
  writable: false,
  configurable: false,
});
let stopped = false;
let resizePending = false;

let component: SimulationComponent;
const presentation = new PresentationSchedule();
const graphicsRecovery = new GraphicsRecovery();
const restartOwnership = new RestartOwnership<SimulationComponent>(
  () => {
    assetLoad.abort();
    loadAsset.disabled = true;
    assetStatus.textContent = 'Restarting presentation…';
  },
  () => {
    component = new SimulationComponent({
      ...DEFAULT_OPTIONS,
      setup: settings.setup,
      mode: 'practice',
      opponents: 0,
    });
    // Clear the previous run's input now, never after later keydown events.
    setPaused(false);
    return component;
  },
);
let renderedFrames = 0;
let paused = false,
  last = performance.now(),
  lastStatus = 0;
function requestPresentation() {
  status.dataset.presentationSettled = 'false';
  presentation.request();
}
function setPaused(value: boolean) {
  if (!value && !graphicsRecovery.canResume) return;
  paused = value;
  requestPresentation();
  input?.setEnabled(!value);
  component.setPaused(value);
  last = performance.now();
  pause.textContent = value ? 'Resume' : 'Pause';
}
function stop(error?: unknown) {
  if (stopped) return;
  stopped = true;
  delete assetStatus.dataset.scalarHeightMaterials;
  status.dataset.presentationSettled = 'false';
  if (error !== undefined) {
    console.error(error);
    status.textContent = `Babylon could not start or continue: ${error instanceof Error ? error.message : String(error)}. The full game remains available through the link above.`;
  }
  // Stop scheduling first; a failed disposer must not skip other ownership.
  for (const failure of cleanupPresentation([
    () => engine?.stopRenderLoop(),
    () => assetLoad.abort(),
    () => abort.abort(),
    () => gpu?.dispose(),
    () => inputPump?.dispose(),
    () => input?.dispose(),
    () => playerSteering?.dispose(),
    () => playerWheels?.dispose(),
    () => scene?.dispose(),
    () => engine?.dispose(),
  ]))
    console.error('Babylon cleanup failed:', failure);
}
function reset() {
  if (stopped) return;
  delete assetStatus.dataset.scalarHeightMaterials;
  try {
    graphicsRecovery.requestRestart();
    restartOwnership.request();
    requestPresentation();
  } catch (error) {
    stop(error);
  }
}
function rebuildScene(owner: SimulationComponent) {
  delete assetStatus.dataset.scalarHeightMaterials;
  status.dataset.presentationSettled = 'false';
  presentation.reset();
  assetLoad.abort();
  playerSteering?.dispose();
  playerSteering = undefined;
  playerWheels?.dispose();
  playerWheels = undefined;
  delete assetStatus.dataset.wheelPhase;
  delete assetStatus.dataset.steering;
  scene?.dispose();
  scene = new BabylonCircuitScene(engine!, owner.simulation.track, 1);
  // Fresh model ownership is published only after an explicit safe rebuild.
  graphicsRecovery.rebuilt();
  assetLoad = new AbortController();
  loadAsset.disabled = false;
  assetStatus.textContent = 'Original authored asset is optional in this diagnostic preview.';
}
window.addEventListener('pagehide', () => stop(), { once: true });
try {
  try {
    const saved = await new SaveStore().read('settings');
    if (saved) settings = validateSettings(saved);
  } catch (error) {
    controlStatus.textContent = `Using default controls: ${error instanceof Error ? error.message : String(error)}`;
  }
  abort.signal.throwIfAborted();
  input = new InputController(settings, (action) => {
    if (action === 'pause') setPaused(!paused);
    else if (action === 'blur' || action === 'deviceLost') setPaused(true);
    else if (action === 'autopilot')
      component.simulation.autoPlayer = !component.simulation.autoPlayer;
    else if (action === 'pit') component.simulation.requestPit();
    else if (action === 'drs') input!.state.drs = true;
    else if (action === 'overtake') input!.state.overtake = true;
    else if (action === 'ers') input!.state.ers = ((input!.state.ers + 1) % 3) as 0 | 1 | 2;
    else
      controlStatus.textContent = `${action} is available in the full game; its Babylon presentation is not ported yet.`;
  });
  for (const button of document.querySelectorAll<HTMLElement>('[data-drive]'))
    input.bindTouch(button, button.dataset.drive as TouchAction);
  engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const context = canvas.getContext('webgl2');
  if (!context || !('fenceSync' in context))
    throw new Error('Babylon presentation requires WebGL2 fences');
  gpu = new BabylonPresentationGpu(context);
  engine.onContextLostObservable.add(() => {
    delete assetStatus.dataset.scalarHeightMaterials;
    gpu?.contextLost();
    graphicsRecovery.contextLost();
    assetLoad.abort();
    loadAsset.disabled = true;
    assetStatus.textContent =
      'Graphics context was lost. Restart is required to rebuild the scene before loading or displaying the original model.';
    if (!stopped) setPaused(true);
  });
  engine.onContextRestoredObservable.add(() => {
    gpu?.contextRestored();
    graphicsRecovery.contextRestored();
    if (graphicsRecovery.restartRequired) {
      loadAsset.disabled = true;
      assetStatus.textContent =
        'Graphics context restored. Restart is required before loading or displaying the original model.';
    }
    last = performance.now();
    requestPresentation();
  });
  restartOwnership.request();
  restartOwnership.drain(true, rebuildScene);
  pause.addEventListener('click', () => setPaused(!paused), eventOptions);
  restart.addEventListener('click', reset, eventOptions);
  loadAsset.addEventListener(
    'click',
    async () => {
      if (stopped || restartOwnership.pending || graphicsRecovery.restartRequired) return;
      const currentScene = scene!,
        owner = assetLoad;
      const deadline = performance.now() + 120000;
      const budget = new AbortController();
      const signal = AbortSignal.any([owner.signal, budget.signal]);
      const timer = setTimeout(
        () =>
          budget.abort(new Error('Original model readiness exceeded its 120000ms total budget')),
        120000,
      );
      let container: AssetContainer | undefined;
      let steering: ExistingPlayerSteering | undefined;
      let wheels: ExistingPlayerWheels | undefined;
      let heightAdapter:
        | import('./existing-player-height.ts').ExistingPlayerHeightAdapter
        | undefined;
      let installed = false;
      let disposeUninstalled = (): unknown[] => [];
      const active = () => {
        signal.throwIfAborted();
        if (performance.now() >= deadline)
          throw new Error('Original model readiness exceeded its 120000ms total budget');
        if (
          stopped ||
          scene !== currentScene ||
          currentScene.scene.isDisposed ||
          restartOwnership.pending
        )
          throw new DOMException('Original model ownership changed', 'AbortError');
      };
      loadAsset.disabled = true;
      delete assetStatus.dataset.scalarHeightMaterials;
      assetStatus.textContent = 'Loading and verifying the existing authored Formula asset…';
      try {
        const { loadExistingPlayer, disposeUninstalledPlayer } = await import(
          './existing-player.ts'
        );
        disposeUninstalled = () => disposeUninstalledPlayer(container, [steering, wheels]);
        const { createExistingPlayerHeightAdapter } = await import('./existing-player-height.ts');
        active();
        container = await loadExistingPlayer(
          currentScene.scene,
          document.baseURI,
          signal,
          async ({ raw, bindings }) => {
            active();
            await gpu!.prepare(
              'Original scalar-height materials',
              deadline,
              async (invalidated) => {
                // Owner cancellation is checked by the loader AFTER this lane
                // drains, not injected as a fatal compiler/preparation failure.
                const height = await createExistingPlayerHeightAdapter(raw, bindings, invalidated);
                invalidated.throwIfAborted();
                height.setEnabled(true);
                if (height.enabledCount !== 10)
                  throw new Error('Original scalar-height material activation incomplete');
                heightAdapter = height;
                // Materials own plugin lifetime; no per-frame toggle or new
                // texture owner survives this one-time initialization stage.
              },
            );
          },
        );
        active();
        wheels = new ExistingPlayerWheels([...container.transformNodes, ...container.meshes]);
        steering = new ExistingPlayerSteering(container.animationGroups);
        // Keep the container's complete hierarchy off-scene until atomic add.
        // The entrant contributes only rigid translation/rotation, not scale
        // defines; retain every authored local transform and the existing datum.
        const entrant = currentScene.entrants[0];
        if (
          entrant.parent ||
          entrant.scaling.x !== 1 ||
          entrant.scaling.y !== 1 ||
          entrant.scaling.z !== 1
        )
          throw new Error('Original model preparation requires the existing unit-scale entrant');
        for (const node of container.rootNodes)
          if (node instanceof TransformNode) node.position.y -= 0.25;
        status.dataset.presentationSettled = 'false';
        await prepareOriginalMaterials(container, gpu!, signal, deadline, (done, total, label) => {
          if (!signal.aborted && scene === currentScene)
            assetStatus.textContent = `Preparing original model shader variants ${done}/${total}: ${label}`;
        });
        active();
        container.addAllToScene();
        for (const node of container.rootNodes) node.parent = entrant;
        installed = true;
        playerSteering = steering;
        playerWheels = wheels;
        currentScene.scene.getMeshByName('migration-proxy-0')?.setEnabled(false);
        assetStatus.textContent = 'Waiting for completed original-model presentation…';
        const finishPreparation = presentation.prepare();
        try {
          await waitForPresentation(currentScene.scene, signal, gpu!);
        } finally {
          finishPreparation();
        }
        active();
        if (heightAdapter?.enabledCount !== 10)
          throw new Error('Original scalar-height material activation incomplete');
        assetStatus.dataset.scalarHeightMaterials = String(heightAdapter.enabledCount);
        assetStatus.textContent =
          'Original Formula asset loaded in Babylon. Driver and rigid wheel motion follow physics; tyre deformation, LOD and full material parity are still pending.';
      } catch (error) {
        delete assetStatus.dataset.scalarHeightMaterials;
        // Never retry against a compiler whose ownership could not be drained.
        if (gpu?.diagnostics().preparation.failure || (installed && !owner.signal.aborted)) {
          stop(error);
          return;
        }
        if (owner.signal.aborted || stopped || scene !== currentScene) return;
        loadAsset.disabled = false;
        assetStatus.textContent = `Model unavailable: ${error instanceof Error ? error.message : String(error)}. Retry is safe.`;
      } finally {
        clearTimeout(timer);
        if (!installed) {
          for (const failure of disposeUninstalled())
            console.error('Original model cleanup failed:', failure);
        }
      }
    },
    eventOptions,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) setPaused(true);
      else requestPresentation();
    },
    eventOptions,
  );
  window.addEventListener(
    'resize',
    () => {
      resizePending = true;
      requestPresentation();
    },
    eventOptions,
  );
  inputPump = new InputPump((dt) => {
    if (document.hidden) return;
    if (paused) {
      input!.pollActions(['pause']);
      return;
    }
    const command = input!.update(dt);
    component.setInput(command);
    command.shift = 0;
    command.drs = command.overtake = false;
  });
  inputPump.start();
  engine.runRenderLoop(() => {
    if (stopped) return;
    try {
      const now = performance.now(),
        seconds = (now - last) / 1000;
      last = now;
      component.advance(seconds);
      if (gpu!.ready()) {
        restartOwnership.drain(true, rebuildScene);
        if (!graphicsRecovery.restartRequired && resizePending) {
          resizePending = false;
          engine!.resize();
        }
        if (!graphicsRecovery.restartRequired)
          gpu!.frame(presentation, paused, scene!.scene, () => {
            if (playerSteering)
              assetStatus.dataset.steering = String(playerSteering.apply(component.frame));
            if (playerWheels)
              assetStatus.dataset.wheelPhase = String(playerWheels.apply(component.frame));
            const readyBefore = scene!.scene.isReady();
            scene!.render(component.frame);
            const readyAfter = scene!.scene.isReady();
            presentation.rendered(readyBefore, readyAfter);
            status.dataset.sceneReady = String(readyBefore && readyAfter);
            return readyBefore && readyAfter;
          });
      }
      const graphics = gpu!.diagnostics();
      renderedFrames = graphics.submitted;
      status.dataset.renderedFrames = String(renderedFrames);
      status.dataset.completedFrames = String(graphics.completed);
      status.dataset.lastCompletedSequence = String(graphics.lastCompletedSequence);
      status.dataset.abandonedFrames = String(graphics.abandoned);
      status.dataset.presentationSettled = String(
        paused &&
          !restartOwnership.pending &&
          !graphicsRecovery.restartRequired &&
          !resizePending &&
          !presentation.pending &&
          !graphics.lost &&
          !graphics.disposed &&
          !graphics.queue.failure &&
          graphics.settled,
      );
      if (now - lastStatus > 250) {
        lastStatus = now;
        status.dataset.steer = String(component.frame[carBase(0) + F.STEER]);
        status.dataset.throttle = String(component.frame[carBase(0) + F.THROTTLE]);
        status.textContent = `${paused ? 'PAUSED' : component.simulation.autoPlayer ? 'AI DEMO' : 'DRIVING'} · ${Math.round(component.frame[carBase(0) + F.SPEED] * 3.6)} km/h · physics tick ${component.simulation.tick}`;
      }
    } catch (error) {
      stop(error);
    }
  });
} catch (error) {
  stop(error);
}
