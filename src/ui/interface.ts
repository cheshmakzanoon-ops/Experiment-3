import { currentLocale, fixed, t, ta, th, upper } from '../i18n/index.ts';
import { validateLanguage, type LanguageSetting } from '../i18n/locales.ts';
import { settingsLanguageRow } from './language-control.ts';
import { N_ } from '../i18n/mark.ts';
import { wildcardTitle } from '../i18n/data.ts';
import { installRaceDayHud, updateRaceDayHud } from './race-day-hud.ts';
import { BikeHud } from './bike-hud.ts';
import { vehicleAt, vehicleDefinition } from '../simulation/vehicles.ts';
import { gpGridForVehicles } from '../simulation/gp-grid.ts';
import {
  SESSION_RULES_FIELDS,
  machineOptions,
  machineSelectOptions,
  sessionRulesSummary,
} from './machine-options.ts';
import {
  applySetupScreen,
  setupMachine,
  setupSaveNote,
  setupSectionHtml,
  type SetupContext,
} from './setup-screen.ts';
import { installCompactRaceHud } from './compact-race-hud.ts';
import {
  compoundOf,
  fastestLapCar,
  installF1Hud,
  revLedThresholds,
  surname,
  towerWindow,
  tyreBand,
  type F1Hud,
} from './f1-hud.ts';
import { TrackMap } from './f1-minimap.ts';
import { installSpeedTunnel } from '../rendering/studio/speed-tunnel.ts';
import { SectorBoard } from './sector-timing.ts';
import { audioAccessibility, readDrivingAudio } from './audio-accessibility.ts';
import { audioMixer, readAudioMixer } from './audio-mixer.ts';
import type { DrivingAudioSettings } from '../audio/driving-cues.ts';
import { nearbyTraffic } from './proximity.ts';
import { GapTimer, formatInterval } from './gap-timer.ts';
import { BUTTON_ACTIONS, BUTTON_ACTION_LABELS } from '../input/button-actions.ts';
import { engineeringReport } from './engineering.ts';
import { flagLabel } from '../simulation/marshal.ts';
import { presentationControls, bindPresentation, weatherReadout } from './presentation.ts';
import { DeviceCalibrationPanel } from './device-calibration.ts';
import { developerMode } from './dev-mode.ts';
import { LOADING_TIPS, loadingStage } from './loading-copy.ts';
import { loadingTipsFor, type TipDiscipline } from './loading-tips.ts';
import { circuitArtSvg, regionArtSvg } from './track-art.ts';
import type { WildcardEntry } from '../career/wildcard-series.ts';
import { gridDrs } from '../simulation/drs.ts';
import {
  BINDING_LABELS,
  DEFAULT_BINDINGS,
  keyName,
  validateBindings,
  type BindingAction,
  type Bindings,
} from '../input/bindings.ts';
import { TELEMETRY_VIEWS, type TelemetryView } from '../storage/telemetry-plots.ts';
import {
  COMPOUNDS,
  DEFAULT_OPTIONS,
  DRIVERS,
  LIVERIES,
  QUALIFYING_TIMED_LAPS,
  SETUP_LIMITS,
  racingSession,
  startingGrid,
  validateOptions,
  type SessionOptions,
  type Setup,
  type StartSlot,
} from '../simulation/config.ts';
import { rulesetFor, sessionIncompatibilities } from '../simulation/events.ts';
import { demoSessionLock } from '../release/demo-gates.ts';
import { demoBoardPlateHtml } from './demo-plate.ts';
import {
  WEATHER_CATALOGUE,
  isWeatherId,
  weatherOptionsHtml,
  type WeatherId,
} from '../simulation/weather-catalogue.ts';
import { setupStep } from './setup-page.ts';
import {
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  WHEEL_NAMES,
  carBase,
} from '../simulation/protocol.ts';
import { type Track } from '../simulation/track.ts';
import { circuitDefinition, type CircuitId } from '../simulation/circuits.ts';
import { CIRCUIT_MENU_LABELS, circuitBlurb, circuitOptionsHtml } from './circuit-menu.ts';
import {
  DEFAULT_CALENDAR,
  complete,
  nextRound,
  qualifyingGrid,
  standings,
  type Championship,
} from '../core/championship.ts';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
const CSS_WORDS: readonly (readonly [string, string])[] = [
  ['--t-paddock', N_('PADDOCK')],
  ['--t-chosen', N_('CHOSEN')],
  ['--t-smooth', N_('SMOOTH')],
  ['--t-playable', N_('PLAYABLE')],
  ['--t-low', N_('LOW')],
];
const DRS_ZONES = N_('{n, plural, one {DRS ZONE} other {DRS ZONES}}');
const CARS = N_('{n, plural, one {# car} other {# cars}}');
const RIDERS = N_('{n, plural, one {# rider} other {# riders}}');
const LAPS = N_('{n, plural, one {# lap} other {# laps}}');
/** Menu labels for each original circuit (lengths are asserted in tests). */
/** Short track-conditions chip: air temperature and surface state. */
export function conditions(ambientC: number, rainMmHr: number, meanWaterMm: number) {
  if (![ambientC, rainMmHr, meanWaterMm].every(Number.isFinite)) return '—';
  const surface =
    rainMmHr > 0.01
      ? N_('RAIN')
      : meanWaterMm >= 0.04
        ? N_('WET')
        : meanWaterMm > 0.001
          ? N_('DAMP')
          : N_('DRY');
  return `${th(surface)}<small>${Math.round(ambientC)}°C</small>`;
}
/** Player-facing session names (pause menu and loading screen). */
export const SESSION_TITLES: Readonly<Record<SessionOptions['mode'], string>> = Object.freeze({
  race: N_('Grand Prix'),
  practice: N_('Free Practice'),
  'time-trial': N_('Time Trial'),
  qualifying: N_('Qualifying'),
  endurance: N_('Endurance'),
});
export { CIRCUIT_MENU_LABELS };
/** Tyre compound in the player's language (`SOFT`, `FULL WET`), for the HUD and pause menu. */
const COMPOUND_NAMES: Readonly<Record<string, string>> = {
  soft: N_('SOFT'),
  medium: N_('MEDIUM'),
  hard: N_('HARD'),
  intermediate: N_('INTERMEDIATE'),
  wet: N_('WET'),
};
const compoundName = (compound: string) => t(COMPOUND_NAMES[compound] ?? compound.toUpperCase());
/** Camera name in the player's language. */
const CAMERA_NAMES: Readonly<Record<string, string>> = {
  chase: N_('CHASE'),
  cockpit: N_('COCKPIT'),
  pod: N_('POD'),
  trackside: N_('TRACKSIDE'),
};
const cameraName = (mode: string) => t(CAMERA_NAMES[mode] ?? mode.toUpperCase());
const weatherTag = (id: string) =>
  id === 'clear' ? t('CLEAR') : t(isWeatherId(id) ? WEATHER_CATALOGUE[id].tag : id.toUpperCase());
/** Player-facing circuit name, e.g. "Aurel Grand Circuit". */
export const circuitTitle = (id: CircuitId) =>
  (CIRCUIT_MENU_LABELS[id] ?? CIRCUIT_MENU_LABELS.aurel).split(' · ')[0];
/** Fit any circuit into the 250×240 map. Aurel keeps its original centre and
 * 0.24 px/m scale (it already fits); larger circuits are centred and scaled. */
export function minimapFrame(track: Track) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const fitsOriginal =
    125 + minX * 0.24 >= 12 &&
    125 + maxX * 0.24 <= 238 &&
    125 - maxZ * 0.23 >= 12 &&
    125 - minZ * 0.23 <= 228;
  if (fitsOriginal) return { cx: 0, cz: 0, scale: 0.24 };
  const scale = Math.min(220 / Math.max(1, maxX - minX), 210 / Math.max(1, maxZ - minZ));
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale };
}
import { type Settings, validateSettings } from '../storage/data.ts';
import { type RacingRenderer } from '../rendering/renderer.ts';
import { OffroadHud } from './offroad-hud.ts';
import { MotocrossStatusStack } from './motocross-status.ts';
import {
  installMotocrossMenu,
  motocrossKind,
  motocrossSessionTitle,
} from './motocross-presentation.ts';
import { CreditsGamepad, creditsHtml } from './credits.ts';
import {
  boardPlatesHtml,
  dialHtml,
  installHudIdentity,
  installLaunchBoard,
  type LaunchBoard,
} from './launch-board.ts';
import type { ContinueEntry } from './continue-entry.ts';
import { bindWildcardBoard, type WildcardProgress } from './wildcard-board.ts';
import { lightOptionsHtml, type LightChoice } from '../rendering/light-choice.ts';
import { glyph } from './glyphs.ts';
import { bindQualityGuide, qualityGuideHtml, readGpuName } from './settings-guide.ts';
import { resultRows, resultsBoardHtml, type ResultsNext } from './results-board.ts';
import {
  bindFirstRun,
  firstRunChoice,
  firstRunHtml,
  type FirstRunDevice,
} from './first-run.ts';
import type { BoardDiscipline } from './disciplines.ts';
import { MenuGamepad } from './menu-gamepad.ts';
import { uiCue } from './ui-cue.ts';
import { SOLVANE } from '../simulation/open-world/region-data.ts';
export const lapTime = (seconds: number) =>
  seconds > 0
    ? `${Math.floor(seconds / 60)}:${fixed(seconds % 60, 3).padStart(6, '0')}`
    : '—:——.———';
/** Timed-session tower cell: the session best in full, other times as a gap. */
export const timedGap = (best: number, sessionBest: number, holder: boolean) =>
  !(best > 0)
    ? '--:--.---'
    : holder || !(sessionBest > 0)
      ? lapTime(best)
      : `+${fixed(Math.max(0, best - sessionBest), 3)}`;
export const shortTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
/** Keep useful slider increments without rounding a valid researched/imported setup. */
export function setupControlStep(key: keyof Setup, value: number): number | 'any' {
  return setupStep(key, value, SETUP_LIMITS[key]);
}
interface Callbacks {
  action: (name: string) => void;
  start: (options: SessionOptions, holdOnGrid?: boolean) => void;
  apply: (settings: Settings) => void;
  seek: (value: number) => void;
  replaySpeed: (value: number) => void;
  exportSetup: () => void;
  importSetup: (file: File) => void;
  previewAudio?: (settings: DrivingAudioSettings) => void;
  /** Resolved player machine after a menu machine or circuit selection. */
  previewMachine?: (id: string) => void;
  /** The LIGHT dial changed (a player choice: the application stores and applies it). */
  light?: (choice: LightChoice) => void;
  /** A session was launched from the board's form: what CONTINUE should remember. */
  remember?: (entry: ContinueEntry) => void;
}
/** DOM writes only when the value changed: unchanged writes still dirty layout. */
function writeText(e: Element, value: string) {
  if (e.textContent !== value) e.textContent = value;
}
function writeWidth(e: HTMLElement, value: string) {
  if (e.style.width !== value) e.style.width = value;
}
/** Per-entry vehicles and the ruleset a MACHINE choice implies (WP22, WP30). */
export { machineOptions } from './machine-options.ts';
export class Interface {
  readonly menu: HTMLElement;
  readonly hud: HTMLElement;
  /** Terrain venues: gate, holeshot, joker and stage readout (WP42). */
  private readonly offroadHud: OffroadHud;
  private readonly motocrossStatus: MotocrossStatusStack;
  private readonly refreshMotocrossMenu: () => void;
  private bindings: Bindings = { ...DEFAULT_BINDINGS };
  readonly modal: HTMLDialogElement;
  readonly map: HTMLCanvasElement;
  readonly graph: HTMLCanvasElement;
  readonly replayBar: HTMLElement;
  private toastTimer = 0;
  private nodes = new Map<string, HTMLElement>();
  private panelFrames = 0;
  private panelTick = -Infinity;
  private panelTime = -Infinity;
  private lastAnnounced = '';
  private deviceCalibration: DeviceCalibrationPanel | null = null;
  /** The GPU's name from the browser (read once, for the settings guide); null when not reported. */
  private gpu: string | null | undefined;
  private creditsPad: CreditsGamepad | null = null;
  /** Controller navigation for the paddock board and modal screens. */
  private menuPad: MenuGamepad | null = null;
  private bindingCapture: AbortController | null = null;
  /** The paddock board (plates, dials, WILDCARD door, CONTINUE). */
  private board: LaunchBoard | null = null;
  /** Selection and keys of the Wildcard board while it is the modal. */
  private wildcardBinding: (() => void) | null = null;
  /** Roving radios of the first-launch screen while it is the modal. */
  private firstRunBinding: (() => void) | null = null;
  /** The settings screen's live parts (frame-rate meter, text-size preview), stopped when it closes. */
  private settingsBinding: (() => void) | null = null;
  private driverName = DRIVERS[0];
  /** The player's driver name (timing tower, results and paddock masthead). */
  get playerName() {
    return this.driverName;
  }
  set playerName(name: string) {
    this.driverName = name;
    const node = this.element?.querySelector('#menuDriver');
    if (node) node.textContent = name.toUpperCase();
  }
  /** Timing loops for the tower's race intervals, rebuilt per field/circuit. */
  private gaps: GapTimer | null = null;
  private gapPositions = new Float64Array(0);
  private towerRefresh = -Infinity;
  /** Per-sector session and personal bests (sector panel colours). */
  private sectors: SectorBoard | null = null;
  /** F1-style layout: cluster, tower header, sector panel, banners, tags. */
  private readonly f1: F1Hud;
  private readonly bikeHud: BikeHud;
  private practiceAutomatic = false;
  private readonly trackMap: TrackMap;
  private revThresholds = revLedThresholds();
  private revVehicle = '';
  options: SessionOptions = { ...DEFAULT_OPTIONS };
  /** Time Trial: saved personal best (0 when none) and the live ghost delta. */
  timeTrial: { best: number; delta: number | null } | null = null;
  /** Developer tools and raw diagnostics are shown only with `?dev`. */
  readonly developer = developerMode();
  /** Latest presented frame, for the pause menu's session summary. */
  private lastFrame: Float32Array | null = null;
  private loadingProgress = 0;
  /** The lap in the pause menu's short form, kept beside the HUD's lap label. */
  private lapSummary = '';
  private loadingTipIndex = 0;
  constructor(
    readonly element: HTMLElement,
    public track: Track,
    private callbacks: Callbacks,
  ) {
    const DEV = this.developer;
    element.innerHTML = `
  <div id="loading" class="loading" role="status" aria-live="polite" aria-busy="true"><div class="brand">MOTOBOUND<span>MOTORSPORT</span></div><div id="loadingMap" class="loading-map" aria-hidden="true"></div><p id="loadingSession" class="loading-session" hidden></p><div class="loading-progress"><div class="loading-row"><b id="loadingStage">${th('Loading')}</b><span id="loadingPercent">0%</span></div><div class="loader" id="loadingBar" role="progressbar" aria-label="${ta('Loading progress')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div><p id="loadingText" class="loading-detail"${DEV ? '' : ' hidden'}>Preparing circuit and car systems…</p><p id="loadingTip" class="loading-tip"><b>${th('TIP')}</b> ${th(LOADING_TIPS[0])}</p></div>
  <section id="menu" class="menu" hidden>
   <header class="masthead"><div class="brand">MOTOBOUND<span>MOTORSPORT</span></div><span class="edition">${th('DRIVER')} <b id="menuDriver">${escapeHtml(this.playerName.toUpperCase())}</b></span></header>
   <div class="menu-body" tabindex="0" role="region" aria-label="${ta('Race setup and tools')}"><div class="lb-board">${boardPlatesHtml()}<h1>${th('EVERY INPUT. EVERY FORCE.')}</h1><p class="intro">${th('Braking points, tyre management and racecraft.')}</p><div id="boardSeries" class="lb-series" hidden></div>${demoBoardPlateHtml()}
   <form id="sessionForm" class="session-form">
    <section class="lb-sheet" aria-label="${ta('Event')}">
     ${dialHtml('circuit', N_('CIRCUIT'), null, `<select id="circuit">${circuitOptionsHtml()}</select>`, 'lb-dial-venue')}
     <div id="regionTitle" class="lb-region-title" hidden><span class="lb-dial-name">${th('REGION')}</span><b>${escapeHtml(SOLVANE.name.toUpperCase())}</b></div>
     <div class="lb-sheet-row"><div class="lb-map" id="venueMap" aria-hidden="true"></div><div class="lb-sheet-body"><div class="eyebrow"><i></i> <span id="circuitEyebrow">${th('ORIGINAL')}</span></div>
     <div id="circuitStats" class="lb-stats"><span><b id="circuitLength">${fixed(track.length / 1000, 3)}</b> ${th('KM')}</span><span><b id="circuitTurns">${track.circuit.corners.length}</b> ${th('TURNS')}</span><span><b id="circuitDrs">${track.circuit.drsZones.length}</b> ${th(DRS_ZONES, { n: track.circuit.drsZones.length })}</span></div><div id="regionStats" class="lb-stats" hidden></div><p class="session-rules circuit-blurb" id="circuitBlurb">${escapeHtml(circuitBlurb(track.circuit.id))}</p></div></div></section>
    ${dialHtml('vehicle', N_('MACHINE'), 'wheel', `<select id="vehicle" aria-describedby="machineBlurb">${machineSelectOptions()}</select>`, 'lb-dial-machine')}
    <p class="session-rules machine-blurb" id="machineBlurb"></p>
    ${dialHtml('mode', N_('SESSION'), 'flag', `<select id="mode"><option value="race">${th('Grand Prix')}</option><option value="practice">${th('Free practice')}</option><option value="time-trial">${th('Time trial · ghost')}</option><option value="qualifying">${th('Race weekend · qualifying')}</option><option value="endurance">${th('Endurance · mandatory stop')}</option><option value="festival">${th('Festival · open world')}</option></select>`)}
    ${dialHtml('laps', N_('DISTANCE'), 'laps', `<select id="laps"><option value="1">${th('1 lap · Sprint')}</option><option value="3" selected>${th('3 laps · Standard')}</option><option value="5">${th('5 laps')}</option><option value="10">${th('10 laps')}</option><option value="15">${th('15 laps · Endurance')}</option><option value="25">${th('25 laps · Endurance')}</option></select>`)}
    ${dialHtml('weather', N_('WEATHER'), 'sun', `<select id="weather">${weatherOptionsHtml(th)}</select>`)}
    ${dialHtml('light', N_('LIGHT'), 'venue', `<select id="light" title="${ta('Applies when the session loads. The showroom stays studio-lit.')}">${lightOptionsHtml(th)}</select>`)}
    ${dialHtml('compound', N_('TYRES'), 'tyre', `<select id="compound"><option value="soft">${th('Soft')}</option><option value="medium" selected>${th('Medium')}</option><option value="hard">${th('Hard')}</option><option value="intermediate">${th('Intermediate')}</option><option value="wet">${th('Full wet')}</option></select>`)}
    ${dialHtml('assist', N_('ASSISTS'), 'wheel', `<select id="assist"><option value="sport">${th('ABS + TC')}</option><option value="raw">Off</option></select>`)}
    ${dialHtml('opponents', N_('GRID'), 'grid', `<select id="opponents"><option value="0">${th('Solo')}</option><option value="3">${th(CARS, { n: 4 })}</option><option value="7" selected>${th(CARS, { n: 8 })}</option><option value="11">${th(CARS, { n: 12 })}</option></select>`)}
    ${dialHtml('startSlot', N_('START'), 'start', `<select id="startSlot"><option value="pole" selected>${th('Pole')}</option><option value="midfield">${th('Midfield')}</option><option value="back">${th('Back row')}</option></select>`)}
    <p class="session-rules" id="sessionRules" aria-live="polite"></p>
    <button class="primary enter" type="submit">${th('ENTER CIRCUIT')} ${glyph('go', 'enter-glyph')}</button>
    <button class="enter" type="submit" name="prepareGrid" value="yes">${th('PREPARE GRID')} <span>${th('START PAUSED')}</span></button>
   </form></div><div class="menu-actions" role="group" aria-label="${ta('Paddock')}"><button data-action="career">${th('CAREER')}</button><button data-action="settings">${th('GARAGE & SETTINGS')}</button><button data-action="events">${th('EVENTS')}</button><button data-action="championship">${th('CHAMPIONSHIP')}</button><button data-action="records">${th('RECORDS')}</button><button data-action="team">${th('TEAM HQ')}</button><button data-action="academy">${th('DRIVING ACADEMY')}</button><button data-action="photo">${th('PHOTO / LIVERY')}</button><button data-action="controls">${th('CONTROLS')}</button><button data-action="credits">${th('CREDITS & LICENCES')}</button></div>${
     DEV
       ? '<div class="dev-tools" role="group" aria-label="Developer tools"><span>DEV</span><button data-action="references">REFERENCE REVIEW</button><button data-action="sessionReview">SESSION 146 EVIDENCE</button></div>'
       : ''
   }</div>
   <div class="car-label"><span>APX–01</span><b>FORMULA / HYBRID</b><div>770 KG DRY · 8 SPEED · 4 MJ ERS</div></div>
   <footer class="menu-footer"><span class="menu-keys" aria-hidden="true"><span data-device="keys"><kbd>TAB</kbd> ${th('MOVE')} · <kbd>←</kbd><kbd>→</kbd> ${th('CHANGE')} · <kbd>ENTER</kbd> ${th('GO')}</span><span data-device="pad"><kbd>A</kbd> ${th('SELECT')} · <kbd>B</kbd> ${th('BACK')} · <kbd>LB</kbd><kbd>RB</kbd> ${th('DISCIPLINE')} · <kbd>START</kbd> ${th('GO')}</span></span><span class="menu-hint"><kbd>WASD</kbd> / <kbd>ARROWS</kbd> ${th('DRIVE')} · <kbd>G</kbd> ${th('AI DRIVER')} · ${th('GAMEPAD READY')}</span><span id="buildIdentity"${DEV ? '' : ' hidden'}>DEV BUILD</span></footer>
  </section>
  <section id="hud" class="hud" hidden>
   <div class="hud-top"><div class="brand small">MOTOBOUND<span>LIVE</span></div><div class="position-badge" role="status" aria-label="${ta('Race position')}"><b id="positionBadge">P1</b><span id="positionField">/ 1</span></div><div class="session-status"><span id="lapLabel">LAP 1 / 3</span><b id="flag">GRID</b><span id="weatherLabel">24°C / ${th('DRY')}</span></div><button class="icon-button" data-action="pause" aria-label="${ta('Pause session')}">Ⅱ</button></div>
   <aside class="timing" tabindex="0" aria-label="${ta('Live race classification')}"><div class="panel-heading">${th('CLASSIFICATION')} <span id="towerColumn">${th('INTERVAL')}</span></div><div id="tower"></div></aside>
   <div class="lap-panel"><label class="lap-delta"><i id="lapDeltaLabel">${th('DELTA TO BEST')}</i><span id="lapDelta">—</span></label><label class="lap-current">${th('CURRENT LAP')}<b id="lapTime">—:——.———</b></label><label>${th('PERSONAL BEST')}<span id="bestLap">—:——.———</span></label><label>${th('LAST LAP')}<span id="lastLap">—:——.———</span></label></div>
   <div id="startSequence" class="start-sequence" hidden><div id="lights">${'<i></i>'.repeat(5)}</div><span id="startText">${th('BUILD REVS. HOLD THE BRAKE.')}</span></div>
   <div class="proximity proximity-left" id="proximityLeft" hidden><b>◀</b><span>${th('CAR LEFT')}</span></div><div class="proximity proximity-right" id="proximityRight" hidden><b>▶</b><span>${th('CAR RIGHT')}</span></div>
   <div class="race-message" id="raceMessage" role="status" aria-live="polite"></div>
   <div class="minimap"><canvas id="minimap" width="250" height="240"></canvas><span id="minimapCaption">${track.circuit.name}</span></div>
   <div class="instruments"><div class="programme-hud" id="programmeHud" hidden></div><div class="guide-readout" id="guideReadout" hidden></div><div class="rev-lights" id="rpmLights">${'<i></i>'.repeat(15)}</div><div class="dash-main"><div class="gear"><b id="gear">1</b><span>${th('GEAR')}</span></div><div class="speed"><b id="speed">0</b><span>${th('KPH')}</span></div><div class="engine"><b id="rpm">4200</b><span>${th('RPM')}</span><strong id="ersMode">${th('BALANCED')}</strong></div></div>
   <div class="pedals"><label>${th('BRK')}<span class="meter"><i id="brakeBar"></i></span></label><label>${th('THR')}<span class="meter"><i id="throttleBar"></i></span></label></div>
   <div class="resources"><label>${th('ERS')} <b id="battery">80%</b><span class="meter"><i id="batteryBar"></i></span></label><label>${th('FUEL')} <b id="fuel">${fixed(24, 1)} ${th('KG')}</b></label></div></div>
   <aside class="car-status"><div class="panel-heading">${th('VEHICLE STATE')} <span id="tireCompound">${th('MEDIUM')}</span></div><div id="tires" class="tires">${WHEEL_NAMES.map((name) => `<div><label>${name}</label><b>87°</b><span>100%</span><small>320° ${th('BRAKE')}</small></div>`).join('')}</div><div class="health"><span>${th('AERO')} <b id="health">100%</b></span><span>${th('LAT')} <b id="lateralG">${fixed(0, 1)} G</b></span><span>${th('PEN')} <b id="penalty">0 ${th('S')}</b></span></div></aside>
   <nav class="hud-actions"><button data-action="camera"><kbd>C</kbd> <span id="cameraLabel">${th('CHASE')}</span></button><button data-action="pit"><kbd>P</kbd> ${th('PIT')}</button><button data-action="ers"><kbd>E</kbd> ${th('ERS')}</button><button data-action="telemetry"><kbd>T</kbd> ${th('DATA')}</button><button data-action="replay"><kbd>R</kbd> ${th('REPLAY')}</button><button data-action="autopilot"><kbd>G</kbd> <span id="autoLabel">${th('AI OFF')}</span></button></nav>
   <div class="touch-controls"><button data-touch="left" aria-label="${ta('Steer left')}">◀</button><button data-touch="right" aria-label="${ta('Steer right')}">▶</button><button class="mx-body-touch" data-touch="riderForward" aria-label="${ta('Move rider weight forward')}"><span>${th('LEAN')}</span><b>${th('FWD')}</b></button><button class="mx-body-touch" data-touch="riderBack" aria-label="${ta('Move rider weight back')}"><span>${th('LEAN')}</span><b>${th('BACK')}</b></button><button data-touch="brake">${th('BRAKE')}</button><button data-touch="throttle">${th('THROTTLE')}</button></div>
  </section>
  <div id="replayBar" class="replay-bar" hidden><span class="replay-tag">${th('REPLAY')}</span><button data-action="replayPlay" id="replayPlay">${th('PAUSE')}</button><span id="replayTime">0:00</span><input id="replaySeek" type="range" min="0" max="1" step=".01" value="0" aria-label="${ta('Replay position')}"><select id="replaySpeed" aria-label="${ta('Replay playback speed')}"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button data-action="camera">${th('CAMERA')}</button><button data-action="photo">${th('PHOTO STUDIO')}</button><button data-action="replayExit">${th('RETURN')}</button></div>
  <div id="debug" class="debug" hidden></div><div id="toast" class="toast" role="status" hidden></div>
  <dialog id="modal"><div id="modalContent"></div></dialog>
  <dialog id="telemetryModal" class="telemetry-modal"><header><div><span class="eyebrow">${th('ENGINEERING / DATA')}</span><h2>${th('Telemetry')}</h2></div><button data-action="telemetryClose" aria-label="${ta('Close telemetry')}">✕</button></header><label class="telemetry-selector">${th('CHANNEL GROUP')}<select id="telemetryView" aria-label="${ta('Telemetry channels')}">${Object.entries(
    TELEMETRY_VIEWS,
  )
    .map(([key, view]) => `<option value="${key}">${view.title}</option>`)
    .join(
      '',
    )}</select></label><canvas id="graph" width="1100" height="590" role="img"></canvas><div class="telemetry-actions"><button data-action="compare">${th('COMPARE LAPS')}</button><button data-action="csv">${th('EXPORT CSV')}</button><span>${th('SI UNITS · RECORDED THIS SESSION')}</span></div></dialog>
  `;
    // Words the style sheets draw themselves (`content: var(--t-paddock, 'PADDOCK')`): the
    // English stays in the CSS, any other language arrives as custom properties on the root.
    if (currentLocale() !== 'en')
      for (const [name, word] of CSS_WORDS)
        document.documentElement.style.setProperty(name, JSON.stringify(t(word)));
    this.menu = this.get('menu');
    this.hud = this.get('hud');
    this.offroadHud = new OffroadHud(this.hud);
    this.modal = this.get('modal') as HTMLDialogElement;
    this.map = this.get('minimap') as HTMLCanvasElement;
    this.graph = this.get('graph') as HTMLCanvasElement;
    this.replayBar = this.get('replayBar');
    installCompactRaceHud(this.hud);
    installRaceDayHud(this.hud);
    this.f1 = installF1Hud(this.hud);
    this.motocrossStatus = new MotocrossStatusStack(this.element, this.hud);
    this.bikeHud = new BikeHud(this.hud);
    installSpeedTunnel(element.ownerDocument);
    this.trackMap = new TrackMap(this.map);
    element.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (button) this.callbacks.action(button.dataset.action!);
    });
    // The LANGUAGE dial on the first-launch screen announces its choice; the Settings
    // dial is read when the form is applied.
    element.addEventListener('change', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches?.('select[data-language-choice]'))
        this.callbacks.action(`language:${(target as HTMLSelectElement).value}`);
    });
    // Preserve the browser's scrolling/focus behavior without delivering scroll
    // navigation keys to the window-level driving shortcuts. Keyup still releases
    // previously held driving input; controls retain their native key handling.
    const menuBody = this.menu.querySelector<HTMLElement>('.menu-body')!;
    menuBody.addEventListener('keydown', (event) => {
      if (
        event.target === menuBody &&
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
      )
        event.stopPropagation();
    });
    // Native standings scrolling must not also steer the car through window
    // keydown listeners. Keyup still propagates to release any held drive input.
    this.element.querySelector('.timing')!.addEventListener('keydown', (event) => {
      if (
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(
          (event as KeyboardEvent).key,
        )
      )
        event.stopPropagation();
    });
    this.modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.callbacks.action('modalClose');
    });
    this.telemetryModal.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.callbacks.action('telemetryClose');
    });
    this.get('sessionForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const { options, problems } = this.formOptions();
      this.options = options;
      if (problems.length) {
        this.get('sessionRules').textContent = t('Cannot start: {problems}.', { problems: problems.join('; ') });
        return;
      }
      // Preparation is presentation/session control, not a physics option or save.
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (this.board) this.callbacks.remember?.(this.board.entry());
      this.callbacks.start(this.options, submitter?.name === 'prepareGrid');
    });
    // Restore the original menu structure before applying the selected road
    // machine's presentation. The MX helper owns its venue copy and dirt-bike
    // specification card; its change listeners must run before this refresh.
    const refreshMotocross = installMotocrossMenu(
      this.menu,
      () => this.track,
      () => this.bindings,
    );
    let previewSelection = '';
    const describeRules = () => {
      const select = (id: string) => (this.get(id) as HTMLSelectElement).value;
      const machine = machineOptions(this.options, select('vehicle')).vehicles?.[0] ?? 'apx01';
      const definition = vehicleDefinition(machine);
      const bike = !!definition.bike;
      const motocross = !!motocrossKind(select('circuit') as CircuitId);
      this.menu.dataset.bike = String(bike);
      const machineCard = this.menu.querySelector('.car-label')!;
      if (definition.classId !== 'motocross') {
        machineCard.querySelector('span')!.textContent = definition.name.split(' ')[0];
        machineCard.querySelector('b')!.textContent =
          definition.classId === 'gp-bike'
            ? t('GRAND PRIX / TWO WHEELS')
            : definition.classId.toUpperCase().replaceAll('-', ' ');
        machineCard.querySelector('div')!.textContent = bike
          ? t('{mass} KG BIKE · {gears} SPEED · {box}', {
              mass: Math.round(definition.spec.dryMass - definition.bike!.riderMass),
              gears: definition.spec.gearRatios.length - 2,
              box: definition.bike!.gearbox.toUpperCase(),
            })
          : t('{mass} KG DRY · {gears} SPEED', {
              mass: definition.spec.dryMass,
              gears: definition.spec.gearRatios.length - 2,
            });
      }
      for (const option of (this.get('opponents') as HTMLSelectElement).options)
        if (option.value !== '0')
          option.textContent = t(bike || motocross ? RIDERS : CARS, { n: Number(option.value) + 1 });
      const selection = `${select('circuit')}:${machine}`;
      if (previewSelection !== selection) {
        previewSelection = selection;
        this.callbacks.previewMachine?.(machine);
      }
      if (select('mode') === 'festival') {
        this.get('sessionRules').textContent = t(
          'Weather, light and assists apply. A road machine chosen in MACHINE is used; otherwise pick one in the festival menu.',
        );
        return;
      }
      // The circuit matters: the motorcycle rulesets need a bike-safe one.
      this.get('sessionRules').textContent = sessionRulesSummary({
        mode: select('mode') as SessionOptions['mode'],
        opponents: Number(select('opponents')),
        compound: select('compound') as SessionOptions['compound'],
        vehicle: select('vehicle'),
        circuit: select('circuit') as CircuitId,
      });
    };
    // Assist changes also refresh the MX helper's originals, so reapply the
    // selected road-bike presentation after that listener as well.
    for (const id of [...SESSION_RULES_FIELDS, 'assist'])
      this.get(id).addEventListener('change', describeRules);
    let board: LaunchBoard | null = null;
    this.refreshMotocrossMenu = () => {
      refreshMotocross();
      describeRules();
      board?.sync();
    };
    this.refreshMotocrossMenu();
    this.get('weather').addEventListener('change', () => {
      // The catalogue names the tyre each weather suggests (rain: full wets).
      const suggested = WEATHER_CATALOGUE[(this.get('weather') as HTMLSelectElement).value as WeatherId]?.suggestedTyre;
      if (suggested) (this.get('compound') as HTMLSelectElement).value = suggested;
    });
    // Time Trial is solo and open-ended: the field and distance do not apply.
    this.get('mode').addEventListener('change', () => {
      const mode = (this.get('mode') as HTMLSelectElement).value,
        laps = this.get('laps') as HTMLSelectElement,
        trial = mode === 'time-trial';
      (this.get('opponents') as HTMLSelectElement).disabled = trial;
      (this.get('startSlot') as HTMLSelectElement).disabled = !racingSession(
        mode as SessionOptions['mode'],
      );
      laps.disabled = trial;
      // Endurance distances apply only to endurance; other races stop at 10.
      if (mode === 'endurance' && Number(laps.value) < 15) laps.value = '15';
      else if (mode !== 'endurance' && Number(laps.value) > 10) laps.value = '10';
    });
    // The discipline plates, venue sheet and option dials sit over the form
    // above. Installed last so its change listeners run after every rule
    // handler (mode, weather, rules preview, motocross presenter) has run.
    board = installLaunchBoard(this.menu);
    this.board = board;
    // Last: every HUD sheet has been appended inside #hud by now (race-day, compact, F1, bike).
    installHudIdentity(this.hud);
    this.get('light').addEventListener('change', () => {
      const choice = (this.get('light') as HTMLSelectElement).value as LightChoice;
      this.callbacks.light?.(choice);
    });
    this.menuPad = new MenuGamepad(this.element, () => board!);
    this.get('replaySeek').addEventListener('input', (e) =>
      this.callbacks.seek(Number((e.target as HTMLInputElement).value)),
    );
    this.get('replaySpeed').addEventListener('change', (e) =>
      this.callbacks.replaySpeed(Number((e.target as HTMLSelectElement).value)),
    );
  }
  /** The session the form describes right now, and what is wrong with it (empty when it can start). */
  private formOptions(): { options: SessionOptions; problems: string[] } {
    const select = (id: string) => (this.get(id) as HTMLSelectElement).value;
    const options: SessionOptions = {
      ...DEFAULT_OPTIONS,
      circuit: select('circuit') as CircuitId,
      mode: select('mode') as SessionOptions['mode'],
      laps: Number(select('laps')),
      opponents: select('mode') === 'time-trial' ? 0 : Number(select('opponents')),
      weather: select('weather') as SessionOptions['weather'],
      compound: select('compound') as SessionOptions['compound'],
      assist: select('assist') as SessionOptions['assist'],
    };
    // Races and endurance start from the chosen slot; timed sessions ignore it.
    if (racingSession(options.mode)) {
      const grid = startingGrid(options.opponents + 1, select('startSlot') as StartSlot);
      if (grid) options.grid = grid;
    }
    Object.assign(options, machineOptions(options, select('vehicle')));
    // Reject incompatible machine/ruleset/tyre combinations with reasons
    // (the festival picks its own road machine and has no circuit rules).
    const problems =
      select('mode') === 'festival' ? [] : sessionIncompatibilities(validateOptions(options));
    // Steam demo: content outside the slice reads as FULL GAME here and is refused again at
    // the session start (main.ts), whichever door it came through.
    const locked = demoSessionLock({
      circuit: options.circuit,
      mode: options.mode,
      vehicles: options.vehicles,
    });
    if (locked) problems.unshift(locked);
    return { options, problems };
  }
  /** FIRST LAUNCH: open the screen (see first-run.ts). The radios come preselected. */
  firstRun(
    device: FirstRunDevice,
    bindings: Bindings = this.bindings,
    language: LanguageSetting = 'auto',
  ) {
    this.modalContent(firstRunHtml({ device, bindings, language }));
  }
  /** What the open first-launch screen has chosen. */
  firstRunChoice() {
    return firstRunChoice(this.get('modalContent'));
  }
  /** The Driving Academy's first lap in a discipline: the board is set to that plate and
   * the form to a solo, dry, medium-tyre practice of five laps, then read like a hand
   * entry (the same rules, the same machine preview). Null (with the reason in the
   * rules line) when the form refuses it. The festival keeps its own session. */
  firstLapOptions(discipline: BoardDiscipline): SessionOptions | null {
    const set = (id: string, value: string) => {
      const select = this.get(id) as HTMLSelectElement;
      if (select.value === value || ![...select.options].some((o) => o.value === value)) return;
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    this.board?.setDiscipline(discipline);
    if (discipline !== 'festival') {
      set('mode', 'practice');
      set('opponents', '0');
      set('laps', '5');
      set('weather', 'clear');
      set('compound', 'medium');
    }
    const { options, problems } = this.formOptions();
    if (problems.length) {
      this.get('sessionRules').textContent = t('Cannot start: {problems}.', { problems: problems.join('; ') });
      return null;
    }
    this.options = options;
    return options;
  }
  /** The form as CONTINUE remembers it. */
  boardEntry() {
    return this.board?.entry() ?? null;
  }
  /** Medal tally and next event on the paddock board's WILDCARD SERIES door. */
  setWildcardProgress(progress: WildcardProgress | null) {
    this.board?.setWildcard(progress);
  }
  /** The remembered entry behind the board's CONTINUE button (null hides it). */
  setContinue(entry: ContinueEntry | null) {
    this.board?.setContinue(entry);
  }
  /** Show a LIGHT choice made elsewhere (the driving academy, a stored preference). */
  setLightChoice(choice: LightChoice) {
    const select = this.get('light') as HTMLSelectElement;
    if (select.value === choice) return;
    select.value = choice;
    this.board?.sync();
  }
  get(id: string) {
    let node = this.nodes.get(id);
    if (!node || !node.isConnected) {
      node = document.getElementById(id) ?? undefined;
      if (!node) throw new Error(`Missing UI element: ${id}`);
      this.nodes.set(id, node);
    }
    return node;
  }
  get telemetryModal() {
    return this.get('telemetryModal') as HTMLDialogElement;
  }
  /** Show the loading screen. Raw engineering messages become a player-facing
   * stage title and a monotonic progress bar; the raw text is developer-only. */
  loading(text: string) {
    const screen = this.get('loading');
    if (screen.hidden) {
      // A new load: restart the bar and show the next tip.
      this.loadingProgress = 0;
      this.loadingTipIndex = (this.loadingTipIndex + 1) % LOADING_TIPS.length;
      this.get('loadingTip').innerHTML =
        `<b>${th('TIP')}</b> ${th(LOADING_TIPS[this.loadingTipIndex])}`;
    }
    const stage = loadingStage(text, this.loadingProgress);
    this.loadingProgress = Math.max(this.loadingProgress, stage.fraction);
    const percent = Math.round(this.loadingProgress * 100);
    this.setText('loadingStage', stage.title);
    this.setText('loadingPercent', `${percent}%`);
    const bar = this.get('loadingBar');
    bar.style.setProperty('--progress', String(this.loadingProgress));
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-valuetext', `${stage.title}, ${percent}%`);
    this.get('loadingText').textContent = text;
    screen.hidden = false;
    screen.setAttribute('aria-busy', 'true');
  }
  /** Session context line on the loading screen (null hides it). */
  loadingSession(options: SessionOptions | null) {
    // Restarting on the same loaded circuit does not rebuild the renderer or
    // call setTrack. Personal corner records belong to this session only.
    if (options) this.bikeHud.resetPractice();
    const line = this.get('loadingSession');
    line.hidden = !options;
    if (!options) return;
    const timed = options.mode === 'time-trial' || options.mode === 'practice';
    const riders = !!motocrossKind(options.circuit) || gpGridForVehicles(options.vehicles);
    const weather = t(WEATHER_CATALOGUE[options.weather].loading);
    line.textContent = [
      motocrossSessionTitle(options) ?? t(SESSION_TITLES[options.mode]),
      circuitTitle(circuitDefinition(options.circuit).id),
      options.mode === 'qualifying' || timed
        ? ''
        : t(LAPS, { n: options.laps }),
      options.mode === 'time-trial' ? '' : t(riders ? RIDERS : CARS, { n: options.opponents + 1 }),
      weather,
    ]
      .filter(Boolean)
      .join('  ·  ');
  }
  /** The loading board for a session: the venue's real line art (the same curve the
   * race uses, or the festival region) and a tip chosen for this discipline,
   * weather and light, in the player's own keys (loading-tips.ts). */
  loadingScene(options: SessionOptions, context: { wildcard?: WildcardEntry; night?: boolean } = {}) {
    const festival = (options.mode as string) === 'festival';
    const def = circuitDefinition(options.circuit);
    const map = this.get('loadingMap');
    map.innerHTML = festival
      ? regionArtSvg(SOLVANE)
      : circuitArtSvg(def.id, { numbers: true, className: 'ta loading-map-art' });
    const offroad = def.offroad?.kind;
    const bike = gpGridForVehicles(options.vehicles);
    const discipline: TipDiscipline = festival
      ? 'festival'
      : offroad === 'motocross' ||
          offroad === 'supercross' ||
          offroad === 'rallycross' ||
          offroad === 'rally-stage'
        ? (offroad === 'rally-stage' ? 'stage' : offroad)
        : bike
          ? 'gp'
          : 'circuit';
    map.dataset.kind = festival ? 'festival' : bike ? 'gp' : offroad ? 'dirt' : 'circuit';
    const first = vehicleDefinition(options.vehicles?.[0] ?? 'apx01');
    const race = options.mode === 'race' || options.mode === 'endurance';
    const tips = loadingTipsFor({
      discipline,
      weather: options.weather,
      night: !!context.night,
      drs: race && gridDrs(rulesetFor(options)?.drs ?? false, [first]),
      hybrid: first.classId === 'formula',
      race,
      solo: options.opponents === 0 || options.mode === 'practice' || options.mode === 'time-trial',
      wildcard: context.wildcard,
      bindings: this.bindings,
    });
    if (tips.length) {
      const tip = tips[this.loadingTipIndex % tips.length];
      this.get('loadingTip').innerHTML = `<b>${th('TIP')}</b> ${escapeHtml(tip)}`;
    }
    if (context.wildcard) {
      const line = this.get('loadingSession');
      line.textContent = `${t('WILDCARD SERIES')}  ·  ${wildcardTitle(context.wildcard)}  ·  ${line.textContent ?? ''}`;
    }
  }
  ready() {
    const screen = this.get('loading');
    screen.hidden = true;
    screen.setAttribute('aria-busy', 'false');
    this.menu.hidden = false;
  }
  toast(message: string) {
    const e = this.get('toast');
    e.textContent = message;
    e.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (e.hidden = true), 6000);
  }
  showMode(
    mode:
      | 'menu'
      | 'driving'
      | 'paused'
      | 'results'
      | 'replay'
      | 'loading'
      | 'photo'
      | 'pregame'
      | 'festival',
  ) {
    this.menu.hidden = mode !== 'menu';
    // The festival draws its own HUD (src/ui/festival-hud.ts); the race HUD stays hidden.
    this.hud.hidden =
      mode === 'menu' ||
      mode === 'loading' ||
      mode === 'photo' ||
      mode === 'pregame' ||
      mode === 'festival';
    this.get('debug').hidden ||= mode === 'photo';
    this.replayBar.hidden = mode !== 'replay';
    this.element.dataset.mode = mode;
    // Cancel a partial attempt immediately, including a replay/photo visit
    // which begins and ends between worker snapshots. Pausing keeps its clock.
    if (mode !== 'driving' && mode !== 'paused') this.bikeHud.suspendPractice();
  }
  setPracticeDriver(automatic: boolean) {
    if (this.practiceAutomatic === automatic) return;
    this.practiceAutomatic = automatic;
    this.bikeHud.suspendPractice();
  }
  /** Original worker frames only: station and simulation time share a sample.
   * HUD presentation can run at any cadence without changing a personal best. */
  observePractice(frame: Float32Array, automatic: boolean) {
    this.setPracticeDriver(automatic);
    const mode = this.element.dataset.mode;
    this.bikeHud.observePractice(frame, this.track, {
      practice: this.options.mode === 'practice' && (mode === 'driving' || mode === 'paused'),
      human: !automatic,
      replay: mode === 'replay',
      assist: this.options.assist,
    });
  }
  setText(id: string, value: string) {
    writeText(this.get(id), value);
  }
  private observeGaps(frame: Float32Array) {
    const cars = frame[H.CARS];
    if (!this.gaps || this.gaps.cars !== cars || this.gaps.length !== this.track.length) {
      this.gaps = new GapTimer(this.track.length, cars);
      this.gapPositions = new Float64Array(cars);
      this.towerRefresh = -Infinity;
      this.sectors = Number.isInteger(cars) && cars > 0 ? new SectorBoard(cars) : null;
    }
    for (let id = 0; id < cars; id++) this.gapPositions[id] = frame[carBase(id) + F.S];
    this.gaps.observe(frame[H.TIME], this.gapPositions);
    this.sectors?.observe(frame);
  }
  update(frame: Float32Array, renderer: RacingRenderer, auto: boolean, ers: number) {
    this.lastFrame = frame;
    const o = carBase(0),
      definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    const machineChanged = this.revVehicle !== '' && this.revVehicle !== definition.id;
    const proximity = nearbyTraffic(frame);
    for (const side of ['left', 'right'] as const) {
      const node = this.get(side === 'left' ? 'proximityLeft' : 'proximityRight');
      node.hidden = proximity[side] === 'clear';
      node.dataset.proximity = proximity[side];
    }

    this.hud.dataset.camera = renderer.mode;
    this.hud.dataset.motocross = String(!!motocrossKind(this.track.circuit.id));
    const mode = this.element.dataset.mode;
    this.setPracticeDriver(auto);
    this.bikeHud.update(frame, this.track);
    for (const side of ['Left', 'Right'] as const) {
      const node = this.get(`proximity${side}`);
      const label = t(
        side === 'Left'
          ? definition.bike
            ? N_('Rider left')
            : N_('Car left')
          : definition.bike
            ? N_('Rider right')
            : N_('Car right'),
      );
      if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
      writeText(node.querySelector('span')!, upper(label));
    }
    // Flight/contact transitions must be seen on every presented frame, even
    // while the lower-frequency timing panels skip their DOM refresh.
    this.offroadHud.update(frame, this.track, this.options, !auto, mode === 'replay');
    this.motocrossStatus.update(this.hud.dataset.motocross === 'true');
    // Motorcycle instruments follow every presented snapshot. Car panels may
    // skip close samples, but first, sparse, reversed and machine-transition
    // frames must never leave the template or an old race state on screen.
    this.observeGaps(frame);
    const banner = this.f1.observe(frame, auto);
    this.f1.nameTags(frame, renderer, mode === 'driving' || mode === 'paused');
    this.panelFrames++;
    const tick = frame[H.TICK],
      time = frame[H.TIME];
    if (
      !definition.bike &&
      !machineChanged &&
      this.panelFrames < 3 &&
      tick >= this.panelTick &&
      tick - this.panelTick < 3 &&
      time >= this.panelTime &&
      time - this.panelTime < 0.05
    )
      return;
    this.panelFrames = 0;
    this.panelTick = tick;
    this.panelTime = time;
    const speed = frame[o + F.SPEED],
      compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? 'medium';
    if (this.revVehicle !== definition.id) {
      this.revVehicle = definition.id;
      this.revThresholds = revLedThresholds(definition.spec.shiftRPM);
    }
    this.setText('speed', String(Math.round(speed * 3.6)));
    const gear = frame[o + F.GEAR];
    this.setText('gear', gear === 0 ? 'N' : gear < 0 ? 'R' : String(Math.round(gear)));
    this.setText('rpm', String(Math.round(frame[o + F.RPM])));
    // The label and the pause menu's short form of it (`3/5`, `OUT LAP`) are built together,
    // so the pause menu never has to read the words back out of the label.
    const lapNo = Math.round(frame[o + F.LAPS]) + 1;
    const lapOf = (lap: number, total: number) => ({
      label: t('LAP {lap} / {total}', { lap, total }),
      short: `${lap}<small>/${total}</small>`,
    });
    let lapText: { label: string; short: string };
    if (racingSession(this.options.mode)) {
      const of = lapOf(Math.min(this.options.laps, lapNo), this.options.laps);
      lapText = {
        label: `${this.options.mode === 'endurance' ? `${t('ENDURANCE')} / ` : ''}${of.label}`,
        short: of.short,
      };
    } else if (this.options.mode === 'qualifying') {
      const part =
        frame[o + F.FINISH] > 0
          ? { label: t('COMPLETE'), short: escapeHtml(t('COMPLETE')) }
          : frame[o + F.LAP_TIME] > 0
            ? lapOf(Math.min(QUALIFYING_TIMED_LAPS, lapNo), QUALIFYING_TIMED_LAPS)
            : { label: t('OUT LAP'), short: escapeHtml(t('OUT LAP')) };
      lapText = { label: `${t('QUALIFYING')} / ${part.label}`, short: part.short };
    } else
      lapText = {
        label: `${this.options.mode === 'time-trial' ? t('TIME TRIAL') : t('PRACTICE')} / ${t('LAP {lap}', { lap: lapNo })}`,
        short: String(lapNo),
      };
    this.lapSummary = lapText.short;
    this.setText('lapLabel', lapText.label);
    const flag = frame[H.PHASE] < 2 ? t('GRID') : t(flagLabel(frame[H.FLAG]));
    // Time Trial compares against the saved personal-best ghost when one exists.
    const trial = this.options.mode === 'time-trial' ? this.timeTrial : null;
    const deltaValid = trial ? trial.delta !== null : frame[o + F.DELTA_VALID] > 0;
    const delta = trial ? (trial.delta ?? 0) : frame[o + F.LAP_DELTA];
    this.setText('lapDeltaLabel', trial?.best ? t('DELTA TO PB') : t('DELTA TO BEST'));
    this.setText(
      'lapDelta',
      deltaValid ? `${delta >= 0 ? '+' : ''}${fixed(delta, 3)} ${t('S')}` : '—',
    );
    this.get('lapDelta').dataset.ahead = deltaValid ? String(delta < 0) : 'none';
    this.setText('flag', flag);
    this.get('flag').dataset.flag = String(frame[H.FLAG]);
    this.setText(
      'weatherLabel',
      weatherReadout(
        frame[H.AMBIENT],
        frame[H.RAIN],
        frame[H.WATER],
        frame[H.EXTINCTION],
        frame[H.DUST],
        Math.hypot(frame[H.WIND_X], frame[H.WIND_Z]),
      ),
    );
    for (const [id, field] of [
      ['lapTime', F.LAP_TIME],
      ['bestLap', F.BEST_LAP],
      ['lastLap', F.LAST_LAP],
    ] as const)
      this.setText(id, lapTime(frame[o + field]));
    if (trial?.best && !(frame[o + F.BEST_LAP] > 0 && frame[o + F.BEST_LAP] < trial.best))
      this.setText('bestLap', lapTime(trial.best));
    this.setText('battery', `${Math.round(frame[o + F.BATTERY] / 4e4)}%`);
    this.setText('fuel', `${fixed(frame[o + F.FUEL], 1)} ${t('KG')}`);
    updateRaceDayHud(this.hud, frame);
    writeWidth(this.get('brakeBar'), `${(frame[o + F.BRAKE] * 100).toFixed(1)}%`);
    writeWidth(this.get('throttleBar'), `${(frame[o + F.THROTTLE] * 100).toFixed(1)}%`);
    writeWidth(this.get('batteryBar'), `${(frame[o + F.BATTERY] / 4e4).toFixed(1)}%`);
    const ersMode = [N_('HARVEST'), N_('BALANCED'), N_('ATTACK')][ers] ?? N_('BALANCED');
    this.setText('ersMode', t(ersMode));
    this.get('ersMode').dataset.mode = ersMode;
    this.setText('tireCompound', compoundName(compound));
    this.setText('autoLabel', auto ? t('AI ON') : t('AI OFF'));
    this.setText('cameraLabel', cameraName(renderer.mode));
    this.setText('health', `${Math.round(frame[o + F.FRONT_HEALTH] * 100)}%`);
    this.setText('lateralG', `${fixed(Math.abs(frame[o + F.G_LAT]), 1)} G`);
    this.setText('penalty', `${Math.round(frame[o + F.PENALTY])} ${t('S')}`);
    // Rev lights: 15 LEDs up to the shift point; every LED flashes blue at
    // the limiter (8 Hz) and with the pit limiter on (2 Hz), on sim time.
    const rpm = frame[o + F.RPM],
      lights = this.get('rpmLights'),
      pitPhase = Math.round(frame[o + F.PIT_PHASE]),
      pitLimiter = frame[o + F.IN_PIT] > 0 && (pitPhase === 1 || pitPhase === 6),
      limiter = pitLimiter || rpm >= definition.spec.limiterRPM - 60,
      blinkOn = Math.floor(frame[H.TIME] * (pitLimiter ? 4 : 16)) % 2 === 0;
    lights.dataset.limiter = limiter ? 'on' : 'off';
    Array.from(lights.children).forEach((e, i) => {
      (e as HTMLElement).classList.toggle('lit', limiter ? blinkOn : rpm > this.revThresholds[i]);
    });
    Array.from(this.get('tires').children).forEach((e, i) => {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        temp = frame[p + W.CARCASS_TEMP];
      writeText(e.querySelector('b')!, `${Math.round(temp)}°`);
      writeText(e.querySelector('span')!, `${Math.round(100 * (1 - frame[p + W.WEAR]))}%`);
      writeText(e.querySelector('small')!, `${Math.round(frame[p + W.DISC_TEMP])}° ${t('BRAKE')}`);
      const band = tyreBand(temp);
      writeText(
        e.querySelector('label')!,
        definition.bike ? (i < 2 ? t('FRONT') : t('REAR')) : WHEEL_NAMES[i],
      );
      if ((e as HTMLElement).style.getPropertyValue('--tire') !== band)
        (e as HTMLElement).style.setProperty('--tire', band);
    });
    this.get('startSequence').hidden = frame[H.PHASE] !== 1;
    Array.from(this.get('lights').children).forEach((e, i) =>
      e.classList.toggle('lit', i < frame[H.LIGHTS]),
    );
    // Race control: one message for the polite live region; the F1 layout
    // shows it as a 4 s banner (flags stay as a compact chip while they apply).
    const message = banner?.text ?? '';
    if (message !== this.lastAnnounced) {
      this.setText('raceMessage', message);
      this.lastAnnounced = message;
    }
    const tower = this.get('tower');
    const cars = frame[H.CARS];
    if (tower.children.length !== cars) {
      this.hud.style.setProperty('--grid-rows', String(cars));
      tower.innerHTML = Array.from(
        { length: cars },
        () =>
          '<div class="tower-row"><b></b><i></i><span></span><small></small><em></em><u></u></div>',
      ).join('');
    }
    const order = Array.from({ length: cars }, (_, id) => id).sort(
      (a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK],
    );
    const playerRank = order.indexOf(0);
    this.setText('positionBadge', `P${playerRank + 1}`);
    this.setText('positionField', `/ ${cars}`);
    // Broadcast towers refresh intervals a few times a second, not every frame.
    const racing = racingSession(this.options.mode);
    const refresh = frame[H.TIME] < this.towerRefresh || frame[H.TIME] - this.towerRefresh >= 0.5;
    if (refresh) {
      this.towerRefresh = frame[H.TIME];
      this.setText('towerColumn', racing ? t('INTERVAL') : t('BEST LAP'));
    }
    // Five rows around the player while driving; focus expands the full list.
    const [first, end] = towerWindow(playerRank, cars);
    const fastest = fastestLapCar(frame);
    // Timed sessions: the fastest lap in full, everyone else as the gap to it.
    const poleBest = fastest >= 0 ? frame[carBase(fastest) + F.BEST_LAP] : 0;
    order.forEach((id, rank) => {
      const e = tower.children[rank] as HTMLElement,
        p = carBase(id);
      e.classList.toggle('player', id === 0);
      const slot = rank < first || rank >= end ? 'out' : rank === end - 1 ? 'last' : 'in';
      if (e.dataset.window !== slot) e.dataset.window = slot;
      e.toggleAttribute('data-fastest', id === fastest);
      e.querySelector('b')!.textContent = String(rank + 1);
      (e.querySelector('i') as HTMLElement).style.background =
        id === 0
          ? `#${renderer.cars[0].paint.color.getHexString()}`
          : `#${LIVERIES[id].toString(16).padStart(6, '0')}`;
      const name = id === 0 ? this.playerName : DRIVERS[id];
      const label = e.querySelector('span')!;
      if (label.title !== name) {
        label.title = name;
        label.textContent = surname(name);
      }
      const compound = compoundOf(frame, id);
      const tyre = e.querySelector('em')!;
      if (tyre.dataset.c !== compound) {
        tyre.dataset.c = compound;
        tyre.textContent = compound[0].toUpperCase();
        tyre.title = compoundName(compound).toLowerCase();
        tyre.style.setProperty('--tyre', `var(--tyre-${compound})`);
      }
      if (!refresh) return;
      const ahead = order[rank - 1];
      const best = frame[p + F.BEST_LAP];
      const gap = e.querySelector('small')!;
      // Time penalties ride on the interval cell as an orange "+5S" chip.
      const penalty = Math.round(frame[p + F.PENALTY]);
      const chip = penalty > 0 ? `+${penalty}S` : '';
      if ((gap.dataset.penalty ?? '') !== chip) {
        if (chip) gap.dataset.penalty = chip;
        else delete gap.dataset.penalty;
      }
      gap.textContent =
        frame[p + F.RETIRED] > 0
          ? t('DNF')
          : frame[p + F.FINISH] > 0
            ? t('FIN')
            : frame[p + F.IN_PIT]
              ? t('PIT')
              : !racing
                ? timedGap(best, poleBest, id === fastest)
                : rank === 0
                  ? t('LEADER')
                  : formatInterval(
                      this.gaps!.interval(ahead, id),
                      this.gaps!.lapsBetween(ahead, id),
                    );
    });
    this.f1.update({
      frame,
      trackLength: this.track.length,
      mode: this.options.mode,
      laps: this.options.laps,
      order,
      sectors: this.sectors,
      ers,
      auto,
      delta: deltaValid ? delta : null,
      bestKnown: frame[o + F.BEST_LAP] > 0 || (trial?.best ?? 0) > 0,
      deltaShown: deltaValid && !racing,
    });
    this.drawMap(frame);
    this.get('debug').hidden = !renderer.debug;
    if (renderer.debug) {
      this.get('debug').textContent = engineeringReport(
        frame,
        renderer.stats(),
        renderer.engineering,
        renderer.replayView,
      );
    }
  }
  /** Replace the displayed circuit (menu captions, length and minimap). */
  setTrack(track: Track) {
    this.track = track;
    this.bikeHud.resetPractice();
    this.panelTick = this.panelTime = -Infinity;
    const name = track.circuit.name;
    this.get('minimapCaption').textContent = name;
    this.get('circuitEyebrow').textContent = name.replace(' / ', ' · ');
    this.get('circuitLength').textContent = fixed(track.length / 1000, 3);
    this.get('circuitTurns').textContent = String(track.circuit.corners.length);
    const zones = track.circuit.drsZones.length;
    this.get('circuitDrs').textContent = String(zones);
    this.get('circuitDrs').nextSibling!.textContent = ` ${t(DRS_ZONES, { n: zones })}`;
    (this.get('circuit') as HTMLSelectElement).value = track.circuit.id;
    this.get('circuitBlurb').textContent = circuitBlurb(track.circuit.id);
    this.refreshMotocrossMenu();
    this.mapFrame = minimapFrame(track);
  }
  private mapFrame: ReturnType<typeof minimapFrame> | null = null;
  private drawMap(frame: Float32Array) {
    this.trackMap.draw(frame, this.track, (this.mapFrame ??= minimapFrame(this.track)));
  }
  gridPresentationAvailable = false;
  pause() {
    const developer = this.developer
      ? '<div class="dev-tools" role="group" aria-label="Developer tools"><span>DEV</span><button data-action="performance">PERFORMANCE CAPTURE</button><button data-action="visualReview">FULL-LAP VISUAL REVIEW</button><button data-action="sessionReview">SESSION 146 EVIDENCE</button></div>'
      : '';
    this.modalContent(
      `<div class="pause-menu"><header class="pause-head"><span class="eyebrow">${th('PAUSED')}</span><h2>${motocrossSessionTitle(this.options) ?? th(SESSION_TITLES[this.options.mode] ?? N_('Session'))}</h2><span class="pause-circuit">${escapeHtml(circuitTitle(this.track.circuit.id))}</span></header>${this.pauseSummary()}<div class="dialog-buttons pause-actions"><button class="primary" data-action="resume">${th('RESUME SESSION')}</button>${this.gridPresentationAvailable ? `<button data-action="gridPresentation">${th('PRE-RACE PRESENTATION')}</button>` : ''}<button data-action="restart">${th('RESTART SESSION')}</button><button data-action="settings">${th('GARAGE & SETTINGS')}</button><button data-action="menu">${th('RETURN TO PADDOCK')}</button></div><div class="pause-more" role="group" aria-label="${ta('More options')}"><button data-action="camera">${th('CHANGE CAMERA')}</button><button data-action="replay">${th('WATCH REPLAY')}</button><button data-action="photo">${th('PHOTO STUDIO')}</button><button data-action="autopilot">${th('AI DRIVER')}</button><button data-action="academy">${th('ACADEMY')}</button></div>${developer}</div>`,
    );
  }
  /** Compact session context for the pause menu: position, lap, gap, tyres, conditions. */
  private pauseSummary() {
    const frame = this.lastFrame;
    if (!frame || !(frame[H.CARS] >= 1)) return '';
    const o = carBase(0),
      cars = Math.round(frame[H.CARS]);
    let position = 1;
    for (let id = 1; id < cars; id++)
      if (frame[carBase(id) + F.RANK] < frame[o + F.RANK]) position++;
    const racing = racingSession(this.options.mode);
    const lap = this.lapSummary;
    const gap = this.element.querySelector('.tower-row.player small')?.textContent?.trim() || '—';
    const compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? 'medium';
    let life = 0;
    for (let i = 0; i < 4; i++) life += 1 - frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.WEAR];
    const cells: [string, string][] = [
      [N_('POSITION'), cars > 1 ? `P${position}<small>/${cars}</small>` : th('SOLO')],
      [N_('LAP'), lap || '—'],
      racing
        ? [N_('INTERVAL'), position === 1 ? th('LEADER') : escapeHtml(gap)]
        : [N_('BEST LAP'), lapTime(frame[o + F.BEST_LAP])],
      [
        N_('TYRES'),
        `<i class="tyre-dot" style="--tyre: var(--tyre-${compound})" title="${escapeHtml(compoundName(compound).toLowerCase())}">${compound[0].toUpperCase()}</i>${Math.round((100 * life) / 4)}<small>%</small>`,
      ],
      [N_('TRACK'), conditions(frame[H.AMBIENT], frame[H.RAIN], frame[H.WATER])],
    ];
    return `<dl class="pause-summary">${cells.map(([k, v]) => `<div><dt>${th(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }
  performance(status: string, machine: string, workload: string, exportable: boolean) {
    this.modalContent(
      `<span class="eyebrow">MEASURE / COMPARE</span><h2>Performance capture.</h2>
       <p id="profileStatus"></p><p>Resume this session, warm up for 5 seconds, then record 30 seconds of real frames. Slow frames are retained. Pausing, changing the view or resizing interrupts the run.</p>
       <label>COMPUTER / POWER PROFILE<input id="profileMachine" maxlength="80" placeholder="e.g. desktop-plugged-in" /></label>
       <label>REPEATABLE WORKLOAD<input id="profileWorkload" maxlength="120" placeholder="e.g. same seed, new practice, AI, cockpit" /></label>
       <p>These labels are your declaration that the hardware and workload match. They are not detected or verified by the browser. Export contains frame timings and browser/configuration details; it is not uploaded.</p>
       <div class="dialog-buttons"><button class="primary" data-action="profileStart">RESUME & CAPTURE</button><button data-action="profileExport" ${exportable ? '' : 'disabled'}>EXPORT PERFORMANCE JSON</button><button data-action="modalClose">BACK</button></div>`,
    );
    this.get('profileStatus').textContent = status;
    (this.get('profileMachine') as HTMLInputElement).value = machine;
    (this.get('profileWorkload') as HTMLInputElement).value = workload;
  }
  sessionReview(status: string, active: boolean, atMenu: boolean, exportable: boolean) {
    this
      .modalContent(`<span class="eyebrow">PHASE 27F / WHOLE SESSION</span><h2>Section 146 observations.</h2>
      <p id="sessionReviewStatus"></p><p>Arm from the paddock before choosing a race. Drive the complete master scenario, finish, view results, watch replay and inspect telemetry. This observes the real application states and worker snapshots; it never drives or modifies the simulation.</p>
      <label>REVIEWER<input id="sessionReviewer" maxlength="80" /></label><label>COMPUTER / POWER PROFILE<input id="sessionReviewMachine" maxlength="80" /></label>
      <p>At most 2 samples/second, 14,400 snapshots and 4,096 events. Autopilot, restarts, visibility loss and mid-race pauses remain explicit. These snapshots are not every physics tick or an audiovisual recording. The separate direct-to-file tab recorder includes the actual HTML HUD and optional tab audio from when you start it. Retain an external uninterrupted recording for application launch. All Section 146 perceptual and human acceptance remains unverified.</p>
      <div class="dialog-buttons"><button data-action="sessionReviewStart" ${!active && atMenu ? '' : 'disabled'}>ARM FROM PADDOCK</button><button data-action="sessionReviewStop" ${active ? '' : 'disabled'}>STOP OBSERVATIONS</button><button data-action="sessionReviewExport" ${exportable ? '' : 'disabled'}>EXPORT SESSION JSON</button><button data-action="sessionReview">REFRESH STATUS</button><button data-action="modalClose">BACK</button></div>`);
    this.get('sessionReviewStatus').textContent = status;
  }
  presentationReview(status: string, machine: string, exportable: boolean, videoReady: boolean) {
    this
      .modalContent(`<span class="eyebrow">PHASE 27F / EVIDENCE</span><h2>Review the complete lap.</h2>
      <p id="visualReviewStatus"></p>
      <p>Use the current session and camera. A full lap ends only after a complete forward circuit traversal and a real lap-counter increase. Timed scenes last at least 30 seconds. Racing workloads also require observed events: a populated start, five seconds beside the same rival, three seconds behind a moving car in wet spray, or pit entry through jacked service and exit. A label or timer alone cannot complete them.</p>
      <label>COMPUTER / POWER PROFILE<input id="reviewMachine" maxlength="80" placeholder="e.g. laptop-plugged-in / GPU model" /></label>
      <label>WORKLOAD<select id="reviewWorkload"><option value="clear-day">Clear day</option><option value="overcast-day">Overcast day</option><option value="wet-day">Wet day</option><option value="wet-night">Wet night</option><option value="sunset">Sunset</option><option value="grid-start">Grid start</option><option value="pit-service">Pit entry, service and exit</option><option value="close-racing">Close racing</option><option value="wet-following">Wet following with emitted spray</option><option value="other">Other / changing weather</option></select></label>
      <label>CAPTURE<select id="reviewMode"><option value="full-lap">Full lap</option><option value="timed-scene">Timed scene (30 seconds minimum)</option></select></label>
      <label><input id="reviewVideo" type="checkbox" /> ALSO RECORD LOCAL VIDEO (64 MiB maximum)</label>
      <label><input id="reviewAudio" type="checkbox" /> INCLUDE GAME AUDIO (not microphone audio)</label>
      <p>Repeat clear, overcast, wet and wet-night sessions with cockpit, chase, pod and broadcast cameras. Choose the weather label matching the actual session; this tool never changes weather or drives the car. Changing settings, pausing or losing focus interrupts the evidence. Video adds encoding cost and can coalesce frames; JSON retains every observed rendered-frame interval. The local export includes browser-reported platform/GPU strings, available JavaScript heap size, and controller-axis ranges (no typed text or microphone). Missing values stay unmeasured. No GPU VRAM or physical-controller certification is inferred.</p>
      <div class="dialog-buttons"><button class="primary" data-action="reviewStart">RESUME & RECORD REVIEW</button><button data-action="reviewExport" ${exportable ? '' : 'disabled'}>EXPORT FRAME JSON</button><button data-action="reviewVideoExport" ${videoReady ? '' : 'disabled'}>EXPORT WEBM</button><button data-action="visualReview">REFRESH EVIDENCE STATUS</button><button data-action="modalClose">BACK</button></div>`);
    this.get('visualReviewStatus').textContent = status;
    (this.get('reviewMachine') as HTMLInputElement).value = machine;
  }
  controls(bindings: Bindings) {
    const motocross = !!motocrossKind(
      this.menu.hidden
        ? this.track.circuit.id
        : ((this.get('circuit') as HTMLSelectElement).value as CircuitId),
    );
    const labels = motocross
      ? {
          ...BINDING_LABELS,
          brake: N_('Front brake / lower the nose in flight'),
          clutch: N_('Rear brake / lower the nose in flight'),
          left: N_('Steer / bank left in flight'),
          right: N_('Steer / bank right in flight'),
        }
      : BINDING_LABELS;
    this.modalContent(
      `<span class="eyebrow">${th('DRIVER BRIEFING')}</span><h2>${th('Controls.')}</h2><div class="control-grid">${Object.entries(
        bindings,
      )
        .filter(([action]) =>
          motocross
            ? !['pit', 'ers', 'drs', 'overtake'].includes(action)
            : !['riderForward', 'riderBack'].includes(action),
        )
        .map(
          ([action, code]) =>
            `<b>${keyName(code)}</b><span>${th(labels[action as BindingAction])}</span>`,
        )
        .join(
          '',
        )}<b>ESC</b><span>${th('Pause / release mouse look')}</span><b>${th('DOUBLE CLICK')}</b><span>${th('Cockpit mouse look')}</span></div><p>${motocross ? th('Shift rider weight separately from the pedals; release to return to the normal riding posture. In flight, throttle lifts the nose and either brake lowers it. Steer to bank and whip; release before touchdown to square the wheels. Riding assists help align a landing. Standard gamepad: left stick steers and whips, right stick up/down shifts rider weight, triggers operate throttle and brake, shoulder buttons shift and Start pauses. Touch: use the two LEAN buttons beside the steering controls.') : th('Gamepad: left stick steers, triggers for throttle and brake, shoulder buttons shift, Y changes camera, X cycles energy mode and Start pauses.')} ${th('Remap any keyboard control in Garage & Settings.')}</p><button class="primary" data-action="modalClose">${th('UNDERSTOOD')}</button>`,
    );
  }
  /** Paddock "Credits & licences": every third-party attribution (manifest). */
  credits() {
    this.modalContent(creditsHtml());
    const list = this.element.querySelector<HTMLElement>('#creditsList');
    if (list) {
      list.focus();
      this.creditsPad = new CreditsGamepad(list, () => this.callbacks.action('modalClose'));
    }
  }
  modalContent(html: string) {
    this.wildcardBinding?.();
    this.wildcardBinding = null;
    this.firstRunBinding?.();
    this.firstRunBinding = null;
    this.settingsBinding?.();
    this.settingsBinding = null;
    this.creditsPad?.dispose();
    this.creditsPad = null;
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    this.deviceCalibration?.dispose();
    this.deviceCalibration = null;
    this.get('modalContent').innerHTML = html;
    if (!this.modal.open) {
      this.modal.showModal();
      uiCue('open');
    }
    // Open at the top. showModal() focuses the first control, which in a tall
    // screen (the controls list, a long classification) is at the bottom and
    // would scroll the heading out of view.
    this.modal.scrollTop = 0;
    // The Wildcard board: its rows are a radio group that selects the programme
    // page; the chosen event takes the focus.
    const content = this.get('modalContent');
    if (content.querySelector('.fr')) this.firstRunBinding = bindFirstRun(content);
    if (content.querySelector('.wc-board')) {
      this.wildcardBinding = bindWildcardBoard(content);
      content.querySelector<HTMLElement>('.wc-row[aria-checked="true"]')?.focus({ preventScroll: true });
    }
  }
  /** The dialog that is open right now is the pause menu (not a dialog opened from it). */
  get pauseMenuOpen() {
    return this.modal.open && !!this.modal.querySelector('.pause-menu');
  }
  closeModal() {
    this.wildcardBinding?.();
    this.wildcardBinding = null;
    this.firstRunBinding?.();
    this.firstRunBinding = null;
    this.settingsBinding?.();
    this.settingsBinding = null;
    this.creditsPad?.dispose();
    this.creditsPad = null;
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    this.deviceCalibration?.dispose();
    this.deviceCalibration = null;
    if (this.modal.open) {
      this.modal.close();
      uiCue('close');
    }
  }
  applyBindings(bindings: Bindings) {
    this.bindings = { ...bindings };
    this.offroadHud.setBindings(bindings);
    this.refreshMotocrossMenu();
    this.hud.querySelectorAll<HTMLElement>('[data-action] kbd').forEach((key) => {
      const action = key.parentElement?.dataset.action as BindingAction;
      if (bindings[action]) key.textContent = keyName(bindings[action]);
    });
  }
  get telemetryView(): TelemetryView {
    const key = (this.get('telemetryView') as HTMLSelectElement).value;
    return Object.hasOwn(TELEMETRY_VIEWS, key) ? (key as TelemetryView) : 'driver';
  }
  /** GARAGE & SETTINGS. The vehicle setup section shows the active machine's
   * own parameters (setup-screen.ts): `context.machine` names it explicitly (a
   * running session's entry); otherwise the MACHINE menu choice decides. A
   * career session racing a garage preset (`context.preset`) shows it read-only. */
  settings(settings: Settings, context?: SetupContext) {
    const menuChoice = document.querySelector<HTMLSelectElement>('#vehicle')?.value ?? null;
    const vehicle = setupMachine(context?.machine, menuChoice, this.options),
      preset = context?.preset ?? null;
    this.modalContent(
      `<header><div><span class="eyebrow">${th('GARAGE / PREFERENCES')}</span><h2>${th('Garage & settings.')}</h2></div><button data-action="modalClose" aria-label="${ta('Close settings')}">✕</button></header><form id="settingsForm"><div class="settings-columns"><section><h3>${th('Presentation')}</h3>${settingsLanguageRow(settings.language)}<label>${th('RENDER QUALITY')}<select name="quality"><option value="low">${th('Low · No shadows / crowd / particles')}</option><option value="medium">${th('Medium · 2× MSAA / AO / bloom')}</option><option value="high">${th('High · 4× MSAA / local reflections / specular AA')}</option><option value="ultra">${th('Ultra · TAA / SSR / 3 shadow cascades (opt-in, fast GPUs)')}</option></select></label>${qualityGuideHtml(settings.quality, this.gpu ?? (this.gpu = readGpuName()))}${presentationControls(settings)}${[
        ['volume', N_('Volume'), 0, 1, 0.01],
        ['shake', N_('Camera vibration'), 0, 1, 0.01],
        ['uiScale', N_('Text and interface size'), 0.8, 1.35, 0.05],
      ]
        .map(
          ([key, title, min, max, step]) =>
            `<label class="range-row">${th(String(title))}<output>${key === 'uiScale' ? `${Math.round(settings.uiScale * 100)}%` : settings[key as 'volume' | 'shake']}</output><input name="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${settings[key as 'volume' | 'shake' | 'uiScale']}"></label>`,
        )
        .join(
          '',
        )}${audioMixer({ levels: settings.audioLevels, musicEnabled: settings.musicEnabled })}${audioAccessibility(settings.drivingAudio)}<h3>${th('Input mapping')}</h3><p class="small-note">${th('Axis and button numbers are zero-based. Keyboard always remains available.')}</p><div class="mapping-grid">${[
        ['steerAxis', N_('Steer axis')],
        ['throttleAxis', N_('Throttle axis')],
        ['brakeAxis', N_('Brake axis')],
        ['throttleButton', N_('Throttle button')],
        ['brakeButton', N_('Brake button')],
        ['clutchAxis', N_('Clutch axis (-1: button / key)')],
        ['clutchButton', N_('Clutch button (-1: key only)')],
        ['shiftUpButton', N_('Upshift button (-1: disabled)')],
        ['shiftDownButton', N_('Downshift button (-1: disabled)')],
      ]
        .map(
          ([key, title]) =>
            `<label>${th(title)}<input name="${key}" type="number" min="${key.startsWith('clutch') || key.includes('Button') ? -1 : 0}" max="${key.includes('Button') ? 127 : 31}" value="${settings.mapping[key as keyof typeof settings.mapping]}"></label>`,
        )
        .join('')}</div>${[
        ['axisPedals', N_('Use axes for pedals')],
        ['invertSteer', N_('Invert steering axis')],
        ['invertPedals', N_('Invert pedal axes')],
      ]
        .map(
          ([key, title]) =>
            `<label class="check"><input type="checkbox" name="${key}" ${settings.mapping[key as keyof typeof settings.mapping] ? 'checked' : ''}>${th(title)}</label>`,
        )
        .join(
          '',
        )}<label class="range-row">${th('Deadzone')}<output>${settings.mapping.deadzone}</output><input name="deadzone" type="range" min="0" max=".35" step=".01" value="${settings.mapping.deadzone}"></label><label class="range-row">${th('Steering response exponent')}<output>${settings.mapping.exponent}</output><input name="exponent" type="range" min=".5" max="3" step=".1" value="${settings.mapping.exponent}"></label><div id="deviceCalibration"></div><h3>${th('Controller action buttons')}</h3><p class="small-note">${th('Use -1 to disable an action. Buttons cannot share an active pedal, paddle or another action. Pause/resume works from the pause menu; keyboard remains available.')}</p><div class="mapping-grid">${BUTTON_ACTIONS.map((action) => `<label>${th('{action} button', { action: t(BUTTON_ACTION_LABELS[action]) })}<input name="action_${action}" required type="number" min="-1" max="127" step="1" value="${settings.mapping.buttonActions[action]}"></label>`).join('')}</div><h3>${th('Keyboard bindings')}</h3><div class="binding-grid">${Object.entries(
        settings.bindings,
      )
        .map(
          ([action, key]) =>
            `<label>${th(BINDING_LABELS[action as BindingAction])}<button type="button" data-bind="${action}" data-key="${key}">${keyName(key)}</button></label>`,
        )
        .join(
          '',
        )}</div></section><section><h3>${th('Vehicle setup')}</h3>${setupSectionHtml(vehicle, settings.setup, preset)}<div class="setup-files"><button type="button" id="exportSetup">${th('EXPORT SETUP')}</button><label class="file-label">${th('IMPORT SETUP')}<input id="importSetup" type="file" accept=".json,application/json" hidden></label></div></section></div><footer><button type="button" data-action="modalClose">${th('CANCEL')}</button><button class="primary" type="submit">${th('APPLY & SAVE')}</button></footer></form>`,
    );
    const form = document.getElementById('settingsForm') as HTMLFormElement;
    this.deviceCalibration = new DeviceCalibrationPanel(
      document.getElementById('deviceCalibration')!,
      form,
      settings.mapping,
    );
    (form.elements.namedItem('quality') as HTMLSelectElement).value = settings.quality;
    const graphics = bindPresentation(form, settings);
    // The frame-rate meter runs while the screen is open; the text size previews as it is dragged
    // and goes back to the saved size when the screen closes without applying.
    const root = document.documentElement;
    const savedScale = root.style.getPropertyValue('--ui-scale');
    let applied = false;
    const stopGuide = bindQualityGuide(form);
    this.settingsBinding = () => {
      stopGuide();
      if (!applied) root.style.setProperty('--ui-scale', savedScale || String(settings.uiScale));
    };
    form.querySelector<HTMLButtonElement>('#previewDrivingAudio')!.onclick = () =>
      this.callbacks.previewAudio?.(readDrivingAudio(form));
    form.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const output = input.parentElement?.querySelector('output');
      if (output)
        output.value =
          input.name === 'uiScale' || input.name.startsWith('level_')
            ? `${Math.round(Number(input.value) * 100)}%`
            : input.value;
      if (input.name === 'uiScale') root.style.setProperty('--ui-scale', input.value);
      // The one value a machine reads as its own baseline saves as its neighbour.
      if (input.dataset.setup !== undefined) {
        const note = form.querySelector<HTMLElement>(`#note-${input.name}`);
        if (note)
          note.textContent = setupSaveNote(
            vehicle,
            input.name as keyof Settings['setup'],
            Number(input.value),
            Number(input.dataset.shown),
          );
      }
    });
    form.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((button) =>
      button.addEventListener('click', () => {
        this.bindingCapture?.abort();
        this.bindingCapture = new AbortController();
        const capture = this.bindingCapture;
        button.textContent = t('PRESS A KEY · ESC CANCELS');
        capture.signal.addEventListener(
          'abort',
          () => {
            button.textContent = keyName(button.dataset.key!);
          },
          { once: true },
        );
        const listener = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.code === 'Escape') {
            capture.abort();
            return;
          }
          const proposed = { ...settings.bindings };
          form.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((item) => {
            proposed[item.dataset.bind as BindingAction] = item.dataset.key!;
          });
          proposed[button.dataset.bind as BindingAction] = e.code;
          try {
            validateBindings(proposed);
            button.dataset.key = e.code;
            capture.abort();
          } catch (error) {
            this.toast(String(error));
          }
        };
        document.addEventListener('keydown', listener, {
          capture: true,
          signal: capture.signal,
        });
      }),
    );
    document.getElementById('exportSetup')!.onclick = () => this.callbacks.exportSetup();
    document.getElementById('importSetup')!.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.callbacks.importSetup(file);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      applied = true;
      const value = (key: string) => (form.elements.namedItem(key) as HTMLInputElement).value;
      const next = structuredClone(settings);
      next.quality = value('quality') as Settings['quality'];
      next.language = validateLanguage(value('language'));
      next.graphics = graphics();
      next.drivingAudio = readDrivingAudio(form);
      const mix = readAudioMixer(form, {
        levels: settings.audioLevels,
        musicEnabled: settings.musicEnabled,
      });
      next.audioLevels = mix.levels;
      next.musicEnabled = mix.musicEnabled;
      next.colorblind = (form.elements.namedItem('colorblind') as HTMLInputElement).checked;
      next.highContrast = (form.elements.namedItem('highContrast') as HTMLInputElement).checked;
      for (const key of ['captions', 'engineerRadio', 'reducedMotion'] as const)
        next[key] = (form.elements.namedItem(key) as HTMLInputElement).checked;
      for (const key of ['traction', 'impact', 'engine'] as const)
        next.rumble[key] = Number(value(`rumble_${key}`));
      next.quickStart = (form.elements.namedItem('quickStart') as HTMLInputElement).checked;
      for (const key of ['volume', 'shake', 'uiScale'] as const) next[key] = Number(value(key));
      next.setup = applySetupScreen(vehicle, settings.setup, (key) => Number(value(key)), preset);
      for (const key of [
        'steerAxis',
        'throttleAxis',
        'brakeAxis',
        'throttleButton',
        'brakeButton',
        'clutchAxis',
        'clutchButton',
        'shiftUpButton',
        'shiftDownButton',
        'deadzone',
        'exponent',
      ] as const)
        next.mapping[key] = Number(value(key));
      for (const key of ['axisPedals', 'invertSteer', 'invertPedals'] as const)
        next.mapping[key] = (form.elements.namedItem(key) as HTMLInputElement).checked;
      form
        .querySelectorAll<HTMLButtonElement>('[data-bind]')
        .forEach(
          (button) => (next.bindings[button.dataset.bind as BindingAction] = button.dataset.key!),
        );
      this.bindingCapture?.abort();
      try {
        this.deviceCalibration?.apply(next.mapping);
        for (const action of BUTTON_ACTIONS)
          next.mapping.buttonActions[action] = Number(value(`action_${action}`));
        this.callbacks.apply(validateSettings(next));
      } catch (error) {
        this.toast(t('Settings not applied: {error}', { error: String(error) }));
      }
    };
  }
  /** Championship line under a race classification (set by the application). */
  championshipNote = '';
  /** Career payment panel under a classification (trusted HTML from career-hub.ts). */
  resultsExtra = '';
  /** A banner directly under the results heading (the Wildcard medal; trusted HTML). */
  resultsLead = '';
  /** What to do next, from the career plan (set by the application; null hides the card). */
  resultsNext: ResultsNext | null = null;
  results(frame: Float32Array) {
    if (this.options.mode === 'qualifying') {
      this.qualifyingResults(frame);
      return;
    }
    const name = (id: number) => (id === 0 ? this.playerName : DRIVERS[id]);
    this.modalContent(
      resultsBoardHtml({
        rows: resultRows(frame, name),
        heading: frame[carBase(0) + F.FINISH] > 0 ? t('Across the line.') : t('Session ended.'),
        lead: this.resultsLead,
        extra: this.resultsExtra,
        offroad: this.offroadHud.results(frame, this.track, this.options, name),
        note: this.championshipNote,
        next: this.resultsNext,
        standings: !!this.championshipNote,
      }),
    );
  }
  /** Qualifying classification: the fastest valid lap sets the race grid. */
  qualifyingResults(frame: Float32Array) {
    const grid = qualifyingGrid(frame),
      pole = frame[carBase(grid[0]) + F.BEST_LAP];
    const rows = grid
      .map((id, index) => {
        const best = frame[carBase(id) + F.BEST_LAP];
        const gap = best > 0 && pole > 0 && index > 0 ? `+${fixed(best - pole, 3)}` : '';
        return `<tr${id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${id === 0 ? escapeHtml(this.playerName) : DRIVERS[id]}</td><td>${best > 0 ? lapTime(best) : th('NO TIME')}</td><td>${gap}</td></tr>`;
      })
      .join('');
    const position = grid.indexOf(0) + 1;
    this.modalContent(
      `<span class="eyebrow">${th('QUALIFYING / CLASSIFICATION')}</span><h2>${position === 1 ? th('Pole position.') : th('P{position} on the grid.', { position })}</h2><p>${th('Fastest valid lap sets the starting order. Invalid or penalised laps do not count.')}</p><table class="results"><thead><tr><th>${th('POS')}</th><th>${th('DRIVER')}</th><th>${th('BEST LAP')}</th><th>${th('GAP')}</th></tr></thead><tbody>${rows}</tbody></table>${this.championshipNote ? `<p class="championship-note">${escapeHtml(this.championshipNote)}</p>` : ''}<div class="dialog-buttons inline"><button class="primary" data-action="weekendRace">${th('START RACE FROM THIS GRID')}</button><button data-action="replay">${th('WATCH REPLAY')}</button><button data-action="telemetry">${th('TELEMETRY')}</button><button data-action="menu">${th('PADDOCK')}</button></div>`,
    );
  }
  /** Championship standings and calendar. */
  championship(c: Championship | null) {
    if (!c) {
      this.modalContent(
        `<span class="eyebrow">${th('CHAMPIONSHIP')}</span><h2>${th('A season of race weekends.')}</h2><p>${th('{rounds} rounds across the original circuits. Each weekend is qualifying, which sets the grid, and then the race. Points go to the top ten finishers (25-18-15-12-10-8-6-4-2-1). Progress is saved on this device.', { rounds: DEFAULT_CALENDAR.length })}</p><div class="dialog-buttons inline"><button class="primary" data-action="championship:new">${th('START NEW CHAMPIONSHIP')}</button><button data-action="modalClose">${th('CLOSE')}</button></div>`,
      );
      return;
    }
    const table = standings(c);
    const rows = table
      .map(
        (s, index) =>
          `<tr${s.id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${s.id === 0 ? escapeHtml(this.playerName) : DRIVERS[s.id]}</td><td>${s.points}</td><td>${s.wins}</td><td>${s.finishes.map((p) => (p ? `P${p}` : t('DNF'))).join(' · ') || '—'}</td></tr>`,
      )
      .join('');
    const calendar = c.rounds
      .map((r, i) => {
        const done = c.results[i];
        const status = done
          ? `P${done.order.indexOf(0) + 1}${done.retired.includes(0) ? ` (${t('DNF')})` : ''}${done.demonstration ? ` · ${t('AI DEMO')}` : ''}`
          : i === c.results.length
            ? t('NEXT')
            : '';
        return `<li${i === c.results.length ? ' class="next"' : ''}><b>R${i + 1}</b> ${circuitDefinition(r.circuit).name} · ${weatherTag(r.weather)} · ${t('{n} LAPS', { n: r.laps })} <span>${status}</span></li>`;
      })
      .join('');
    const round = nextRound(c);
    this.modalContent(
      `<span class="eyebrow">${th('CHAMPIONSHIP / ROUND {round} OF {rounds}', { round: Math.min(c.results.length + 1, c.rounds.length), rounds: c.rounds.length })}</span><h2>${complete(c) ? th('Champion: {name}.', { name: table[0].id === 0 ? escapeHtml(this.playerName) : DRIVERS[table[0].id] }) : th('Standings.')}</h2><ol class="championship-calendar">${calendar}</ol><table class="results"><thead><tr><th>${th('POS')}</th><th>${th('DRIVER')}</th><th>${th('PTS')}</th><th>${th('WINS')}</th><th>${th('RESULTS')}</th></tr></thead><tbody>${rows}</tbody></table><div class="dialog-buttons inline">${round ? `<button class="primary" data-action="championship:start">${th('START ROUND {round} · QUALIFYING', { round: c.results.length + 1 })}</button>` : ''}<button data-action="championship:new">${th('NEW CHAMPIONSHIP')}</button><button data-action="modalClose">${th('CLOSE')}</button></div>`,
    );
  }
  error(error: string) {
    this.get('loading').hidden = true;
    this.modalContent(
      `<span class="eyebrow">${th('SOMETHING WENT WRONG')}</span><h2>${th('Session stopped.')}</h2><p>${th('The session could not continue. Reload to return to the paddock. If this keeps happening, lower the render quality in Garage & Settings.')}</p><p id="errorMessage" class="error-detail"></p><button class="primary" data-action="reload">${th('RELOAD GAME')}</button>`,
    );
    document.getElementById('errorMessage')!.textContent = error;
  }
}
