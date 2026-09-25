import { Color } from 'three';
import { Interface } from '../../src/ui/interface.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import type { RacingRenderer, CameraMode } from '../../src/rendering/renderer.ts';

/** DOM-only component fixture. No GameApp, WebGL renderer or gameplay evidence. */
export function raceHudLayout(camera: CameraMode, uiScale: number, guidance: boolean) {
  const root = document.createElement('main');
  root.id = 'fixture';
  document.body.replaceChildren(root);
  document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 11 });
  const noop = () => {};
  const ui = new Interface(root, sim.track, {
    action: noop,
    start: noop,
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
  });
  ui.ready();
  ui.showMode('driving');
  const frame = sim.makeFrame();
  frame[H.PHASE] = 1;
  frame[H.LIGHTS] = 5;
  frame[carBase(0) + F.SPEED] = 45;
  frame[carBase(0) + F.GEAR] = 5;
  const renderer = {
    mode: camera,
    debug: false,
    cars: [{ paint: { color: new Color(0xe45d40) } }],
  } as unknown as RacingRenderer;
  for (let i = 0; i < 3; i++) ui.update(frame, renderer, true, 1);
  ui.get('programmeHud').hidden = !guidance;
  ui.get('programmeHud').textContent = 'CONSISTENCY PROGRAMME · ATTEMPT 3 / 5 · VALID';
  ui.get('guideReadout').hidden = !guidance;
  ui.get('guideReadout').textContent = 'NEXT CORNER · BRAKE 150 M · TURN 7';
  const label = document.createElement('p');
  label.textContent = 'DOM-ONLY HUD LAYOUT FIXTURE — NO GAMEPLAY OR 3D RENDER';
  label.style.cssText =
    'position:fixed;bottom:4px;left:4px;font:11px monospace;color:white;background:black;z-index:999';
  document.body.append(label);
}

/** DOM-only proof that grid preparation does not enter physics configuration. */
export function gridPreparationControls() {
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const log = document.createElement('output');
  log.id = 'gridPreparationResult';
  const noop = () => {};
  const ui = new Interface(root, new Simulation(DEFAULT_OPTIONS).track, {
    action: noop,
    start: (options, holdOnGrid) => {
      log.textContent = JSON.stringify({ options, holdOnGrid });
    },
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
  });
  document.body.append(log);
  ui.ready();
  ui.showMode('menu');
}

/** Production Interface/CSS with a real #app wrapper; no renderer or GameApp.
 * Settings are applied to fixture-local state, never claimed as persisted saves. */
export function menuNavigation() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  document.documentElement.style.setProperty('--ui-scale', '1');
  const output = document.createElement('output');
  output.id = 'menuNavigationResult';
  output.hidden = true;
  const state = { action: '', appliedQuality: '', starts: 0, held: false };
  const record = () => {
    output.textContent = JSON.stringify(state);
  };
  let settings = structuredClone(DEFAULT_SETTINGS);
  const noop = () => {};
  const ui = new Interface(root, new Simulation(DEFAULT_OPTIONS).track, {
    action: (action) => {
      state.action = action;
      record();
      if (action === 'settings') ui.settings(settings);
      else if (action === 'controls') ui.controls(settings.bindings);
      else if (action === 'modalClose') ui.closeModal();
    },
    apply: (next) => {
      settings = next;
      state.appliedQuality = next.quality;
      record();
      ui.closeModal();
    },
    start: (_options, held) => {
      state.starts++;
      state.held = held === true;
      record();
    },
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
  });
  root.append(output);
  record();
  ui.ready();
  ui.showMode('menu');
}
