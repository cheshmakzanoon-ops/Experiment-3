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
import { newCareer, type CareerSave } from '../../../src/career/save.ts';
import { CareerController } from '../../../src/career/controller.ts';
import {
  wildcardCareerEvent,
  wildcardEntry,
  wildcardKey,
  wildcardSession,
} from '../../../src/career/wildcard-series.ts';
import { wildcardBoardHtml, wildcardProgress } from '../../../src/ui/wildcard-board.ts';

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

// ---- Wave 2: the Wildcard board, its result banner, the door with progress -------------
/** A career a few events in: medals from every rung of the ladder. */
function playedCareer(): CareerSave {
  const save = newCareer();
  const record = (id: string, bestPosition: number, bestLap = 0) => {
    save.results[wildcardKey({ id })] = { bestPosition, bestLap, starts: 2 };
  };
  record('descent-in-the-cloud', 1);
  record('formula-on-the-wall', 2);
  record('hypercars-in-the-harbour', 5);
  record('karts-after-dark', 6);
  record('knobblies-on-the-banking', 3);
  record('hypercar-roof-deck-attack', 1, 40.8);
  return save;
}
export function menuProgress() {
  menu();
  ui.setWildcardProgress(wildcardProgress(playedCareer()));
  ui.setContinue({
    version: 1,
    kind: 'form',
    fields: {
      mode: 'race',
      circuit: 'vellamar',
      vehicle: 'apx01',
      laps: '3',
      weather: 'clear',
      opponents: '7',
      compound: 'medium',
      assist: 'sport',
      startSlot: 'pole',
    },
  });
}
export function wildcardBoard(id = 'karts-after-dark') {
  mount();
  ui.showMode('menu');
  ui.modalContent(wildcardBoardHtml(playedCareer(), id));
}
/** Drive the real CareerController through a finished Wildcard race (settleRace, medal, pay). */
export async function wildcardResult(id = 'karts-after-dark', position = 2) {
  const entry = wildcardEntry(id)!;
  const simulation = mount(wildcardSession(entry));
  ui.options = simulation.options;
  ui.showMode('results');
  const stored = new Map<string, unknown>();
  const career: CareerController = new CareerController({
    store: {
      read: async (key) => stored.get(key),
      write: async (key, value) => void stored.set(key, value),
      writeWithBackup: async (key, value) => void stored.set(key, value),
    },
    modal: (html) => ui.modalContent(html),
    modalRoot: () => document.getElementById('modalContent')!,
    toast: () => {},
    setResultsExtra: (html) => (ui.resultsExtra = html),
    setResultsLead: (html) => (ui.resultsLead = html),
    start: () => {},
    pause: () => {},
    state: () => 'results',
    track: () => simulation.track,
    setup: () => simulation.options.setup,
    assist: () => 'sport',
  });
  career.save = playedCareer();
  career.begin(
    {
      kind: 'race',
      event: { ...wildcardCareerEvent(entry), tier: 'wildcard' },
      licence: null,
      vehicle: [entry.event.vehicles].flat()[0],
      setup: null,
      round: -1,
      light: entry.lighting,
    },
    'fixture-session',
  );
  const frame = finishedFrame(simulation);
  // The snapshot's rank is 1-based (1 leads): the player takes `position`, the others fill the rest in order.
  const cars = Math.round(frame[H.CARS]);
  let next = 1;
  for (let id = 0; id < cars; id++) {
    if (id === 0) frame[carBase(0) + F.RANK] = position;
    else {
      if (next === position) next++;
      frame[carBase(id) + F.RANK] = next++;
    }
  }
  career.finish(frame, undefined);
  ui.results(frame);
  await new Promise((resolve) => setTimeout(resolve, 80));
  // The payment settles after the write: show the saved state.
  ui.results(frame);
}
