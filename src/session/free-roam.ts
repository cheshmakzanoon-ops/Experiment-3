import {
  completeHeldPresentation,
  withDrainedFestivalPresentation,
  type HeldPresentationReceipt,
} from './festival-startup-presentation.ts';
import { abortableStartup } from '../core/abortable-startup.ts';
import { motionReceipt } from '../core/motion-receipt.ts';
import type * as T from 'three';
import { scannedGround } from '../rendering/ground/scan-store.ts';
import type { Assist, Controls, WeatherPreset } from '../simulation/config.ts';
import {
  resolveEvents,
  type FestivalEvent,
  type FestivalResult,
} from '../simulation/open-world/festival-events.ts';
import { regionStructures } from '../simulation/open-world/placement.ts';
import {
  festivalDefaultVehicle,
  festivalVehicles,
  type FestivalCommand,
  type FestivalStatus,
} from '../simulation/open-world/session.ts';
import { openWorld } from '../simulation/open-world/world.ts';
import { F, H, R, RACE_BASE, carBase } from '../simulation/protocol.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import type { LightingMode } from '../rendering/daylight.ts';
import { FestivalRenderer } from '../rendering/open-world/festival-renderer.ts';
import { FestivalRiders } from '../rendering/festival-riders.ts';
import { LiveFrameClock } from '../rendering/live-frame-clock.ts';
import { TrafficCars } from '../rendering/traffic-cars.ts';
import type { GraphicsOptions, QualityPreset } from '../rendering/options.ts';
import type { AudioView } from '../audio/spatial.ts';
import { FestivalHud } from '../ui/festival-hud.ts';
import { minimapHeading } from '../ui/festival-map.ts';
import { FestivalControls, festivalMenuState } from './festival-controls.ts';
import {
  FESTIVAL_SAVE_KEY,
  festivalMachineChoice,
  validateFestivalSave,
  type FestivalSave,
} from './festival-save.ts';
import type { FromOpenWorld, ToOpenWorld } from '../workers/open-world-protocol.ts';
import OpenWorldWorker from '../workers/open-world.worker.ts?worker&inline';
import TileWorker from '../workers/open-world-tiles.worker.ts?worker&inline';

/** What the application lends the festival while it runs. */
export interface FestivalHost {
  canvas: HTMLCanvasElement;
  /** The application's WebGL renderer (one context per canvas). */
  renderer: T.WebGLRenderer;
  /** Shared with the host's circuit renderer, including the return transition. */
  presentation: { ready(): boolean; submitted(): void; revision?(): number; current?(): boolean };
  /** Container for the festival HUD. */
  element: HTMLElement;
  quality: QualityPreset;
  graphics: GraphicsOptions;
  lighting: LightingMode;
  loading(text: string): void;
  loaded(): void;
  toast(message: string): void;
  /** Leave the festival (the host restores its own presentation). */
  exit(): void;
  /** Driving input on or off: off while a festival menu is open, so the
   * keyboard reaches its buttons (the host's InputController). */
  driving?(on: boolean): void;
  /** Driving audio from the festival's frames (engine voices, contacts, wind). */
  audio?: {
    start(): Promise<void>;
    stop(): void;
    update(
      frame: Float32Array,
      cockpit: boolean,
      playing: boolean,
      view: AudioView,
      liveHuman: boolean,
    ): void;
  };
  /** Career/progression hook: every finished or abandoned event result. */
  onResult?(result: FestivalResult): void;
  /** Persisted festival state (discovered events, best results). */
  load?(): Promise<unknown>;
  save?(state: FestivalSave): Promise<void>;
}
export interface FestivalStartOptions {
  signal?: AbortSignal;
  vehicle?: string;
  weather?: WeatherPreset;
  assist?: Assist;
  seed?: number;
  /** Session identity for result run ids (the career pays each run once). */
  session?: string;
  /** Fast-travel to this event once the region has streamed in
   * (a career start). */
  travel?: string;
  /** The machine is the career's loan: driven this session, but not saved
   * as the festival's machine (it was not the player's choice). */
  loaner?: boolean;
}
export { FESTIVAL_SAVE_KEY, validateFestivalSave, type FestivalSave };

/**
 * The festival session controller: owns the open-world simulation worker,
 * the terrain tile worker, the festival renderer (on the application's GL
 * context) and the HUD; turns application input and actions into festival
 * commands; streams snapshots into the renderer; forwards typed results to
 * the career hook and persists discoveries and best results.
 */
export class FestivalSession {
  private worker: Worker;
  private tiles: Worker;
  private renderer: FestivalRenderer | null = null;
  private hud: FestivalHud | null = null;
  private current: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private readonly liveFrames = new LiveFrameClock();
  private lastTime = 0;
  private presentationFrames = 0;
  private status: FestivalStatus | null = null;
  private traffic: TrafficCars | null = null;
  private riders: FestivalRiders | null = null;
  private controls: FestivalControls | null = null;
  /** Fast travel in progress: the simulation is held and frames are not
   * drawn while the destination streams in behind the loading screen. */
  private travelling = false;
  private preparing = true;
  private startupSignal?: AbortSignal;
  private startupDeadline = Infinity;
  private startupPresentation: HeldPresentationReceipt | null = null;
  private startupFailure: Error | null = null;
  private viewportRevision = -1;
  private localViewportRevision = 0;
  private events: readonly FestivalEvent[] = [];
  private disposed = false;
  private commandSerial = 0;
  private readonly commandRequests = new Map<
    number,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private save: FestivalSave;
  private readonly photoKeys = (event: KeyboardEvent) => {
    if (!this.renderer?.photo || event.code !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.setPhoto(false);
  };
  private constructor(
    private readonly host: FestivalHost,
    save: FestivalSave | null,
  ) {
    this.save = save ?? {
      version: 1,
      discovered: [],
      best: {},
      vehicle: festivalDefaultVehicle(),
      traffic: true,
    };
    this.worker = new OpenWorldWorker();
    this.tiles = new TileWorker();
    this.worker.onmessage = (event: MessageEvent<FromOpenWorld>) => this.receive(event.data);
    this.worker.onerror = (event) =>
      this.fail(new Error(event.message || 'Festival worker failed'));
    window.addEventListener('keydown', this.photoKeys, true);
  }
  static async start(host: FestivalHost, options: FestivalStartOptions = {}) {
    options.signal?.throwIfAborted();
    host.loading('Building the Solvane festival region…');
    let waitingFrame = 0;
    await abortableStartup(
      new Promise<void>((resolve) => {
        waitingFrame = requestAnimationFrame(() => resolve());
      }),
      options.signal,
      () => cancelAnimationFrame(waitingFrame),
    );
    const save = validateFestivalSave(
      await abortableStartup(
        host.load?.().catch(() => null) ?? Promise.resolve(null),
        options.signal,
        () => {},
      ),
    );
    options.signal?.throwIfAborted();
    const session = new FestivalSession(host, save);
    try {
      await abortableStartup(session.boot(options), options.signal, () => session.dispose());
      options.signal?.throwIfAborted();
    } catch (error) {
      session.dispose();
      throw error;
    }
    return session;
  }
  private async boot(options: FestivalStartOptions) {
    this.startupSignal = options.signal;
    this.startupDeadline = performance.now() + 300000;
    const active = () => {
      options.signal?.throwIfAborted();
      if (this.disposed || this.host.presentation.current?.() === false)
        throw new DOMException('Festival startup cancelled', 'AbortError');
      if (this.host.renderer.getContext().isContextLost())
        throw new Error('Festival graphics context lost during preparation');
    };
    active();
    const host = this.host;
    const world = openWorld();
    host.loading('Planning event routes and town streets…');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    active();
    const events = resolveEvents(world);
    this.events = events;
    const structures = regionStructures(world);
    host.loading('Building roads, buildings and water…');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    active();
    const renderer = await withDrainedFestivalPresentation(
      {
        active,
        ready: () => host.presentation.ready(),
        deadline: this.startupDeadline,
      },
      () => {
        const candidate = new FestivalRenderer(
          host.renderer,
          host.canvas,
          world,
          events,
          structures,
          this.tiles,
        );
        this.renderer = candidate;
        candidate.setQuality(host.quality, host.graphics);
        candidate.lighting = host.lighting;
        return candidate;
      },
    );
    active();
    host.loading('Loading photographed trees…');
    await renderer.loadPhotoVegetation();
    active();
    host.loading('Loading authored coastal details…');
    await Promise.all([renderer.loadAuthoredDetails(), renderer.loadStreetDetails()]);
    active();
    for (const id of this.save.discovered) renderer.discovered.add(id);
    // Ambient traffic (instanced) and motorcycles (the bike presentation)
    // share the festival scene; both are posed before each draw.
    this.traffic = new TrafficCars();
    this.riders = new FestivalRiders();
    renderer.scene.add(this.traffic.root, this.riders.root);
    renderer.registerVehicleRoot(this.riders.root);
    this.riders.shells.install = () => renderer.refreshVehicleMaterials();
    const vehicles = festivalVehicles();
    const machine = festivalMachineChoice(options, this.save.vehicle);
    const vehicle = machine.drive;
    this.save.vehicle = machine.save;
    this.hud = new FestivalHud(host.element, world, events, vehicles, {
      start: (id) => this.command({ type: 'start', event: id }),
      continue: () => this.command({ type: 'continue' }),
      retry: (id) => void this.travel(id, true),
      cancel: () => this.command({ type: 'cancel' }),
      reset: () => {
        this.command({ type: 'reset' });
        this.setPaused(false);
      },
      resume: () => this.setPaused(false),
      exit: () => this.host.exit(),
      lighting: (mode) => {
        renderer.lighting = mode;
        this.openMenu();
      },
      vehicle: (id) => {
        this.save.vehicle = id;
        this.command({ type: 'vehicle', id });
        void this.persist();
        this.setPaused(false);
      },
      travel: (id) => void this.travel(id),
      autopilot: (on) => {
        this.command({ type: 'autopilot', value: on });
        this.setPaused(false);
      },
      traffic: (on) => {
        this.save.traffic = on;
        this.command({ type: 'traffic', value: on });
        void this.persist();
        this.openMenu();
      },
      map: () => this.openMap(),
      photo: (open) => this.setPhoto(open),
      photoAngle: (angle) => renderer.photoAngle(angle),
    });
    const hud = this.hud;
    this.controls = new FestivalControls(hud, {
      pause: (value) => {
        if (!this.preparing || value) this.post({ type: 'pause', value });
      },
      driving: (on) => host.driving?.(on && !this.preparing),
      menuState: () => festivalMenuState(this.status, this.save, this.renderer?.lighting ?? 'day'),
      card: () => (hud.cardOpen ? (this.status?.card?.id ?? null) : null),
      start: (id) => this.command({ type: 'start', event: id }),
      continue: () => this.command({ type: 'continue' }),
    });
    this.controls.paused = true;
    host.driving?.(false);
    host.loading('Starting the festival simulation…');
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.post({
      type: 'init',
      options: {
        vehicle,
        weather: options.weather ?? 'clear',
        assist: options.assist ?? 'sport',
        seed: options.seed ?? 73021,
        discovered: this.save.discovered,
        session: options.session,
        traffic: this.save.traffic !== false,
      },
    });
    await ready;
    active();
    // Stream the terrain around the spawn before the first frame.
    host.loading('Streaming terrain around Port Ilse…');
    const frame = this.current!;
    const x = frame[carBase(0) + F.X],
      z = frame[carBase(0) + F.Z];
    const deadline = performance.now() + 20000;
    while (
      !renderer.ready(x, z) &&
      performance.now() < deadline &&
      !this.disposed &&
      !options.signal?.aborted
    ) {
      renderer.prestream(x, z);
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    for (let i = 0; i < 20 && !this.disposed; i++) {
      renderer.prestream(x, z);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    active();
    if (renderer.photoSky.enabled) {
      host.loading('Loading the photographed sky…');
      await renderer.photoSky.ready(frame[H.CLOUD], renderer.lighting);
      active();
    }
    if (scannedGround.enabled) {
      host.loading('Loading photographed ground…');
      await scannedGround.ready();
      active();
    }
    await host.audio?.start().catch(() => undefined);
    active();
    // Keep career travel under the initial hold; never reveal the spawn first.
    if (options.travel) await this.travel(options.travel);
    else await this.preparePresentation();
    active();
    this.preparing = false;
    this.setPaused(false);
    host.loaded();
  }
  private post(message: ToOpenWorld, transfer: Transferable[] = []) {
    if (this.disposed) return;
    if (message.type === 'pause') this.liveFrames.setPaused(message.value);
    this.worker.postMessage(message, transfer);
  }
  private fail(error: Error) {
    this.startupFailure = error;
    if (this.readyReject) {
      this.readyReject(error);
      this.readyReject = null;
      this.readyResolve = null;
    }
    this.host.toast(`Festival error: ${error.message}`);
  }
  private receive(msg: FromOpenWorld) {
    if (this.disposed) return;
    switch (msg.type) {
      case 'ready':
        break;
      case 'held-ready':
        if (!this.current || !this.status || this.current[H.TICK] !== msg.tick) {
          this.fail(new Error('Festival initial held snapshot/status mismatch'));
          break;
        }
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        break;
      case 'frame': {
        const frame = new Float32Array(msg.buffer);
        // Every superseded buffer goes back, whatever its size: the worker
        // keeps those of the current field size and drops the rest.
        if (this.previous && this.previous !== this.current && this.previous.buffer.byteLength > 0)
          this.post({ type: 'recycle', buffer: this.previous.buffer as ArrayBuffer }, [
            this.previous.buffer as ArrayBuffer,
          ]);
        this.previous = this.current ?? frame;
        this.current = frame;
        this.liveFrames.observe(
          frame,
          performance.now(),
          msg.traffic ? new Float32Array(msg.traffic) : null,
        );
        break;
      }
      case 'status':
        this.status = msg.status;
        if (this.renderer) {
          for (const id of msg.status.discovered) {
            if (!this.renderer.discovered.has(id)) {
              this.renderer.discovered.add(id);
              if (!this.save.discovered.includes(id)) {
                this.save.discovered.push(id);
                void this.persist();
              }
            }
          }
          this.renderer.activeEvent = msg.status.event?.id ?? null;
          this.renderer.gate = msg.status.event?.gate ?? null;
        }
        break;
      case 'result':
        this.recordResult(msg.result);
        break;
      case 'command-result': {
        const request = this.commandRequests.get(msg.requestId);
        if (!request) break;
        clearTimeout(request.timer);
        this.commandRequests.delete(msg.requestId);
        if (msg.error !== undefined) request.reject(new Error(msg.error));
        else request.resolve();
        break;
      }
      case 'error':
        this.fail(new Error(msg.message));
        break;
    }
  }
  private recordResult(result: FestivalResult) {
    this.hud?.recordActivity(result);
    this.host.onResult?.(result);
    if (!result.completed || result.assisted) return;
    const best = this.save.best[result.eventId],
      value = result.trapKmh ?? result.averageKmh ?? result.driftScore ?? null;
    const better =
      !best ||
      result.stars > best.stars ||
      (result.time !== null && (best.time === null || result.time < best.time)) ||
      (value !== null && (best.value === null || value > best.value));
    if (better) {
      this.save.best[result.eventId] = {
        stars: Math.max(result.stars, best?.stars ?? 0),
        time:
          result.time !== null && (best?.time == null || result.time < best.time)
            ? result.time
            : (best?.time ?? null),
        value:
          value !== null && (best?.value == null || value > best.value)
            ? value
            : (best?.value ?? null),
      };
      void this.persist();
    }
  }
  private async persist() {
    try {
      await this.host.save?.(this.save);
    } catch {
      /* Saving festival progress is best effort; driving continues. */
    }
  }
  command(command: FestivalCommand) {
    if (this.preparing) return;
    this.post({ type: 'command', command });
  }
  /** Resolve only after the worker's command snapshot and status arrive.
   * Travel must retain input/loading ownership through this round trip. */
  private commandAndWait(command: FestivalCommand) {
    if (this.disposed) return Promise.reject(new Error('Festival session closed'));
    const requestId = ++this.commandSerial;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.commandRequests.delete(requestId);
        reject(new Error('The festival simulation did not confirm the move.'));
      }, 8000);
      this.commandRequests.set(requestId, { resolve, reject, timer });
      this.post({ type: 'command', command, requestId });
    });
  }
  /** Fast travel to an event: the car is placed at once, and the
   * simulation stays held behind the loading screen until the terrain and
   * cover at the destination are resident (bounded wait), so the player
   * never drives onto coarse or missing ground. */
  private async travel(id: string, retry = false) {
    const renderer = this.renderer,
      event = this.events.find((e) => e.spec.id === id);
    if (!renderer || !event || this.travelling) {
      if (this.preparing) throw new Error('Festival startup destination unavailable');
      return;
    }
    this.travelling = true;
    // Retrying from the results is not already paused. Hold physics and
    // input before moving the car until the destination is resident.
    this.setPaused(true);
    this.hud?.showMenu(false);
    this.hud?.showMap(false);
    this.hud?.hideResults();
    this.host.loading(
      `${retry ? 'Preparing another run at' : 'Travelling to'} ${event.spec.name}…`,
    );
    let complete = false;
    try {
      await this.commandAndWait({ type: 'travel', event: id });
      const { x, z } = event.marker,
        deadline = performance.now() + 12000;
      while (!renderer.ready(x, z) && performance.now() < deadline && !this.disposed) {
        renderer.prestream(x, z);
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
      }
      if (this.disposed) return;
      if (!renderer.ready(x, z))
        throw new Error('The destination is still loading. Try again from the pause menu.');
      if (retry) await this.commandAndWait({ type: 'start', event: id });
      await this.preparePresentation();
      complete = true;
    } catch (error) {
      if (this.preparing) throw error;
      if (!this.disposed)
        this.host.toast(error instanceof Error ? error.message : 'Travel could not finish.');
    } finally {
      this.travelling = false;
      if (!this.disposed && !this.preparing) {
        this.host.loaded();
        this.setPaused(!complete);
      }
    }
  }
  input(input: Controls) {
    if (this.drivingInputEnabled) this.post({ type: 'input', input: { ...input } });
  }
  private openMenu() {
    this.controls?.openMenu();
  }
  private openMap() {
    if (!this.isPaused) this.setPaused(true);
    const frame = this.current;
    this.hud?.showMap(
      true,
      new Set(this.status?.discovered ?? []),
      frame ? { x: frame[carBase(0) + F.X], z: frame[carBase(0) + F.Z] } : undefined,
    );
  }
  private setPhoto(open: boolean) {
    if (!this.renderer || !this.hud || this.travelling) return;
    if (open) this.setPaused(true);
    this.renderer.setPhoto(open);
    this.hud.showPhoto(open);
    if (!open) this.setPaused(false);
  }
  /** Pause (menu open, driving input off) or resume (FestivalControls). */
  setPaused(value: boolean) {
    if (this.preparing && !value) return;
    this.controls?.setPaused(value);
  }
  motionDiagnostics() {
    return {
      kind: 'festival',
      startupPresentation: this.startupPresentation,
      vehicleId: this.status?.vehicleId ?? null,
      paused: this.isPaused,
      autopilot: this.status?.autopilot ?? null,
      sample: motionReceipt(this.current),
      presented: motionReceipt(this.renderer?.presented.value ?? null),
      presentationFrames: this.presentationFrames,
    };
  }
  get isPaused() {
    return this.controls?.paused ?? false;
  }
  /** Hosts keep polling the mapped pause action while results own input,
   * even though rival finishers may still be moving in the worker. */
  get drivingInputEnabled() {
    return !this.preparing && !this.travelling && (this.controls?.drivingInputEnabled ?? false);
  }
  /** Application actions while the festival drives; true when consumed. */
  action(name: string) {
    // Fast travel owns the session until the destination has streamed in.
    if (this.preparing || this.travelling) return name !== 'mute';
    switch (name) {
      case 'pause':
        if (this.renderer?.photo) {
          this.setPhoto(false);
          return true;
        }
        this.controls?.togglePause();
        return true;
      case 'camera':
        this.renderer?.changeCamera();
        return true;
      case 'replay':
        // R: reset to the road (the festival has no replay).
        this.command({ type: 'reset' });
        return true;
      case 'autopilot':
        this.command({ type: 'autopilot', value: !this.status?.autopilot });
        return true;
      case 'telemetry': {
        if (this.hud?.mapOpen) this.hud.showMap(false);
        else this.openMap();
        return true;
      }
      case 'pit':
        if (this.status?.card) this.command({ type: 'start', event: this.status.card.id });
        else if (this.status?.mode === 'finished') this.command({ type: 'continue' });
        return true;
      case 'blur':
      case 'deviceLost':
        if (!this.isPaused) this.setPaused(true);
        return true;
      default:
        return name !== 'mute';
    }
  }
  /** One animation frame. */
  frame(time: number) {
    if (this.preparing) return;
    // Menu/controller actions must remain responsive while graphics is busy.
    this.controls?.syncInput();
    const renderer = this.renderer;
    if (!renderer || !this.current || this.disposed || this.travelling) return;
    if (!this.host.presentation.ready()) return;
    this.applyViewport();
    this.drawHeldOrLive(time);
  }
  /** No controls/input ownership changes: also used while startup is held. */
  private drawHeldOrLive(time: number) {
    const renderer = this.renderer;
    if (!renderer) throw new Error('Festival renderer unavailable');
    const live = this.liveFrames.sample(performance.now());
    if (!live) throw new Error('Festival presentation snapshot unavailable');
    const { a, b, alpha } = live;
    const wall = Math.max(0.001, (time - (this.lastTime || time - 16)) / 1000);
    this.lastTime = time;
    // Posed before the draw, from the same interpolation as the cars.
    this.riders?.update(a, b, alpha, renderer.camera, this.host.quality);
    this.traffic?.update(live.auxiliaryA, live.auxiliaryB, alpha, renderer.night, b[H.TIME]);
    renderer.draw(a, b, alpha, Math.min(0.08, wall));
    this.host.presentation.submitted();
    this.presentationFrames++;
    const o = carBase(0),
      presented = renderer.presented.value;
    const qx = presented[o + F.QX],
      qy = presented[o + F.QY],
      qz = presented[o + F.QZ],
      qw = presented[o + F.QW];
    // Car forward (0, 0, 1) rotated by the orientation: heading for the map.
    const fx = 2 * (qx * qz + qw * qy),
      fz = 1 - 2 * (qx * qx + qy * qy);
    const spec = vehicleAt(Math.round(presented[o + RACE_BASE + R.VEHICLE])).spec;
    if (this.status)
      this.hud?.update(
        this.status,
        presented[o + F.X],
        presented[o + F.Z],
        minimapHeading(fx, fz),
        Math.round(presented[o + F.GEAR]),
        (presented[o + F.RPM] - spec.idleRPM) / Math.max(1, spec.limiterRPM - spec.idleRPM),
        renderer.guidance.cue,
        renderer.driftCue,
      );
    this.host.audio?.update(
      presented,
      renderer.mode === 'hood',
      !this.isPaused && !document.hidden,
      renderer.audioView.value,
      false,
    );
  }
  private revision() {
    return (this.host.presentation.revision?.() ?? 0) + this.localViewportRevision;
  }
  private applyViewport() {
    const revision = this.revision();
    if (revision === this.viewportRevision) return;
    this.renderer?.resize();
    this.viewportRevision = revision;
  }
  private async preparePresentation() {
    const active = () => {
      this.startupSignal?.throwIfAborted();
      if (this.disposed || this.host.presentation.current?.() === false)
        throw new DOMException('Festival session closed', 'AbortError');
      if (this.startupFailure) throw this.startupFailure;
      if (this.host.renderer.getContext().isContextLost())
        throw new Error('Festival graphics context lost during preparation');
    };
    this.host.loading('Completing the festival world frame…');
    this.startupPresentation = await completeHeldPresentation({
      active,
      ready: () => this.host.presentation.ready(),
      revision: () => this.revision(),
      resize: () => this.applyViewport(),
      draw: () => this.drawHeldOrLive(performance.now()),
      receipt: () => ({
        sampleTick: this.current?.[H.TICK] ?? -1,
        presentedTick: this.renderer?.presented.value[H.TICK] ?? -1,
      }),
      deadline: this.preparing ? this.startupDeadline : performance.now() + 120000,
    });
  }
  resize() {
    // Never mutate shared render targets behind an unfinished world draw.
    this.localViewportRevision++;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.readyReject?.(new DOMException('Festival startup cancelled', 'AbortError'));
    this.readyReject = this.readyResolve = null;
    this.worker.terminate();
    this.tiles.terminate();
    for (const request of this.commandRequests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Festival session closed'));
    }
    this.commandRequests.clear();
    window.removeEventListener('keydown', this.photoKeys, true);
    this.controls?.dispose();
    this.host.audio?.stop();
    this.traffic?.dispose();
    this.traffic = null;
    this.riders?.dispose();
    this.riders = null;
    this.renderer?.dispose();
    this.hud?.dispose();
    this.renderer = null;
    this.hud = null;
  }
}
