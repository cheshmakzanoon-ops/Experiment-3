import { clamp } from '../core/math.ts';
import { GuideRoute } from '../rendering/driving-guide.ts';
import { yellowFlag } from '../simulation/marshal.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
export interface DrivingAudioSettings {
  enabled: boolean;
  volume: number;
  lookahead: number;
  invertStereo: boolean;
  brake: boolean;
  turns: boolean;
  gears: boolean;
  trackLimits: boolean;
  wrongWay: boolean;
}
export const DEFAULT_DRIVING_AUDIO: Readonly<DrivingAudioSettings> = Object.freeze({
  enabled: false,
  volume: 0.35,
  lookahead: 30,
  invertStereo: false,
  brake: true,
  turns: true,
  gears: true,
  trackLimits: true,
  wrongWay: true,
});
export function validateDrivingAudio(value: unknown): DrivingAudioSettings {
  const p = value && typeof value === 'object' ? (value as Partial<DrivingAudioSettings>) : {};
  return {
    enabled: p.enabled === true,
    invertStereo: p.invertStereo === true,
    volume:
      typeof p.volume === 'number' && Number.isFinite(p.volume) ? clamp(p.volume, 0, 1) : 0.35,
    lookahead:
      typeof p.lookahead === 'number' && Number.isFinite(p.lookahead)
        ? clamp(p.lookahead, 8, 80)
        : 30,
    brake: p.brake !== false,
    turns: p.turns !== false,
    gears: p.gears !== false,
    trackLimits: p.trackLimits !== false,
    wrongWay: p.wrongWay !== false,
  };
}
export type DrivingCueKind =
  | 'wrong-way'
  | 'track-limit'
  | 'brake'
  | 'upshift'
  | 'downshift'
  | 'turn';
export interface DrivingCue {
  kind: DrivingCueKind;
  frequency: number;
  pan: number;
  duration: number;
}
/** Advisory, read-only, human-live-only cue arbitration. A geometric estimate
 * cannot guarantee the correct line or replace traffic awareness. One bounded
 * tone at a time, with dwell for noisy edge/direction conditions. */
export class DrivingCueDirector {
  readonly route: GuideRoute;
  private here = trackPoint();
  private ahead = trackPoint();
  private lastSample = -Infinity;
  private lastTick = -1;
  private tickAt = -Infinity;
  private nextCue = -Infinity;
  private wrongSince = -Infinity;
  private limitSince = -Infinity;
  lastKind: DrivingCueKind | null = null;
  emitted = 0;
  constructor(readonly track: Track) {
    this.route = new GuideRoute(track);
  }
  reset() {
    this.lastSample = this.nextCue = this.wrongSince = this.limitSince = -Infinity;
    this.lastKind = null;
    this.lastTick = -1;
    this.tickAt = -Infinity;
  }
  sample(
    frame: Float32Array,
    liveHuman: boolean,
    now: number,
    settings: DrivingAudioSettings,
  ): DrivingCue | null {
    const o = carBase(0);
    if (
      !liveHuman ||
      !settings.enabled ||
      settings.volume <= 0 ||
      !Number.isFinite(now) ||
      frame.length <= o + F.RETIRED ||
      frame[H.CARS] < 1 ||
      frame[H.PHASE] !== 2 ||
      frame[o + F.IN_PIT] ||
      frame[o + F.RETIRED] ||
      frame[o + F.FINISH]
    ) {
      this.reset();
      return null;
    }
    for (const index of [
      H.WATER,
      o + F.S,
      o + F.LATERAL,
      o + F.SPEED,
      o + F.RPM,
      o + F.GEAR,
      o + F.VX,
      o + F.VZ,
      o + F.THROTTLE,
      o + F.BRAKE,
      o + F.LOCAL_FLAG,
      o + F.CAUTION_SPEED,
    ])
      if (!Number.isFinite(frame[index])) {
        this.reset();
        return null;
      }
    if (now < this.lastSample || now - this.lastSample > 0.5) this.reset();
    this.lastSample = now;
    const tick = frame[H.TICK];
    if (!Number.isFinite(tick) || tick < 0 || tick < this.lastTick) {
      this.reset();
      return null;
    }
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      this.tickAt = now;
    }
    if (now - this.tickAt > 0.5) {
      this.lastKind = null;
      return null;
    }
    this.track.at(frame[o + F.S], this.here);
    this.track.at(frame[o + F.S] + settings.lookahead, this.ahead);
    const speed = frame[o + F.SPEED];
    const wrong = speed > 4 && frame[o + F.VX] * this.here.tx + frame[o + F.VZ] * this.here.tz < -2;
    const outside = speed > 3 && Math.abs(frame[o + F.LATERAL]) > this.here.width + 0.5;
    this.wrongSince = wrong ? (this.wrongSince === -Infinity ? now : this.wrongSince) : -Infinity;
    this.limitSince = outside ? (this.limitSince === -Infinity ? now : this.limitSince) : -Infinity;
    if (now < this.nextCue) return null;
    let cue: DrivingCue | null = null,
      interval = 0.45;
    if (wrong && settings.wrongWay && now - this.wrongSince >= 0.6)
      cue = { kind: 'wrong-way', frequency: 220, pan: 0, duration: 0.25 };
    else if (outside && settings.trackLimits && now - this.limitSince >= 0.2)
      cue = {
        kind: 'track-limit',
        frequency: 330,
        pan: frame[o + F.LATERAL] > 0 ? -0.8 : 0.8,
        duration: 0.18,
      };
    else if (!wrong && !outside) {
      const limit = yellowFlag(frame[o + F.LOCAL_FLAG])
        ? Math.max(1, frame[o + F.CAUTION_SPEED] || 12)
        : 0;
      const target = this.route.speed(frame[o + F.S], frame[H.WATER], limit);
      if (settings.brake && speed > 8 && speed > target + 4) {
        cue = {
          kind: 'brake',
          frequency: 520 + clamp(speed - target, 0, 40) * 9,
          pan: 0,
          duration: 0.12,
        };
        interval = 0.32;
      } else if (
        settings.gears &&
        frame[o + F.GEAR] > 0 &&
        frame[o + F.GEAR] < 8 &&
        frame[o + F.RPM] > 11800 &&
        frame[o + F.THROTTLE] > 0.6
      )
        cue = { kind: 'upshift', frequency: 1100, pan: 0, duration: 0.09 };
      else if (
        settings.gears &&
        frame[o + F.GEAR] > 1 &&
        frame[o + F.RPM] < 4800 &&
        frame[o + F.BRAKE] > 0.3 &&
        speed > 5
      )
        cue = { kind: 'downshift', frequency: 440, pan: 0, duration: 0.09 };
      else if (settings.turns && speed > 5) {
        const bend = this.here.tx * this.ahead.tz - this.here.tz * this.ahead.tx;
        if (Math.abs(bend) > 0.055) {
          cue = { kind: 'turn', frequency: 660, pan: clamp(bend * 4, -0.9, 0.9), duration: 0.09 };
          interval = 0.65;
        }
      }
    }
    if (cue) {
      if (settings.invertStereo) cue.pan *= -1;
      this.lastKind = cue.kind;
      this.nextCue = now + interval;
      this.emitted++;
    }
    return cue;
  }
}
/** Constant-size synthesized graph, also testable in OfflineAudioContext. */
export class CueSynth {
  private oscillator: OscillatorNode;
  private gain: GainNode;
  private pan: StereoPannerNode;
  constructor(
    private context: BaseAudioContext,
    output: AudioNode,
  ) {
    this.oscillator = context.createOscillator();
    this.oscillator.type = 'sine';
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.pan = context.createStereoPanner();
    this.oscillator.connect(this.gain).connect(this.pan).connect(output);
    this.oscillator.start();
  }
  play(cue: DrivingCue, time: number, volume: number) {
    if (![time, volume, cue.frequency, cue.pan, cue.duration].every(Number.isFinite)) return;
    time = Math.max(this.context.currentTime, time);
    const duration = clamp(cue.duration, 0.04, 0.3);
    this.oscillator.frequency.setValueAtTime(clamp(cue.frequency, 100, 1800), time);
    this.pan.pan.setValueAtTime(clamp(cue.pan, -1, 1), time);
    this.gain.gain.cancelScheduledValues(time);
    this.gain.gain.setValueAtTime(0, time);
    this.gain.gain.linearRampToValueAtTime(clamp(volume, 0, 1) * 0.18, time + 0.012);
    this.gain.gain.linearRampToValueAtTime(0, time + duration);
  }
  silence() {
    const t = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.006);
  }
  dispose() {
    this.oscillator.stop();
    this.oscillator.disconnect();
    this.gain.disconnect();
    this.pan.disconnect();
  }
}
