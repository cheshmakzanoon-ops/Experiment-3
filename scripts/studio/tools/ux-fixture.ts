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
import { nextFromPlan } from '../../../src/ui/results-board.ts';
import { seasonPlan } from '../../../src/career/next-up.ts';
import { payoutPanel } from '../../../src/ui/career-hub.ts';

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
/** The race results as a driver with a career sees them: the podium, a payment and the next event. */
export function resultsCareer(position = 2) {
  const simulation = mount();
  ui.options = simulation.options;
  ui.showMode('results');
  const frame = finishedFrame(simulation);
  const cars = Math.round(frame[H.CARS]);
  let next = 1;
  for (let id = 0; id < cars; id++) {
    if (id === 0) frame[carBase(0) + F.RANK] = position;
    else {
      if (next === position) next++;
      frame[carBase(id) + F.RANK] = next++;
    }
  }
  for (let id = 0; id < cars; id++)
    frame[carBase(id) + F.FINISH] = 181.2 + (frame[carBase(id) + F.RANK] - 1) * 2.31;
  const registry = liveRegistry();
  const save = buyVehicle(newCareer(), registry, 'tc1');
  ui.resultsNext = nextFromPlan(
    seasonPlan(registry, {
      ...save,
      licences: { braking: { medal: 'silver', best: 2, attempts: 1 } },
    }),
  );
  ui.resultsExtra = payoutPanel(
    {
      lines: [
        { label: 'Classified finish × 0.5', amount: 4500 },
        { label: 'Podium objective', amount: 1250 },
      ],
      total: 5750,
      reputation: 3,
      paid: true,
      reason: null,
      awarded: null,
    },
    'saved',
    registry,
    false,
  );
  ui.results(frame);
}
export function settings() {
  mount();
  ui.settings(structuredClone(DEFAULT_SETTINGS));
}
/** The settings screen scrolled to the graphics guide and the accessibility group. */
export function settingsGuide() {
  mount();
  ui.settings(structuredClone(DEFAULT_SETTINGS));
  document.querySelector('.gq')!.scrollIntoView({ block: 'start' });
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

// ---- Wave 3: the season board, Team HQ, loading ----------------------------------------
import { teamHub } from '../../../src/ui/team-hub.ts';
import { PhotoStudio } from '../../../src/ui/photo-studio.ts';
import { ReplayHud } from '../../../src/ui/replay-hud.ts';
import { DEFAULT_LIVERY } from '../../../src/storage/livery.ts';
import { renderShareCard } from '../../../src/ui/results-card.ts';
import { circuitArt } from '../../../src/ui/track-art.ts';
import { newTeam } from '../../../src/storage/team-career.ts';
import { buyVehicle } from '../../../src/career/economy.ts';
import { liveRegistry } from '../../../src/career/registry.ts';

/** A real CareerController over an in-memory store, with the player's save given. */
function careerOn(save: CareerSave | null, simulation: Simulation) {
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
    setResultsExtra: () => {},
    start: () => {},
    pause: () => {},
    state: () => 'menu',
    track: () => simulation.track,
    setup: () => simulation.options.setup,
    assist: () => 'sport',
  });
  if (save) career.save = save;
  return career;
}
/** The career opened on a page for a brand-new driver (nothing earned yet). */
export function career(page: 'hub' | 'events' | 'licences' | 'garage' | 'dealership' = 'hub') {
  const simulation = mount();
  ui.showMode('menu');
  careerOn(null, simulation).open(page);
}
/** A driver a few weeks in: a machine, two licence medals, reputation and results. */
export function careerPlayed(
  page: 'hub' | 'events' | 'licences' | 'garage' | 'dealership' = 'hub',
) {
  const simulation = mount();
  ui.showMode('menu');
  const registry = liveRegistry();
  let save = buyVehicle(newCareer(), registry, 'tc1');
  save = {
    ...save,
    credits: 61250,
    reputation: {
      ...save.reputation,
      'circuit-cars': 14,
      'road-bikes': 4,
      'off-road': 0,
      festival: 2,
    },
    licences: {
      braking: { medal: 'silver', best: 1.9, attempts: 3 },
      cornering: { medal: 'bronze', best: 1.2, attempts: 2 },
    },
    results: { 'circuit-cars.recovery': { bestPosition: 2, bestLap: 0, starts: 1 } },
  };
  careerOn(save, simulation).open(page);
}
/** The played season board scrolled to its licence ladder (the part below the fold). */
export function careerLadder() {
  careerPlayed('hub');
  document.querySelector('.cb-ladder')!.scrollIntoView({ block: 'start' });
  (document.getElementById('modal') as HTMLElement).scrollTop += 0;
}
export function team() {
  mount();
  ui.showMode('menu');
  ui.modalContent(teamHub(newTeam(), 'overview'));
}
/** The loading board for a Vellamar race (bar at 62 percent). */
export function loadingScreen() {
  const simulation = mount();
  ui.showMode('loading');
  ui.options = simulation.options;
  ui.loadingSession(simulation.options);
  ui.loadingScene(simulation.options);
  ui.loading('62% · Building the circuit…');
}
/** The first-launch screen over the paddock board. */
export function firstRun(device: 'keys' | 'pad' = 'keys') {
  mount();
  ui.showMode('menu');
  ui.firstRun(device, DEFAULT_BINDINGS);
}
/** The photo studio and livery editor over a stand-in scene (no renderer). */
export function photo() {
  mount();
  ui.showMode('photo');
  const studio = new PhotoStudio(document.getElementById('app')!, {
    change() {},
    preview() {},
    save: async () => {},
    capture() {},
    close() {},
  });
  studio.element.hidden = false;
  studio.open({ ...DEFAULT_LIVERY }, 8);
}
/** The replay bar and the lower third naming the followed driver. */
export function replay() {
  mount();
  ui.showMode('replay');
  const hud = new ReplayHud(document.getElementById('app')!);
  hud.lowerThirdElement.querySelector('b')!.textContent = 'P3';
  hud.lowerThirdElement.querySelector('em')!.textContent = 'SATO';
  hud.lowerThirdElement.querySelector('small')!.textContent = 'LAP 2';
  hud.lowerThirdElement.dataset.on = 'true';
}
/** The result share card as the PNG a player saves, shown at its own size. */
export async function shareCard() {
  mount();
  const blob = await renderShareCard({
    session: 'Grand Prix · 3 laps',
    venue: 'Aurel Grand Circuit',
    machine: 'APX-01 Formula',
    weather: 'DRY',
    player: 'Alex River',
    position: 2,
    field: 8,
    finished: true,
    raceTime: '3:01.200',
    bestLap: '0:58.400',
    gaps: ['+2.310 s to the winner'],
    podium: [
      { place: 1, name: 'A. MOREAU', time: '2:58.890' },
      { place: 2, name: 'ALEX RIVER', time: '3:01.200' },
      { place: 3, name: 'K. SATO', time: '3:05.820' },
    ],
    path: circuitArt('aurel').d,
    date: '3 Nov 2026',
  });
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.style.cssText = 'position:fixed;left:40px;top:45px;width:1200px;height:630px';
  document.body.replaceChildren(img);
  await img.decode();
}
