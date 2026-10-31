import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { BabylonCircuitScene } from './circuit-scene.ts';
import { SimulationComponent } from '../simulation-component.ts';
import { DEFAULT_OPTIONS, controls } from '../../simulation/config.ts';
import { F, carBase } from '../../simulation/protocol.ts';
import './preview.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const loadAsset = document.querySelector<HTMLButtonElement>('#loadAsset')!;
const assetStatus = document.querySelector<HTMLOutputElement>('#assetStatus')!;
let assetLoad = new AbortController();
const keys = new Set<string>();
const abort = new AbortController();
const eventOptions = { signal: abort.signal };
let engine: Engine | undefined;
let scene: BabylonCircuitScene | undefined;
let component: SimulationComponent;
let paused = false,
  last = performance.now(),
  lastStatus = 0;
function setPaused(value: boolean) {
  paused = value;
  keys.clear();
  component.setPaused(value);
  last = performance.now();
  pause.textContent = value ? 'Resume' : 'Pause';
}
function reset() {
  assetLoad.abort();
  assetLoad = new AbortController();
  loadAsset.disabled = false;
  assetStatus.textContent = 'Original authored asset is optional in this diagnostic preview.';
  scene?.dispose();
  component = new SimulationComponent({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  scene = new BabylonCircuitScene(engine!, component.simulation.track, 1);
  setPaused(false);
}
try {
  engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
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
        container.addAllToScene();
        for (const node of container.rootNodes) {
          node.parent = currentScene.entrants[0];
          if (node instanceof TransformNode) node.position.y -= 0.25; // Same suspension datum as the Three.js adapter.
        }
        currentScene.scene.getMeshByName('migration-proxy-0')?.setEnabled(false);
        assetStatus.textContent =
          'Original Formula asset loaded in Babylon. LOD, driver and wheel animation parity are still pending.';
      } catch (error) {
        if (signal.aborted) return;
        loadAsset.disabled = false;
        assetStatus.textContent = `Model unavailable: ${error instanceof Error ? error.message : String(error)}. Retry is safe.`;
      }
    },
    eventOptions,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)
        return;
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyG', 'Escape'].includes(event.code))
        event.preventDefault();
      if (!event.repeat && event.code === 'Escape') setPaused(!paused);
      else if (!event.repeat && event.code === 'KeyG')
        component.simulation.autoPlayer = !component.simulation.autoPlayer;
      else keys.add(event.code);
    },
    eventOptions,
  );
  window.addEventListener('keyup', (event) => keys.delete(event.code), eventOptions);
  window.addEventListener('blur', () => setPaused(true), eventOptions);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) setPaused(true);
    },
    eventOptions,
  );
  window.addEventListener('resize', () => engine?.resize(), eventOptions);
  engine.runRenderLoop(() => {
    const now = performance.now(),
      seconds = (now - last) / 1000;
    last = now;
    component.setInput({
      ...controls(),
      throttle: Number(keys.has('KeyW')),
      brake: Number(keys.has('KeyS')),
      steer: Number(keys.has('KeyA')) - Number(keys.has('KeyD')),
    });
    component.advance(seconds);
    scene!.render(component.frame);
    if (now - lastStatus > 250) {
      lastStatus = now;
      status.textContent = `${paused ? 'PAUSED' : component.simulation.autoPlayer ? 'AI DEMO' : 'DRIVING'} · ${Math.round(component.frame[carBase(0) + F.SPEED] * 3.6)} km/h · physics tick ${component.simulation.tick}`;
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      assetLoad.abort();
      abort.abort();
      engine?.stopRenderLoop();
      scene?.dispose();
      engine?.dispose();
    },
    { once: true },
  );
} catch (error) {
  engine?.stopRenderLoop();
  scene?.dispose();
  engine?.dispose();
  abort.abort();
  status.textContent = `Babylon could not start: ${error instanceof Error ? error.message : String(error)}. The full game remains available through the link above.`;
}
