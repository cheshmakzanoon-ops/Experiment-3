// DOM-only fixture of the production Interface (no renderer, no WebGL) for fast
// front-end iteration and for the pause/results/settings screenshots. Built and
// driven by uxdom.mjs. Not a gameplay recording.
import { Color } from 'three';
import '@fontsource-variable/saira/wdth.css';
import '@fontsource-variable/saira/wdth-italic.css';
import '../../../src/ui/style.css';
import { DEFAULT_OPTIONS, validateOptions } from '../../../src/simulation/config.ts';
import { DEFAULT_BINDINGS } from '../../../src/input/bindings.ts';
import { DEFAULT_SETTINGS } from '../../../src/storage/data.ts';
import { F, H, carBase } from '../../../src/simulation/protocol.ts';
import { Simulation } from '../../../src/simulation/world.ts';
import { Interface } from '../../../src/ui/interface.ts';
import type { RacingRenderer } from '../../../src/rendering/renderer.ts';

let ui: Interface;
const renderer = {
  mode: 'chase',
  debug: false,
  cars: [{ paint: { color: new Color(0xe5a157) } }],
} as unknown as RacingRenderer;

function mount(options = DEFAULT_OPTIONS) {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  document.body.style.cssText =
    'margin:0;background:radial-gradient(ellipse at 62% 62%,#3a3d42 0,#17181b 38%,#0b0c0d 70%)';
  const noop = () => {};
  const simulation = new Simulation(validateOptions(options));
  ui = new Interface(root, simulation.track, {
    action: (name) => {
      if (name === 'modalClose') ui.closeModal();
    },
    start: noop,
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
    previewMachine: noop,
  });
  ui.ready();
  return simulation;
}

export function menu(scale = 1) {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  mount();
  ui.showMode('menu');
}
/** Drive the real board controls like a player: ids are the form's own. */
export function pick(id: string, value: string) {
  const el = document.getElementById(id) as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
export function plate(discipline: string) {
  (document.querySelector(`.lb-plate[data-discipline="${discipline}"]`) as HTMLElement).click();
}

function finishedFrame(simulation: Simulation) {
  const frame = simulation.makeFrame();
  const cars = Math.round(frame[H.CARS]);
  for (let id = 0; id < cars; id++) {
    const o = carBase(id);
    frame[o + F.RANK] = id;
    frame[o + F.LAPS] = 3;
    frame[o + F.FINISH] = 181.2 + id * 2.31;
    frame[o + F.BEST_LAP] = 58.4 + id * 0.173;
    frame[o + F.PENALTY] = id === 3 ? 5 : 0;
  }
  return frame;
}
export function pause() {
  const simulation = mount();
  ui.options = simulation.options;
  ui.showMode('driving');
  ui.update(simulation.makeFrame(), renderer, false, 1);
  ui.showMode('paused');
  ui.pause();
}
export function results() {
  const simulation = mount();
  ui.options = simulation.options;
  ui.showMode('results');
  ui.results(finishedFrame(simulation));
}
export function settings() {
  mount();
  ui.settings(structuredClone(DEFAULT_SETTINGS));
}
export function controls() {
  mount();
  ui.controls({ ...DEFAULT_BINDINGS });
}
export function championship() {
  mount();
  ui.championship(null);
}
