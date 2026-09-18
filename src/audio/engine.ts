import { ContactAudio } from './surface-audio.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { clamp, Random } from '../core/math.ts';
interface Voice {
  osc: OscillatorNode[];
  bands: GainNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}
/** Original procedural sound. Three harmonic engine bands, load-filtered intake,
 * hybrid whine, wind, tire energy, water and impacts all consume simulation state. */
export class RacingAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices: Voice[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private wind: GainNode | null = null;
  private contactAudio: ContactAudio | null = null;
  private last = 0;
  volume = 0.45;
  muted = false;
  async start() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.master.connect(this.compressor).connect(ctx.destination);
    const waves = [0, 1, 2].map((band) => {
      const real = new Float32Array(40),
        imag = new Float32Array(40);
      for (let k = 1; k < 40; k++)
        imag[k] =
          (band === 0 ? (k % 2 ? 1 : 0.35) : band === 1 ? (k % 3 ? 0.6 : 1) : 0.65) /
          k ** (1.8 - band * 0.35);
      return ctx.createPeriodicWave(real, imag);
    });
    for (let i = 0; i < 4; i++) {
      const gain = ctx.createGain(),
        filter = ctx.createBiquadFilter(),
        pan = ctx.createStereoPanner();
      gain.gain.value = 0;
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      filter.Q.value = 0.5;
      gain.connect(filter).connect(pan).connect(this.master);
      const osc: OscillatorNode[] = [],
        bands: GainNode[] = [];
      for (let j = 0; j < 3; j++) {
        const o = ctx.createOscillator(),
          g = ctx.createGain();
        o.setPeriodicWave(waves[j]);
        g.gain.value = 0;
        o.connect(g).connect(gain);
        o.start();
        this.sources.push(o);
        osc.push(o);
        bands.push(g);
      }
      this.voices.push({ osc, bands, filter, gain, pan });
    }
    const random = new Random(331),
      buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
      data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      previous = 0.83 * previous + 0.17 * (random.next() * 2 - 1);
      data[i] = previous * 2;
    }
    const noise = (type: BiquadFilterType, freq: number, q = 1) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(f).connect(gain).connect(this.master!);
      source.start();
      this.sources.push(source);
      return gain;
    };
    this.wind = noise('lowpass', 700);
    this.contactAudio = new ContactAudio(ctx, this.master);
    await ctx.resume();
  }
  update(frame: Float32Array, cockpit: boolean, playing: boolean) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.currentTime - this.last < 0.025) return;
    this.last = ctx.currentTime;
    const time = ctx.currentTime,
      b = carBase(0),
      speed = frame[b + F.SPEED];
    const set = (p: AudioParam, value: number, t = 0.04) => p.setTargetAtTime(value, time, t);
    set(this.master.gain, playing && !this.muted ? this.volume * 0.8 : 0, 0.06);
    if (!playing) return;
    const neighbors = Array.from({ length: frame[H.CARS] }, (_, id) => id).sort((i, j) => {
      const a = carBase(i),
        z = carBase(j);
      return (
        Math.hypot(frame[a] - frame[b], frame[a + 2] - frame[b + 2]) -
        Math.hypot(frame[z] - frame[b], frame[z + 2] - frame[b + 2])
      );
    });
    const yaw = Math.atan2(
      2 * (frame[b + F.QW] * frame[b + F.QY] + frame[b + F.QX] * frame[b + F.QZ]),
      1 - 2 * (frame[b + F.QY] ** 2 + frame[b + F.QZ] ** 2),
    );
    this.voices.forEach((voice, i) => {
      const id = neighbors[i];
      if (id === undefined) {
        set(voice.gain.gain, 0);
        return;
      }
      const o = carBase(id),
        rpm = frame[o + F.RPM],
        load = clamp(Math.abs(frame[o + F.ENGINE_TORQUE]) / 650, 0, 1),
        dx = frame[o] - frame[b],
        dz = frame[o + 2] - frame[b + 2],
        distance = Math.hypot(dx, dz);
      const radial =
        distance > 0.1
          ? ((frame[o + F.VX] - frame[b + F.VX]) * dx + (frame[o + F.VZ] - frame[b + F.VZ]) * dz) /
            distance
          : 0;
      const doppler = clamp(343 / (343 + radial), 0.84, 1.18),
        base = (rpm / 60) * 3;
      for (let band = 0; band < 3; band++) {
        set(voice.osc[band].frequency, Math.max(50, base * [0.5, 1, 2][band] * doppler), 0.035);
        const centre = [4500, 8500, 12500][band],
          weight = Math.exp(-(((rpm - centre) / 4300) ** 2));
        set(voice.bands[band].gain, weight * [0.26, 0.22, 0.085][band] * (0.45 + load * 0.55));
      }
      set(voice.gain.gain, id === 0 ? 0.82 : Math.min(0.45, 8 / (distance + 8)));
      set(
        voice.pan.pan,
        id === 0
          ? 0
          : clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(8, distance), -1, 1),
      );
      set(voice.filter.frequency, id === 0 && cockpit ? 1500 + load * 2300 : 2500 + load * 4600);
    });
    set(this.wind!.gain, Math.min(0.25, (speed / 100) ** 2 * 0.23));
    this.contactAudio!.update(frame, cockpit, time);
  }
  stop() {
    this.master?.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.03);
  }
  async dispose() {
    this.contactAudio?.dispose();
    this.contactAudio = null;
    for (const s of this.sources) {
      s.stop();
      s.disconnect();
    }
    this.sources = [];
    if (this.context) await this.context.close();
    this.context = null;
    this.voices = [];
    this.master = null;
    this.compressor = null;
    this.wind = null;
    this.last = 0;
  }
}
