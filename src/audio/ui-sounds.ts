import { UI_CUE_EVENT, type UiCue } from '../ui/ui-cue.ts';

/** Menu sounds: the audio half of the front end's `motobound:cue` hook
 * (src/ui/ui-cue.ts). Six mechanical sounds, synthesised in WebAudio from the
 * small recipes below (no samples, no music bed): a relay click for a dial
 * step, a stencil-stamp thud for a choice, a pit-exit light chime for launch,
 * a latch for opening a sheet, the latch released for closing, and a
 * two-tone buzz for a refused entry.
 *
 * Rules it keeps: it never plays before the person has interacted with the
 * page (the browser's autoplay rule: the context is created only by a cue that
 * follows a gesture, and a context that is not running is left alone), it obeys
 * the player's master volume and the mute key, and it is quiet (the master gain
 * tops out at 0.35 of the player's volume). It does not touch the race audio
 * graph: the session audio engine builds its own context when a session starts. */
export type UiSoundId = 'tick' | 'select' | 'confirm' | 'open' | 'close' | 'deny';
/** Which sound a cue plays (`back` is the same release as `close`). */
export const CUE_SOUND: Readonly<Record<UiCue, UiSoundId>> = Object.freeze({
  tick: 'tick',
  select: 'select',
  confirm: 'confirm',
  open: 'open',
  close: 'close',
  back: 'close',
  deny: 'deny',
});

/** One voice: a tone (optional glide to `to` Hz) or a noise burst, with an
 * attack/decay envelope. Times are seconds from the start of the sound. */
export interface Voice {
  kind: 'tone' | 'noise';
  wave?: OscillatorType;
  /** Hz (tone); filter corner (noise). */
  hz: number;
  /** Tone glide target (Hz) or noise filter sweep target. */
  to?: number;
  filter?: BiquadFilterType;
  /** Filter corner (Hz) for a tone; a noise burst filters at `hz`. */
  cutoff?: number;
  at: number;
  attack: number;
  decay: number;
  gain: number;
}
export const UI_SOUNDS: Readonly<Record<UiSoundId, readonly Voice[]>> = Object.freeze({
  // Relay click: a hard transient and a short high blip.
  tick: [
    { kind: 'noise', hz: 3200, filter: 'highpass', at: 0, attack: 0.001, decay: 0.012, gain: 0.5 },
    {
      kind: 'tone',
      wave: 'square',
      hz: 1900,
      to: 1500,
      at: 0,
      attack: 0.001,
      decay: 0.02,
      gain: 0.12,
    },
  ],
  // Stencil stamp: a low thud that drops, with a little paper in front of it.
  select: [
    { kind: 'tone', wave: 'sine', hz: 170, to: 62, at: 0, attack: 0.002, decay: 0.11, gain: 0.9 },
    {
      kind: 'noise',
      hz: 900,
      to: 300,
      filter: 'lowpass',
      at: 0,
      attack: 0.001,
      decay: 0.045,
      gain: 0.35,
    },
  ],
  // Pit-exit light: two bright notes, the second a fifth up, then a tail.
  confirm: [
    { kind: 'tone', wave: 'triangle', hz: 880, at: 0, attack: 0.003, decay: 0.16, gain: 0.5 },
    { kind: 'tone', wave: 'triangle', hz: 1320, at: 0.09, attack: 0.003, decay: 0.34, gain: 0.5 },
    { kind: 'tone', wave: 'sine', hz: 2640, at: 0.09, attack: 0.003, decay: 0.2, gain: 0.08 },
  ],
  // Latch: a short rising scrape and a click at the end.
  open: [
    {
      kind: 'noise',
      hz: 500,
      to: 2400,
      filter: 'bandpass',
      at: 0,
      attack: 0.01,
      decay: 0.09,
      gain: 0.3,
    },
    {
      kind: 'tone',
      wave: 'square',
      hz: 1400,
      to: 1100,
      at: 0.085,
      attack: 0.001,
      decay: 0.02,
      gain: 0.1,
    },
  ],
  // The latch released: the same scrape falling.
  close: [
    {
      kind: 'noise',
      hz: 2200,
      to: 450,
      filter: 'bandpass',
      at: 0,
      attack: 0.008,
      decay: 0.08,
      gain: 0.26,
    },
    {
      kind: 'tone',
      wave: 'sine',
      hz: 300,
      to: 190,
      at: 0.05,
      attack: 0.002,
      decay: 0.07,
      gain: 0.3,
    },
  ],
  // Refused: two close low tones that beat against each other.
  deny: [
    {
      kind: 'tone',
      wave: 'square',
      hz: 110,
      at: 0,
      attack: 0.004,
      decay: 0.16,
      gain: 0.18,
      filter: 'lowpass',
      cutoff: 700,
    },
    {
      kind: 'tone',
      wave: 'square',
      hz: 117,
      at: 0,
      attack: 0.004,
      decay: 0.16,
      gain: 0.18,
      filter: 'lowpass',
      cutoff: 700,
    },
  ],
});
/** The longest any sound rings (s): a cue never outlives a menu step. */
export const UI_SOUND_MAX_SECONDS = 0.5;
/** Output ceiling relative to the player's master volume. */
export const UI_MASTER = 0.35;
/** Fastest repeat of one sound (s): key repeat on a dial is a tick train, not a wall. */
const MIN_GAP = 0.045;

/** What the sounds read from the application each time. */
export interface UiSoundSettings {
  /** The player's master volume, 0 to 1. */
  volume: number;
  muted: boolean;
}
/** The slice of AudioContext this uses (so a test can stand in for it). */
type Context = Pick<
  AudioContext,
  | 'state'
  | 'currentTime'
  | 'destination'
  | 'sampleRate'
  | 'resume'
  | 'createGain'
  | 'createOscillator'
  | 'createBufferSource'
  | 'createBiquadFilter'
  | 'createBuffer'
  | 'close'
>;
export interface UiSoundsOptions {
  settings: () => UiSoundSettings;
  /** Where the cues arrive (the window). */
  target?: EventTarget;
  /** True once the person has interacted with the page (default: the browser's
   * user-activation flag, which is absent in old engines: then a cue is allowed
   * only after a first `pointerdown` or `keydown` this object has seen). */
  activated?: () => boolean;
  createContext?: () => Context;
}

export class UiSounds {
  private context: Context | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly last = new Map<UiSoundId, number>();
  private gestured = false;
  private readonly abort = new AbortController();
  /** Sounds started, for tests and diagnostics. */
  played = 0;
  constructor(private readonly options: UiSoundsOptions) {
    const target = options.target ?? globalThis.window;
    target?.addEventListener(
      UI_CUE_EVENT,
      (event) => this.cue((event as CustomEvent).detail?.cue),
      {
        signal: this.abort.signal,
      },
    );
    // Activation fallback for engines without navigator.userActivation.
    for (const type of ['pointerdown', 'keydown'])
      target?.addEventListener(type, () => (this.gestured = true), {
        signal: this.abort.signal,
        capture: true,
        passive: true,
      });
  }
  dispose() {
    this.abort.abort();
    void this.context?.close?.();
    this.context = null;
  }
  private allowed() {
    if (this.options.activated) return this.options.activated();
    const activation = (globalThis.navigator as Navigator | undefined)?.userActivation;
    return activation ? activation.hasBeenActive : this.gestured;
  }
  /** Play the sound of a cue, if the player's settings and the browser allow it. */
  cue(cue: unknown) {
    const id = typeof cue === 'string' ? CUE_SOUND[cue as UiCue] : undefined;
    if (!id) return false;
    const { volume, muted } = this.options.settings();
    if (muted || !(volume > 0) || !this.allowed()) return false;
    const ctx = this.ensure();
    if (!ctx || !this.master) return false;
    if (ctx.state !== 'running') {
      // Not allowed to start yet (or suspended by the browser): ask once, never queue sounds.
      void ctx.resume().catch(() => undefined);
      return false;
    }
    const now = ctx.currentTime;
    if (now - (this.last.get(id) ?? -Infinity) < MIN_GAP) return false;
    this.last.set(id, now);
    this.master.gain.setValueAtTime(UI_MASTER * Math.min(1, volume), now);
    for (const voice of UI_SOUNDS[id]) this.voice(ctx, voice, now);
    this.played++;
    return true;
  }
  private ensure() {
    if (this.context) return this.context;
    try {
      const ctx =
        this.options.createContext?.() ??
        (new AudioContext({ latencyHint: 'interactive' }) as unknown as Context);
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      return ctx;
    } catch {
      return null;
    }
  }
  private noiseBuffer(ctx: Context) {
    if (this.noise) return this.noise;
    const length = Math.ceil(ctx.sampleRate * 0.25),
      buffer = ctx.createBuffer(1, length, ctx.sampleRate),
      data = buffer.getChannelData(0);
    // A fixed pseudo-random burst: the same click every time.
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0x80000000 - 1) * 0.9;
    }
    return (this.noise = buffer);
  }
  private voice(ctx: Context, v: Voice, now: number) {
    const start = now + v.at,
      end = start + v.attack + v.decay;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(v.gain, start + v.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    let head: AudioNode;
    let source: AudioScheduledSourceNode;
    if (v.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = v.wave ?? 'sine';
      osc.frequency.setValueAtTime(v.hz, start);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, end);
      source = head = osc;
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      source = head = src;
    }
    if (v.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = v.filter;
      filter.frequency.setValueAtTime(v.kind === 'tone' ? (v.cutoff ?? v.hz) : v.hz, start);
      if (v.kind === 'noise' && v.to) filter.frequency.exponentialRampToValueAtTime(v.to, end);
      if (v.filter === 'bandpass') filter.Q.value = 1.4;
      head.connect(filter);
      head = filter;
    }
    head.connect(gain);
    gain.connect(this.master!);
    source.start(start);
    source.stop(end + 0.02);
  }
}
