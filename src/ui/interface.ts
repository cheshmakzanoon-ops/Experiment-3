import { audioAccessibility, readDrivingAudio } from './audio-accessibility.ts';
import type { DrivingAudioSettings } from '../audio/driving-cues.ts';
import { nearbyTraffic } from './proximity.ts';
import { BUTTON_ACTIONS, BUTTON_ACTION_LABELS } from '../input/button-actions.ts';
import { engineeringReport } from './engineering.ts';
import { FLAG, flagLabel, yellowFlag } from '../simulation/marshal.ts';
import { presentationControls, bindPresentation, weatherReadout } from './presentation.ts';
import { DeviceCalibrationPanel } from './device-calibration.ts';
import {
  BINDING_LABELS,
  keyName,
  validateBindings,
  type BindingAction,
  type Bindings,
} from '../input/bindings.ts';
import { TELEMETRY_VIEWS, type TelemetryView } from '../storage/telemetry-plots.ts';
import {
  COMPOUNDS,
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  DRIVERS,
  LIVERIES,
  SETUP_LIMITS,
  type SessionOptions,
  type Setup,
} from '../simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, WHEEL_NAMES, carBase } from '../simulation/protocol.ts';
import { type Track } from '../simulation/track.ts';
import { type Settings, validateSettings } from '../storage/data.ts';
import { type RacingRenderer } from '../rendering/renderer.ts';
export const lapTime = (seconds: number) =>
  seconds > 0
    ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
    : '—:——.———';
export const shortTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
/** Keep useful slider increments without rounding a valid researched/imported setup. */
export function setupControlStep(key: keyof Setup, value: number): number | 'any' {
  const [min, max] = SETUP_LIMITS[key];
  const preferred = max > 1000 ? 500 : max > 100 ? 1 : max <= 0.01 ? 0.0005 : 0.001;
  const steps = (value - min) / preferred;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? preferred : 'any';
}
interface Callbacks {
  action: (name: string) => void;
  start: (options: SessionOptions) => void;
  apply: (settings: Settings) => void;
  seek: (value: number) => void;
  replaySpeed: (value: number) => void;
  exportSetup: () => void;
  importSetup: (file: File) => void;
  previewAudio?: (settings: DrivingAudioSettings) => void;
}
export class Interface {
  readonly menu: HTMLElement;
  readonly hud: HTMLElement;
  readonly modal: HTMLDialogElement;
  readonly map: HTMLCanvasElement;
  readonly graph: HTMLCanvasElement;
  readonly replayBar: HTMLElement;
  private toastTimer = 0;
  private nodes = new Map<string, HTMLElement>();
  private tick = 0;
  private lastAnnounced = '';
  private deviceCalibration: DeviceCalibrationPanel | null = null;
  private bindingCapture: AbortController | null = null;
  playerName = DRIVERS[0];
  options: SessionOptions = { ...DEFAULT_OPTIONS };
  constructor(
    readonly element: HTMLElement,
    readonly track: Track,
    private callbacks: Callbacks,
  ) {
    element.innerHTML = `
  <div id="loading" class="loading"><div class="brand">APEX<span>/ FORMULA</span></div><p id="loadingText">Preparing circuit and car systems…</p><div class="loader"><i></i></div></div>
  <section id="menu" class="menu" hidden>
   <header class="masthead"><div class="brand">APEX<span>/ FORMULA</span></div><span class="edition">ORIGINAL MOTORSPORT SIMULATION <b>01 / AUREL</b></span></header>
   <div class="menu-body"><div class="eyebrow"><i></i> AUREL · GRAND CIRCUIT</div><h1>EVERY INPUT.<br>EVERY FORCE.</h1><p class="intro">Four contact patches. One racing line.<br>Find the limit between them.</p>
   <form id="sessionForm" class="session-form">
    <div class="form-row"><label>SESSION<select id="mode"><option value="race">Grand Prix</option><option value="practice">Free practice</option></select></label><label>DISTANCE<select id="laps"><option value="1">1 lap · Sprint</option><option value="3" selected>3 laps · Standard</option><option value="5">5 laps</option><option value="10">10 laps</option></select></label></div>
    <div class="form-row"><label>WEATHER<select id="weather"><option value="clear">Clear / Dry</option><option value="changeable">Dry → Rain</option><option value="rain">Heavy rain</option></select></label><label>GRID<select id="opponents"><option value="0">Solo</option><option value="3">4 cars</option><option value="7" selected>8 cars</option><option value="11">12 cars</option></select></label></div>
    <div class="form-row"><label>TIRES<select id="compound"><option value="soft">Soft</option><option value="medium" selected>Medium</option><option value="hard">Hard</option><option value="intermediate">Intermediate</option><option value="wet">Full wet</option></select></label><label>CONTROL<select id="assist"><option value="sport">Sport / ABS + TC</option><option value="raw">Unassisted</option></select></label></div>
    <button class="primary enter" type="submit">ENTER CIRCUIT <span>↗</span></button>
   </form><div class="menu-actions"><button data-action="settings">GARAGE & SETTINGS</button><button data-action="controls">CONTROLS</button><button data-action="team">TEAM HQ</button><button data-action="photo">PHOTO / LIVERY</button><button data-action="references">REFERENCE REVIEW</button><button data-action="academy">DRIVING ACADEMY</button></div>
   <p class="menu-note">WASD / ARROWS TO DRIVE · GAMEPAD SUPPORTED<br>G TO WATCH THE AI DRIVE YOUR CAR</p></div>
   <div class="car-label"><span>APX–01</span><b>FORMULA / HYBRID</b><div>770 KG DRY · 8 SPEED · 4 MJ ERS</div></div>
   <footer class="menu-footer"><span><b>${(track.length / 1000).toFixed(3)}</b> KM CIRCUIT</span><span><b>120</b> HZ SIMULATION</span><span><b>240</b> HZ TIRE SOLVE</span><span>ENGINEERING BUILD / 0.1</span></footer>
  </section>
  <section id="hud" class="hud" hidden>
   <div class="hud-top"><div class="brand small">APEX<span>/ LIVE</span></div><div class="session-status"><span id="lapLabel">LAP 1 / 3</span><b id="flag">GRID</b><span id="weatherLabel">24°C / DRY</span></div><button class="icon-button" data-action="pause" aria-label="Pause session">Ⅱ</button></div>
   <aside class="timing"><div class="panel-heading">CLASSIFICATION <span>LIVE</span></div><div id="tower"></div></aside>
   <div class="lap-panel"><label class="lap-delta">DELTA TO BEST<span id="lapDelta">—</span></label><label class="lap-current">CURRENT LAP<b id="lapTime">—:——.———</b></label><label>PERSONAL BEST<span id="bestLap">—:——.———</span></label><label>LAST LAP<span id="lastLap">—:——.———</span></label></div>
   <div id="startSequence" class="start-sequence" hidden><div id="lights">${'<i></i>'.repeat(5)}</div><span id="startText">BUILD REVS. HOLD THE BRAKE.</span></div>
   <div class="proximity proximity-left" id="proximityLeft" hidden><b>◀</b><span>CAR LEFT</span></div><div class="proximity proximity-right" id="proximityRight" hidden><b>▶</b><span>CAR RIGHT</span></div>
   <div class="race-message" id="raceMessage" role="status" aria-live="polite"></div>
   <div class="minimap"><canvas id="minimap" width="250" height="240"></canvas><span>AUREL / GRAND CIRCUIT</span></div>
   <div class="instruments"><div class="programme-hud" id="programmeHud" hidden></div><div class="guide-readout" id="guideReadout" hidden></div><div class="rev-lights" id="rpmLights">${'<i></i>'.repeat(16)}</div><div class="dash-main"><div class="gear"><b id="gear">1</b><span>GEAR</span></div><div class="speed"><b id="speed">000</b><span>KM/H</span></div><div class="engine"><b id="rpm">4,200</b><span>RPM</span><strong id="ersMode">BALANCED</strong></div></div>
   <div class="pedals"><label>BRK<span class="meter"><i id="brakeBar"></i></span></label><label>THR<span class="meter"><i id="throttleBar"></i></span></label></div>
   <div class="resources"><label>ERS <b id="battery">80%</b><span class="meter"><i id="batteryBar"></i></span></label><label>FUEL <b id="fuel">24.0 KG</b></label></div></div>
   <aside class="car-status"><div class="panel-heading">VEHICLE STATE <span id="tireCompound">MEDIUM</span></div><div id="tires" class="tires">${WHEEL_NAMES.map((name) => `<div><label>${name}</label><b>87°</b><span>100%</span><small>320° BRAKE</small></div>`).join('')}</div><div class="health"><span>AERO <b id="health">100%</b></span><span>LAT <b id="lateralG">0.0 G</b></span><span>PEN <b id="penalty">0 S</b></span></div></aside>
   <nav class="hud-actions"><button data-action="camera"><kbd>C</kbd> <span id="cameraLabel">CHASE</span></button><button data-action="pit"><kbd>P</kbd> PIT</button><button data-action="ers"><kbd>E</kbd> ERS</button><button data-action="telemetry"><kbd>T</kbd> DATA</button><button data-action="replay"><kbd>R</kbd> REPLAY</button><button data-action="autopilot"><kbd>G</kbd> <span id="autoLabel">AI OFF</span></button></nav>
   <div class="touch-controls"><button data-touch="left" aria-label="Steer left">◀</button><button data-touch="right" aria-label="Steer right">▶</button><button data-touch="brake">BRAKE</button><button data-touch="throttle">THROTTLE</button></div>
  </section>
  <div id="replayBar" class="replay-bar" hidden><span class="replay-tag">REPLAY</span><button data-action="replayPlay" id="replayPlay">PAUSE</button><span id="replayTime">0:00</span><input id="replaySeek" type="range" min="0" max="1" step=".01" value="0" aria-label="Replay position"><select id="replaySpeed" aria-label="Replay playback speed"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button data-action="camera">CAMERA</button><button data-action="photo">PHOTO STUDIO</button><button data-action="academy">ACADEMY</button><button data-action="replayExit">RETURN</button></div>
  <div id="debug" class="debug" hidden></div><div id="toast" class="toast" role="status" hidden></div>
  <dialog id="modal"><div id="modalContent"></div></dialog>
  <dialog id="telemetryModal" class="telemetry-modal"><header><div><span class="eyebrow">ENGINEERING / DATA</span><h2>Telemetry</h2></div><button data-action="telemetryClose" aria-label="Close telemetry">✕</button></header><label class="telemetry-selector">CHANNEL GROUP<select id="telemetryView" aria-label="Telemetry channels">${Object.entries(
    TELEMETRY_VIEWS,
  )
    .map(([key, view]) => `<option value="${key}">${view.title}</option>`)
    .join(
      '',
    )}</select></label><canvas id="graph" width="1100" height="590" role="img"></canvas><div class="telemetry-actions"><button data-action="compare">COMPARE LAPS</button><button data-action="csv">EXPORT CSV</button><span>SI UNITS · RECORDED SIMULATION STATE</span></div></dialog>
  `;
    this.menu = this.get('menu');
    this.hud = this.get('hud');
    this.modal = this.get('modal') as HTMLDialogElement;
    this.map = this.get('minimap') as HTMLCanvasElement;
    this.graph = this.get('graph') as HTMLCanvasElement;
    this.replayBar = this.get('replayBar');
    element.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (button) this.callbacks.action(button.dataset.action!);
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
      const select = (id: string) => (this.get(id) as HTMLSelectElement).value;
      this.options = {
        ...DEFAULT_OPTIONS,
        mode: select('mode') as SessionOptions['mode'],
        laps: Number(select('laps')),
        opponents: Number(select('opponents')),
        weather: select('weather') as SessionOptions['weather'],
        compound: select('compound') as SessionOptions['compound'],
        assist: select('assist') as SessionOptions['assist'],
      };
      this.callbacks.start(this.options);
    });
    this.get('weather').addEventListener('change', () => {
      if ((this.get('weather') as HTMLSelectElement).value === 'rain')
        (this.get('compound') as HTMLSelectElement).value = 'wet';
    });
    this.get('replaySeek').addEventListener('input', (e) =>
      this.callbacks.seek(Number((e.target as HTMLInputElement).value)),
    );
    this.get('replaySpeed').addEventListener('change', (e) =>
      this.callbacks.replaySpeed(Number((e.target as HTMLSelectElement).value)),
    );
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
  loading(text: string) {
    this.get('loadingText').textContent = text;
    this.get('loading').hidden = false;
  }
  ready() {
    this.get('loading').hidden = true;
    this.menu.hidden = false;
  }
  toast(message: string) {
    const e = this.get('toast');
    e.textContent = message;
    e.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (e.hidden = true), 6000);
  }
  showMode(mode: 'menu' | 'driving' | 'paused' | 'results' | 'replay' | 'loading' | 'photo') {
    this.menu.hidden = mode !== 'menu';
    this.hud.hidden = mode === 'menu' || mode === 'loading' || mode === 'photo';
    this.get('debug').hidden ||= mode === 'photo';
    this.replayBar.hidden = mode !== 'replay';
    this.element.dataset.mode = mode;
  }
  setText(id: string, value: string) {
    const e = this.get(id);
    if (e.textContent !== value) e.textContent = value;
  }
  update(frame: Float32Array, renderer: RacingRenderer, auto: boolean, ers: number) {
    const proximity = nearbyTraffic(frame);
    for (const side of ['left', 'right'] as const) {
      const node = this.get(side === 'left' ? 'proximityLeft' : 'proximityRight');
      node.hidden = proximity[side] === 'clear';
      node.dataset.proximity = proximity[side];
    }

    this.hud.dataset.camera = renderer.mode;
    this.tick++;
    if (this.tick % 3 !== 0) return;
    const o = carBase(0),
      speed = frame[o + F.SPEED],
      compound = Object.keys(COMPOUNDS)[Math.round(frame[o + F.COMPOUND])] ?? 'medium';
    this.setText('speed', String(Math.round(speed * 3.6)).padStart(3, '0'));
    const gear = frame[o + F.GEAR];
    this.setText('gear', gear === 0 ? 'N' : gear < 0 ? 'R' : String(Math.round(gear)));
    this.setText('rpm', Math.round(frame[o + F.RPM]).toLocaleString('en'));
    this.setText(
      'lapLabel',
      `${this.options.mode === 'practice' ? 'PRACTICE / LAP' : 'LAP'} ${Math.min(this.options.laps, Math.round(frame[o + F.LAPS]) + 1)}${this.options.mode === 'race' ? ' / ' + this.options.laps : ''}`,
    );
    const flag = frame[H.PHASE] < 2 ? 'GRID' : flagLabel(frame[H.FLAG]);
    const delta = frame[o + F.LAP_DELTA];
    this.setText(
      'lapDelta',
      frame[o + F.DELTA_VALID] ? `${delta >= 0 ? '+' : ''}${delta.toFixed(3)} S` : '—',
    );
    this.get('lapDelta').dataset.ahead = String(frame[o + F.DELTA_VALID] > 0 && delta < 0);
    this.setText('flag', flag);
    this.get('flag').dataset.flag = String(frame[H.FLAG]);
    this.setText('weatherLabel', weatherReadout(frame[H.AMBIENT], frame[H.RAIN], frame[H.WATER]));
    for (const [id, field] of [
      ['lapTime', F.LAP_TIME],
      ['bestLap', F.BEST_LAP],
      ['lastLap', F.LAST_LAP],
    ] as const)
      this.setText(id, lapTime(frame[o + field]));
    this.setText('battery', `${Math.round(frame[o + F.BATTERY] / 4e4)}%`);
    this.setText('fuel', `${frame[o + F.FUEL].toFixed(1)} KG`);
    this.get('brakeBar').style.width = `${frame[o + F.BRAKE] * 100}%`;
    this.get('throttleBar').style.width = `${frame[o + F.THROTTLE] * 100}%`;
    this.get('batteryBar').style.width = `${frame[o + F.BATTERY] / 4e4}%`;
    this.setText('ersMode', ['HARVEST', 'BALANCED', 'ATTACK'][ers]);
    this.setText('tireCompound', compound.toUpperCase());
    this.setText('autoLabel', auto ? 'AI ON' : 'AI OFF');
    this.setText('cameraLabel', renderer.mode.toUpperCase());
    this.setText('health', `${Math.round(frame[o + F.FRONT_HEALTH] * 100)}%`);
    this.setText('lateralG', `${Math.abs(frame[o + F.G_LAT]).toFixed(1)} G`);
    this.setText('penalty', `${Math.round(frame[o + F.PENALTY])} S`);
    Array.from(this.get('rpmLights').children).forEach((e, i) => {
      (e as HTMLElement).classList.toggle('lit', frame[o + F.RPM] > 5800 + i * 465);
    });
    Array.from(this.get('tires').children).forEach((e, i) => {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        temp = frame[p + W.CARCASS_TEMP];
      e.querySelector('b')!.textContent = `${Math.round(temp)}°`;
      e.querySelector('span')!.textContent = `${Math.round(100 * (1 - frame[p + W.WEAR]))}%`;
      e.querySelector('small')!.textContent = `${Math.round(frame[p + W.DISC_TEMP])}° BRAKE`;
      (e as HTMLElement).style.setProperty(
        '--tire',
        temp > 120 ? '#ed6847' : temp < 60 ? '#84acbe' : '#75b7a1',
      );
    });
    this.get('startSequence').hidden = frame[H.PHASE] !== 1;
    Array.from(this.get('lights').children).forEach((e, i) =>
      e.classList.toggle('lit', i < frame[H.LIGHTS]),
    );
    const pit = frame[o + F.PIT_PHASE];
    const message =
      frame[o + F.FINISH] > 0
        ? 'FINISHED · AUTOMATIC COOLDOWN / WAITING FOR FIELD'
        : yellowFlag(frame[H.FLAG])
          ? `${flagLabel(frame[H.FLAG])} · ${Math.round(frame[o + F.CAUTION_SPEED] * 3.6)} KM/H · NO OVERTAKING`
          : frame[H.FLAG] === FLAG.BLUE
            ? 'BLUE FLAG · HOLD A PREDICTABLE LINE / LET THE LEADER PASS'
            : auto
              ? 'AI DEMONSTRATION · PRESS G TO TAKE CONTROL'
              : pit > 0
                ? [
                    '',
                    'PIT ASSIST · APPROACHING BOX',
                    'JACKED · SERVICE',
                    'REMOVING WHEELS',
                    'NEW TIRES INSTALLED',
                    'REPAIRING FRONT WING',
                    'RELEASED · PIT EXIT',
                  ][pit]
                : frame[o + F.FRONT_HEALTH] < 0.6
                  ? 'FRONT WING DAMAGE · REQUEST PIT SERVICE'
                  : frame[H.FLAG] === 1
                    ? 'YELLOW · INCIDENT ON CIRCUIT'
                    : '';
    if (message !== this.lastAnnounced) {
      this.setText('raceMessage', message);
      this.lastAnnounced = message;
    }
    const tower = this.get('tower');
    if (tower.children.length !== frame[H.CARS])
      tower.innerHTML = Array.from(
        { length: frame[H.CARS] },
        () => '<div class="tower-row"><b></b><i></i><span></span><small></small></div>',
      ).join('');
    const order = Array.from({ length: frame[H.CARS] }, (_, id) => id).sort(
      (a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK],
    );
    order.forEach((id, rank) => {
      const e = tower.children[rank] as HTMLElement,
        p = carBase(id);
      e.classList.toggle('player', id === 0);
      e.querySelector('b')!.textContent = String(rank + 1).padStart(2, '0');
      (e.querySelector('i') as HTMLElement).style.background =
        id === 0
          ? `#${renderer.cars[0].paint.color.getHexString()}`
          : `#${LIVERIES[id].toString(16).padStart(6, '0')}`;
      e.querySelector('span')!.textContent = id === 0 ? this.playerName : DRIVERS[id];
      e.querySelector('small')!.textContent =
        frame[p + F.FINISH] > 0
          ? 'FIN'
          : frame[p + F.IN_PIT]
            ? 'PIT'
            : `${Math.round(frame[p + F.LAPS])} L`;
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
  private drawMap(frame: Float32Array) {
    const c = this.map.getContext('2d')!;
    c.clearRect(0, 0, 250, 240);
    const x = (v: number) => 125 + v * 0.24,
      z = (v: number) => 125 - v * 0.23;
    c.lineJoin = 'round';
    c.lineWidth = 4;
    c.strokeStyle = '#9ca9a0';
    c.beginPath();
    this.track.points.forEach((p, i) => {
      if (i === 0) c.moveTo(x(p.x), z(p.z));
      else c.lineTo(x(p.x), z(p.z));
    });
    c.stroke();
    for (let i = frame[H.CARS] - 1; i >= 0; i--) {
      const p = carBase(i);
      c.beginPath();
      c.fillStyle = i === 0 ? '#fff1cf' : `#${LIVERIES[i].toString(16).padStart(6, '0')}`;
      c.arc(x(frame[p]), z(frame[p + 2]), i === 0 ? 5 : 3.2, 0, Math.PI * 2);
      c.fill();
      if (i === 0) {
        c.strokeStyle = '#ee6947';
        c.lineWidth = 2;
        c.stroke();
      }
    }
  }
  pause() {
    this.modalContent(
      `<span class="eyebrow">SESSION SUSPENDED</span><h2>Hold your line.</h2><p>Simulation and race time are paused.</p><div class="dialog-buttons"><button class="primary" data-action="resume">RESUME SESSION</button><button data-action="settings">GARAGE & SETTINGS</button><button data-action="replay">WATCH REPLAY</button><button data-action="photo">PHOTO STUDIO</button><button data-action="academy">ACADEMY</button><button data-action="team">TEAM HQ</button><button data-action="performance">PERFORMANCE CAPTURE</button><button data-action="visualReview">FULL-LAP VISUAL REVIEW</button><button data-action="restart">RESTART SESSION</button><button data-action="menu">RETURN TO PADDOCK</button></div>`,
    );
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
  presentationReview(status: string, machine: string, exportable: boolean, videoReady: boolean) {
    this
      .modalContent(`<span class="eyebrow">PHASE 27E / EVIDENCE</span><h2>Review the complete lap.</h2>
      <p id="visualReviewStatus"></p>
      <p>Use the current session and camera. A full lap ends only after a complete forward circuit traversal and a real lap-counter increase. The 30-second mode covers grid/pit scenes without claiming a full lap.</p>
      <label>COMPUTER / POWER PROFILE<input id="reviewMachine" maxlength="80" placeholder="e.g. laptop-plugged-in / GPU model" /></label>
      <label>WORKLOAD<select id="reviewWorkload"><option value="clear-day">Clear day</option><option value="overcast-day">Overcast day</option><option value="wet-day">Wet day</option><option value="wet-night">Wet night</option><option value="grid-start">Grid start</option><option value="pit-service">Pit service</option><option value="other">Other / changing weather</option></select></label>
      <label>CAPTURE<select id="reviewMode"><option value="full-lap">Full lap</option><option value="timed-scene">30-second scene</option></select></label>
      <label><input id="reviewVideo" type="checkbox" /> ALSO RECORD LOCAL SILENT VIDEO (64 MiB maximum)</label>
      <p>Repeat clear, overcast, wet and wet-night sessions with cockpit, chase, pod and broadcast cameras. Choose the weather label matching the actual session; this tool never changes weather or drives the car. Changing settings, pausing or losing focus interrupts the evidence. Video adds encoding cost and can coalesce frames; JSON retains every observed rendered-frame interval. No GPU VRAM or physical-controller certification is inferred.</p>
      <div class="dialog-buttons"><button class="primary" data-action="reviewStart">RESUME & RECORD REVIEW</button><button data-action="reviewExport" ${exportable ? '' : 'disabled'}>EXPORT FRAME JSON</button><button data-action="reviewVideoExport" ${videoReady ? '' : 'disabled'}>EXPORT SILENT WEBM</button><button data-action="visualReview">REFRESH EVIDENCE STATUS</button><button data-action="modalClose">BACK</button></div>`);
    this.get('visualReviewStatus').textContent = status;
    (this.get('reviewMachine') as HTMLInputElement).value = machine;
  }
  controls(bindings: Bindings) {
    this.modalContent(
      `<span class="eyebrow">DRIVER BRIEFING</span><h2>Take control.</h2><div class="control-grid">${Object.entries(
        bindings,
      )
        .map(
          ([action, code]) =>
            `<b>${keyName(code)}</b><span>${BINDING_LABELS[action as BindingAction]}</span>`,
        )
        .join(
          '',
        )}<b>ESC</b><span>Pause / release mouse look</span><b>DOUBLE CLICK</b><span>Cockpit mouse look</span></div><p>Standard default: left stick, trigger pedals, shoulder shifts, Y camera, X energy, Start pause/resume. Garage settings remap or disable every action button. Custom wheels require explicit device selection and assignments; no Xbox layout is assumed. Native wheel force feedback is not implemented.</p><button class="primary" data-action="modalClose">UNDERSTOOD</button>`,
    );
  }
  modalContent(html: string) {
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    this.deviceCalibration?.dispose();
    this.deviceCalibration = null;
    this.get('modalContent').innerHTML = html;
    if (!this.modal.open) this.modal.showModal();
  }
  closeModal() {
    this.bindingCapture?.abort();
    this.bindingCapture = null;
    this.deviceCalibration?.dispose();
    this.deviceCalibration = null;
    if (this.modal.open) this.modal.close();
  }
  applyBindings(bindings: Bindings) {
    this.hud.querySelectorAll<HTMLElement>('[data-action] kbd').forEach((key) => {
      const action = key.parentElement?.dataset.action as BindingAction;
      if (bindings[action]) key.textContent = keyName(bindings[action]);
    });
  }
  get telemetryView(): TelemetryView {
    const key = (this.get('telemetryView') as HTMLSelectElement).value;
    return Object.hasOwn(TELEMETRY_VIEWS, key) ? (key as TelemetryView) : 'driver';
  }
  settings(settings: Settings) {
    const descriptions: Record<keyof Setup, string> = {
      frontWing: 'Front wing',
      rearWing: 'Rear wing',
      brakeBias: 'Front brake bias',
      diffPower: 'Differential · power',
      diffCoast: 'Differential · coast',
      frontSpring: 'Front spring · N/m',
      rearSpring: 'Rear spring · N/m',
      frontARB: 'Front anti-roll · N/m',
      rearARB: 'Rear anti-roll · N/m',
      frontRide: 'Front ride height · m',
      rearRide: 'Rear ride height · m',
      frontPressure: 'Front pressure · kPa',
      rearPressure: 'Rear pressure · kPa',
      frontCamber: 'Front camber · rad',
      rearCamber: 'Rear camber · rad',
      frontToe: 'Front toe · rad',
      rearToe: 'Rear toe · rad',
    };
    const setupRows = (Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
      .map((key) => {
        const [min, max] = SETUP_LIMITS[key],
          step = setupControlStep(key, settings.setup[key]);
        return `<label class="range-row">${descriptions[key]}<output>${settings.setup[key]}</output><input name="${key}" data-setup type="range" min="${min}" max="${max}" step="${step}" value="${settings.setup[key]}"></label>`;
      })
      .join('');
    this.modalContent(
      `<header><div><span class="eyebrow">GARAGE / PREFERENCES</span><h2>Make it yours.</h2></div><button data-action="modalClose" aria-label="Close settings">✕</button></header><form id="settingsForm"><div class="settings-columns"><section><h3>Presentation</h3><label>RENDER QUALITY<select name="quality"><option value="low">Low · No shadows / crowd / particles</option><option value="medium">Medium · Balanced</option><option value="high">High · Bloom / higher resolution</option></select></label>${presentationControls(settings)}${[
        ['volume', 'Volume', 0, 1, 0.01],
        ['shake', 'Camera vibration', 0, 1, 0.01],
        ['uiScale', 'Interface scale', 0.8, 1.35, 0.05],
      ]
        .map(
          ([key, title, min, max, step]) =>
            `<label class="range-row">${title}<output>${settings[key as 'volume' | 'shake' | 'uiScale']}</output><input name="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${settings[key as 'volume' | 'shake' | 'uiScale']}"></label>`,
        )
        .join(
          '',
        )}${audioAccessibility(settings.drivingAudio)}<h3>Input mapping</h3><p class="small-note">Axis and button numbers are zero-based. Keyboard always remains available.</p><div class="mapping-grid">${[
        ['steerAxis', 'Steer axis'],
        ['throttleAxis', 'Throttle axis'],
        ['brakeAxis', 'Brake axis'],
        ['throttleButton', 'Throttle button'],
        ['brakeButton', 'Brake button'],
        ['clutchAxis', 'Clutch axis (-1: button / key)'],
        ['clutchButton', 'Clutch button (-1: key only)'],
        ['shiftUpButton', 'Upshift button (-1: disabled)'],
        ['shiftDownButton', 'Downshift button (-1: disabled)'],
      ]
        .map(
          ([key, title]) =>
            `<label>${title}<input name="${key}" type="number" min="${key.startsWith('clutch') || key.includes('Button') ? -1 : 0}" max="${key.includes('Button') ? 127 : 31}" value="${settings.mapping[key as keyof typeof settings.mapping]}"></label>`,
        )
        .join('')}</div>${[
        ['axisPedals', 'Use axes for pedals'],
        ['invertSteer', 'Invert steering axis'],
        ['invertPedals', 'Invert pedal axes'],
      ]
        .map(
          ([key, title]) =>
            `<label class="check"><input type="checkbox" name="${key}" ${settings.mapping[key as keyof typeof settings.mapping] ? 'checked' : ''}>${title}</label>`,
        )
        .join(
          '',
        )}<label class="range-row">Deadzone<output>${settings.mapping.deadzone}</output><input name="deadzone" type="range" min="0" max=".35" step=".01" value="${settings.mapping.deadzone}"></label><label class="range-row">Steering response exponent<output>${settings.mapping.exponent}</output><input name="exponent" type="range" min=".5" max="3" step=".1" value="${settings.mapping.exponent}"></label><div id="deviceCalibration"></div><h3>Controller action buttons</h3><p class="small-note">Use -1 to disable an action. Buttons cannot share an active pedal, paddle or another action. Pause/resume works from the pause menu; keyboard remains available.</p><div class="mapping-grid">${BUTTON_ACTIONS.map((action) => `<label>${BUTTON_ACTION_LABELS[action]} button<input name="action_${action}" required type="number" min="-1" max="127" step="1" value="${settings.mapping.buttonActions[action]}"></label>`).join('')}</div><h3>Keyboard bindings</h3><div class="binding-grid">${Object.entries(
        settings.bindings,
      )
        .map(
          ([action, key]) =>
            `<label>${BINDING_LABELS[action as BindingAction]}<button type="button" data-bind="${action}" data-key="${key}">${keyName(key)}</button></label>`,
        )
        .join(
          '',
        )}</div></section><section><h3>Vehicle setup</h3><p class="small-note">Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.</p>${setupRows}<div class="setup-files"><button type="button" id="exportSetup">EXPORT SETUP</button><label class="file-label">IMPORT SETUP<input id="importSetup" type="file" accept=".json,application/json" hidden></label></div></section></div><footer><button type="button" data-action="modalClose">CANCEL</button><button class="primary" type="submit">APPLY & SAVE</button></footer></form>`,
    );
    const form = document.getElementById('settingsForm') as HTMLFormElement;
    this.deviceCalibration = new DeviceCalibrationPanel(
      document.getElementById('deviceCalibration')!,
      form,
      settings.mapping,
    );
    (form.elements.namedItem('quality') as HTMLSelectElement).value = settings.quality;
    const graphics = bindPresentation(form, settings);
    form.querySelector<HTMLButtonElement>('#previewDrivingAudio')!.onclick = () =>
      this.callbacks.previewAudio?.(readDrivingAudio(form));
    form.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const output = input.parentElement?.querySelector('output');
      if (output) output.value = input.value;
    });
    form.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((button) =>
      button.addEventListener('click', () => {
        this.bindingCapture?.abort();
        this.bindingCapture = new AbortController();
        const capture = this.bindingCapture;
        button.textContent = 'PRESS A KEY · ESC CANCELS';
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
        document.addEventListener('keydown', listener, { capture: true, signal: capture.signal });
      }),
    );
    document.getElementById('exportSetup')!.onclick = () => this.callbacks.exportSetup();
    document.getElementById('importSetup')!.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.callbacks.importSetup(file);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const value = (key: string) => (form.elements.namedItem(key) as HTMLInputElement).value;
      const next = structuredClone(settings);
      next.quality = value('quality') as Settings['quality'];
      next.graphics = graphics();
      next.drivingAudio = readDrivingAudio(form);
      next.colorblind = (form.elements.namedItem('colorblind') as HTMLInputElement).checked;
      next.highContrast = (form.elements.namedItem('highContrast') as HTMLInputElement).checked;
      for (const key of ['volume', 'shake', 'uiScale'] as const) next[key] = Number(value(key));
      for (const key of Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
        next.setup[key] = Number(value(key));
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
        this.toast(`Settings not applied: ${String(error)}`);
      }
    };
  }
  results(frame: Float32Array) {
    const rows = Array.from({ length: frame[H.CARS] }, (_, id) => id)
      .sort((a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK])
      .map((id, index) => {
        const p = carBase(id);
        return `<tr${id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${id === 0 ? this.playerName : DRIVERS[id]}</td><td>${Math.round(frame[p + F.LAPS])}</td><td>${frame[p + F.FINISH] > 0 ? lapTime(frame[p + F.FINISH]) : frame[p + F.RETIRED] ? 'DNF' : 'RUNNING'}</td><td>${lapTime(frame[p + F.BEST_LAP])}</td><td>${frame[p + F.PENALTY].toFixed(0)}s</td></tr>`;
      })
      .join('');
    this.modalContent(
      `<span class="eyebrow">CHEQUERED FLAG / SESSION CLASSIFICATION</span><h2>${frame[carBase(0) + F.FINISH] > 0 ? 'Across the line.' : 'Session ended.'}</h2><p>Final classification by completed laps and penalty-adjusted time. DNF cars have no invented finish time.</p><table class="results"><thead><tr><th>POS</th><th>DRIVER</th><th>LAPS</th><th>TIME + PEN.</th><th>BEST LAP</th><th>PEN.</th></tr></thead><tbody>${rows}</tbody></table><div class="dialog-buttons inline"><button class="primary" data-action="replay">WATCH REPLAY</button><button data-action="telemetry">TELEMETRY</button><button data-action="photo">PHOTO STUDIO</button><button data-action="academy">ACADEMY</button><button data-action="team">TEAM HQ</button><button data-action="restart">RACE AGAIN</button><button data-action="menu">PADDOCK</button></div>`,
    );
  }
  error(error: string) {
    this.get('loading').hidden = true;
    this.modalContent(
      '<span class="eyebrow">SYSTEM NOTICE</span><h2>Session stopped.</h2><p id="errorMessage"></p><button class="primary" data-action="reload">RELOAD APPLICATION</button>',
    );
    document.getElementById('errorMessage')!.textContent = error;
  }
}
