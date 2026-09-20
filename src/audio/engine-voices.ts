import { F, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
import { SpatialAudioScene, type AudioView } from './spatial.ts';

const BAND_CENTRES_RPM = [4500, 8500, 12500] as const;
const BAND_MULTIPLIER = [0.5, 1, 2] as const;
const BAND_GAIN = [0.26, 0.22, 0.085] as const;
interface Voice {
  id: number;
  osc: OscillatorNode[];
  bands: GainNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}
/** Actual production graph, also executable by OfflineAudioContext. All four
 * engines use original harmonic bands; spatial motion controls their frequency,
 * attenuation and stereo image. Voice reassignment dips gain before retuning. */
export class EngineVoices {
  readonly spatial = new SpatialAudioScene();
  private voices: Voice[] = [];
  private disposed = false;
  constructor(context: BaseAudioContext, destination: AudioNode = context.destination) {
    const waves = BAND_CENTRES_RPM.map((_, band) => {
      const real = new Float32Array(40),
        imag = new Float32Array(40);
      for (let k = 1; k < 40; k++)
        imag[k] =
          (band === 0 ? (k % 2 ? 1 : 0.35) : band === 1 ? (k % 3 ? 0.6 : 1) : 0.65) /
          k ** (1.8 - band * 0.35);
      return context.createPeriodicWave(real, imag);
    });
    for (let i = 0; i < 4; i++) {
      const gain = context.createGain(),
        filter = context.createBiquadFilter(),
        pan = context.createStereoPanner();
      gain.gain.value = 0;
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      filter.Q.value = 0.5;
      gain.connect(filter).connect(pan).connect(destination);
      const osc: OscillatorNode[] = [],
        bands: GainNode[] = [];
      for (let j = 0; j < 3; j++) {
        const o = context.createOscillator(),
          g = context.createGain();
        o.setPeriodicWave(waves[j]);
        g.gain.value = 0;
        o.connect(g).connect(gain);
        o.start();
        osc.push(o);
        bands.push(g);
      }
      this.voices.push({ id: -1, osc, bands, filter, gain, pan });
    }
  }
  update(frame: Float32Array, view: AudioView, time: number) {
    if (this.disposed) return;
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid engine audio timestamp');
    this.spatial.update(frame, view);
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
      const load = clamp(Math.abs(frame[o + F.ENGINE_TORQUE]) / 650, 0, 1);
      const changed = voice.id !== id,
        at = changed ? time + 0.02 : time;
      if (changed) {
        voice.gain.gain.cancelScheduledValues(time);
        voice.gain.gain.setTargetAtTime(0, time, 0.003);
      }
      for (let band = 0; band < 3; band++) {
        const hz = Math.max(50, (rpm / 60) * 3 * BAND_MULTIPLIER[band] * state.doppler);
        const frequency = voice.osc[band].frequency;
        if (changed) {
          frequency.cancelScheduledValues(at);
          frequency.setValueAtTime(hz, at);
        } else frequency.setTargetAtTime(hz, at, 0.035);
        const weight = Math.exp(-(((rpm - BAND_CENTRES_RPM[band]) / 4300) ** 2));
        voice.bands[band].gain.setTargetAtTime(
          weight * BAND_GAIN[band] * (0.45 + load * 0.55),
          at,
          0.04,
        );
      }
      voice.gain.gain.setTargetAtTime(state.gain, at, 0.03);
      voice.pan.pan.setTargetAtTime(state.pan, at, 0.025);
      voice.filter.frequency.setTargetAtTime(
        view.interior && id === view.followedCar ? 1500 + load * 2300 : 2500 + load * 4600,
        at,
        0.04,
      );
      voice.id = id;
    }
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
      voice.gain.disconnect();
      voice.filter.disconnect();
      voice.pan.disconnect();
    }
    this.voices.length = 0;
  }
}
