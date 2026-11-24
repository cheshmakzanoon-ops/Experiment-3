import { clamp } from '../core/math.ts';
import { busGain, dbToGain, duckGain, type AudioLevels } from './mixer.ts';

/** The game has no music: every sound is synthesised in the browser, and no
 * track ships in the repository (there is nothing to license and nothing to
 * fabricate). This module is the SOCKET for the music that will come, from a
 * composer or a licensed library (docs/studio/reports/audio-music-brief.md):
 * a cue table, a pure scene-to-cue choice, and a music bus that is DISABLED by
 * default, stays silent while a cue has no asset, ducks under the engines and
 * obeys the `music` slider. Nothing here synthesises a melody.
 *
 * Assets go under `public/audio/music/` and into `MUSIC_CUES` (`src`); until a
 * `src` is filled the cue is "unavailable": `play` returns false, no network
 * request is made, and `MUSIC_AVAILABLE` stays false so the settings screen does
 * not show a slider that does nothing. */
export type MusicCueId =
  | 'menu'
  | 'race-ambient'
  | 'race-tension'
  | 'results'
  | 'wildcard-sting'
  | 'festival-day'
  | 'festival-night'
  | 'snow';

export interface MusicCueSpec {
  id: MusicCueId;
  /** `loop`: plays until stopped, seamless between loopStart and loopEnd. `stinger`: once. */
  kind: 'loop' | 'stinger';
  /** Asset URL (relative to the site root), or null while no asset ships. */
  src: string | null;
  /** Integrated loudness the file must be mastered to (LUFS), true peak at most -1 dBTP. */
  lufs: number;
  /** Loop points (s) inside the file; null for a stinger. */
  loop: readonly [number, number] | null;
  /** Fade in / out when the cue starts or is replaced (s). */
  fade: number;
}

const loop = (id: MusicCueId, lufs: number, fade = 2.5): MusicCueSpec => ({
  id,
  kind: 'loop',
  src: null,
  lufs,
  loop: null,
  fade,
});
export const MUSIC_CUES: Readonly<Record<MusicCueId, MusicCueSpec>> = Object.freeze({
  menu: loop('menu', -22),
  'race-ambient': loop('race-ambient', -26, 4),
  'race-tension': loop('race-tension', -24, 3),
  results: loop('results', -22),
  'wildcard-sting': {
    id: 'wildcard-sting',
    kind: 'stinger',
    src: null,
    lufs: -20,
    loop: null,
    fade: 0.05,
  },
  'festival-day': loop('festival-day', -26, 4),
  'festival-night': loop('festival-night', -26, 4),
  snow: loop('snow', -27, 4),
});

/** True once at least one cue has an asset: the settings screen shows the music controls. */
export const MUSIC_AVAILABLE = Object.values(MUSIC_CUES).some((cue) => cue.src !== null);

/** Where the player is, in the terms the music cares about. */
export interface MusicScene {
  scene: 'menu' | 'race' | 'results' | 'festival' | 'wildcard-start';
  night?: boolean;
  snow?: boolean;
  /** Final laps, a safety car, a close fight: the race wants tension. */
  tense?: boolean;
}
/** The cue a scene calls for, or null for silence. Pure. */
export function musicCueFor(scene: MusicScene): MusicCueId | null {
  switch (scene.scene) {
    case 'menu':
      return 'menu';
    case 'results':
      return 'results';
    case 'wildcard-start':
      return 'wildcard-sting';
    case 'festival':
      return scene.snow ? 'snow' : scene.night ? 'festival-night' : 'festival-day';
    case 'race':
      return scene.tense ? 'race-tension' : scene.snow ? 'snow' : 'race-ambient';
  }
}

/** Music falls by this much while the engines are at full presence (dB). */
export const MUSIC_DUCK_DB = 6;
/** Linear gain of the music bus: trim, slider, and the duck for `enginePresence` 0..1. */
export function musicGain(levels: Readonly<AudioLevels>, enginePresence: number): number {
  return busGain('music', levels) * duckGain(enginePresence, MUSIC_DUCK_DB);
}
/** The loudness the bus is trimmed against: a cue mastered to this plays at unity. */
export const MUSIC_REFERENCE_LUFS = -24;
/** A cue's gain from its mastered loudness against the bus reference. */
export const cueNormalisation = (spec: Pick<MusicCueSpec, 'lufs'>) =>
  dbToGain(MUSIC_REFERENCE_LUFS - spec.lufs);

export type MusicLoader = (src: string) => Promise<AudioBuffer>;

interface MusicVoice {
  id: MusicCueId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** The music bus: a cue voice per playing cue (crossfaded), a duck, a level. */
export class MusicBus {
  /** Off until the player switches it on (and a cue has an asset). */
  private enabledValue = false;
  get enabled() {
    return this.enabledValue;
  }
  set enabled(value: boolean) {
    if (this.disposed || this.enabledValue === value) return;
    this.enabledValue = value;
    if (!value) this.request++;
  }
  readonly output: GainNode;
  private readonly duck: GainNode;
  private voices = new Set<MusicVoice>();
  private cache = new Map<string, Promise<AudioBuffer>>();
  private current: MusicVoice | null = null;
  private request = 0;
  private disposed = false;
  constructor(
    private readonly context: BaseAudioContext,
    destination: AudioNode,
    private readonly load: MusicLoader = defaultLoader(context),
    private readonly cues: Readonly<Record<MusicCueId, MusicCueSpec>> = MUSIC_CUES,
  ) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.duck = context.createGain();
    this.duck.connect(this.output).connect(destination);
  }
  get playing(): MusicCueId | null {
    return this.current?.id ?? null;
  }
  /** Start a cue (crossfading from the one playing). False when unavailable,
   * superseded, stopped, or its load/graph could not be created. */
  async play(id: MusicCueId): Promise<boolean> {
    const spec = this.cues[id];
    if (this.disposed || !this.enabled || !spec?.src) return false;
    const request = ++this.request;
    // Requesting the current cue also cancels a pending replacement.
    if (this.current?.id === id) return true;
    let buffer: AudioBuffer;
    let pending = this.cache.get(spec.src);
    try {
      if (!pending) this.cache.set(spec.src, (pending = this.load(spec.src)));
      buffer = await pending;
    } catch {
      if (this.cache.get(spec.src) === pending) this.cache.delete(spec.src);
      return false;
    }
    if (this.disposed || !this.enabled || request !== this.request) return false;
    let source: AudioBufferSourceNode | null = null,
      gain: GainNode | null = null,
      voice: MusicVoice | null = null;
    try {
      const now = this.context.currentTime;
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      const owned = (voice = { id, source, gain });
      this.voices.add(owned);
      source.onended = () => {
        try {
          this.releaseVoice(owned);
        } catch {
          // A closed graph must not turn an auxiliary ended event into an app error.
        }
      };
      source.buffer = buffer;
      if (spec.kind === 'loop') {
        source.loop = true;
        if (spec.loop) {
          source.loopStart = spec.loop[0];
          source.loopEnd = spec.loop[1];
        }
      }
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(cueNormalisation(spec), now + Math.max(0.01, spec.fade));
      source.connect(gain).connect(this.duck);
      source.start(now);
      if (this.disposed || !this.enabled || request !== this.request || !this.voices.has(owned)) {
        this.releaseVoice(owned, true);
        return false;
      }
      this.fadeOut(spec.fade, owned);
      this.current = owned;
      return true;
    } catch {
      if (voice) {
        try {
          this.releaseVoice(voice, true);
        } catch {
          // Every owned node has already been attempted.
        }
      } else {
        // Source creation can succeed before gain creation fails.
        try {
          source?.disconnect();
        } catch {
          // The context may already be closing.
        }
      }
      return false;
    }
  }
  /** Retire ownership before cleanup callbacks so late events cannot release twice. */
  private releaseVoice(voice: MusicVoice, stop = false) {
    if (!this.voices.delete(voice)) return;
    if (this.current === voice) this.current = null;
    voice.source.onended = null;
    if (stop) {
      try {
        voice.source.stop();
      } catch {
        // A source that never started or already finished need not be stopped.
      }
    }
    const failures: unknown[] = [];
    for (const node of [voice.source, voice.gain]) {
      try {
        node.disconnect();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }
  /** Fade previous voices, retaining the newly started voice's fade-in. */
  private fadeOut(seconds: number, except?: MusicVoice) {
    const now = this.context.currentTime;
    for (const v of this.voices) {
      if (v === except) continue;
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, seconds));
        v.source.stop(now + Math.max(0.01, seconds) + 0.05);
      } catch {
        // If a fade cannot be scheduled, silence that voice and continue the others.
        try {
          this.releaseVoice(v, true);
        } catch {
          // All of this voice's nodes have been attempted.
        }
      }
    }
  }
  stop(seconds = 1.5) {
    if (this.disposed) return;
    this.request++;
    this.current = null;
    this.fadeOut(seconds);
  }
  /** Per frame: the slider, the master switch and the duck under the engines. */
  update(levels: Readonly<AudioLevels>, enginePresence: number, time: number) {
    if (this.disposed) return;
    const target = this.enabled ? musicGain(levels, clamp(enginePresence, 0, 1)) : 0;
    this.output.gain.setTargetAtTime(target, time, 0.4);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabledValue = false;
    this.request++;
    this.current = null;
    this.cache.clear();
    const failures: unknown[] = [];
    for (const voice of this.voices) {
      try {
        this.releaseVoice(voice, true);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const node of [this.duck, this.output]) {
      try {
        node.disconnect();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw failures[0];
  }
}

function defaultLoader(context: BaseAudioContext): MusicLoader {
  return async (src) => {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Music asset ${src}: HTTP ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  };
}
