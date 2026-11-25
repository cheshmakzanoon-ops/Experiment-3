import { ReviewAudioTap } from './review-tap.ts';
import {
  CueSynth,
  DrivingCueDirector,
  validateDrivingAudio,
  type DrivingAudioSettings,
} from './driving-cues.ts';
import type { Track } from '../simulation/track.ts';
import { ContactAudio } from './surface-audio.ts';
import { EngineVoices } from './engine-voices.ts';
import { PowerUnitAudio } from './power-unit.ts';
import type { AudioView } from './spatial.ts';
import { H } from '../simulation/protocol.ts';
import { frameLiquidRain } from '../simulation/weather.ts';
import { clamp, Random } from '../core/math.ts';
import { newWeatherAmbience, weatherAmbience } from './weather-ambience.ts';
import {
  DEFAULT_LEVELS,
  MasterBus,
  busGain,
  duckGain,
  masterGain,
  validateLevels,
  type AudioLevels,
} from './mixer.ts';
import { AudioUnlock, settle } from './unlock.ts';
import { StartLightsAudio } from './start-lights.ts';
import { MusicBus, type MusicCueId } from './music.ts';

/** A real-time context, as opposed to the OfflineAudioContext of the rig. */
const isLive = (context: BaseAudioContext): context is AudioContext =>
  !('startRendering' in context);

/** How long a session start waits for a context the autoplay policy is holding. */
const RESUME_WAIT_MS = 250;
/** Wind-bed share for a listener outside the cockpit. */
const OUTSIDE_WIND = 0.6;

/** The live context owns the master bus, the per-class buses (engine, effects,
 * ambience), ambient wind/rain, the spatial engine graph and the player contact
 * graph. Rendering supplies the actual listener pose; no audio output is
 * allowed to modify physics or recorded state.
 *
 *   engines ── power unit ───────────────► engine bus ──┐
 *   tyres / surfaces / impacts ──────────► effects bus ─┤
 *   wind / rain / grit / thunder ► duck ─► ambience bus ┼► master ► MasterBus
 *   (music bus, mixer.ts: optional)                     │   (damp-air LP, compressor,
 *   driving cue tones (accessibility) ──────────────────┘    make-up, soft ceiling)
 *
 * The cue tones skip the buses on purpose: a player who turned the engine or
 * the effects down must still hear them. */
export class RacingAudio {
  private context: BaseAudioContext | null = null;
  private disposal: Promise<void> | null = null;
  private generation = 0;
  private reviewTap: ReviewAudioTap | null = null;
  captureOutput() {
    if (!this.context || !this.bus) throw new Error('Game audio is not initialized');
    if (!isLive(this.context)) throw new Error('Only a live audio context can be captured');
    this.reviewTap?.release();
    this.reviewTap = new ReviewAudioTap(this.context, this.bus.output);
    return this.reviewTap;
  }
  private cueDirector: DrivingCueDirector | null = null;
  private cueSettings = validateDrivingAudio(null);
  private cueSynth: CueSynth | null = null;
  private previewSynth: CueSynth | null = null;
  private lastPreview = -Infinity;
  configureDriving(track: Track, settings: DrivingAudioSettings) {
    if (this.cueDirector?.track !== track) this.cueDirector = new DrivingCueDirector(track);
    this.cueSettings = validateDrivingAudio(settings);
    this.cueDirector.reset();
    this.cueSynth?.silence();
  }
  async previewDriving(settings: DrivingAudioSettings) {
    if (this.muted) return;
    const starting = this.start();
    const ctx = this.context,
      generation = this.generation;
    await starting;
    if (this.context !== ctx || this.generation !== generation) return;
    if (!ctx || !this.previewSynth || this.muted || ctx.currentTime - this.lastPreview < 0.8)
      return;
    // Startup bounds autoplay waits and contains resume refusals. A preview
    // that still cannot run must not arm tones for an unrelated later gesture.
    // Offline graphs intentionally schedule before rendering starts.
    if (isLive(ctx) && ctx.state !== 'running') return;
    this.lastPreview = ctx.currentTime;
    const p = validateDrivingAudio(settings),
      invert = p.invertStereo ? -1 : 1;
    for (const [offset, frequency, pan] of [
      [0, 660, -0.85],
      [0.25, 800, 0],
      [0.5, 660, 0.85],
    ])
      this.previewSynth.play(
        { kind: 'turn', frequency, pan: pan * invert, duration: 0.15 },
        ctx.currentTime + offset,
        p.volume * this.volume * 0.8,
      );
  }
  private master: GainNode | null = null;
  private bus: MasterBus | null = null;
  private engineBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private engines: EngineVoices | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private wind: GainNode | null = null;
  private rain: GainNode | null = null;
  /** Atmosphere beds (weather-ambience.ts): gale pitch, sand grit, thunder
   * and the damp-air low-pass on the master bus. */
  private windFilter: BiquadFilterNode | null = null;
  private grit: GainNode | null = null;
  private thunder: GainNode | null = null;
  private readonly ambience = newWeatherAmbience();
  private contactPan: StereoPannerNode | null = null;
  private unitPan: StereoPannerNode | null = null;
  private contactAudio: ContactAudio | null = null;
  private powerUnit: PowerUnitAudio | null = null;
  private startLights: StartLightsAudio | null = null;
  private music: MusicBus | null = null;
  private unlock: AudioUnlock | null = null;
  private last = -Infinity;
  private wasPlaying = false;
  private contactAttenuation = 0;
  /** The master volume setting (0..1). */
  volume = 0.45;
  private isMuted = false;
  get muted() {
    return this.isMuted;
  }
  set muted(value: boolean) {
    this.isMuted = value;
    if (value) {
      // Previews bypass the race master. Cancel both their scheduled tones and
      // a pending activation, even if the player unmutes before it settles.
      this.generation++;
      this.previewSynth?.silence();
    }
  }
  /** The player's bus sliders (mixer.ts); applied on every update. */
  levels: AudioLevels = { ...DEFAULT_LEVELS };
  setLevels(value: unknown) {
    this.levels = validateLevels(value);
  }
  /** Background music (music.ts): off by default and silent while no asset ships. */
  set musicEnabled(on: boolean) {
    if (this.music) this.music.enabled = on;
    this.wantMusic = on;
  }
  private wantMusic = false;
  /** Start a music cue; false while music is off or the cue has no asset. */
  playMusic(id: MusicCueId) {
    return this.music?.play(id) ?? Promise.resolve(false);
  }
  stopMusic() {
    this.music?.stop();
  }
  /** True while the browser's autoplay policy keeps the context suspended: no
   * sound until a key press, click or tap (a gamepad button does not count). */
  get locked() {
    return !!this.context && this.context.state !== 'running';
  }
  private own<N extends AudioNode>(node: N): N {
    this.nodes.push(node);
    return node;
  }
  /** `context` lets a measurement rig run the production graph in an
   * OfflineAudioContext (scripts/studio/tools/audio-render.mjs); the game
   * always creates its own live context. */
  async start(context?: BaseAudioContext) {
    if (this.context) {
      if (isLive(this.context)) await this.resume(this.context);
      return;
    }
    const ctx = context ?? new AudioContext({ latencyHint: 'interactive' });
    this.context = ctx;
    this.disposal = null;
    this.generation++;
    try {
      this.build(ctx);
      if (isLive(ctx)) this.unlock = new AudioUnlock(ctx);
    } catch (error) {
      // An interrupted graph must not become the cached context on the next
      // start. Release owned nodes now; a pending close cannot delay failure.
      void this.dispose().catch(() => undefined);
      throw error;
    }
    if (isLive(ctx)) {
      await this.resume(ctx);
    }
  }
  private build(ctx: BaseAudioContext) {
    this.master = this.own(ctx.createGain());
    this.master.gain.value = 0;
    this.bus = new MasterBus(ctx);
    this.master.connect(this.bus.input);
    const bus = (name: 'engine' | 'effects' | 'ambience') => {
      const node = this.own(ctx.createGain());
      node.gain.value = busGain(name, this.levels);
      node.connect(this.master!);
      return node;
    };
    this.engineBus = bus('engine');
    this.effectsBus = bus('effects');
    this.ambienceBus = bus('ambience');
    this.engines = new EngineVoices(ctx, this.engineBus);
    this.cueSynth = new CueSynth(ctx, this.master);
    this.previewSynth = new CueSynth(ctx, this.bus.input);
    const random = new Random(331),
      buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = 0.83 * previous + 0.17 * (random.next() * 2 - 1);
      data[i] = previous * 2;
    }
    const bed = (type: BiquadFilterType, frequency: number, q = 1) => {
      const source = this.own(ctx.createBufferSource()),
        filter = this.own(ctx.createBiquadFilter()),
        gain = this.own(ctx.createGain());
      source.buffer = buffer;
      source.loop = true;
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.ambienceBus!);
      this.sources.push(source);
      source.start();
      return { gain, filter };
    };
    const noise = (type: BiquadFilterType, frequency: number) => bed(type, frequency).gain;
    const windBed = bed('lowpass', 700);
    this.wind = windBed.gain;
    this.windFilter = windBed.filter;
    this.rain = noise('highpass', 1700);
    this.grit = bed('bandpass', 2800, 0.8).gain;
    this.thunder = bed('lowpass', 150).gain;
    this.contactPan = this.own(ctx.createStereoPanner());
    this.contactPan.connect(this.effectsBus);
    this.unitPan = this.own(ctx.createStereoPanner());
    this.unitPan.connect(this.engineBus);
    this.contactAudio = new ContactAudio(ctx, this.contactPan);
    // Player power-unit character shares the contact bus stereo position.
    this.powerUnit = new PowerUnitAudio(ctx, this.unitPan);
    this.startLights = new StartLightsAudio(ctx, this.effectsBus);
    this.music = new MusicBus(ctx, this.master);
    this.music.enabled = this.wantMusic;
  }
  /** Ask the context to run; bounded, because under the autoplay policy the
   * promise stays pending until a gesture (unlock.ts). */
  private async resume(ctx: AudioContext) {
    if (ctx.state === 'running') return;
    try {
      await settle(ctx.resume(), RESUME_WAIT_MS);
    } catch {
      // A synchronous activation refusal has the same meaning as a rejected
      // resume promise: keep the graph and let the next gesture try again.
    }
  }
  /** Diagnostic: take the compressor and ceiling out of the path (rig stems). */
  bypassDynamics(on: boolean) {
    this.bus?.bypassDynamics(on);
  }
  update(
    frame: Float32Array,
    cockpit: boolean,
    playing: boolean,
    view: AudioView,
    liveHuman = false,
  ) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.currentTime - this.last < 0.025) return;
    this.last = ctx.currentTime;
    const time = ctx.currentTime;
    const cue = this.cueDirector?.sample(
      frame,
      playing && liveHuman && !this.muted,
      time,
      this.cueSettings,
    );
    if (cue) this.cueSynth?.play(cue, time, this.cueSettings.volume);
    if (!playing || !liveHuman || this.muted) this.cueSynth?.silence();
    this.master.gain.setTargetAtTime(
      playing && !this.muted ? masterGain(this.volume, this.ambience.masterGain) : 0,
      time,
      0.06,
    );
    if (!playing) {
      if (this.wasPlaying) this.resetPresentation();
      this.wasPlaying = false;
      return;
    }
    this.wasPlaying = true;
    this.engines!.update(frame, view, time);
    const player = this.engines!.spatial.player;
    this.contactAttenuation = clamp(player.gain / 0.82, 0, 1);
    this.contactPan!.pan.setTargetAtTime(player.pan, time, 0.025);
    this.unitPan!.pan.setTargetAtTime(player.pan, time, 0.025);
    this.contactAudio!.output.gain.setTargetAtTime(0.85 * this.contactAttenuation, time, 0.04);
    this.contactAudio!.update(frame, cockpit, time);
    this.powerUnit!.update(frame, 0, time, this.contactAttenuation, cockpit);
    this.startLights!.update(frame, time);
    this.music!.update(this.levels, this.engines!.presence, time);
    // The player's sliders, and the ambience ducked under the engines.
    this.engineBus!.gain.setTargetAtTime(busGain('engine', this.levels), time, 0.05);
    this.effectsBus!.gain.setTargetAtTime(busGain('effects', this.levels), time, 0.05);
    this.ambienceBus!.gain.setTargetAtTime(
      busGain('ambience', this.levels) * duckGain(this.engines!.presence),
      time,
      0.25,
    );
    // Trackside listeners hear ambient wind, not 300 km/h cockpit wind. Rain
    // remains local to the listener even when the player's contact bus is distant.
    const airSpeed = Math.hypot(view.vx - frame[H.WIND_X], view.vy, view.vz - frame[H.WIND_Z]);
    // Gale, sand and thunder (weather-ambience.ts): audible at a standstill,
    // from the presented wind and the session clock; absent in clear air.
    const air = weatherAmbience(frame, this.ambience);
    // A camera outside the cockpit (chase, broadcast) hears the airflow less than a driver does.
    const cabin = view.interior ? 1 : OUTSIDE_WIND;
    this.wind!.gain.setTargetAtTime(
      Math.min(0.3, Math.min(0.25, (airSpeed / 100) ** 2 * 0.23 * cabin) + air.gale),
      time,
      0.04,
    );
    this.windFilter!.frequency.setTargetAtTime(air.gale > 0 ? air.galeHz : 700, time, 0.15);
    this.grit!.gain.setTargetAtTime(air.grit, time, 0.1);
    this.thunder!.gain.setTargetAtTime(air.thunder, time, 0.03);
    this.bus!.input.frequency.setTargetAtTime(air.masterLowpassHz, time, 0.4);
    this.rain!.gain.setTargetAtTime(
      clamp(frameLiquidRain(frame) * 0.0025, 0, 0.12) * (1 - this.contactAttenuation) * 0.85,
      time,
      0.04,
    );
  }
  resetPresentation() {
    this.contactAudio?.reset();
    this.powerUnit?.reset();
    this.startLights?.reset();
  }
  diagnostics() {
    return {
      state: this.context?.state ?? 'uninitialized',
      locked: this.locked,
      playing: this.wasPlaying,
      levels: { ...this.levels },
      drivingCues: {
        enabled: this.cueSettings.enabled,
        last: this.cueDirector?.lastKind ?? null,
        emitted: this.cueDirector?.emitted ?? 0,
      },
      contactAttenuation: this.contactAttenuation,
      landings: this.contactAudio?.landings ?? 0,
      lastLanding: this.contactAudio?.lastLanding ?? 0,
      powerUnit: this.powerUnit ? { ...this.powerUnit.mix, bursts: this.powerUnit.bursts } : null,
      voices: this.engines?.spatial.voices.map((voice) => ({ ...voice })) ?? [],
    };
  }
  stop() {
    this.generation++;
    this.cueDirector?.reset();
    this.cueSynth?.silence();
    this.previewSynth?.silence();
    this.master?.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.03);
    this.resetPresentation();
    this.wasPlaying = false;
  }
  dispose(): Promise<void> {
    if (!this.context) return this.disposal ?? Promise.resolve();
    const context = this.context,
      reviewTap = this.reviewTap,
      owners = [
        this.unlock,
        this.cueSynth,
        this.previewSynth,
        this.contactAudio,
        this.powerUnit,
        this.startLights,
        this.music,
        this.engines,
      ],
      sources = this.sources,
      nodes = this.nodes,
      bus = this.bus;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((ready, failed) => {
      resolve = ready;
      reject = failed;
    });
    this.disposal = pending;
    // Revoke the entire graph before any user/browser callback can reenter or
    // before close yields. A replacement start owns separate fields and arrays.
    this.context = null;
    this.generation++;
    this.reviewTap = null;
    this.unlock = null;
    this.cueSynth = this.previewSynth = null;
    this.contactAudio = null;
    this.powerUnit = null;
    this.startLights = null;
    this.music = null;
    this.engines = null;
    this.sources = [];
    this.nodes = [];
    this.master = null;
    this.bus = null;
    this.engineBus = this.effectsBus = this.ambienceBus = null;
    this.wind = this.rain = this.grit = this.thunder = null;
    this.windFilter = null;
    this.contactPan = this.unitPan = null;
    this.last = -Infinity;
    this.lastPreview = -Infinity;
    this.wasPlaying = false;
    this.contactAttenuation = 0;

    const failures: unknown[] = [];
    const release = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    };
    release(() => reviewTap?.release());
    for (const owner of owners) release(() => owner?.dispose());
    for (const source of sources) release(() => source.stop());
    for (const node of nodes) release(() => node.disconnect());
    release(() => bus?.dispose());
    let closing: Promise<void> | undefined;
    release(() => {
      if (isLive(context) && context.state !== 'closed') closing = context.close();
    });
    void Promise.resolve(closing).then(
      () => (failures.length ? reject(failures[0]) : resolve()),
      (error: unknown) => reject(failures.length ? failures[0] : error),
    );
    return pending;
  }
}
