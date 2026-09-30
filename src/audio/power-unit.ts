import { F, carBase } from '../simulation/protocol.ts';
import { clamp, Random } from '../core/math.ts';

/** Turbo-hybrid power-unit character layered over the harmonic engine bands:
 * turbocharger whistle, straight-cut transmission whine, overrun crackle and a
 * gear-change "crack". Original synthesis, no recordings. Every target is a
 * function of recorded state (RPM, engine torque, throttle, gear, road speed),
 * so a paused or replayed frame produces the same sound. */
export interface PowerUnitMix {
  /** Turbocharger whistle. */
  turboHz: number;
  turbo: number;
  /** Straight-cut gear mesh whine, proportional to output-shaft speed. */
  whineHz: number;
  whine: number;
  /** Overrun (lifted throttle at high RPM) crackle events per second. */
  crackleRate: number;
  /** +1 upshift, -1 downshift, 0 none since the previous sample. */
  shift: number;
}

/** Reference points (documented, not fitted to any recording):
 * - boost builds with engine load above ~4,000 rpm; the compressor whistle is
 *   placed between 2.6 and 8 kHz, above the firing harmonics;
 * - gear mesh frequency ≈ 41 Hz per m/s of road speed (≈3.3 kHz at 290 km/h);
 * - overrun crackle only on a closed throttle above 7,500 rpm at speed. */
export const POWER_UNIT = Object.freeze({
  maxTorqueNm: 650,
  turboMinHz: 2600,
  turboSpanHz: 5400,
  turboGain: 0.022,
  whineHzPerMS: 41,
  whineGain: 0.009,
  crackleRpm: 7500,
  crackleMaxRate: 14,
});

export const newPowerUnitMix = (): PowerUnitMix => ({
  turboHz: POWER_UNIT.turboMinHz,
  turbo: 0,
  whineHz: 0,
  whine: 0,
  crackleRate: 0,
  shift: 0,
});

export function powerUnitMix(
  frame: Float32Array,
  car: number,
  previousGear: number,
  out: PowerUnitMix,
): PowerUnitMix {
  const o = carBase(car);
  const rpm = frame[o + F.RPM],
    torque = frame[o + F.ENGINE_TORQUE],
    throttle = frame[o + F.THROTTLE],
    speed = frame[o + F.SPEED],
    gear = frame[o + F.GEAR];
  if (![rpm, torque, throttle, speed, gear].every(Number.isFinite))
    throw new Error('Invalid power-unit audio state');
  const load = clamp(Math.max(0, torque) / POWER_UNIT.maxTorqueNm, 0, 1);
  const boost = clamp(load * clamp((rpm - 4000) / 8000, 0, 1), 0, 1);
  out.turboHz = POWER_UNIT.turboMinHz + POWER_UNIT.turboSpanHz * boost;
  out.turbo = POWER_UNIT.turboGain * boost;
  const road = Math.max(0, speed);
  out.whineHz = road * POWER_UNIT.whineHzPerMS;
  out.whine = gear > 0 ? POWER_UNIT.whineGain * clamp(road / 80, 0, 1) * (0.35 + 0.65 * load) : 0;
  const overrun =
    throttle < 0.08 && rpm > POWER_UNIT.crackleRpm && road > 15 && gear > 0
      ? clamp((rpm - POWER_UNIT.crackleRpm) / 4500, 0, 1)
      : 0;
  out.crackleRate = POWER_UNIT.crackleMaxRate * overrun;
  out.shift =
    Number.isFinite(previousGear) && previousGear > 0 && gear > 0 && gear !== previousGear
      ? Math.sign(gear - previousGear)
      : 0;
  return out;
}

/** Constant-size Web Audio graph (also usable with OfflineAudioContext). */
export class PowerUnitAudio {
  readonly mix = newPowerUnitMix();
  readonly output: GainNode;
  private turbo: OscillatorNode;
  private turboGain: GainNode;
  private whine: OscillatorNode;
  private whineGain: GainNode;
  private burst: AudioBuffer;
  private burstFilter: BiquadFilterNode;
  private burstGain: GainNode;
  private random = new Random(90127);
  private previousGear = NaN;
  private crackleClock = 0;
  private lastTime = NaN;
  bursts = 0;
  constructor(
    private context: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
    this.turbo = context.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = context.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.output);
    this.whine = context.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = context.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.output);
    // One short, seeded decaying noise impulse reused for crackle and shift cracks.
    const length = Math.ceil(context.sampleRate * 0.03);
    this.burst = context.createBuffer(1, length, context.sampleRate);
    const data = this.burst.getChannelData(0),
      noise = new Random(4471);
    for (let i = 0; i < length; i++)
      data[i] = (noise.next() * 2 - 1) * Math.exp((-6 * i) / length);
    this.burstFilter = context.createBiquadFilter();
    this.burstFilter.type = 'bandpass';
    this.burstFilter.frequency.value = 1900;
    this.burstFilter.Q.value = 0.9;
    this.burstGain = context.createGain();
    this.burstGain.gain.value = 1;
    this.burstFilter.connect(this.burstGain).connect(this.output);
    this.turbo.start();
    this.whine.start();
  }
  private pop(time: number, gain: number, hz: number) {
    const source = this.context.createBufferSource();
    source.buffer = this.burst;
    const level = this.context.createGain();
    level.gain.value = gain;
    source.connect(level).connect(this.burstFilter);
    this.burstFilter.frequency.setValueAtTime(hz, time);
    source.start(time);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
    };
    this.bursts++;
  }
  /** `level` is the listener attenuation (0 far away … 1 in the cockpit). */
  update(frame: Float32Array, car: number, time: number, level: number, cockpit: boolean) {
    const m = powerUnitMix(frame, car, this.previousGear, this.mix);
    this.previousGear = frame[carBase(car) + F.GEAR];
    const dt = Number.isFinite(this.lastTime) ? clamp(time - this.lastTime, 0, 0.1) : 0;
    this.lastTime = time;
    const interior = cockpit ? 1 : 0.6;
    this.output.gain.setTargetAtTime(clamp(level, 0, 1) * interior, time, 0.04);
    this.turbo.frequency.setTargetAtTime(m.turboHz, time, 0.08);
    this.turboGain.gain.setTargetAtTime(m.turbo, time, 0.12);
    this.whine.frequency.setTargetAtTime(Math.max(20, m.whineHz), time, 0.03);
    this.whineGain.gain.setTargetAtTime(m.whine, time, 0.05);
    if (m.shift > 0) this.pop(time, 0.28, 2400);
    else if (m.shift < 0) this.pop(time, 0.2, 1500);
    this.crackleClock += m.crackleRate * dt;
    while (this.crackleClock >= 1) {
      this.crackleClock -= 1;
      this.pop(time + this.random.next() * dt, 0.1 + this.random.next() * 0.12, 1300 + this.random.next() * 1400);
    }
  }
  reset() {
    this.previousGear = NaN;
    this.crackleClock = 0;
    this.lastTime = NaN;
    const t = this.context.currentTime;
    this.output.gain.cancelScheduledValues(t);
    this.output.gain.setTargetAtTime(0, t, 0.02);
  }
  dispose() {
    this.turbo.stop();
    this.whine.stop();
    for (const node of [
      this.turbo,
      this.turboGain,
      this.whine,
      this.whineGain,
      this.burstFilter,
      this.burstGain,
      this.output,
    ])
      node.disconnect();
  }
}
