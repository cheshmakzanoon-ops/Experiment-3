import './ui/style.css';
import { Track } from './simulation/track.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  validateSetup,
  type SessionOptions,
} from './simulation/config.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  carBase,
  type FromWorker,
  type ToWorker,
} from './simulation/protocol.ts';
import { RacingRenderer } from './rendering/renderer.ts';
import { Interface, shortTime } from './ui/interface.ts';
import { InputController } from './input/controller.ts';
import { RacingAudio } from './audio/engine.ts';
import {
  SaveStore,
  DEFAULT_SETTINGS,
  validateSettings,
  downloadBlob,
  type Settings,
} from './storage/data.ts';
import { ReplayRecorder, TelemetryRecorder } from './storage/recorders.ts';
import { clamp } from './core/math.ts';
type State = 'menu' | 'loading' | 'driving' | 'paused' | 'results' | 'replay';
export class GameApp {
  private track = new Track();
  private ui: Interface;
  private renderer: RacingRenderer | null = null;
  private input: InputController;
  private audio = new RacingAudio();
  private store = new SaveStore();
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private worker: Worker | null = null;
  private current: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private receivedAt = 0;
  private state: State = 'loading';
  private options: SessionOptions = { ...DEFAULT_OPTIONS };
  private auto = false;
  private ers: 0 | 1 | 2 = 1;
  private sentAt = 0;
  private previousTime = 0;
  private renderedAt = 0;
  private renderedState: State | null = null;
  private timer = 0;
  private generation = 0;
  private replay: ReplayRecorder | null = null;
  private telemetry: TelemetryRecorder | null = null;
  private replayA: Float32Array | null = null;
  private replayB: Float32Array | null = null;
  private replayTime = 0;
  private replayRate = 1;
  private replayPlaying = true;
  private replayReturn: State = 'paused';
  private comparison = false;
  private graphClock = 0;
  private telemetryReturn: State = 'paused';
  private errorStopped = false;
  private readyResolve: (() => void) | null = null;
  private initTimeout = 0;
  constructor() {
    const element = document.getElementById('app')!;
    this.ui = new Interface(element, this.track, {
      action: (name) => this.action(name),
      start: (options) => void this.start(options).catch((e) => this.fail(e)),
      apply: (s) => this.applySettings(s),
      seek: (value) => {
        this.replayTime = value;
        this.renderer?.effects.clear();
      },
      replaySpeed: (value) => (this.replayRate = value),
      exportSetup: () =>
        downloadBlob(
          new Blob([JSON.stringify({ version: 1, setup: this.settings.setup }, null, 2)], {
            type: 'application/json',
          }),
          'apex-setup.json',
        ),
      importSetup: (file) => void this.importSetup(file),
    });
    this.input = new InputController(this.settings, (name) => this.action(name));
    element
      .querySelectorAll<HTMLElement>('[data-touch]')
      .forEach((e) =>
        this.input.bindTouch(e, e.dataset.touch as 'left' | 'right' | 'throttle' | 'brake'),
      );
    window.addEventListener('resize', () => this.renderer?.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'driving') this.pause();
    });
    const canvas = document.getElementById('world') as HTMLCanvasElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fail(
        new Error(
          'The graphics context was lost. Reload to recover; reduce rendering quality if this repeats.',
        ),
      );
    });
    canvas.addEventListener('dblclick', () => {
      if (this.state === 'driving' && this.renderer?.mode === 'cockpit')
        void canvas
          .requestPointerLock()
          ?.catch((e) => this.ui.toast(`Mouse look unavailable: ${String(e)}`));
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement && this.renderer) {
        this.renderer.lookX = clamp(this.renderer.lookX - e.movementX * 0.002, -1.3, 1.3);
        this.renderer.lookY = clamp(this.renderer.lookY - e.movementY * 0.002, -0.45, 0.6);
      }
    });
    window.addEventListener('pagehide', () => this.dispose());
    window.addEventListener('unhandledrejection', (e) => this.fail(e.reason));
    window.addEventListener('error', (e) => {
      if (e.error) this.fail(e.error);
    });
    void this.boot(canvas).catch((e) => this.fail(e));
  }
  private async boot(canvas: HTMLCanvasElement) {
    try {
      const saved = await this.store.read('settings');
      if (saved) this.settings = validateSettings(saved);
    } catch (e) {
      this.ui.toast(`Local preferences unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.settings.shake = 0;
    this.input.settings = this.settings;
    this.ui.loading('Building original bodywork, materials and Aurel circuit…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    this.renderer = new RacingRenderer(canvas, this.track);
    this.renderer.setQuality(this.settings.quality);
    this.renderer.shake = this.settings.shake;
    this.audio.volume = this.settings.volume;
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.uiScale));
    const preview = new Float32Array(HEADER + CAR_STRIDE);
    const p = this.track.at(this.track.length - 32, {
        s: 0,
        x: 0,
        y: 0,
        z: 0,
        tx: 0,
        tz: 1,
        nx: 1,
        nz: 0,
        curvature: 0,
        width: 8,
        bank: 0,
        gradient: 0,
      }),
      yaw = Math.atan2(p.tx, p.tz);
    preview[H.CARS] = 1;
    preview[H.LENGTH] = this.track.length;
    preview[H.AMBIENT] = 24;
    preview[H.CLOUD] = 0.12;
    const o = carBase(0);
    preview[o] = p.x;
    preview[o + 1] = p.y + 0.516;
    preview[o + 2] = p.z;
    preview[o + F.QY] = Math.sin(yaw / 2);
    preview[o + F.QW] = Math.cos(yaw / 2);
    preview[o + F.GEAR] = 1;
    preview[o + F.RPM] = 4200;
    preview[o + F.FUEL] = 24;
    preview[o + F.BATTERY] = 3.2e6;
    preview[o + F.FRONT_HEALTH] = preview[o + F.REAR_HEALTH] = preview[o + F.FLOOR_HEALTH] = 1;
    preview[o + F.COMPOUND] = 1;
    this.current = preview;
    this.previous = preview;
    this.state = 'menu';
    this.ui.ready();
    this.ui.showMode('menu');
    this.timer = requestAnimationFrame(this.frame);
  }
  private post(message: ToWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(message, transfer);
  }
  private async start(options: SessionOptions) {
    if (this.state === 'loading' && this.worker) return;
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.state = 'loading';
    this.ui.showMode('loading');
    this.ui.loading('Preparing grid, race timing and recording buffers…');
    this.input.setEnabled(false);
    this.audio.stop();
    try {
      await this.audio.start();
    } catch (e) {
      this.ui.toast(
        `Audio unavailable: ${e instanceof Error ? e.message : String(e)}. Racing remains available.`,
      );
    }
    this.options = { ...options, setup: { ...this.settings.setup } };
    this.ui.options = this.options;
    this.auto = false;
    this.ers = 1;
    this.replay = null;
    this.telemetry = null;
    this.replayA = null;
    this.replayB = null;
    this.comparison = false;
    this.current = null;
    this.previous = null;
    this.renderer?.reset();
    this.worker?.terminate();
    const generation = ++this.generation;
    this.worker = new Worker(new URL('./workers/physics.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onerror = (e) => this.fail(new Error(`Physics worker: ${e.message}`));
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.type === 'error') {
        this.fail(new Error(message.message));
        return;
      }
      if (message.type === 'surface') {
        this.renderer?.circuit.updateSurface(message.water, message.rubber);
        return;
      }
      this.accept(message.buffer);
    };
    const ready = new Promise<void>((resolve) => (this.readyResolve = resolve));
    this.initTimeout = window.setTimeout(() => {
      if (this.state === 'loading')
        this.fail(
          new Error(
            'Physics worker did not initialize. Check that module workers are supported by the browser.',
          ),
        );
    }, 15000);
    this.post({ type: 'init', options: this.options });
    await ready;
    clearTimeout(this.initTimeout);
    if (this.errorStopped) return;
    const cars = this.options.opponents + 1;
    this.replay = new ReplayRecorder(cars);
    this.telemetry = new TelemetryRecorder();
    this.replayA = this.replay.makeFrame();
    this.replayB = this.replay.makeFrame();
    this.state = 'driving';
    this.ui.get('loading').hidden = true;
    this.ui.showMode('driving');
    this.input.setEnabled(true);
    (document.activeElement as HTMLElement)?.blur();
    this.post({ type: 'pause', value: false });
    this.sentAt = 0;
  }
  private accept(buffer: ArrayBuffer) {
    const next = new Float32Array(buffer);
    if (this.current) {
      if (this.previous && this.previous !== this.current) {
        const old = this.previous.buffer as ArrayBuffer;
        this.post({ type: 'recycle', buffer: old }, [old]);
      }
      this.previous = this.current;
    } else this.previous = next;
    this.current = next;
    this.receivedAt = performance.now();
    if (this.state === 'driving') {
      this.replay?.append(next);
      this.telemetry?.append(next);
      if (next[H.PHASE] === 3) this.finish(next);
    }
    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
    }
  }
  private frame = (time: number) => {
    this.timer = requestAnimationFrame(this.frame);
    if (this.errorStopped || !this.renderer || !this.current || !this.previous) return;
    const wallDelta = Math.max(0.001, (time - (this.previousTime || time - 16)) / 1000),
      dt = clamp(wallDelta, 0.001, 0.08);
    this.previousTime = time;
    const input = this.input.update(dt);
    input.ers = this.ers;
    if (this.state === 'driving' && time - this.sentAt >= 16) {
      this.post({ type: 'input', input: { ...input } });
      input.shift = 0;
      this.sentAt = time;
    }
    // Menus and paused telemetry do not need a continuously saturated GPU.
    // Input and worker clocks above remain independent of this presentation cap.
    const idle =
      this.state === 'menu' ||
      this.state === 'loading' ||
      this.state === 'paused' ||
      this.state === 'results';
    if (idle && this.renderedState === this.state && time - this.renderedAt < 1000 / 15) return;
    this.renderedAt = time;
    this.renderedState = this.state;
    let a = this.previous,
      b = this.current,
      alpha = clamp((time - this.receivedAt) / Math.max(8, (b[H.TIME] - a[H.TIME]) * 1000), 0, 1);
    if (this.state === 'replay' && this.replay && this.replayA && this.replayB) {
      if (this.replayPlaying)
        this.replayTime = Math.min(this.replay.duration, this.replayTime + dt * this.replayRate);
      if (this.replayTime >= this.replay.duration) this.replayPlaying = false;
      alpha = this.replay.sample(this.replayTime, this.replayA, this.replayB);
      a = this.replayA;
      b = this.replayB;
      const seek = this.ui.get('replaySeek') as HTMLInputElement;
      seek.max = String(this.replay.duration);
      seek.value = String(this.replayTime);
      this.ui.setText(
        'replayTime',
        `${shortTime(this.replayTime)} / ${shortTime(this.replay.duration)}`,
      );
      this.ui.setText('replayPlay', this.replayPlaying ? 'PAUSE' : 'PLAY');
    }
    this.renderer.draw(
      a,
      b,
      alpha,
      dt,
      this.state === 'menu' || this.state === 'loading',
      this.state === 'replay',
      wallDelta,
    );
    if (this.state !== 'menu') this.ui.update(b, this.renderer, this.auto, this.ers);
    this.audio.update(
      b,
      this.renderer.mode === 'cockpit',
      this.state === 'driving' || (this.state === 'replay' && this.replayPlaying),
    );
    if (this.ui.telemetryModal.open && this.telemetry) {
      this.graphClock += dt;
      if (this.graphClock > 0.2) {
        this.telemetry.draw(this.ui.graph, this.comparison);
        this.graphClock = 0;
      }
    }
  };
  private pause() {
    if (this.state !== 'driving') return;
    this.state = 'paused';
    this.post({ type: 'pause', value: true });
    this.input.setEnabled(false);
    this.audio.stop();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMode('paused');
    this.ui.pause();
  }
  private resume() {
    if (this.state !== 'paused') return;
    this.ui.closeModal();
    this.state = 'driving';
    this.ui.showMode('driving');
    this.input.setEnabled(true);
    this.post({ type: 'input', input: controls() });
    this.post({ type: 'pause', value: false });
    (document.activeElement as HTMLElement)?.blur();
  }
  private finish(frame: Float32Array) {
    this.state = 'results';
    this.post({ type: 'pause', value: true });
    this.input.setEnabled(false);
    this.audio.stop();
    this.ui.showMode('results');
    this.ui.results(frame);
    const best = frame[carBase(0) + F.BEST_LAP];
    if (best > 0) {
      const key = `best:AUREL:${this.options.assist}:${this.options.compound}:${this.options.weather}`;
      void this.store
        .read(key)
        .then((old) => {
          if (typeof old !== 'number' || best < old) return this.store.write(key, best);
        })
        .catch((e) => this.ui.toast(`Best lap could not be saved: ${String(e)}`));
    }
  }
  private enterReplay() {
    if (!this.replay || this.replay.duration < 1) {
      this.ui.toast('Drive for at least one second before opening replay.');
      return;
    }
    if (this.state === 'replay') {
      this.exitReplay();
      return;
    }
    if (this.state === 'driving') this.pause();
    this.replayReturn = this.state;
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.state = 'replay';
    this.replayTime = 0;
    this.replayPlaying = true;
    this.renderer?.reset();
    this.ui.showMode('replay');
    this.input.setEnabled(true);
  }
  private exitReplay() {
    if (this.state !== 'replay') return;
    this.state = this.replayReturn === 'results' ? 'results' : 'paused';
    this.input.setEnabled(false);
    this.renderer?.reset();
    this.ui.showMode(this.state);
    if (this.state === 'results' && this.current) this.ui.results(this.current);
    else this.ui.pause();
  }
  private action(name: string) {
    this.renderedState = null;
    switch (name) {
      case 'pause':
        if (this.state === 'driving') this.pause();
        else if (this.state === 'paused') this.resume();
        else if (this.state === 'replay') this.exitReplay();
        break;
      case 'blur':
        if (this.state === 'driving') this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'menu':
        this.ui.closeModal();
        this.ui.telemetryModal.close();
        this.state = 'menu';
        this.post({ type: 'pause', value: true });
        this.input.setEnabled(false);
        this.audio.stop();
        this.ui.showMode('menu');
        this.renderer?.reset();
        break;
      case 'restart':
        void this.start(this.options).catch((e) => this.fail(e));
        break;
      case 'settings':
        if (this.state === 'driving') this.pause();
        this.ui.settings(this.settings);
        break;
      case 'controls':
        this.ui.controls();
        break;
      case 'modalClose':
        this.ui.closeModal();
        if (this.state === 'paused') this.ui.pause();
        else if (this.state === 'results' && this.current) this.ui.results(this.current);
        break;
      case 'camera':
        this.renderer?.changeCamera();
        break;
      case 'pit':
        if (this.state === 'driving') {
          this.post({ type: 'pit' });
          this.ui.toast(
            'Pit request toggled. Pit assist drives to the box, services the car, then returns control after the exit.',
          );
        }
        break;
      case 'ers':
        this.ers = ((this.ers + 1) % 3) as 0 | 1 | 2;
        break;
      case 'mute':
        this.audio.muted = !this.audio.muted;
        this.ui.toast(this.audio.muted ? 'Audio muted.' : 'Audio enabled.');
        break;
      case 'debug':
        if (this.renderer) this.renderer.debug = !this.renderer.debug;
        break;
      case 'autopilot':
        if (this.state === 'driving') {
          this.auto = !this.auto;
          this.post({ type: 'autopilot', value: this.auto });
          this.ui.toast(
            this.auto ? 'AI demonstration enabled. Press G to take control.' : 'You have control.',
          );
        }
        break;
      case 'replay':
        this.enterReplay();
        break;
      case 'replayExit':
        this.exitReplay();
        break;
      case 'replayPlay':
        if (this.replay && this.replayTime >= this.replay.duration) this.replayTime = 0;
        this.replayPlaying = !this.replayPlaying;
        break;
      case 'telemetry':
        if (!this.telemetry) {
          this.ui.toast('Start a session to record telemetry.');
          return;
        }
        if (this.state === 'driving') this.pause();
        this.telemetryReturn = this.state;
        this.ui.closeModal();
        this.input.setEnabled(false);
        this.audio.stop();
        this.ui.telemetryModal.showModal();
        this.telemetry.draw(this.ui.graph, this.comparison);
        break;
      case 'telemetryClose':
        this.ui.telemetryModal.close();
        if (this.telemetryReturn === 'results' && this.current) this.ui.results(this.current);
        else if (this.telemetryReturn === 'replay') this.input.setEnabled(true);
        else this.ui.pause();
        break;
      case 'compare':
        this.comparison = !this.comparison;
        this.telemetry?.draw(this.ui.graph, this.comparison);
        break;
      case 'csv':
        if (this.telemetry) downloadBlob(this.telemetry.csv(), 'apex-telemetry.csv');
        break;
      case 'reload':
        location.reload();
        break;
    }
  }
  private applySettings(settings: Settings) {
    this.settings = settings;
    this.input.settings = settings;
    this.renderer?.setQuality(settings.quality);
    if (this.renderer) this.renderer.shake = settings.shake;
    this.audio.volume = settings.volume;
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
    this.action('modalClose');
    void this.store
      .write('settings', settings)
      .then(() => this.ui.toast('Preferences saved. Vehicle setup applies to the next session.'))
      .catch((e) => this.ui.toast(`Applied for this session, but saving failed: ${String(e)}`));
  }
  private async importSetup(file: File) {
    try {
      if (file.size > 100000) throw new Error('Setup file is too large.');
      const value = JSON.parse(await file.text()) as { version: unknown; setup: unknown };
      if (value.version !== 1) throw new Error('Unsupported setup version.');
      this.settings.setup = validateSetup(value.setup);
      this.ui.settings(this.settings);
      this.ui.toast('Setup imported. Apply & Save to retain it.');
    } catch (e) {
      this.ui.toast(`Import rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  private fail(error: unknown) {
    if (this.errorStopped) return;
    this.errorStopped = true;
    clearTimeout(this.initTimeout);
    this.worker?.terminate();
    this.input.setEnabled(false);
    this.audio.stop();
    console.error(error);
    this.ui.error(error instanceof Error ? error.message : String(error));
  }
  diagnostics(visual = false) {
    return {
      state: this.state,
      auto: this.auto,
      options: this.options,
      frame: this.current ? Array.from(this.current) : null,
      renderer: this.renderer?.stats(),
      visual: visual ? this.renderer?.visualDiagnostics() : null,
      replaySeconds: this.replay?.duration ?? 0,
      telemetrySamples: this.telemetry?.count ?? 0,
    };
  }
  dispose() {
    cancelAnimationFrame(this.timer);
    clearTimeout(this.initTimeout);
    this.worker?.terminate();
    this.input.dispose();
    this.renderer?.dispose();
    void this.audio.dispose().catch((e) => console.warn('Audio cleanup:', e));
  }
}
const app = new GameApp();
// Read-only diagnostics are useful to automated browser tests and hardware profiling.
Object.defineProperty(window, 'apexDiagnostics', {
  value: (visual = false) => app.diagnostics(visual),
  writable: false,
});
declare global {
  interface Window {
    apexDiagnostics: (visual?: boolean) => ReturnType<GameApp['diagnostics']>;
  }
}
