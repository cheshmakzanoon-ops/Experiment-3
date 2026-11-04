import { F, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
import { SpatialAudioScene, type AudioView } from './spatial.ts';
import { engineUnload } from './airborne-audio.ts';
import {
  SOUND_PROFILES,
  frameCharacter,
  type SoundFamily,
  type SoundProfile,
} from './sound-profiles.ts';
import {
  BAND_MULTIPLIER,
  EV_IDLE_HUM_HZ,
  bandHarmonics,
  designedEngineLevel,
  designedMotorLevel,
  loudnessScale,
} from './engine-loudness.ts';
import { dbToGain } from './mixer.ts';
import { limiterFlutter, type LimiterFlutter } from './limiter-cue.ts';

/** K-weighted RMS amplitude a full-load redline voice presents before the buses
 * (the anchor of the designed loudness curve; set from rig measurements). */
export const ENGINE_REFERENCE_RMS = 0.07;
interface Voice {
  id: number;
  family: SoundFamily | null;
  osc: OscillatorNode[];
  bands: GainNode[];
  /** Fuel-cut bounce on the rev and pit limiters (limiter-cue.ts): `cut` carries
   * the steady part, `bounce` the LFO swing. */
  cut: GainNode;
  bounce: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}
/** Actual production graph, also executable by OfflineAudioContext. All four
 * engines use original harmonic bands; spatial motion controls their frequency,
 * attenuation and stereo image. Voice reassignment dips gain before retuning. */
export class EngineVoices {
  readonly spatial = new SpatialAudioScene();
  /** 0..1 loudness of the engines the listener hears right now (distance and the
   * designed level together): the ambience bed ducks under it. */
  presence = 0;
  private voices: Voice[] = [];
  private disposed = false;
  private waves = new Map<SoundFamily, PeriodicWave[]>();
  /** One shared bounce LFO: a smoothed square wave. */
  private lfo: OscillatorNode;
  private flutter: LimiterFlutter = { depth: 0, rateHz: 12 };
  constructor(
    private context: BaseAudioContext,
    destination: AudioNode = context.destination,
  ) {
    this.lfo = context.createOscillator();
    const real = new Float32Array(16),
      imag = new Float32Array(16);
    for (let k = 1; k < 16; k += 2) imag[k] = 1 / k ** 1.5;
    this.lfo.setPeriodicWave(context.createPeriodicWave(real, imag));
    this.lfo.frequency.value = 12;
    this.lfo.start();
    for (let i = 0; i < 4; i++) {
      const gain = context.createGain(),
        cut = context.createGain(),
        bounce = context.createGain(),
        filter = context.createBiquadFilter(),
        pan = context.createStereoPanner();
      gain.gain.value = 0;
      cut.gain.value = 1;
      bounce.gain.value = 0;
      this.lfo.connect(bounce).connect(cut.gain);
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      filter.Q.value = 0.5;
      gain.connect(cut).connect(filter).connect(pan).connect(destination);
      const osc: OscillatorNode[] = [],
        bands: GainNode[] = [];
      for (let j = 0; j < 3; j++) {
        const o = context.createOscillator(),
          g = context.createGain();
        g.gain.value = 0;
        o.connect(g).connect(gain);
        osc.push(o);
        bands.push(g);
      }
      this.voices.push({ id: -1, family: null, osc, bands, cut, bounce, filter, gain, pan });
    }
    for (const voice of this.voices) {
      this.assign(voice, SOUND_PROFILES['v6-turbo-hybrid']);
      for (const o of voice.osc) o.start();
    }
  }
  /** Harmonic spectrum per band from the family brief (odd/third emphasis, roll-off). */
  private wavesFor(profile: SoundProfile) {
    let waves = this.waves.get(profile.family);
    if (!waves) {
      waves = BAND_MULTIPLIER.map((_, band) => {
        const real = new Float32Array(40),
          imag = bandHarmonics(profile, band as 0 | 1 | 2);
        return this.context.createPeriodicWave(real, imag);
      });
      this.waves.set(profile.family, waves);
    }
    return waves;
  }
  private assign(voice: Voice, profile: SoundProfile) {
    if (voice.family === profile.family) return;
    const waves = this.wavesFor(profile);
    for (let j = 0; j < 3; j++) voice.osc[j].setPeriodicWave(waves[j]);
    voice.family = profile.family;
  }
  update(frame: Float32Array, view: AudioView, time: number) {
    if (this.disposed) return;
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid engine audio timestamp');
    this.spatial.update(frame, view);
    let presence = 0,
      bounceDepth = 0,
      bounceRate = 12;
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i],
        state = this.spatial.voices[i],
        id = state.id;
      if (id < 0) {
        voice.gain.gain.setTargetAtTime(0, time, 0.02);
        voice.id = -1;
        continue;
      }
      const o = carBase(id),
        rpm = frame[o + F.RPM];
      if (!Number.isFinite(rpm + frame[o + F.ENGINE_TORQUE]))
        throw new Error('Invalid engine audio state');
      const character = frameCharacter(frame, id),
        p = character.profile,
        limiter = character.limiterRPM;
      // In the air nothing resists the drive: the note unloads (D047).
      const load =
        clamp(Math.abs(frame[o + F.ENGINE_TORQUE]) / character.loadTorque, 0, 1) *
        engineUnload(frame, id);
      const changed = voice.id !== id || voice.family !== p.family,
        at = changed ? time + 0.02 : time;
      if (changed) {
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setTargetAtTime(0, time, 0.003);
        this.assign(voice, p);
      }
      // Electric families have no firing order: the voice follows motor speed, with
      // a faint inverter hum at a standstill so a stopped electric car is not silent.
      const electric = p.firingsPerRev === 0,
        road = Math.max(0, frame[o + F.SPEED]);
      const signature = character.signature;
      const cutoff =
        (view.interior && id === view.followedCar ? 1500 + load * 2300 : 2500 + load * 4600) *
        signature.brightness;
      const tilt = [dbToGain(signature.tiltDb / 2), 1, dbToGain(-signature.tiltDb / 2)] as const;
      const base = electric
        ? Math.max(EV_IDLE_HUM_HZ, road * p.motorHzPerMS * 0.25)
        : (rpm / 60) * p.firingsPerRev;
      const hz: [number, number, number] = [0, 0, 0],
        shape: [number, number, number] = [0, 0, 0];
      for (let band = 0; band < 3; band++) {
        hz[band] = Math.max(50, base * BAND_MULTIPLIER[band]) * state.doppler;
        const weight = electric
          ? band === 1
            ? 1
            : 0
          : Math.exp(-(((rpm - p.bandCentres[band] * limiter) / (p.bandWidth * limiter)) ** 2)) *
            (band === 0 ? 1 + p.burble * (1 - clamp(rpm / limiter, 0, 1)) : 1);
        shape[band] = weight * (electric ? p.motorGain * 4 : p.bandGain[band] * tilt[band]);
      }
      // The band weights fix the timbre; the designed curve fixes how loud it is.
      const level = electric ? designedMotorLevel(road) : designedEngineLevel(rpm / limiter, load);
      const scale = loudnessScale(
        p,
        hz,
        shape,
        cutoff,
        ENGINE_REFERENCE_RMS * level * dbToGain(p.levelDb),
      );
      for (let band = 0; band < 3; band++) {
        const frequency = voice.osc[band].frequency;
        if (changed) {
          frequency.cancelScheduledValues(at);
          frequency.setValueAtTime(hz[band], at);
        } else frequency.setTargetAtTime(hz[band], at, 0.035);
        voice.bands[band].gain.setTargetAtTime(shape[band] * scale, at, 0.04);
      }
      presence = Math.max(presence, (state.gain / 0.82) * level);
      // Rev limiter / pit limiter: the note bounces (limiter-cue.ts).
      limiterFlutter(frame, id, electric ? 0 : limiter, this.flutter);
      voice.cut.gain.setTargetAtTime(1 - this.flutter.depth / 2, at, 0.03);
      voice.bounce.gain.setTargetAtTime(this.flutter.depth / 2, at, 0.03);
      if (this.flutter.depth > bounceDepth) {
        bounceDepth = this.flutter.depth;
        bounceRate = this.flutter.rateHz;
      }
      voice.gain.gain.setTargetAtTime(state.gain, at, 0.03);
      voice.pan.pan.setTargetAtTime(state.pan, at, 0.025);
      voice.filter.frequency.setTargetAtTime(cutoff, at, 0.04);
      voice.id = id;
    }
    this.presence = presence;
    this.lfo.frequency.setTargetAtTime(bounceRate, time, 0.05);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) {
      for (const osc of voice.osc) {
        osc.stop();
        osc.disconnect();
      }
      for (const band of voice.bands) band.disconnect();
      voice.cut.disconnect();
      voice.bounce.disconnect();
      voice.gain.disconnect();
      voice.filter.disconnect();
      voice.pan.disconnect();
    }
    this.lfo.stop();
    this.lfo.disconnect();
    this.voices.length = 0;
  }
}
