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
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
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
interface Callbacks {
  action: (name: string) => void;
  start: (options: SessionOptions) => void;
  apply: (settings: Settings) => void;
  seek: (value: number) => void;
  replaySpeed: (value: number) => void;
  exportSetup: () => void;
  importSetup: (file: File) => void;
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
   </form><div class="menu-actions"><button data-action="settings">GARAGE & SETTINGS</button><button data-action="controls">CONTROLS</button></div>
   <p class="menu-note">WASD / ARROWS TO DRIVE · GAMEPAD SUPPORTED<br>G TO WATCH THE AI DRIVE YOUR CAR</p></div>
   <div class="car-label"><span>APX–01</span><b>FORMULA / HYBRID</b><div>770 KG DRY · 8 SPEED · 4 MJ ERS</div></div>
   <footer class="menu-footer"><span><b>${(track.length / 1000).toFixed(3)}</b> KM CIRCUIT</span><span><b>120</b> HZ SIMULATION</span><span><b>240</b> HZ TIRE SOLVE</span><span>ENGINEERING BUILD / 0.1</span></footer>
  </section>
  <section id="hud" class="hud" hidden>
   <div class="hud-top"><div class="brand small">APEX<span>/ LIVE</span></div><div class="session-status"><span id="lapLabel">LAP 1 / 3</span><b id="flag">GRID</b><span id="weatherLabel">24°C / DRY</span></div><button class="icon-button" data-action="pause" aria-label="Pause session">Ⅱ</button></div>
   <aside class="timing"><div class="panel-heading">CLASSIFICATION <span>LIVE</span></div><div id="tower"></div></aside>
   <div class="lap-panel"><label>CURRENT LAP<b id="lapTime">—:——.———</b></label><label>PERSONAL BEST<span id="bestLap">—:——.———</span></label><label>LAST LAP<span id="lastLap">—:——.———</span></label></div>
   <div id="startSequence" class="start-sequence" hidden><div id="lights">${'<i></i>'.repeat(5)}</div><span id="startText">BUILD REVS. HOLD THE BRAKE.</span></div>
   <div class="race-message" id="raceMessage" role="status" aria-live="polite"></div>
   <div class="minimap"><canvas id="minimap" width="250" height="240"></canvas><span>AUREL / GRAND CIRCUIT</span></div>
   <div class="instruments"><div class="rev-lights" id="rpmLights">${'<i></i>'.repeat(16)}</div><div class="dash-main"><div class="gear"><b id="gear">1</b><span>GEAR</span></div><div class="speed"><b id="speed">000</b><span>KM/H</span></div><div class="engine"><b id="rpm">4,200</b><span>RPM</span><strong id="ersMode">BALANCED</strong></div></div>
   <div class="pedals"><label>BRK<span class="meter"><i id="brakeBar"></i></span></label><label>THR<span class="meter"><i id="throttleBar"></i></span></label></div>
   <div class="resources"><label>ERS <b id="battery">80%</b><span class="meter"><i id="batteryBar"></i></span></label><label>FUEL <b id="fuel">24.0 KG</b></label></div></div>
   <aside class="car-status"><div class="panel-heading">VEHICLE STATE <span id="tireCompound">MEDIUM</span></div><div id="tires" class="tires">${['FL', 'FR', 'RL', 'RR'].map((name) => `<div><label>${name}</label><b>87°</b><span>100%</span><small>320° BRAKE</small></div>`).join('')}</div><div class="health"><span>AERO <b id="health">100%</b></span><span>LAT <b id="lateralG">0.0 G</b></span><span>PEN <b id="penalty">0 S</b></span></div></aside>
   <nav class="hud-actions"><button data-action="camera"><kbd>C</kbd> <span id="cameraLabel">CHASE</span></button><button data-action="pit"><kbd>P</kbd> PIT</button><button data-action="ers"><kbd>E</kbd> ERS</button><button data-action="telemetry"><kbd>T</kbd> DATA</button><button data-action="replay"><kbd>R</kbd> REPLAY</button><button data-action="autopilot"><kbd>G</kbd> <span id="autoLabel">AI OFF</span></button></nav>
   <div class="touch-controls"><button data-touch="left" aria-label="Steer left">◀</button><button data-touch="right" aria-label="Steer right">▶</button><button data-touch="brake">BRAKE</button><button data-touch="throttle">THROTTLE</button></div>
  </section>
  <div id="replayBar" class="replay-bar" hidden><span class="replay-tag">REPLAY</span><button data-action="replayPlay" id="replayPlay">PAUSE</button><span id="replayTime">0:00</span><input id="replaySeek" type="range" min="0" max="1" step=".01" value="0" aria-label="Replay position"><select id="replaySpeed" aria-label="Replay playback speed"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button data-action="camera">CAMERA</button><button data-action="replayExit">RETURN</button></div>
  <div id="debug" class="debug" hidden></div><div id="toast" class="toast" role="status" hidden></div>
  <dialog id="modal"><div id="modalContent"></div></dialog>
  <dialog id="telemetryModal" class="telemetry-modal"><header><div><span class="eyebrow">ENGINEERING / DATA</span><h2>Telemetry</h2></div><button data-action="telemetryClose" aria-label="Close telemetry">✕</button></header><canvas id="graph" width="1100" height="430"></canvas><div class="telemetry-actions"><button data-action="compare">COMPARE LAPS</button><button data-action="csv">EXPORT CSV</button><span>SI UNITS · RECORDED SIMULATION STATE</span></div></dialog>
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
    if (!node) {
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
  showMode(mode: 'menu' | 'driving' | 'paused' | 'results' | 'replay' | 'loading') {
    this.menu.hidden = mode !== 'menu';
    this.hud.hidden = mode === 'menu' || mode === 'loading';
    this.replayBar.hidden = mode !== 'replay';
    this.element.dataset.mode = mode;
  }
  setText(id: string, value: string) {
    const e = this.get(id);
    if (e.textContent !== value) e.textContent = value;
  }
  update(frame: Float32Array, renderer: RacingRenderer, auto: boolean, ers: number) {
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
    const flag =
      frame[H.PHASE] < 2
        ? 'GRID'
        : frame[H.FLAG] === 1
          ? 'YELLOW FLAG'
          : frame[H.FLAG] === 2
            ? 'CHEQUERED'
            : 'GREEN FLAG';
    this.setText('flag', flag);
    this.get('flag').dataset.flag = String(frame[H.FLAG]);
    this.setText(
      'weatherLabel',
      `${Math.round(frame[H.AMBIENT])}°C / ${frame[H.RAIN] > 0.1 ? 'RAIN ' + frame[H.RAIN].toFixed(0) + ' MM/H' : 'DRY'}`,
    );
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
    const message = auto
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
        `#${LIVERIES[id].toString(16).padStart(6, '0')}`;
      e.querySelector('span')!.textContent = DRIVERS[id];
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
      const s = renderer.stats();
      this.get('debug').textContent =
        `RENDER ${s.fps.toFixed(1)} FPS / ${s.frameMs.toFixed(1)} ms\n1% LOW ${s.p1FPS.toFixed(1)} FPS\nCPU SUBMIT ${s.renderCPUms.toFixed(2)} ms\nPHYSICS ${frame[H.STEP_MS].toFixed(2)} ms / tick\nDRAWS ${s.drawCalls} · TRI ${s.triangles.toLocaleString()}\nWALL TIME DROPPED ${frame[H.DROPPED].toFixed(3)} s\nTICK ${Math.round(frame[H.TICK])}\nFRONT AERO ${frame[o + F.AERO_FRONT].toFixed(0)} N\nREAR AERO ${frame[o + F.AERO_REAR].toFixed(0)} N\nWATER ${frame[H.WATER].toFixed(3)} mm\nWAKE ${(frame[o + F.WAKE] * 100).toFixed(0)}%\nAI TARGET ${(frame[o + F.AI_TARGET] * 3.6).toFixed(0)} km/h\nGPU TIME: NOT MEASURED`;
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
      `<span class="eyebrow">SESSION SUSPENDED</span><h2>Hold your line.</h2><p>Simulation and race time are paused.</p><div class="dialog-buttons"><button class="primary" data-action="resume">RESUME SESSION</button><button data-action="settings">GARAGE & SETTINGS</button><button data-action="replay">WATCH REPLAY</button><button data-action="restart">RESTART SESSION</button><button data-action="menu">RETURN TO PADDOCK</button></div>`,
    );
  }
  controls() {
    this.modalContent(
      `<span class="eyebrow">DRIVER BRIEFING</span><h2>Take control.</h2><div class="control-grid"><b>W / ↑</b><span>Throttle</span><b>S / ↓ / SPACE</b><span>Brake</span><b>A D / ← →</b><span>Steering</span><b>[ / ]</b><span>Shift down / up · switches to manual</span><b>B + W</b><span>Reverse when nearly stopped</span><b>C</b><span>Chase / cockpit / pod / trackside</span><b>P</b><span>Pit request · automatic drive to box and exit</span><b>E</b><span>Harvest / balanced / attack energy modes</span><b>G</b><span>Toggle AI demonstration driving</span><b>T / R / F3</b><span>Telemetry / replay / engineering overlay</span><b>M / ESC</b><span>Mute / pause</span><b>DOUBLE CLICK</b><span>Mouse look in cockpit · Escape releases</span></div><p>Standard gamepads: left stick, trigger pedals, shoulder shifts, Y camera, X energy, Start pause. Nonstandard wheels require axis mapping in settings. Native wheel force feedback is not implemented.</p><button class="primary" data-action="modalClose">UNDERSTOOD</button>`,
    );
  }
  modalContent(html: string) {
    this.get('modalContent').innerHTML = html;
    if (!this.modal.open) this.modal.showModal();
  }
  closeModal() {
    if (this.modal.open) this.modal.close();
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
          step = max > 1000 ? 1000 : max > 100 ? 1 : max <= 0.01 ? 0.0005 : 0.001;
        return `<label class="range-row">${descriptions[key]}<output>${settings.setup[key]}</output><input name="${key}" data-setup type="range" min="${min}" max="${max}" step="${step}" value="${settings.setup[key]}"></label>`;
      })
      .join('');
    this.modalContent(
      `<header><div><span class="eyebrow">GARAGE / PREFERENCES</span><h2>Make it yours.</h2></div><button data-action="modalClose" aria-label="Close settings">✕</button></header><form id="settingsForm"><div class="settings-columns"><section><h3>Presentation</h3><label>RENDER QUALITY<select name="quality"><option value="low">Low · No shadows / crowd / particles</option><option value="medium">Medium · Balanced</option><option value="high">High · Bloom / higher resolution</option></select></label>${[
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
        )}<h3>Input mapping</h3><p class="small-note">Axis and button numbers are zero-based. Keyboard always remains available.</p><div class="mapping-grid">${[
        ['steerAxis', 'Steer axis'],
        ['throttleAxis', 'Throttle axis'],
        ['brakeAxis', 'Brake axis'],
        ['throttleButton', 'Throttle button'],
        ['brakeButton', 'Brake button'],
      ]
        .map(
          ([key, title]) =>
            `<label>${title}<input name="${key}" type="number" min="0" max="${key.includes('Button') ? 31 : 15}" value="${settings.mapping[key as keyof typeof settings.mapping]}"></label>`,
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
        )}<label class="range-row">Deadzone<output>${settings.mapping.deadzone}</output><input name="deadzone" type="range" min="0" max=".35" step=".01" value="${settings.mapping.deadzone}"></label><label class="range-row">Steering response exponent<output>${settings.mapping.exponent}</output><input name="exponent" type="range" min=".5" max="3" step=".1" value="${settings.mapping.exponent}"></label><h3>Keyboard bindings</h3><div class="binding-grid">${Object.entries(
        settings.bindings,
      )
        .map(
          ([action, key]) =>
            `<label>${action}<button type="button" data-bind="${action}" data-key="${key}">${key}</button></label>`,
        )
        .join(
          '',
        )}</div></section><section><h3>Vehicle setup</h3><p class="small-note">Physical setup changes take effect at the next session start. Rendering and audio changes apply immediately.</p>${setupRows}<div class="setup-files"><button type="button" id="exportSetup">EXPORT SETUP</button><label class="file-label">IMPORT SETUP<input id="importSetup" type="file" accept=".json,application/json" hidden></label></div></section></div><footer><button type="button" data-action="modalClose">CANCEL</button><button class="primary" type="submit">APPLY & SAVE</button></footer></form>`,
    );
    const form = document.getElementById('settingsForm') as HTMLFormElement;
    (form.elements.namedItem('quality') as HTMLSelectElement).value = settings.quality;
    form.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const output = input.parentElement?.querySelector('output');
      if (output) output.value = input.value;
    });
    form.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((button) =>
      button.addEventListener('click', () => {
        button.textContent = 'PRESS A KEY';
        const listener = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (/^(Key[A-Z]|Arrow(Left|Right|Up|Down)|Digit[0-9])$/.test(e.code)) {
            button.dataset.key = e.code;
            button.textContent = e.code;
            document.removeEventListener('keydown', listener, true);
          } else if (e.code === 'Escape') {
            button.textContent = button.dataset.key!;
            document.removeEventListener('keydown', listener, true);
          }
        };
        document.addEventListener('keydown', listener, true);
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
      for (const key of ['volume', 'shake', 'uiScale'] as const) next[key] = Number(value(key));
      for (const key of Object.keys(DEFAULT_SETUP) as (keyof Setup)[])
        next.setup[key] = Number(value(key));
      for (const key of [
        'steerAxis',
        'throttleAxis',
        'brakeAxis',
        'throttleButton',
        'brakeButton',
        'deadzone',
        'exponent',
      ] as const)
        next.mapping[key] = Number(value(key));
      for (const key of ['axisPedals', 'invertSteer', 'invertPedals'] as const)
        next.mapping[key] = (form.elements.namedItem(key) as HTMLInputElement).checked;
      form
        .querySelectorAll<HTMLButtonElement>('[data-bind]')
        .forEach((button) => (next.bindings[button.dataset.bind!] = button.dataset.key!));
      this.callbacks.apply(validateSettings(next));
    };
  }
  results(frame: Float32Array) {
    const rows = Array.from({ length: frame[H.CARS] }, (_, id) => id)
      .sort((a, b) => frame[carBase(a) + F.RANK] - frame[carBase(b) + F.RANK])
      .map((id, index) => {
        const p = carBase(id);
        return `<tr${id === 0 ? ' class="you"' : ''}><td>${index + 1}</td><td>${DRIVERS[id]}</td><td>${frame[p + F.FINISH] > 0 ? lapTime(frame[p + F.FINISH]) : 'RUNNING'}</td><td>${lapTime(frame[p + F.BEST_LAP])}</td><td>${frame[p + F.PENALTY].toFixed(0)}s</td></tr>`;
      })
      .join('');
    this.modalContent(
      `<span class="eyebrow">CHEQUERED FLAG / SESSION CLASSIFICATION</span><h2>Across the line.</h2><p>Order at your finish. Cars not yet finished are marked RUNNING.</p><table class="results"><thead><tr><th>POS</th><th>DRIVER</th><th>TIME + PEN.</th><th>BEST LAP</th><th>PEN.</th></tr></thead><tbody>${rows}</tbody></table><div class="dialog-buttons inline"><button class="primary" data-action="replay">WATCH REPLAY</button><button data-action="telemetry">TELEMETRY</button><button data-action="restart">RACE AGAIN</button><button data-action="menu">PADDOCK</button></div>`,
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
