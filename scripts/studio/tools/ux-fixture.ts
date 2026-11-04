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
import { F, H, W, WHEEL_BASE, carBase } from '../../../src/simulation/protocol.ts';
import { FLAG } from '../../../src/simulation/marshal.ts';
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
import { loadRecords, recordsHtml, type RecordsTab } from '../../../src/ui/records-board.ts';
import { createDemoPolicy, useDemoPolicy } from '../../../src/release/demo.ts';
import { insertLeaderboard, leaderboardKey } from '../../../src/storage/leaderboard.ts';
import { SIMULATION_VERSION } from '../../../src/core/session-identity.ts';
import { ghostKey } from '../../../src/core/ghost-lap.ts';

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

/** RECORDS with a few synthetic laps (a screen check, not a recording of play). */
export async function records(tab: RecordsTab = 'time-trial', steam = true) {
  mount();
  ui.showMode('menu');
  const lap = (lapTime: number, session: string, weather = 'clear', assist = 'sport') => ({
    lapTime,
    driver: 'ALEX RIVER',
    assist,
    compound: 'medium',
    weather,
    session,
  });
  const board = (...laps: ReturnType<typeof lap>[]) =>
    laps.reduce<unknown>((value, entry) => insertLeaderboard(value, entry).board, []);
  const data = new Map<string, unknown>([
    [
      leaderboardKey('aurel', 'apx01', SIMULATION_VERSION),
      board(lap(81.234, 'a'), lap(82.9, 'b', 'rain'), lap(83.5, 'c'), lap(84.01, 'd', 'clear', 'raw')),
    ],
    [leaderboardKey('vellamar', 'gpr1', SIMULATION_VERSION), board(lap(95.25, 'e'), lap(96.8, 'f'))],
    [leaderboardKey('alpine-pass', 'apx01', SIMULATION_VERSION), board(lap(301.5, 'g', 'fog'))],
    [leaderboardKey('aurel'), board(lap(70, 'h'))],
    [ghostKey('aurel', 'apx01'), {}],
    [ghostKey('vellamar', 'gpr1'), {}],
  ]);
  const career = playedCareer();
  const view = await loadRecords({
    store: {
      read: async (key) => data.get(key),
      keys: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    },
    career,
    boards: null,
    steam: steam
      ? { supported: true, online: false, reason: 'Steam client not running', pending: 3, sent: 0 }
      : null,
  });
  ui.modalContent(recordsHtml(view, tab));
}
export const recordsWildcard = () => records('wildcard', false);

/** The Steam demo's paddock (the FULL GAME plate, locked lists) from the real Interface. */
export function demoMenu() {
  useDemoPolicy(createDemoPolicy());
  menu();
}
export function demoWildcard() {
  useDemoPolicy(createDemoPolicy());
  wildcardBoard('descent-in-the-cloud');
}
/** The demo's Wildcard board with a locked (FULL GAME) event chosen: the tag sits on the paper row. */
export function demoWildcardLocked() {
  useDemoPolicy(createDemoPolicy());
  wildcardBoard('karts-after-dark');
}
/** RECORDS in the demo: locked events are listed dimmed. */
export function demoRecords() {
  useDemoPolicy(createDemoPolicy());
  return records('wildcard', false);
}

// ---- Wave 4 (design critic): every other screen --------------------------------------
import '../../../src/ui/grid-presentation.css';
import { GridPresentationPanel } from '../../../src/ui/grid-presentation.ts';
import { raceBriefing } from '../../../src/ui/race-briefing.ts';
import { drivingAcademy } from '../../../src/ui/driving-academy.ts';
import { eventHub } from '../../../src/ui/event-cards.ts';
import { EVENTS } from '../../../src/simulation/events.ts';
import { machineOptions } from '../../../src/ui/machine-options.ts';
import { openWorld } from '../../../src/simulation/open-world/world.ts';
import { resolveEvents } from '../../../src/simulation/open-world/festival-events.ts';
import { festivalVehicles } from '../../../src/simulation/open-world/session.ts';
import { FestivalHud } from '../../../src/ui/festival-hud.ts';
import { FestivalSkillChain } from '../../../src/simulation/open-world/skill-chain.ts';
import type { HubPage } from '../../../src/ui/team-hub.ts';
import type { SessionOptions } from '../../../src/simulation/config.ts';

/** Session options for one discipline's entry (the machine's own ruleset applied). */
function entryOptions(kind: 'circuit' | 'gp' | 'mx' | 'sx'): SessionOptions {
  const pick: Record<string, [string, string]> = {
    circuit: ['aurel', 'apx01'],
    gp: ['kansai-east', 'gpr1'],
    mx: ['valley-ridge-mx', 'mx450'],
    sx: ['arena-nord-sx', 'mx450'],
  };
  const [circuit, machine] = pick[kind];
  const options = { ...DEFAULT_OPTIONS, circuit: circuit as SessionOptions['circuit'] };
  return validateOptions({ ...options, ...machineOptions(options, machine) });
}
/** The race briefing over the grid (circuit and dirt variants). */
export function briefing(kind: 'circuit' | 'gp' | 'mx' = 'circuit') {
  const options = entryOptions(kind);
  const simulation = mount(options);
  ui.options = simulation.options;
  ui.showMode('pregame');
  ui.modalContent(raceBriefing(simulation.options, simulation.makeFrame()));
}
export const briefingGp = () => briefing('gp');
export const briefingMx = () => briefing('mx');
/** The pre-race grid presentation (the broadcast frame with its lower third and controls). */
export function gridPresentation() {
  const simulation = mount(entryOptions('circuit'));
  ui.options = simulation.options;
  ui.showMode('pregame');
  const panel = new GridPresentationPanel(document.getElementById('app')!, {
    toggle() {},
    seek() {},
    start() {},
    back() {},
  });
  panel.show('AUREL GRAND CIRCUIT', 'Eight cars. Three laps.', false);
  panel.caption('Pole position', 'APX-01 FORMULA · A. MOREAU');
}
/** The Driving Academy with two graded laps. */
export function academy() {
  mount();
  ui.showMode('menu');
  ui.modalContent(
    drivingAcademy(
      {
        active: true,
        finished: false,
        target: 61.842,
        clean: 2,
        message: 'Attempt 3 is next. Match the locked target.',
        attempts: [
          { seconds: 61.842, grade: 'gold', reason: 'First clean lap sets the target.' },
          { seconds: 63.4, grade: 'bronze', reason: 'Within 5% of the target.' },
        ],
      } as never,
      'full',
      false,
      'day',
      null,
    ),
  );
}
export function events() {
  mount();
  ui.showMode('menu');
  ui.modalContent(eventHub(EVENTS));
}
export function credits() {
  mount();
  ui.showMode('menu');
  ui.credits();
}
export function teamPage(page: HubPage = 'engineering') {
  mount();
  ui.showMode('menu');
  ui.modalContent(teamHub(newTeam(), page));
}
export const teamEngineering = () => teamPage('engineering');
export const teamPersonnel = () => teamPage('personnel');
export const teamFinance = () => teamPage('finance');
/** The loading board of one discipline's session (bar at 62 percent). */
export function loadingFor(kind: 'circuit' | 'gp' | 'mx' | 'sx' | 'festival') {
  const options = entryOptions(kind === 'festival' ? 'circuit' : kind);
  if (kind === 'festival') (options as { mode: string }).mode = 'festival';
  const simulation = mount(entryOptions(kind === 'festival' ? 'circuit' : kind));
  ui.showMode('loading');
  ui.options = simulation.options;
  // main.ts starts the festival without a session line (loadingSession is a race's); mirror that.
  if (kind !== 'festival') ui.loadingSession(options);
  ui.loadingScene(options);
  ui.loading('62% · Building the circuit…');
}
export const loadingGp = () => loadingFor('gp');
export const loadingMx = () => loadingFor('mx');
export const loadingSx = () => loadingFor('sx');
export const loadingFestival = () => loadingFor('festival');
/** A running race frame: the HUD of one machine family at speed, lap 2. */
export function hud(kind: 'circuit' | 'gp' | 'mx' = 'circuit') {
  const options = entryOptions(kind);
  const simulation = mount(options);
  ui.options = simulation.options;
  ui.showMode('driving');
  const frame = simulation.makeFrame();
  const o = carBase(0);
  frame[H.TICK] = 600;
  frame[H.TIME] = 74.2;
  frame[o + F.SPEED] = kind === 'circuit' ? 71 : kind === 'gp' ? 64 : 21;
  frame[o + F.GEAR] = kind === 'circuit' ? 6 : kind === 'gp' ? 4 : 3;
  frame[o + F.RPM] = kind === 'circuit' ? 11200 : 9400;
  frame[o + F.LAPS] = 1;
  frame[o + F.LAP_TIME] = 21.4;
  frame[o + F.BEST_LAP] = 58.9;
  ui.update(frame, renderer, false, 1);
  ui.update(frame, renderer, false, 1);
}
export const hudGp = () => hud('gp');
export const hudMx = () => hud('mx');
/** HUD states the plain `hud` frame does not show (race control, the pit lane, the start lights, a vehicle
 * warning, the VEHICLE panel, the GP corner guide): the same HUD with the frame, or the nodes, in that
 * state, so the legibility audit (hud-measure.mjs, e2e/65) measures every text the HUD can draw. DOM
 * fixtures over synthetic frames, not a race. `state:kind`, kind circuit | gp | mx. */
export function hudState(state: string, kind: 'circuit' | 'gp' | 'mx' = 'circuit') {
  const options = entryOptions(kind);
  const simulation = mount(options);
  ui.options = simulation.options;
  ui.showMode('driving');
  const frame = simulation.makeFrame();
  const o = carBase(0);
  frame[H.TICK] = 600;
  frame[H.TIME] = 74.2;
  frame[o + F.SPEED] = 71;
  frame[o + F.GEAR] = 5;
  frame[o + F.RPM] = 10800;
  frame[o + F.LAPS] = 1;
  frame[o + F.LAP_TIME] = 21.4;
  frame[o + F.BEST_LAP] = 58.9;
  if (state === 'banner') {
    frame[H.FLAG] = FLAG.DOUBLE_YELLOW;
    frame[o + F.CAUTION_SPEED] = 22;
  }
  if (state === 'pit') {
    frame[o + F.IN_PIT] = 1;
    frame[o + F.PIT_PHASE] = 3;
    frame[o + F.PIT_CLOCK] = 2.4;
  }
  if (state === 'start') {
    frame[H.PHASE] = 1;
    frame[H.LIGHTS] = 4;
  }
  if (state === 'alert') {
    frame[carBase(0) + WHEEL_BASE + W.PUNCTURED] = 1;
    ui.get('programmeHud').hidden = false;
    ui.get('programmeHud').textContent = 'CONSISTENCY PROGRAMME · ATTEMPT 3 / 5 · VALID';
    ui.get('guideReadout').hidden = false;
    ui.get('guideReadout').textContent = 'NEXT CORNER · BRAKE 150 M · TURN 7';
  }
  ui.update(frame, renderer, false, 1);
  ui.update(frame, renderer, false, 1);
  if (state === 'vehicle') document.querySelector<HTMLElement>('.vehicle-toggle')!.click();
  if (state === 'gpcraft') {
    // The corner guide, the practice timer and the tow readout appear only on an approach to a corner.
    const show = (id: string, text: string) => {
      const node = ui.get(id);
      node.hidden = false;
      node.textContent = text;
    };
    for (const id of ['gpCraft', 'gpCornerProgress', 'gpPractice', 'gpTow', 'gpPracticeSplit', 'gpPracticeStreak'])
      ui.get(id).hidden = false;
    show('gpCorner', 'T4 · LEFT HAIRPIN');
    show('gpCornerDistance', '120 M');
    show('gpAction', 'BRAKE NOW');
    show('gpAdvice', 'Trail the brake to the apex');
    show('gpTow', 'TOW 32%');
    show('gpPracticeLabel', 'T4 · PRACTICE');
    show('gpPracticeTime', '1.84 s');
    show('gpPracticeDetail', '-0.06 s vs best · target 1.90 s');
    show('gpPracticeSplit', 'ENTRY 0.82 · EXIT 1.02');
    show('gpPracticeStreak', 'CLEAN STREAK 3 · BEST 5');
  }
}
/** The festival HUD: free roam, the pause menu, an event card, the map (English-only legacy panels). */
export function festival(view: 'free' | 'menu' | 'card' | 'map' = 'free') {
  const root = document.createElement('main');
  root.id = 'app';
  root.style.cssText = 'position:fixed;inset:0';
  document.body.replaceChildren(root);
  const world = openWorld(),
    list = resolveEvents(world),
    vehicles = festivalVehicles();
  const noop = () => {};
  const hudView = new FestivalHud(root, world, list, vehicles, {
    start: noop,
    continue: noop,
    retry: noop,
    cancel: noop,
    reset: noop,
    resume: noop,
    exit: noop,
    lighting: noop,
    vehicle: noop,
    travel: noop,
    autopilot: noop,
    traffic: noop,
    map: noop,
    photo: noop,
  });
  const race = list.find((e) => e.spec.kind === 'sprint') ?? list[0];
  const status = {
    mode: view === 'card' ? 'card' : 'free',
    time: 0,
    vehicleId: vehicles[0].id,
    speedKmh: 96,
    discovered: list.slice(0, 4).map((e) => e.spec.id),
    autopilot: false,
    card:
      view === 'card'
        ? {
            id: race.spec.id,
            name: race.spec.name,
            kind: race.spec.kind,
            blurb: race.spec.blurb,
            distanceKm: race.distance / 1000,
            laps: race.spec.laps ?? 1,
            rivals: race.spec.rivals ?? 0,
          }
        : null,
    event: null,
    result: null,
    road: { name: 'Harbour Front', roadClass: 'town', limitKmh: 90, onRoad: true, surface: 'asphalt' },
    message: null,
    streaming: {},
    traffic: { enabled: true, cars: 0 },
    skills: new FestivalSkillChain().status(),
  };
  hudView.update(status as never, 560, -2602, 0, 0, 0);
  if (view === 'menu')
    hudView.showMenu(true, {
      lighting: 'day',
      vehicle: vehicles[0].id,
      discovered: status.discovered,
      autopilot: false,
      inEvent: false,
      traffic: true,
    });
  if (view === 'map') hudView.showMap(true, new Set(status.discovered), { x: 560, z: -2602 });
}
/** The telemetry dialog (ENGINEERING / DATA) as it opens, over the paused HUD. */
export function telemetry() {
  const simulation = mount();
  ui.options = simulation.options;
  ui.showMode('paused');
  ui.update(simulation.makeFrame(), renderer, false, 1);
  ui.telemetryModal.showModal();
}
/** The application error screen (reload and lower the render quality). */
export function errorScreen() {
  mount();
  ui.showMode('menu');
  ui.error('Fixture error: the renderer could not be created.');
}
export const festivalMenu = () => festival('menu');
export const festivalCard = () => festival('card');
export const festivalMap = () => festival('map');
