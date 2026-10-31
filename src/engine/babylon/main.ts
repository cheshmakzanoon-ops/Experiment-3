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
let component: SimulationComponent;
const presentation = new PresentationSchedule();
let renderedFrames = 0;
let paused = false,
  last = performance.now(),
  lastStatus = 0;
function setPaused(value: boolean) {
  paused = value;
  presentation.request();
  input?.setEnabled(!value);
  component.setPaused(value);
  last = performance.now();
  pause.textContent = value ? 'Resume' : 'Pause';
}
function reset() {
  presentation.reset();
  assetLoad.abort();
  playerSteering?.dispose();
  playerSteering = undefined;
  playerWheels?.dispose();
  playerWheels = undefined;
  delete assetStatus.dataset.wheelPhase;
  delete assetStatus.dataset.steering;
  assetLoad = new AbortController();
  loadAsset.disabled = false;
  assetStatus.textContent = 'Original authored asset is optional in this diagnostic preview.';
  scene?.dispose();
  component = new SimulationComponent({
    ...DEFAULT_OPTIONS,
    setup: settings.setup,
    mode: 'practice',
    opponents: 0,
  });
  scene = new BabylonCircuitScene(engine!, component.simulation.track, 1);
  setPaused(false);
}
try {
  try {
    const saved = await new SaveStore().read('settings');
    if (saved) settings = validateSettings(saved);
  } catch (error) {
    controlStatus.textContent = `Using default controls: ${error instanceof Error ? error.message : String(error)}`;
  }
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
  engine.onContextRestoredObservable.add(() => presentation.request());
  reset();
  pause.addEventListener('click', () => setPaused(!paused), eventOptions);
  restart.addEventListener('click', reset, eventOptions);
  loadAsset.addEventListener(
    'click',
    async () => {
      const currentScene = scene!,
        signal = assetLoad.signal;
      loadAsset.disabled = true;
      assetStatus.textContent = 'Loading and verifying the existing authored Formula asset…';
      try {
        const { loadExistingPlayer } = await import('./existing-player.ts');
        const container = await loadExistingPlayer(currentScene.scene, document.baseURI, signal);
        let steering: ExistingPlayerSteering;
        let wheels: ExistingPlayerWheels;
        try {
          wheels = new ExistingPlayerWheels([...container.transformNodes, ...container.meshes]);
          steering = new ExistingPlayerSteering(container.animationGroups);
        } catch (error) {
          container.dispose();
          throw error;
        }
        container.addAllToScene();
        playerSteering = steering;
        playerWheels = wheels;
        for (const node of container.rootNodes) {
          node.parent = currentScene.entrants[0];
          if (node instanceof TransformNode) node.position.y -= 0.25; // Same suspension datum as the Three.js adapter.
        }
        currentScene.scene.getMeshByName('migration-proxy-0')?.setEnabled(false);
        assetStatus.textContent = 'Preparing original model materials for rendering…';
        const finishPreparation = presentation.prepare();
        try {
          await waitForPresentation(currentScene.scene, signal);
        } finally {
          finishPreparation();
        }
        if (signal.aborted) return;
        assetStatus.textContent =
          'Original Formula asset loaded in Babylon. Driver and rigid wheel motion follow physics; tyre deformation, LOD and full material parity are still pending.';
      } catch (error) {
        if (signal.aborted) return;
        loadAsset.disabled = false;
        assetStatus.textContent = `Model unavailable: ${error instanceof Error ? error.message : String(error)}. Retry is safe.`;
      }
    },
    eventOptions,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) setPaused(true);
      else presentation.request();
    },
    eventOptions,
  );
  window.addEventListener(
    'resize',
    () => {
      engine?.resize();
      presentation.request();
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
    const now = performance.now(),
      seconds = (now - last) / 1000;
    last = now;
    component.advance(seconds);
    if (playerSteering)
      assetStatus.dataset.steering = String(playerSteering.apply(component.frame));
    if (playerWheels) assetStatus.dataset.wheelPhase = String(playerWheels.apply(component.frame));
    if (presentation.shouldRender(paused)) {
      const readyBefore = scene!.scene.isReady();
      scene!.render(component.frame);
      const readyAfter = scene!.scene.isReady();
      presentation.rendered(readyBefore, readyAfter);
      const ready = readyBefore && readyAfter;
      status.dataset.sceneReady = String(ready);
      status.dataset.renderedFrames = String(++renderedFrames);
    }
    if (now - lastStatus > 250) {
      lastStatus = now;
      status.dataset.steer = String(component.frame[carBase(0) + F.STEER]);
      status.dataset.throttle = String(component.frame[carBase(0) + F.THROTTLE]);
      status.textContent = `${paused ? 'PAUSED' : component.simulation.autoPlayer ? 'AI DEMO' : 'DRIVING'} · ${Math.round(component.frame[carBase(0) + F.SPEED] * 3.6)} km/h · physics tick ${component.simulation.tick}`;
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      assetLoad.abort();
      playerSteering?.dispose();
      playerWheels?.dispose();
      abort.abort();
      inputPump?.dispose();
      input?.dispose();
      engine?.stopRenderLoop();
      scene?.dispose();
      engine?.dispose();
    },
    { once: true },
  );
} catch (error) {
  inputPump?.dispose();
  input?.dispose();
  engine?.stopRenderLoop();
  scene?.dispose();
  engine?.dispose();
  abort.abort();
  status.textContent = `Babylon could not start: ${error instanceof Error ? error.message : String(error)}. The full game remains available through the link above.`;
}
