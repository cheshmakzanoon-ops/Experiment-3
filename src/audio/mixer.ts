import { clamp } from '../core/math.ts';

/** Gain staging for the race audio graph: the per-bus levels the player controls,
 * the calibrated trims between buses, the master bus (damp-air low-pass, bus
 * compressor, make-up gain, soft ceiling) and the control-rate maths (ducking,
 * smoothing). The numbers are NOT taste: every trim and the ceiling were set
 * from rig measurements (scripts/studio/tools/audio-render.mjs, see
 * docs/studio/reports/audio.md). Pure parts are unit-tested in tests/audio-mixer.test.ts. */

export const BUS_NAMES = ['engine', 'effects', 'ambience', 'ui', 'music'] as const;
export type BusName = (typeof BUS_NAMES)[number];
/** The player's bus sliders, 0..1. 1 is the mix as designed; the master is the
 * separate `Settings.volume`. */
export type AudioLevels = Record<BusName, number>;
export const DEFAULT_LEVELS: Readonly<AudioLevels> = Object.freeze({
  engine: 1,
  effects: 1,
  ambience: 1,
  ui: 1,
  music: 0.8,
});

export function validateLevels(value: unknown): AudioLevels {
  const source = value && typeof value === 'object' ? (value as Partial<AudioLevels>) : {};
  const out = { ...DEFAULT_LEVELS } as AudioLevels;
  for (const bus of BUS_NAMES) {
    const v = source[bus];
    if (typeof v === 'number' && Number.isFinite(v)) out[bus] = clamp(v, 0, 1);
  }
  return out;
}

export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (gain: number) => 20 * Math.log10(Math.max(gain, 1e-9));
/** Slider position to amplitude: a square-law taper, so half way is -12 dB and
 * the lower half of the slider is not dead weight. 0 is silence. */
export const sliderGain = (position: number) => clamp(position, 0, 1) ** 2;

/** The staging constants. `trimDb` balances the buses against each other at
 * slider positions of 1; `makeupDb` lifts the whole mix before the ceiling. */
export const GAIN_STAGING = Object.freeze({
  /** The master `volume` slider scale used since the first audio pass. */
  masterScale: 0.8,
  makeupDb: 9,
  ceilingDbfs: -1.5,
  trimDb: Object.freeze({
    engine: 0,
    effects: -6,
    ambience: -8,
    ui: 0,
    music: -3,
  } satisfies Record<BusName, number>),
  /** Ambience falls by this much while the engine is at full presence. */
  ambienceDuckDb: 8,
});

/** The gain of one bus: its trim times the player's slider. */
export function busGain(bus: BusName, levels: Readonly<AudioLevels>): number {
  return dbToGain(GAIN_STAGING.trimDb[bus]) * sliderGain(levels[bus]);
}

/** Master gain from the volume setting (linear amplitude as the setting has always been). */
export const masterGain = (volume: number, ambienceMaster = 1) =>
  clamp(volume, 0, 1) * GAIN_STAGING.masterScale * ambienceMaster;

/** Exponential approach of `current` to `target` over `dt` s with time constant `tau`. */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  if (!(dt > 0) || !(tau > 0)) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Linear gain applied to the ambience under the engine: 1 when the engine is
 * absent, `1 - (1 - 10^(-depthDb/20))` at full presence, with a smooth knee. */
export function duckGain(enginePresence: number, depthDb = GAIN_STAGING.ambienceDuckDb): number {
  const x = clamp((enginePresence - 0.15) / 0.6, 0, 1),
    smooth = x * x * (3 - 2 * x);
  return 1 - smooth * (1 - dbToGain(-Math.abs(depthDb)));
}

/** The static curve of the ceiling: identity up to the knee, then a tanh roll-off
 * that approaches (and never reaches) `ceiling`; odd-symmetric and monotone. */
export function softLimit(x: number, ceiling: number, knee = 0.6): number {
  const a = Math.abs(x);
  if (a <= knee) return x;
  const y = knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
  return x < 0 ? -y : y;
}
/** WaveShaper table over [-1, 1]; inputs beyond clamp to the end values, which
 * are below the ceiling, so nothing leaves the shaper above it. */
export function softLimitCurve(
  ceiling: number,
  size = 4097,
  knee = 0.6,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) curve[i] = softLimit((i / (size - 1)) * 2 - 1, ceiling, knee);
  return curve;
}

/** The bus a whole race mix passes through: damp-air low-pass (fog and snow close
 * it), a bus compressor that glues the layers, make-up gain, and a soft ceiling
 * so that no combination of sources can leave the context above -1 dBFS. */
export class MasterBus {
  readonly input: BiquadFilterNode;
  readonly compressor: DynamicsCompressorNode;
  readonly makeup: GainNode;
  readonly shaper: WaveShaperNode;
  private bypassed = false;
  constructor(
    context: BaseAudioContext,
    private readonly destination: AudioNode = context.destination,
  ) {
    // Damp air hushes the world: a master low-pass that fog closes (open at 18 kHz otherwise).
    this.input = context.createBiquadFilter();
    this.input.type = 'lowpass';
    this.input.frequency.value = 18000;
    this.input.Q.value = 0.5;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.2;
    this.makeup = context.createGain();
    this.makeup.gain.value = dbToGain(GAIN_STAGING.makeupDb);
    this.shaper = context.createWaveShaper();
    this.shaper.curve = softLimitCurve(dbToGain(GAIN_STAGING.ceilingDbfs));
    this.shaper.oversample = '4x';
    this.connect();
  }
  /** The final node: capture or analyse the mix here. */
  get output(): AudioNode {
    return this.bypassed ? this.makeup : this.shaper;
  }
  private connect() {
    this.input.disconnect();
    this.makeup.disconnect();
    this.compressor.disconnect();
    this.shaper.disconnect();
    if (this.bypassed) {
      this.input.connect(this.makeup);
      this.makeup.connect(this.destination);
    } else {
      this.input.connect(this.compressor);
      this.compressor.connect(this.makeup);
      this.makeup.connect(this.shaper);
      this.shaper.connect(this.destination);
    }
  }
  /** Diagnostic: take the compressor and ceiling out of the path (pre-limiter stem measurements). */
  bypassDynamics(on: boolean) {
    if (this.bypassed === on) return;
    this.bypassed = on;
    this.connect();
  }
  dispose() {
    for (const node of [this.input, this.compressor, this.makeup, this.shaper]) node.disconnect();
  }
}
