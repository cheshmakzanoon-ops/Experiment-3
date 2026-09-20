import {
  isEngineeringSample,
  type ClientMessage,
  type WorkerMessage,
} from './workers/diagnostics.ts';
import PhysicsWorker from './workers/physics.worker.ts?worker&inline';
import './ui/style.css';
import { PerformanceCapture, type FrameMetrics } from './core/performance.ts';
declare const __APEX_SOURCE_FINGERPRINT__: string;
import { Track } from './simulation/track.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  validateSetup,
  type SessionOptions,
} from './simulation/config.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from './simulation/protocol.ts';
import { RacingRenderer } from './rendering/renderer.ts';
import { Interface, shortTime } from './ui/interface.ts';
import { InputController } from './input/controller.ts';
import { InputPump } from './input/pump.ts';
import { RacingAudio } from './audio/engine.ts';
import {
  SaveStore,
  DEFAULT_SETTINGS,
  validateSettings,
  downloadBlob,
  type Settings,
} from './storage/data.ts';
import { TelemetryExport } from './storage/telemetry-export.ts';
import { SessionReplay } from './storage/replay-pages.ts';
import { TelemetryRecorder } from './storage/recorders.ts';
import { clamp } from './core/math.ts';
import {
  changeTeam,
  driverProfile,
  newTeam,
  researchSetup,
  rewardRace,
  validateTeam,
  type TeamAction,
  type TeamState,
  type ResearchId,
  type Department,
  type DriverId,
} from './storage/team-career.ts';
import { teamHub, type HubPage } from './ui/team-hub.ts';
import { PhotoStudio } from './ui/photo-studio.ts';
import { referenceReview, bindReferenceReview } from './ui/reference-review.ts';
import { REFERENCES } from './ui/reference-catalogue.ts';
import { referenceRoute } from './ui/reference-routes.ts';
import { drivingAcademy, academyConfirmation, programmeHud } from './ui/driving-academy.ts';
import { PracticeProgramme } from './simulation/practice-programme.ts';
import type { GuideMode } from './rendering/driving-guide.ts';
type State = 'menu' | 'loading' | 'driving' | 'paused' | 'results' | 'replay' | 'photo';
export class GameApp {
  private track = new Track();
  private ui: Interface;
  private photoStudio: PhotoStudio;
  private team: TeamState = newTeam();
  private teamPage: HubPage = 'overview';
  private teamBusy = false;
  private sessionId = '';
  private usedDemonstration = false;
  private programme = new PracticeProgramme();
  private inspectedReference: number | null = null;
  private photoReturn: State = 'menu';
  private photoReturnHub = false;
  private frozenPhoto: Float32Array | null = null;
  private captureRequested = false;
  private capturingPhoto = false;
  private renderer: RacingRenderer | null = null;
  private input: InputController;
  private audio = new RacingAudio();
  private store = new SaveStore();
  private exporter = new TelemetryExport();
  private exporting = false;
  private performanceCapture = new PerformanceCapture();
  private profileMachine = '';
  private profileWorkload = '';
  private profileMetrics: FrameMetrics = {
    renderCPUms: 0,
    physicsMs: 0,
    drawCalls: 0,
    triangles: 0,
    gpuMs: null,
    gpuSequence: 0,
  };
  private savingSettings = false;
  private disposed = false;
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private worker: Worker | null = null;
  private current: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private receivedAt = 0;
  private state: State = 'loading';
  private options: SessionOptions = { ...DEFAULT_OPTIONS };
  private auto = false;
  private ers: 0 | 1 | 2 = 1;
  private inputPump: InputPump;
  private previousTime = 0;
  private renderedAt = 0;
  private renderedState: State | null = null;
  private timer = 0;
  private generation = 0;
  private replay: SessionReplay | null = null;
  private telemetry: TelemetryRecorder | null = null;
  private replayA: Float32Array | null = null;
  private replayB: Float32Array | null = null;
  private replayTime = 0;
  private replayRate = 1;
  private replayPlaying = true;
  private replaySeekPending = false;
  private replayReturn: State = 'paused';
  private comparison = false;
  private liveSurface: {
    water: Float32Array;
    rubber: Float32Array;
    marbles: Float32Array;
    time: number;
  } | null = null;
  private appliedReplaySurfaceTime = -Infinity;
  private recordingWarnings: string[] = [];
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
        this.seekReplay(value);
      },
      replaySpeed: (value) => {
        if (Number.isFinite(value)) this.replayRate = clamp(value, 0.25, 2);
      },
      previewAudio: (settings) => {
        void this.audio
          .previewDriving(settings)
          .catch((error) => this.ui.toast(`Audio preview unavailable: ${String(error)}`));
      },
      exportSetup: () =>
        downloadBlob(
          new Blob([JSON.stringify({ version: 1, setup: this.settings.setup }, null, 2)], {
            type: 'application/json',
          }),
          'apex-setup.json',
        ),
      importSetup: (file) => void this.importSetup(file),
    });
    this.photoStudio = new PhotoStudio(element, {
      change: (value) => this.renderer?.setPhoto(value, this.frozenPhoto?.[H.CARS] ?? 1),
      preview: (value) => this.renderer?.setLivery(value),
      save: async (value) => {
        await this.saveTeam(changeTeam(this.team, { type: 'livery', value }));
      },
      capture: () => {
        if (this.state !== 'photo' || this.capturingPhoto || this.captureRequested) return;
        this.captureRequested = true;
        this.photoStudio.captureBusy(true);
      },
      close: () => this.closePhoto(),
    });
    // The studio is not a dialog: own Escape even when a slider/button has focus.
    element.addEventListener('keydown', (event) => {
      if (this.state === 'photo' && event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closePhoto();
      }
    });
    this.input = new InputController(this.settings, (name) => this.action(name));
    this.inputPump = new InputPump((dt) => {
      if (this.errorStopped || document.hidden) return;
      if (this.state !== 'driving') {
        if (this.state === 'replay' && !this.ui.telemetryModal.open && !this.ui.modal.open)
          this.input.pollActions(['pause', 'camera', 'replay', 'mute', 'debug']);
        else if (
          this.state === 'paused' &&
          !this.ui.telemetryModal.open &&
          document.querySelector('#modal [data-action="resume"]')
        )
          this.input.pollActions(['pause']);
        else this.input.pollActions('off');
        return;
      }
      const input = this.input.update(dt);
      // A device fault may have paused the session during update().
      if (this.state !== 'driving') return;
      input.ers = this.ers;
      this.post({ type: 'input', input: { ...input } });
      input.shift = 0;
    });
    this.inputPump.start();
    element
      .querySelectorAll<HTMLElement>('[data-touch]')
      .forEach((e) =>
        this.input.bindTouch(e, e.dataset.touch as 'left' | 'right' | 'throttle' | 'brake'),
      );
    window.addEventListener('resize', () => {
      this.performanceCapture.interrupt('Viewport changed');
      this.renderer?.resize();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.suspendPlayback();
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
    try {
      const saved = await this.store.read('team:v1');
      if (saved) this.team = validateTeam(saved);
    } catch (e) {
      this.ui.toast(
        `Team save unavailable: ${e instanceof Error ? e.message : String(e)}. Starting a temporary team.`,
      );
    }
    if (this.disposed) return;
    this.ui.playerName = driverProfile(this.team).name;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.settings.shake = 0;
    this.input.settings = this.settings;
    this.ui.applyBindings(this.settings.bindings);
    this.ui.loading('Building original bodywork, materials and Aurel circuit…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    this.renderer = await RacingRenderer.create(
      canvas,
      this.track,
      (progress) => this.ui.loading(`${Math.floor(progress.fraction * 100)}% · ${progress.label}…`),
      () => this.disposed || this.errorStopped,
    );
    if (!this.renderer || this.disposed || this.errorStopped) return;
    this.renderer.setQuality(this.settings.quality, this.settings.graphics);
    this.renderer.shake = this.settings.shake;
    this.renderer.colorblind = this.settings.colorblind;
    this.renderer.setLivery(this.team.livery);
    this.audio.volume = this.settings.volume;
    this.audio.configureDriving(this.track, this.settings.drivingAudio);
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.uiScale));
    document.documentElement.dataset.colorblind = String(this.settings.colorblind);
    document.documentElement.dataset.highContrast = String(this.settings.highContrast);
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
  private post(message: ClientMessage, transfer: Transferable[] = []) {
    this.worker?.postMessage(message, transfer);
  }
  private async start(options: SessionOptions, programme = false) {
    if (this.state === 'loading' && this.worker) return;
    if (programme) this.programme.start();
    else this.programme.stop();
    this.renderer?.setPhoto(null);
    this.photoStudio.close();
    this.frozenPhoto = null;
    this.captureRequested = false;
    this.sessionId = crypto.randomUUID();
    this.usedDemonstration = false;
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.performanceCapture.interrupt('Session restarted');
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
    if (this.disposed) return;
    this.options = { ...options, setup: { ...this.settings.setup } };
    this.ui.options = this.options;
    this.auto = false;
    this.ers = 1;
    this.exporter.cancel();
    if (this.replay) void this.replay.dispose();
    this.replay = null;
    this.liveSurface = null;
    this.recordingWarnings = [];
    this.telemetry = null;
    this.replayA = null;
    this.replayB = null;
    this.comparison = false;
    this.current = null;
    this.previous = null;
    this.renderer?.reset();
    this.worker?.terminate();
    if (this.renderer) this.renderer.engineering = null;
    const generation = ++this.generation;
    this.worker = new PhysicsWorker({ name: 'apex-physics' });
    this.worker.onerror = (e) => this.fail(new Error(`Physics worker: ${e.message}`));
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.type === 'engineering') {
        if (!isEngineeringSample(message.sample)) {
          this.fail(new Error('Invalid engineering response'));
          return;
        }
        if (this.renderer) this.renderer.engineering = message.sample;
        return;
      }
      if (message.type === 'error') {
        this.fail(new Error(message.message));
        return;
      }
      if (message.type === 'telemetry') {
        this.telemetry?.appendBatch(new Float32Array(message.buffer), message.rows);
        this.post({ type: 'recycleTelemetry', buffer: message.buffer }, [message.buffer]);
        return;
      }
      if (message.type === 'recordingWarning') {
        this.recordingWarnings.push(message.message);
        this.ui.toast(message.message);
        return;
      }
      if (message.type === 'replayFrames') {
        const data = new Float32Array(message.buffer);
        if (this.replay) {
          const stride = this.replay.stride;
          if (
            !Number.isInteger(message.rows) ||
            message.rows < 0 ||
            message.rows * stride > data.length
          ) {
            this.fail(new Error('Invalid replay batch'));
          } else
            for (let i = 0; i < message.rows; i++)
              this.replay.append(data.subarray(i * stride, (i + 1) * stride));
        }
        this.post({ type: 'recycleReplay', buffer: message.buffer }, [message.buffer]);
        return;
      }
      if (message.type === 'surface') {
        this.liveSurface = {
          water: message.water,
          rubber: message.rubber,
          marbles: message.marbles,
          time: message.time,
        };
        this.replay?.recordSurface(message.water, message.rubber, message.time, message.marbles);
        if (this.state !== 'replay')
          this.renderer?.circuit.updateSurface(message.water, message.rubber, message.marbles);
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
    }, 45000);
    this.post({ type: 'init', options: this.options });
    this.post({ type: 'engineering', enabled: this.renderer?.debug ?? false });
    await ready;
    clearTimeout(this.initTimeout);
    if (this.errorStopped || this.disposed || generation !== this.generation) return;
    if (!this.renderer || !this.current)
      throw new Error('Session initialization has no render state');
    const warmed = await this.renderer.prepare(
      this.current,
      (message) => this.ui.loading(message),
      () => this.errorStopped || this.disposed || generation !== this.generation,
    );
    if (!warmed || this.errorStopped || this.disposed || generation !== this.generation) return;
    const cars = this.options.opponents + 1;
    this.replay = new SessionReplay(cars, undefined, (message) => {
      if (generation !== this.generation) return;
      this.recordingWarnings.push(message);
      this.ui.toast(message);
    });
    // The initial surface is retained even before the first full recording batch.
    const initialTrack = new Track(this.options.weather);
    this.liveSurface = {
      water: initialTrack.water,
      rubber: initialTrack.rubber,
      marbles: initialTrack.marbles,
      time: 0,
    };
    this.replay.recordSurface(initialTrack.water, initialTrack.rubber, 0, initialTrack.marbles);
    this.telemetry = new TelemetryRecorder();
    this.replayA = this.replay.makeFrame();
    this.replayB = this.replay.makeFrame();
    this.renderer.setLivery(this.team.livery);
    this.state = 'driving';
    this.ui.get('loading').hidden = true;
    this.ui.showMode('driving');
    this.input.setEnabled(true);
    (document.activeElement as HTMLElement)?.blur();
    this.post({ type: 'pause', value: false });
    this.inputPump.poll();
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
      this.programme.observe(next);
      if (next[H.PHASE] === 3) this.finish(next);
    }
    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
    }
  }
  private frame = (time: number) => {
    this.timer = requestAnimationFrame(this.frame);
    if (
      this.errorStopped ||
      this.state === 'loading' ||
      !this.renderer ||
      !this.current ||
      !this.previous
    )
      return;
    const wallDelta = Math.max(0.001, (time - (this.previousTime || time - 16)) / 1000),
      dt = clamp(wallDelta, 0.001, 0.08);
    this.previousTime = time;
    // Menus and paused telemetry do not need a continuously saturated GPU.
    // Input and worker clocks above remain independent of this presentation cap.
    const idle =
      this.state === 'menu' ||
      this.state === 'paused' ||
      this.state === 'results' ||
      this.state === 'photo' ||
      this.ui.telemetryModal.open;
    if (idle && this.renderedState === this.state && time - this.renderedAt < 1000 / 15) return;
    this.renderedAt = time;
    this.renderedState = this.state;
    let a = this.previous,
      b = this.current,
      alpha = clamp((time - this.receivedAt) / Math.max(8, (b[H.TIME] - a[H.TIME]) * 1000), 0, 1);
    if (this.state === 'replay' && this.replay && this.replayA && this.replayB) {
      const targetTime =
        this.replayPlaying &&
        !this.replaySeekPending &&
        !this.ui.telemetryModal.open &&
        !this.ui.modal.open &&
        !document.hidden
          ? Math.min(
              this.replay.duration,
              this.replayTime + Math.min(wallDelta, 0.5) * this.replayRate,
            )
          : this.replayTime;
      const fraction = this.replay.sample(targetTime, this.replayA, this.replayB);
      if (fraction === null) {
        this.ui.setText('replayTime', this.replay.error ?? 'BUFFERING RECORDED LAP…');
        this.audio.stop();
        return;
      }
      this.replayTime = targetTime;
      this.replaySeekPending = false;
      if (this.replayTime >= this.replay.duration) this.replayPlaying = false;
      alpha = fraction;
      const surface = this.replay.surfaceState;
      if (surface.water.length && surface.time !== this.appliedReplaySurfaceTime) {
        this.renderer.circuit.updateSurface(surface.water, surface.rubber, surface.marbles);
        this.appliedReplaySurfaceTime = surface.time;
      }
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
    if (this.state === 'photo' && this.frozenPhoto) {
      a = this.frozenPhoto;
      b = this.frozenPhoto;
      alpha = 0;
    }
    this.renderer.draw(
      a,
      b,
      alpha,
      dt,
      this.state === 'menu',
      this.state === 'replay' || (this.state === 'photo' && this.photoReturn === 'replay'),
      wallDelta,
    );
    // Read pixels in the same task as rendering; no permanent preserveDrawingBuffer cost.
    if (this.state === 'photo' && this.captureRequested) {
      this.captureRequested = false;
      this.capturingPhoto = true;
      void this.renderer
        .capturePhoto()
        .then((blob) => {
          downloadBlob(blob, `apex-photo-${Date.now()}.png`);
          this.photoStudio.status('PNG exported from the rendered scene.');
        })
        .catch((error) => this.photoStudio.status(`Export failed: ${String(error)}`))
        .finally(() => {
          this.capturingPhoto = false;
          this.photoStudio.captureBusy(false);
        });
    }
    if (this.state !== 'menu' && this.state !== 'photo')
      this.ui.update(
        this.state === 'replay' ? this.renderer.presented.value : b,
        this.renderer,
        this.auto,
        this.ers,
      );
    const programmeText = programmeHud(this.programme.progress(), this.state === 'replay');
    this.ui.get('programmeHud').hidden = !programmeText;
    this.ui.setText('programmeHud', programmeText);
    const guide = this.renderer.guide;
    this.ui.get('guideReadout').hidden = guide.mesh.count === 0 || this.state === 'photo';
    this.ui.setText(
      'guideReadout',
      `ADVISORY · ${guide.cue.toUpperCase()} · ${Math.round(guide.targetSpeed * 3.6)} KM/H`,
    );
    this.audio.update(
      this.renderer.presented.value,
      this.renderer.mode === 'cockpit',
      !this.ui.telemetryModal.open &&
        !this.ui.modal.open &&
        !document.hidden &&
        (this.state === 'driving' || (this.state === 'replay' && this.replayPlaying)),
      this.renderer.audioView.value,
      this.state === 'driving' && !this.auto,
    );
    if (this.ui.telemetryModal.open && this.telemetry) {
      this.graphClock += dt;
      if (this.graphClock > 0.2) {
        this.telemetry.draw(
          this.ui.graph,
          this.comparison,
          this.ui.telemetryView,
          this.track.length,
        );
        this.graphClock = 0;
      }
    }
    if (this.performanceCapture.active) {
      if (this.state !== 'driving' || document.hidden) {
        this.performanceCapture.interrupt('Capture left visible live driving');
      } else {
        this.renderer.readPerformanceMetrics(this.profileMetrics);
        this.profileMetrics.physicsMs = b[H.STEP_MS];
        this.performanceCapture.record(performance.now(), this.profileMetrics);
        if (this.performanceCapture.state === 'complete')
          this.ui.toast('Performance capture complete. Pause → Performance capture → Export JSON.');
      }
    }
  };
  private suspendPlayback() {
    if (this.state === 'driving') this.pause();
    else if (this.state === 'replay') {
      this.replayPlaying = false;
      this.audio.stop();
      this.ui.setText('replayPlay', 'PLAY');
    }
  }
  private seekReplay(value: number) {
    if (this.state !== 'replay' || !this.replay || !Number.isFinite(value)) return;
    this.replayTime = clamp(value, 0, this.replay.duration);
    // Draw the requested position once before advancing, including after an
    // asynchronous page read. A seek is not a catch-up interval for effects.
    this.replaySeekPending = true;
    this.renderer?.reset();
    this.audio.stop();
  }
  private async saveTeam(next: TeamState) {
    if (this.teamBusy) throw new Error('A team transaction is already saving.');
    this.teamBusy = true;
    try {
      await this.store.write('team:v1', next);
      this.team = next;
      this.renderer?.setLivery(next.livery);
      this.ui.playerName = driverProfile(next).name;
    } finally {
      this.teamBusy = false;
    }
  }
  private openTeam(page: HubPage = this.teamPage) {
    if (this.state === 'loading' || this.state === 'photo') return;
    this.suspendPlayback();
    this.teamPage = page;
    this.ui.modalContent(teamHub(this.team, page));
  }
  private async teamAction(name: string) {
    const [, command, id, delta] = name.split(':');
    if (command === 'page') {
      if (['overview', 'engineering', 'personnel', 'finance'].includes(id))
        this.openTeam(id as HubPage);
      return;
    }
    if (this.teamBusy || !document.querySelector('.team-hub')) return;
    const root = document.querySelector<HTMLElement>('.team-hub')!;
    root.setAttribute('aria-busy', 'true');
    root
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => (button.disabled = true));
    const status = root.querySelector('#teamSaveStatus');
    if (status) status.textContent = 'SAVING TRANSACTION…';
    try {
      if (command === 'apply') {
        const setup = researchSetup(this.team, id as ResearchId, this.settings.setup);
        const settings = validateSettings({ ...this.settings, setup });
        await this.store.write('settings', settings);
        this.settings = settings;
        this.input.settings = settings;
        this.ui.toast('Study setup saved for the next session. Inspect it in Garage & Settings.');
      } else {
        let action: TeamAction;
        if (command === 'week') action = { type: 'week' };
        else if (command === 'staff')
          action = { type: 'staff', department: id as Department, delta: Number(delta) };
        else if (command === 'facility')
          action = { type: 'facility', department: id as Department };
        else if (command === 'driver') action = { type: 'driver', id: id as DriverId };
        else if (command === 'research') action = { type: 'research', id: id as ResearchId };
        else throw new Error('Unknown team action');
        await this.saveTeam(changeTeam(this.team, action));
      }
      if (root.isConnected) this.openTeam(this.teamPage);
    } catch (error) {
      if (root.isConnected) this.openTeam(this.teamPage);
      this.ui.toast(`Team unchanged: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private openPhoto() {
    if (!this.renderer || !this.current || this.state === 'loading' || this.state === 'photo')
      return;
    this.photoReturnHub = !!document.querySelector('.team-hub');
    if (this.state === 'driving') this.pause();
    this.suspendPlayback();
    this.photoReturn = this.state;
    this.performanceCapture.interrupt('Photo studio opened');
    // Own a copy: queued worker snapshots and replay-page recycling cannot alter the held moment.
    const displayed = this.renderer.presented.value;
    this.frozenPhoto = new Float32Array(displayed[H.CARS] > 0 ? displayed : this.current);
    this.state = 'photo';
    this.ui.closeModal();
    this.ui.telemetryModal.close();
    this.input.setEnabled(false);
    this.audio.stop();
    this.post({ type: 'pause', value: true });
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMode('photo');
    this.photoStudio.open(this.team.livery, this.frozenPhoto[H.CARS]);
  }
  private closePhoto() {
    if (this.state !== 'photo') return;
    this.captureRequested = false;
    this.photoStudio.close();
    this.renderer?.setPhoto(null);
    this.renderer?.setLivery(this.team.livery);
    this.frozenPhoto = null;
    this.state = this.photoReturn;
    this.ui.showMode(this.state);
    if (this.state === 'paused') this.ui.pause();
    else if (this.state === 'results' && this.current) this.ui.results(this.current);
    else if (this.state === 'replay') {
      this.replayPlaying = false;
      this.input.setEnabled(true);
      this.ui.setText('replayPlay', 'PLAY');
    }
    if (this.photoReturnHub) this.openTeam();
  }
  private pause() {
    if (this.state !== 'driving') return;
    this.performanceCapture.interrupt('Session paused or focus lost');
    this.state = 'paused';
    this.post({ type: 'pause', value: true });
    this.input.setEnabled(false);
    this.audio.stop();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMode('paused');
    this.ui.pause();
  }
  private resume() {
    if (this.state !== 'paused' || this.ui.telemetryModal.open) return;
    this.ui.closeModal();
    this.state = 'driving';
    this.ui.showMode('driving');
    this.input.setEnabled(true);
    this.post({ type: 'input', input: controls() });
    this.post({ type: 'pause', value: false });
    (document.activeElement as HTMLElement)?.blur();
  }
  private finish(frame: Float32Array) {
    this.performanceCapture.interrupt('Session finished');
    this.state = 'results';
    this.post({ type: 'pause', value: true });
    this.input.setEnabled(false);
    this.audio.stop();
    this.ui.showMode('results');
    this.ui.results(frame);
    if (this.options.mode === 'race') {
      const next = rewardRace(this.team, {
        session: this.sessionId,
        position: Math.round(frame[carBase(0) + F.RANK]),
        cars: Math.round(frame[H.CARS]),
        classified: frame[carBase(0) + F.FINISH] > 0,
        demonstration: this.usedDemonstration,
        penalties: frame[carBase(0) + F.PENALTY],
      });
      if (next !== this.team)
        void this.saveTeam(next)
          .then(() => this.ui.toast('Classified result added to your Team HQ.'))
          .catch((error) => this.ui.toast(`Race income not saved: ${String(error)}`));
    }
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
    this.appliedReplaySurfaceTime = -Infinity;
    this.replayPlaying = true;
    this.seekReplay(0);
    this.ui.showMode('replay');
    this.input.setEnabled(true);
  }
  private exitReplay() {
    if (this.state !== 'replay') return;
    this.replayPlaying = false;
    this.audio.stop();
    this.state = this.replayReturn === 'results' ? 'results' : 'paused';
    if (this.liveSurface)
      this.renderer?.circuit.updateSurface(
        this.liveSurface.water,
        this.liveSurface.rubber,
        this.liveSurface.marbles,
      );
    this.input.setEnabled(false);
    this.renderer?.reset();
    this.ui.showMode(this.state);
    if (this.state === 'results' && this.current) this.ui.results(this.current);
    else this.ui.pause();
  }
  private openAcademy() {
    this.suspendPlayback();
    this.ui.closeModal();
    this.ui.modalContent(
      drivingAcademy(
        this.programme.progress(),
        this.renderer?.guide.mode ?? 'off',
        this.renderer?.night ?? false,
      ),
    );
  }
  private inspectReference(id: number) {
    const entry = REFERENCES.find((item) => item.id === id);
    if (!entry) return;
    const route = referenceRoute(entry);
    if (!route) return;
    this.inspectedReference = id;
    if (route.night !== undefined && this.renderer) this.renderer.night = route.night;
    if (route.destination === 'photo') {
      this.openPhoto();
      if (this.state === 'photo') {
        this.photoStudio.compose(route.photo ?? {});
        this.photoStudio.status(
          `REFERENCE ${String(id).padStart(3, '0')} · ${entry.title}. ${route.instruction}`,
        );
      }
    } else if (route.destination === 'academy') this.openAcademy();
    else if (route.destination === 'team') this.openTeam(route.hub);
    else {
      this.suspendPlayback();
      if (route.destination === 'settings') this.ui.settings(this.settings);
      else this.ui.controls(this.settings.bindings);
    }
    this.ui.toast(`Reference ${String(id).padStart(3, '0')}: ${route.instruction}`);
  }
  private action(name: string) {
    this.renderedState = null;
    if (this.state === 'photo') {
      if (name === 'pause') this.closePhoto();
      else if (name === 'deviceLost') this.ui.toast(this.input.deviceStatus);
      return;
    }
    if (name.startsWith('reference:')) {
      this.inspectReference(Number(name.slice(10)));
      return;
    }
    if (name.startsWith('guide:')) {
      const mode = name.slice(6);
      if (this.renderer && ['off', 'corners', 'full'].includes(mode)) {
        this.performanceCapture.interrupt('Driving guide changed');
        this.renderer.guide.mode = mode as GuideMode;
        this.openAcademy();
      }
      return;
    }
    if (name === 'lighting:day' || name === 'lighting:night') {
      if (this.renderer) {
        this.performanceCapture.interrupt('Circuit lighting changed');
        this.renderer.night = name === 'lighting:night';
        this.renderer.reset();
        this.openAcademy();
      }
      return;
    }
    if (name.startsWith('team:')) {
      void this.teamAction(name);
      return;
    }
    // Native modal cancellation owns Escape. Background replay/drive actions
    // cannot also handle that same key and resume or dismiss the parent state.
    if (
      this.ui.telemetryModal.open &&
      ['pause', 'resume', 'replay', 'replayExit', 'replayPlay', 'camera'].includes(name)
    )
      return;
    switch (name) {
      case 'academy':
        this.openAcademy();
        break;
      case 'academy:start':
        this.suspendPlayback();
        this.ui.modalContent(academyConfirmation());
        break;
      case 'academy:confirm':
        if (this.renderer) this.renderer.guide.mode = 'full';
        void this.start(
          {
            ...this.options,
            mode: 'practice',
            opponents: 0,
            weather: 'clear',
            compound: 'medium',
            laps: 5,
          },
          true,
        ).catch((error) => this.fail(error));
        break;
      case 'academy:stop':
        this.programme.stop();
        this.openAcademy();
        break;
      case 'team':
        this.openTeam();
        break;
      case 'references':
        this.suspendPlayback();
        this.ui.closeModal();
        this.ui.modalContent(referenceReview());
        bindReferenceReview(this.ui.get('modalContent'));
        break;
      case 'workshop':
        this.openPhoto();
        if (!this.photoStudio.element.hidden)
          this.photoStudio.compose({
            backdrop: 'headquarters',
            azimuth: 28,
            elevation: 17,
            distance: 17,
            focalLength: 30,
          });
        break;
      case 'photo':
        this.openPhoto();
        break;
      case 'pause':
        if (this.state === 'driving') this.pause();
        else if (this.state === 'paused') this.resume();
        else if (this.state === 'replay') this.exitReplay();
        break;
      case 'deviceLost':
        this.suspendPlayback();
        this.ui.toast(this.input.deviceStatus);
        break;
      case 'blur':
        this.suspendPlayback();
        break;
      case 'resume':
        this.resume();
        break;
      case 'menu':
        this.performanceCapture.interrupt('Returned to paddock');
        this.ui.closeModal();
        this.ui.telemetryModal.close();
        this.state = 'menu';
        this.programme.stop();
        this.post({ type: 'pause', value: true });
        this.input.setEnabled(false);
        this.audio.stop();
        this.ui.showMode('menu');
        this.renderer?.reset();
        this.renderer?.setLivery(this.team.livery);
        break;
      case 'restart':
        void this.start(this.options).catch((e) => this.fail(e));
        break;
      case 'settings':
        if (this.state === 'driving') this.pause();
        this.ui.settings(this.settings);
        break;
      case 'controls':
        this.ui.controls(this.settings.bindings);
        break;
      case 'modalClose':
        this.ui.closeModal();
        if (this.state === 'paused') this.ui.pause();
        else if (this.state === 'results' && this.current) this.ui.results(this.current);
        break;
      case 'camera':
        this.performanceCapture.interrupt('Camera changed');
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
        this.performanceCapture.interrupt('Deployment mode changed');
        this.ers = ((this.ers + 1) % 3) as 0 | 1 | 2;
        break;
      case 'mute':
        this.performanceCapture.interrupt('Audio workload changed');
        this.audio.muted = !this.audio.muted;
        this.ui.toast(this.audio.muted ? 'Audio muted.' : 'Audio enabled.');
        break;
      case 'debug':
        this.performanceCapture.interrupt('Debug workload changed');
        if (this.renderer) {
          this.renderer.debug = !this.renderer.debug;
          this.renderer.engineering = null;
          this.post({ type: 'engineering', enabled: this.renderer.debug });
        }
        break;
      case 'autopilot':
        this.performanceCapture.interrupt('Driver changed');
        if (this.state === 'driving') {
          this.auto = !this.auto;
          this.usedDemonstration ||= this.auto;
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
        if (this.state !== 'replay') break;
        if (this.replay && this.replayTime >= this.replay.duration) this.seekReplay(0);
        this.replayPlaying = !this.replayPlaying;
        if (!this.replayPlaying) this.audio.stop();
        break;
      case 'telemetry':
        if (this.ui.telemetryModal.open) break;
        if (!this.telemetry) {
          this.ui.toast('Start a session to record telemetry.');
          return;
        }
        this.suspendPlayback();
        this.telemetryReturn = this.state;
        this.ui.closeModal();
        this.input.setEnabled(false);
        this.audio.stop();
        this.ui.telemetryModal.showModal();
        this.telemetry.draw(
          this.ui.graph,
          this.comparison,
          this.ui.telemetryView,
          this.track.length,
        );
        break;
      case 'telemetryClose':
        if (!this.ui.telemetryModal.open) break;
        this.ui.telemetryModal.close();
        if (this.telemetryReturn === 'results' && this.current) this.ui.results(this.current);
        else if (this.telemetryReturn === 'replay') {
          this.input.setEnabled(true);
          (document.activeElement as HTMLElement)?.blur();
        } else this.ui.pause();
        break;
      case 'compare':
        this.comparison = !this.comparison;
        this.telemetry?.draw(
          this.ui.graph,
          this.comparison,
          this.ui.telemetryView,
          this.track.length,
        );
        break;
      case 'csv':
        void this.exportTelemetry();
        break;
      case 'performance':
        if (this.state === 'driving') this.pause();
        if (this.state !== 'paused') break;
        this.ui.performance(
          `${this.performanceCapture.state.toUpperCase()} · ${this.performanceCapture.count} measured frames${this.performanceCapture.reason ? ` · ${this.performanceCapture.reason}` : ''}`,
          this.profileMachine,
          this.profileWorkload,
          !!this.performanceCapture.report(),
        );
        break;
      case 'profileStart':
        this.startPerformanceCapture();
        break;
      case 'profileExport': {
        const report = this.performanceCapture.report();
        if (report)
          downloadBlob(
            new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }),
            'apex-performance.json',
          );
        break;
      }
      case 'reload':
        location.reload();
        break;
    }
  }
  private startPerformanceCapture() {
    if (this.state !== 'paused' || !this.renderer) return;
    const machine =
      (document.getElementById('profileMachine') as HTMLInputElement | null)?.value.trim() ?? '';
    const workload =
      (document.getElementById('profileWorkload') as HTMLInputElement | null)?.value.trim() ?? '';
    const stats = this.renderer.stats();
    try {
      this.performanceCapture.start(
        {
          machine,
          workload,
          source: __APEX_SOURCE_FINGERPRINT__,
          browser: navigator.userAgent,
          configuration: JSON.stringify({
            session: this.options,
            camera: stats.camera,
            auto: this.auto,
            ers: this.ers,
            graphics: stats.graphics,
            width: stats.renderWidth,
            height: stats.renderHeight,
            pixelRatio: devicePixelRatio,
            debug: this.renderer.debug,
            sound: { volume: this.settings.volume, muted: this.audio.muted },
            shake: this.settings.shake,
            uiScale: this.settings.uiScale,
            gpuTiming: stats.gpuTimerSupported,
          }),
        },
        performance.now(),
      );
      this.profileMachine = machine;
      this.profileWorkload = workload;
      this.resume();
      this.ui.toast('Performance warm-up: 5 seconds, followed by 30 seconds of measured driving.');
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : String(error));
    }
  }
  private async exportTelemetry() {
    if (!this.telemetry || this.exporting) return;
    const generation = this.generation;
    this.exporting = true;
    const button = document.querySelector<HTMLButtonElement>('[data-action="csv"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'EXPORTING…';
    }
    try {
      const blob = await this.exporter.export(this.telemetry.snapshot(), this.telemetry.count);
      if (generation === this.generation) downloadBlob(blob, 'apex-telemetry.csv');
    } catch (error) {
      if (generation === this.generation) this.ui.toast(`Export failed: ${String(error)}`);
    } finally {
      this.exporting = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'EXPORT CSV';
      }
    }
  }
  private applySettings(settings: Settings) {
    if (this.savingSettings) return;
    const form = document.querySelector<HTMLFormElement>('#settingsForm');
    const submit = form?.querySelector<HTMLButtonElement>('[type="submit"]');
    this.savingSettings = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'SAVING…';
    }
    this.performanceCapture.interrupt('Settings changed');
    this.settings = settings;
    this.input.settings = settings;
    this.ui.applyBindings(settings.bindings);
    this.renderer?.setQuality(settings.quality, settings.graphics);
    if (this.renderer) {
      this.renderer.shake = settings.shake;
      this.renderer.colorblind = settings.colorblind;
    }
    this.audio.volume = settings.volume;
    this.audio.configureDriving(this.track, settings.drivingAudio);
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
    document.documentElement.dataset.colorblind = String(settings.colorblind);
    document.documentElement.dataset.highContrast = String(settings.highContrast);
    // Closing the editor is the completion signal. Do not emit it before the
    // readwrite transaction commits: an immediate reload can abort the save.
    const closeCurrentEditor = () => {
      if (form?.isConnected && document.querySelector('#settingsForm') === form)
        this.action('modalClose');
    };
    void this.store
      .write('settings', settings)
      .then(() => {
        closeCurrentEditor();
        this.ui.toast('Preferences saved. Vehicle setup applies to the next session.');
      })
      .catch((e) => {
        closeCurrentEditor();
        this.ui.toast(`Applied for this session, but saving failed: ${String(e)}`);
      })
      .finally(() => {
        this.savingSettings = false;
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'APPLY & SAVE';
        }
      });
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
    this.performanceCapture.interrupt('Application error');
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
      team: structuredClone(this.team),
      photoTime: this.frozenPhoto?.[H.TIME] ?? null,
      teamBusy: this.teamBusy,
      usedDemonstration: this.usedDemonstration,
      practiceProgramme: this.programme.progress(),
      inspectedReference: this.inspectedReference,
      audio: this.audio.diagnostics(),
      engineering: this.renderer?.engineering ?? null,
      presentation: this.renderer
        ? {
            time: this.renderer.presented.value[H.TIME] ?? 0,
            engineeringVisible: this.renderer.engineeringView.group.visible,
            elapsed: this.renderer.effectPlayback.elapsed,
            resets: this.renderer.effectPlayback.resets,
            listener: { ...this.renderer.audioView.value },
            particles: this.renderer.effects.diagnostics(),
          }
        : null,
      performanceCapture: {
        state: this.performanceCapture.state,
        frames: this.performanceCapture.count,
        elapsedMs: this.performanceCapture.elapsedMs,
        reason: this.performanceCapture.reason,
      },
      auto: this.auto,
      options: this.options,
      frame: this.current ? Array.from(this.current) : null,
      renderer: this.renderer?.stats(),
      visual: visual ? this.renderer?.visualDiagnostics() : null,
      replaySeconds: this.replay?.duration ?? 0,
      replayStart: this.replay?.start ?? 0,
      replaySamples: this.replay?.count ?? 0,
      replayResidentBytes: this.replay?.bytes ?? 0,
      replayError: this.replay?.error ?? null,
      replayPosition: this.replayTime,
      replayPlaying: this.replayPlaying,
      replaySeekPending: this.replaySeekPending,
      replaySurfaceTime: this.replay?.surfaceState.time ?? -1,
      telemetryOpen: this.ui.telemetryModal.open,
      recordingWarnings: [...this.recordingWarnings],
      telemetrySamples: this.telemetry?.count ?? 0,
      inputPolls: this.inputPump.ticks,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.performanceCapture.interrupt('Application disposed');
    this.disposed = true;
    this.generation++;
    this.exporter.cancel();
    if (this.replay) void this.replay.dispose();
    this.inputPump.dispose();
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
